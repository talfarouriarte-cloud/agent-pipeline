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
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const wf = yaml.load(readFileSync('.github/workflows/watchdog.yml', 'utf8'));
let script = null;
for (const job of Object.values(wf.jobs || {})) {
  for (const st of job.steps || []) if (st.id === 'scan') script = st.with.script;
}
if (!script) { console.error('CHECK-WATCHDOG-GATE0 ROJO: step `scan` no encontrado en watchdog.yml'); process.exit(1); }
const run = cargarStep(script, 'scan');

const CREATOR_WF = 'Claude Code';
const ENV = {
  STATUS_TOKEN: 'x', ARM_PAT: 'x',
  IN_CREATOR_WF: CREATOR_WF, IN_REVIEWER_WF: 'Opus Reviewer', IN_CI_WF: 'CI', IN_EPIC_MERGE_WF: 'Epic merge',
  IN_EXTRA_WFS: '', IN_LOOKBACK_MIN: '45', IN_SKIP_LABELS: 'human-needed,pause-agents',
  IN_AUTOMERGE: 'true', IN_DEFAULT_BRANCH: 'main',
};
const lbl = names => names.map(name => ({ name }));
const AUTO = { body: 'x\n<!-- autonomous-decision -->' };

async function scan(world, { eventName = 'schedule', payload = {} } = {}) {
  const w = { added: [], comments: [], outputs: {}, warnings: [], notices: [] };
  const enVuelo = { id: 500, name: CREATOR_WF, status: 'in_progress', created_at: new Date(Date.now() - 60000).toISOString() };
  const github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      pulls: { list: async () => ({ data: world.prs || [] }) },
      issues: {
        listForRepo: async p => ({ data: p.labels === 'stalled'
          ? (world.issues || []).filter(i => i.labels.some(l => l.name === 'stalled'))
          : (world.issues || []) }),
        listComments: async p => ({ data: (world.comments || {})[p.issue_number] || [] }),
        addLabels: async p => { w.added.push(...p.labels.map(l => `${p.issue_number}:${l}`)); },
        createComment: async p => { w.comments.push({ n: p.issue_number, body: p.body }); },
      },
      actions: {
        listWorkflowRunsForRepo: async p => ({ data: { workflow_runs: p.status === 'in_progress' ? [enVuelo] : [] } }),
        listJobsForWorkflowRun: async () => ({ data: { total_count: 1, jobs: [] } }),
        reRunWorkflowFailedJobs: async () => ({}),
      },
    },
  };
  const context = { repo: { owner: 'o', repo: 'r' }, eventName, payload, runId: 1 };
  const core = { setOutput: (k, v) => { w.outputs[k] = String(v); }, notice: m => w.notices.push(String(m)),
    warning: m => w.warnings.push(String(m)), info() {} };
  await run({ github, context, core }, { env: ENV });
  return w;
}
const anomalias = w => JSON.parse(w.outputs.anomalies || 'null');

const BANCO = [
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
];

const rojos = [];
for (const [nombre, fn] of BANCO) {
  try { if (!(await fn())) rojos.push(nombre); } catch (e) { rojos.push(`${nombre}: excepción ${e.message}`); }
}
if (rojos.length) { console.error('CHECK-WATCHDOG-GATE0 ROJO:'); rojos.forEach(e => console.error('  - ' + e)); process.exit(1); }
console.log(`check-watchdog-gate0 verde: ${BANCO.length} casos de stalled antes del Gate 0 (AP-122).`);
