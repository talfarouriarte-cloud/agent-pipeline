#!/usr/bin/env node
// check-flight-guard — banco del vuelo único del Creator en contexto PR (step
// `check_flight` de claude-code.yml) y del ramal «sesión inexistente» del
// post-step `post_muerte_sin_pr` (central#309, ruling mensual 2026-10-05).
//
// Criterio falsable del ruling:
//  (a) dos disparos sobre el mismo PR con 10 s de diferencia ⇒ UNA sesión y un
//      comentario de descarte;
//  (b) un comentario sin trigger concurrente con un disparo legítimo no lo
//      descarta;
//  (c) un job sin sesión no produce `stalled`.
// Central#318 (ruling mensual 2026-10-05): la rama de bloqueo llamaba a
// `getOctokit`, que github-script@v7 no provee; este banco la daba por buena
// porque lo inyectaba como parámetro con un mock. Desde entonces los scripts se
// cargan con `scripts/lib/github-script.mjs` (EXACTAMENTE los argumentos del
// runner) y se añaden: (a2) fallo al comentar ⇒ `blocked=true` sin run rojo;
// (e) el cargador rechaza un global no provisto.
// Ejecuta los scripts EMBEBIDOS reales (no copias) contra un doble de la API.
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const wf = yaml.load(readFileSync('.github/workflows/claude-code.yml', 'utf8'));
const steps = {};
for (const job of Object.values(wf.jobs || {})) for (const st of job.steps || []) if (st.id) steps[st.id] = st;
for (const id of ['check_flight', 'post_muerte_sin_pr']) {
  if (!steps[id]) { console.error(`CHECK-FLIGHT-GUARD ROJO: step \`${id}\` no encontrado en claude-code.yml`); process.exit(1); }
}
const flight = cargarStep(steps.check_flight.with.script, 'check_flight');
const muerte = cargarStep(steps.post_muerte_sin_pr.with.script, 'post_muerte_sin_pr');

const WF = 'Claude Code';
const T0 = Date.now() - 60 * 1000;
const at = s => new Date(T0 + s * 1000).toISOString();
const PR = { number: 50, title: 'feat: algo (#40)', head: { ref: 'claude/issue-40-20261005-0700' } };
const ISSUE40 = { number: 40, title: 'Issue cuarenta' };
const prRun = (id, s, extra = {}) => ({ id, name: WF, event: 'issue_comment', display_title: PR.title, head_branch: 'main', created_at: at(s), ...extra });

async function guard(world, runId) {
  const w = { comments: [], outputs: {}, labels: [] };
  const github = {
    rest: {
      pulls: { get: async () => ({ data: PR }) },
      issues: {
        get: async p => ({ data: p.issue_number === 40 ? ISSUE40 : { number: p.issue_number, title: '' } }),
        addLabels: async p => { w.labels.push(...p.labels); },
        createComment: async () => { throw new Error('el descarte debe ir con el token del job, no con el PAT'); },
      },
      actions: {
        listWorkflowRunsForRepo: async p => {
          if (world.runsDown) throw new Error('API caída (runs)');
          return { data: { workflow_runs: (world.runs || []).filter(r => (r.status || 'in_progress') === p.status) } };
        },
        listJobsForWorkflowRun: async p => {
          if ((world.jobsDown || []).includes(p.run_id)) throw new Error('API caída (jobs)');
          const skipped = (world.skipped || []).includes(p.run_id);
          return { data: { jobs: [{ name: 'call / claude', status: skipped ? 'completed' : 'in_progress', conclusion: skipped ? 'skipped' : null }] } };
        },
      },
    },
  };
  // El descarte sale por `fetch` global con el token del job (DEFAULT_GH_TOKEN).
  const fetch = async (url, init = {}) => {
    if (world.commentDown) throw new Error('red caída (comentario)');
    const m = String(url).match(/\/issues\/(\d+)\/comments$/);
    if (!m || init.method !== 'POST') throw new Error(`fetch inesperado: ${init.method || 'GET'} ${url}`);
    if (init.headers?.Authorization !== 'Bearer job-token') throw new Error('el descarte debe ir con el token del job');
    if (world.commentStatus) return { ok: false, status: world.commentStatus };
    w.comments.push({ n: Number(m[1]), body: JSON.parse(init.body).body });
    return { ok: true, status: 201 };
  };
  const context = { repo: { owner: 'o', repo: 'r' }, runId, workflow: WF, eventName: 'issue_comment',
    payload: { issue: { number: PR.number, title: PR.title, pull_request: {} } } };
  const core = { setOutput: (k, v) => { w.outputs[k] = String(v); }, notice() {}, warning() {}, info() {} };
  try { await flight({ github, context, core }, { env: { DEFAULT_GH_TOKEN: 'job-token' }, globales: { fetch } }); }
  catch (e) { w.threw = e; }
  return w;
}

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok ' : '  ROJO'} ${msg}`); if (!ok) fails++; };
const sessions = ws => ws.filter(w => w.outputs.blocked !== 'true').length;
const clean = w => w.comments.every(c => !/<!--|@\w/.test(c.body)) && w.labels.length === 0;

// (a) dos pings con 10 s de diferencia sobre el mismo PR.
{
  const world = { runs: [prRun(100, 0), prRun(101, 10)] };
  const ws = [await guard(world, 100), await guard(world, 101)];
  check(sessions(ws) === 1, '(a) dos disparos a 10 s ⇒ UNA sesión');
  check(ws[1].outputs.blocked === 'true' && ws[1].comments.length === 1 && /run 100/.test(ws[1].comments[0].body), '(a) el más nuevo cede ante el de menor id con UN comentario de descarte');
  check(ws[0].comments.length === 0, '(a) el ganador no comenta');
  check(ws.every(clean), '(a) sin marcadores, menciones ni labels (stalled/human-needed/serial-activo)');
  check(ws.every(w => !w.threw), `(a) ninguna rama del guard lanza (run en verde)${ws.find(w => w.threw) ? ': ' + ws.find(w => w.threw).threw.message : ''}`);
}
// (a2) el comentario de descarte falla (red caída o HTTP no-ok) ⇒ se descarta igual, sin run rojo.
for (const fallo of [{ commentDown: true }, { commentStatus: 500 }]) {
  const w = await guard({ runs: [prRun(100, 0), prRun(101, 10)], ...fallo }, 101);
  check(w.outputs.blocked === 'true' && !w.threw && w.comments.length === 0, `(a2) comentario fallido (${Object.keys(fallo)[0]}) ⇒ blocked=true y el step no lanza`);
}
// (a') el contendiente llega por `pull_request_review` (head_branch = rama del PR) o por el issue de la rama.
{
  const world = { runs: [prRun(100, 0, { event: 'pull_request_review', display_title: 'otro título', head_branch: PR.head.ref }), prRun(101, 5)] };
  check((await guard(world, 101)).outputs.blocked === 'true', "(a') contendiente por misma head_branch ⇒ cede");
  const world2 = { runs: [prRun(100, 0, { display_title: ISSUE40.title }), prRun(101, 5)] };
  check((await guard(world2, 101)).outputs.blocked === 'true', "(a') contendiente sobre el issue de la rama claude/issue-40-* ⇒ cede");
}
// (b) comentario sin trigger (job skipped) concurrente con un disparo legítimo.
{
  const world = { runs: [prRun(100, 0), prRun(101, 3)], skipped: [100] };
  const w = await guard(world, 101);
  check(w.outputs.blocked === 'false' && w.comments.length === 0, '(b) un run con el job del Creator skipped no descarta al legítimo');
}
// Otros PRs no cuentan; un run más nuevo no tumba al viejo.
{
  const world = { runs: [prRun(99, 0, { display_title: 'otro PR', head_branch: 'claude/issue-77-x' }), prRun(100, 2), prRun(105, 4)] };
  check((await guard(world, 100)).outputs.blocked === 'false', 'runs de otro PR o con id mayor no son contendientes');
}
// Fail-closed en lo ilegible; fail-open con la API de runs caída (statu quo).
{
  check((await guard({ runs: [prRun(100, 0), prRun(101, 3)], jobsDown: [100] }, 101)).outputs.blocked === 'true', 'jobs ilegibles del contendiente ⇒ cuenta (fail-closed)');
  check((await guard({ runsDown: true }, 101)).outputs.blocked === 'false', 'API de runs caída ⇒ pasa (statu quo previo)');
}

// (c) post-step: la action no lanzó sesión (sin execution file) ⇒ sin stalled.
async function postStep({ outcome, labels }) {
  const w = { added: [], removed: [], comments: [], outputs: {} };
  const github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      pulls: { list: async () => ({ data: [] }) },
      git: { listMatchingRefs: async () => ({ data: [] }) },
      issues: {
        get: async () => ({ data: { labels: labels.map(name => ({ name })) } }),
        listForRepo: async () => ({ data: [] }),
        listComments: async () => ({ data: [] }),
        addLabels: async p => { w.added.push(...p.labels); },
        removeLabel: async p => { w.removed.push(p.name); },
        createComment: async p => { w.comments.push(p.body); },
      },
    },
  };
  const env = { ...process.env };
  process.env.EXEC_FILE = join(mkdtempSync(join(tmpdir(), 'flight-')), 'claude-execution-output.json');
  process.env.STEP_CREATOR_OUTCOME = outcome;
  process.env.IN_DEFAULT_BRANCH = 'main';
  const context = { repo: { owner: 'o', repo: 'r' }, runId: 1, payload: { issue: { number: 309, title: 'x', labels: [] } } };
  const core = { setOutput: (k, v) => { w.outputs[k] = String(v); }, notice() {}, warning() {}, info() {} };
  try { await muerte({ github, context, core }); } finally { process.env = env; }
  return w;
}
{
  const w = await postStep({ outcome: 'success', labels: ['serial-activo'] });
  check(!w.added.includes('stalled') && w.comments.length === 0, '(c) sesión inexistente ⇒ sin stalled ni comentario/marcador');
  check(w.removed.includes('serial-activo'), '(c) sesión inexistente ⇒ serial-activo liberada');
  const f = await postStep({ outcome: 'failure', labels: ['serial-activo'] });
  check(f.added.includes('stalled'), '(c) fallo de la action sin execution file ⇒ camino de siempre (stalled)');
}

// (e) el cargador reproduce el runtime: un global no provisto da ReferenceError
// (la regresión de AP-100) y un argumento que github-script no inyecta se rechaza.
{
  const core = { setOutput() {}, warning() {}, notice() {}, info() {} };
  let err = null;
  try { await cargarStep('const gh = getOctokit(process.env.DEFAULT_GH_TOKEN); core.setOutput("blocked", "true");', 'regresion-ap100')({ github: {}, context: {}, core }); }
  catch (e) { err = e; }
  check(err instanceof ReferenceError && /getOctokit/.test(err.message), '(e) script con `getOctokit` (no provisto por github-script@v7) ⇒ ReferenceError en el banco');
  let rech = null;
  try { await cargarStep('return 1;', 'inyeccion')({ github: {}, context: {}, core, getOctokit: () => ({}) }); }
  catch (e) { rech = e; }
  check(!!rech && /getOctokit/.test(rech.message) && /prohibido/.test(rech.message), '(e) el cargador rechaza inyectar `getOctokit`');
  check(!/\bgetOctokit\s*\(/.test(steps.check_flight.with.script), '(e) check_flight no llama a `getOctokit`');
}

if (fails) { console.error(`CHECK-FLIGHT-GUARD ROJO: ${fails} caso(s) fallan.`); process.exit(1); }
console.log('check-flight-guard verde.');
