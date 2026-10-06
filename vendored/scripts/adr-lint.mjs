#!/usr/bin/env node
// adr-lint — hook mecánico contra la clase de fallo «alucinación del
// Architect cae en un ADR» (decisión del propietario 2026-07-10; origen:
// drift-λ, cita «cero re-simulación» fabricada y propagada a 3 issues y
// 4 PRs). Verifica lo verificable; lo semántico queda para el bloque de
// decisión verbatim del propietario y la revisión humana.
// Reglas 1b/1c (índice↔volúmenes, sin duplicados): origen finplan 0e762ba
// (2026-09-07) — un commit repuso el volumen vivo desde un blob anterior,
// borró ADR-243 y la regla 1 (solo volumen→índice) dio verde. Portadas de
// finplan#2009 al fuente vendorizado (AP-084); banco: scripts/check-adr-lint.mjs.
// Modos y layouts nuevos (central#325, AP-106; origen central#322: truncado de
// 137 ADRs en asesoramiento-financiero@32be10a0 por un PUT sobre un volumen de MB):
//  · `--ids-vs <ref>`: multiconjunto de identificadores de ADR y rectificación
//    de TODO el registro en <ref> frente al árbol; rojo si falta alguno. Mover
//    entre volúmenes/ficheros o añadir no es pérdida. <ref> ilegible ⇒ exit 2.
//  · `layout: "dir"` en la config: un `ADR-NNN.md` por ADR con sus
//    rectificaciones dentro; mismas reglas + cabecera normalizada + cada
//    rectificación en el fichero de su ADR.
// Ambos cargan `./adr-registro.mjs` (servido por el graft junto a este fichero);
// la ruta de siempre (volúmenes, sin --ids-vs) no lo necesita.
// Uso: node scripts/adr-lint.mjs [--ids-vs <ref>]   (verde: exit 0; rojo: exit 1 + listado; error: exit 2)
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

// Parametrización por repo (2026-07-11, alta de what-money-cant-buy):
// adr-lint.config.json opcional en la raíz. Sin config, defaults = valores
// históricos del repo de origen (corpus con endurecimiento desde ADR-217).
// Un consumidor nuevo declara strictFrom: 1 — las reglas anti-alucinación
// aplican desde su primer ADR.
let cfg = {};
try { cfg = JSON.parse(readFileSync('adr-lint.config.json', 'utf8')); } catch {}

const VOLS = cfg.volumes ?? ['docs/decisions/decisions-001-075.md',
              'docs/decisions/decisions-076-149.md',
              'docs/decisions/decisions-150-current.md'];
const INDEX = cfg.index ?? 'decisions.md';
const LIVE = VOLS[VOLS.length - 1];
const STRICT_FROM = cfg.strictFrom ?? 217;

// Patrones de cabecera de ADR (`adrHeader`, lista de regex con grupo `adr`).
// El default es el literal de siempre: sin config nueva, mismo comportamiento.
const ADR_RES = (cfg.adrHeader ?? ['^## ADR-(?<adr>\\d+)\\b']).map(src => new RegExp(src, 'gm'));
const adrHeads = text => [...new Map(ADR_RES.flatMap(re => [...text.matchAll(re)].map(m => [m.index, +m.groups.adr]))).entries()]
  .sort((a, b) => a[0] - b[0]).map(([index, n]) => ({ index, n }));
const blocksOf = text => adrHeads(text).map((h, i, hs) => ({ num: h.n, block: text.slice(h.index, hs[i + 1]?.index ?? text.length) }));

const errs = [];
const norm = s => s.replace(/\s+/g, ' ').trim();
const EXTRA = cfg.extraSources ?? ['spec.md', 'docs/conventions.md'];
const ANCHOR = /[\w./-]+\.[A-Za-z0-9]+:\d+(?:-\d+)?/;

const argv = process.argv.slice(2);
if (argv.includes('--ids-vs')) await idsVs(argv[argv.indexOf('--ids-vs') + 1]);
if ((cfg.layout ?? 'volumes') !== 'volumes') await lintDir();

const live = readFileSync(LIVE, 'utf8');
// Fuentes citables: los tres volúmenes + spec + convenciones. CRÍTICO:
// al verificar una cita, el bloque que la hace se EXCLUYE del corpus —
// sin esto, toda cita fabricada se auto-valida por existir en el propio
// ADR que la fabrica (agujero cazado en la prueba de fuego del hook).
const corpus = [...VOLS, ...EXTRA].map(v => { try { return readFileSync(v, 'utf8'); } catch { return ''; } }).join('\n');

// ── 1. Numeración: sin duplicados y sin huecos respecto al índice ──
const headers = adrHeads(live).map(h => h.n);
const dup = headers.filter((n, i) => headers.indexOf(n) !== i);
if (dup.length) errs.push(`ADR duplicado(s) en el volumen vivo: ${[...new Set(dup)].join(', ')}`);
const allHeaders = new Set();
for (const v of VOLS) {
  try { for (const h of adrHeads(readFileSync(v, 'utf8'))) allHeaders.add(h.n); } catch {}
}
indexRules(headers, allHeaders, readFileSync(INDEX, 'utf8'), 'en ningún volumen');

function indexRules(headers, allHeaders, idx, donde) {
for (const n of new Set(headers)) {
  if (!new RegExp(`\\[ADR-0*${n}\\]`).test(idx)) errs.push(`ADR-${n} sin entrada en el índice (decisions.md)`);
}

// ── 1b. Índice → volúmenes: toda entrada del índice tiene cabecera ──
// Simétrica de la regla 1. Sin ella, un commit que reemplace un volumen por
// una copia vieja (blob stale) borra cabeceras que el índice conserva y el
// lint pasa (incidente 0e762ba: ADR-243 desaparecida del volumen vivo, índice
// intacto, regla 1 verde). Con ambas, ese commit falla el lint allí donde el
// lint CORRE (sesión de agente sobre la copia injertada; CI del consumidor
// solo en los caminos que lo invocan — ese gate es del consumidor, no de aquí).
const idxEntries = [...idx.matchAll(/^\s*-\s*\[ADR-(\d+)\][^\n]*$/gm)];
for (const n of new Set(idxEntries.map(m => +m[1]))) {
  if (!allHeaders.has(n)) errs.push(`ADR-${n} en el índice sin cabecera ${donde} (¿borrado por blob stale?)`);
}

// ── 1c. Índice sin duplicados: una entrada por ADR ──
// Una copia stale del índice, o un merge desafortunado, repite una entrada
// idéntica (incidente 0e762ba: ADR-224 dos veces en decisions.md). Se detecta
// la LÍNEA de entrada repetida byte a byte —la firma de la copia stale—. Una
// colisión de numeración entre dos ADR distintos que comparten N (títulos y
// anclas distintos, p.ej. la ADR-144 heredada en un volumen congelado) es otra
// clase de defecto, de contenido y fuera de esta regla mecánica.
const entryCount = new Map();
for (const m of idxEntries) {
  const key = norm(m[0]);
  const rec = entryCount.get(key) ?? { n: +m[1], count: 0 };
  rec.count++; entryCount.set(key, rec);
}
for (const n of [...new Set([...entryCount.values()].filter(r => r.count > 1).map(r => r.n))].sort((a, b) => a - b))
  errs.push(`ADR-${n} duplicado en el índice`);
}

// ── 2. Citas atribuidas: deben grep-existir en el corpus ──
// Patrón: «...» en una línea que referencia ADR-NNN / spec / R·N.
// Normalización de espacios; se ignoran citas de <8 palabras (términos).
const adrBlocks = blocksOf(live);
rulesFrom2(adrBlocks, corpus);

function rulesFrom2(adrBlocks, corpus) {
for (const { num, block } of adrBlocks) {
  if (num < STRICT_FROM) continue;
  for (const m of block.matchAll(/«([^»]{40,})»/g)) {
    const line = block.slice(Math.max(0, m.index - 300), m.index);
    const attributed = /ADR-\d+|§\d|R·\d|spec\.md|verbatim/i.test(line.split('\n').slice(-3).join('\n'));
    if (!attributed) continue;
    const q = norm(m[1]);
    if (/decisión del propietario|propietario, verbatim/i.test(line.split('\n').slice(-4).join('\n'))) continue; // palabras del humano: no viven en el corpus
    const corpusSinBloque = norm(corpus.replace(block, ''));
    if (!corpusSinBloque.includes(q)) errs.push(`ADR-${num}: cita atribuida NO existe fuera del propio bloque: «${q.slice(0, 90)}…»`);
  }
}

// ── 3. Rectificaciones/derogaciones exigen la decisión del propietario verbatim ──
for (const { num, block } of adrBlocks) {
  if (num < STRICT_FROM) continue;
  if (/\*\*Deroga|\*\*Rectifica/.test(block) && !/propietario/i.test(block))
    errs.push(`ADR-${num}: deroga/rectifica sin bloque de decisión del propietario`);
}

// ── 4. Todo ADR nuevo declara Alternativas descartadas y Coste de revertir ──
for (const { num, block } of adrBlocks) {
  if (num < STRICT_FROM) continue;
  for (const sec of ['Alternativas descartadas', 'Coste de revertir'])
    if (!block.includes(sec)) errs.push(`ADR-${num}: falta sección «${sec}»`);
}

// ── 5. Claims de estado-de-árbol MARCADAS exigen ancla file:line ──
// (AP-034) Espejo docs-only de la disciplina de proceso-diseño §Fase 3.
// Toda afirmación sobre estado EXISTENTE del árbol que el Architect marque
// con el token anclado `estado-árbol: <claim> ⇐ <file:line>` debe portar un
// ancla file:line bien formada (`ruta.ext:NN` o rango `:NN-MM`). El lint es
// SINTÁCTICO: fuerza la PRESENCIA del ancla, no que la línea citada sustente
// la claim (eso lo re-verifica el Creator al arrancar; el Auditor es la red).
// Sin marca NO hay red mecánica —el marcado es del Architect (disciplina de
// chat)—; el lint materializa lo marcado, cazando en el CI docs-only lo que
// la disciplina de chat deje pasar (clase de fallo 4: el defecto nace en
// CHAT, invisible al repo hasta que cuesta un relanzamiento — ADR-228 «μ/σ/ρ
// ya se computaban en el loop mensual», FALSO). Anclado a inicio de línea,
// tolera sangría de lista/cita, jamás substring de prosa (clase 6).
for (const { num, block } of adrBlocks) {
  if (num < STRICT_FROM) continue;
  for (const m of block.matchAll(/^[ \t>*-]*estado-[aá]rbol:\s*(.+)$/gim)) {
    if (!ANCHOR.test(m[1])) errs.push(`ADR-${num}: claim «estado-árbol» sin ancla file:line: «${norm(m[1]).slice(0, 90)}…»`);
  }
}
}

if (errs.length) { console.error('ADR-LINT ROJO:\n' + errs.map(e => ' - ' + e).join('\n')); process.exit(1); }
console.log(`ADR-LINT verde (${headers.length} ADRs en volumen vivo, reglas estrictas desde ADR-${STRICT_FROM}).`);

// ── layout "dir": un ADR-NNN.md por ADR con sus rectificaciones dentro ──
// Mismas reglas 1/1b/1c (sobre TODO el directorio: no hay volumen vivo) y 2–5
// (bloque = fichero), más el formato del directorio: el fichero contiene la
// cabecera de SU ADR; cada rectificación lleva la cabecera normalizada
// `### ADR-NNN·R·k (fecha) — título`, nombra la ADR del fichero, no se repite y
// va en orden de k.
async function lintDir() {
  const R = await import('./adr-registro.mjs');
  let c;
  try { c = R.normalizeConfig(cfg); } catch (e) { console.error(`ADR-LINT ERROR: ${e.message}`); process.exit(2); }
  const files = R.dirFiles(c.dir);
  if (!files.length) errs.push(`${c.dir}: ningún ADR-NNN.md (layout "dir")`);
  const P = R.parseFiles(files, c);
  const heads = P.adrs.map(a => a.n);
  const dupD = [...new Set(heads.filter((n, i) => heads.indexOf(n) !== i))];
  if (dupD.length) errs.push(`ADR duplicado(s) en ${c.dir}: ${dupD.join(', ')}`);
  let idxText = '';
  try { idxText = readFileSync(c.index, 'utf8'); } catch { errs.push(`índice ${c.index} ilegible`); }
  indexRules(heads, new Set(heads), idxText, `en ${c.dir}`);
  for (const f of files) {
    const n = +f.path.match(/ADR-(\d+)\.md$/)[1];
    const own = P.adrs.filter(a => a.path === f.path);
    if (!own.some(a => a.n === n)) errs.push(`${f.path}: no contiene la cabecera de ADR-${R.pad(n)}`);
    for (const a of own) if (a.n !== n) errs.push(`${f.path}: contiene la cabecera de ADR-${a.n} (va en su propio fichero)`);
    const rs = P.rects.filter(r => r.path === f.path);
    const seen = new Set();
    let prevK = 0;
    for (const r of rs) {
      const id = `ADR-${r.explicit ?? r.host ?? '?'}·R·${r.k}`;
      if (!R.NORM_RECT.test(r.header)) errs.push(`${f.path}:${r.line}: cabecera de rectificación no normalizada «${r.header.trim()}» (formato: ### ADR-NNN·R·k (fecha) — título)`);
      if ((r.explicit ?? r.host) !== n) errs.push(`${f.path}:${r.line}: ${id} en el fichero de ADR-${R.pad(n)} (cada rectificación va en el fichero de su ADR)`);
      if (r.host == null) errs.push(`${f.path}:${r.line}: ${id} antes de la cabecera de la ADR`);
      if (seen.has(id)) errs.push(`${f.path}:${r.line}: ${id} duplicada`);
      if (r.k < prevK) errs.push(`${f.path}:${r.line}: ${id} fuera de orden (las rectificaciones van por k)`);
      seen.add(id); prevK = Math.max(prevK, r.k);
    }
  }
  const corpusD = [...files.map(f => f.text), ...EXTRA.map(v => { try { return readFileSync(v, 'utf8'); } catch { return ''; } })].join('\n');
  rulesFrom2(files.map(f => ({ num: +f.path.match(/ADR-(\d+)\.md$/)[1], block: f.text })), corpusD);
  if (errs.length) { console.error('ADR-LINT ROJO:\n' + errs.map(e => ' - ' + e).join('\n')); process.exit(1); }
  console.log(`ADR-LINT verde (layout dir: ${files.length} ficheros, ${P.rects.length} rectificaciones en ${c.dir}, reglas estrictas desde ADR-${STRICT_FROM}).`);
  process.exit(0);
}

// ── --ids-vs <ref>: ningún identificador del registro se pierde ──
// (central#322) Un PUT/Contents sobre un volumen de MB que la sesión no leyó
// entero lo trunca (asesoramiento-financiero@32be10a0: 137 ADRs fuera) y las
// reglas 1/1b no lo ven si el índice cae con él. Esto compara el MULTICONJUNTO
// de identificadores (ADR-N y ADR-N·R·k) de todo el registro en <ref> —con la
// config que había en <ref>— contra el árbol actual. Solo falla lo que FALTA:
// mover entre volúmenes o a un ADR-NNN.md, o añadir, es verde.
async function idsVs(ref) {
  const R = await import('./adr-registro.mjs');
  const die = m => { console.error(`ADR-LINT --ids-vs ERROR: ${m}`); process.exit(2); };
  if (!ref || ref.startsWith('--')) die('falta <ref> (uso: adr-lint.mjs --ids-vs <ref>)');
  const git = a => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch { die(`<ref> «${ref}» ilegible (no resuelve a un commit)`); }
  let rawRef = cfg;
  try { rawRef = JSON.parse(git(['show', `${ref}:adr-lint.config.json`])); } catch {}
  let cRef, cNow;
  try { cRef = R.normalizeConfig(rawRef); cNow = R.normalizeConfig(cfg); } catch (e) { die(e.message); }
  const at = c => c.layout === 'dir'
    ? git(['ls-tree', '--name-only', ref, '--', c.dir + '/']).split('\n').filter(p => /\/ADR-\d+\.md$/.test(p)).sort()
    : c.volumes;
  const refFiles = [];
  for (const p of at(cRef)) { try { refFiles.push({ path: p, text: git(['show', `${ref}:${p}`]) }); } catch {} }
  if (!refFiles.length) die(`el registro no se puede leer en «${ref}» (${cRef.layout === 'dir' ? cRef.dir : cRef.volumes.join(', ')})`);
  const nowFiles = cNow.layout === 'dir' ? R.dirFiles(cNow.dir)
    : cNow.volumes.flatMap(p => { try { return [{ path: p, text: readFileSync(p, 'utf8') }]; } catch { return []; } });
  // Las resoluciones del informe de no atribuibles (árbol actual) valen para
  // los dos lados: una «Rectificación R·k» resuelta a otra ADR no es pérdida.
  const res = R.loadResoluciones(cNow);
  const before = R.idsOf(R.parseFiles(refFiles, cRef), res), after = R.idsOf(R.parseFiles(nowFiles, cNow), res);
  const lost = [...before].filter(([id, n]) => (after.get(id) ?? 0) < n)
    .map(([id, n]) => (after.get(id) ?? 0) ? `${id} (${n} → ${after.get(id)})` : id)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const tot = m => [...m.values()].reduce((a, b) => a + b, 0);
  if (lost.length) {
    console.error(`ADR-LINT --ids-vs ${ref} ROJO: ${lost.length} identificador(es) del registro perdidos (${tot(before)} en ${ref}, ${tot(after)} en el árbol):\n` +
      lost.map(i => ' - ' + i).join('\n') + `\nRestaura el registro desde ${ref} y avisa al humano (protocol.md § Escritura del registro de decisiones).`);
    process.exit(1);
  }
  console.log(`ADR-LINT --ids-vs ${ref} verde: ningún identificador perdido (${tot(before)} en ${ref}, ${tot(after)} en el árbol).`);
  process.exit(0);
}
