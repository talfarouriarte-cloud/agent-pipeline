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
// Segunda parte (central#325, AP-106): casos (a)–(h) del ruling sobre
// `--ids-vs`, adr-migrate, adr-equiv, adr-index y `layout: "dir"`. Fixtures
// SINTÉTICOS con los formatos de cabecera medidos (finplan `ADR-N · Rectificación k`,
// `ADR-N·R·k`, `Rectificación R·k`; wmcb `Revisión R·k`), nunca el registro real.
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

// (c)–(g): volúmenes con los cuatro formatos y rectificaciones lejos de su ADR.
const MIG_CFG = { volumes: ['docs/decisions/v1.md', 'docs/decisions/v2.md'], dir: 'docs/decisions/adr', index: 'docs/decisions/adr/INDEX.md', strictFrom: 1000, extraSources: [] };
const MV1 = ['# Volumen 1', '', '## ADR-1 (2026-01-01) — Uno', '', 'Texto de uno.', '',
  '### Rectificación R·1 (2026-02-01) — sin ADR en la cabecera, dentro de su bloque', '', 'Línea de ADR-1·R·1.', '',
  '## ADR-2 — Dos', '', '**Fecha:** 2026-01-05', '', 'Texto de dos.', '',
  '### Revisión R·1 (2026-03-01, issue #9) — formato wmcb', '', 'Línea de ADR-2·R·1.', '#### Sub-sección de la revisión', 'Línea honda de ADR-2·R·1.', ''].join('\n');
const MV2 = ['## ADR-3 (2026-01-10) — Tres, que aloja rectificaciones ajenas', '', 'Texto de tres.', '',
  '### ADR-1 · Rectificación 2 (2026-04-01) — lejos de su ADR, formato largo', '', 'Línea de ADR-1·R·2.', '',
  '### ADR-2·R·2 — lejos, formato corto (2026-05-01)', '', 'Línea de ADR-2·R·2.', '',
  '## ADR-4 (2026-01-20) — Cuatro', '', 'Texto de cuatro.', ''].join('\n');
const migRepo = (v2 = MV2) => sandbox({ 'docs/decisions/v1.md': MV1, 'docs/decisions/v2.md': v2, 'adr-lint.config.json': MIG_CFG });
const snap = d => { const a = join(d, 'docs/decisions/adr'); return readdirSync(a).sort().map(f => f + '\n' + R_(d, 'docs/decisions/adr/' + f)).join('\n@@\n') + R_(d, 'docs/decisions/adr-no-atribuibles.json'); };
caso('(c) migración: cuatro formatos y rectificación lejos de su ADR ⇒ cada una en su fichero (equiv, index, lint dir verdes)', () => {
  const d = migRepo();
  try {
    const m = exec(d, V('adr-migrate.mjs'));
    if (m.code !== 0) return { ...m, esperaCode: 0 };
    const f1 = R_(d, 'docs/decisions/adr/ADR-001.md'), f2 = R_(d, 'docs/decisions/adr/ADR-002.md'), f3 = R_(d, 'docs/decisions/adr/ADR-003.md');
    const want1 = ['### ADR-001·R·1 (2026-02-01) — sin ADR en la cabecera, dentro de su bloque', '### ADR-001·R·2 (2026-04-01) — lejos de su ADR, formato largo'];
    const want2 = ['### ADR-002·R·1 (2026-03-01, issue #9) — formato wmcb', '### ADR-002·R·2 (2026-05-01) — lejos, formato corto'];
    const heads = t => t.split('\n').filter(l => /^### /.test(l));
    const bad = [];
    if (JSON.stringify(heads(f1)) !== JSON.stringify(want1)) bad.push('ADR-001.md: ' + JSON.stringify(heads(f1)));
    if (JSON.stringify(heads(f2)) !== JSON.stringify(want2)) bad.push('ADR-002.md: ' + JSON.stringify(heads(f2)));
    if (heads(f3).length || !f3.includes('Texto de tres.')) bad.push('ADR-003.md conserva rectificaciones ajenas o pierde su texto');
    if (!f2.includes('#### Sub-sección de la revisión\nLínea honda de ADR-2·R·1.')) bad.push('la sub-sección H4 no viajó con su revisión');
    if (bad.length) return { code: -1, out: bad.join('\n'), esperaCode: 0 };
    const e = exec(d, V('adr-equiv.mjs'));
    if (e.code !== 0) return { ...e, esperaCode: 0 };
    const i = exec(d, V('adr-index.mjs'));
    if (i.code !== 0) return { ...i, esperaCode: 0 };
    W(d, 'adr-lint.config.json', JSON.stringify({ ...MIG_CFG, layout: 'dir' }));
    return { ...exec(d, LINT), esperaCode: 0, esperaMsg: 'layout dir: 4 ficheros, 4 rectificaciones' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
caso('(d) «Rectificación R·k» ambigua ⇒ informe de no atribuibles, no colocada (equiv: rojo solo en d)', () => {
  const v2 = MV2.replace('## ADR-4', '### Rectificación R·7 (2026-06-01) — ¿de ADR-3, de ADR-1 o de ADR-2?\n\nLínea ambigua.\n\n## ADR-4');
  const d = migRepo(v2);
  try {
    const m = exec(d, V('adr-migrate.mjs'));
    const rep = JSON.parse(R_(d, 'docs/decisions/adr-no-atribuibles.json'));
    const placed = readdirSync(join(d, 'docs/decisions/adr')).some(f => R_(d, 'docs/decisions/adr/' + f).includes('Línea ambigua.'));
    if (m.code !== 0 || rep.entradas.length !== 1 || rep.entradas[0].colocada || placed || !R_(d, 'docs/decisions/adr-no-atribuibles.md').includes('**pendiente**'))
      return { code: -1, out: m.out + JSON.stringify(rep) + ` colocada=${placed}`, esperaCode: 0 };
    const e = exec(d, V('adr-equiv.mjs'));
    const soloD = /✔ \(a\)/.test(e.out) && /✔ \(b\)/.test(e.out) && /✔ \(c\)/.test(e.out) && /✘ \(d\)/.test(e.out);
    if (!soloD) return { ...e, code: -1, esperaCode: 1 };
    // Resolución humana en el JSON ⇒ se coloca y sigue en el informe, resuelta.
    rep.entradas[0].resolucion = 'ADR-3';
    W(d, 'docs/decisions/adr-no-atribuibles.json', JSON.stringify(rep, null, 2));
    exec(d, V('adr-migrate.mjs'));
    if (!R_(d, 'docs/decisions/adr/ADR-003.md').includes('### ADR-003·R·7 (2026-06-01)')) return { code: -1, out: 'la resolución no colocó la rectificación en ADR-003.md', esperaCode: 0 };
    return { ...exec(d, V('adr-equiv.mjs')), esperaCode: 0, esperaMsg: 'ADR-EQUIV verde' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
caso('(e) adr-migrate dos veces ⇒ salida idéntica', () => {
  const d = migRepo();
  try {
    exec(d, V('adr-migrate.mjs')); const s1 = snap(d);
    const m2 = exec(d, V('adr-migrate.mjs')); const s2 = snap(d);
    return { code: s1 === s2 ? m2.code : -1, out: m2.out, esperaCode: 0, esperaMsg: '0 escritos, 4 sin cambios, 0 borrados' };
  } finally { rmSync(d, { recursive: true, force: true }); }
});
const mutado = (mut, msg) => () => {
  const d = migRepo();
  try { exec(d, V('adr-migrate.mjs')); mut(d); return { ...exec(d, V('adr-equiv.mjs')), esperaCode: 1, esperaMsg: msg }; }
  finally { rmSync(d, { recursive: true, force: true }); }
};
const F = n => `docs/decisions/adr/ADR-00${n}.md`;
caso('(f) adr-equiv: una línea perdida ⇒ rojo', mutado(d => W(d, F(3), R_(d, F(3)).replace('Texto de tres.\n', '')), '- perdida ×1: «Texto de tres.»'));
caso('(f) adr-equiv: una línea duplicada ⇒ rojo', mutado(d => W(d, F(4), R_(d, F(4)) + 'Texto de cuatro.\n'), '+ sobrante ×1: «Texto de cuatro.»'));
caso('(f) adr-equiv: rectificación en fichero ajeno ⇒ rojo', mutado(d => {
  const t2 = R_(d, F(2)), i = t2.indexOf('### ADR-002·R·2');
  W(d, F(2), t2.slice(0, i)); W(d, F(1), R_(d, F(1)) + '\n' + t2.slice(i));
}, 'rectificación ADR-2·R·2 en el fichero de ADR-001'));
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
