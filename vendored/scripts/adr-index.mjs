#!/usr/bin/env node
// adr-index — índice GENERADO del directorio de un fichero por ADR
// (central#325, AP-106). Vive aquí, vendorizado junto a adr-lint, y no en un
// `generate-toc` porque el central no tiene ninguno: el generador de TOC de
// finplan es suyo (local) y wmcb no tiene; un índice que valida adr-lint (reglas
// 1/1b/1c) tiene que salir del mismo sitio que el lint y del mismo parser.
//
// Por ADR: identificador, título, fecha, nº de rectificaciones, fecha de la
// última y enlace. Formato de lista `- [ADR-NNN](ruta) — …`, el que leen las
// reglas 1/1b/1c de adr-lint.
// «Citada en» (central#336, AP-111): por ADR, las otras ADR y rectificaciones
// cuyo bloque (cabecera o cuerpo) la nombra por identificador (`ADR-N`, también
// dentro de `ADR-N·R·k`), como lista compacta de identificadores sin enlaces.
// Las de la propia ADR (su bloque y sus rectificaciones) no cuentan.
// Destino: con `layout: "dir"`, el `index` de la config; con `layout: "volumes"`
// (paralelo), `<dir>/INDEX.md`, sin tocar el índice a mano vigente. Si el destino
// existe, solo se reescribe lo que hay entre los marcadores `adr-index:inicio` y
// `adr-index:fin`; si existe sin marcadores, error (no se pisa un índice a mano).
// Uso: node scripts/adr-index.mjs [--check] [--out <ruta>]
//   --check: no escribe; exit 1 si el índice difiere de lo regenerado.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, relative, basename } from 'path';
import { loadConfig, parseFiles, dirFiles, pad, bodyText, NORM_RECT } from './adr-registro.mjs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const fail = m => { console.error(`ADR-INDEX ERROR: ${m}`); process.exit(2); };
let cfg;
try { cfg = loadConfig(); } catch (e) { fail(e.message); }
const oi = args.indexOf('--out');
const OUT = oi >= 0 ? args[oi + 1] : (cfg.layout === 'dir' ? cfg.index : join(cfg.dir, 'INDEX.md'));
if (!OUT) fail('--out sin ruta');

const files = dirFiles(cfg.dir);
if (!files.length) fail(`${cfg.dir} no tiene ningún ADR-NNN.md`);
const D = parseFiles(files, cfg);
const ISO = /\d{4}-\d{2}-\d{2}/;

// Citante = el bloque del parser, con el identificador del fichero que lo
// contiene (una rectificación vive en el de su ADR: adr-lint lo exige en `dir`).
const numOf = p => +p.match(/ADR-(\d+)\.md$/)[1];
const citas = new Map();
for (const b of D.blocks) {
  const n = numOf(b.path), id = b.tipo === 'adr' ? `ADR-${pad(n)}` : `ADR-${pad(n)}·R·${b.k}`;
  const orden = [n, b.tipo === 'adr' ? -1 : b.k];
  for (const m of (b.headerRaw + bodyText(b)).matchAll(/\bADR-0*(\d+)\b/g)) {
    const t = +m[1];
    if (t === n) continue;
    if (!citas.has(t)) citas.set(t, new Map());
    citas.get(t).set(id, orden);
  }
}
const citadaEn = n => [...(citas.get(n) ?? new Map())].sort(([, a], [, b]) => a[0] - b[0] || a[1] - b[1]).map(([id]) => id);

const lines = [];
for (const a of [...D.adrs].sort((x, y) => x.n - y.n)) {
  let rest = a.header.replace(/^#+\s*ADR-\d+/, '');
  let fecha = null;
  const m = rest.match(/\(([^()]*)\)/);
  if (m && ISO.test(m[1])) { fecha = m[1].match(ISO)[0]; rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length); }
  if (!fecha) { const f = a.body.find(x => /fecha/i.test(x.t) && ISO.test(x.t)); if (f) fecha = f.t.match(ISO)[0]; }
  const titulo = rest.replace(/^[\s:—–\-·.]+/, '').trim() || '(sin título)';
  const rs = D.rects.filter(r => r.path === a.path).sort((x, y) => x.k - y.k);
  const fechasR = rs.map(r => { const g = r.header.match(NORM_RECT); return g?.[3] && ISO.test(g[3]) ? g[3].match(ISO)[0] : null; }).filter(Boolean).sort();
  const link = relative(dirname(OUT), a.path).split('\\').join('/');
  const nr = rs.length === 1 ? '1 rectificación' : `${rs.length} rectificaciones`;
  const ce = citadaEn(a.n);
  lines.push(`- [ADR-${pad(a.n)}](${link}) — ${titulo} · ${fecha ?? 'sin fecha'} · ${nr}${rs.length ? ` (última: ${fechasR.length ? fechasR[fechasR.length - 1] : 'sin fecha'})` : ''}${ce.length ? ` · citada en: ${ce.join(', ')}` : ''}`);
}

const BEGIN = '<!-- adr-index:inicio — generado por adr-index.mjs, no editar a mano -->';
const END = '<!-- adr-index:fin -->';
const block = [BEGIN, '', ...lines, '', END].join('\n');
let want;
const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
if (cur == null) want = `# Índice de decisiones\n\n${block}\n`;
else {
  const i = cur.indexOf(BEGIN), j = cur.indexOf(END);
  if (i < 0 || j < i) fail(`${OUT} existe y no tiene los marcadores adr-index:inicio/fin — no se pisa un índice a mano`);
  want = cur.slice(0, i) + block + cur.slice(j + END.length);
}

if (CHECK) {
  if (cur === want) { console.log(`ADR-INDEX verde: ${OUT} al día (${lines.length} entradas).`); process.exit(0); }
  const a = new Set((cur ?? '').split('\n')), b = new Set(want.split('\n'));
  const d = [...[...b].filter(l => !a.has(l)).map(l => `  + ${l}`), ...[...a].filter(l => !b.has(l)).map(l => `  - ${l}`)];
  console.error(`ADR-INDEX ROJO: ${OUT} desfasado respecto a ${cfg.dir} (regenera con node scripts/${basename(process.argv[1])}):\n${d.slice(0, 40).join('\n')}`);
  process.exit(1);
}
if (cur !== want) writeFileSync(OUT, want);
console.log(`ADR-INDEX: ${OUT} ${cur === want ? 'sin cambios' : 'escrito'} (${lines.length} entradas).`);
