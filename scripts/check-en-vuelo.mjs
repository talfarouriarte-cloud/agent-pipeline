#!/usr/bin/env node
// check-en-vuelo — banco de AP-149 (central#443, ruling corregido 2026-11-10):
//  · módulo `vendored/scripts/en-vuelo.cjs` (Gate 0 por ítem del Watchdog),
//    casos (a)–(d), (j) y (l) del ruling;
//  · gate del Reviewer (`reviewer.yml`, step `gate`, script EMBEBIDO real),
//    casos (g)–(i): la convocatoria diferida por draft o por escalada se avisa.
// La integración en el scan (casos (e), (j), (k)) vive en `check-watchdog-gate0.mjs`
// y el (f) en `check-escalada-creator.mjs`. Cuelga del piggyback de
// `check-embedded-js.mjs` como sus hermanos.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);
const EV = require('../vendored/scripts/en-vuelo.cjs');
const fallos = [];
let n = 0;
const check = (ok, nombre) => { n++; if (ok) console.log(`  ok  ${nombre}`); else { fallos.push(nombre); console.log(`  ROJO ${nombre}`); } };

// ── Parte 1: módulo ─────────────────────────────────────────────────────────
const WF = { creator: 'Claude Code', reviewer: 'Opus Reviewer' };
const PRS = [
  { number: 50, title: 'Gate 0 por ítem', head: { ref: 'claude/issue-40-20261110-1200' } },
  { number: 51, title: 'Otro PR', head: { ref: 'claude/issue-41-20261110-1200' } },
  { number: 52, title: 'PR humano', head: { ref: 'feature/x' } },
];
const ISSUES = [{ number: 40, title: 'process-proposal · Gate 0' }, { number: 41, title: 'Otro issue' }, { number: 42, title: 'Suelto' }];
const set = r => [...r.items].sort((a, b) => a - b).join(',');
{
  const a = EV.itemsEnVuelo([{ id: 1, name: 'Claude Code', event: 'issue_comment', head_branch: 'main', display_title: 'process-proposal · Gate 0' }], { prs: PRS, issues: ISSUES, workflows: WF });
  check(!a.global && set(a) === '40,50' && a.creatorVivo, '(a) Creator `issue_comment` con display_title = título del issue 40 ⇒ {40, PR 50}; los demás PRs no');
  const b = EV.itemsEnVuelo([{ id: 2, name: 'CI', head_branch: 'feature/x', display_title: 'zzz', pull_requests: [{ number: 52 }] }], { prs: PRS, issues: ISSUES, workflows: WF });
  check(!b.global && set(b) === '52' && !b.creatorVivo, '(b) run de CI con pull_requests [52] ⇒ solo 52');
  const c = EV.itemsEnVuelo([{ id: 3, name: 'Epic Merge', event: 'workflow_run', head_branch: 'main', display_title: 'Epic Merge' }], { prs: PRS, issues: ISSUES, workflows: WF });
  check(!c.global && c.items.size === 0, '(c) `Epic Merge` por workflow_run con título «Epic Merge» ⇒ conjunto vacío, sin gate global');
  const l = EV.itemsEnVuelo([{ id: 4, name: 'Opus Reviewer', head_branch: 'main', display_title: '???' }], { prs: PRS, issues: ISSUES, workflows: WF });
  check(l.global && /sin ítem identificable/.test(l.motivo), '(l) run del Reviewer sin ítem identificable ⇒ global: true');
  const cr = EV.itemsEnVuelo([{ id: 5, name: 'Claude Code', head_branch: 'main', display_title: '???' }], { prs: PRS, issues: ISSUES, workflows: WF });
  check(cr.global && cr.creatorVivo, '(l′) run del Creator sin ítem identificable ⇒ global: true (el banco gate0 conserva su semántica)');
  const r = EV.itemsEnVuelo([{ id: 6, name: 'Claude Code', head_branch: 'claude/issue-41-20261110-1200' }], { prs: PRS, issues: ISSUES, workflows: WF });
  check(set(r) === '41,51', '(a′) rama `claude/issue-41-*` ⇒ issue 41 y su PR 51 juntos');
  const t = EV.itemsEnVuelo([{ id: 7, name: 'Opus Reviewer', display_title: 'Otro PR' }], { prs: PRS, issues: ISSUES, workflows: WF });
  check(set(t) === '41,51', '(a″) display_title = título del PR 51 ⇒ PR 51 y su issue 41');
}
// Lector con dobles.
const mundo = ({ runs = {}, lanzaRuns = false, lanzaIssues = false, issues = ISSUES, get = {}, jobs = 1 } = {}) => ({
  rest: {
    actions: {
      listWorkflowRunsForRepo: async p => { if (lanzaRuns) throw new Error('502'); return { data: { workflow_runs: typeof runs[p.status] === 'function' ? runs[p.status](p) : (runs[p.status] || []) } }; },
      listJobsForWorkflowRun: async () => ({ data: { total_count: jobs } }),
    },
    issues: {
      listForRepo: async () => { if (lanzaIssues) throw new Error('500'); return { data: issues }; },
      get: async p => { const x = get[p.issue_number]; if (!x) { const e = new Error('Not Found'); e.status = 404; throw e; } if (x instanceof Error) throw x; return { data: x }; },
    },
  },
  paginate: async (fn, p) => (await fn(p)).data,
});
const AHORA = new Date().toISOString();
const HACE = min => new Date(Date.now() - min * 60000).toISOString();
const PIPE = ['Claude Code', 'Opus Reviewer', 'CI', 'Epic Merge'];
const lee = (m, extra = {}) => EV.enVueloDelRepo({ github: mundo(m), O: {}, pipeline: PIPE, workflows: WF, prs: PRS, warn: () => {}, ...extra });
{
  const warns = [];
  const d = await lee({ lanzaRuns: true }, { warn: m => warns.push(m) });
  check(d.global && warns.some(m => /fail-closed/.test(m)), '(d) lectura de runs que lanza ⇒ gate global (statu quo), con aviso');
  const di = await lee({ lanzaIssues: true, runs: { in_progress: [{ id: 9, name: 'CI', created_at: AHORA, pull_requests: [{ number: 52 }] }] } });
  check(di.global, '(d′) lectura de issues que lanza ⇒ gate global');
  const v = await lee({});
  check(!v.global && v.items.size === 0 && !v.creatorVivo, '(d″) sin runs vivos ⇒ conjunto vacío, sin Creator vivo');
  const f = await lee({ runs: { in_progress: [{ id: 10, name: 'Claude Code', created_at: HACE(7 * 60) }, { id: 11, name: 'Otro', created_at: AHORA }] } });
  check(!f.global && f.items.size === 0, '(d‴) filtros de siempre: run > MAX_RUN_AGE_H y workflow fuera de PIPELINE no cuentan');
  const q = await lee({ jobs: 0, runs: { queued: [{ id: 14, name: 'Claude Code', created_at: HACE(30) }] } });
  check(!q.global && !q.creatorVivo, '(d⁗) cascarón `queued` sin jobs pasada la gracia ⇒ no cuenta (AP-081)');
  const lleno = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, name: 'CI', created_at: AHORA, pull_requests: [{ number: 52 }] }));
  const pl = await lee({ runs: { in_progress: lleno } });
  check(pl.global && /truncada/.test(pl.motivo), '(d⁵) páginas de runs llenas hasta el tope ⇒ gate global (no se trunca el conjunto)');
  const j = await lee({ issues: [], get: { 40: { title: 'process-proposal · Gate 0' } },
    runs: { in_progress: [{ id: 12, name: 'Claude Code', created_at: AHORA, head_branch: 'main', display_title: 'process-proposal · Gate 0' }] } });
  check(!j.global && set(j) === '40,50', '(j) issue 40 fuera del listado ⇒ `issues.get(40)` lo identifica y su PR 50 queda en vuelo');
  const e = new Error('500'); e.status = 500;
  const jf = await lee({ issues: [], get: { 40: e, 41: { title: 'nada' } }, runs: { in_progress: [{ id: 13, name: 'CI', created_at: AHORA, pull_requests: [{ number: 52 }] }] } });
  check(!jf.global && set(jf) === '40,50,52', '(j′) `issues.get` con 5xx ⇒ ese PR y su issue en vuelo (fail-closed por ítem)');
}

// ── Parte 2: gate del Reviewer (script embebido real) ───────────────────────
const rv = yaml.load(readFileSync('.github/workflows/reviewer.yml', 'utf8'));
const gate = (rv.jobs.review.steps || []).find(s => s.id === 'gate');
const runGate = cargarStep(gate.with.script, 'gate');
async function gatear({ action = 'labeled', label = 'needs-review', draft = true, labels = [], sha = 'aaa111', comments = [] }) {
  const w = { outputs: {}, removed: [], comments: [...comments], creados: [] };
  const github = {
    rest: { issues: {
      removeLabel: async p => { w.removed.push(p.name); },
      listComments: async () => ({ data: w.comments }),
      createComment: async p => { w.comments.push({ body: p.body }); w.creados.push(p.body); },
    } },
    paginate: async (fn, p) => (await fn(p)).data,
  };
  const prLabels = [...labels, ...(action === 'labeled' ? [label] : [])].map(name => ({ name }));
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { action, label: action === 'labeled' ? { name: label } : undefined, sender: { login: 'talfarouriarte-cloud' },
    pull_request: { number: 60, draft, labels: prLabels, user: { login: 'claude[bot]', type: 'Bot' }, head: { ref: 'claude/issue-61-x', sha, repo: { full_name: 'o/r' } } } } };
  const core = { notice() {}, info() {}, warning() {}, setOutput: (k, v) => { w.outputs[k] = v; } };
  await runGate({ github, context, core }, { env: { AGENT_BRANCH_PREFIX: 'claude/' } });
  return w;
}
{
  const g = await gatear({});
  check(g.outputs.run === 'false' && g.removed.includes('needs-review') && g.creados.length === 1 && /<!-- review-diferida: draft · aaa111 -->/.test(g.creados[0]),
    '(g) `labeled: needs-review` sobre draft ⇒ run=false, label retirada, un comentario `review-diferida: draft`');
  const g2 = await gatear({ comments: g.comments });
  check(g2.outputs.run === 'false' && g2.removed.includes('needs-review') && g2.creados.length === 0, '(g) segundo evento sobre el mismo head ⇒ retira la label, no comenta otra vez');
  const g3 = await gatear({ comments: g.comments, sha: 'bbb222' });
  check(g3.creados.length === 1, '(g) head nuevo ⇒ un aviso nuevo');
  const h = await gatear({ draft: false, labels: ['estado:esperando-architect'] });
  check(h.outputs.run === 'false' && h.removed.includes('needs-review') && h.creados.length === 1 && /<!-- review-diferida: escalada · aaa111 -->/.test(h.creados[0]),
    '(h) `estado:esperando-architect` + `labeled: needs-review` ⇒ run=false, label retirada, comentario `review-diferida: escalada`');
  const h2 = await gatear({ action: 'ready_for_review', draft: false, labels: ['estado:esperando-architect'] });
  check(h2.outputs.run === 'false' && h2.removed.length === 0 && h2.creados.length === 0, '(h) escalada viva + `ready_for_review` ⇒ run=false, en silencio');
  const i = await gatear({ action: 'opened' });
  check(i.outputs.run === 'false' && i.removed.length === 0 && i.creados.length === 0, '(i) `opened` de un draft ⇒ sin comentario ni retirada (primer hito AP-047)');
  const ok = await gatear({ draft: false });
  check(ok.outputs.run === 'true' && ok.removed.length === 0 && ok.creados.length === 0, '(control) `labeled: needs-review` sobre PR ready sin escalada ⇒ run=true, sin aviso');
  const s = gate.with.script;
  check(s.indexOf("labels.includes('pause-agents')") < s.indexOf("labels.includes('estado:esperando-architect')") && s.indexOf("labels.includes('estado:esperando-architect')") < s.indexOf('} else if (pr.draft)'),
    'costura: orden fork → pause-agents → escalada → draft');
}

if (fallos.length) { console.error(`CHECK-EN-VUELO ROJO: ${fallos.length} de ${n}`); process.exit(1); }
console.log(`check-en-vuelo verde: ${n} casos (módulo del Gate 0 por ítem y gate del Reviewer, AP-149).`);
