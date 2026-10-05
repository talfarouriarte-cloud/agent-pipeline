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
// (comentario de confianza con `<!-- eslabon-suspendido -->` en línea propia),
// (3) `prioridad:alta`, (4) resto. Desempate por antigüedad (`created_at`,
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
const MARCA_SUSPENDIDO = '<!-- eslabon-suspendido -->';
// Línea propia del cuerpo despojado de código: citar el marcador entre
// backticks o en un bloque cercado no suspende nada (clase AP-063).
const SUSPENDIDO_RE = /^[ \t]*<!--\s*eslabon-suspendido\s*-->[ \t]*$/m;
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

function cuerpoSuspension({ siguiente, urgente, origen }) {
  return `**cola · eslabón suspendido** (central#313): al llegar el turno de este eslabón (${origen}) había un \`${URGENTE}\` en cola, #${urgente}. La urgente se cuela en el límite entre eslabones —nunca en paralelo—: este issue NO se arma ahora; queda \`${EN_COLA}\` con nivel 2 (sale el primero en cuanto la serie quede libre, solo detrás de otra urgente). El sentinel \`launch-next: #${siguiente}\` cuenta como CONSUMIDO: el arranque llega por la cola (\`arm-de-cola\`), no por un re-arm de cadena.\n\n${MARCA_SUSPENDIDO}`;
}

// La cesión con I/O, compartida por los consumidores de `launch-next`
// (`cederAUrgente` de epic-merge — merge y cierre por estado — y el step
// `launch_next` de claude-code). Devuelve el número de la urgente a la que se
// cede, o null si no hay (⇒ el llamante arma #N como siempre). Etiqueta ANTES
// que comentario: si el comentario falla, #N queda en cola como normal (vivo,
// solo peor ordenado), nunca perdido. Los errores se propagan: el llamante
// decide (hoy: aviso y arm por la cadena, el comportamiento de antes).
async function cederEslabon({ github, owner, repo, siguiente, origen }) {
  const urg = urgenteParaCeder(await leerCola({ github, owner, repo }), siguiente);
  if (!urg) return null;
  await github.rest.issues.addLabels({ owner, repo, issue_number: Number(siguiente), labels: [EN_COLA] });
  await github.rest.issues.createComment({ owner, repo, issue_number: Number(siguiente),
    body: cuerpoSuspension({ siguiente, urgente: urg.number, origen }) });
  return urg.number;
}

// Texto de la razón de un arm de cola según el nivel del elegido.
function describir(issue) {
  if (!issue || !issue.nivelCola) return 'Eras el más antiguo en `en-cola`.';
  return `Eras el primero de \`en-cola\` (nivel ${issue.nivelCola}: ${NIVELES[issue.nivelCola]}; orden urgente → eslabón suspendido → alta → normal, por antigüedad dentro de cada nivel).`;
}

module.exports = {
  URGENTE, ALTA, EN_COLA, MARCA_SUSPENDIDO, NIVELES,
  esSuspendido, nivel, ordenarCola, ordenarConSuspension, leerCola,
  urgenteParaCeder, cuerpoSuspension, cederEslabon, describir,
};
