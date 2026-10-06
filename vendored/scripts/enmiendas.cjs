'use strict';
// enmiendas — enmiendas en vuelo y disparos diferidos (central#327, ruling
// mensual 2026-10-06). Lo consumen, con `require`, los cuatro puntos del ruling:
// el guard de vuelo único (`check_flight`, solo escribe `disparo-pendiente`), la
// entrega al cierre del turno y la foto pre-sesión del Creator (`claude-code.yml`),
// el post-step de estado del Reviewer (`reviewer.yml`) y el gate de merge
// (`epic-merge.yml`). Una sola lectura de marcadores en vez de cuatro copias.
//
// MARCADORES (todos en LÍNEA PROPIA del cuerpo despojado de código: citarlos
// entre backticks o en un bloque cercado no cuenta — clase AP-063):
//   <!-- enmienda -->                       comentario de CONFIANZA (TRUSTED) sobre el
//                                           issue o su PR; su id de comentario es su
//                                           identidad. No lleva ping.
//   <!-- disparo-pendiente: <id> -->        lo deja `check_flight` (token del job,
//                                           `github-actions[bot]`) al ceder ante un
//                                           Creator en vuelo; <id> = el comentario/review
//                                           del ping diferido.
//   <!-- rearm-enmienda: <ids> -->          re-arm con ping al Creator (PAT ⇒ TRUSTED);
//                                           <ids> = conjunto ordenado entregado. Dedupe:
//                                           nunca dos re-arms por el mismo conjunto.
//   <!-- rearm-enmienda-run: <run_id> -->   va con el re-arm de la entrega: `check_flight`
//                                           no cuenta ese run (ya en post-steps) como
//                                           Creator en vuelo contra su propio re-arm.
//   <!-- enmienda-aplicada: <id> -->        acuse del Creator (`claude[bot]` o TRUSTED).
//   <!-- enmienda-rechazada: <id> -->       acuse con rechazo ⇒ `human-needed`.
//   <!-- enmienda-rechazo-escalado: <ids> --> el post-step ya pasó esos rechazos al humano.
//   <!-- rearm-enmienda-tope -->            tope de re-arms superado ⇒ `human-needed`.
//   <!-- enmienda-sin-acuse-tras-rearm -->  un turno real acabó sin acusar un conjunto ya
//                                           re-armado ⇒ `human-needed` (sin bloqueo mudo).
//
// QUÉ NO. No cambia el árbitro de vuelo único (menor `run_id`), solo su salida.
//
// POR QUÉ VIVE AQUÍ (AP-068): el cuerpo embebido en `.github/workflows/**` no lo
// puede pushear un agente ni lo ejecuta un banco; aquí lo gatea el CI del central
// (`scripts/check-enmiendas.mjs`). Zona de rigor `vendored/`: todo diff despliega a
// los DOS consumidores en su siguiente run.

const { despojarCodigo } = require('./resolve-cross-issue-failsafe.cjs');

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const CREATOR_LOGIN = 'claude[bot]';
const JOB_LOGIN = 'github-actions[bot]';
const TOPE = 3;
const VENTANA_MS = 24 * 60 * 60 * 1000;

const ENMIENDA_RE = /^[ \t]*<!--\s*enmienda\s*-->[ \t]*$/m;
const DISPARO_RE = /^[ \t]*<!--\s*disparo-pendiente:\s*(\d+)\s*-->[ \t]*$/gm;
const REARM_RE = /^[ \t]*<!--\s*rearm-enmienda:\s*(\d+(?:\s*,\s*\d+)*)\s*-->[ \t]*$/gm;
const ACK_RE = /^[ \t]*<!--\s*enmienda-(aplicada|rechazada):\s*(\d+(?:\s*,\s*\d+)*)\s*-->[ \t]*$/gm;
const ESCALADO_RE = /^[ \t]*<!--\s*enmienda-rechazo-escalado:\s*(\d+(?:\s*,\s*\d+)*)\s*-->[ \t]*$/gm;
const TOPE_RE = /^[ \t]*<!--\s*rearm-enmienda-tope\s*-->[ \t]*$/m;

const ids = (s) => String(s).split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
const clave = (lista) => [...new Set(lista.map(Number))].sort((a, b) => a - b).join(',');
const login = (c) => (c && c.user && c.user.login) || '';
const confiable = (c) => !!c && TRUSTED.has(c.author_association);
const deCreator = (c) => confiable(c) || login(c) === CREATOR_LOGIN;
const deJob = (c) => confiable(c) || login(c) === JOB_LOGIN;
const todos = (re, txt) => [...txt.matchAll(re)];

const marcaDisparo = (id) => `<!-- disparo-pendiente: ${Number(id)} -->`;
const marcaRearm = (lista) => `<!-- rearm-enmienda: ${clave(lista)} -->`;

// Lectura única de los comentarios de un ítem (issue + su PR). Cada comentario
// llega con `item` (número donde vive). Devuelve el estado de enmiendas.
function escanear(comentarios) {
  const enmiendas = [];
  const disparos = [];
  const rearms = [];
  const acuses = new Map();          // id → 'aplicada' | 'rechazada'
  const acuseItems = new Map();      // id → Set(items donde consta el acuse)
  const escalados = new Set();
  let topes = 0;
  for (const c of comentarios || []) {
    if (!c) continue;
    const txt = despojarCodigo(c.body);
    if (confiable(c) && ENMIENDA_RE.test(txt)) {
      enmiendas.push({ id: Number(c.id), url: c.html_url || '', item: c.item, at: c.created_at });
    }
    if (deJob(c)) {
      for (const m of todos(DISPARO_RE, txt)) disparos.push({ id: Number(m[1]), url: c.html_url || '', item: c.item, at: c.created_at });
    }
    if (confiable(c)) {
      for (const m of todos(REARM_RE, txt)) rearms.push({ ids: ids(m[1]), clave: clave(ids(m[1])), at: c.created_at, item: c.item });
      for (const m of todos(ESCALADO_RE, txt)) for (const id of ids(m[1])) escalados.add(id);
      if (TOPE_RE.test(txt)) topes++;
    }
    if (deCreator(c)) {
      for (const m of todos(ACK_RE, txt)) {
        for (const id of ids(m[2])) {
          // Un rechazo no se rebaja a aplicada por un acuse posterior ambiguo:
          // el humano tiene el turno hasta que lo resuelva.
          if (acuses.get(id) !== 'rechazada') acuses.set(id, m[1]);
          if (!acuseItems.has(id)) acuseItems.set(id, new Set());
          acuseItems.get(id).add(c.item);
        }
      }
    }
  }
  return { enmiendas, disparos, rearms, acuses, acuseItems, escalados, topes };
}

// Acuses de enmiendas del ISSUE que solo constan en su PR. Un PR posterior del
// mismo issue (relanzamiento de un parcial) no lee los comentarios del anterior:
// sin reflejo en el issue, la enmienda volvería a salir sin acuse. Devuelve los
// ids a reflejar por tipo.
function acusesAReflejar(estado, issue) {
  const out = { aplicada: [], rechazada: [] };
  if (!issue) return out;
  for (const e of estado.enmiendas) {
    if (e.item !== issue || !estado.acuses.has(e.id)) continue;
    if (estado.acuseItems.get(e.id).has(issue)) continue;
    out[estado.acuses.get(e.id)].push(e.id);
  }
  return out;
}

function cuerpoReflejo(r, pr) {
  return [
    `**Enmiendas en vuelo (central#327)**: acuse(s) del Creator en #${pr}, reflejados en el issue para que un PR posterior de este mismo issue los vea.`,
    '',
    ...(r.aplicada.length ? [`<!-- enmienda-aplicada: ${clave(r.aplicada)} -->`] : []),
    ...(r.rechazada.length ? [`<!-- enmienda-rechazada: ${clave(r.rechazada)} -->`, `<!-- enmienda-rechazo-escalado: ${clave(r.rechazada)} -->`] : []),
  ].join('\n');
}

// Lo que sigue pendiente: enmiendas sin acuse, disparos nunca entregados
// (su id no figura en ningún `rearm-enmienda` de confianza) y rechazos aún no
// pasados al humano.
function pendientes(estado) {
  const entregados = new Set(estado.rearms.flatMap((r) => r.ids));
  const enmiendas = estado.enmiendas.filter((e) => !estado.acuses.has(e.id));
  const vistos = new Set();
  const disparos = estado.disparos.filter((d) => {
    if (entregados.has(d.id) || vistos.has(d.id)) return false;
    vistos.add(d.id);
    return true;
  });
  const rechazadas = estado.enmiendas.filter((e) => estado.acuses.get(e.id) === 'rechazada' && !estado.escalados.has(e.id));
  return { enmiendas, disparos, rechazadas };
}

// Plan de entrega. `accion`:
//   'nada'       — nada pendiente;
//   'duplicado'  — ya hubo un re-arm por EXACTAMENTE este conjunto (dedupe);
//   'tope'       — ≥ TOPE re-arms en la ventana ⇒ `human-needed`, sin re-arm;
//   'rearm'      — un comentario de re-arm con ping (cuerpo en `cuerpo`).
// `soloEnmiendas` (Reviewer): los disparos diferidos los entrega el cierre del
// turno del Creator, no el Reviewer. `runId`: el run que publica el re-arm.
function planificar(estado, { ahora = Date.now(), tope = TOPE, ventanaMs = VENTANA_MS, origen = 'entrega', runId = null, soloEnmiendas = false } = {}) {
  const p = pendientes(estado);
  if (soloEnmiendas) p.disparos = [];
  const lista = [...p.enmiendas.map((e) => e.id), ...p.disparos.map((d) => d.id)];
  if (!lista.length) return { accion: 'nada', ids: [], pendientes: p };
  const k = clave(lista);
  if (estado.rearms.some((r) => r.clave === k)) return { accion: 'duplicado', ids: k.split(',').map(Number), pendientes: p };
  const recientes = estado.rearms.filter((r) => ahora - new Date(r.at).getTime() < ventanaMs).length;
  if (recientes >= tope) return { accion: 'tope', ids: k.split(',').map(Number), recientes, pendientes: p };
  return { accion: 'rearm', ids: k.split(',').map(Number), pendientes: p, cuerpo: cuerpoRearm(p, k, origen, runId) };
}

function listado(p) {
  return [
    ...p.enmiendas.map((e) => `- enmienda sin acuse \`${e.id}\`${e.item ? ` (#${e.item})` : ''}: ${e.url}`),
    ...p.disparos.map((d) => `- disparo diferido \`${d.id}\`${d.item ? ` (#${d.item})` : ''}: ${d.url}`),
  ].join('\n');
}

function cuerpoRearm(p, k, origen, runId = null) {
  const porque = origen === 'reviewer'
    ? 'el Reviewer emitió `LGTM` con enmiendas sin acuse: el veredicto no cuenta y la label `lgtm` queda retirada hasta el acuse (sin ronda nueva de revisión).'
    : 'al cerrar el turno del Creator quedaban pendientes:';
  return [
    '@claude',
    '',
    `**Enmiendas en vuelo (central#327)** — ${porque}`,
    '',
    listado(p),
    '',
    'Lee cada enlace COMPLETO (por API: el marcador no llega a tu contexto), aplícalo y acusa CADA id en tu comentario de seguimiento, en línea propia: `enmienda-aplicada: <id>` (o `enmienda-rechazada: <id>` + motivo, que pasa el turno al humano), envuelto en un comentario HTML. Un disparo diferido es un ping normal: atiéndelo como tal. Nada mergea mientras quede una enmienda sin acuse.',
    '',
    '<!-- ping-creator -->',
    marcaRearm(k.split(',')),
    ...(Number(runId) > 0 ? [`<!-- rearm-enmienda-run: ${Number(runId)} -->`] : []),
  ].join('\n');
}

function cuerpoTope(plan) {
  return [
    `**Enmiendas en vuelo (central#327) — tope de re-arms**: ya hubo ${plan.recientes} \`rearm-enmienda\` en 24 h sobre este ítem y sigue pendiente:`,
    '',
    listado(plan.pendientes),
    '',
    'No se re-arma más: `human-needed`. El humano decide (aplicar a mano, re-armar con un ping explícito o retirar la enmienda).',
    '',
    '<!-- rearm-enmienda-tope -->',
  ].join('\n');
}

function cuerpoSinAcuse(plan) {
  return [
    '**Enmiendas en vuelo (central#327) — sin acuse tras su re-arm**: el Creator ya fue re-armado por este mismo conjunto y su turno terminó sin acusarlo:',
    '',
    listado(plan.pendientes),
    '',
    'No se re-arma dos veces por el mismo conjunto: `human-needed`. El humano decide (acusar a mano, re-armar con un ping explícito o retirar la enmienda).',
    '',
    '<!-- enmienda-sin-acuse-tras-rearm -->',
  ].join('\n');
}

function cuerpoRechazo(rechazadas) {
  return [
    '**Enmiendas en vuelo (central#327) — enmienda rechazada por el Creator**: el turno pasa al humano (`human-needed`).',
    '',
    ...rechazadas.map((e) => `- enmienda \`${e.id}\`: ${e.url}`),
    '',
    'El motivo está en el comentario de seguimiento del Creator. Al resolverlo, retira `human-needed` y re-arma con un ping explícito.',
    '',
    `<!-- enmienda-rechazo-escalado: ${clave(rechazadas.map((e) => e.id))} -->`,
  ].join('\n');
}

// Ítems vinculados: issue de origen y PR abierto de su rama `claude/issue-N-*`.
// `numero` es el del evento; `esPR` si el evento vive en un PR (`headRef` opcional).
async function resolverItems({ github, owner, repo, numero, esPR, headRef, warn = () => {} }) {
  let issue = null;
  let pr = null;
  if (esPR) {
    pr = Number(numero);
    let ref = headRef || '';
    if (!ref) {
      try { ref = (await github.rest.pulls.get({ owner, repo, pull_number: pr })).data.head.ref; }
      catch (e) { warn(`enmiendas: PR #${pr} ilegible (${e.message}); solo se lee el PR.`); }
    }
    const m = String(ref).match(/^claude\/issue-(\d+)-/);
    if (m) issue = Number(m[1]);
  } else {
    issue = Number(numero);
    try {
      const prs = await github.paginate(github.rest.pulls.list, { owner, repo, state: 'open', per_page: 100 });
      const p = prs.find((x) => x.head && String(x.head.ref).startsWith(`claude/issue-${issue}-`));
      if (p) pr = p.number;
    } catch (e) { warn(`enmiendas: no se pudo listar PRs (${e.message}); solo se lee el issue.`); }
  }
  return { issue, pr };
}

// Comentarios del issue y del PR, marcados con su `item`. Lanza si una lectura
// falla: cada consumidor decide su modo de fallo (el gate de merge, cerrado).
async function leer({ github, owner, repo, issue, pr }) {
  const out = [];
  for (const n of [issue, pr]) {
    if (!n) continue;
    const cs = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: n, per_page: 100 });
    for (const c of cs) out.push({ ...c, item: n });
  }
  return out;
}

// Atajo: resolver + leer + escanear.
async function estadoDe(opts) {
  const items = await resolverItems(opts);
  const comentarios = await leer({ ...opts, ...items });
  return { items, estado: escanear(comentarios) };
}

// Foto pre-sesión para el Creator: enmiendas sin acuse con su cuerpo íntegro.
function fotoPendientes(comentarios) {
  const estado = escanear(comentarios);
  const p = pendientes(estado);
  if (!p.enmiendas.length && !p.disparos.length) return '';
  const porId = new Map((comentarios || []).map((c) => [Number(c.id), c]));
  const bloques = p.enmiendas.map((e) => {
    const c = porId.get(e.id);
    return [`## enmienda ${e.id} (#${e.item}, ${e.at || ''})`, e.url, '', String((c && c.body) || '').trim(), ''].join('\n');
  });
  const disp = p.disparos.map((d) => `- disparo diferido ${d.id} (#${d.item}): ${d.url}`);
  return [
    '# Enmiendas sin acuse (foto pre-sesión, central#327)',
    '',
    'Aplica cada una y acusa CADA id en tu comentario de seguimiento, en línea propia, como comentario HTML: `enmienda-aplicada: <id>` o `enmienda-rechazada: <id>` + motivo.',
    '',
    ...bloques,
    ...(disp.length ? ['## disparos diferidos', ...disp, ''] : []),
  ].join('\n');
}

module.exports = {
  TRUSTED, CREATOR_LOGIN, JOB_LOGIN, TOPE, VENTANA_MS,
  ENMIENDA_RE, marcaDisparo, marcaRearm, clave,
  escanear, pendientes, planificar, cuerpoRearm, cuerpoTope, cuerpoRechazo, cuerpoSinAcuse,
  acusesAReflejar, cuerpoReflejo,
  resolverItems, leer, estadoDe, fotoPendientes,
};
