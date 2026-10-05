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
// Verde: exit 0. Rojo: el comportamiento real cambió y el banco lo nota.
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

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
function repoFalso(issues) {
  const st = new Map();
  for (const i of issues) st.set(i.number, { state: 'open', comments: [], ...i, labels: [...(i.labels || [])] });
  const vista = (i) => ({ number: i.number, state: i.state, created_at: i.created_at, labels: i.labels.map((name) => ({ name })) });
  let cid = 1000;
  const github = { rest: { issues: {
    async listForRepo({ state, labels }) {
      const data = [...st.values()]
        .filter((i) => (!state || i.state === state) && (!labels || i.labels.includes(labels)))
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .map(vista);
      return { data };
    },
    async listComments({ issue_number }) { return { data: [...st.get(issue_number).comments] }; },
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
      st.get(issue_number).comments.push({ id: cid++, body, author_association: 'OWNER' });
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
  caso('epic-merge `targetAlreadyArmed`: la suspensión cuenta como `launch-next` CONSUMIDO', /COLA\.esSuspendido\(cs\)/.test(cuerpo(em, 'async function targetAlreadyArmed(', 'async function cederAUrgente(')));
  caso('claude-code: checkout sparse `.cola-central` del módulo', /path: \.cola-central/.test(cc));
  caso('claude-code `popQueue`: orden del módulo', /COLA\.ordenarConSuspension\(/.test(cuerpo(cc, 'async function popQueue(', 'core.setOutput(\'armed\'')));
  caso('claude-code «Barrido de cola al cierre»: orden del módulo', /COLA\.ordenarConSuspension\(/.test(cuerpo(cc, '- name: Barrido de cola al cierre del job', 'barrido de cola al cierre falló')));
  const ln = cuerpo(cc, '- name: Launch next epic issue', '- name: Barrido de cola al cierre del job');
  caso('claude-code step `launch_next`: cede ANTES de postear el `@claude`', ln.indexOf('COLA.cederEslabon(') !== -1 && ln.indexOf('COLA.cederEslabon(') < ln.lastIndexOf('body: \'@claude\''));
  caso('claude-code guard de cadena: `arm-de-cola` + `eslabon-suspendido` cuenta como re-arm de cadena',
    /armBody\.includes\('arm-de-cola'\)[^]*?eslabon-suspendido/.test(cuerpo(cc, '- name: Check epic chain integrity', '- name: Check panel consumed')));
  // Las dos copias en línea de la regex (los guards corren antes del checkout
  // del módulo) aceptan el literal que el módulo emite.
  const inl = [...cc.matchAll(/\/(\^\[ \\t\]\*<!--\\s\*eslabon-suspendido[^/]*)\/m\.test\(/g)].map((x) => new RegExp(x[1], 'm'));
  caso('claude-code: las DOS regex en línea de los guards aceptan `<!-- eslabon-suspendido: #N -->`', inl.length === 2 && inl.every((re) => re.test(m.marcaSuspendido(42))));
  caso('claude-code guard de panel: `eslabon-suspendido` cuenta como reanudación',
    /const isResumption[^;]*eslabon-suspendido/.test(cuerpo(cc, '- name: Check panel consumed', '- name: Checkout repository')));
  // Ningún punto de cola conserva la lectura FIFO de 5 ítems (con prioridades,
  // la cabeza puede no estar entre los 5 más antiguos). El filtro barato de
  // existencia de `sweepQueueAtExit` queda fuera: no elige ítem.
  const lecturas5 = [...(em + cc).matchAll(/labels: 'en-cola'[^\n]*per_page: 5\b/g)].length;
  caso('solo el filtro de existencia de `sweepQueueAtExit` lee `en-cola` con `per_page: 5`', lecturas5 === 1
    && /labels: 'en-cola'[^\n]*per_page: 5\b/.test(cuerpo(em, 'async function sweepQueueAtExit(', '// Helper: label de estado')));
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
