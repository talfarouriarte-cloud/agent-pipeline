// adr-registro — parser común del registro de decisiones (central#325, AP-106).
// Lo comparten adr-lint (modos `--ids-vs` y `layout: "dir"`), adr-migrate,
// adr-equiv y adr-index. El graft (AP-009) sirve todo `vendored/scripts/*.mjs`
// a `scripts/` del consumidor, así que los cuatro lo importan como hermano
// (`./adr-registro.mjs`). La ruta antigua de adr-lint (layout «volumes» sin
// `--ids-vs`) NO lo importa: un consumidor con una copia suelta de adr-lint.mjs
// sigue teniendo el comportamiento de siempre.
//
// Modelo: un registro es una lista de ficheros (volúmenes o `ADR-NNN.md`). Cada
// línea es cabecera de ADR, cabecera de rectificación o contenido. Las
// rectificaciones se reconocen ANTES que las ADR (`## ADR-5·R·1` no es la
// ADR-5) y se asignan POR IDENTIFICADOR, nunca por posición: en finplan las de
// ADR-210 viven dentro del bloque de otra ADR. Una rectificación termina en la
// siguiente cabecera de ADR o de rectificación, o en una cabecera de nivel
// MENOR que la suya (un `## Notas` de volumen no se la traga).
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

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
  return {
    layout, dir,
    volumes: raw.volumes ?? DEFAULT_VOLUMES,
    index: raw.index ?? 'decisions.md',
    strictFrom: raw.strictFrom ?? 217,
    extraSources: raw.extraSources ?? ['spec.md', 'docs/conventions.md'],
    report: raw.report ?? join(dirname(dir), 'adr-no-atribuibles'),
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

export const splitLines = text => {
  const ls = text.split(/\r?\n/);
  if (ls.length && ls[ls.length - 1] === '') ls.pop();
  return ls;
};
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

// files: [{ path, text }] en el orden del registro.
export function parseFiles(files, cfg) {
  const adrs = [], rects = [], preamble = [];
  for (const { path, text } of files) {
    let adr = null, rect = null;
    splitLines(text).forEach((t, i) => {
      const line = i + 1, c = classify(t, cfg);
      if (c?.type === 'rect') {
        rect = { explicit: c.adr, k: c.k, rest: c.rest, level: c.level, host: adr ? adr.n : null, hostIdx: adr ? adrs.length - 1 : null, path, line, header: t, body: [] };
        rects.push(rect);
        return;
      }
      if (c?.type === 'adr') { adr = { n: c.n, path, line, header: t, body: [] }; adrs.push(adr); rect = null; return; }
      if (rect && level(t) < rect.level) rect = null;
      if (rect) rect.body.push({ t, line });
      else if (adr) adr.body.push({ t, line });
      else preamble.push({ t, line, path });
    });
  }
  return { adrs, rects, preamble };
}

// Multiconjunto de identificadores tal como están ESCRITOS (para --ids-vs):
// una rectificación sin ADR en la cabecera toma la del bloque que la contiene.
export function idsOf(parsed) {
  const ids = new Map();
  const add = id => ids.set(id, (ids.get(id) ?? 0) + 1);
  for (const a of parsed.adrs) add(`ADR-${a.n}`);
  for (const r of parsed.rects) add(r.explicit != null || r.host != null ? `ADR-${r.explicit ?? r.host}·R·${r.k}` : `(sin ADR)·R·${r.k}`);
  return ids;
}

// Clave estable de una rectificación para el informe de no atribuibles: no
// depende del número de línea (que cambia con cualquier inserción anterior).
function claves(rects) {
  const seen = new Map();
  return rects.map(r => {
    const base = `${r.path}#${r.header.trim()}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return `${base}#${n}`;
  });
}

// Atribución por identificador. `resoluciones`: Map clave → nº de ADR (del
// informe previo, campo `resolucion`). Devuelve { placed, report }.
export function attribute(parsed, resoluciones = new Map()) {
  const existentes = new Set(parsed.adrs.map(a => a.n));
  const ks = claves(parsed.rects);
  const out = parsed.rects.map((r, i) => {
    const e = { r, clave: ks[i], target: null, motivo: null, candidatos: [] };
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
    return e;
  });
  // Primero se marcan las inatribuibles (originales), después se aplican las
  // resoluciones del humano: una entrada resuelta SIGUE en el informe, con su
  // `resolucion`, para que la segunda corrida dé exactamente la misma salida.
  for (const e of out) {
    const res = resoluciones.get(e.clave);
    if (res != null) { e.resolucion = res; e.target = existentes.has(res) ? res : null; if (e.target == null) e.motivo = `resolución a ADR-${res}, que no existe en el registro`; }
  }
  const byId = new Map();
  for (const e of out) if (e.target != null) {
    const id = `ADR-${e.target}·R·${e.r.k}`;
    byId.set(id, [...(byId.get(id) ?? []), e]);
  }
  for (const [id, es] of byId) if (es.length > 1) for (const e of es) {
    e.target = null; e.motivo = `identificador ${id} duplicado (${es.length} cabeceras)`; e.candidatos = [+id.match(/\d+/)[0]];
  }
  const report = out.filter(e => e.motivo != null || e.resolucion != null);
  return { entries: out, placed: out.filter(e => e.target != null), report };
}

export const pad = n => String(n).padStart(3, '0');

// Cabecera normalizada: `### ADR-NNN·R·k (fecha) — título`. La fecha es el
// primer paréntesis con una fecha ISO; el resto, sin puntuación inicial, es el título.
export function normHeader(n, k, rest) {
  let s = rest, fecha = null;
  const m = s.match(/\(([^()]*\d{4}-\d{2}-\d{2}[^()]*)\)/);
  if (m) { fecha = m[1].trim(); s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); }
  s = s.replace(/^[\s:—–\-·.,]+/, '').replace(/[\s—–\-:]+$/, '').replace(/\s{2,}/g, ' ');
  return `### ADR-${pad(n)}·R·${k}` + (fecha ? ` (${fecha})` : '') + (s ? ` — ${s}` : '');
}

const trimEnd = ls => { const a = [...ls]; while (a.length && !a[a.length - 1].trim()) a.pop(); return a; };

// Render determinista del directorio: Map nombre → contenido.
export function render(parsed, placed) {
  const files = new Map();
  for (const n of [...new Set(parsed.adrs.map(a => a.n))].sort((a, b) => a - b)) {
    const parts = parsed.adrs.filter(a => a.n === n).map(a => trimEnd([a.header, ...a.body.map(x => x.t)]).join('\n'));
    const own = placed.filter(e => e.target === n).sort((a, b) => a.r.k - b.r.k);   // sort estable: empate ⇒ orden de origen
    for (const e of own) parts.push(trimEnd([normHeader(n, e.r.k, e.r.rest), ...e.r.body.map(x => x.t)]).join('\n'));
    files.set(`ADR-${pad(n)}.md`, parts.join('\n\n') + '\n');
  }
  return files;
}

export const readVolumes = (cfg, read = p => readFileSync(p, 'utf8')) =>
  cfg.volumes.map(path => ({ path, text: read(path) }));

export function dirFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => /^ADR-\d+\.md$/.test(f)).sort().map(f => ({ path: join(dir, f), text: readFileSync(join(dir, f), 'utf8') }));
}

// Informe previo → Map clave → nº de ADR resuelto.
export function loadResoluciones(cfg) {
  const m = new Map();
  try {
    const j = JSON.parse(readFileSync(cfg.report + '.json', 'utf8'));
    for (const e of j.entradas ?? []) if (e.resolucion != null && e.resolucion !== '') {
      const n = +String(e.resolucion).replace(/^ADR-/, '');
      if (Number.isFinite(n)) m.set(e.clave, n);
    }
  } catch {}
  return m;
}
