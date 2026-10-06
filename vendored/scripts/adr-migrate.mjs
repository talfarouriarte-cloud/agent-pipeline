#!/usr/bin/env node
// adr-migrate — volúmenes → un fichero por ADR (central#325, AP-106).
// Lee los volúmenes de adr-lint.config.json (`volumes`) y escribe en `dir` un
// `ADR-NNN.md` por ADR con TODAS sus rectificaciones dentro, asignadas por
// identificador (nunca por posición), con la cabecera normalizada a
// `### ADR-NNN·R·k (fecha) — título` y ordenadas por k. Las rectificaciones que
// no se pueden atribuir sin dudas NO se colocan: van al informe
// `<report>.json` + `<report>.md` (por defecto `docs/decisions/adr-no-atribuibles`).
// Para resolver una, se rellena su `resolucion` («ADR-NNN») en el JSON y se
// vuelve a correr; la entrada sigue en el informe, ya resuelta.
//
// Determinista e idempotente: misma entrada ⇒ mismos bytes; no reescribe un
// fichero que no cambia y borra los `ADR-*.md` del directorio que ya no salen
// (el directorio es salida generada mientras dure el paralelo). Lo anterior a
// la primera ADR de cada volumen va a `<dir>/_preambulo.md` (no se pierde nada).
// No toca los volúmenes ni el índice. La equivalencia la certifica adr-equiv.
// Uso: node scripts/adr-migrate.mjs
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { loadConfig, readVolumes, parseFiles, attribute, render, loadResoluciones, pad, PREAMBULO } from './adr-registro.mjs';

let cfg;
try { cfg = loadConfig(); } catch (e) { console.error(`ADR-MIGRATE ERROR: ${e.message}`); process.exit(2); }
let vols;
try { vols = readVolumes(cfg); } catch (e) { console.error(`ADR-MIGRATE ERROR: no se puede leer un volumen: ${e.message}`); process.exit(2); }

const parsed = parseFiles(vols, cfg);
const { placed, report } = attribute(parsed, loadResoluciones(cfg));
const files = render(parsed, placed);

mkdirSync(cfg.dir, { recursive: true });
let escritos = 0, iguales = 0, borrados = 0;
for (const [name, content] of files) {
  const p = join(cfg.dir, name);
  if (existsSync(p) && readFileSync(p, 'utf8') === content) { iguales++; continue; }
  writeFileSync(p, content); escritos++;
}
for (const f of readdirSync(cfg.dir).filter(f => (/^ADR-\d+\.md$/.test(f) || f === PREAMBULO) && !files.has(f)).sort()) { unlinkSync(join(cfg.dir, f)); borrados++; }

const dupAdr = [...new Set(parsed.adrs.map(a => a.n))].filter(n => parsed.adrs.filter(a => a.n === n).length > 1).sort((a, b) => a - b)
  .map(n => ({ adr: `ADR-${pad(n)}`, ubicaciones: parsed.adrs.filter(a => a.n === n).map(a => `${a.path}:${a.line}`) }));
const entradas = report.map(e => ({
  clave: e.clave, volumen: e.r.path, linea: e.r.line, cabecera: e.r.header.trim(),
  motivo: e.motivo, candidatos: e.candidatos.map(n => `ADR-${pad(n)}`), lineas: e.r.body.filter(x => x.t.trim()).length,
  resolucion: e.resolucion != null ? `ADR-${pad(e.resolucion)}` : null,
  colocada: e.target != null ? `ADR-${pad(e.target)}.md` : null,
}));
const json = { generado: 'adr-migrate (central#325)', volumenes: cfg.volumes, dir: cfg.dir, entradas, adrsDuplicadas: dupAdr };
// Rectificación colocada desde el bloque de OTRA ADR y cortada por una cabecera
// hermana que no es de rectificación: la frontera es la de markdown, pero el
// humano la confirma (lo que sigue al corte se queda en la ADR anfitriona).
const avisos = placed.filter(e => e.r.cortadaPor && e.r.host != null && e.r.host !== e.target).map(e => ({
  rectificacion: `ADR-${pad(e.target)}·R·${e.r.k}`, volumen: e.r.path, linea: e.r.line,
  cortadaPor: `${e.r.path}:${e.r.cortadaPor.line} «${e.r.cortadaPor.header}»`, anfitriona: `ADR-${pad(e.r.host)}`,
}));
json.avisos = avisos;
const pendientes = entradas.filter(e => !e.colocada);
const md = ['# Rectificaciones no atribuibles (generado por adr-migrate — no editar a mano)', '',
  'Para resolver una entrada: rellena su `resolucion` («ADR-NNN») en el `.json` hermano y vuelve a correr `adr-migrate`.', '',
  `Pendientes: ${pendientes.length} · resueltas: ${entradas.length - pendientes.length}.`, '',
  ...(entradas.length ? ['| Ubicación | Cabecera | Motivo | Candidatas | Resolución |', '|---|---|---|---|---|',
    ...entradas.map(e => `| \`${e.volumen}:${e.linea}\` | ${e.cabecera.replace(/\|/g, '\\|')} | ${e.motivo ?? '—'} | ${e.candidatos.join(', ') || '—'} | ${e.colocada ? `${e.resolucion ?? '—'} → ${e.colocada}` : '**pendiente**'} |`)] : ['(vacío)']),
  ...(dupAdr.length ? ['', '## ADRs con número repetido (colocadas juntas en su fichero; lo decide la épica local)', '',
    ...dupAdr.map(d => `- ${d.adr}: ${d.ubicaciones.map(u => '`' + u + '`').join(', ')}`)] : []),
  ...(avisos.length ? ['', '## Fronteras a confirmar (rectificación en bloque ajeno cortada por una cabecera hermana; lo que sigue se quedó en la anfitriona)', '',
    ...avisos.map(a => `- ${a.rectificacion} (\`${a.volumen}:${a.linea}\`, en el bloque de ${a.anfitriona}) cortada en ${a.cortadaPor}`)] : []), ''].join('\n');
mkdirSync(dirname(cfg.report), { recursive: true });
for (const [ext, content] of [['.json', JSON.stringify(json, null, 2) + '\n'], ['.md', md]]) {
  const p = cfg.report + ext;
  if (!(existsSync(p) && readFileSync(p, 'utf8') === content)) writeFileSync(p, content);
}

console.log(`ADR-MIGRATE: ${files.size} ficheros en ${cfg.dir} (${escritos} escritos, ${iguales} sin cambios, ${borrados} borrados) · ` +
  `${parsed.adrs.length} cabeceras de ADR · ${parsed.rects.length} rectificaciones (${placed.length} colocadas, ${pendientes.length} no atribuibles) · ` +
  `${dupAdr.length} ADR con número repetido · ${avisos.length} frontera(s) a confirmar · informe ${cfg.report}.{json,md}`);
if (pendientes.length) console.log(`ADR-MIGRATE: ${pendientes.length} rectificación(es) sin colocar — ver ${cfg.report}.md`);
