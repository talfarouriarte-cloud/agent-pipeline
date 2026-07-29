#!/usr/bin/env node
// check-resolve-rerun — banco de casos de `watchdog-resolve-rerun.cjs`
// (AP-077, repesca finplan#1741 / aud. finplan#1743).
//
// El belt que materializa el ruling de re-run del resolver tiene dos capas que
// se pueden romper por separado, y las dos en silencio:
//   · DETECCIÓN — qué cuenta como ruling EMITIDO (ancla + despojo de código).
//     Una regex relajada convierte una CITA en una orden; una regex rota deja
//     el belt mudo y el episodio de finplan#1741 vuelve entero.
//   · RUNTIME — los guards que deciden si se re-lanza (PR abierto, kill-switch
//     por label, cap 1 por head SHA, CI del head vigente en rojo, rojo NO
//     atribuible) y el orden ejecutar-antes-de-afirmar. Aquí el fallo caro no
//     es no actuar: es actuar donde no se debía (enmascarar una regresión real
//     a base de re-runs) o afirmar un re-run que no ocurrió.
//
// Se ejecuta `run` contra un DOBLE de la API, no una copia de su lógica: la
// costura módulo↔stub (nombres de env, forma de los parámetros) es justo lo que
// un banco de funciones puras no ve, y es lo que el stub no puede arreglar sin
// un humano (vive en `.github/workflows/**`, ADR-020).
//
// Cuelga del piggyback de `check-embedded-js.mjs` por la misma razón que sus
// hermanos: su paso propio de `ci.yml` viajaría dentro del parche pendiente que
// vigila.
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

// El central lo tiene en `vendored/`; el workspace del consumidor lo recibe en
// `scripts/` por el graft (AP-009). Se prueba el del central primero: es el
// fichero FUENTE, y es el que un PR modifica.
const FUENTES = [
  'vendored/scripts/watchdog-resolve-rerun.cjs',
  'scripts/watchdog-resolve-rerun.cjs',
];

let fuente = null;
let belt = null;
for (const f of FUENTES) {
  if (!existsSync(f)) continue;
  belt = require(resolve(f));   // un SyntaxError aquí es ROJO, y debe serlo
  fuente = f;
  break;
}
if (!belt) {
  // Fail-open ANUNCIADO, nunca mudo: si el módulo no está, no hay nada que
  // juzgar — pero que no lo haya tiene que verse.
  console.log('::warning::check-resolve-rerun — no encuentro `watchdog-resolve-rerun.cjs` en ninguna de sus dos ubicaciones: el banco NO se ha ejecutado.');
  process.exit(0);
}

if (typeof belt !== 'function') {
  console.error('CHECK-RESOLVE-RERUN ROJO: `watchdog-resolve-rerun.cjs` ya no exporta el runtime como función — el stub de `watchdog.yml` hace `belt({...})` y reventaría en cada corrida.');
  process.exit(1);
}

// `PATRONES` COMPLETO — misma aserción que `check-resolve-detection` sobre
// AP-064, y la única del banco que mira el TEXTO del módulo y no su conducta:
// lo que se juzga aquí es que la declaración y el código no divergen.
const fuenteTxt = readFileSync(fuente, 'utf8');
const REGEX_DECL = [...fuenteTxt.matchAll(/^const ([A-Z][A-Z_0-9]*) = \//gm)].map((m) => m[1]);
const PATRONES = belt.PATRONES || {};
const faltan = REGEX_DECL.filter((n) => !(n in PATRONES));
const sobran = Object.keys(PATRONES).filter((n) => !REGEX_DECL.includes(n));
if (!REGEX_DECL.length) {
  console.error(`CHECK-RESOLVE-RERUN ROJO: no encuentro ningún \`const X = /…/\` en ${fuente} — la aserción de \`PATRONES\` sería vacua (pasaría con el módulo entero reescrito).`);
  process.exit(1);
}
if (faltan.length || sobran.length) {
  console.error(`CHECK-RESOLVE-RERUN ROJO: \`PATRONES\` no es el vocabulario de decisión completo de ${fuente}${faltan.length ? ` — falta(n) ${faltan.join(', ')}` : ''}${sobran.length ? ` — sobra(n) ${sobran.join(', ')}` : ''}.`);
  process.exit(1);
}

const errores = [];
const lineas = [];
const RULING = '<!-- watchdog-resolve-rerun -->';
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

// ── Capa 1: DETECCIÓN (función pura `despojar` + el ancla `RULING`) ──────────
// Se ejercita el par real exportado por el módulo, no una copia de la regex.
const emitido = (txt) => belt.PATRONES.RULING.test(belt.despojar(txt));
const CASOS_DET = [
  ['emitido en línea propia', `El rojo es de contención.\n${RULING}\n`, true],
  ['emitido con sangría de lista (3 espacios)', `- ruling:\n   ${RULING}\n`, true],
  ['CITADO en bloque cercado con ```', `Se declara así:\n\`\`\`\n${RULING}\n\`\`\`\n`, false],
  ['CITADO en bloque cercado con ~~~', `Se declara así:\n~~~\n${RULING}\n~~~\n`, false],
  ['CITADO entre backticks en línea', `El marcador \`${RULING}\` va anclado.`, false],
  ['CITADO en bloque INDENTADO (4 espacios)', `Ejemplo:\n\n    ${RULING}\n`, false],
  ['pegado a otro texto en la misma línea NO es emisión', `ver ${RULING} aquí`, false],
  ['el marcador de MATERIALIZACIÓN no es el de ruling', `<!-- watchdog-resolve-rerun-materializado: ${HEAD} -->\n`, false],
  ['comentario sin marcador alguno', 'CI rojo; re-lanzo los jobs fallidos.', false],
];
for (const [nombre, txt, esperado] of CASOS_DET) {
  const got = emitido(txt);
  if (got !== esperado) errores.push(`detección — ${nombre}: esperado ${esperado}, obtenido ${got}`);
  else lineas.push(`  · detección — ${nombre}: ${got ? 'EMITIDO' : 'no emitido'}`);
}

// ── Capa 2: RUNTIME contra un doble de la API ───────────────────────────────
// El doble registra ESCRITURAS (`reRunWorkflowFailedJobs`, `createComment`),
// no éxitos: las aserciones negativas de este banco («no se re-lanzó») serían
// vacuas sin el caso de control que SÍ escribe.
async function correr({
  declaracion = RULING,
  creadoHace,                       // ms de antigüedad del comentario fresco
  pr = {},                          // override de `pulls.get`
  comentariosPR = [],               // historial del PR (cap)
  ciRuns,                           // runs de CI del head
  anotaciones = [{ annotation_level: 'failure', path: 'test/ajeno.test.ts' }],
  ficherosPR = [{ filename: 'src/tocado.ts' }],
  rerunErr,
  comentarioErr,                    // error de `createComment` (siempre)
  comentarioErrPrimero,             // error solo de la PRIMERA llamada (⇒ reintento mínimo)
  barridoErr,
  paginasRelleno = 0,               // páginas extra del barrido (para el tope MAX_PAGS)
  envCiWf = 'CI',
  envSkip,
  skipLabels,
} = {}) {
  const escrituras = [];
  const cuerpos = [];
  const avisos = [];
  let params = null;              // lo que el belt le pide al barrido fresco
  let fallóPrimero = false;
  const ahora = new Date().toISOString();
  const runStartedAt = new Date(Date.now() - 60_000).toISOString();
  const comentario = {
    id: 1,
    issue_url: 'https://api.github.com/repos/o/r/issues/1741',
    body: declaracion,
    html_url: 'https://example/ruling',
    created_at: creadoHace == null ? ahora : new Date(Date.now() - creadoHace).toISOString(),
    updated_at: ahora,
  };
  const runs = ciRuns === undefined
    ? [{ id: 777, name: 'CI', status: 'completed', conclusion: 'failure', created_at: ahora }]
    : ciRuns;

  const paginate = async (fn) => {
    if (fn === 'listComments') return comentariosPR;
    if (fn === 'listFiles') return ficherosPR;
    return [];
  };
  // El barrido registra lo que se le PIDE (`params`): con `desc` el truncado
  // por `MAX_PAGS` muerde lo más antiguo, y el ruling —que es lo más reciente—
  // llega en la primera página. Las páginas de relleno empujan al belt contra
  // su tope sin cambiar lo que deriva.
  paginate.iterator = async function* (_fn, p) {
    params = p;
    if (barridoErr) throw barridoErr;
    yield { data: [comentario] };
    for (let i = 0; i < paginasRelleno; i++) {
      yield { data: [{ id: 100 + i, issue_url: 'https://api.github.com/repos/o/r/issues/9', body: 'relleno', html_url: 'https://example/x', created_at: ahora, updated_at: ahora }] };
    }
  };

  const github = {
    paginate,
    rest: {
      actions: {
        getWorkflowRun: async () => ({ data: { run_started_at: runStartedAt } }),
        listWorkflowRunsForRepo: async () => ({ data: { workflow_runs: runs } }),
        listJobsForWorkflowRun: async () => ({ data: { jobs: [{ id: 9, conclusion: 'failure' }] } }),
        reRunWorkflowFailedJobs: async ({ run_id }) => { escrituras.push(`rerun#${run_id}`); if (rerunErr) throw rerunErr; },
      },
      checks: { listAnnotations: async () => ({ data: anotaciones }) },
      issues: {
        listComments: 'listComments',
        listCommentsForRepo: 'listCommentsForRepo',
        createComment: async ({ issue_number, body }) => {
          escrituras.push(`createComment#${issue_number}`);
          if (comentarioErr) throw comentarioErr;
          if (comentarioErrPrimero && cuerpos.length === 0 && !fallóPrimero) { fallóPrimero = true; throw comentarioErrPrimero; }
          cuerpos.push(body);
        },
      },
      pulls: {
        get: async ({ pull_number }) => ({ data: { number: pull_number, state: 'open', labels: [], head: { sha: HEAD }, ...pr } }),
        listFiles: 'listFiles',
      },
    },
  };
  const core = { info() {}, notice() {}, warning(m) { avisos.push(m); } };
  const context = { repo: { owner: 'o', repo: 'r' }, eventName: 'schedule', runId: 42 };

  const previoSkip = process.env.IN_SKIP_LABELS;
  const previoCi = process.env.IN_CI_WF;
  if (envSkip === undefined) delete process.env.IN_SKIP_LABELS; else process.env.IN_SKIP_LABELS = envSkip;
  if (envCiWf === undefined) delete process.env.IN_CI_WF; else process.env.IN_CI_WF = envCiWf;
  try {
    await belt({ github, context, core, skipLabels });
  } finally {
    if (previoSkip === undefined) delete process.env.IN_SKIP_LABELS; else process.env.IN_SKIP_LABELS = previoSkip;
    if (previoCi === undefined) delete process.env.IN_CI_WF; else process.env.IN_CI_WF = previoCi;
  }
  return { escrituras, cuerpos, avisos, params };
}

const SKIP = 'pause-agents,human-needed';
const CONTRATO = [
  // CONTROL que SÍ escribe: sin él, todas las negativas de abajo son vacuas.
  ['control — ruling emitido sobre rojo no atribuible ⇒ re-run + comentario',
    {},
    (r) => r.escrituras.join(',') === 'rerun#777,createComment#1741'
      && r.cuerpos[0].includes(`<!-- watchdog-resolve-rerun-materializado: ${HEAD} -->`)],
  ['el comentario NO despierta a nadie (sin `@claude` ni ping-creator)',
    {},
    (r) => !/@claude/.test(r.cuerpos[0]) && !/ping-creator/.test(r.cuerpos[0])],
  ['ruling CITADO entre backticks ⇒ cero escrituras',
    { declaracion: `Declara el ruling con \`${RULING}\` y el post-step lo ejecuta.` },
    (r) => r.escrituras.length === 0],
  ['cap 1 por head SHA agotado ⇒ no se re-lanza',
    { comentariosPR: [{ body: `previo\n<!-- watchdog-resolve-rerun-materializado: ${HEAD} -->` }] },
    (r) => r.escrituras.length === 0],
  ['cap de OTRO head no bloquea este (el cap es por head, no por PR)',
    { comentariosPR: [{ body: '<!-- watchdog-resolve-rerun-materializado: 0000000000000000000000000000000000000000 -->' }] },
    (r) => r.escrituras.join(',') === 'rerun#777,createComment#1741'],
  ['rojo ATRIBUIBLE al diff ⇒ no se re-lanza (esa vía es ping-creator)',
    { anotaciones: [{ annotation_level: 'failure', path: 'src/tocado.ts' }] },
    (r) => r.escrituras.length === 0 && r.avisos.some((a) => /ATRIBUIBLE/.test(a))],
  // El BORDE de la atribuibilidad, que es donde vive la semántica del
  // guard-rail 3: «atribuible» es TODOS los ficheros fallidos dentro del diff,
  // no ALGUNO. Sin este caso mixto, `every` → `some` pasa verde y el belt deja
  // de re-lanzar rojos que sí le tocan (medido: con solo los dos casos
  // homogéneos, la mutación sobrevive).
  ['rojo MIXTO (un fichero del diff + otro ajeno) NO es atribuible ⇒ se re-lanza',
    { anotaciones: [{ annotation_level: 'failure', path: 'src/tocado.ts' }, { annotation_level: 'failure', path: 'test/ajeno.test.ts' }] },
    (r) => r.escrituras.join(',') === 'rerun#777,createComment#1741'],
  ['las anotaciones que no son de fallo no cuentan como atribuibles',
    { anotaciones: [{ annotation_level: 'warning', path: 'src/tocado.ts' }] },
    (r) => r.escrituras.includes('rerun#777') && /no recomputable/.test(r.cuerpos[0])],
  ['atribuibilidad ILEGIBLE (sin anotaciones) ⇒ se re-lanza igual, y se dice',
    { anotaciones: [] },
    (r) => r.escrituras.includes('rerun#777') && /no recomputable/.test(r.cuerpos[0])],
  ['kill-switch por PARÁMETRO (`skipLabels`)',
    { pr: { labels: [{ name: 'human-needed' }] }, skipLabels: SKIP },
    (r) => r.escrituras.length === 0],
  ['kill-switch por ENV (costura módulo↔stub: `IN_SKIP_LABELS`)',
    { pr: { labels: [{ name: 'pause-agents' }] }, envSkip: SKIP },
    (r) => r.escrituras.length === 0],
  ['`stalled` NO es kill-switch (es la label que convoca al resolver)',
    { pr: { labels: [{ name: 'stalled' }] }, skipLabels: SKIP },
    (r) => r.escrituras.includes('rerun#777')],
  ['PR ya cerrado ⇒ nada que re-lanzar',
    { pr: { state: 'closed' } },
    (r) => r.escrituras.length === 0],
  ['CI del head vigente en VERDE ⇒ el ruling ya no describe el estado',
    { ciRuns: [{ id: 777, name: 'CI', status: 'completed', conclusion: 'success', created_at: new Date().toISOString() }] },
    (r) => r.escrituras.length === 0],
  ['CI del head aún EN CURSO ⇒ no se toca',
    { ciRuns: [{ id: 777, name: 'CI', status: 'in_progress', conclusion: null, created_at: new Date().toISOString() }] },
    (r) => r.escrituras.length === 0],
  ['sin run de CI para el head ⇒ no se toca',
    { ciRuns: [] },
    (r) => r.escrituras.length === 0],
  ['`IN_CI_WF` vacío ⇒ fail-closed anunciado',
    { envCiWf: '' },
    (r) => r.escrituras.length === 0 && r.avisos.some((a) => /IN_CI_WF/.test(a))],
  ['el re-run FALLA ⇒ no se afirma nada y NO se deja marcador (el cap sigue libre)',
    { rerunErr: new Error('403') },
    (r) => r.escrituras.join(',') === 'rerun#777' && r.cuerpos.length === 0],
  ['comentario que entró por `updated_at` (edición vieja) ⇒ fuera de ventana',
    { creadoHace: 3 * 60 * 60 * 1000 },
    (r) => r.escrituras.length === 0],
  ['barrido fresco caído ⇒ belt MUDO y anunciado',
    { barridoErr: new Error('502') },
    (r) => r.escrituras.length === 0 && r.avisos.some((a) => /MUDO/.test(a))],
  // El truncado tiene que morder por el extremo que NO importa: el ruling es
  // el comentario más reciente de la ventana (este belt corre al cerrar la
  // etapa que lo emite), luego el barrido va en `desc` y el corte se come lo
  // antiguo. En `asc` el corte se comería justo el ruling — el belt quedaría
  // mudo en el único caso en que hace falta (residual que AP-069/AP-070 ya
  // cerraron para el belt hermano).
  ['el barrido pide `desc` (el truncado muerde lo ANTIGUO, no el ruling)',
    {},
    (r) => r.params && r.params.direction === 'desc' && r.params.per_page === 100],
  ['barrido TRUNCADO por MAX_PAGS ⇒ el ruling (primera página en `desc`) SIGUE materializándose, y se anuncia',
    { paginasRelleno: 30 },
    (r) => r.escrituras.includes('rerun#777') && r.avisos.some((a) => /TRUNCADO/.test(a))],
  // El re-run YA ocurrió: el comentario es el ÚNICO soporte del cap, y perderlo
  // deja la puerta abierta a un segundo re-run sobre el mismo head.
  ['comentario largo caído tras un re-run EJECUTADO ⇒ reintento mínimo que SÍ lleva el marcador',
    { comentarioErrPrimero: new Error('502') },
    (r) => r.escrituras.join(',') === 'rerun#777,createComment#1741,createComment#1741'
      && r.cuerpos.length === 1 && r.cuerpos[0].includes(`<!-- watchdog-resolve-rerun-materializado: ${HEAD} -->`)],
  // Sin marcador publicado NO se declara «ruling materializado»: ese aviso es
  // el rastro que el Auditor cuenta, y emitirlo sobre un cap sin soporte es
  // afirmar un estado que no existe — la clase que este belt cierra, dentro
  // del belt. (Es lo que hace load-bearing al guard `if (!marcado) continue`.)
  ['los DOS comentarios caídos ⇒ no se lanza, se dice que el cap queda SIN soporte y NO se declara materializado',
    { comentarioErr: new Error('502') },
    (r) => r.avisos.some((a) => /SIN soporte/.test(a)) && !r.avisos.some((a) => /ruling materializado/.test(a))],
];

for (const [nombre, opts, ok] of CONTRATO) {
  let r;
  try { r = await correr(opts); }
  catch (e) { errores.push(`runtime — ${nombre}: lanzó ${e.message}`); continue; }
  if (!ok(r)) errores.push(`runtime — ${nombre}: escrituras=[${r.escrituras.join(', ')}] avisos=[${r.avisos.join(' | ')}]`);
  else lineas.push(`  · runtime — ${nombre}`);
}

if (process.env.RESOLVE_RERUN_VERBOSE) lineas.forEach((l) => console.log(l));
if (errores.length) {
  console.error('CHECK-RESOLVE-RERUN ROJO:');
  errores.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}
console.log(`check-resolve-rerun verde: ${CASOS_DET.length} casos de detección sobre el par REAL \`despojar\`+\`RULING\` de ${fuente} + ${CONTRATO.length} aserciones de runtime ejecutando \`run\` contra un doble de la API (control que escribe, cap 1 por head SHA, filtro no-atribuible, kill-switch por parámetro y por env, frescura del rojo, ejecutar-antes-de-afirmar y los dos fail-open anunciados).`);
