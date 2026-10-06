#!/usr/bin/env node
// check-adr-lint — banco de casos EJECUTABLE de `vendored/scripts/adr-lint.mjs`
// (AP-084). El fichero es el fuente vendorizado que el graft (AP-009) sirve a
// finplan y wmcb en cada run; hasta ahora no tenía ningún banco en el central:
// la única evidencia de una regla nueva era una corrida a mano pegada en el
// body de un PR del consumidor (finplan#2009 `adr-lint-selftest.mjs`, que
// además nada invocaba). Un banco que vive fuera del árbol es disciplina sin
// consumidor.
//
// Método: se monta un corpus mínimo en un directorio temporal (índice + un
// volumen + adr-lint.config.json) y se ejecuta el lint REAL con `cwd` allí.
// Se asierta el exit code y, en rojo, el mensaje de la regla que debe morder.
// Verde: exit 0. Rojo: una regla dejó de cazar su clase (o caza lo que no debe).
//
// Segunda parte (central#325, AP-106): casos (a)–(h) del ruling, y el banco de
// la enmienda al ruling (línea en la ADR equivocada, párrafos permutados,
// espacio final, preámbulo, no atribuible sin override, --check, CRLF), sobre
// `--ids-vs`, adr-migrate, adr-equiv, adr-index y `layout: "dir"`. Fixtures
// SINTÉTICOS con los formatos de cabecera medidos (finplan `ADR-N · Rectificación k`,
// `ADR-N·R·k`, `Rectificación R·k`; wmcb `Revisión R·k`), nunca el registro real.
//
// Tercera parte (central#331, AP-109): (i) duplicados heredados declarados,
// (i') rectificaciones a un número duplicado (ambiguas sin override), (ii) regla 2
// en `dir` por bloque del parser, (iii) frontera «anfitriona = propia ADR» en
// adr-migrate, (iv) `--append-only-vs` y (v) salida idéntica en volúmenes sin
// claves nuevas (literal capturado con el adr-lint de 997d568).
//
// Cuarta parte (central#334, AP-110): (vi) `--append-only-vs` con las líneas
// `**Estado:**` enmascaradas — casos (a)–(f) del ruling; (g) = los de (iv), intactos;
// (h) quitar el `\n` final del tramo es rojo y no cuenta como Estado (revisión del PR #335).
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';

const LINT = resolve('vendored/scripts/adr-lint.mjs');
if (!existsSync(LINT)) { console.error(`check-adr-lint ROJO: no existe ${LINT}`); process.exit(1); }

// Corpus base — 3 ADRs, cada uno con las secciones que la regla 4 exige, sin
// citas atribuidas (regla 2 fuera de juego) ni deroga/rectifica (regla 3).
const adr = (n, t) => `## ADR-${n} — ${t}\n\nTexto.\n\n**Alternativas descartadas.** Ninguna.\n\n**Coste de revertir.** Bajo.\n\n---\n\n`;
const VOL = adr(1, 'Uno') + adr(2, 'Dos') + adr(3, 'Tres');
const IDX_LINES = ['- [ADR-1](docs/decisions/decisions.md#adr-1) — Uno',
                   '- [ADR-2](docs/decisions/decisions.md#adr-2) — Dos',
                   '- [ADR-3](docs/decisions/decisions.md#adr-3) — Tres'];
const CFG = { volumes: ['docs/decisions/vol.md'], index: 'decisions.md', strictFrom: 1, extraSources: [] };

function run(nombre, { vol = VOL, idx = IDX_LINES.join('\n') + '\n', cfg = CFG } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-lint-bank-'));
  try {
    mkdirSync(join(dir, 'docs/decisions'), { recursive: true });
    writeFileSync(join(dir, 'docs/decisions/vol.md'), vol);
    writeFileSync(join(dir, 'decisions.md'), idx);
    writeFileSync(join(dir, 'adr-lint.config.json'), JSON.stringify(cfg));
    const r = spawnSync(process.execPath, [LINT], { cwd: dir, encoding: 'utf8' });
    return { nombre, code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const casos = [
  // Control: sin él, todo caso negativo sería vacuo (un lint que siempre falla pasaría el banco).
  { r: run('control verde'), esperaCode: 0 },
  // Regla 1 (preexistente): cabecera sin entrada en el índice.
  { r: run('regla 1 · cabecera sin índice', { idx: IDX_LINES.slice(0, 2).join('\n') + '\n' }),
    esperaCode: 1, esperaMsg: 'ADR-3 sin entrada en el índice' },
  // Regla 1b (AP-084): índice conserva ADR-3, el volumen la perdió (blob stale — finplan 0e762ba).
  { r: run('regla 1b · índice sin cabecera', { vol: adr(1, 'Uno') + adr(2, 'Dos') }),
    esperaCode: 1, esperaMsg: 'ADR-3 en el índice sin cabecera en ningún volumen' },
  // Regla 1c (AP-084): la MISMA línea de entrada repetida byte a byte.
  { r: run('regla 1c · entrada duplicada', { idx: [...IDX_LINES, IDX_LINES[1]].join('\n') + '\n' }),
    esperaCode: 1, esperaMsg: 'ADR-2 duplicado en el índice' },
  // 1c NO muerde en la colisión de N con líneas distintas (finplan ADR-144, preexistente):
  // es defecto de contenido, fuera de la regla. Congela el diseño «por línea, no por N».
  { r: run('regla 1c · colisión de N con líneas distintas NO es duplicado',
           { idx: [...IDX_LINES, '- [ADR-2](docs/decisions/vol.md#adr-2-bis) — Dos (heredada)'].join('\n') + '\n' }),
    esperaCode: 0 },
  // 1b con espacios: la normalización de la entrada no debe romper la detección de la cabecera.
  { r: run('regla 1b · entrada con sangría de lista', { idx: '  - [ADR-9] — Nueve\n' + IDX_LINES.join('\n') + '\n' }),
    esperaCode: 1, esperaMsg: 'ADR-9 en el índice sin cabecera' },
];

// ── (a)–(h): registro de decisiones (central#325) ──────────────────────────
const V = f => resolve('vendored/scripts', f);
for (const f of ['adr-registro.mjs', 'adr-migrate.mjs', 'adr-equiv.mjs', 'adr-index.mjs'])
  if (!existsSync(V(f))) { console.error(`check-adr-lint ROJO: no existe ${V(f)}`); process.exit(1); }
const sandbox = files => {
  const dir = mkdtempSync(join(tmpdir(), 'adr-reg-bank-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), typeof c === 'string' ? c : JSON.stringify(c)); }
  return dir;
};
const exec = (dir, script, args = []) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const git = (dir, ...a) => spawnSync('git', ['-c', 'user.email=bank@local', '-c', 'user.name=bank', ...a], { cwd: dir, encoding: 'utf8' });
const caso = (nombre, fn) => {
  let r;
  try { r = fn(); } catch (e) { r = { code: -1, out: String(e.stack || e), esperaCode: 0 }; }
  casos.push({ r: { nombre, code: r.code, out: r.out }, esperaCode: r.esperaCode, esperaMsg: r.esperaMsg });
};
const W = (dir, p, c) => writeFileSync(join(dir, p), c);
const R_ = (dir, p) => readFileSync(join(dir, p), 'utf8');

// (a)/(b) --ids-vs: repo git mínimo con dos volúmenes.
const VOL_A = adr(1, 'Uno') + '### Revisión R·1 (2026-01-02) — r\n\nLínea de R·1.\n\n' + adr(2, 'Dos') + adr(3, 'Tres');
const IDS_CFG = { volumes: ['docs/decisions/v1.md', 'docs/decisions/v2.md'], index: 'decisions.md', strictFrom: 1, extraSources: [] };
const idsRepo = () => {
  const d = sandbox({ 'docs/decisions/v1.md': VOL_A, 'docs/decisions/v2.md': '# Volumen 2\n\n', 'decisions.md': IDX_LINES.join('\n') + '\n', 'adr-lint.config.json': IDS_CFG });
  git(d, 'init', '-q'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base');
  return d;
};
caso('(a) truncado tipo 32be10a0 ⇒ --ids-vs rojo (y el lint de siempre, verde)', () => {
  const d = idsRepo();
  try {
    W(d, 'docs/decisions/v1.md', adr(1, 'Uno'));                 // volumen truncado: fuera ADR-1·R·1, ADR-2 y ADR-3…
    W(d, 'decisions.md', IDX_LINES[0] + '\n');                    // …y el índice cae con él: 1/1b/1c no lo ven
    const base = exec(d, LINT);
    if (base.code !== 0) return { ...base, esperaCode: 0 };
    const r = exec(d, LINT, ['--ids-vs', 'HEAD']);
    const ok = ['ADR-1·R·1', 'ADR-2', 'ADR-3'].every(i => r.out.includes(' - ' + i));
    return { code: ok ? r.code : -1, out: r.out, esperaCode: 1, esperaMsg: '3 identificador(es) del registro perdidos' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
caso('(b) mover una ADR entre volúmenes ⇒ --ids-vs verde', () => {
  const d = idsRepo();
  try {
    W(d, 'docs/decisions/v1.md', adr(1, 'Uno') + '### Revisión R·1 (2026-01-02) — r\n\nLínea de R·1.\n\n' + adr(2, 'Dos'));
    W(d, 'docs/decisions/v2.md', '# Volumen 2\n\n' + adr(3, 'Tres') + adr(4, 'Cuatro (nueva)'));
    return { ...exec(d, LINT, ['--ids-vs', 'HEAD']), esperaCode: 0, esperaMsg: 'ningún identificador perdido' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
caso('(a/b) <ref> ilegible ⇒ error explícito (exit 2)', () => {
  const d = idsRepo();
  try { return { ...exec(d, LINT, ['--ids-vs', 'no-existe']), esperaCode: 2, esperaMsg: 'ilegible' }; }
  finally { rmSync(d, { recursive: true, force: true }); }
});

// (c)–(g) y banco de la enmienda: volúmenes con los cuatro formatos,
// rectificaciones lejos de su ADR, preámbulo y una línea con espacio final.
const MIG_CFG = { volumes: ['docs/decisions/v1.md', 'docs/decisions/v2.md'], dir: 'docs/decisions/adr', index: 'docs/decisions/adr/INDEX.md', strictFrom: 1000, extraSources: [] };
const MV1 = ['# Volumen 1', '', '## ADR-1 (2026-01-01) — Uno', '', 'Texto de uno.', '', 'Línea con espacio final. ', '',
  '### Rectificación R·1 (2026-02-01) — sin ADR en la cabecera, dentro de su bloque', '', 'Línea de ADR-1·R·1.', '',
  '## ADR-2 — Dos', '', '**Fecha:** 2026-01-05', '', 'Texto de dos.', '',
  '### Revisión R·1 (2026-03-01, issue #9) — formato wmcb', '', 'Línea de ADR-2·R·1.', '#### Sub-sección de la revisión', 'Línea honda de ADR-2·R·1.', ''].join('\n');
const MV2 = ['## ADR-3 (2026-01-10) — Tres, que aloja rectificaciones ajenas', '', 'Texto de tres.', '',
  '### ADR-1 · Rectificación 2 (2026-04-01) — lejos de su ADR, formato largo', '', 'Línea de ADR-1·R·2.', '',
  '### ADR-2·R·2 — lejos, formato corto (2026-05-01)', '', 'Línea de ADR-2·R·2.', '',
  '### Coste de revertir', '', 'Coste de ADR-3, que sigue a una rectificación ajena.', '',
  '## ADR-4 (2026-01-20) — Cuatro', '', 'Texto de cuatro.', ''].join('\n');
const migRepo = (v2 = MV2, v1 = MV1, extra = {}) => sandbox({ 'docs/decisions/v1.md': v1, 'docs/decisions/v2.md': v2, 'adr-lint.config.json': MIG_CFG, ...extra });
const ADRD = 'docs/decisions/adr';
const F = n => `${ADRD}/ADR-00${n}.md`;
const snap = d => readdirSync(join(d, ADRD)).sort().map(f => f + '\n' + R_(d, `${ADRD}/${f}`)).join('\n@@\n') +
  ['adr-no-atribuibles.json', 'adr-no-atribuibles.md', 'adr-migracion.md'].map(f => R_(d, 'docs/decisions/' + f)).join('\n@@\n');
const AMBIGUA = '### Rectificación R·7 (2026-06-01) — ¿de ADR-3, de ADR-1 o de ADR-2?\n\nLínea ambigua.\n\n## ADR-4';
const CLAVE_AMBIGUA = 'docs/decisions/v2.md#### Rectificación R·7 (2026-06-01) — ¿de ADR-3, de ADR-1 o de ADR-2?#1';
caso('(c) migración: cuatro formatos y rectificación lejos de su ADR ⇒ cada una en su fichero, .origen.json, informes (equiv, index, lint dir verdes)', () => {
  const d = migRepo();
  try {
    const m = exec(d, V('adr-migrate.mjs'));
    if (m.code !== 0) return { ...m, esperaCode: 0 };
    const f1 = R_(d, F(1)), f2 = R_(d, F(2)), f3 = R_(d, F(3));
    const want1 = ['### ADR-001·R·1 (2026-02-01) — sin ADR en la cabecera, dentro de su bloque', '### ADR-001·R·2 (2026-04-01) — lejos de su ADR, formato largo'];
    const want2 = ['### ADR-002·R·1 (2026-03-01, issue #9) — formato wmcb', '### ADR-002·R·2 (2026-05-01) — lejos, formato corto', '### Coste de revertir'];
    const heads = t => t.split('\n').filter(l => /^### /.test(l));
    const bad = [];
    if (JSON.stringify(heads(f1)) !== JSON.stringify(want1)) bad.push('ADR-001.md: ' + JSON.stringify(heads(f1)));
    if (JSON.stringify(heads(f2)) !== JSON.stringify(want2)) bad.push('ADR-002.md: ' + JSON.stringify(heads(f2)));
    if (heads(f3).length || !f3.includes('Texto de tres.')) bad.push('ADR-003.md conserva rectificaciones ajenas o pierde su texto: ' + JSON.stringify(heads(f3)));
    // Enmienda, punto 1: bloque = hasta la siguiente cabecera de ADR/rectificación ⇒ el «### Coste de revertir»
    // que sigue a ADR-2·R·2 viaja con ella, y queda en «fronteras a confirmar».
    if (!f2.includes('Coste de ADR-3, que sigue')) bad.push('ADR-002·R·2 no se llevó su bloque entero (hasta la siguiente cabecera de ADR/rectificación)');
    const inf = R_(d, 'docs/decisions/adr-migracion.md');
    if (!/ADR-002·R·2 .*incluye docs\/decisions\/v2\.md:\d+ «### Coste de revertir»/.test(inf)) bad.push('falta la frontera a confirmar de ADR-002·R·2 en el informe');
    if (!f1.includes('Línea con espacio final. \n')) bad.push('el espacio final no viajó byte a byte');
    if (!f2.includes('#### Sub-sección de la revisión\nLínea honda de ADR-2·R·1.')) bad.push('la sub-sección H4 no viajó con su revisión');
    const o = JSON.parse(R_(d, `${ADRD}/.origen.json`));
    if (o.bloques.length !== 8 || o.cabeceras.length !== 4 || o.fueraDeBloque.length !== 1 || o.fueraDeBloque[0].texto !== '# Volumen 1\n\n')
      bad.push(`.origen.json: ${o.bloques.length} bloques (8), ${o.cabeceras.length} cabeceras (4), fuera de bloque ${JSON.stringify(o.fueraDeBloque)}`);
    const b0 = o.bloques.find(b => b.id === 'ADR-2·R·2');
    if (!b0 || b0.volumen !== 'docs/decisions/v2.md' || b0.inicio !== 9 || b0.fin !== 16 || b0.cabecera !== '### ADR-2·R·2 — lejos, formato corto (2026-05-01)' || b0.destino !== 'ADR-002.md')
      bad.push('.origen.json: procedencia de ADR-2·R·2 incorrecta: ' + JSON.stringify(b0));
    if (!inf.includes('| `docs/decisions/v2.md:9` | ### ADR-2·R·2 — lejos, formato corto (2026-05-01) | ### ADR-002·R·2 (2026-05-01) — lejos, formato corto |')) bad.push('falta la fila de ADR-2·R·2 en la tabla de cabeceras');
    if (bad.length) return { code: -1, out: bad.join('\n'), esperaCode: 0 };
    const e = exec(d, V('adr-equiv.mjs'), ['--check']);
    if (e.code !== 0 || !/✔ \(a\)[\s\S]*✔ \(b\)[\s\S]*✔ \(c\)[\s\S]*✔ \(d\)[\s\S]*✔ \(e\)[\s\S]*✔ \(check\)/.test(e.out)) return { ...e, code: e.code || -1, esperaCode: 0 };
    const i = exec(d, V('adr-index.mjs'));
    if (i.code !== 0) return { ...i, esperaCode: 0 };
    W(d, 'adr-lint.config.json', JSON.stringify({ ...MIG_CFG, layout: 'dir' }));
    return { ...exec(d, LINT), esperaCode: 0, esperaMsg: 'layout dir: 4 ficheros, 4 rectificaciones' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
caso('(d) enmienda · no atribuible sin override ⇒ exit ≠ 0, informe con la pendiente y SIN escribir adr/', () => {
  const d = migRepo(MV2.replace('## ADR-4', AMBIGUA));
  try {
    const m = exec(d, V('adr-migrate.mjs'));
    const rep = JSON.parse(R_(d, 'docs/decisions/adr-no-atribuibles.json'));
    const bad = [];
    if (existsSync(join(d, ADRD))) bad.push('escribió adr/ con una no atribuible pendiente');
    if (rep.entradas.length !== 1 || rep.entradas[0].colocada || rep.entradas[0].clave !== CLAVE_AMBIGUA) bad.push('informe: ' + JSON.stringify(rep.entradas));
    if (!R_(d, 'docs/decisions/adr-no-atribuibles.md').includes('**pendiente**')) bad.push('el .md no marca la pendiente');
    if (bad.length) return { code: -1, out: m.out + '\n' + bad.join('\n'), esperaCode: 1 };
    return { ...m, esperaCode: 1, esperaMsg: '1 rectificación(es) no atribuibles sin override' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
caso('(d) override en adr-migrate.overrides.json ⇒ colocada, sigue en el informe resuelta, equiv verde', () => {
  const d = migRepo(MV2.replace('## ADR-4', AMBIGUA), MV1, { 'adr-migrate.overrides.json': { _nota: 'banco', [CLAVE_AMBIGUA]: 'ADR-3' } });
  try {
    const m = exec(d, V('adr-migrate.mjs'));
    if (m.code !== 0) return { ...m, esperaCode: 0 };
    if (!R_(d, F(3)).includes('### ADR-003·R·7 (2026-06-01)')) return { code: -1, out: 'el override no colocó la rectificación en ADR-003.md', esperaCode: 0 };
    const rep = JSON.parse(R_(d, 'docs/decisions/adr-no-atribuibles.json'));
    if (rep.entradas.length !== 1 || rep.entradas[0].resolucion !== 'ADR-003') return { code: -1, out: JSON.stringify(rep), esperaCode: 0 };
    return { ...exec(d, V('adr-equiv.mjs')), esperaCode: 0, esperaMsg: 'ADR-EQUIV verde' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
caso('(e) adr-migrate dos veces ⇒ salida idéntica', () => {
  const d = migRepo();
  try {
    exec(d, V('adr-migrate.mjs')); const s1 = snap(d);
    const m2 = exec(d, V('adr-migrate.mjs')); const s2 = snap(d);
    return { code: s1 === s2 ? m2.code : -1, out: m2.out, esperaCode: 0, esperaMsg: '0 escritos, 5 sin cambios, 0 borrados' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
const mutado = (mut, test, args = []) => () => {
  const d = migRepo();
  try {
    const m = exec(d, V('adr-migrate.mjs'));
    if (m.code !== 0) return { ...m, esperaCode: 0 };
    const ok = exec(d, V('adr-equiv.mjs'), args);
    if (ok.code !== 0) return { ...ok, esperaCode: 0 };          // control: sin la mutación, verde
    mut(d);
    const r = exec(d, V('adr-equiv.mjs'), args);
    const falta = test.filter(s => !r.out.includes(s));
    return { code: falta.length ? -1 : r.code, out: r.out + (falta.length ? `\nfalta: ${JSON.stringify(falta)}` : ''), esperaCode: 1 };
  } finally { rmSync(d, { recursive: true, force: true }); }
};
const sub = (d, p, a, b) => { const t = R_(d, p); if (!t.includes(a)) throw new Error(`${p} no contiene ${JSON.stringify(a)}`); W(d, p, t.replace(a, b)); };
caso('(f) adr-equiv: una línea perdida ⇒ (b) rojo', mutado(d => sub(d, F(3), 'Texto de tres.\n', ''), ['✘ (b)', 'ADR-3 (docs/decisions/v2.md:1-']));
caso('(f) adr-equiv: una línea duplicada ⇒ (b) rojo', mutado(d => W(d, F(4), R_(d, F(4)) + 'Texto de cuatro.\n'), ['✘ (b)', 'ADR-4 (']));
caso('(f) adr-equiv: rectificación en fichero ajeno ⇒ (d) rojo', mutado(d => {
  const t2 = R_(d, F(2)), i = t2.indexOf('### ADR-002·R·2');
  W(d, F(2), t2.slice(0, i)); W(d, F(1), R_(d, F(1)) + t2.slice(i));
}, ['✘ (d)', 'rectificación ADR-2·R·2 en el fichero de ADR-001']));
// Banco de la enmienda (punto 4).
caso('(enmienda) línea movida a la ADR equivocada ⇒ (b) rojo en las dos', mutado(d => {
  sub(d, F(4), 'Texto de cuatro.\n', ''); sub(d, F(3), 'Texto de tres.\n', 'Texto de tres.\nTexto de cuatro.\n');
}, ['✘ (b)', 'ADR-3 (', 'ADR-4 (']));
caso('(enmienda) dos párrafos permutados dentro de un bloque ⇒ (b) y (c) rojos', mutado(d =>
  sub(d, F(1), 'Texto de uno.\n\nLínea con espacio final. \n', 'Línea con espacio final. \n\nTexto de uno.\n'),
['✘ (b)', '✘ (c)', 'ADR-1 (docs/decisions/v1.md:3-']));
caso('(enmienda) espacio final eliminado ⇒ rojo', mutado(d => sub(d, F(1), 'Línea con espacio final. \n', 'Línea con espacio final.\n'),
  ['✘ (b)', '✘ (c)', 'origen "Línea con espacio final. \\n" · destino "Línea con espacio final.\\n"']));
caso('(enmienda) preámbulo de volumen ⇒ consta en el informe; borrado de .origen.json ⇒ (e) y (c) rojos', mutado(d => {
  if (!R_(d, 'docs/decisions/adr-migracion.md').includes('### `docs/decisions/v1.md:1-2`')) throw new Error('el preámbulo no aparece en el informe');
  const o = JSON.parse(R_(d, `${ADRD}/.origen.json`)); o.fueraDeBloque = [];
  W(d, `${ADRD}/.origen.json`, JSON.stringify(o, null, 2) + '\n');
}, ['✘ (c)', '✘ (e)', 'docs/decisions/v1.md:1-2: fuera de bloque y sin constar en .origen.json']));
caso('(enmienda) preámbulo ausente del informe de migración ⇒ (e) rojo', mutado(d => sub(d, 'docs/decisions/adr-migracion.md', '# Volumen 1\n', ''),
  ['✘ (e)', 'docs/decisions/v1.md:1-2: no consta literal en docs/decisions/adr-migracion.md']));
caso('(enmienda) --check: adr/ editado a mano ⇒ (check) rojo', mutado(d => sub(d, F(4), 'Texto de cuatro.\n', 'Texto de cuatro, editado.\n'),
  ['✘ (check)', 'ADR-004.md: difiere de lo regenerado'], ['--check']));
caso('(enmienda) CRLF: ida y vuelta sin normalizar EOL; un \\r\\n → \\n ⇒ (b) rojo', () => {
  const crlf = s => s.replace(/\n/g, '\r\n');
  const d = migRepo(crlf(MV2), crlf(MV1));
  try {
    const m = exec(d, V('adr-migrate.mjs'));
    if (m.code !== 0) return { ...m, esperaCode: 0 };
    const ok = exec(d, V('adr-equiv.mjs'), ['--check']);
    if (ok.code !== 0 || !R_(d, F(1)).includes('### ADR-001·R·1 (2026-02-01) — sin ADR en la cabecera, dentro de su bloque\r\n')) return { ...ok, code: ok.code || -1, esperaCode: 0 };
    sub(d, F(4), 'Texto de cuatro.\r\n', 'Texto de cuatro.\n');
    return { ...exec(d, V('adr-equiv.mjs')), esperaCode: 1, esperaMsg: 'origen "Texto de cuatro.\\r\\n" · destino "Texto de cuatro.\\n"' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
caso('(a/b) --ids-vs tras el corte con una ambigua RESUELTA por override a otra ADR ⇒ verde (cambio de fichero, no pérdida)', () => {
  const d = migRepo(MV2.replace('## ADR-4', AMBIGUA));
  try {
    git(d, 'init', '-q'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'volúmenes');
    W(d, 'adr-migrate.overrides.json', JSON.stringify({ [CLAVE_AMBIGUA]: 'ADR-1' }));
    const m = exec(d, V('adr-migrate.mjs'));
    if (m.code !== 0) return { ...m, esperaCode: 0 };
    W(d, 'adr-lint.config.json', JSON.stringify({ ...MIG_CFG, layout: 'dir' }));
    return { ...exec(d, LINT, ['--ids-vs', 'HEAD']), esperaCode: 0, esperaMsg: 'ningún identificador perdido' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
caso('(g) adr-index --check detecta desfase', () => {
  const d = migRepo();
  try {
    exec(d, V('adr-migrate.mjs')); exec(d, V('adr-index.mjs'));
    const ok = exec(d, V('adr-index.mjs'), ['--check']);
    if (ok.code !== 0) return { ...ok, esperaCode: 0 };
    W(d, F(4), R_(d, F(4)) + '\n### ADR-004·R·1 (2026-07-01) — nueva\n\nLínea.\n');
    return { ...exec(d, V('adr-index.mjs'), ['--check']), esperaCode: 1, esperaMsg: '1 rectificación (última: 2026-07-01)' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
caso('(h) layout "volumes" sin config nueva (ni fichero de config) ⇒ comportamiento actual', () => {
  const d = sandbox({ 'docs/decisions/decisions-001-075.md': '', 'docs/decisions/decisions-076-149.md': '',
    'docs/decisions/decisions-150-current.md': VOL, 'decisions.md': IDX_LINES.join('\n') + '\n' });
  try { return { ...exec(d, LINT), esperaCode: 0, esperaMsg: 'ADR-LINT verde (3 ADRs en volumen vivo, reglas estrictas desde ADR-217)' }; }
  finally { rmSync(d, { recursive: true, force: true }); }
});

// ── central#331 (AP-109): duplicados heredados, cita a la propia ADR, frontera
// anfitriona = propia ADR y --append-only-vs ─────────────────────────────────
const DIR_CFG = { layout: 'dir', dir: ADRD, index: 'decisions.md', strictFrom: 1, extraSources: [] };
const idxDe = ns => ns.map(n => `- [ADR-${n}](${ADRD}/ADR-00${n}.md) — ADR ${n}`).join('\n') + '\n';
const dirRepo = (adrs, { cfg = {}, idx, extra = {} } = {}) => sandbox({
  'adr-lint.config.json': { ...DIR_CFG, ...cfg }, 'decisions.md': idx ?? idxDe(Object.keys(adrs).map(Number)),
  ...Object.fromEntries(Object.entries(adrs).map(([n, t]) => [F(n), t])), ...extra });
const conDir = (args, fn) => () => { const d = args(); try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const ADR2_DUP = adr(2, 'Dos (A)') + adr(2, 'Dos (B, heredada)');
const DIR_BASE = { 1: adr(1, 'Uno'), 3: adr(3, 'Tres') };

// (i) duplicado declarado ⇒ verde; no declarado ⇒ rojo (volúmenes y dir).
casos.push({ r: run('(i) volúmenes · duplicado declarado en duplicadosHeredados ⇒ verde', { vol: VOL + adr(2, 'Dos (heredada)'), cfg: { ...CFG, duplicadosHeredados: [2] } }), esperaCode: 0 });
casos.push({ r: run('(i) volúmenes · duplicado NO declarado ⇒ rojo', { vol: VOL + adr(2, 'Dos (heredada)') + adr(3, 'Tres (heredada)'), cfg: { ...CFG, duplicadosHeredados: [2] } }),
  esperaCode: 1, esperaMsg: 'ADR duplicado(s) en el volumen vivo: 3' });
caso('(i) dir · duplicado declarado ⇒ verde', conDir(() => dirRepo({ ...DIR_BASE, 2: ADR2_DUP }, { cfg: { duplicadosHeredados: [2] } }),
  d => ({ ...exec(d, LINT), esperaCode: 0, esperaMsg: 'layout dir: 3 ficheros' })));
caso('(i) dir · duplicado NO declarado ⇒ rojo', conDir(() => dirRepo({ ...DIR_BASE, 2: ADR2_DUP }),
  d => ({ ...exec(d, LINT), esperaCode: 1, esperaMsg: 'ADR duplicado(s) en docs/decisions/adr: 2' })));
caso('(i) dir · entrada de índice repetida de un número declarado ⇒ verde (1c no lo informa)', conDir(() => dirRepo({ ...DIR_BASE, 2: ADR2_DUP }, { cfg: { duplicadosHeredados: [2] }, idx: idxDe([1, 2, 2, 3]) }),
  d => ({ ...exec(d, LINT), esperaCode: 0 })));
caso('(i) config · duplicadosHeredados que no es lista de números ⇒ error (exit 2)', conDir(() => dirRepo(DIR_BASE, { cfg: { duplicadosHeredados: '2' } }),
  d => ({ ...exec(d, LINT), esperaCode: 2, esperaMsg: 'duplicadosHeredados "2" no es una lista' })));
// En volúmenes (sin parser): un número suelto era TypeError (exit 1) y una cadena se ignoraba sin aviso.
for (const [v, txt] of [[2, '2'], ['2', '"2"'], [['2'], '["2"]']])
  casos.push({ r: run(`(i) volúmenes · duplicadosHeredados: ${txt} ⇒ error de config (exit 2)`, { vol: VOL + adr(2, 'Dos (heredada)'), cfg: { ...CFG, duplicadosHeredados: v } }),
    esperaCode: 2, esperaMsg: `ADR-LINT ERROR: adr-lint.config.json: duplicadosHeredados ${txt} no es una lista` });

// (i') rectificación a un número duplicado: no atribuible sin override; con override, colocada.
const RECT_DUP = '### ADR-002·R·1 (2026-07-01) — de cuál de las dos ADR-2\n\nLínea.\n\n';
const DUP_VOL = ['## ADR-1 — Uno', '', 'Texto.', '', '## ADR-2 — Dos (A)', '', 'Texto A.', '', '## ADR-2 — Dos (B, heredada)', '', 'Texto B.', '',
  '### ADR-2·R·1 (2026-07-01) — de cuál de las dos ADR-2', '', 'Línea.', ''].join('\n');
const dupMig = (extra = {}) => sandbox({ 'docs/decisions/v1.md': DUP_VOL, 'docs/decisions/v2.md': '',
  'adr-lint.config.json': { ...MIG_CFG, duplicadosHeredados: [2] }, ...extra });
caso("(i') adr-migrate · rectificación a número duplicado sin override ⇒ no atribuible (exit 1)", conDir(() => dupMig(), d => {
  const m = exec(d, V('adr-migrate.mjs'));
  const rep = JSON.parse(R_(d, 'docs/decisions/adr-no-atribuibles.json'));
  if (rep.entradas.length !== 1 || rep.entradas[0].colocada || !/número duplicado declarado/.test(rep.entradas[0].motivo)) return { code: -1, out: m.out + JSON.stringify(rep), esperaCode: 1 };
  return { ...m, esperaCode: 1, esperaMsg: '1 rectificación(es) no atribuibles sin override' };
}));
caso("(i') adr-migrate · con override «ADR-002·R·1» ⇒ colocada y resuelta en el informe; lint dir verde", conDir(() => dupMig({ 'adr-migrate.overrides.json': { 'ADR-002·R·1': 'ADR-002' } }), d => {
  const m = exec(d, V('adr-migrate.mjs'));
  if (m.code !== 0) return { ...m, esperaCode: 0 };
  const rep = JSON.parse(R_(d, 'docs/decisions/adr-no-atribuibles.json'));
  if (!R_(d, F(2)).includes('### ADR-002·R·1 (2026-07-01)') || rep.entradas[0]?.resolucion !== 'ADR-002') return { code: -1, out: JSON.stringify(rep), esperaCode: 0 };
  W(d, 'adr-lint.config.json', JSON.stringify({ ...MIG_CFG, layout: 'dir', index: 'decisions.md', duplicadosHeredados: [2] }));
  W(d, 'decisions.md', idxDe([1, 2]));
  return { ...exec(d, LINT), esperaCode: 0, esperaMsg: 'layout dir: 2 ficheros, 1 rectificaciones' };
}));
caso("(i') override por CLAVE que renumera ⇒ adr-migrate la coloca como R·5 y lint dir la reconoce por el informe (verde)", conDir(() => dupMig({ 'adr-migrate.overrides.json': {
  'docs/decisions/v1.md#### ADR-2·R·1 (2026-07-01) — de cuál de las dos ADR-2#1': 'ADR-002·R·5' } }), d => {
  const m = exec(d, V('adr-migrate.mjs'));
  if (m.code !== 0 || !R_(d, F(2)).includes('### ADR-002·R·5 (2026-07-01)')) return { ...m, code: m.code || -1, esperaCode: 0 };
  W(d, 'adr-lint.config.json', JSON.stringify({ ...MIG_CFG, layout: 'dir', index: 'decisions.md', duplicadosHeredados: [2] }));
  W(d, 'decisions.md', idxDe([1, 2]));
  const ok = exec(d, LINT);
  if (ok.code !== 0) return { ...ok, esperaCode: 0 };
  // Control: sin el informe, la misma rectificación queda sin fijar.
  rmSync(join(d, 'docs/decisions/adr-no-atribuibles.json'));
  return { ...exec(d, LINT), esperaCode: 1, esperaMsg: 'ADR-2·R·5 en el fichero de ADR-002, número duplicado declarado' };
}));
caso("(i') lint dir · fichero de número duplicado con rectificación sin override ⇒ rojo", conDir(() => dirRepo({ ...DIR_BASE, 2: ADR2_DUP + RECT_DUP }, { cfg: { duplicadosHeredados: [2] } }),
  d => ({ ...exec(d, LINT), esperaCode: 1, esperaMsg: 'ADR-2·R·1 en el fichero de ADR-002, número duplicado declarado (duplicadosHeredados): atribución ambigua sin override' })));
caso("(i') lint dir · con override «ADR-002·R·1» ⇒ verde", conDir(() => dirRepo({ ...DIR_BASE, 2: ADR2_DUP + RECT_DUP }, { cfg: { duplicadosHeredados: [2] }, extra: { 'adr-migrate.overrides.json': { 'ADR-002·R·1': 'ADR-002' } } }),
  d => ({ ...exec(d, LINT), esperaCode: 0 })));

// (ii) regla 2 en dir: bloque = el del parser.
const FUENTE = 'Durante el arrastre, solo se mueve la pastilla y su lectura; nada se recalcula hasta soltar.';
const adr3Fuente = adr(3, 'Tres').replace('Texto.', `Texto.\n\n**D3.** ${FUENTE}`);
const rectCita = q => `### ADR-003·R·1 (2026-07-01) — precisa D3\n\nSegún ADR-3 D3, verbatim:\n«${q}»\n\n`;
caso('(ii) dir · rectificación que cita su propia ADR (mismo fichero) ⇒ verde', conDir(() => dirRepo({ 1: adr(1, 'Uno'), 3: adr3Fuente + rectCita(FUENTE) }),
  d => ({ ...exec(d, LINT), esperaCode: 0 })));
caso('(ii) dir · cita atribuida inexistente ⇒ rojo', conDir(() => dirRepo({ 1: adr(1, 'Uno'), 3: adr3Fuente + rectCita('Durante el arrastre se recalcula todo el modelo en cada fotograma, sin esperar a soltar.') }),
  d => ({ ...exec(d, LINT), esperaCode: 1, esperaMsg: 'ADR-3: cita atribuida NO existe fuera del propio bloque: «Durante el arrastre se recalcula' })));
caso('(ii) dir · cita que solo existe en la propia rectificación ⇒ rojo (auto-validación cerrada)', conDir(() => dirRepo({ 1: adr(1, 'Uno'), 3: adr(3, 'Tres') + rectCita(FUENTE) }),
  d => ({ ...exec(d, LINT), esperaCode: 1, esperaMsg: 'cita atribuida NO existe fuera del propio bloque' })));

// (iii) adr-migrate · rectificación insertada a mitad del cuerpo de su ADR ⇒ frontera anotada.
const MID_VOL = ['## ADR-1 — Uno', '', 'Texto de uno, cortado.', '',
  '### ADR-1·R·1 (2026-02-01) — insertada a mitad', '', 'Línea de la rectificación.', '',
  '**Contexto.** Resto de ADR-1.', '', '**Decisión.** Resto de ADR-1.', '', '**Coste de revertir.** Bajo.', '',
  '## ADR-2 — Dos', '', '**Contexto.** c', '', '**Decisión.** d', '', '**Coste de revertir.** Bajo.', '',
  '### ADR-2·R·1 (2026-03-01) — al final, bien puesta', '', '**Decisión del propietario** (verbatim): sí.', '', '**Contexto.** x', ''].join('\n');
caso('(iii) adr-migrate · rectificación a mitad de su ADR ⇒ frontera anotada (solo esa)', conDir(() => sandbox({ 'docs/decisions/v1.md': MID_VOL, 'docs/decisions/v2.md': '', 'adr-lint.config.json': MIG_CFG }), d => {
  const m = exec(d, V('adr-migrate.mjs'));
  const inf = R_(d, 'docs/decisions/adr-migracion.md');
  const sec = inf.slice(inf.indexOf('## Fronteras a confirmar: anfitriona = la propia ADR'));
  const bad = [];
  if (!inf.includes('## Fronteras a confirmar: anfitriona = la propia ADR')) bad.push('falta la sección');
  if (!/- ADR-001·R·1 \(`docs\/decisions\/v1\.md:5`, tras ADR-001 en `docs\/decisions\/v1\.md:1`\) lleva «Contexto», «Decisión», «Coste de revertir»/.test(sec)) bad.push('falta la línea de ADR-001·R·1');
  if (sec.includes('ADR-002·R·1')) bad.push('anota ADR-002·R·1, cuya ADR sí tiene secciones');
  return { code: bad.length ? -1 : m.code, out: m.out + '\n' + bad.join('\n') + '\n' + inf, esperaCode: 0, esperaMsg: '1 frontera(s) a confirmar' };
}));

// (iv) --append-only-vs <ref>.
const AO = { 1: adr(1, 'Uno'), 2: adr(2, 'Dos'), 3: adr(3, 'Tres') };
const aoRepo = () => { const d = dirRepo(AO); git(d, 'init', '-q'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'corte'); git(d, 'tag', 'corte'); return d; };
const ao = (nombre, mut, espera) => caso(`(iv) --append-only-vs · ${nombre}`, conDir(aoRepo, d => {
  const ctl = exec(d, LINT, ['--append-only-vs', 'corte']);
  if (ctl.code !== 0) return { ...ctl, esperaCode: 0 };                       // control: sin mutación, verde
  mut(d);
  return { ...exec(d, LINT, ['--append-only-vs', 'corte']), ...espera };
}));
const commit = (d, msg) => { git(d, 'add', '-A'); git(d, 'commit', '-qm', msg); };
ao('añadir una rectificación al final ⇒ verde', d => W(d, F(2), R_(d, F(2)) + '### ADR-002·R·1 (2026-07-01) — nueva\n\nLínea.\n'),
  { esperaCode: 0, esperaMsg: '3 fichero(s) de corte conservados como prefijo' });
ao('insertar en medio ⇒ rojo', d => sub(d, F(2), 'Texto.\n', 'Texto.\n\n### ADR-002·R·1 (2026-07-01) — a mitad\n\nLínea.\n'),
  { esperaCode: 1, esperaMsg: `${F(2)}:5: el contenido de corte ya no es prefijo` });
ao('editar una línea ⇒ rojo', d => sub(d, F(3), '**Coste de revertir.** Bajo.', '**Coste de revertir.** Alto.'),
  { esperaCode: 1, esperaMsg: `${F(3)}:7: el contenido de corte ya no es prefijo` });
ao('override en el mensaje exime solo esa ADR ⇒ la otra editada sigue en rojo', d => {
  sub(d, F(1), 'Texto.', 'Texto corregido.'); sub(d, F(2), 'Texto.', 'Texto corregido.');
  commit(d, 'corrige ADR-1\n\nadr-append-override: ADR-001 — errata en el título, autorizada por el propietario');
}, { esperaCode: 1, esperaMsg: `${F(2)}:3: el contenido de corte ya no es prefijo` });
ao('override en el mensaje ⇒ la ADR eximida no da rojo y consta en la salida', d => {
  sub(d, F(1), 'Texto.', 'Texto corregido.');
  commit(d, 'corrige ADR-1\n\nadr-append-override: ADR-001 — errata en el título, autorizada por el propietario');
}, { esperaCode: 0, esperaMsg: 'ADR-001 — errata en el título, autorizada por el propietario' });
ao('fichero nuevo ⇒ verde', d => W(d, F(4), adr(4, 'Cuatro')), { esperaCode: 0, esperaMsg: '(4 en el árbol)' });
ao('borrado ⇒ rojo', d => rmSync(join(d, F(3))), { esperaCode: 1, esperaMsg: `${F(3)}: borrado (existía en corte)` });

// (vi) --append-only-vs con líneas `**Estado:**` enmascaradas (central#334, AP-110).
// ADR-2 lleva Estado en la ADR (línea 3) y en su rectificación (línea 13).
const adrE = (n, t) => `## ADR-${n} — ${t}\n\n**Estado:** Propuesta\n\nTexto.\n\n**Alternativas descartadas.** Ninguna.\n\n**Coste de revertir.** Bajo.\n\n` +
  `### ADR-00${n}·R·1 (2026-09-01) — primera\n\n**Estado:** Vigente\n\nLínea.\n`;
const estRepo = () => { const d = dirRepo({ 1: adr(1, 'Uno'), 2: adrE(2, 'Dos') }); git(d, 'init', '-q'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'corte'); git(d, 'tag', 'corte'); return d; };
const aoE = (nombre, mut, espera) => caso(`(vi) --append-only-vs · Estado · ${nombre}`, conDir(estRepo, d => {
  const ctl = exec(d, LINT, ['--append-only-vs', 'corte']);
  if (ctl.code !== 0) return { ...ctl, esperaCode: 0 };
  mut(d);
  return { ...exec(d, LINT, ['--append-only-vs', 'corte']), ...espera };
}));
const ESTADO_ROJO = 'línea **Estado:** añadida, quitada o movida en el tramo de corte';
aoE('(a) cambio de texto de un Estado existente ⇒ verde sin override', d => {
  sub(d, F(2), '**Estado:** Propuesta', '**Estado:** Implementada (PR #12)'); sub(d, F(2), '**Estado:** Vigente', '**Estado:** Derogada por R·2');
}, { esperaCode: 0, esperaMsg: '1 con cambio de texto en una línea **Estado:** (exento, AP-110)' });
aoE('(b) cambio de Estado + rectificación añadida al final ⇒ verde', d => {
  sub(d, F(2), '**Estado:** Vigente', '**Estado:** Rectificada por R·2');
  W(d, F(2), R_(d, F(2)) + '\n### ADR-002·R·2 (2026-10-01) — nueva\n\n**Estado:** Vigente\n\nOtra.\n');
}, { esperaCode: 0, esperaMsg: '2 fichero(s) de corte conservados como prefijo (2 en el árbol). 1 con cambio de texto en una línea **Estado:** (exento, AP-110)' });
aoE('(c) Estado nuevo insertado en medio ⇒ rojo', d => sub(d, F(2), 'Texto.\n', 'Texto.\n**Estado:** Nuevo\n'),
  { esperaCode: 1, esperaMsg: `${F(2)}:6: ${ESTADO_ROJO}` });
aoE('(d) Estado eliminado ⇒ rojo', d => sub(d, F(2), '**Estado:** Vigente\n\n', ''),
  { esperaCode: 1, esperaMsg: `${F(2)}:13: ${ESTADO_ROJO}` });
aoE('(d\') Estado movido ⇒ rojo', d => sub(d, F(2), '**Estado:** Propuesta\n\nTexto.', 'Texto.\n\n**Estado:** Propuesta'),
  { esperaCode: 1, esperaMsg: `${F(2)}:3: ${ESTADO_ROJO}` });
aoE('(e) línea normal convertida en Estado ⇒ rojo', d => sub(d, F(2), 'Texto.', '**Estado:** Texto.'),
  { esperaCode: 1, esperaMsg: `${F(2)}:5: ${ESTADO_ROJO}` });
aoE('(f) otra línea cambiada junto a un cambio de Estado ⇒ rojo', d => {
  sub(d, F(2), '**Estado:** Propuesta', '**Estado:** Implementada'); sub(d, F(2), '**Coste de revertir.** Bajo.', '**Coste de revertir.** Alto.');
}, { esperaCode: 1, esperaMsg: `${F(2)}:9: el contenido de corte ya no es prefijo` });
aoE('(f\') Estado con otra línea cambiada, con override ⇒ verde y consta', d => {
  sub(d, F(2), '**Estado:** Propuesta', '**Estado:** Implementada'); sub(d, F(2), 'Línea.', 'Línea corregida.');
  commit(d, 'corrige ADR-2\n\nadr-append-override: ADR-002 — errata autorizada');
}, { esperaCode: 0, esperaMsg: 'ADR-002 — errata autorizada' });
aoE('(h) solo se quita el \\n final ⇒ rojo (no cuenta como Estado)', d => W(d, F(2), R_(d, F(2)).slice(0, -1)),
  { esperaCode: 1, esperaMsg: `${F(2)}:16: el contenido de corte ya no es prefijo` });
aoE('(h\') cambio de Estado + \\n final quitado ⇒ rojo', d => {
  sub(d, F(2), '**Estado:** Propuesta', '**Estado:** Implementada'); W(d, F(2), R_(d, F(2)).slice(0, -1));
}, { esperaCode: 1, esperaMsg: `${F(2)}:16: el contenido de corte ya no es prefijo` });

caso('(iv) --append-only-vs · <ref> ilegible ⇒ exit 2', conDir(aoRepo, d => ({ ...exec(d, LINT, ['--append-only-vs', 'no-existe']), esperaCode: 2, esperaMsg: 'ilegible' })));
caso('(iv) --append-only-vs · layout "volumes" ⇒ exit 2', () => {
  const d = idsRepo();
  try { return { ...exec(d, LINT, ['--append-only-vs', 'HEAD']), esperaCode: 2, esperaMsg: 'solo aplica con layout "dir"' }; }
  finally { rmSync(d, { recursive: true, force: true }); }
});

// (v) wmcb: volúmenes sin claves nuevas ⇒ salida idéntica a la de antes de central#331
// (literal capturado con el adr-lint de 997d568 sobre estos mismos fixtures).
const V5_ROJO = 'ADR-LINT ROJO:\n - ADR duplicado(s) en el volumen vivo: 2\n - ADR-4: cita atribuida NO existe fuera del propio bloque: ' +
  '«Durante el arrastre largo, solo se mueve la pastilla y su lectura; nada se recalcula hasta…»\n';
casos.push({ r: run('(v) volúmenes sin claves nuevas · verde ⇒ salida idéntica'), esperaCode: 0,
  esperaMsg: 'ADR-LINT verde (3 ADRs en volumen vivo, reglas estrictas desde ADR-1).\n' });
casos.push({ r: run('(v) volúmenes sin claves nuevas · duplicado + cita propia ⇒ salida idéntica (rojo)', { vol: VOL.replace('Texto.', `Texto. ${FUENTE}`) + adr(2, 'Dos (heredada)') + adr(4, 'Cuatro').replace('Texto.', `Según ADR-1:\n«${FUENTE.replace('arrastre', 'arrastre largo')}»`),
  idx: [...IDX_LINES, '- [ADR-4](x) — Cuatro'].join('\n') + '\n' }), esperaCode: 1, esperaMsg: V5_ROJO });

let rojo = 0;
for (const { r, esperaCode, esperaMsg } of casos) {
  const okCode = r.code === esperaCode;
  const okMsg = !esperaMsg || r.out.includes(esperaMsg);
  if (okCode && okMsg) { console.log(`  ✔ ${r.nombre}`); continue; }
  rojo++;
  console.error(`  ✘ ${r.nombre}: exit ${r.code} (esperado ${esperaCode})${esperaMsg && !okMsg ? `, falta mensaje «${esperaMsg}»` : ''}`);
  console.error(r.out.split('\n').map(l => '      ' + l).join('\n'));
}
if (rojo) { console.error(`check-adr-lint ROJO: ${rojo}/${casos.length} casos.`); process.exit(1); }
console.log(`check-adr-lint verde: ${casos.length} casos sobre vendored/scripts/adr-{lint,migrate,equiv,index}.mjs.`);
