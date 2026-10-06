#!/usr/bin/env node
// adr-migrate — volúmenes → un fichero por ADR (central#325, AP-106; enmienda
// al ruling, vinculante). Lee los volúmenes de adr-lint.config.json (`volumes`)
// y escribe en `dir` un `ADR-NNN.md` por ADR con TODAS sus rectificaciones,
// asignadas por identificador (nunca por posición). Bloque = ADR o
// rectificación, de su cabecera a la siguiente cabecera de ADR/rectificación;
// el cuerpo viaja byte a byte (sin trim ni normalizar EOL) y solo cambia la
// cabecera de rectificación, normalizada a `### ADR-NNN·R·k (fecha) — título`.
// Orden en cada fichero: la ADR y después sus rectificaciones por k.
//
// Emite, además del directorio:
//   (a) `<dir>/.origen.json`: por bloque, id, volumen, líneas inicio/fin,
//       cabecera original literal, destino y hash del cuerpo; más la tabla de
//       cabeceras y el contenido fuera de bloque (literal);
//   (b)+(c) `<informe>.md` (default `docs/decisions/adr-migracion.md`): tabla
//       de cabeceras antigua → normalizada y contenido fuera de bloque;
//   (d) `<report>.{json,md}` (default `docs/decisions/adr-no-atribuibles`).
// Las rectificaciones que no se pueden atribuir sin dudas se resuelven en
// `adr-migrate.overrides.json` (`{ "<clave>": "ADR-NNN" | "ADR-NNN·R·k" }`).
// Si queda alguna sin resolver: exit 1 y NO escribe `dir` (sí los informes).
//
// Determinista e idempotente: misma entrada ⇒ mismos bytes; no reescribe un
// fichero que no cambia y borra los `ADR-*.md` del directorio que ya no salen.
// No toca los volúmenes ni el índice. La equivalencia la certifica adr-equiv.
// Uso: node scripts/adr-migrate.mjs   (exit 0; 1: no atribuibles pendientes; 2: error)
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { loadConfig, readVolumes, parseFiles, migrar, loadResoluciones } from './adr-registro.mjs';

const fail = m => { console.error(`ADR-MIGRATE ERROR: ${m}`); process.exit(2); };
let cfg, vols, res;
try { cfg = loadConfig(); } catch (e) { fail(e.message); }
try { vols = readVolumes(cfg); } catch (e) { fail(`no se puede leer un volumen: ${e.message}`); }
try { res = loadResoluciones(cfg); } catch (e) { fail(e.message); }

const parsed = parseFiles(vols, cfg);
const M = migrar(parsed, cfg, res);
const put = (p, content) => {
  if (existsSync(p) && readFileSync(p, 'utf8') === content) return false;
  mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); return true;
};
for (const [p, content] of M.informes) put(p, content);

const resumen = `${parsed.adrs.length} cabeceras de ADR · ${parsed.rects.length} rectificaciones (${M.placed.length} colocadas, ${M.pendientes.length} no atribuibles) · ` +
  `${M.cabeceras.length} cabeceras normalizadas · ${M.fuera.length} segmento(s) fuera de bloque · ${M.dupAdr.length} ADR con número repetido · ${M.avisos.length} frontera(s) a confirmar`;
if (M.pendientes.length) {
  console.error(`ADR-MIGRATE ROJO: ${M.pendientes.length} rectificación(es) no atribuibles sin override en ${cfg.overrides} — ${cfg.dir}/ NO se escribe. Ver ${cfg.report}.md.\n  ${resumen}`);
  process.exit(1);
}

mkdirSync(cfg.dir, { recursive: true });
let escritos = 0, iguales = 0, borrados = 0;
for (const [name, content] of M.files) put(join(cfg.dir, name), content) ? escritos++ : iguales++;
for (const f of readdirSync(cfg.dir).filter(f => /^ADR-\d+\.md$/.test(f) && !M.files.has(f)).sort()) { unlinkSync(join(cfg.dir, f)); borrados++; }

console.log(`ADR-MIGRATE: ${M.files.size} ficheros en ${cfg.dir} (${escritos} escritos, ${iguales} sin cambios, ${borrados} borrados) · ${resumen} · ` +
  `informes ${cfg.informe}.md y ${cfg.report}.{json,md}`);
