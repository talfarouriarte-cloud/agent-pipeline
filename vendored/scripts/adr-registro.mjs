// adr-registro — parser común del registro de decisiones (central#325, AP-106).
// Lo comparten adr-lint (modos `--ids-vs` y `layout: "dir"`), adr-migrate,
// adr-equiv y adr-index. El graft (AP-009) sirve todo `vendored/scripts/*.mjs`
// a `scripts/` del consumidor, así que los cuatro lo importan como hermano
// (`./adr-registro.mjs`). La ruta antigua de adr-lint (layout «volumes» sin
// `--ids-vs`) NO lo importa: un consumidor con una copia suelta de adr-lint.mjs
// sigue teniendo el comportamiento de siempre.
//
// Modelo (enmienda al ruling de central#325, vinculante): un registro es una
// lista de ficheros (volúmenes o `ADR-NNN.md`). Cada línea es cabecera de ADR,
// cabecera de rectificación o contenido. BLOQUE = una ADR o una rectificación,
// desde su cabecera hasta antes de la siguiente cabecera de ADR o de
// rectificación (de cualquier nivel). Lo anterior a la primera cabecera de un
// fichero es contenido FUERA DE BLOQUE: no se descarta, se informa. Las líneas se
// guardan crudas, con su fin de línea (`raw`), para comparar byte a byte sin trim
// ni normalizar EOL; `t` es la línea sin su `\r?\n`, solo para clasificar.
// Las rectificaciones se reconocen ANTES que las ADR (`## ADR-5·R·1` no es la
// ADR-5) y se asignan POR IDENTIFICADOR, nunca por posición: en finplan las de
// ADR-210 viven dentro del bloque de otra ADR. Si el bloque de una rectificación
// alojada en una ADR ajena contiene una cabecera hermana que no es de
// rectificación (p. ej. `### Coste de revertir`), viaja con la rectificación
// (definición de bloque) y adr-migrate lo anota en «fronteras a confirmar».
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

export const DEFAULT_VOLUMES = ['docs/decisions/decisions-001-075.md',
  'docs/decisions/decisions-076-149.md',
  'docs/decisions/decisions-150-current.md'];
export const DEFAULT_ADR_HEADER = ['^## ADR-(?<adr>\\d+)\\b'];
// Formatos medidos: finplan `ADR-N·R·k`, `ADR-N · Rectificación k`,
// `Rectificación R·k` (sin ADR); wmcb `Revisión R·k` (sin ADR).
export const DEFAULT_RECT_HEADER = [
  '^#{2,6}\\s+ADR-(?<adr>\\d+)\\s*·\\s*R\\s*·\\s*(?<k>\\d+)\\b',
  '^#{2,6}\\s+ADR-(?<adr>\\d+)\\s*·\\s*(?:Rectificaci[oó]n|Revisi[oó]n)\\s+(?:R\\s*·\\s*)?(?<k>\\d+)\\b',
  '^#{2,6}\\s+(?:Rectificaci[oó]n|Revisi[oó]n)\\s+R\\s*·\\s*(?<k>\\d+)\\b',
];
// Formato normalizado de `layout: "dir"`: `### ADR-NNN·R·k (fecha) — título`.
export const NORM_RECT = /^### ADR-(\d{3,})·R·(\d+)(?: \(([^()]*)\))?(?: — (.+))?$/;
const NORM_RECT_SRC = '^### ADR-(?<adr>\\d+)·R·(?<k>\\d+)\\b';
// Procedencia de cada bloque del directorio (enmienda, punto 2a).
export const ORIGEN = '.origen.json';

const compile = (list, group, key) => list.map(src => {
  let re;
  try { re = new RegExp(src); } catch (e) { throw new Error(`adr-lint.config.json: ${key} inválido «${src}»: ${e.message}`); }
  if (!new RegExp(`\\(\\?<${group}>`).test(src)) throw new Error(`adr-lint.config.json: ${key} «${src}» sin grupo nombrado «${group}»`);
  return re;
});

// Config normalizada. Sin claves nuevas = comportamiento histórico.
export function normalizeConfig(raw = {}) {
  const layout = raw.layout ?? 'volumes';
  if (layout !== 'volumes' && layout !== 'dir') throw new Error(`adr-lint.config.json: layout «${layout}» no es "volumes" ni "dir"`);
  const dir = raw.dir ?? 'docs/decisions/adr';
  const dups = raw.duplicadosHeredados ?? [];
  if (!Array.isArray(dups) || !dups.every(n => Number.isInteger(n) && n > 0))
    throw new Error(`adr-lint.config.json: duplicadosHeredados ${JSON.stringify(dups)} no es una lista de números de ADR`);
  return {
    layout, dir,
    // Números de ADR repetidos heredados y declarados (central#331, AP-109): la
    // regla de duplicados no los informa; sus rectificaciones son ambiguas.
    duplicadosHeredados: dups,
    volumes: raw.volumes ?? DEFAULT_VOLUMES,
    index: raw.index ?? 'decisions.md',
    strictFrom: raw.strictFrom ?? 217,
    extraSources: raw.extraSources ?? ['spec.md', 'docs/conventions.md'],
    report: raw.report ?? join(dirname(dir), 'adr-no-atribuibles'),
    informe: raw.informe ?? join(dirname(dir), 'adr-migracion'),
    overrides: raw.overrides ?? 'adr-migrate.overrides.json',
    adrRes: compile(raw.adrHeader ?? DEFAULT_ADR_HEADER, 'adr', 'adrHeader'),
    // El formato normalizado va siempre primero: el directorio se lee igual
    // aunque el consumidor declare patrones propios para sus volúmenes.
    rectRes: compile([NORM_RECT_SRC, ...(raw.rectHeader ?? DEFAULT_RECT_HEADER)], 'k', 'rectHeader'),
  };
}

export function loadConfig(path = 'adr-lint.config.json') {
  let raw = {};
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch {}
  return normalizeConfig(raw);
}

// Líneas crudas: `raw` conserva su terminador (`\n`, `\r\n` o nada en la última).
export const rawLines = text => (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).map(raw => ({ raw, t: raw.replace(/\r?\n$/, '') }));
export const splitLines = text => rawLines(text).map(x => x.t);
export const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
export const bodyText = b => b.body.map(x => x.raw).join('');
const level = line => { const m = line.match(/^(#{1,6})\s/); return m ? m[1].length : 99; };

export function classify(line, cfg) {
  for (const re of cfg.rectRes) {
    const m = line.match(re);
    if (m) return { type: 'rect', adr: m.groups.adr != null ? +m.groups.adr : null, k: +m.groups.k, rest: line.slice(m.index + m[0].length), level: level(line) };
  }
  for (const re of cfg.adrRes) {
    const m = line.match(re);
    if (m) return { type: 'adr', n: +m.groups.adr };
  }
  return null;
}

// files: [{ path, text }] en el orden del registro. Devuelve los bloques en
// orden (`blocks`), y por tipo (`adrs`, `rects`), más lo de fuera de bloque.
export function parseFiles(files, cfg) {
  const adrs = [], rects = [], blocks = [], preamble = [];
  for (const { path, text } of files) {
    let adr = null, cur = null;
    rawLines(text).forEach(({ raw, t }, i) => {
      const line = i + 1, c = classify(t, cfg);
      if (c?.type === 'rect') {
        cur = { tipo: 'rect', explicit: c.adr, k: c.k, rest: c.rest, level: c.level, host: adr ? adr.n : null, hostIdx: adr ? adrs.length - 1 : null, path, line, fin: line, header: t, headerRaw: raw, body: [] };
        rects.push(cur); blocks.push(cur);
        return;
      }
      if (c?.type === 'adr') {
        adr = cur = { tipo: 'adr', n: c.n, path, line, fin: line, header: t, headerRaw: raw, body: [] };
        adrs.push(adr); blocks.push(adr);
        return;
      }
      if (!cur) { preamble.push({ t, raw, line, path }); return; }
      if (cur.tipo === 'rect' && !cur.cortadaPor && level(t) <= cur.level) cur.cortadaPor = { line, header: t.trim() };
      cur.body.push({ t, raw, line }); cur.fin = line;
    });
  }
  return { adrs, rects, blocks, preamble };
}

// Identificador de un bloque leído tal cual (sin atribución).
export const blockId = b => b.tipo === 'adr' ? `ADR-${b.n}` : `ADR-${b.explicit ?? b.host ?? '?'}·R·${b.k}`;

// Multiconjunto de identificadores (para --ids-vs): una rectificación sin ADR
// en la cabecera toma la del bloque que la contiene, salvo que los overrides la
// hayan RESUELTO a otra: entonces cuenta con la resuelta, que es la que tendrá
// tras la migración — si no, el corte daría «pérdida» por un cambio de fichero.
export function idsOf(parsed, resoluciones = new Map()) {
  const ids = new Map();
  const add = id => ids.set(id, (ids.get(id) ?? 0) + 1);
  for (const a of parsed.adrs) add(`ADR-${a.n}`);
  const ks = claves(parsed.rects);
  parsed.rects.forEach((r, i) => {
    const res = resoluciones.get(ks[i]);
    const n = res?.n ?? r.explicit ?? r.host, k = res?.k ?? r.k;
    add(n != null ? `ADR-${n}·R·${k}` : `(sin ADR)·R·${k}`);
  });
  return ids;
}

// Clave estable de una rectificación (overrides e informe): no depende del
// número de línea (que cambia con cualquier inserción anterior).
function claves(rects) {
  const seen = new Map();
  return rects.map(r => {
    const base = `${r.path}#${r.header.trim()}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return `${base}#${n}`;
  });
}

// Override en forma de identificador (`"ADR-NNN·R·k": "ADR-NNN"`): fija una
// rectificación de un número declarado en `duplicadosHeredados` (central#331,
// AP-109). Sirve a adr-migrate (antes del corte, con el identificador que tiene
// en el volumen) y a adr-lint en `dir` (después, con el del fichero).
// Devuelve Map `n·R·k` → resolución. Tras el corte, adr-lint acepta además lo
// que `<report>.json` da por resuelto y colocado (override por clave o renumerado).
export const fijadas = resoluciones => new Map([...resoluciones].flatMap(([c, v]) => {
  const g = c.trim().match(/^ADR-0*(\d+)\s*·\s*R\s*·\s*(\d+)$/);
  return g ? [[`${+g[1]}·R·${+g[2]}`, v]] : [];
}));

// Atribución por identificador. `resoluciones`: Map clave → { n, k? } (de
// `adr-migrate.overrides.json`). Devuelve { entries, placed, report }; cada
// entrada lleva su `k` final (el del override si lo renumera). `dups`: números
// de `duplicadosHeredados` — toda rectificación que apunte a uno de ellos es
// AMBIGUA (dos ADRs con ese número) y va al informe salvo override: nunca se
// elige una de las dos en silencio.
export function attribute(parsed, resoluciones = new Map(), dups = []) {
  const existentes = new Set(parsed.adrs.map(a => a.n));
  const ks = claves(parsed.rects), porId = fijadas(resoluciones);
  const out = parsed.rects.map((r, i) => {
    const e = { r, clave: ks[i], k: r.k, target: null, motivo: null, candidatos: [] };
    if (r.explicit != null) {
      if (existentes.has(r.explicit)) e.target = r.explicit;
      else { e.motivo = `la cabecera nombra ADR-${r.explicit}, que no existe en el registro`; e.candidatos = [r.explicit]; }
    } else if (r.host == null) {
      e.motivo = 'sin cabecera de ADR y fuera de todo bloque de ADR';
    } else {
      const ajenas = [...new Set(parsed.rects.filter(o => o.hostIdx === r.hostIdx && o.explicit != null && o.explicit !== r.host).map(o => o.explicit))].sort((a, b) => a - b);
      if (ajenas.length) {
        e.motivo = `sin cabecera de ADR dentro del bloque de ADR-${r.host}, que aloja rectificaciones de otras ADRs (${ajenas.map(n => 'ADR-' + n).join(', ')})`;
        e.candidatos = [r.host, ...ajenas];
      } else e.target = r.host;
    }
    const dupN = e.target ?? r.explicit;
    if (dupN != null && dups.includes(dupN)) {
      const id = `ADR-${pad(dupN)}·R·${r.k}`, fix = porId.get(`${dupN}·R·${r.k}`);
      e.target = null; e.candidatos = [dupN];
      e.motivo = `ADR-${dupN} es un número duplicado declarado (duplicadosHeredados): atribución ambigua entre sus ${parsed.adrs.filter(a => a.n === dupN).length} ADRs (override «${id}» o por clave)`;
      // Como un override por clave: la entrada sigue en el informe, resuelta.
      if (fix != null) { e.resolucion = fix; e.k = fix.k ?? r.k; e.target = existentes.has(fix.n) ? fix.n : null; if (e.target == null) e.motivo = `override a ADR-${fix.n}, que no existe en el registro`; }
    }
    return e;
  });
  // Primero se marcan las inatribuibles (originales), después se aplican los
  // overrides del humano: una entrada resuelta SIGUE en el informe, con su
  // `resolucion`, para que la segunda corrida dé exactamente la misma salida.
  for (const e of out) {
    const res = resoluciones.get(e.clave);
    if (res == null) continue;
    e.resolucion = res; e.k = res.k ?? e.r.k;
    e.target = existentes.has(res.n) ? res.n : null;
    if (e.target == null) e.motivo = `override a ADR-${res.n}, que no existe en el registro`;
  }
  const byId = new Map();
  for (const e of out) if (e.target != null) {
    const id = `ADR-${e.target}·R·${e.k}`;
    byId.set(id, [...(byId.get(id) ?? []), e]);
  }
  for (const [id, es] of byId) if (es.length > 1) for (const e of es) {
    e.target = null; e.motivo = `identificador ${id} duplicado (${es.length} cabeceras; un override «ADR-NNN·R·k» lo renumera)`; e.candidatos = [+id.match(/\d+/)[0]];
  }
  const report = out.filter(e => e.motivo != null || e.resolucion != null);
  return { entries: out, placed: out.filter(e => e.target != null), report };
}

export const pad = n => String(n).padStart(3, '0');
const resTxt = r => `ADR-${pad(r.n)}` + (r.k != null ? `·R·${r.k}` : '');

// Cabecera normalizada: `### ADR-NNN·R·k (fecha) — título`. La fecha es el
// primer paréntesis con una fecha ISO; el resto, sin puntuación inicial, es el título.
export function normHeader(n, k, rest) {
  let s = rest, fecha = null;
  const m = s.match(/\(([^()]*\d{4}-\d{2}-\d{2}[^()]*)\)/);
  if (m) { fecha = m[1].trim(); s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); }
  s = s.replace(/^[\s:—–\-·.,]+/, '').replace(/[\s—–\-:]+$/, '').replace(/\s{2,}/g, ' ');
  return `### ADR-${pad(n)}·R·${k}` + (fecha ? ` (${fecha})` : '') + (s ? ` — ${s}` : '');
}

// Segmentos de contenido fuera de bloque (lo anterior a la primera cabecera de
// cada fichero): uno por fichero como mucho, literal.
export function fueraDeBloque(parsed) {
  return [...new Set(parsed.preamble.map(x => x.path))].map(path => {
    const ls = parsed.preamble.filter(x => x.path === path);
    const texto = ls.map(x => x.raw).join('');
    return { volumen: path, inicio: ls[0].line, fin: ls[ls.length - 1].line, sha256: sha(texto), texto };
  });
}

// Secciones de ADR presentes en un texto: cabecera `#…` o negrita a inicio de
// línea con el nombre exacto (`### Contexto`, `**Coste de revertir.**`); no
// cuenta «**Decisión del propietario**» ni la palabra en prosa.
const SECCIONES = ['Contexto', 'Decisión', 'Coste de revertir'];
export const secciones = text => SECCIONES.filter(s => {
  const w = s.replace('ó', '[oó]');
  return new RegExp(`^[ \\t>]*(?:#{2,6}\\s+${w}[.:]?\\s*$|\\*\\*${w}[.:]?\\*\\*)`, 'mi').test(text);
});

const fence = s => '`'.repeat(Math.max(3, ...[...s.matchAll(/`+/g)].map(m => m[0].length + 1)));

// Migración determinista (en memoria): no escribe nada. Devuelve los ficheros
// del directorio (`files`: nombre → contenido, con `.origen.json`), los dos
// informes y lo pendiente. Cada `ADR-NNN.md` = sus bloques de ADR (en orden de
// origen) y después sus rectificaciones por k (sort estable), concatenados tal
// cual: cuerpo literal; solo cambia la cabecera de rectificación (normalizada,
// con su mismo fin de línea). Si un bloque acaba sin fin de línea (última línea
// de un volumen sin `\n`), se le añade uno y queda anotado (`eolAñadido`).
export function migrar(parsed, cfg, resoluciones = new Map()) {
  const { entries, placed, report } = attribute(parsed, resoluciones, cfg.duplicadosHeredados ?? []);
  const files = new Map(), bloques = [];
  for (const n of [...new Set(parsed.adrs.map(a => a.n))].sort((a, b) => a - b)) {
    const name = `ADR-${pad(n)}.md`;
    const own = [
      ...parsed.adrs.filter(a => a.n === n).map(a => ({ b: a, id: `ADR-${n}`, head: a.header })),
      ...placed.filter(e => e.target === n).sort((x, y) => x.k - y.k)
        .map(e => ({ b: e.r, id: `ADR-${n}·R·${e.k}`, head: normHeader(n, e.k, e.r.rest) })),
    ];
    let txt = '';
    own.forEach((o, orden) => {
      const eol = o.b.headerRaw.slice(o.b.header.length);
      let head = o.head + eol, body = bodyText(o.b), eolAñadido = false;
      if (body) { if (!body.endsWith('\n')) { body += '\n'; eolAñadido = true; } }
      else if (!eol) { head += '\n'; eolAñadido = true; }
      txt += head + body;
      bloques.push({ id: o.id, tipo: o.b.tipo, volumen: o.b.path, inicio: o.b.line, fin: o.b.fin, cabecera: o.b.header,
        destino: name, orden, cabeceraDestino: o.head, ...(eolAñadido ? { eolAñadido } : {}), sha256: sha(bodyText(o.b)), _b: o.b });
    });
    files.set(name, txt);
  }
  const vi = new Map(cfg.volumes.map((v, i) => [v, i]));
  bloques.sort((x, y) => (vi.get(x.volumen) ?? 1e9) - (vi.get(y.volumen) ?? 1e9) || x.inicio - y.inicio);
  const cabeceras = bloques.filter(b => b.cabecera !== b.cabeceraDestino)
    .map(b => ({ volumen: b.volumen, linea: b.inicio, antigua: b.cabecera, normalizada: b.cabeceraDestino }));
  const fuera = fueraDeBloque(parsed);
  const origen = { generado: 'adr-migrate (central#325, enmienda al ruling)', dir: cfg.dir, volumenes: cfg.volumes,
    bloques: bloques.map(({ _b, ...b }) => b), cabeceras, fueraDeBloque: fuera };
  files.set(ORIGEN, JSON.stringify(origen, null, 2) + '\n');

  const dupAdr = [...new Set(parsed.adrs.map(a => a.n))].filter(n => parsed.adrs.filter(a => a.n === n).length > 1).sort((a, b) => a - b)
    .map(n => ({ adr: `ADR-${pad(n)}`, ubicaciones: parsed.adrs.filter(a => a.n === n).map(a => `${a.path}:${a.line}`) }));
  // Rectificación colocada desde el bloque de OTRA ADR cuyo bloque contiene una
  // cabecera hermana que no es de rectificación: por la definición de bloque
  // viaja con la rectificación; el humano confirma que no era de la anfitriona.
  const avisos = placed.filter(e => e.r.cortadaPor && e.r.host != null && e.r.host !== e.target).map(e => ({
    rectificacion: `ADR-${pad(e.target)}·R·${e.k}`, volumen: e.r.path, linea: e.r.line,
    incluye: `${e.r.path}:${e.r.cortadaPor.line} «${e.r.cortadaPor.header}»`, anfitriona: `ADR-${pad(e.r.host)}`,
  }));
  // Anfitriona = la propia ADR (central#331, AP-109): un bloque de ADR sin
  // secciones de ADR seguido de una rectificación suya que sí las tiene es la
  // firma de una rectificación insertada a mitad del cuerpo de su ADR (se lleva
  // el resto). adr-equiv no lo ve: certifica fidelidad al volumen, no corrección.
  const porR = new Map(placed.map(e => [e.r, e]));
  const propias = parsed.blocks.flatMap((b, i) => {
    const sig = parsed.blocks[i + 1], e = sig && porR.get(sig);
    if (b.tipo !== 'adr' || !e || sig.path !== b.path || e.target !== b.n || e.r.host !== b.n) return [];
    if (secciones(bodyText(b)).length || !secciones(bodyText(sig)).length) return [];
    return [{ rectificacion: `ADR-${pad(e.target)}·R·${e.k}`, volumen: sig.path, linea: sig.line, adr: `ADR-${pad(b.n)}`, adrLinea: b.line, secciones: secciones(bodyText(sig)) }];
  });
  const entradas = report.map(e => ({
    clave: e.clave, volumen: e.r.path, linea: e.r.line, cabecera: e.r.header.trim(),
    motivo: e.motivo, candidatos: e.candidatos.map(n => `ADR-${pad(n)}`), lineas: e.r.body.length,
    resolucion: e.resolucion != null ? resTxt(e.resolucion) : null,
    colocada: e.target != null ? `ADR-${pad(e.target)}.md` : null,
    // Identificador final (con la k del override si renumera): adr-lint en `dir`
    // reconoce por él la rectificación de un número duplicado ya fijada (AP-109).
    id: e.target != null ? `ADR-${pad(e.target)}·R·${e.k}` : null,
  }));
  const pendientes = entradas.filter(e => !e.colocada);
  const repJson = { generado: 'adr-migrate (central#325)', volumenes: cfg.volumes, dir: cfg.dir, overrides: cfg.overrides, entradas };
  const esc = s => s.replace(/\|/g, '\\|');
  const repMd = ['# Rectificaciones no atribuibles (generado por adr-migrate — no editar a mano)', '',
    `Para resolver una entrada: añade \`"<clave>": "ADR-NNN"\` (o \`"ADR-NNN·R·k"\` para renumerar) a \`${cfg.overrides}\` y vuelve a correr \`adr-migrate\`. Mientras quede alguna pendiente, \`adr-migrate\` sale con exit 1 y no escribe \`${cfg.dir}/\`.`, '',
    `Pendientes: ${pendientes.length} · resueltas: ${entradas.length - pendientes.length}.`, '',
    ...(entradas.length ? ['| Clave | Ubicación | Motivo | Candidatas | Resolución |', '|---|---|---|---|---|',
      ...entradas.map(e => `| \`${esc(e.clave)}\` | \`${e.volumen}:${e.linea}\` | ${e.motivo ?? '—'} | ${e.candidatos.join(', ') || '—'} | ${e.colocada ? `${e.resolucion ?? '—'} → ${e.colocada}` : '**pendiente**'} |`)] : ['(vacío)']), ''].join('\n');
  const infMd = ['# Informe de migración del registro (generado por adr-migrate — no editar a mano)', '',
    `Volúmenes: ${cfg.volumes.map(v => '`' + v + '`').join(', ')} → \`${cfg.dir}/\` (procedencia por bloque en \`${cfg.dir}/${ORIGEN}\`).`, '',
    `Bloques: ${bloques.length} (${bloques.filter(b => b.tipo === 'adr').length} de ADR, ${bloques.filter(b => b.tipo === 'rect').length} de rectificación) · cabeceras normalizadas: ${cabeceras.length} · contenido fuera de bloque: ${fuera.length} segmento(s) · no atribuibles pendientes: ${pendientes.length}.`, '',
    '## Tabla de cabeceras (antigua → normalizada)', '',
    ...(cabeceras.length ? ['| Ubicación | Antigua | Normalizada |', '|---|---|---|',
      ...cabeceras.map(c => `| \`${c.volumen}:${c.linea}\` | ${esc(c.antigua)} | ${esc(c.normalizada)} |`)] : ['(ninguna)']), '',
    '## Contenido fuera de bloque (lo anterior a la primera cabecera de cada volumen; no va a ningún `ADR-NNN.md`)', '',
    ...(fuera.length ? fuera.flatMap(f => { const fz = fence(f.texto); return [`### \`${f.volumen}:${f.inicio}-${f.fin}\` (sha256 ${f.sha256.slice(0, 12)})`, '', fz, f.texto.replace(/\r?\n$/, ''), fz, '']; }) : ['(ninguno)', '']),
    ...(dupAdr.length ? ['## ADRs con número repetido (colocadas juntas en su fichero; lo decide la épica local)', '',
      ...dupAdr.map(d => `- ${d.adr}: ${d.ubicaciones.map(u => '`' + u + '`').join(', ')}`), ''] : []),
    ...(avisos.length ? ['## Fronteras a confirmar (rectificación alojada en el bloque de otra ADR que incluye una cabecera hermana; por la definición de bloque viaja con la rectificación)', '',
      ...avisos.map(a => `- ${a.rectificacion} (\`${a.volumen}:${a.linea}\`, en el bloque de ${a.anfitriona}) incluye ${a.incluye}`), ''] : []),
    ...(propias.length ? ['## Fronteras a confirmar: anfitriona = la propia ADR (su bloque de ADR no tiene secciones `Contexto`/`Decisión`/`Coste de revertir` y la rectificación que lo sigue sí: ¿se insertó a mitad del cuerpo de la ADR?)', '',
      ...propias.map(a => `- ${a.rectificacion} (\`${a.volumen}:${a.linea}\`, tras ${a.adr} en \`${a.volumen}:${a.adrLinea}\`) lleva ${a.secciones.map(s => '«' + s + '»').join(', ')}`), ''] : []),
  ].join('\n');
  avisos.push(...propias.map(a => ({ ...a, anfitriona: a.adr })));
  return { entries, placed, report, files, origen, bloques, cabeceras, fuera, dupAdr, avisos, entradas, pendientes,
    informes: [[cfg.report + '.json', JSON.stringify(repJson, null, 2) + '\n'], [cfg.report + '.md', repMd], [cfg.informe + '.md', infMd]] };
}

export const readVolumes = (cfg, read = p => readFileSync(p, 'utf8')) =>
  cfg.volumes.map(path => ({ path, text: read(path) }));

export function dirFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => /^ADR-\d+\.md$/.test(f)).sort().map(f => ({ path: join(dir, f), text: readFileSync(join(dir, f), 'utf8') }));
}

// `adr-migrate.overrides.json` → Map clave → { n, k? }. Formato: objeto
// `{ "<clave del informe>": "ADR-NNN" | "ADR-NNN·R·k" }`; las claves que
// empiezan por `_` son comentarios. Valor ilegible ⇒ error (no se ignora).
export function loadResoluciones(cfg) {
  const m = new Map();
  if (!existsSync(cfg.overrides)) return m;
  let j;
  try { j = JSON.parse(readFileSync(cfg.overrides, 'utf8')); } catch (e) { throw new Error(`${cfg.overrides} ilegible: ${e.message}`); }
  for (const [clave, v] of Object.entries(j ?? {})) {
    if (clave.startsWith('_')) continue;
    const g = String(v).trim().match(/^(?:ADR-)?0*(\d+)(?:\s*·\s*R\s*·\s*(\d+))?$/);
    if (!g) throw new Error(`${cfg.overrides}: valor «${v}» para «${clave}» no es «ADR-NNN» ni «ADR-NNN·R·k»`);
    m.set(clave, { n: +g[1], ...(g[2] != null ? { k: +g[2] } : {}) });
  }
  return m;
}
