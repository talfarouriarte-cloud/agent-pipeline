#!/usr/bin/env node
// check-panel-al-encolar — banco del guard de panel evaluado AL ENCOLAR, no al
// salir de la cola (central#320, ruling mensual 2026-10-05, punto 6).
//
// Ejecuta los scripts EMBEBIDOS reales (no copias) de claude-code.yml en el
// orden y con el gate del workflow: `check_panel` y, solo si no bloquea,
// `check_serial` (su `if:` exige `check_panel.blocked != 'true'`). La API de
// GitHub es un doble en memoria con estado: labels, comentarios con autor y
// fecha, PRs abiertos. El pop de la cola se modela como lo escriben sus puntos
// reales (retira `en-cola`, comenta `<!-- arm-de-cola -->` con el PAT).
//
// Casos del ruling: (a) serie ocupada + panel abierto al armar ⇒ no se encola,
// `panel-sin-consumir`; (b) serie ocupada + sin panel al armar + panel nacido
// durante la espera ⇒ al salir de la cola arma; (c) serie libre + panel
// abierto ⇒ bloquea como hoy; (d) `watchdog-rearm` sobre un issue salido de
// cola ⇒ exento. Más los bordes que la exención NO debe abrir.
//
// Cuelga del piggyback de `check-embedded-js.mjs` por la misma razón que sus
// hermanos. Verde: exit 0.
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const CC = '.github/workflows/claude-code.yml';
if (!existsSync(CC)) {
  console.log('::warning::check-panel-al-encolar — sin claude-code.yml local (consumidor): el banco NO se ha ejecutado.');
  process.exit(0);
}
const require = createRequire(import.meta.url);
const fallos = [];
const caso = (nombre, ok) => { if (!ok) fallos.push(nombre); };

const wf = yaml.load(readFileSync(CC, 'utf8'));
const steps = Object.values(wf.jobs || {}).flatMap(j => j.steps || []);
const idx = id => steps.findIndex(s => s.id === id);
const panelStep = steps[idx('check_panel')];
const serialStep = steps[idx('check_serial')];
if (!panelStep || !serialStep) {
  console.error('CHECK-PANEL-AL-ENCOLAR ROJO: steps `check_panel`/`check_serial` no encontrados en claude-code.yml');
  process.exit(1);
}
// Punto 1 del ruling: el orden ES el contrato. El panel corre antes y gatea al
// serial; si alguien los reordena o quita el gate, la exención de salida de
// cola deja de ser correcta (un ítem podría encolarse sin pasar el panel).
caso('orden: `check_panel` va ANTES de `check_serial`', idx('check_panel') < idx('check_serial'));
caso('gate: el `if:` de `check_serial` exige `check_panel.blocked != \'true\'`',
  /steps\.check_panel\.outputs\.blocked != 'true'/.test(serialStep.if || ''));

const panelRun = cargarStep(panelStep.with.script, 'check_panel');
const serialRun = cargarStep(serialStep.with.script, 'check_serial');
let COLA = null;
for (const f of ['vendored/scripts/cola-prioridad.cjs', 'scripts/cola-prioridad.cjs']) {
  if (existsSync(f)) { COLA = require(resolve(f)); break; }
}
const reqInyectado = p => (String(p).endsWith('cola-prioridad.cjs') && COLA ? COLA : require(p));

// ── Doble de la API, con estado ─────────────────────────────────────────────
let reloj = Date.parse('2026-10-05T20:00:00Z');
const tic = () => new Date(reloj += 60 * 1000).toISOString();
function mundo() {
  const st = new Map();
  const W = { st, prs: [], runs: [] };
  W.issue = (number, labels = [], body = '') => { st.set(number, { number, title: `Issue ${number}`, body, state: 'open', labels: [...labels], comments: [], created_at: tic() }); return number; };
  W.coment = (n, body, author_association = 'OWNER') => { st.get(n).comments.push({ body, author_association, created_at: tic() }); };
  W.github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      pulls: { list: async () => ({ data: W.prs.map(p => ({ ...p })) }) },
      actions: {
        listWorkflowRunsForRepo: async ({ status }) => ({ data: { workflow_runs: W.runs.filter(r => r.status === status) } }),
        listJobsForWorkflowRun: async () => ({ data: { jobs: [] } }),
      },
      issues: {
        listForRepo: async ({ state, labels }) => ({ data: [...st.values()]
          .filter(i => (!state || i.state === state) && (!labels || i.labels.includes(labels)))
          .map(i => ({ number: i.number, title: i.title, state: i.state, created_at: i.created_at, labels: i.labels.map(name => ({ name })) })) }),
        listComments: async ({ issue_number }) => ({ data: [...st.get(issue_number).comments] }),
        addLabels: async ({ issue_number, labels }) => { const i = st.get(issue_number); for (const l of labels) if (!i.labels.includes(l)) i.labels.push(l); return { data: {} }; },
        removeLabel: async ({ issue_number, name }) => { const i = st.get(issue_number); i.labels = i.labels.filter(l => l !== name); return { data: {} }; },
        // El PAT del propietario: autor de confianza, como en producción.
        createComment: async ({ issue_number, body }) => { W.coment(issue_number, body); return { data: {} }; },
      },
    },
  };
  return W;
}
// Serie ocupada: un PR `claude/*` de OTRO issue abierto (titular canónico).
const ocupar = W => { W.prs = [{ number: 900, head: { ref: 'claude/issue-50-x' } }]; };
const liberar = W => { W.prs = []; };
// Arm real: comentario de arm en el issue + `check_panel` → (`check_serial`).
async function armar(W, n, armBody) {
  W.coment(n, armBody);
  const i = W.st.get(n);
  const issue = { number: n, title: i.title, body: i.body, created_at: i.created_at, labels: i.labels.map(name => ({ name })) };
  const context = { repo: { owner: 'o', repo: 'r' }, runId: 700 + n, workflow: 'Claude Code', eventName: 'issue_comment',
    payload: { issue, comment: { body: armBody, created_at: new Date(reloj).toISOString() } } };
  const r = { panel: {}, serial: null };
  const core = o => ({ setOutput: (k, v) => { o[k] = String(v); }, notice() {}, info() {}, warning() {}, setFailed: m => { throw new Error(m); } });
  const prev = process.env.IN_EPIC_LABEL;
  process.env.IN_EPIC_LABEL = 'epica';
  try {
    await panelRun({ github: W.github, context, core: core(r.panel), require: reqInyectado });
    if (r.panel.blocked !== 'true') { r.serial = {}; await serialRun({ github: W.github, context, core: core(r.serial), require: reqInyectado }); }
  } finally { if (prev === undefined) delete process.env.IN_EPIC_LABEL; else process.env.IN_EPIC_LABEL = prev; }
  r.armado = r.panel.blocked !== 'true' && r.serial && r.serial.blocked !== 'true';
  return r;
}
// Pop de cola tal y como lo escriben sus puntos (epic-merge `armQueue`, …).
async function pop(W, n) {
  await W.github.rest.issues.removeLabel({ issue_number: n, name: 'en-cola' });
  return armar(W, n, '@claude arranca — turno de cola: la serie quedó libre (merge de #60).\n\n<!-- arm-de-cola -->');
}
const lbl = (W, n) => W.st.get(n).labels;
const tiene = (W, n, marca) => W.st.get(n).comments.some(c => c.body.includes(marca));
const ARM = '@claude arranca la épica';

// ── (a) serie ocupada + panel abierto al armar ⇒ no se encola
{
  const W = mundo();
  W.issue(30, ['auditoria']);
  const E = W.issue(20, ['epica'], '<!-- epic-audit: x -->');
  ocupar(W);
  const r = await armar(W, E, ARM);
  caso('(a) el guard de panel bloquea', r.panel.blocked === 'true');
  caso('(a) el guard serial NO corre (gate del workflow)', r.serial === null);
  caso('(a) el issue NO entra en `en-cola`', !lbl(W, E).includes('en-cola'));
  caso('(a) comentario `panel-sin-consumir` con las opciones a/b/c', tiene(W, E, '<!-- panel-sin-consumir -->') && tiene(W, E, 'panel-consumido: #N') && tiene(W, E, 'panel-ok'));
}

// ── (b) serie ocupada + sin panel al armar + panel nacido en la espera ⇒ arma
{
  const W = mundo();
  const E = W.issue(20, ['epica', 'prioridad:alta'], '<!-- epic-audit: x -->');
  ocupar(W);
  const r1 = await armar(W, E, ARM);
  caso('(b) al armar: panel pasa y el serial encola', r1.panel.blocked === 'false' && r1.serial?.blocked === 'true' && lbl(W, E).includes('en-cola'));
  caso('(b) el texto del encolado cita el orden de AP-102 (no «el más antiguo de la cola»)',
    tiene(W, E, 'urgente → eslabón suspendido → alta → normal') && !tiene(W, E, 'armará automáticamente el más antiguo'));
  // Merge del suelto: epic-merge abre su auditoría justo antes del pop.
  W.issue(32, ['auditoria']);
  liberar(W);
  const r2 = await pop(W, E);
  caso('(b) al salir de la cola: el panel nacido en la espera NO bloquea', r2.panel.blocked === 'false');
  caso('(b) al salir de la cola: arma (sin `stalled` ni `panel-sin-consumir`)', r2.armado && !lbl(W, E).includes('stalled') && !tiene(W, E, '<!-- panel-sin-consumir -->'));
}

// ── (c) serie libre + panel abierto ⇒ bloquea como hoy
{
  const W = mundo();
  W.issue(30, ['process-proposal']);
  const E = W.issue(20, ['epica'], '<!-- epic-audit: x -->');
  const r = await armar(W, E, ARM);
  caso('(c) bloquea con `stalled` + `panel-sin-consumir`', r.panel.blocked === 'true' && lbl(W, E).includes('stalled') && tiene(W, E, '<!-- panel-sin-consumir -->'));
  caso('(c) ni encola ni corre el serial', r.serial === null && !lbl(W, E).includes('en-cola'));
}

// ── (d) watchdog-rearm sobre un issue salido de cola ⇒ exento
// Cada re-arm en su propio mundo: el comentario `panel-sin-consumir` de un
// bloqueo previo cita `<!-- panel-ok -->` (opción c) y contaminaría el siguiente.
async function salidoDeCola() {
  const W = mundo();
  const E = W.issue(20, ['epica'], '<!-- epic-audit: x -->');
  ocupar(W);
  await armar(W, E, ARM);
  liberar(W);
  await pop(W, E);
  // El Creator muere sin PR; entretanto nace un panel.
  W.st.get(E).labels = W.st.get(E).labels.filter(l => l !== 'serial-activo');
  W.issue(33, ['auditoria']);
  return { W, E };
}
{
  const { W, E } = await salidoDeCola();
  const r = await armar(W, E, '@claude re-arm del Watchdog.\n\n<!-- watchdog-rearm -->');
  caso('(d) `watchdog-rearm` hereda la exención por el `arm-de-cola` del historial', r.panel.blocked === 'false' && r.armado);
}
{
  const { W, E } = await salidoDeCola();
  const r = await armar(W, E, '@claude re-arm tras ruling de architect-resolve.');
  caso('(d) re-arm de architect-resolve: también exento', r.panel.blocked === 'false' && r.armado);
}

// ── Bordes: lo que la exención NO abre
{
  // `watchdog-rearm` de un issue que NUNCA estuvo en cola ⇒ bloquea como hoy.
  const W = mundo();
  W.issue(30, ['auditoria']);
  const E = W.issue(20, ['epica'], '<!-- epic-audit: x -->');
  const r = await armar(W, E, '@claude re-arm.\n\n<!-- watchdog-rearm -->');
  caso('borde: `watchdog-rearm` sin salida de cola en el historial ⇒ bloquea', r.panel.blocked === 'true');
}
{
  // `arm-de-cola` en un comentario AJENO (no TRUSTED) del historial ⇒ no exime.
  const W = mundo();
  W.issue(30, ['auditoria']);
  const E = W.issue(20, ['epica'], '<!-- epic-audit: x -->');
  W.coment(E, '<!-- serial-guard -->');
  W.coment(E, 'copio esto <!-- arm-de-cola -->', 'NONE');
  const r = await armar(W, E, ARM);
  caso('borde: `arm-de-cola` de autor no confiable ⇒ bloquea', r.panel.blocked === 'true');
}
{
  // `arm-de-cola` de confianza ANTERIOR a todo encolado ⇒ no exime.
  const W = mundo();
  W.issue(30, ['auditoria']);
  const E = W.issue(20, ['epica'], '<!-- epic-audit: x -->');
  W.coment(E, 'nota <!-- arm-de-cola -->');
  const r = await armar(W, E, ARM);
  caso('borde: `arm-de-cola` sin encolado previo ⇒ bloquea', r.panel.blocked === 'true');
}
{
  // Retenido por `pausa-cola` (marcador del módulo) y luego sale por la cola.
  const W = mundo();
  const E = W.issue(20, ['epica'], '<!-- epic-audit: x -->');
  W.coment(E, '**claude-code · pausa de cola**\n\n<!-- pausa-cola-retenido -->');
  W.st.get(E).labels.push('en-cola');
  W.issue(30, ['auditoria']);
  W.coment(E, '@claude arranca — turno de cola.\n\n<!-- arm-de-cola -->');
  const r = await armar(W, E, '@claude re-arm.\n\n<!-- watchdog-rearm -->');
  caso('borde: encolado por `pausa-cola-retenido` + `arm-de-cola` posterior ⇒ exento', r.panel.blocked === 'false');
}

if (fallos.length) {
  console.error(`CHECK-PANEL-AL-ENCOLAR ROJO (${fallos.length}):\n${fallos.map(f => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('check-panel-al-encolar verde: (a) panel al encolar bloquea sin encolar, (b) la salida de cola arma, (c) serie libre como hoy, (d) re-arms heredan la exención; bordes cerrados.');
