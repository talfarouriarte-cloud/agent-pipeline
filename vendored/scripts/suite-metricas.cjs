'use strict';
// suite-metricas — métricas de la suite de tests de un consumidor para el
// steward semanal (AP-140, central#410, ruling 2026-11-04 posición 19).
//
// Llamador: `suite-steward.yml`, job `metricas`, que carga
// `${GITHUB_WORKSPACE}/scripts/suite-metricas.cjs` (graft-vendored), baja los
// informes JSON de vitest de los runs de CI (o, sin ellos, los logs de sus
// jobs) y escribe `.suite-steward/metricas.{json,md}` para la sesión del
// steward (`docs/agents/suite-steward.md`).
//
// PURO (AP-068): sin E/S ni red (`zlib` solo descomprime un zip ya bajado);
// todo lo que hace llamadas vive en el step y todo lo que decide vive aquí. Banco: `scripts/check-suite-metricas.mjs`.
//
// Una sola magnitud por campo (hallazgo [G] de la crítica ronda 3 y enmienda
// del Architect a #410):
//  - `msTotal` es SIEMPRE suma de duraciones de test: en un punto
//    `fuente: 'artifact'`, la suma por fichero de `endTime − startTime` (lo que
//    lee `test-budget-check.mjs` de finplan); en un punto `fuente: 'log'`, el
//    `tests Ys` de la línea `Duration`. El `Duration` de pared va aparte, en
//    `msPared`, solo informativo.
//  - `tests` es SIEMPRE el número de tests `passed` (`Tests N passed` del log,
//    `assertionResults[].status === 'passed'` del informe).
// Aun así las dos fuentes no son idénticas al milisegundo: `tendencia` solo
// calcula Δ% entre puntos consecutivos de la MISMA `fuente`; en la frontera, el
// tramo es `null` («cambio de fuente»).

// Ruta de un `testResults[].name` relativa al checkout del runner
// (`/home/runner/work/<repo>/<repo>/…`, `/__w/<repo>/<repo>/…`).
function relativo(nombre) {
  return String(nombre || '').replace(/\\/g, '/').replace(/^.*?\/(?:work|__w)\/[^/]+\/[^/]+\//, '');
}

const msDe = r => Math.round(Math.max(0, Number(r && r.endTime) - Number(r && r.startTime)) || 0);
const passedDe = r => ((r && r.assertionResults) || []).filter(a => a && a.status === 'passed').length;

// Informes de vitest de UN run (uno por shard) ⇒ agregado del run. Un mismo
// fichero en dos informes (artifact repetido, shard re-subido) cuenta una vez:
// se queda la entrada con más `ms` (determinista).
function agregar(reportes) {
  const porNombre = new Map();
  for (const rep of reportes || []) {
    for (const r of (rep && rep.testResults) || []) {
      const fichero = relativo(r && r.name);
      if (!fichero) continue;
      const e = { fichero, tests: passedDe(r), ms: msDe(r) };
      const prev = porNombre.get(fichero);
      if (!prev || e.ms > prev.ms) porNombre.set(fichero, e);
    }
  }
  const porFichero = [...porNombre.values()].sort((a, b) => (a.fichero < b.fichero ? -1 : a.fichero > b.fichero ? 1 : 0));
  return {
    ficheros: porFichero.length,
    tests: porFichero.reduce((s, e) => s + e.tests, 0),
    msTotal: porFichero.reduce((s, e) => s + e.ms, 0),
    porFichero,
  };
}

// Los `n` ficheros con más `ms`; empate ⇒ por nombre ascendente.
function top(agregado, n) {
  return [...((agregado && agregado.porFichero) || [])]
    .sort((a, b) => b.ms - a.ms || (a.fichero < b.fichero ? -1 : a.fichero > b.fichero ? 1 : 0))
    .slice(0, n);
}

// Directorios (padre inmediato de cada fichero) por `ms`, para el mapa de la
// revisión inicial. Empate ⇒ por nombre.
function porDirectorio(agregado, n) {
  const m = new Map();
  for (const e of (agregado && agregado.porFichero) || []) {
    const i = e.fichero.lastIndexOf('/');
    const dir = i < 0 ? '.' : e.fichero.slice(0, i);
    const d = m.get(dir) || { directorio: dir, ficheros: 0, tests: 0, ms: 0 };
    d.ficheros++; d.tests += e.tests; d.ms += e.ms;
    m.set(dir, d);
  }
  return [...m.values()]
    .sort((a, b) => b.ms - a.ms || (a.directorio < b.directorio ? -1 : a.directorio > b.directorio ? 1 : 0))
    .slice(0, n);
}

const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && a !== 0) ? Math.round(((b - a) / a) * 1000) / 10 : null;
const msPorTest = p => (p.tests > 0 ? p.msTotal / p.tests : null);
const fuenteDe = p => p.fuente || 'artifact';

// Δ% de `a` a `b`; `tramo` = los puntos de `a` a `b`, ambos incluidos: si alguno
// cambia de `fuente`, no hay Δ%.
function delta(a, b, tramo = [a, b]) {
  if (!tramo.every(p => fuenteDe(p) === fuenteDe(a))) return { desde: a.fecha, hasta: b.fecha, comparable: false, motivo: `cambio de fuente (${fuenteDe(a)} → ${fuenteDe(b)})` };
  return {
    desde: a.fecha, hasta: b.fecha, comparable: true,
    tests: pct(a.tests, b.tests),
    msTotal: pct(a.msTotal, b.msTotal),
    msPorTest: pct(msPorTest(a), msPorTest(b)),
  };
}

// `serie` = `[{ fecha, tests, msTotal, fuente? }]`, un punto por semana ⇒
// `tramos` (Δ% de cada par consecutivo; en la frontera de fuente, `delta: null`)
// y Δ% del último punto contra la semana anterior y contra 4 semanas antes (sin
// cambio de fuente en esos 5 puntos). Menos de 2 puntos ⇒ `null`. Sin punto 4
// semanas antes ⇒ `cuatroSemanas: null`.
function tendencia(serie) {
  const s = [...(serie || [])].filter(p => p && p.fecha).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  if (s.length < 2) return null;
  const ult = s[s.length - 1];
  return {
    puntos: s.length,
    ultimo: { fecha: ult.fecha, tests: ult.tests, msTotal: ult.msTotal, msPorTest: msPorTest(ult), fuente: fuenteDe(ult) },
    tramos: s.slice(1).map((p, i) => {
      const x = delta(s[i], p);
      return x.comparable ? x : { ...x, delta: null };
    }),
    semanal: delta(s[s.length - 2], ult),
    cuatroSemanas: s.length >= 5 ? delta(s[s.length - 5], ult, s.slice(-5)) : null,
  };
}

const RE_LITERAL = /toMatch(Inline)?Snapshot|snapshot|hash|literal capturad|referencia congelada/i;
const RE_TIMEOUT = /timed? ?out|exceeded the maximum execution time|Test timed out/i;
const RE_ENTORNO = /ECONNRESET|ENOSPC|ETIMEDOUT|out of memory|heap/i;

function clasificarFallo(mensaje) {
  const m = String(mensaje == null ? '' : mensaje);
  if (RE_LITERAL.test(m)) return 'literal';
  if (RE_TIMEOUT.test(m)) return 'timeout';
  if (RE_ENTORNO.test(m)) return 'entorno';
  return 'aserción';
}

// Log crudo de un job (`actions/jobs/<id>/logs`) ⇒ `{ tests, msTotal, msPared }`
// (`msTotal` = `tests Ys`, `msPared` = `Duration Xs`).
// Se normaliza antes de las regex: escapes ANSI y timestamp del runner al inicio
// de cada línea (sin eso `\s+` no casa: crítica ronda 2). Suma TODAS las líneas
// de resumen (un log con varios paquetes trae una por paquete). Segundos ⇒ ms.
function normalizarLog(texto) {
  return String(texto || '')
    .replace(/\r/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /gm, '');
}

function agregarDesdeLog(texto) {
  const t = normalizarLog(texto);
  const tests = [...t.matchAll(/^\s*Tests\s+(\d+) passed/gm)].map(m => Number(m[1]));
  const durs = [...t.matchAll(/^\s*Duration\s+([\d.]+)s \(.*\btests ([\d.]+)s/gm)].map(m => [Number(m[1]), Number(m[2])]);
  if (!tests.length && !durs.length) return null;
  return {
    tests: tests.reduce((s, n) => s + n, 0),
    msTotal: durs.length ? Math.round(durs.reduce((s, d) => s + d[1], 0) * 1000) : null,
    msPared: durs.length ? Math.round(durs.reduce((s, d) => s + d[0], 0) * 1000) : null,
  };
}

// `ejecuciones` = `[{ run, intento, conclusion, fallidos: [fichero] }]` (un
// elemento por intento de un run de CI). Inestable = fichero en `fallidos` del
// intento 1 y con un intento posterior del MISMO run en `success`.
function inestables(ejecuciones) {
  const porRun = new Map();
  for (const e of ejecuciones || []) {
    if (!e || e.run == null) continue;
    if (!porRun.has(e.run)) porRun.set(e.run, []);
    porRun.get(e.run).push(e);
  }
  const out = [];
  for (const [run, es] of porRun) {
    const primero = es.find(e => Number(e.intento) === 1);
    if (!primero) continue;
    const verdeDespues = es.some(e => Number(e.intento) > 1 && e.conclusion === 'success');
    if (!verdeDespues) continue;
    for (const fichero of new Set(primero.fallidos || [])) out.push({ run, fichero });
  }
  return out.sort((a, b) => (a.fichero < b.fichero ? -1 : a.fichero > b.fichero ? 1 : 0) || (a.run < b.run ? -1 : a.run > b.run ? 1 : 0));
}

// Anotaciones `::error` de los rojos de PR (`[{ run, path, message }]`) ⇒ por
// clase y por fichero (runs distintos en que falla). `path` vacío ⇒ `(sin fichero)`.
function rojos(anotaciones) {
  const porClase = { literal: 0, timeout: 0, entorno: 0, 'aserción': 0 };
  const fich = new Map();
  for (const a of anotaciones || []) {
    if (!a) continue;
    const clase = clasificarFallo(a.message);
    porClase[clase]++;
    const f = relativo(a.path) || '(sin fichero)';
    const e = fich.get(f) || { fichero: f, runs: new Set(), clases: {} };
    e.runs.add(a.run);
    e.clases[clase] = (e.clases[clase] || 0) + 1;
    fich.set(f, e);
  }
  const porFichero = [...fich.values()]
    .map(e => ({ fichero: e.fichero, fallos: e.runs.size, clases: e.clases }))
    .sort((a, b) => b.fallos - a.fallos || (a.fichero < b.fichero ? -1 : a.fichero > b.fichero ? 1 : 0));
  return { anotaciones: (anotaciones || []).filter(Boolean).length, porClase, porFichero };
}

// Selección de runs de push verdes de la rama por defecto: el último de cada
// día UTC de los últimos 7 días (semana actual) y el último de cada una de las
// `semanas` anteriores (ventanas de 7 días hacia atrás desde `ahora`).
// `runs` = `[{ id, created_at }]`. Devuelve `{ dias: [{ fecha, run }], semanas: [{ semana, desde, run }] }`.
function seleccionarRuns(runs, ahora, semanas) {
  const t0 = new Date(ahora).getTime();
  const DIA = 86400000;
  const rs = [...(runs || [])].filter(r => r && r.created_at)
    .map(r => ({ ...r, t: new Date(r.created_at).getTime() }))
    .filter(r => r.t <= t0)
    .sort((a, b) => a.t - b.t);
  const dias = new Map();
  for (const r of rs) if (r.t > t0 - 7 * DIA) dias.set(r.created_at.slice(0, 10), r);
  const sem = [];
  for (let k = 1; k <= semanas; k++) {
    const desde = t0 - 7 * (k + 1) * DIA, hasta = t0 - 7 * k * DIA;
    const enVentana = rs.filter(r => r.t > desde && r.t <= hasta);
    sem.push({ semana: k, desde: new Date(desde).toISOString().slice(0, 10), run: enVentana.length ? enVentana[enVentana.length - 1] : null });
  }
  const limpio = r => (r ? { id: r.id, created_at: r.created_at } : null);
  return {
    dias: [...dias.entries()].sort().map(([fecha, r]) => ({ fecha, run: limpio(r) })),
    semanas: sem.map(s => ({ ...s, run: limpio(s.run) })),
  };
}

const s = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const d = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${v} %`);
const mpt = p => (p.tests > 0 ? `${Math.round(p.msTotal / p.tests)} ms` : '—');

// `metricas.md` desde `metricas.json`: tabla de tendencia, top 20, rojos por
// clase y por fichero, inestables. Sin informes de vitest lo dice literal.
function informeMd(m) {
  const L = [];
  L.push(`# Métricas de la suite · ${m.repo || ''} · ${m.semana || ''}`, '');
  L.push(`Generado: ${m.generado || ''} · modo: \`${m.modo || 'semanal'}\` · rama: \`${m.rama || ''}\``, '');
  if (!m.hayArtifacts) L.push('**sin informes de vitest: falta el upload en `ci.yaml`** (los puntos con `fuente: log` salen de las líneas de resumen de los logs, sin detalle por fichero).', '');
  L.push('## Tendencia', '', '| Fecha | Fuente | Run | Tests | msTotal | ms/test | Pared |', '|---|---|---|---|---|---|---|');
  for (const p of m.serie || []) L.push(`| ${p.fecha} | ${p.fuente || 'artifact'} | ${p.run || '—'} | ${p.tests} | ${s(p.msTotal)} | ${mpt(p)} | ${s(p.msPared)} |`);
  if (!(m.serie || []).length) L.push('| — | — | — | — | — | — | — |');
  L.push('');
  const t = m.tendencia;
  const linea = (nom, x) => {
    if (!x) return `- Δ% ${nom}: \`null\` (sin punto).`;
    if (!x.comparable) return `- Δ% ${nom} (${x.desde} → ${x.hasta}): \`null\`, ${x.motivo}.`;
    return `- Δ% ${nom} (${x.desde} → ${x.hasta}): tests ${d(x.tests)} · msTotal ${d(x.msTotal)} · ms/test ${d(x.msPorTest)}`;
  };
  if (!t) L.push('Δ%: `null` (menos de 2 puntos en la serie).');
  else {
    L.push(linea('semana a semana', t.semanal), linea('a 4 semanas', t.cuatroSemanas), '', 'Tramos:', '');
    for (const x of t.tramos) L.push(linea('del tramo', x));
  }
  L.push('', 'msTotal: suma de duraciones de test (por fichero en `artifact`, `tests Ys` de vitest en `log`). «Pared» = `Duration` de vitest, solo informativo. Sin Δ% en un cambio de fuente.', '');
  L.push('## Semana actual (último run verde de cada día)', '', '| Día | Fuente | Run | Tests | msTotal |', '|---|---|---|---|---|');
  for (const p of m.dias || []) L.push(`| ${p.fecha} | ${p.fuente || 'artifact'} | ${p.run || '—'} | ${p.tests} | ${s(p.msTotal)} |`);
  if (!(m.dias || []).length) L.push('| — | — | — | — | — |');
  L.push('', '## Top 20 ficheros por ms', '');
  if (m.detalleDe) L.push(`Detalle por fichero del run ${m.detalleDe.run} (${m.detalleDe.fecha}).`, '');
  if (!(m.top || []).length) L.push('Sin detalle por fichero (no hay informe de vitest en la semana).');
  else { L.push('| # | Fichero | Tests | ms |', '|---|---|---|---|'); (m.top || []).forEach((e, i) => L.push(`| ${i + 1} | \`${e.fichero}\` | ${e.tests} | ${e.ms} |`)); }
  if ((m.directorios || []).length) {
    L.push('', '## Directorios por ms', '', '| Directorio | Ficheros | Tests | ms |', '|---|---|---|---|');
    for (const e of m.directorios) L.push(`| \`${e.directorio}\` | ${e.ficheros} | ${e.tests} | ${e.ms} |`);
  }
  const r = m.rojos || { porClase: {}, porFichero: [], anotaciones: 0 };
  L.push('', '## Rojos de la semana (CI de PR)', '', `Runs con algún job en \`failure\`: ${m.runsRojos == null ? '—' : m.runsRojos} · anotaciones \`::error\`: ${r.anotaciones}`, '');
  L.push('| Clase | Anotaciones |', '|---|---|');
  for (const c of ['literal', 'timeout', 'entorno', 'aserción']) L.push(`| ${c} | ${(r.porClase || {})[c] || 0} |`);
  L.push('', '| Fichero | Runs en rojo | Clases |', '|---|---|---|');
  for (const e of (r.porFichero || []).slice(0, 30)) L.push(`| \`${e.fichero}\` | ${e.fallos} | ${Object.entries(e.clases).map(([k, v]) => `${k}: ${v}`).join(', ')} |`);
  if (!(r.porFichero || []).length) L.push('| — | 0 | — |');
  L.push('', '## Inestables (fallo en el intento 1, verde en un intento posterior del mismo run)', '');
  if (!(m.inestables || []).length) L.push('Ninguno.');
  else for (const e of m.inestables) L.push(`- \`${e.fichero}\` (run ${e.run})`);
  if ((m.avisos || []).length) { L.push('', '## Avisos de la recolección', ''); for (const a of m.avisos) L.push(`- ${a}`); }
  return L.join('\n') + '\n';
}

// Entradas de un zip (`actions/artifacts/<id>/zip`) ⇒ `[{ nombre, datos: Buffer }]`.
// Solo lo que sube `actions/upload-artifact@v4`: método 0 (stored) o 8
// (deflate), leídos por el directorio central (los tamaños de la cabecera local
// pueden venir a 0 con data descriptor). Sin E/S: `zlib` solo descomprime.
function leerZip(buf) {
  const b = Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip sin directorio central');
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: entrada del directorio central corrupta');
    const metodo = b.readUInt16LE(p + 10), comp = b.readUInt32LE(p + 20);
    const ln = b.readUInt16LE(p + 28), lx = b.readUInt16LE(p + 30), lc = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const nombre = b.slice(p + 46, p + 46 + ln).toString('utf8');
    p += 46 + ln + lx + lc;
    if (nombre.endsWith('/')) continue;
    const ini = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const crudo = b.slice(ini, ini + comp);
    if (metodo === 0) out.push({ nombre, datos: crudo });
    else if (metodo === 8) out.push({ nombre, datos: require('zlib').inflateRawSync(crudo) });
    else throw new Error(`zip: método ${metodo} no soportado (${nombre})`);
  }
  return out;
}

// Un run ⇒ su punto de la serie. `reportes` (informes JSON de sus artifacts) gana
// sobre `logs` (texto de cada job); sin ninguno de los dos con datos ⇒ `null`.
function punto({ fecha, run, reportes, logs }) {
  if ((reportes || []).length) {
    const ag = agregar(reportes);
    return { fecha, run, fuente: 'artifact', tests: ag.tests, msTotal: ag.msTotal, msPared: null, agregado: ag };
  }
  const xs = (logs || []).map(agregarDesdeLog).filter(Boolean);
  if (!xs.length) return null;
  const suma = k => (xs.some(x => x[k] != null) ? xs.reduce((t, x) => t + (x[k] || 0), 0) : null);
  return { fecha, run, fuente: 'log', tests: suma('tests'), msTotal: suma('msTotal'), msPared: suma('msPared') };
}

// Lo que recoge el step ⇒ `metricas.json`. `dias` y `semanas` = `[{ fecha, run,
// reportes?, logs? }]`. La serie de tendencia es un punto por semana: las
// `semanas` anteriores, de la más antigua a la más reciente, y el último día con
// datos de la semana actual. El top y los directorios salen del punto `artifact`
// más reciente (sin ninguno, vacíos y el informe lo dice).
function componer(e) {
  const sinAg = p => { const { agregado, ...r } = p; return r; };
  const dias = (e.dias || []).map(punto).filter(Boolean).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const sems = (e.semanas || []).map(punto).filter(Boolean).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const serie = [...sems, ...dias.slice(-1)];
  const conDetalle = [...sems, ...dias].filter(p => p.agregado).pop() || null;
  return {
    repo: e.repo, rama: e.rama, modo: e.modo, generado: e.generado, semana: semanaIso(e.generado),
    hayArtifacts: [...sems, ...dias].some(p => p.fuente === 'artifact'),
    serie: serie.map(sinAg), dias: dias.map(sinAg), tendencia: tendencia(serie.map(sinAg)),
    detalleDe: conDetalle ? { fecha: conDetalle.fecha, run: conDetalle.run } : null,
    top: conDetalle ? top(conDetalle.agregado, e.nTop || 20) : [],
    directorios: conDetalle ? porDirectorio(conDetalle.agregado, e.nDir || 10) : [],
    porFichero: conDetalle ? conDetalle.agregado.porFichero : [],
    runsRojos: e.runsRojos == null ? null : e.runsRojos,
    rojos: rojos(e.anotaciones), inestables: inestables(e.ejecuciones),
    avisos: e.avisos || [],
  };
}

// Semana ISO `AAAA-Www` de una fecha (título del issue de estado).
function semanaIso(fecha) {
  const x = new Date(fecha);
  const t = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const ini = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t - ini) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

module.exports = {
  relativo, agregar, top, porDirectorio, tendencia, clasificarFallo,
  normalizarLog, agregarDesdeLog, inestables, rojos, seleccionarRuns, informeMd, semanaIso,
  leerZip, punto, componer,
};
