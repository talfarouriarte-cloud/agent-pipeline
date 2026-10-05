'use strict';
// cola-prioridad — orden de salida de la cola serial (`en-cola`) y cesión
// entre eslabones a una `prioridad:urgente` (central#313, ruling mensual
// 2026-10-05). Lo consumen, con `require`, los CUATRO puntos de cola que el
// protocolo obliga a mantener en espejo —`armQueue` y `sweepQueueAtExit`
// (`epic-merge.yml`), `popQueue` y «Barrido de cola al cierre»
// (`claude-code.yml`)— y los consumidores de `launch-next` (camino de merge y
// cierre por estado AP-031 de `epic-merge.yml`, step `launch_next` de
// `claude-code.yml`). Una sola función de orden en vez de cuatro copias.
//
// ORDEN (ruling, punto 2): (1) `prioridad:urgente`, (2) eslabón suspendido
// (comentario de confianza con el marcador `eslabon-suspendido` en línea propia),
// (3) `prioridad:alta`, (4) resto. Marcador del ruling, con el número del PR
// mergeado que liberó el turno (en un cierre por estado, el del issue cerrado):
// `<!-- eslabon-suspendido: #<PR> -->`. Desempate por antigüedad (`created_at`,
// luego número). Sin etiquetas ni marcador, todo cae en (4) y el orden es el
// FIFO de siempre (caso (d) del banco).
//
// QUÉ NO CAMBIA. CUÁNDO se consulta la cola (`prioridad:alta` espera al fin de
// la épica: solo el orden). La serialidad: la cesión no arma en paralelo, arma
// el urgente EN LUGAR del eslabón siguiente, en el límite entre eslabones. Sin
// preempción a mitad de eslabón (el re-arm de un parcial no cede).
//
// POR QUÉ VIVE AQUÍ (AP-068): el cuerpo embebido en `.github/workflows/**` no
// lo puede pushear un agente ni lo ejecuta un banco; aquí lo gatea el CI del
// central (`scripts/check-cola-prioridad.mjs`). Zona de rigor `vendored/`:
// todo diff despliega a los DOS consumidores en su siguiente run.

const { despojarCodigo } = require('./resolve-cross-issue-failsafe.cjs');

const URGENTE = 'prioridad:urgente';
const ALTA = 'prioridad:alta';
const EN_COLA = 'en-cola';
const marcaSuspendido = (origen) => (Number.isInteger(Number(origen)) && Number(origen) > 0
  ? `<!-- eslabon-suspendido: #${Number(origen)} -->`
  : '<!-- eslabon-suspendido -->');
// Línea propia del cuerpo despojado de código: citar el marcador entre
// backticks o en un bloque cercado no suspende nada (clase AP-063). El número
// es opcional al LEER (un marcador sin él sigue siendo una suspensión); al
// escribir va siempre.
const SUSPENDIDO_RE = /^[ \t]*<!--\s*eslabon-suspendido(?::\s*#?\d+)?\s*-->[ \t]*$/m;
// Mismo gate de actor que `panel-ok`/`epic-auto-launch` en los guards de
// `claude-code.yml`: el marcador lo postea el PAT del propietario.
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const NIVELES = { 1: 'urgente', 2: 'eslabón suspendido', 3: 'alta', 4: 'normal' };

const nombresLabels = (issue) => ((issue && issue.labels) || []).map((l) => (typeof l === 'string' ? l : l.name));

// ¿Algún comentario de confianza declara el issue como eslabón suspendido?
function esSuspendido(comentarios) {
  return (comentarios || []).some((c) => c && TRUSTED.has(c.author_association)
    && SUSPENDIDO_RE.test(despojarCodigo(c.body)));
}

// Nivel de un issue en la cola: 1 urgente, 2 eslabón suspendido, 3 alta, 4 resto.
function nivel(issue, suspendido) {
  const ls = nombresLabels(issue);
  if (ls.includes(URGENTE)) return 1;
  if (suspendido) return 2;
  if (ls.includes(ALTA)) return 3;
  return 4;
}

const antiguedad = (i) => {
  const t = Date.parse(i.created_at || '');
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
};

// Orden puro: issues (sin PRs) anotados con `nivelCola`, ordenados por nivel y
// antigüedad. `suspendidos`: Set de números con el marcador de suspensión.
function ordenarCola(items, suspendidos) {
  const sus = suspendidos || new Set();
  return (items || [])
    .filter((i) => i && !i.pull_request)
    .map((i) => ({ ...i, nivelCola: nivel(i, sus.has(i.number)) }))
    .sort((a, b) => (a.nivelCola - b.nivelCola) || (antiguedad(a) - antiguedad(b)) || (a.number - b.number));
}

// Orden con I/O: lee los comentarios de los no-urgentes para detectar la
// suspensión (los urgentes ya son nivel 1: leerlos no cambiaría nada). Un
// fallo de lectura degrada ESE ítem a su nivel por labels (nunca bloquea la
// cola: el peor caso es el FIFO de antes).
async function ordenarConSuspension({ github, owner, repo, items, warn }) {
  const issues = (items || []).filter((i) => i && !i.pull_request);
  const suspendidos = new Set();
  for (const i of issues) {
    if (nombresLabels(i).includes(URGENTE)) continue;
    try {
      const { data: cs } = await github.rest.issues.listComments({ owner, repo, issue_number: i.number, per_page: 100 });
      if (esSuspendido(cs)) suspendidos.add(i.number);
    } catch (e) {
      if (warn) warn(`cola-prioridad: comentarios de #${i.number} ilegibles (${e.message}) — se ordena por sus labels.`);
    }
  }
  return ordenarCola(issues, suspendidos);
}

// Lectura de la cola completa (la de los cuatro puntos): `per_page` 100, no 5 —
// con prioridades la cabeza ya no es necesariamente el más antiguo.
async function leerCola({ github, owner, repo }) {
  const { data } = await github.rest.issues.listForRepo({
    owner, repo, state: 'open', labels: EN_COLA, sort: 'created', direction: 'asc', per_page: 100 });
  return data;
}

// Cesión entre eslabones (ruling, punto 4): el urgente encolado más antiguo
// que NO sea el propio eslabón siguiente, o null (⇒ comportamiento de hoy).
function urgenteParaCeder(items, siguiente) {
  const urg = (items || []).filter((i) => i && !i.pull_request && i.number !== Number(siguiente)
    && nombresLabels(i).includes(URGENTE));
  return ordenarCola(urg)[0] || null;
}

function cuerpoSuspension({ siguiente, urgente, origen, origenNum }) {
  return `**cola · eslabón suspendido** (central#313): al llegar el turno de este eslabón (${origen}) había un \`${URGENTE}\` en cola, #${urgente}. La urgente se cuela en el límite entre eslabones —nunca en paralelo—: este issue NO se arma ahora; queda \`${EN_COLA}\` con nivel 2 (sale el primero en cuanto la serie quede libre, solo detrás de otra urgente). El sentinel \`launch-next: #${siguiente}\` cuenta como CONSUMIDO: el arranque llega por la cola (\`arm-de-cola\`), no por un re-arm de cadena.\n\n${marcaSuspendido(origenNum)}`;
}

// La cesión con I/O, compartida por los consumidores de `launch-next`
// (`cederAUrgente` de epic-merge — merge y cierre por estado — y el step
// `launch_next` de claude-code). Devuelve el número de la urgente a la que se
// cede, o null si no hay (⇒ el llamante arma #N como siempre). `origenNum`:
// el PR mergeado (o el issue cerrado por estado) que va en el marcador. Etiqueta ANTES
// que comentario: si el comentario falla, #N queda en cola como normal (vivo,
// solo peor ordenado), nunca perdido. Los errores se propagan: el llamante
// decide (hoy: aviso y arm por la cadena, el comportamiento de antes).
async function cederEslabon({ github, owner, repo, siguiente, origen, origenNum }) {
  const urg = urgenteParaCeder(await leerCola({ github, owner, repo }), siguiente);
  if (!urg) return null;
  await github.rest.issues.addLabels({ owner, repo, issue_number: Number(siguiente), labels: [EN_COLA] });
  await github.rest.issues.createComment({ owner, repo, issue_number: Number(siguiente),
    body: cuerpoSuspension({ siguiente, urgente: urg.number, origen, origenNum }) });
  return urg.number;
}

// ¿El eslabón siguiente ya está SUSPENDIDO por el OTRO consumidor del mismo
// `launch-next`? (review #315, 🟡 1). Con el merge del Creator (ADR-193 opción
// A) consumen el sentinel DOS workflows —`postMerge` de epic-merge y el step
// `launch_next` de claude-code—: si uno cedió y la urgente ya salió de la cola,
// `cederEslabon` del otro devuelve null y, sin esta lectura, armaría #N por su
// cadena EN PARALELO con la urgente. La suspensión cuenta como `launch-next`
// CONSUMIDO (igual que en `targetAlreadyArmed`): el llamante no arma. Los
// errores se propagan (el llamante avisa y sigue como antes).
async function yaSuspendido({ github, owner, repo, siguiente }) {
  const { data: cs } = await github.rest.issues.listComments({ owner, repo, issue_number: Number(siguiente), per_page: 100 });
  return esSuspendido(cs);
}

// ── Interruptor global `pausa-cola` (central#314, ruling mensual 2026-10-05,
// posición 2). El repo está EN PAUSA mientras exista al menos un ISSUE abierto
// con la label `pausa-cola` (la pone el humano). En pausa nada nuevo se arma:
// los cuatro puntos de cola no hacen pop, los consumidores de `launch-next`
// RETIENEN el eslabón siguiente en la cola (mismo mecanismo que la cesión a
// una urgente) y el guard del Creator deja `en-cola` todo arm desde issue.
// Lo que está en vuelo termina su turno (las rondas sobre un PR abierto pasan).
// Al no quedar issues abiertos con la label, la cola se arma sola: barrido de
// cierre de cualquier job (el `closed` del issue de pausa ya dispara
// epic-merge) o, en su defecto, el primer tick del Watchdog (`liberarCola`).
//
// UNA sola función de lectura (`leerPausa`), compartida por todos los puntos.
// FAIL-OPEN (ruling, punto 1): si la consulta falla, aviso y comportamiento
// de antes — un 5xx no congela la serie.
const PAUSA = 'pausa-cola';
// Marcador del ítem retenido por la pausa. Con número (`#<PR mergeado>` o el
// issue cerrado por estado) lo escribe el consumidor de `launch-next`; sin
// número, el guard del Creator. Mismas reglas de lectura que el de
// suspensión: línea propia, fuera de código, autor de confianza.
const marcaRetenido = (origen) => (Number.isInteger(Number(origen)) && Number(origen) > 0
  ? `<!-- pausa-cola-retenido: #${Number(origen)} -->`
  : '<!-- pausa-cola-retenido -->');
const RETENIDO_RE = /^[ \t]*<!--\s*pausa-cola-retenido(?::\s*#?\d+)?\s*-->[ \t]*$/m;
const ARM_DE_COLA_RE = /<!--\s*arm-de-cola\s*-->/;

async function leerPausa({ github, owner, repo, warn }) {
  try {
    const { data } = await github.rest.issues.listForRepo({ owner, repo, state: 'open', labels: PAUSA, per_page: 100 });
    const issues = (data || []).filter((i) => i && !i.pull_request).map((i) => i.number);
    return { pausado: issues.length > 0, issues, error: null };
  } catch (e) {
    if (warn) warn(`pausa-cola: la consulta \`issues?labels=${PAUSA}&state=open\` falló (${e.message}) — fail-open: la serie sigue como siempre.`);
    return { pausado: false, issues: [], error: e.message };
  }
}

const describirPausa = (p) => `\`${PAUSA}\` abierta en ${(p && p.issues && p.issues.length) ? p.issues.map((n) => `#${n}`).join(', ') : '(?)'}`;

function esRetenido(comentarios) {
  return (comentarios || []).some((c) => c && TRUSTED.has(c.author_association)
    && RETENIDO_RE.test(despojarCodigo(c.body)));
}

// Consumidor de `launch-next` en pausa (ruling, punto 3): el eslabón siguiente
// NO se arma; pasa a `en-cola` con el marcador de retención Y el de
// suspensión (mismo mecanismo que la cesión a urgente): así sale de la cola
// en nivel 2, los guards de cadena y de panel lo reconocen como reanudación y
// `targetAlreadyArmed`/`yaSuspendido` cuentan el `launch-next` como CONSUMIDO.
// Etiqueta antes que comentario (si el comentario falla, #N sigue en cola).
// Idempotente: con el merge del Creator (ADR-193 opción A) consumen el MISMO
// `launch-next` dos workflows; si el otro ya lo retuvo o suspendió, solo se
// re-asegura la etiqueta. Devuelve true si comentó. Los errores se propagan:
// el llamante decide.
async function retenerEslabon({ github, owner, repo, siguiente, origen, origenNum, pausa }) {
  await github.rest.issues.addLabels({ owner, repo, issue_number: Number(siguiente), labels: [EN_COLA] });
  if (await yaSuspendido({ github, owner, repo, siguiente })) return false;
  await github.rest.issues.createComment({ owner, repo, issue_number: Number(siguiente),
    body: `**cola · eslabón retenido por \`${PAUSA}\`** (central#314): al llegar el turno de este eslabón (${origen}) el repo estaba EN PAUSA (${describirPausa(pausa)}). Este issue NO se arma ahora; queda \`${EN_COLA}\` con nivel 2 (eslabón suspendido). El sentinel \`launch-next: #${siguiente}\` cuenta como CONSUMIDO: el arranque llega por la cola (\`arm-de-cola\`) cuando no quede ningún issue abierto con \`${PAUSA}\`.\n\n${marcaRetenido(origenNum)}\n${marcaSuspendido(origenNum)}` });
  return true;
}

// Guard del Creator en pausa (ruling, punto 4): un arm desde ISSUE no arranca
// sesión; el issue queda `en-cola` con un comentario `pausa-cola-retenido`,
// deduplicado por marcador DENTRO del episodio (un retenido posterior al
// último `arm-de-cola`: la doble entrada `issues`+`issue_comment` de un mismo
// arm, o varios arms durante la misma pausa, comentan una sola vez).
// `cadena`: el arm era un re-arm de cadena (el guard de cadena lo eximió); se
// añade el marcador de suspensión para que la salida por la cola conserve esa
// exención. Devuelve true si comentó.
async function retenerArm({ github, owner, repo, issue, cadena, pausa, comentarios }) {
  await github.rest.issues.addLabels({ owner, repo, issue_number: Number(issue), labels: [EN_COLA] });
  const cs = comentarios || [];
  let ultimoArmCola = -1;
  let ultimoRetenido = -1;
  cs.forEach((c, i) => {
    if (!c) return;
    if (ARM_DE_COLA_RE.test(c.body || '')) ultimoArmCola = i;
    if (TRUSTED.has(c.author_association) && RETENIDO_RE.test(despojarCodigo(c.body))) ultimoRetenido = i;
  });
  if (ultimoRetenido > ultimoArmCola) return false;
  await github.rest.issues.createComment({ owner, repo, issue_number: Number(issue),
    body: `**claude-code · pausa de cola** (central#314): el repo está EN PAUSA (${describirPausa(pausa)}). Mientras quede un issue abierto con \`${PAUSA}\` nada nuevo se arma: este arm NO arranca sesión y el issue queda \`${EN_COLA}\`. Al retirar la pausa, la cola se arma sola por su orden (urgente → eslabón suspendido → alta → normal), sin intervención. Lo que está en vuelo (rondas sobre un PR ya abierto) sigue.\n\n${marcaRetenido()}${cadena ? `\n${marcaSuspendido()}` : ''}` });
  return true;
}

// Barrido de LIBERACIÓN del Watchdog (ruling, punto 6): determinista, sin LLM.
// Arma la cabeza de la cola (orden de central#313) con el `arm-de-cola` normal
// SOLO con identificación positiva de: pausa LEÍDA y ausente (consulta
// fallida ⇒ no barre: el Watchdog sigue con su detector de siempre, caso (f)),
// cola no vacía, cero PRs `claude/*` abiertos, cero `serial-activo` y ningún
// arm reciente de otro emisor (misma ventana de 5 min que los barridos de
// cierre, AP-062). `armar(next)` escribe el arm (en el Watchdog, con el PAT:
// un comentario del GITHUB_TOKEN no dispararía al Creator). Devuelve
// { accion, numero?, motivo }.
const ARM_MARKERS = ['arm-de-cola', 'epic-auto-launch', 'epic-partial-relaunch', 'watchdog-rearm'];
async function liberarCola({ github, owner, repo, armar, warn, ahora }) {
  const pausa = await leerPausa({ github, owner, repo, warn });
  if (pausa.error) return { accion: 'no-op', motivo: 'consulta de pausa fallida (fail-open: detector de siempre)' };
  if (pausa.pausado) return { accion: 'retenido', motivo: describirPausa(pausa) };
  const queued = await leerCola({ github, owner, repo });
  if (!(queued || []).some((i) => i && !i.pull_request)) return { accion: 'no-op', motivo: 'cola vacía' };
  const { data: prs } = await github.rest.pulls.list({ owner, repo, state: 'open', per_page: 100 });
  const held = (prs || []).filter((p) => (p.head && p.head.ref || '').startsWith('claude/'));
  if (held.length) return { accion: 'no-op', motivo: `serie ocupada por ${held.map((p) => `#${p.number}`).join(', ')}` };
  const { data: flagged } = await github.rest.issues.listForRepo({ owner, repo, state: 'open', labels: 'serial-activo', per_page: 20 });
  if ((flagged || []).length) return { accion: 'no-op', motivo: `serie ocupada por serial-activo en ${flagged.map((i) => `#${i.number}`).join(', ')}` };
  const corte = (ahora || Date.now()) - 5 * 60000;
  const { data: recientes } = await github.rest.issues.listCommentsForRepo({
    owner, repo, sort: 'created', direction: 'desc', since: new Date(corte).toISOString(), per_page: 100 });
  const reciente = (recientes || []).find((c) => /\/issues\/\d+/.test(c.html_url || '')
    && new Date(c.created_at).getTime() >= corte
    && ARM_MARKERS.some((mk) => (c.body || '').includes(`<!-- ${mk} -->`)));
  if (reciente) return { accion: 'no-op', motivo: `arm reciente de otro emisor (${reciente.html_url})` };
  const next = (await ordenarConSuspension({ github, owner, repo, items: queued, warn }))[0];
  if (!next) return { accion: 'no-op', motivo: 'cola sin issues' };
  await armar(next);
  return { accion: 'armado', numero: next.number, motivo: describir(next) };
}

// Texto de la razón de un arm de cola según el nivel del elegido.
function describir(issue) {
  if (!issue || !issue.nivelCola) return 'Eras el más antiguo en `en-cola`.';
  return `Eras el primero de \`en-cola\` (nivel ${issue.nivelCola}: ${NIVELES[issue.nivelCola]}; orden urgente → eslabón suspendido → alta → normal, por antigüedad dentro de cada nivel).`;
}

module.exports = {
  URGENTE, ALTA, EN_COLA, NIVELES, SUSPENDIDO_RE, marcaSuspendido,
  esSuspendido, nivel, ordenarCola, ordenarConSuspension, leerCola,
  urgenteParaCeder, cuerpoSuspension, cederEslabon, yaSuspendido, describir,
  PAUSA, RETENIDO_RE, marcaRetenido, leerPausa, describirPausa, esRetenido,
  retenerEslabon, retenerArm, liberarCola,
};
