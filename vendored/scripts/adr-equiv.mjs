#!/usr/bin/env node
// adr-equiv — certificado de «migración sin pérdida ni desorden» entre los
// volúmenes y el directorio de un fichero por ADR (central#325, AP-106; enmienda
// al ruling, vinculante). Mientras dure el paralelo, los volúmenes mandan y el
// directorio es salida de adr-migrate. Todo se compara BYTE A BYTE, sin trim ni
// normalizar EOL:
//   (a) multiconjunto de identificadores (ADR-N y ADR-N·R·k) idéntico;
//   (b) identidad por bloque: hash del cuerpo de cada bloque igual en origen y
//       destino; si no, el diff del bloque (primera línea distinta);
//   (c) ida y vuelta: reensambla los volúmenes desde `<dir>/ADR-*.md` +
//       `<dir>/.origen.json` y los compara con los originales; solo se admiten
//       diferencias en líneas de cabecera listadas en la tabla de cabeceras;
//   (d) orden y ubicación en cada fichero: su ADR y luego sus rectificaciones
//       por k; ninguna rectificación en el fichero de otra ADR;
//   (e) contenido fuera de bloque: todo consta, literal, en `.origen.json` y en
//       el informe de migración; nada descartado en silencio (y ninguno en `dir`).
// Las rectificaciones no atribuibles sin override no entran en (a)/(b): se
// listan aparte y dan rojo, así que «verde salvo los no atribuibles» se lee directo.
// `--check`: además regenera la migración (en memoria) y falla si difiere del
// `dir` commiteado.
// Uso: node scripts/adr-equiv.mjs [--check]   (verde: exit 0; rojo: exit 1; error: exit 2)
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { loadConfig, readVolumes, parseFiles, migrar, loadResoluciones, dirFiles, rawLines, bodyText, blockId, sha, ORIGEN, pad } from './adr-registro.mjs';

const CHECK = process.argv.includes('--check');
const fail = m => { console.error(`ADR-EQUIV ERROR: ${m}`); process.exit(2); };
let cfg, vols, res, origen;
try { cfg = loadConfig(); } catch (e) { fail(e.message); }
try { vols = readVolumes(cfg); } catch (e) { fail(`no se puede leer un volumen: ${e.message}`); }
try { res = loadResoluciones(cfg); } catch (e) { fail(e.message); }
const files = dirFiles(cfg.dir);
if (!files.length) fail(`${cfg.dir} no tiene ningún ADR-NNN.md (¿falta correr adr-migrate?)`);
try { origen = JSON.parse(readFileSync(join(cfg.dir, ORIGEN), 'utf8')); } catch (e) { fail(`${cfg.dir}/${ORIGEN} falta o es ilegible (¿falta correr adr-migrate?): ${e.message}`); }

const P = parseFiles(vols, cfg);
const M = migrar(P, cfg, res);
const D = parseFiles(files, cfg);
const MAX = 40;
const out = [];
const check = (tag, title, problems) => out.push({ tag, title, problems });
const q = s => JSON.stringify(s.length > 120 ? s.slice(0, 120) + '…' : s);
const byFile = new Map(files.map(f => [basename(f.path), []]));
for (const b of D.blocks) byFile.get(basename(b.path)).push(b);

// (a) multiconjunto de identificadores
const count = ids => ids.reduce((m, i) => m.set(i, (m.get(i) ?? 0) + 1), new Map());
const exp = count(M.bloques.map(b => b.id)), act = count(D.blocks.map(blockId));
const sortIds = a => a.sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
const da = [];
for (const id of sortIds([...new Set([...exp.keys(), ...act.keys()])])) {
  const e = exp.get(id) ?? 0, a = act.get(id) ?? 0;
  if (e > a) da.push(`falta en el directorio: ${id}${e > 1 ? ` (${e} → ${a})` : ''}`);
  if (a > e) da.push(`sobra en el directorio: ${id}${a > 1 ? ` (${e} → ${a})` : ''}`);
}
check('a', 'identificadores', da);

// (b) identidad por bloque: origen (volúmenes) ↔ destino, por id y ocurrencia
const occ = (list, idOf) => { const seen = new Map(); return list.map(x => { const id = idOf(x); const i = (seen.get(id) ?? 0); seen.set(id, i + 1); return [`${id}#${i}`, x]; }); };
const dest = new Map(occ([...byFile.keys()].sort().flatMap(f => byFile.get(f)), blockId));
const orig = occ([...M.bloques].sort((x, y) => x.destino.localeCompare(y.destino) || x.orden - y.orden), b => b.id);
const diffBlock = (a, b) => {
  const la = rawLines(a), lb = rawLines(b);
  let i = 0; while (i < la.length && i < lb.length && la[i].raw === lb[i].raw) i++;
  return `${la.length} → ${lb.length} líneas; primera diferencia en la línea ${i + 1} del cuerpo: origen ${la[i] ? q(la[i].raw) : '(fin)'} · destino ${lb[i] ? q(lb[i].raw) : '(fin)'}`;
};
const db = [];
for (const [key, o] of orig) {
  const d = dest.get(key);
  if (!d) continue;                                   // ya en (a)
  let want = bodyText(o._b);
  if (want && !want.endsWith('\n')) want += '\n';     // eolAñadido
  const got = bodyText(d);
  if (sha(want) !== sha(got)) db.push(`${o.id} (${o.volumen}:${o.inicio}-${o.fin} → ${d.path}:${d.line}-${d.fin}): ${diffBlock(want, got)}`);
}
check('b', 'identidad por bloque (hash del cuerpo)', db);

// (c) ida y vuelta: volúmenes reensamblados desde dir + .origen.json
const dc = [];
const ob = origen.bloques ?? [], ofb = origen.fueraDeBloque ?? [];
const used = new Set();
const allowed = new Map((origen.cabeceras ?? []).map(c => [`${c.volumen}:${c.linea}`, c]));
for (const v of cfg.volumes) {
  const segs = [...ob.filter(b => b.volumen === v).map(b => ({ b })), ...ofb.filter(f => f.volumen === v).map(f => ({ f }))]
    .sort((x, y) => (x.b ?? x.f).inicio - (y.b ?? y.f).inicio);
  let rec = '', roto = false;
  for (const s of segs) {
    if (s.f) { rec += s.f.texto ?? ''; continue; }
    const d = byFile.get(s.b.destino)?.[s.b.orden];
    if (!d) { dc.push(`${v}:${s.b.inicio}: el bloque ${s.b.id} no está en ${s.b.destino} (posición ${s.b.orden + 1})`); roto = true; continue; }
    used.add(d);
    let t = d.headerRaw + bodyText(d);
    if (s.b.eolAñadido && t.endsWith('\n')) t = t.slice(0, -1);
    rec += t;
  }
  const buf = readFileSync(v), txt = buf.toString('utf8');
  if (!Buffer.from(txt, 'utf8').equals(buf)) dc.push(`${v}: no es UTF-8 válido; la ida y vuelta no puede ser byte a byte`);
  const lo = rawLines(txt), lr = rawLines(rec), bad = [];
  for (let i = 0; i < Math.max(lo.length, lr.length); i++) {
    const a = lo[i], b = lr[i];
    if (a && b && a.raw === b.raw) continue;
    const c = allowed.get(`${v}:${i + 1}`);
    if (a && b && c && a.t === c.antigua && b.t === c.normalizada && a.raw.slice(a.t.length) === b.raw.slice(b.t.length)) continue;
    bad.push(`${v}:${i + 1}: original ${a ? q(a.raw) : '(fin)'} · reensamblado ${b ? q(b.raw) : '(fin)'}`);
  }
  if (bad.length) dc.push(...bad.slice(0, 5), ...(bad.length > 5 ? [`${v}: … y ${bad.length - 5} línea(s) distintas más (${lo.length} → ${lr.length} líneas)`] : []));
  else if (roto) dc.push(`${v}: reensamblado incompleto`);
}
for (const b of D.blocks) if (!used.has(b)) dc.push(`${b.path}:${b.line}: bloque ${blockId(b)} sin procedencia en ${ORIGEN}`);
check('c', 'ida y vuelta (volúmenes reensamblados = originales salvo cabeceras de la tabla)', dc);

// (d) orden y ubicación en cada fichero
const dd = [];
for (const [f, bs] of [...byFile].sort()) {
  const n = +f.match(/ADR-(\d+)\.md$/)[1];
  if (!bs.some(b => b.tipo === 'adr' && b.n === n)) dd.push(`${f}: no contiene la cabecera de ADR-${pad(n)}`);
  let vistoR = false, prevK = -Infinity;
  for (const b of bs) {
    if (b.tipo === 'adr') {
      if (b.n !== n) dd.push(`${f}:${b.line}: cabecera de ADR-${b.n} en el fichero de ADR-${pad(n)}`);
      if (vistoR) dd.push(`${f}:${b.line}: ADR-${b.n} después de una rectificación (orden: ADR y luego rectificaciones)`);
      continue;
    }
    vistoR = true;
    if ((b.explicit ?? b.host) !== n) dd.push(`${f}:${b.line}: rectificación ${blockId(b)} en el fichero de ADR-${pad(n)}`);
    if (b.k < prevK) dd.push(`${f}:${b.line}: ${blockId(b)} fuera de orden (las rectificaciones van por k)`);
    prevK = Math.max(prevK, b.k);
  }
}
check('d', 'orden en cada fichero (ADR y luego rectificaciones por k)', dd);

// (e) contenido fuera de bloque
const de = [];
let informe = '';
try { informe = readFileSync(cfg.informe + '.md', 'utf8'); } catch { de.push(`${cfg.informe}.md ilegible: el contenido fuera de bloque no consta en ningún informe`); }
for (const f of M.fuera) {
  const r = ofb.find(x => x.volumen === f.volumen && x.inicio === f.inicio);
  if (!r) { de.push(`${f.volumen}:${f.inicio}-${f.fin}: fuera de bloque y sin constar en ${ORIGEN}`); continue; }
  if (r.fin !== f.fin || r.texto !== f.texto) de.push(`${f.volumen}:${f.inicio}-${f.fin}: ${ORIGEN} no lo recoge literal (${diffBlock(f.texto, r.texto ?? '')})`);
  if (informe && (!informe.includes(`\`${f.volumen}:${f.inicio}-${f.fin}\``) || !informe.includes(f.texto.replace(/\r?\n$/, ''))))
    de.push(`${f.volumen}:${f.inicio}-${f.fin}: no consta literal en ${cfg.informe}.md`);
}
for (const r of ofb) if (!M.fuera.some(f => f.volumen === r.volumen && f.inicio === r.inicio)) de.push(`${ORIGEN}: segmento fuera de bloque ${r.volumen}:${r.inicio}-${r.fin} que no existe en el volumen`);
for (const x of D.preamble) de.push(`${x.path}:${x.line}: contenido fuera de bloque dentro de ${cfg.dir} ${q(x.raw)}`);
check('e', 'contenido fuera de bloque: todo informado, nada descartado', de);

// no atribuibles (fuera de (a)/(b))
check('·', 'no atribuibles sin override', M.pendientes.map(e => `${e.volumen}:${e.linea} «${e.cabecera}» — ${e.motivo} (${e.lineas} líneas fuera de (a)/(b)); override en ${cfg.overrides} con la clave «${e.clave}»`));

// --check: regenerar y comparar con lo commiteado
if (CHECK) {
  const dk = [];
  if (M.pendientes.length) dk.push('no se puede regenerar: hay no atribuibles sin override');
  else {
    for (const [name, content] of M.files) {
      const p = join(cfg.dir, name);
      if (!existsSync(p)) dk.push(`${p}: falta (regenerado lo tiene)`);
      else if (!readFileSync(p).equals(Buffer.from(content, 'utf8'))) dk.push(`${p}: difiere de lo regenerado (${diffBlock(content, readFileSync(p, 'utf8'))})`);
    }
    for (const f of readdirSync(cfg.dir).filter(f => /^ADR-\d+\.md$/.test(f) && !M.files.has(f))) dk.push(`${join(cfg.dir, f)}: sobra (lo regenerado no lo tiene)`);
  }
  check('check', `${cfg.dir} = regenerado por adr-migrate`, dk);
}

let rojo = 0;
for (const { tag, title, problems } of out) {
  if (!problems.length) { console.log(`  ✔ (${tag}) ${title}`); continue; }
  rojo++;
  console.log(`  ✘ (${tag}) ${title}: ${problems.length}`);
  for (const p of problems.length > MAX ? [...problems.slice(0, MAX), `… y ${problems.length - MAX} más`] : problems) console.log(`      ${p}`);
}
const resumen = `${new Set(P.adrs.map(a => a.n)).size} ADRs, ${P.rects.length} rectificaciones (${M.placed.length} colocadas, ${M.pendientes.length} no atribuibles), ` +
  `${M.cabeceras.length} cabeceras normalizadas, ${M.fuera.length} segmento(s) fuera de bloque, ${files.length} ficheros en ${cfg.dir}`;
if (rojo) { console.log(`ADR-EQUIV ROJO (${rojo}/${out.length}): ${resumen}.`); process.exit(1); }
console.log(`ADR-EQUIV verde: ${resumen}.`);
