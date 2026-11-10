#!/usr/bin/env node
// check-watchdog-gate0 — banco de AP-122 (central#285): los dos caminos de
// `stalled` del step `scan` de watchdog.yml (evento `labeled=stalled` y
// re-derivación por estado AP-038) corren DELANTE del Gate 0, así que con otra
// cadena en vuelo un `stalled` produce `stalled-autonomous-resolve` en el
// primer tick (antes esperaba a que el repo callara: 23 min–2 h 21 min).
//
// Ejecuta el script EMBEBIDO real (no una copia) contra un doble de la API,
// siempre con un run `in_progress` del Creator: solo se ejercitan ramas que
// terminan en el Gate 0, así que el doble no necesita el resto del scan.
// Cuelga del piggyback de `check-embedded-js.mjs` por la misma razón que sus
// hermanos (patrón de `check-serial-guard.mjs`).
import { mkdtempSync, readFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const wf = yaml.load(readFileSync('.github/workflows/watchdog.yml', 'utf8'));
let script = null;
for (const job of Object.values(wf.jobs || {})) {
  for (const st of job.steps || []) if (st.id === 'scan') script = st.with.script;
}
if (!script) { console.error('CHECK-WATCHDOG-GATE0 ROJO: step `scan` no encontrado en watchdog.yml'); process.exit(1); }
const run = cargarStep(script, 'scan');

// Workspace de pega: el scan carga los módulos de su checkout sparse `.cola-central`.
const WS = mkdtempSync(join(tmpdir(), 'wd-ws-'));
symlinkSync(process.cwd(), join(WS, '.cola-central'));

const CREATOR_WF = 'Claude Code';
const ENV = {
  GITHUB_WORKSPACE: WS, STATUS_TOKEN: 'x', ARM_PAT: 'x',
  IN_CREATOR_WF: CREATOR_WF, IN_REVIEWER_WF: 'Opus Reviewer', IN_CI_WF: 'CI', IN_EPIC_MERGE_WF: 'Epic merge',
  IN_EXTRA_WFS: '', IN_LOOKBACK_MIN: '45', IN_SKIP_LABELS: 'human-needed,pause-agents',
  IN_AUTOMERGE: 'true', IN_DEFAULT_BRANCH: 'main',
};
const lbl = names => names.map(name => ({ name }));
const AUTO = { body: 'x\n<!-- autonomous-decision -->' };
const HACE = min => new Date(Date.now() - min * 60000).toISOString();
// Issue armado hace 2 h, sin `en-cola` ni PR, en silencio (> STALL_MIN).
const ARMADO = n => ({ number: n, title: 'Absorbido', labels: lbl([]), body: '', created_at: HACE(300), updated_at: HACE(120) });
const ARM = { body: '@claude arranca — turno de cola', user: { login: 'talfarouriarte-cloud' }, created_at: HACE(120) };
const MARCA = x => ({ body: `adenda\n\n<!-- cola-absorbida: #${x} -->`, user: { login: 'talfarouriarte-cloud' }, created_at: HACE(110) });
const CANCELADA = { body: 'vuelve\n<!-- cola-absorbida-cancelada -->', user: { login: 'github-actions[bot]' }, created_at: HACE(100) };
const armedNoPr = (w, n) => (anomalias(w) || []).some(a => a.type === 'issue-armed-no-pr' && a.number === n);

// `inFlight: false` deja pasar el Gate 0 y recorre el resto del scan (detector
// de issues incluido, review PR #380 🔴 1): lo no doblado devuelve vacío.
// AP-149: `world.runs` sustituye al run `enVuelo` por defecto (lista de runs con
// su `status`); `world.full` da el `pulls.get` de cada PR.
async function scan(world, { eventName = 'schedule', payload = {}, inFlight = true } = {}) {
  const w = { added: [], comments: [], outputs: {}, warnings: [], notices: [], infos: [], graphql: [], fetches: [] };
  const enVuelo = { id: 500, name: CREATOR_WF, status: 'in_progress', created_at: new Date(Date.now() - 60000).toISOString() };
  const conocidos = {
    pulls: { list: async () => ({ data: world.prs || [] }),
      get: async p => ({ data: (world.full || {})[p.pull_number] || { number: p.pull_number, draft: false, mergeable_state: 'clean' } }) },
    issues: {
      get: async p => {
        const i = (world.issues || []).find(x => x.number === p.issue_number) || (world.otros || {})[p.issue_number];
        if (!i) throw new Error('404');
        return { data: { state: 'open', ...i } };
      },
      listForRepo: async p => ({ data: (world.issues || []).filter(i => !p.labels
        || p.labels.split(',').every(n => i.labels.some(l => l.name === n))) }),
      listComments: async p => ({ data: (world.comments || {})[p.issue_number] || [] }),
      addLabels: async p => { w.added.push(...p.labels.map(l => `${p.issue_number}:${l}`)); },
      removeLabel: async () => ({}),
      createComment: async p => { w.comments.push({ n: p.issue_number, body: p.body }); },
    },
    actions: {
      listWorkflowRunsForRepo: async p => ({ data: { workflow_runs: world.runs ? (p.status ? world.runs.filter(r => r.status === p.status) : [])
        : inFlight && p.status === 'in_progress' ? [enVuelo] : [] } }),
      listJobsForWorkflowRun: async () => ({ data: { total_count: 1, jobs: [] } }),
      reRunWorkflowFailedJobs: async () => ({}),
    },
  };
  const vacio = async () => ({ data: [] });
  const rest = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (_, m) => (conocidos[ns] && conocidos[ns][m]) || vacio }) });
  const github = { rest, graphql: async (q, v) => { w.graphql.push(q); return {}; }, paginate: async (fn, p) => { const r = await fn(p); return Array.isArray(r.data) ? r.data : (r.data && (r.data.workflow_runs || r.data.items)) || []; } };
  const fetch = async (url, o = {}) => { w.fetches.push(`${o.method || 'GET'} ${url}${o.body ? ' ' + o.body : ''}`); return { ok: true, status: 200, json: async () => ([]), text: async () => '' }; };
  const context = { repo: { owner: 'o', repo: 'r' }, eventName, payload, runId: 1 };
  const core = { setOutput: (k, v) => { w.outputs[k] = String(v); }, notice: m => w.notices.push(String(m)),
    warning: m => w.warnings.push(String(m)), info: m => w.infos.push(String(m)) };
  await run({ github, context, core }, { env: ENV, globales: { fetch } });
  return w;
}
const anomalias = w => JSON.parse(w.outputs.anomalies || 'null');

// AP-149 (central#443): Gate 0 por ítem. Draft huérfano #60 (rama de #61), sin
// escalada, pasado LIVENESS_MIN; otro ítem con un run vivo.
const DRAFT = { number: 60, title: 'PR del 61', node_id: 'N60', labels: lbl([]), head: { ref: 'claude/issue-61-20261110-1100', sha: 'abc' }, base: { ref: 'main', sha: 'b0' }, updated_at: HACE(20) };
const FULL = { 60: { number: 60, draft: true, mergeable_state: 'clean' } };
const RUN = (id, name, extra) => ({ id, name, status: 'in_progress', created_at: HACE(1), ...extra });
const markReady = w => w.graphql.some(q => /markPullRequestReadyForReview/.test(q));
const needsReview = (w, n) => w.fetches.some(f => f.startsWith('POST ') && f.includes(`/issues/${n}/labels`) && f.includes('needs-review'));
const liberaCola = w => w.infos.concat(w.notices).some(m => /barrido de liberación/.test(m));
const ENCOLA = { number: 80, title: 'En cola', labels: lbl(['en-cola']), body: '', created_at: HACE(300), updated_at: HACE(120) };

const BANCO = [
  ['(e) run vivo de CI sobre OTRO PR ⇒ el draft huérfano #60 recibe markReady + needs-review (asesoramiento#3758)',
    async () => {
      const w = await scan({ prs: [DRAFT], full: FULL, issues: [{ number: 61, title: 'Issue 61', labels: lbl([]) }],
        runs: [RUN(700, 'CI', { head_branch: 'claude/issue-99-x', pull_requests: [{ number: 99 }] })] });
      return markReady(w) && needsReview(w, 60) && w.notices.some(m => /Gate 0 por ítem: en vuelo #99/.test(m));
    }],
  ['(e) control: el mismo draft con run vivo SOBRE su propio issue (display_title) ⇒ ni markReady ni needs-review',
    async () => {
      const w = await scan({ prs: [DRAFT], full: FULL, issues: [{ number: 61, title: 'Issue 61', labels: lbl([]) }],
        runs: [RUN(701, CREATOR_WF, { head_branch: 'main', display_title: 'Issue 61' })] });
      return !markReady(w) && !needsReview(w, 60);
    }],
  ['(j) Creator vivo sobre el issue 61 FUERA del listado de issues ⇒ `issues.get(61)` lo identifica: el draft #60 NO recibe markReady',
    async () => {
      const w = await scan({ prs: [DRAFT], full: FULL, issues: [], otros: { 61: { number: 61, title: 'Issue 61' } },
        runs: [RUN(702, CREATOR_WF, { head_branch: 'main', display_title: 'Issue 61' })] });
      return !markReady(w) && !needsReview(w, 60);
    }],
  ['(k) Creator vivo sobre cualquier ítem ⇒ liberarCola no se llama; ítem `en-cola` sin anomalía ni marcador de asentamiento',
    async () => {
      const w = await scan({ issues: [{ number: 70, title: 'Issue 70', labels: lbl([]) }, ENCOLA], comments: { 80: [ARM] },
        runs: [RUN(703, CREATOR_WF, { head_branch: 'main', display_title: 'Issue 70' })] });
      return !liberaCola(w) && w.notices.some(m => /liberación de cola diferida: Creator en vuelo/.test(m))
        && !armedNoPr(w, 80) && !w.comments.some(c => c.n === 80 && /cola-huerfana-sospecha/.test(c.body));
    }],
  ['(k) sin Creator vivo, con un run de CI sobre otro PR ⇒ liberarCola sí se llama',
    async () => {
      const w = await scan({ issues: [{ number: 70, title: 'Issue 70', labels: lbl([]) }],
        runs: [RUN(704, 'CI', { head_branch: 'feature/y', pull_requests: [{ number: 98 }] })] });
      return liberaCola(w) && !w.notices.some(m => /liberación de cola diferida/.test(m));
    }],
  ['(l) run del Reviewer sin ítem identificable ⇒ gate global (como hoy): el draft no recibe markReady',
    async () => {
      const w = await scan({ prs: [DRAFT], full: FULL, issues: [], runs: [RUN(705, 'Opus Reviewer', { head_branch: 'main', display_title: '???' })] });
      return !markReady(w) && w.notices.some(m => /nada que vigilar/.test(m));
    }],
  ['(a) issue con stalled y 0 autonomous-decision, Creator en vuelo ⇒ found=true y stalled-autonomous-resolve',
    async () => {
      const w = await scan({ issues: [{ number: 7, title: 'X', labels: lbl(['stalled']) }] });
      const a = anomalias(w);
      return w.outputs.found === 'true' && Array.isArray(a) && a.length === 1
        && a[0].type === 'stalled-autonomous-resolve' && a[0].number === 7;
    }],
  ['(b) sin stalled, Creator en vuelo ⇒ found=false, anomalies=[] (el gate sigue cerrando lo demás)',
    async () => {
      const w = await scan({ issues: [{ number: 8, title: 'Y', labels: lbl(['en-cola']) }] });
      const a = anomalias(w);
      return w.outputs.found === 'false' && Array.isArray(a) && a.length === 0;
    }],
  ['(c) stalled con 2 autonomous-decision ⇒ human-needed + watchdog-circuit-breaker, sin anomalía',
    async () => {
      const w = await scan({ issues: [{ number: 9, title: 'Z', labels: lbl(['stalled']) }], comments: { 9: [AUTO, AUTO] } });
      const a = anomalias(w);
      return w.outputs.found === 'false' && a.length === 0 && w.added.includes('9:human-needed')
        && w.comments.some(c => c.n === 9 && /<!-- watchdog-circuit-breaker -->/.test(c.body));
    }],
  ['(d) evento labeled=stalled con Creator en vuelo ⇒ anomalía (sin duplicar con la re-derivación)',
    async () => {
      const w = await scan({ issues: [{ number: 7, title: 'X', labels: lbl(['stalled']) }] },
        { eventName: 'issues', payload: { action: 'labeled', label: { name: 'stalled' }, issue: { number: 7 } } });
      const a = anomalias(w);
      return w.outputs.found === 'true' && a.length === 1 && a[0].number === 7;
    }],
  ['(e) stalled con label de SKIP (human-needed) ⇒ sin anomalía',
    async () => {
      const w = await scan({ issues: [{ number: 6, title: 'W', labels: lbl(['stalled', 'human-needed']) }] });
      return w.outputs.found === 'false' && anomalias(w).length === 0;
    }],
  // Review PR #380 🔴 1: issue absorbido (abierto, armado, SIN `en-cola`) y sin
  // runs en vuelo. Contra el detector previo sale `issue-armed-no-pr` ⇒ ROJO.
  ['(f) control: issue armado sin en-cola ni PR, sin runs en vuelo ⇒ issue-armed-no-pr (el banco llega al detector)',
    async () => armedNoPr(await scan({ issues: [ARMADO(20)], comments: { 20: [ARM] } }, { inFlight: false }), 20)],
  ['(f) issue con cola-absorbida vigente y absorbente #40 abierto ⇒ SIN anomalía + notice «absorbido por #40»',
    async () => {
      const w = await scan({ issues: [ARMADO(20)], comments: { 20: [ARM, MARCA(40)] }, otros: { 40: { number: 40, state: 'open', pull_request: {} } } }, { inFlight: false });
      return !armedNoPr(w, 20) && w.notices.some(m => /#20: espera legítima: absorbido por #40/.test(m));
    }],
  ['(f) absorbente #40 cerrado sin materializar ⇒ issue-armed-no-pr (no se congela)',
    async () => armedNoPr(await scan({ issues: [ARMADO(20)], comments: { 20: [ARM, MARCA(40)] }, otros: { 40: { number: 40, state: 'closed', pull_request: {} } } }, { inFlight: false }), 20)],
  ['(f) cola-absorbida seguida de cola-absorbida-cancelada ⇒ issue-armed-no-pr',
    async () => armedNoPr(await scan({ issues: [ARMADO(20)], comments: { 20: [ARM, MARCA(40), CANCELADA] }, otros: { 40: { number: 40, state: 'open' } } }, { inFlight: false }), 20)],
  ['(f) marcador citado entre backticks no cuenta ⇒ issue-armed-no-pr',
    async () => armedNoPr(await scan({ issues: [ARMADO(20)], comments: { 20: [ARM, { ...MARCA(40), body: 'ver `<!-- cola-absorbida: #40 -->`' }] }, otros: { 40: { number: 40, state: 'open' } } }, { inFlight: false }), 20)],
];

const rojos = [];
for (const [nombre, fn] of BANCO) {
  try { if (!(await fn())) rojos.push(nombre); } catch (e) { rojos.push(`${nombre}: excepción ${e.message}`); }
}
if (rojos.length) { console.error('CHECK-WATCHDOG-GATE0 ROJO:'); rojos.forEach(e => console.error('  - ' + e)); process.exit(1); }
console.log(`check-watchdog-gate0 verde: ${BANCO.length} casos de stalled antes del Gate 0, absorción vigente en el detector de issues (AP-122) y Gate 0 por ítem (AP-149).`);
