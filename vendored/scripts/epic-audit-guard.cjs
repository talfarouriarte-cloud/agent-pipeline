'use strict';
// epic-audit-guard — guard de rango al consumir `<!-- epic-audit: … -->` y
// dedupe de panel consciente del veredicto (central#368, ruling mensual
// 2026-11-01, posición 4; AP-125). Lo consume `epic-merge.yml` en sus DOS
// consumidores del sentinel: el camino de merge (`postMerge`) y el cierre por
// estado (`postStateClose`, AP-031). El reusable solo hace `require` y la I/O.
//
// QUÉ CIERRA. (1) Un intermedio de épica con el sentinel de fin de cadena (sin
// `launch-next`) creaba el panel con el último eslabón sin entregar
// (asesoramiento#3104/#3105 ⇒ panel #3109). (2) Al mergear después el último
// eslabón, `createAuditIdempotent` adoptaba ese panel —abierto, mismo título—
// aunque ya tuviera `audit-verdict`, y la segunda mitad de la épica quedaba sin
// auditar en silencio.
//
// POR QUÉ VIVE AQUÍ (AP-068): el cuerpo embebido en `.github/workflows/**` no
// lo puede pushear un agente ni lo ejecuta un banco; aquí lo gatea
// `scripts/check-epic-audit-guard.mjs`. Zona `vendored/`: todo diff despliega a
// los DOS consumidores en su siguiente run.

// Primer `#a-#b` del alcance: cubre `ADR-NNN, #a-#b` y `correctivos #a-#b`.
// Sin match ⇒ null ⇒ el guard NO aplica (no se infiere nada de un alcance libre).
const RANGO_RE = /#(\d+)\s*[-–]\s*#(\d+)/;
// Misma regex que el post-step del Auditor (`claude-code.yml`, `RE_VERDICT`).
const RE_VERDICT = /<!--\s*audit-verdict:\s*(clean|findings)\s*-->/;

// Formas literales del ruling: la lista de PENDIENTES, `#N,#M` sin espacios.
const listaMarcador = (ps) => ps.map((n) => '#' + n).join(',');
const marcadorPrematuro = (ps) => `<!-- epic-audit-prematuro: ${listaMarcador(ps)} -->`;
const PREMATURO_RE = /<!--\s*epic-audit-prematuro:\s*(#\d+(?:\s*,\s*#\d+)*)\s*-->/;
const marcadorRangoAbierto = (ps) => `<!-- epic-audit-rango-abierto: ${listaMarcador(ps)} -->`;

function parseRango(scope) {
  const m = String(scope || '').match(RANGO_RE);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return { first: Math.min(a, b), last: Math.max(a, b) };
}

const labelsDe = (i) => (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name));

// Pendientes del rango: issues (no PRs) del intervalo `[first, last]` con la
// label de épica DEL INPUT, distintos del issue que consume el sentinel, en
// estado `open`. Un issue abierto con un `partial-pr` mergeado ES pendiente
// (el estado manda, no el PR); un cerrado `not_planned` NO lo es (retirado).
// Residual declarado: los hijos de partición con número > `last` quedan fuera
// del guard (el rango del Auditor sigue siendo el de `epic-auditor.md`).
function pendientes(issuesDelIntervalo, issueActual, epicLabel, rango) {
  return (issuesDelIntervalo || [])
    .filter((i) => !i.pull_request)
    .filter((i) => !rango || (i.number >= rango.first && i.number <= rango.last))
    .filter((i) => Number(i.number) !== Number(issueActual))
    .filter((i) => labelsDe(i).includes(epicLabel))
    .filter((i) => i.state === 'open')
    .map((i) => Number(i.number))
    .sort((a, b) => a - b);
}

// Decisión al consumir un `epic-audit`:
//  · `crear`: sin rango parseable o sin pendientes ⇒ camino de siempre.
//  · `prematuro`: el issue que lo lleva es un INTERMEDIO (número < `last`) y
//    hay pendientes ⇒ no hay panel ni claim; el sentinel queda sin consumir.
//  · `rango-abierto`: el issue es el último (número >= `last`) pero queda algo
//    abierto en el intervalo (eslabón reabierto, issue ajeno intercalado, issue
//    de épica aún abierto) ⇒ el panel SÍ se crea (fin legítimo de cadena; una
//    épica sin panel es la clase que cerró la cola huérfana) con la lista.
function decidirEpicAudit({ scope, issueNumber, issuesDelIntervalo, epicLabel }) {
  const rango = parseRango(scope);
  if (!rango) return { accion: 'crear', pendientes: [], rango: null };
  const ps = pendientes(issuesDelIntervalo, issueNumber, epicLabel, rango);
  if (!ps.length) return { accion: 'crear', pendientes: [], rango };
  return { accion: Number(issueNumber) < rango.last ? 'prematuro' : 'rango-abierto', pendientes: ps, rango };
}

// Dueño ÚNICO del arm del pendiente menor tras un `prematuro` (crítica ronda
// 3, [J]). En el camino de merge el pop de cola se ejecuta ANTES (la serie se
// libera, AP-014) y puede armar justo a ese pendiente (#3105 en el incidente:
// estaba `en-cola`). `stalled` sobre un issue que ya tiene dueño del arm
// (recién armado por el pop, `serial-activo`, `en-cola`, PR `claude/*`
// abierto) convocaría a architect-resolve a armar trabajo vivo: doble arm.
// Con dueño, el marcador va igual (rastro, dedupe y criterio (5)) pero SIN
// `stalled`: la cadena se cura sola —si el eslabón lleva su `epic-audit`, su
// merge crea el panel; si no lleva sentinel, su merge cae en la cola huérfana—.
// Sin dueño, `stalled` + mandato de re-hornear y armar. Un issue, un dueño.
function destinoPrematuro({ pendienteMenor, labelsPendiente, prAbierto, armadoAhora }) {
  const ls = labelsPendiente || [];
  const motivo = armadoAhora != null && Number(armadoAhora) === Number(pendienteMenor) ? 'armado por el pop de cola de este merge'
    : ls.includes('serial-activo') ? 'serial-activo (Creator en vuelo)'
    : ls.includes('en-cola') ? 'en-cola (sale por la cola)'
    : prAbierto ? 'PR claude/* abierto'
    : null;
  return { issue: Number(pendienteMenor), stalled: !motivo, motivo };
}

function cuerpoPrematuro({ issueConSentinel, pendientes: ps, destino }) {
  const lista = ps.map((n) => '#' + n).join(', ');
  const accion = destino.stalled
    ? `#${destino.issue} no tiene dueño del arm: \`stalled\`. architect-resolve: re-hornea el sentinel en el último eslabón real y arma el siguiente.`
    : `#${destino.issue} ya tiene dueño del arm (${destino.motivo}): sin \`stalled\`, nadie más lo arma. La auditoría la creará el merge del último eslabón si lleva su \`epic-audit\`; si no lleva sentinel, el guard de cola huérfana escala.`;
  return `**epic-merge · epic-audit prematuro**: el sentinel de fin de cadena está en #${issueConSentinel} (intermedio); rango abierto: ${lista}. No se crea la auditoría. ${accion}\n\n${marcadorPrematuro(ps)}`;
}

// ¿El hilo de un panel contiene un veredicto del Auditor?
function tieneVeredicto(comentarios) {
  return (comentarios || []).some((c) => RE_VERDICT.test(c.body || ''));
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Paneles del MISMO alcance: título base exacto o `base (re-auditoría k)`.
function esDelAlcance(titulo, base) {
  return titulo === base || new RegExp(`^${escRe(base)} \\(re-auditoría \\d+\\)$`).test(titulo || '');
}

// Título de la siguiente re-auditoría: N = re-auditorías previas del alcance
// («(re-auditoría k)», abiertas o cerradas) CON veredicto, + 1. Se llega aquí
// solo con el panel base ya juzgado, así que el primero es «(re-auditoría 1)»
// y una tercera consumición da «(re-auditoría 2)», nunca el título base. (La
// prosa del ruling contaba también el panel base; sus casos (g) —la parte
// falsable— fijan esta numeración, y es la que se sigue.)
function tituloReauditoria(base, paneles) {
  const n = (paneles || []).filter((p) => p.title !== base && esDelAlcance(p.title, base) && p.conVeredicto).length + 1;
  return `${base} (re-auditoría ${n})`;
}

// Paso 2 de `createAuditIdempotent`: un panel abierto de título exacto se
// adopta SOLO si no tiene veredicto; con veredicto, la auditoría vigente es
// una re-auditoría con título propio (que nace sin veredicto y se arma en su
// body como cualquier panel).
function decidirAdopcion(candidato, comentariosDelCandidato, panelesDelAlcance, base) {
  if (!candidato) return { adoptar: false, titulo: base };
  if (!tieneVeredicto(comentariosDelCandidato)) return { adoptar: true, titulo: candidato.title };
  return { adoptar: false, titulo: tituloReauditoria(base, panelesDelAlcance) };
}

module.exports = {
  RE_VERDICT, PREMATURO_RE, marcadorPrematuro, marcadorRangoAbierto,
  parseRango, pendientes, decidirEpicAudit, destinoPrematuro, cuerpoPrematuro,
  tieneVeredicto, esDelAlcance, tituloReauditoria, decidirAdopcion,
};
