#!/usr/bin/env node
// check-cola-prioridad — banco de casos EJECUTABLE del orden de la cola serial
// por prioridad y de la cesión entre eslabones a una `prioridad:urgente`
// (`vendored/scripts/cola-prioridad.cjs`, central#313 — ruling mensual
// 2026-10-05, punto 7).
//
// Los casos corren el módulo REAL contra una API de GitHub en memoria (issues,
// labels, comentarios): la cesión y el orden se ejercitan con sus lecturas y
// escrituras, no releyendo el código. La costura con los workflows (que los
// cuatro puntos de cola y los consumidores de `launch-next` llamen al módulo,
// y que los guards de cadena acepten el eslabón suspendido) se comprueba por
// texto cuando los workflows existen (en el central; en el consumidor llegan
// por `workflow_call` y se omite).
//
// AP-126 (central#375, funde #338; ruling mensual 2026-11-01, posición 5):
// casos NUEVOS (e)–(o) del marcador `depende-de` y de `pause-agents` en el
// selector, la cesión y el guard serial; (k)/(m)/(n)/(o) corren los steps
// REALES de `claude-code.yml` por el cargador compartido (`cargarStep`,
// central#318). Los casos (a)–(d) del orden AP-102 no cambian.
//
// Verde: exit 0. Rojo: el comportamiento real cambió y el banco lo nota.
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);

// Central primero (fichero FUENTE); el consumidor lo recibe en `scripts/`.
const FUENTES = ['vendored/scripts/cola-prioridad.cjs', 'scripts/cola-prioridad.cjs'];
let fuente = null;
let m = null;
for (const f of FUENTES) {
  if (!existsSync(f)) continue;
  m = require(resolve(f));   // un SyntaxError aquí es ROJO, y debe serlo
  fuente = f;
  break;
}
if (!m) {
  console.log('::warning::check-cola-prioridad — no encuentro `cola-prioridad.cjs` en ninguna de sus dos ubicaciones: el banco NO se ha ejecutado.');
  process.exit(0);
}

const fallos = [];
const caso = (nombre, ok) => { if (!ok) fallos.push(nombre); };

// ── API de GitHub en memoria ────────────────────────────────────────────────
// `prs`: PRs abiertos (`pulls.list`). `getRoto`: `issues.get` lanza (5xx).
// `serialOkRoto`: la consulta `labels=serial-ok` lanza (5xx, AP-143).
function repoFalso(issues, { prs = [], getRoto = false, serialOkRoto = false } = {}) {
  const st = new Map();
  for (const i of issues) st.set(i.number, { state: 'open', comments: [], body: '', ...i, labels: [...(i.labels || [])] });
  const vista = (i) => ({ number: i.number, state: i.state, state_reason: i.state_reason || null, created_at: i.created_at,
    body: i.body, labels: i.labels.map((name) => ({ name })), ...(i.pull_request ? { pull_request: {} } : {}) });
  let cid = 1000;
  const github = { paginate: async (fn, p) => (await fn(p)).data, rest: {
    pulls: { async list() { return { data: prs.map((x) => ({ ...x })) }; } },
    actions: {
      async listWorkflowRunsForRepo() { return { data: { workflow_runs: [] } }; },
      async listJobsForWorkflowRun() { return { data: { jobs: [] } }; },
    },
    issues: {
    async get({ issue_number }) {
      if (getRoto) throw new Error('502 Bad Gateway');
      if (!st.has(issue_number)) { const e = new Error('Not Found'); e.status = 404; throw e; }
      return { data: vista(st.get(issue_number)) };
    },
    async listForRepo({ state, labels }) {
      if (labels === 'serial-ok' && serialOkRoto) throw new Error('502 Bad Gateway');
      const data = [...st.values()]
        .filter((i) => (!state || i.state === state) && (!labels || i.labels.includes(labels)))
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .map(vista);
      return { data };
    },
    async listComments({ issue_number }) { return { data: [...st.get(issue_number).comments] }; },
    async listCommentsForRepo({ since }) {
      const corte = Date.parse(since);
      const data = [];
      for (const i of st.values()) for (const c of i.comments) if (Date.parse(c.created_at) >= corte) data.push(c);
      return { data };
    },
    async addLabels({ issue_number, labels }) {
      const i = st.get(issue_number);
      for (const l of labels) if (!i.labels.includes(l)) i.labels.push(l);
      return { data: {} };
    },
    async removeLabel({ issue_number, name }) {
      const i = st.get(issue_number);
      i.labels = i.labels.filter((l) => l !== name);
      return { data: {} };
    },
    async createComment({ issue_number, body }) {
      // El PAT del propietario: autor de confianza, como en producción.
      st.get(issue_number).comments.push({ id: cid++, body, author_association: 'OWNER', created_at: new Date().toISOString() });
      return { data: {} };
    },
  } } };
  return { github, st, owner: 'o', repo: 'r' };
}

// El pop de cola tal y como lo hacen `armQueue`/`popQueue`/los barridos: leer
// la cola, ordenarla con el módulo, armar la cabeza (retira `en-cola`).
async function pop(R) {
  const queued = await m.leerCola(R);
  const head = (await m.ordenarConSuspension({ ...R, items: queued }))[0];
  if (!head) return null;
  await R.github.rest.issues.removeLabel({ owner: R.owner, repo: R.repo, issue_number: head.number, name: 'en-cola' });
  await R.github.rest.issues.createComment({ owner: R.owner, repo: R.repo, issue_number: head.number,
    body: `@claude arranca — turno de cola. ${m.describir(head)}\n\n<!-- arm-de-cola -->` });
  return head.number;
}

// El consumidor de `launch-next` tal y como lo hacen epic-merge (merge y
// cierre por estado) y el step `launch_next`: ceder si hay urgente; si no,
// armar #N por su cadena (`epic-auto-launch`).
async function consumirLaunchNext(R, siguiente) {
  const urgente = await m.cederEslabon({ ...R, siguiente, origen: 'merge de #10', origenNum: 10 });
  if (urgente) return { cedido: true, armado: await pop(R) };
  // Suspensión previa por el OTRO consumidor del mismo `launch-next`: no arma.
  if (await m.yaSuspendido({ ...R, siguiente })) return { cedido: false, armado: null };
  await R.github.rest.issues.createComment({ owner: R.owner, repo: R.repo, issue_number: siguiente,
    body: '@claude\n\nArranque automático de épica.\n\n<!-- epic-auto-launch -->' });
  return { cedido: false, armado: siguiente };
}

const T = (d) => `2026-10-0${d}T10:00:00Z`;
const lbl = (i, R) => R.st.get(i).labels;
const coment = (i, R) => R.st.get(i).comments.map((c) => c.body).join('\n');

// ── (a) urgente en cola + merge de eslabón ⇒ arma la urgente; eslabón suspendido en cola
{
  const R = repoFalso([
    { number: 5, created_at: T(1), labels: ['en-cola'] },
    { number: 7, created_at: T(2), labels: ['en-cola', 'prioridad:alta'] },
    { number: 8, created_at: T(3), labels: ['en-cola', 'prioridad:urgente'] },
    // Eslabón siguiente (launch-next: #11), MÁS NUEVO que la alta y la normal:
    // si saliera antes que ellas solo por antigüedad, el caso (b) no probaría nada.
    { number: 11, created_at: T(4), labels: ['epica'] },
  ]);
  const r = await consumirLaunchNext(R, 11);
  caso('(a) urgente en cola + merge de eslabón ⇒ hay cesión', r.cedido === true);
  caso('(a) …y se arma la urgente #8 (arm-de-cola), no el eslabón', r.armado === 8 && /<!-- arm-de-cola -->/.test(coment(8, R)) && !lbl(8, R).includes('en-cola'));
  // Literal del ruling: `<!-- eslabon-suspendido: #<PR mergeado> -->` (aquí el PR #10).
  caso('(a) …el eslabón #11 queda `en-cola` con el marcador del ruling `<!-- eslabon-suspendido: #10 -->`', lbl(11, R).includes('en-cola') && /^<!-- eslabon-suspendido: #10 -->$/m.test(coment(11, R)));
  caso('(a) …y #11 NO recibe arm de cadena (`epic-auto-launch`) — nunca dos a la vez', !/epic-auto-launch|@claude/.test(coment(11, R)));
  caso('(a) …el arm de la urgente declara su nivel', /nivel 1: urgente/.test(coment(8, R)));

  // ── (b) al cerrar la urgente ⇒ sale el eslabón suspendido antes que una alta más antigua
  R.st.get(8).state = 'closed';
  const b = await pop(R);
  caso('(b) cierre de la urgente ⇒ sale el eslabón suspendido #11, antes que la alta #7 (más antigua)', b === 11);
  caso('(b) …el arm del eslabón es por la cola (`arm-de-cola`) y declara nivel 2', /<!-- arm-de-cola -->/.test(coment(11, R)) && /nivel 2: eslabón suspendido/.test(coment(11, R)));
  caso('(b) …y después, la alta #7 antes que la normal #5 (más antigua)', (await pop(R)) === 7 && (await pop(R)) === 5);
}

// ── Doble consumidor del mismo `launch-next` (review #315, 🟡 1): uno cede y la
// urgente sale de la cola; el otro llega después ⇒ NO arma #N (nunca dos a la vez)
{
  const R = repoFalso([
    { number: 8, created_at: T(3), labels: ['en-cola', 'prioridad:urgente'] },
    { number: 11, created_at: T(4), labels: ['epica'] },
  ]);
  const primero = await consumirLaunchNext(R, 11);
  const segundo = await consumirLaunchNext(R, 11);
  caso('doble consumidor: el primero cede y arma la urgente #8', primero.cedido && primero.armado === 8);
  caso('doble consumidor: el segundo (suspensión previa + cola sin urgente) NO arma #11', segundo.armado === null
    && !/epic-auto-launch|@claude/.test(coment(11, R)) && lbl(11, R).includes('en-cola'));
}

// ── (c) alta en cola + merge de eslabón ⇒ sigue la cadena; la alta espera a epic-audit/epic-done
{
  const R = repoFalso([
    { number: 5, created_at: T(1), labels: ['en-cola'] },
    { number: 7, created_at: T(2), labels: ['en-cola', 'prioridad:alta'] },
    { number: 11, created_at: T(1), labels: ['epica'] },
  ]);
  const r = await consumirLaunchNext(R, 11);
  caso('(c) alta en cola + merge de eslabón ⇒ SIN cesión: la cadena sigue (#11 por epic-auto-launch)', r.cedido === false && r.armado === 11 && /epic-auto-launch/.test(coment(11, R)));
  caso('(c) …la alta sigue en cola, intacta', lbl(7, R).includes('en-cola') && coment(7, R) === '');
  caso('(c) …y #11 no queda encolado ni suspendido', !lbl(11, R).includes('en-cola') && !/eslabon-suspendido/.test(coment(11, R)));
  // Fin de épica (epic-audit / epic-done) ⇒ el pop de cola: la alta sale primero.
  caso('(c) al terminar la épica ⇒ la alta #7 sale antes que la normal #5, más antigua', (await pop(R)) === 7);
}

// ── (d) sin etiquetas ⇒ orden idéntico al actual (FIFO por created)
{
  const items = [
    { number: 30, created_at: T(5), labels: [{ name: 'en-cola' }] },
    { number: 12, created_at: T(2), labels: [{ name: 'en-cola' }] },
    { number: 40, created_at: T(3), labels: [{ name: 'en-cola' }] },
    { number: 41, created_at: T(3), labels: [{ name: 'en-cola' }], pull_request: {} },
  ];
  const fifo = items.filter((i) => !i.pull_request).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map((i) => i.number);
  caso('(d) sin etiquetas ⇒ orden idéntico al FIFO por `created`', m.ordenarCola(items).map((i) => i.number).join() === fifo.join());
  caso('(d) …todos en nivel 4 (normal)', m.ordenarCola(items).every((i) => i.nivelCola === 4));
  caso('(d) …los PRs se filtran, como antes', !m.ordenarCola(items).some((i) => i.number === 41));
  caso('(d) …y no hay urgente a la que ceder', m.urgenteParaCeder(items, 11) === null);
  const R = repoFalso([{ number: 12, created_at: T(2), labels: ['en-cola'] }, { number: 11, created_at: T(1), labels: ['epica'] }]);
  const r = await consumirLaunchNext(R, 11);
  caso('(d) merge de eslabón sin urgentes ⇒ comportamiento de hoy (arm de cadena, cola intacta)', !r.cedido && r.armado === 11 && lbl(12, R).includes('en-cola'));
}

// ── Bordes ────────────────────────────────────────────────────────────────
{
  const sus = (body, aa = 'OWNER') => m.esSuspendido([{ body, author_association: aa }]);
  caso('marcador del ruling en línea propia de autor de confianza ⇒ suspendido', sus('texto\n\n<!-- eslabon-suspendido: #1234 -->'));
  caso('marcador sin número (lectura tolerante) ⇒ suspendido', sus('<!-- eslabon-suspendido -->'));
  caso('`marcaSuspendido(1234)` emite el literal del ruling', m.marcaSuspendido(1234) === '<!-- eslabon-suspendido: #1234 -->');
  caso('los guards en línea de claude-code aceptan el literal que emite el módulo', m.SUSPENDIDO_RE.test(m.marcaSuspendido(7)));
  caso('marcador CITADO entre backticks ⇒ NO suspende (AP-063)', !sus('el marcador `<!-- eslabon-suspendido: #5 -->` significa…'));
  caso('marcador dentro de un bloque cercado ⇒ NO suspende', !sus('```\n<!-- eslabon-suspendido: #5 -->\n```'));
  caso('marcador de autor sin confianza ⇒ NO suspende', !sus('<!-- eslabon-suspendido: #5 -->', 'NONE'));
  const urgSelf = [{ number: 11, created_at: T(1), labels: [{ name: 'prioridad:urgente' }, { name: 'en-cola' }] }];
  caso('el eslabón siguiente no se cede a sí mismo aunque lleve urgente', m.urgenteParaCeder(urgSelf, 11) === null);
  const dosUrg = [
    { number: 9, created_at: T(4), labels: [{ name: 'prioridad:urgente' }] },
    { number: 6, created_at: T(2), labels: [{ name: 'prioridad:urgente' }] },
  ];
  caso('varias urgentes ⇒ se cede a la más antigua', m.urgenteParaCeder(dosUrg, 11).number === 6);
  const mezcla = [
    { number: 1, created_at: T(1), labels: [{ name: 'prioridad:alta' }, { name: 'prioridad:urgente' }] },
    { number: 2, created_at: T(1), labels: [] },
  ];
  caso('urgente + alta a la vez ⇒ cuenta como urgente', m.ordenarCola(mezcla)[0].nivelCola === 1);
  caso('desempate a igual `created` ⇒ por número', m.ordenarCola([{ number: 4, created_at: T(1), labels: [] }, { number: 3, created_at: T(1), labels: [] }])[0].number === 3);
  // Lectura fallida de comentarios ⇒ el ítem conserva su nivel por labels (la cola no se bloquea).
  const ghRoto = { rest: { issues: { async listComments() { throw new Error('502'); } } } };
  const avisos = [];
  const orden = await m.ordenarConSuspension({ github: ghRoto, owner: 'o', repo: 'r', warn: (w) => avisos.push(w),
    items: [{ number: 2, created_at: T(1), labels: [] }, { number: 3, created_at: T(2), labels: [{ name: 'prioridad:alta' }] }] });
  caso('comentarios ilegibles ⇒ orden por labels y aviso, sin excepción', orden.map((i) => i.number).join() === '3,2' && avisos.length === 2);
}

// ══ AP-126 · `depende-de` y `pause-agents` en el selector (central#375/#338) ══
const DEP = (...ns) => ns.map((n) => `<!-- depende-de: #${n} -->`).join('\n');

// ── (e) dependencia abierta ⇒ se salta; `[0]` es el siguiente y el arm lo dice
{
  const R = repoFalso([
    { number: 50, created_at: T(1), labels: [] },                                  // dependencia, abierta
    { number: 51, created_at: T(2), labels: ['en-cola'], body: `Depende de #50.\n\n${DEP(50)}` },
    { number: 52, created_at: T(3), labels: ['en-cola'] },
  ]);
  const orden = await m.ordenarConSuspension({ ...R, items: await m.leerCola(R) });
  caso('(e) `depende-de: #50` con #50 abierto ⇒ #51 fuera del orden', !orden.some((i) => i.number === 51));
  caso('(e) …la cabeza es el siguiente, #52', orden[0] && orden[0].number === 52);
  caso('(e) …y `describir` lista el saltado: «Saltados: #51 (depende de #50 abierto)»', /Saltados: #51 \(depende de #50 abierto\)/.test(m.describir(orden[0])));
  const armado = await pop(R);
  caso('(e) …el pop arma #52 y #51 conserva `en-cola`, sin comentario', armado === 52 && lbl(51, R).includes('en-cola') && coment(51, R) === '');
  caso('(e) …el comentario de arm de #52 lista el saltado', /Saltados: #51 \(depende de #50 abierto\)/.test(coment(52, R)));
  // Marcador citado (backticks / bloque cercado) ⇒ no es dependencia (AP-063).
  caso('(e) marcador citado entre backticks o en bloque cercado ⇒ no declara dependencia',
    m.dependenciasDeclaradas('`<!-- depende-de: #50 -->`\n```\n<!-- depende-de: #50 -->\n```', 51).length === 0);
  caso('(e) varias dependencias, una por línea o `#N, #M` ⇒ todas', m.dependenciasDeclaradas(`${DEP(4)}\n<!-- depende-de: #5, #6 -->`, 9).join() === '4,5,6');
}

// ── (f) dependencia cerrada (completed) ⇒ se arma
{
  const R = repoFalso([
    { number: 50, created_at: T(1), labels: [], state: 'closed', state_reason: 'completed' },
    { number: 51, created_at: T(2), labels: ['en-cola'], body: DEP(50) },
    { number: 52, created_at: T(3), labels: ['en-cola'] },
  ]);
  caso('(f) #50 cerrado `completed` ⇒ #51 (más antiguo) se arma', (await pop(R)) === 51);
  caso('(f) …sin línea de saltados en el arm', !/Saltados/.test(coment(51, R)));
}

// ── (g) `not_planned` y PR cerrado sin merge ⇒ cuentan como cerrados
{
  const R = repoFalso([
    { number: 50, created_at: T(1), labels: [], state: 'closed', state_reason: 'not_planned' },
    { number: 60, created_at: T(1), labels: [], state: 'closed', pull_request: {} },   // PR cerrado sin merge
    { number: 51, created_at: T(2), labels: ['en-cola'], body: DEP(50, 60) },
  ]);
  caso('(g) dependencias `not_planned` y PR cerrado sin merge ⇒ cerradas: #51 se arma', (await pop(R)) === 51);
}

// ── (h) dos dependencias, una abierta ⇒ saltado
{
  const R = repoFalso([
    { number: 50, created_at: T(1), labels: [], state: 'closed' },
    { number: 60, created_at: T(1), labels: [], pull_request: {} },                   // PR abierto
    { number: 51, created_at: T(2), labels: ['en-cola'], body: DEP(50, 60) },
    { number: 52, created_at: T(3), labels: ['en-cola'] },
  ]);
  const orden = await m.ordenarConSuspension({ ...R, items: await m.leerCola(R) });
  caso('(h) dos dependencias, una abierta (PR #60) ⇒ #51 saltado, sale #52', orden[0].number === 52 && !orden.some((i) => i.number === 51));
  caso('(h) …el saltado cita SOLO la abierta', /#51 \(depende de #60 abierto\)/.test(m.describir(orden[0])));
}

// ── (i) `issues.get` lanza ⇒ fail-open: se arma y `warn` recibe el aviso
{
  const R = repoFalso([
    { number: 51, created_at: T(2), labels: ['en-cola'], body: DEP(50) },
    { number: 52, created_at: T(3), labels: ['en-cola'] },
  ], { getRoto: true });
  const avisos = [];
  const orden = await m.ordenarConSuspension({ ...R, items: await m.leerCola(R), warn: (w) => avisos.push(w) });
  caso('(i) `issues.get` falla ⇒ fail-open: #51 sale el primero', orden[0].number === 51);
  caso('(i) …y `warn` recibe el aviso de la dependencia ilegible', avisos.some((w) => /dependencia #50 de #51 ilegible/.test(w)));
}

// ── (j) `pause-agents` ⇒ excluido del selector y conserva `en-cola`
{
  const R = repoFalso([
    { number: 51, created_at: T(1), labels: ['en-cola', 'pause-agents'] },
    { number: 52, created_at: T(3), labels: ['en-cola'] },
  ]);
  caso('(j) candidato con `pause-agents` ⇒ saltado, sale #52', (await pop(R)) === 52);
  caso('(j) …#51 conserva `en-cola`, sin comentario', lbl(51, R).includes('en-cola') && coment(51, R) === '');
  caso('(j) …el arm de #52 lo lista como `pause-agents`', /Saltados: #51 \(pause-agents\)/.test(coment(52, R)));
}

// ── (j-bis) todos saltados ⇒ `[]` y `warn` con la lista
{
  const R = repoFalso([
    { number: 50, created_at: T(1), labels: [] },
    { number: 51, created_at: T(2), labels: ['en-cola'], body: DEP(50) },
    { number: 53, created_at: T(3), labels: ['en-cola', 'pause-agents'] },
  ]);
  const avisos = [];
  const orden = await m.ordenarConSuspension({ ...R, items: await m.leerCola(R), warn: (w) => avisos.push(w) });
  caso('(j-bis) todos los candidatos saltados ⇒ `[]`', orden.length === 0);
  caso('(j-bis) …y `warn` con la lista completa', avisos.some((w) => w === 'cola: 2 candidatos saltados — #51 (depende de #50), #53 (pause-agents)'));
}

// ── (l) cesión: una urgente con dependencia abierta NO suspende el eslabón
{
  const R = repoFalso([
    { number: 50, created_at: T(1), labels: [] },
    { number: 8, created_at: T(2), labels: ['en-cola', 'prioridad:urgente'], body: DEP(50) },
    { number: 11, created_at: T(3), labels: ['epica'] },
  ]);
  const urg = await m.cederEslabon({ ...R, siguiente: 11, origen: 'merge de #10', origenNum: 10 });
  caso('(l) urgente #8 con dependencia abierta ⇒ `cederEslabon` devuelve null', urg === null);
  caso('(l) …el eslabón #11 NO recibe `en-cola` ni comentario de suspensión', !lbl(11, R).includes('en-cola') && coment(11, R) === '');
  R.st.get(50).state = 'closed';
  const urg2 = await m.cederEslabon({ ...R, siguiente: 11, origen: 'merge de #10', origenNum: 10 });
  caso('(l) misma urgente con #50 cerrado ⇒ cede como hoy (`en-cola` + `cuerpoSuspension`)',
    urg2 === 8 && lbl(11, R).includes('en-cola') && /^<!-- eslabon-suspendido: #10 -->$/m.test(coment(11, R)));
  const Rp = repoFalso([
    { number: 8, created_at: T(2), labels: ['en-cola', 'prioridad:urgente', 'pause-agents'] },
    { number: 11, created_at: T(3), labels: ['epica'] },
  ]);
  caso('(l) urgente con `pause-agents` ⇒ tampoco suspende el eslabón',
    (await m.cederEslabon({ ...Rp, siguiente: 11, origen: 'merge de #10', origenNum: 10 })) === null && coment(11, Rp) === '');
}

// ── Steps REALES de claude-code.yml por el cargador compartido (central#318) ──
const CCW = '.github/workflows/claude-code.yml';
const steps = {};
if (existsSync(CCW)) {
  const wf = yaml.load(readFileSync(CCW, 'utf8'));
  for (const job of Object.values(wf.jobs || {})) for (const st of job.steps || []) if (st.id) steps[st.id] = st.with && st.with.script;
  caso('claude-code: steps `check_serial`, `check_pause` y `check_chain` presentes', !!(steps.check_serial && steps.check_pause && steps.check_chain));
}
// `require` inyectado: cualquier ruta a `cola-prioridad.cjs` resuelve al módulo fuente.
const reqInyectado = (p) => (String(p).endsWith('cola-prioridad.cjs') ? m : require(p));
async function correrStep(id, R, issueNumber, armBody, { epica = false } = {}) {
  const run = cargarStep(steps[id], id);
  const i = R.st.get(issueNumber);
  const issue = { number: issueNumber, title: `Issue ${issueNumber}`, created_at: i.created_at, body: i.body,
    labels: [...i.labels, ...(epica ? ['epica'] : [])].map((name) => ({ name })) };
  const out = { outputs: {}, warnings: [] };
  const context = { repo: { owner: R.owner, repo: R.repo }, runId: 500, workflow: 'Claude Code', eventName: 'issue_comment',
    payload: { issue, comment: { body: armBody, created_at: new Date().toISOString() } } };
  const core = { setOutput: (k, v) => { out.outputs[k] = String(v); }, setFailed: (f) => { out.failed = f; }, notice() {}, info() {}, warning: (w) => out.warnings.push(String(w)) };
  await run({ github: R.github, context, core, require: reqInyectado }, { env: { IN_EPIC_LABEL: 'epica' } });
  return out;
}
const retenidos = (i, R) => R.st.get(i).comments.filter((c) => /^<!-- depende-de-retenido: #\d+(?:, #\d+)* -->$/m.test(c.body)).length;

// ── (k) guard serial: arm manual con dependencia abierta ⇒ retenido en cola
if (steps.check_serial) {
  const R = repoFalso([
    { number: 50, created_at: T(1), labels: [] },
    { number: 70, created_at: T(2), labels: [], body: `Depende de #50.\n\n${DEP(50)}` },
  ]);
  const w = await correrStep('check_serial', R, 70, '@claude arranca');
  caso('(k) arm manual con dependencia abierta ⇒ `blocked === true` (sin sesión)', w.outputs.blocked === 'true');
  caso('(k) …`en-cola` puesta y un comentario con `<!-- depende-de-retenido: #50 -->` en línea propia', lbl(70, R).includes('en-cola') && retenidos(70, R) === 1 && /^<!-- depende-de-retenido: #50 -->$/m.test(coment(70, R)));
  caso('(k) …SIN `stalled` y SIN `serial-activo`', !lbl(70, R).includes('stalled') && !lbl(70, R).includes('serial-activo'));
  caso('(k) …un arm suelto NO lleva `eslabon-suspendido`', !/eslabon-suspendido/.test(coment(70, R)));
  // (k-ter) segundo arm en el mismo episodio ⇒ sin segundo comentario.
  const w2 = await correrStep('check_serial', R, 70, '@claude otra vez');
  caso('(k-ter) segundo arm en el mismo episodio ⇒ retenido, SIN segundo comentario', w2.outputs.blocked === 'true' && retenidos(70, R) === 1);
  // (k-bis) `serial-ok` NO salta la dependencia.
  const Rok = repoFalso([
    { number: 50, created_at: T(1), labels: [] },
    { number: 71, created_at: T(2), labels: ['serial-ok'], body: DEP(50) },
  ]);
  const wok = await correrStep('check_serial', Rok, 71, '@claude');
  caso('(k-bis) `serial-ok` NO salta la dependencia abierta', wok.outputs.blocked === 'true' && lbl(71, Rok).includes('en-cola') && retenidos(71, Rok) === 1);
  // (k-quater) issue con `serial-activo` (en vuelo) ⇒ pasa al guard de siempre sin retener.
  const Rv = repoFalso([
    { number: 50, created_at: T(1), labels: [] },
    { number: 72, created_at: T(2), labels: ['serial-activo'], body: DEP(50) },
  ]);
  await correrStep('check_serial', Rv, 72, '@claude').catch(() => null);
  caso('(k-quater) issue con `serial-activo` ⇒ NO se retiene por dependencia (sin `depende-de-retenido`, sin `en-cola`)',
    retenidos(72, Rv) === 0 && !lbl(72, Rv).includes('en-cola'));
  // Dependencia cerrada ⇒ el guard no retiene.
  const Rc = repoFalso([
    { number: 50, created_at: T(1), labels: [], state: 'closed' },
    { number: 73, created_at: T(2), labels: [], body: DEP(50) },
  ]);
  await correrStep('check_serial', Rc, 73, '@claude').catch(() => null);
  caso('(k) dependencia cerrada ⇒ el guard serial no retiene', retenidos(73, Rc) === 0);
}

// ── (o) re-arm de cadena retenido ⇒ conserva la exención de cadena al salir por la cola
// (crítica ronda 3, central#375): un eslabón no-primero sin bloque de
// invariantes llega por `epic-auto-launch` con dependencia abierta; al salir
// después por `arm-de-cola`, el guard de cadena lo reconoce (sin `stalled`).
if (steps.check_serial && steps.check_chain) {
  const R = repoFalso([
    { number: 50, created_at: T(1), labels: [] },
    { number: 74, created_at: T(2), labels: [], body: `Eslabón 2 de la épica.\n\n${DEP(50)}` },
  ]);
  const w = await correrStep('check_serial', R, 74, '@claude\n\nArranque automático de épica tras merge de #9.\n\n<!-- epic-auto-launch -->', { epica: true });
  caso('(o) `epic-auto-launch` con dependencia abierta ⇒ retenido y con `eslabon-suspendido`',
    w.outputs.blocked === 'true' && retenidos(74, R) === 1 && m.esSuspendido(R.st.get(74).comments));
  R.st.get(50).state = 'closed';
  const armCola = '@claude arranca — turno de cola.\n\n<!-- arm-de-cola -->';
  R.st.get(74).labels = R.st.get(74).labels.filter((l) => l !== 'en-cola');
  R.st.get(74).comments.push({ id: 1, body: armCola, author_association: 'OWNER', created_at: new Date().toISOString() });
  const wc = await correrStep('check_chain', R, 74, armCola, { epica: true });
  caso('(o) …salida posterior por `arm-de-cola` ⇒ el guard de cadena NO lo rompe (sin `stalled`)',
    wc.outputs.broken === 'false' && !lbl(74, R).includes('stalled') && !wc.failed);
}

// ── (m)/(n) kill-switch: aborto por `pause-agents` entrando por `arm-de-cola`
if (steps.check_pause) {
  const R = repoFalso([{ number: 80, created_at: T(2), labels: ['pause-agents'] }]);
  const w = await correrStep('check_pause', R, 80, '@claude arranca — turno de cola.\n\n<!-- arm-de-cola -->');
  caso('(m) `pause-agents` + disparo `arm-de-cola` ⇒ `paused === true`', w.outputs.paused === 'true');
  caso('(m) …`en-cola` devuelta y comentario `<!-- pause-agents-devuelto-a-cola -->`',
    lbl(80, R).includes('en-cola') && /<!-- pause-agents-devuelto-a-cola -->/.test(coment(80, R)));
  caso('(m) …sin pop: ningún `arm-de-cola` ni `@claude` nuevo', !/@claude/.test(coment(80, R)));
  const Rn = repoFalso([{ number: 81, created_at: T(2), labels: ['pause-agents'] }]);
  const wn = await correrStep('check_pause', Rn, 81, '@claude arranca');
  caso('(n) `pause-agents` + disparo SIN `arm-de-cola` ⇒ `paused === true` y cero escrituras',
    wn.outputs.paused === 'true' && !lbl(81, Rn).includes('en-cola') && coment(81, Rn) === '');
}

// ── Costura con los workflows (solo en el central) ─────────────────────────
const EM = '.github/workflows/epic-merge.yml';
const CC = '.github/workflows/claude-code.yml';
if (existsSync(EM) && existsSync(CC)) {
  const em = readFileSync(EM, 'utf8');
  const cc = readFileSync(CC, 'utf8');
  const cuerpo = (src, desde, hasta) => { const a = src.indexOf(desde); const b = src.indexOf(hasta, a + 1); return a === -1 ? '' : src.slice(a, b === -1 ? undefined : b); };
  caso('epic-merge: carga `cola-prioridad.cjs` del checkout sparse', /require\(`[^`]*\.epic-merge-central\/vendored\/scripts\/cola-prioridad\.cjs`\)/.test(em));
  caso('epic-merge `armQueue`: elige la cabeza con el orden del módulo', /ordenCola\(queued\)\)\[0\]/.test(cuerpo(em, 'async function armQueue(', 'async function armRecienteDeOtroJob')));
  caso('epic-merge `sweepQueueAtExit`: delega la elección en `armQueue`', /await armQueue\(/.test(cuerpo(em, 'async function sweepQueueAtExit(', '// Helper: label de estado')));
  caso('epic-merge `ordenCola`: usa `ordenarConSuspension`', /COLA\.ordenarConSuspension\(/.test(em));
  caso('epic-merge `cederAUrgente`: usa `cederEslabon`', /COLA\.cederEslabon\(/.test(cuerpo(em, 'async function cederAUrgente(', 'async function postStateClose(')));
  const merge = cuerpo(em, 'const next = Number(lm[1]);', '// ── Cierre POR ESTADO');
  caso('epic-merge, camino de merge: cede ANTES del arm `epic-auto-launch`', merge.indexOf('cederAUrgente(') !== -1 && merge.indexOf('cederAUrgente(') < merge.indexOf('<!-- epic-auto-launch -->'));
  const estado = cuerpo(em, 'const already = await targetAlreadyArmed(next);', 'let prNumber = null;');
  caso('epic-merge, cierre por estado (AP-031): cede ANTES del arm `epic-auto-launch`', estado.indexOf('cederAUrgente(') !== -1 && estado.indexOf('cederAUrgente(') < estado.indexOf('<!-- epic-auto-launch -->'));
  // Suspensión previa (review #315, 🟡 1): o el workflow ya lee `yaSuspendido`
  // antes del arm, o el parche pendiente que lo trae sigue en `docs/patches/`
  // (la App no puede pushear workflows, ADR-020; `check-patches` vigila que
  // aplique).
  const PARCHE_SUS = 'docs/patches/AP-102-launch-next-suspension-previa.patch';
  const parcheSus = existsSync(PARCHE_SUS) ? readFileSync(PARCHE_SUS, 'utf8') : '';
  caso('epic-merge, camino de merge: respeta una suspensión previa ANTES del arm `epic-auto-launch` (o el parche pendiente lo trae)',
    (merge.indexOf('COLA.yaSuspendido(') !== -1 && merge.indexOf('COLA.yaSuspendido(') < merge.indexOf('<!-- epic-auto-launch -->'))
    || /^\+.*COLA\.yaSuspendido\(\{ github, owner, repo, siguiente: next \}\)/m.test(parcheSus));
  caso('epic-merge `targetAlreadyArmed`: la suspensión cuenta como `launch-next` CONSUMIDO', /COLA\.esSuspendido\(cs\)/.test(cuerpo(em, 'async function targetAlreadyArmed(', 'async function cederAUrgente(')));
  caso('claude-code: checkout sparse `.cola-central` del módulo', /path: \.cola-central/.test(cc));
  caso('claude-code `popQueue`: orden del módulo', /COLA\.ordenarConSuspension\(/.test(cuerpo(cc, 'async function popQueue(', 'core.setOutput(\'armed\'')));
  caso('claude-code «Barrido de cola al cierre»: orden del módulo', /COLA\.ordenarConSuspension\(/.test(cuerpo(cc, '- name: Barrido de cola al cierre del job', 'barrido de cola al cierre falló')));
  const ln = cuerpo(cc, '- name: Launch next epic issue', '- name: Barrido de cola al cierre del job');
  caso('claude-code step `launch_next`: cede ANTES de postear el `@claude`', ln.indexOf('COLA.cederEslabon(') !== -1 && ln.indexOf('COLA.cederEslabon(') < ln.lastIndexOf('body: \'@claude\''));
  caso('claude-code step `launch_next`: respeta una suspensión previa ANTES de postear el `@claude` (o el parche pendiente lo trae)',
    (ln.indexOf('COLA.yaSuspendido(') !== -1 && ln.indexOf('COLA.yaSuspendido(') < ln.lastIndexOf('body: \'@claude\''))
    || /^\+.*COLA\.yaSuspendido\(\{ github, owner: context\.repo\.owner, repo: context\.repo\.repo, siguiente: nextIssue \}\)/m.test(parcheSus));
  caso('claude-code guard de cadena: `arm-de-cola` + `eslabon-suspendido` cuenta como re-arm de cadena',
    /armBody\.includes\('arm-de-cola'\)[^]*?eslabon-suspendido/.test(cuerpo(cc, '- name: Check epic chain integrity', '- name: Check panel consumed')));
  // Las dos copias en línea de la regex (los guards corren antes del checkout
  // del módulo) aceptan el literal que el módulo emite.
  const inl = [...cc.matchAll(/\/(\^\[ \\t\]\*<!--\\s\*eslabon-suspendido[^/]*)\/m\.test\(/g)].map((x) => new RegExp(x[1], 'm'));
  caso('claude-code: las DOS regex en línea de los guards aceptan `<!-- eslabon-suspendido: #N -->`', inl.length === 2 && inl.every((re) => re.test(m.marcaSuspendido(42))));
  const guardSerial = cuerpo(cc, '- name: Guard serial — un solo Creator en vuelo', '- name: ');
  const iPausa = guardSerial.indexOf('COLA.retenerArm('), iDep = guardSerial.indexOf('COLA.retenerPorDependencia('), iOk = guardSerial.indexOf("l.name === 'serial-ok'");
  caso('claude-code guard serial (AP-126): `retenerPorDependencia` entre el bloque de pausa y `serial-ok`', iPausa !== -1 && iPausa < iDep && iDep < iOk);
  caso('claude-code guard de panel (AP-126): `depende-de-retenido` cuenta como encolado (exención de salida de cola)',
    /const RE_ENCOLADO = [^\n]*depende-de-retenido/.test(cuerpo(cc, '- name: Check panel consumed', '- name: Checkout repository')));
  caso('claude-code guard de panel: `eslabon-suspendido` cuenta como reanudación',
    /const isResumption[^;]*eslabon-suspendido/.test(cuerpo(cc, '- name: Check panel consumed', '- name: Checkout repository')));
  // Ningún punto de cola conserva la lectura FIFO de 5 ítems (con prioridades,
  // la cabeza puede no estar entre los 5 más antiguos). El filtro barato de
  // existencia de `sweepQueueAtExit` queda fuera: no elige ítem.
  const lecturas5 = [...(em + cc).matchAll(/labels: 'en-cola'[^\n]*per_page: 5\b/g)].length;
  caso('solo el filtro de existencia de `sweepQueueAtExit` lee `en-cola` con `per_page: 5`', lecturas5 === 1
    && /labels: 'en-cola'[^\n]*per_page: 5\b/.test(cuerpo(em, 'async function sweepQueueAtExit(', '// Helper: label de estado')));
}
// Watchdog (review PR #385, 🟡 1): el dependiente con `depende-de` abierto es
// espera legítima en el detector `issue-armed-no-pr`, ANTES de la sospecha de
// `cola-huerfana`, y solo sin el propio PR huérfano (AP-048 intacto).
const WD = '.github/workflows/watchdog.yml';
if (existsSync(WD)) {
  const wd = readFileSync(WD, 'utf8');
  const a = wd.indexOf('- name: Scan for stalled work');
  const scan = a === -1 ? '' : wd.slice(a, wd.indexOf('- name: Harvest flaky candidates', a + 1));
  const iOwn = scan.indexOf('const ownOrphanPR'), iDep = scan.indexOf('COLA.dependenciasAbiertas('), iSos = scan.indexOf('if (!freshSuspicion)');
  caso('watchdog scan (AP-126): `en-cola` con `depende-de` abierto se salta ANTES de la sospecha/`cola-huerfana`', iOwn !== -1 && iOwn < iDep && iDep < iSos);
  caso('watchdog scan (AP-126): la exención no aplica con el propio PR huérfano (interbloqueo AP-048)', /if \(!ownOrphanPR && COLA && COLA\.dependenciasAbiertas\)/.test(scan));
}

// ══ AP-143 · `serial-ok` simétrico en la titularidad de la serie (central#421) ══
// `excluirSerialOk` (pura) y `titularesSerie` (con su listado), y `liberarCola`
// como lector que las usa. Casos (a)–(f) del ruling corregido de #421.
const pr = (number, ref) => ({ number, head: { ref } });
{
  const claudePRs = [pr(3562, 'claude/issue-3558-20261104-1100'), pr(3570, 'claude/issue-3497-20261104-1130'), pr(3571, 'claude/fix-suelto')];
  const r = m.excluirSerialOk({ claudePRs, serialOk: [3558] });
  caso('AP-143 (a) PR `claude/issue-3558-…` con 3558 en `serialOk` ⇒ excluido', !r.some((p) => p.number === 3562));
  caso('AP-143 (b) PR `claude/issue-3497-…` sin `serial-ok` ⇒ se queda', r.some((p) => p.number === 3570));
  caso('AP-143 (c) rama que no es `claude/issue-N-*` ⇒ se queda', r.some((p) => p.number === 3571));
  const v = m.excluirSerialOk({ claudePRs, serialOk: [] });
  caso('AP-143 (d) `serialOk` vacío ⇒ todo igual', v.length === 3 && v.every((p, i) => p === claudePRs[i]));
  caso('AP-143 (c-bis) N es el número entero de la rama: 355 no excluye `claude/issue-3558-…`',
    m.excluirSerialOk({ claudePRs, serialOk: [355] }).length === 3);
}
{
  // titularesSerie: filtra `claude/*`, lista `serial-ok` una vez y devuelve los excluidos.
  const prs = [pr(3562, 'claude/issue-3558-x'), pr(3570, 'claude/issue-3497-x'), pr(9, 'dependabot/npm')];
  const R = repoFalso([{ number: 3558, created_at: T(1), labels: ['serial-ok'] }, { number: 3497, created_at: T(1), labels: [] }]);
  const t = await m.titularesSerie({ ...R, prs });
  caso('AP-143 titularesSerie: solo cuentan los `claude/*` sin `serial-ok`; excluidos y sin fallo',
    t.prs.map((p) => p.number).join() === '3570' && t.excluidos.join() === '3562' && t.fallo === false);
  const avisos = [];
  const R2 = repoFalso([{ number: 3558, created_at: T(1), labels: ['serial-ok'] }], { serialOkRoto: true });
  const t2 = await m.titularesSerie({ ...R2, prs, warn: (w) => avisos.push(w) });
  caso('AP-143 titularesSerie: listado fallido ⇒ `warn`, `fallo: true` y no excluye nada (fail-closed)',
    t2.fallo === true && t2.prs.map((p) => p.number).join() === '3562,3570' && t2.excluidos.length === 0 && avisos.length === 1);
}
{
  // (e)/(f) liberarCola: el único PR abierto es de un issue `serial-ok`, sin `serial-activo`.
  const mundo = () => [{ number: 3493, created_at: T(1), labels: ['en-cola', 'epica'] }, { number: 3558, created_at: T(1), labels: ['serial-ok'] }];
  const prs = [pr(3562, 'claude/issue-3558-20261104-1100')];
  const R = repoFalso(mundo(), { prs });
  const armados = [];
  const armar = async (next) => { armados.push(next.number); };
  const r = await m.liberarCola({ ...R, armar });
  caso('AP-143 (e) liberarCola: `en-cola` y solo un PR `serial-ok` abierto ⇒ arma la cabeza, sin «serie ocupada»',
    r.accion === 'armado' && r.numero === 3493 && armados.join() === '3493');
  const R2 = repoFalso(mundo(), { prs, serialOkRoto: true });
  const avisos = [];
  const r2 = await m.liberarCola({ ...R2, armar: async () => { throw new Error('no debía armar'); }, warn: (w) => avisos.push(w) });
  caso('AP-143 (f) …con el listado de `serial-ok` fallando ⇒ «serie ocupada», como hoy',
    r2.accion === 'no-op' && /serie ocupada por #3562/.test(r2.motivo) && avisos.length === 1);
  const R3 = repoFalso(mundo(), { prs: [...prs, pr(3570, 'claude/issue-3497-x')] });
  const r3 = await m.liberarCola({ ...R3, armar: async () => { throw new Error('no debía armar'); } });
  caso('AP-143 (e-bis) …con otro PR `claude/*` sin `serial-ok` la serie sigue ocupada (regla serial intacta)',
    r3.accion === 'no-op' && r3.motivo === 'serie ocupada por #3570');
}
// Costura (AP-143): los cuatro lectores en YAML llaman a `titularesSerie` y
// conservan el fallback a todos los `claude/*` sin `COLA`.
{
  const lectores = [];
  if (existsSync('.github/workflows/claude-code.yml')) {
    const cc = readFileSync('.github/workflows/claude-code.yml', 'utf8');
    const g = cc.indexOf('- name: Guard serial');
    const guardTxt = g === -1 ? '' : cc.slice(g, cc.indexOf('\n      - name:', g + 1));
    const iT = guardTxt.indexOf('COLA.titularesSerie('), iIn = guardTxt.indexOf('const inFlightPRs');
    caso('AP-143 costura: el guard serial llama a `titularesSerie` antes de `inFlightPRs`', iT !== -1 && iIn !== -1 && iT < iIn
      && /const claudePRs = titulares\.prs;/.test(guardTxt));
    lectores.push(['guard serial', guardTxt.slice(0, iIn)]);
    const b = cc.indexOf('barrido de cola: serie OCUPADA por ${held');
    lectores.push(['barrido de cola al cierre', b === -1 ? '' : cc.slice(cc.lastIndexOf('const held', b), b)]);
  }
  if (existsSync('.github/workflows/epic-merge.yml')) {
    const em = readFileSync('.github/workflows/epic-merge.yml', 'utf8');
    const b = em.indexOf('[epic-merge] barrido de cola: serie OCUPADA por ${held');
    lectores.push(['barrido de epic-merge', b === -1 ? '' : em.slice(em.lastIndexOf('const held', b), b)]);
  }
  if (existsSync('.github/workflows/watchdog.yml')) {
    const wd = readFileSync('.github/workflows/watchdog.yml', 'utf8');
    const t = wd.indexOf('const titularesCola');
    lectores.push(['cola-huerfana del Watchdog', t === -1 ? '' : wd.slice(t, wd.indexOf(';', t))]);
    caso('AP-143 costura: `foreignHolder` lee `titularesCola`, no `openAgentPRs`',
      /titularesCola\.some\(p => !p\.head\.ref\.startsWith\(`claude\/issue-\$\{issue\.number\}-`\)\)/.test(wd)
      && !/openAgentPRs\.some\(p => !p\.head\.ref\.startsWith\(`claude\/issue-\$\{issue\.number\}-`\)\)/.test(wd));
  }
  for (const [n, txt] of lectores) {
    caso(`AP-143 costura (${n}): llama a \`COLA.titularesSerie\` con fallback sin módulo`,
      /\(COLA && COLA\.titularesSerie\)/.test(txt) && /COLA\.titularesSerie\(\{ github,/.test(txt)
      && (/startsWith\('claude\/'\)/.test(txt) || /: openAgentPRs/.test(txt)));
  }
}

// ── Copias: la del consumidor (`scripts/`) es la del central ───────────────
if (existsSync('vendored/scripts/cola-prioridad.cjs') && existsSync('scripts/cola-prioridad.cjs')) {
  caso('scripts/cola-prioridad.cjs idéntico a vendored/scripts/cola-prioridad.cjs',
    readFileSync('vendored/scripts/cola-prioridad.cjs', 'utf8') === readFileSync('scripts/cola-prioridad.cjs', 'utf8'));
}

if (fallos.length) {
  console.error(`CHECK-COLA-PRIORIDAD ROJO (${fuente}): ${fallos.length} caso(s) fallan:`);
  for (const f of fallos) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check-cola-prioridad verde (${fuente}): todos los casos pasan.`);
