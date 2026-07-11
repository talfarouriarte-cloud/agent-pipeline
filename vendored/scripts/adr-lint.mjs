#!/usr/bin/env node
// adr-lint — hook mecánico contra la clase de fallo «alucinación del
// Architect cae en un ADR» (decisión del propietario 2026-07-10; origen:
// drift-λ, cita «cero re-simulación» fabricada y propagada a 3 issues y
// 4 PRs). Verifica lo verificable; lo semántico queda para el bloque de
// decisión verbatim del propietario y la revisión humana.
// Uso: node scripts/adr-lint.mjs   (verde: exit 0; rojo: exit 1 + listado)
import { readFileSync } from 'fs';

const VOLS = ['docs/decisions/decisions-001-075.md',
              'docs/decisions/decisions-076-149.md',
              'docs/decisions/decisions-150-current.md'];
const INDEX = 'decisions.md';
const LIVE = VOLS[2];
// Las reglas 2-4 (citas, verbatim del propietario) aplican desde el
// endurecimiento (ADR-217+); el corpus anterior es histórico.
const STRICT_FROM = 217;

const errs = [];
const live = readFileSync(LIVE, 'utf8');
// Fuentes citables: los tres volúmenes + spec + convenciones. CRÍTICO:
// al verificar una cita, el bloque que la hace se EXCLUYE del corpus —
// sin esto, toda cita fabricada se auto-valida por existir en el propio
// ADR que la fabrica (agujero cazado en la prueba de fuego del hook).
const EXTRA = ['spec.md', 'docs/conventions.md'];
const corpus = [...VOLS, ...EXTRA].map(v => { try { return readFileSync(v, 'utf8'); } catch { return ''; } }).join('\n');
const norm = s => s.replace(/\s+/g, ' ').trim();

// ── 1. Numeración: sin duplicados y sin huecos respecto al índice ──
const headers = [...live.matchAll(/^## ADR-(\d+)\b/gm)].map(m => +m[1]);
const dup = headers.filter((n, i) => headers.indexOf(n) !== i);
if (dup.length) errs.push(`ADR duplicado(s) en el volumen vivo: ${[...new Set(dup)].join(', ')}`);
const idx = readFileSync(INDEX, 'utf8');
for (const n of new Set(headers)) {
  if (!new RegExp(`\\[ADR-${n}\\]`).test(idx)) errs.push(`ADR-${n} sin entrada en el índice (decisions.md)`);
}

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

if (errs.length) { console.error('ADR-LINT ROJO:\n' + errs.map(e => ' - ' + e).join('\n')); process.exit(1); }
console.log(`ADR-LINT verde (${headers.length} ADRs en volumen vivo, reglas estrictas desde ADR-${STRICT_FROM}).`);
