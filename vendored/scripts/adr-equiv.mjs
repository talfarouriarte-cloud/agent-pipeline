#!/usr/bin/env node
// adr-equiv — el «punteo» mecánico entre los volúmenes y el directorio de un
// fichero por ADR (central#325, AP-106). Mientras dure el paralelo, los
// volúmenes mandan y el directorio es salida de adr-migrate; esto certifica que
// el directorio dice lo mismo, línea a línea:
//   (a) mismo conjunto de identificadores (ADRs y rectificaciones);
//   (b) mismo multiconjunto de líneas no-cabecera (sin líneas en blanco): una
//       línea de más o de menos ⇒ rojo, con el diff y su ubicación;
//   (c) toda rectificación está en el fichero de SU ADR, con cabecera normalizada;
//   (d) el informe de no atribuibles está vacío o resuelto.
// Las líneas de las rectificaciones no atribuibles se descuentan de (b) y se
// cargan en (d): así «verde salvo los no atribuibles» se lee de un vistazo.
// Uso: node scripts/adr-equiv.mjs   (verde: exit 0; rojo: exit 1; error: exit 2)
import { basename } from 'path';
import { loadConfig, readVolumes, parseFiles, attribute, loadResoluciones, dirFiles, NORM_RECT, pad } from './adr-registro.mjs';

const fail = m => { console.error(`ADR-EQUIV ERROR: ${m}`); process.exit(2); };
let cfg, vols;
try { cfg = loadConfig(); } catch (e) { fail(e.message); }
try { vols = readVolumes(cfg); } catch (e) { fail(`no se puede leer un volumen: ${e.message}`); }
const files = dirFiles(cfg.dir);
if (!files.length) fail(`${cfg.dir} no tiene ningún ADR-NNN.md (¿falta correr adr-migrate?)`);

const P = parseFiles(vols, cfg);
const { placed, entries } = attribute(P, loadResoluciones(cfg));
const D = parseFiles(files, cfg);
const MAX = 40;
const res = [];
const check = (tag, title, problems) => res.push({ tag, title, problems });
const show = arr => arr.length > MAX ? [...arr.slice(0, MAX), `… y ${arr.length - MAX} más`] : arr;

// (a) identificadores
const idsExp = new Set([...P.adrs.map(a => `ADR-${a.n}`), ...placed.map(e => `ADR-${e.target}·R·${e.r.k}`)]);
const idsAct = new Set([...D.adrs.map(a => `ADR-${a.n}`), ...D.rects.map(r => `ADR-${r.explicit ?? r.host ?? '?'}·R·${r.k}`)]);
const sortIds = a => a.sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
check('a', 'identificadores', [
  ...sortIds([...idsExp].filter(i => !idsAct.has(i))).map(i => `falta en el directorio: ${i}`),
  ...sortIds([...idsAct].filter(i => !idsExp.has(i))).map(i => `sobra en el directorio: ${i}`)]);

// (b) multiconjunto de líneas no-cabecera
const ms = new Map();
const put = (t, delta, where) => {
  if (!t.trim()) return;
  const rec = ms.get(t) ?? { n: 0, where: [] };
  rec.n += delta; rec.where.push(where); ms.set(t, rec);
};
for (const a of P.adrs) for (const x of a.body) put(x.t, +1, `${a.path}:${x.line}`);
for (const e of placed) for (const x of e.r.body) put(x.t, +1, `${e.r.path}:${x.line}`);
for (const a of D.adrs) for (const x of a.body) put(x.t, -1, `${a.path}:${x.line}`);
for (const r of D.rects) for (const x of r.body) put(x.t, -1, `${r.path}:${x.line}`);
for (const x of D.preamble) put(x.t, -1, `${x.path}:${x.line}`);
const diff = [];
for (const [t, { n, where }] of ms) if (n !== 0)
  diff.push(`${n > 0 ? `- perdida ×${n}` : `+ sobrante ×${-n}`}: «${t.length > 100 ? t.slice(0, 100) + '…' : t}» (${where.slice(0, 3).join(', ')}${where.length > 3 ? ', …' : ''})`);
check('b', 'multiconjunto de líneas no-cabecera', diff);

// (c) cada rectificación en el fichero de su ADR, con cabecera normalizada
const ajenas = [];
for (const f of files) {
  const n = +f.path.match(/ADR-(\d+)\.md$/)[1];
  const heads = D.adrs.filter(a => a.path === f.path);
  if (!heads.some(a => a.n === n)) ajenas.push(`${f.path}: no contiene la cabecera de ADR-${pad(n)}`);
}
for (const r of D.rects) {
  const n = +r.path.match(/ADR-(\d+)\.md$/)[1];
  if (!NORM_RECT.test(r.header)) ajenas.push(`${r.path}:${r.line}: cabecera no normalizada «${r.header.trim()}»`);
  if ((r.explicit ?? r.host) !== n) ajenas.push(`${r.path}:${r.line}: rectificación ADR-${r.explicit ?? '?'}·R·${r.k} en el fichero de ADR-${pad(n)}`);
}
for (const e of placed) {
  const want = `ADR-${pad(e.target)}.md`;
  const id = `ADR-${e.target}·R·${e.r.k}`;
  const found = D.rects.filter(r => `ADR-${r.explicit ?? r.host}·R·${r.k}` === id);
  if (found.length && !found.some(r => basename(r.path) === want)) ajenas.push(`${id}: está en ${found.map(r => r.path).join(', ')} y no en ${want}`);
}
check('c', 'cada rectificación en el fichero de su ADR', ajenas);

// (d) no atribuibles
check('d', 'informe de no atribuibles vacío o resuelto', entries.filter(e => e.target == null)
  .map(e => `${e.r.path}:${e.r.line} «${e.r.header.trim()}» — ${e.motivo} (${e.r.body.filter(x => x.t.trim()).length} líneas fuera de (b))`));

let rojo = 0;
for (const { tag, title, problems } of res) {
  if (!problems.length) { console.log(`  ✔ (${tag}) ${title}`); continue; }
  rojo++;
  console.log(`  ✘ (${tag}) ${title}: ${problems.length}`);
  for (const p of show(problems)) console.log(`      ${p}`);
}
const resumen = `${new Set(P.adrs.map(a => a.n)).size} ADRs, ${P.rects.length} rectificaciones (${placed.length} colocadas), ${files.length} ficheros en ${cfg.dir}`;
if (rojo) { console.log(`ADR-EQUIV ROJO (${rojo}/4): ${resumen}.`); process.exit(1); }
console.log(`ADR-EQUIV verde: ${resumen}.`);
