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
// Uso: node scripts/adr-lint.mjs   (verde: exit 0; rojo: exit 1 + listado)
import { readFileSync } from 'fs';

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

const errs = [];
const live = readFileSync(LIVE, 'utf8');
// Fuentes citables: los tres volúmenes + spec + convenciones. CRÍTICO:
// al verificar una cita, el bloque que la hace se EXCLUYE del corpus —
// sin esto, toda cita fabricada se auto-valida por existir en el propio
// ADR que la fabrica (agujero cazado en la prueba de fuego del hook).
const EXTRA = cfg.extraSources ?? ['spec.md', 'docs/conventions.md'];
const corpus = [...VOLS, ...EXTRA].map(v => { try { return readFileSync(v, 'utf8'); } catch { return ''; } }).join('\n');
const norm = s => s.replace(/\s+/g, ' ').trim();

// ── 1. Numeración: sin duplicados y sin huecos respecto al índice ──
const headers = [...live.matchAll(/^## ADR-(\d+)\b/gm)].map(m => +m[1]);
const dup = headers.filter((n, i) => headers.indexOf(n) !== i);
if (dup.length) errs.push(`ADR duplicado(s) en el volumen vivo: ${[...new Set(dup)].join(', ')}`);
const idx = readFileSync(INDEX, 'utf8');
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
const allHeaders = new Set();
for (const v of VOLS) {
  try { for (const m of readFileSync(v, 'utf8').matchAll(/^## ADR-(\d+)\b/gm)) allHeaders.add(+m[1]); } catch {}
}
const idxEntries = [...idx.matchAll(/^\s*-\s*\[ADR-(\d+)\][^\n]*$/gm)];
for (const n of new Set(idxEntries.map(m => +m[1]))) {
  if (!allHeaders.has(n)) errs.push(`ADR-${n} en el índice sin cabecera en ningún volumen (¿borrado por blob stale?)`);
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

// ── 2. Citas atribuidas: deben grep-existir en el corpus ──
// Patrón: «...» en una línea que referencia ADR-NNN / spec / R·N.
// Normalización de espacios; se ignoran citas de <8 palabras (términos).
const adrBlocks = live.split(/^## (?=ADR-\d+)/m).slice(1);
for (const block of adrBlocks) {
  const num = +block.match(/^ADR-(\d+)/)[1];
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
for (const block of adrBlocks) {
  const num = +block.match(/^ADR-(\d+)/)[1];
  if (num < STRICT_FROM) continue;
  if (/\*\*Deroga|\*\*Rectifica/.test(block) && !/propietario/i.test(block))
    errs.push(`ADR-${num}: deroga/rectifica sin bloque de decisión del propietario`);
}

// ── 4. Todo ADR nuevo declara Alternativas descartadas y Coste de revertir ──
for (const block of adrBlocks) {
  const num = +block.match(/^ADR-(\d+)/)[1];
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
const ANCHOR = /[\w./-]+\.[A-Za-z0-9]+:\d+(?:-\d+)?/;
for (const block of adrBlocks) {
  const num = +block.match(/^ADR-(\d+)/)[1];
  if (num < STRICT_FROM) continue;
  for (const m of block.matchAll(/^[ \t>*-]*estado-[aá]rbol:\s*(.+)$/gim)) {
    if (!ANCHOR.test(m[1])) errs.push(`ADR-${num}: claim «estado-árbol» sin ancla file:line: «${norm(m[1]).slice(0, 90)}…»`);
  }
}

if (errs.length) { console.error('ADR-LINT ROJO:\n' + errs.map(e => ' - ' + e).join('\n')); process.exit(1); }
console.log(`ADR-LINT verde (${headers.length} ADRs en volumen vivo, reglas estrictas desde ADR-${STRICT_FROM}).`);
