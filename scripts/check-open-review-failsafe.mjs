#!/usr/bin/env node
// check-open-review-failsafe — banco del post-step «Materializar review en la
// apertura del PR (open-review-failsafe)» de claude-code.yml (central#318, ruling
// mensual 2026-10-05; asesoramiento#2707).
//
// El dedupe preguntaba «¿hay run del Reviewer para el head SHA de AHORA?»; cuando
// una ronda completa ya había avanzado el head, la respuesta era «no» y el belt
// doblaba la review (y con ella un segundo Creator). Criterio falsable del ruling:
//  (b) run del Reviewer del head ANTERIOR nacido tras el ready + head avanzado ⇒
//      no dispara;
//  (c) Creator en vuelo para la rama ⇒ no dispara;
//  (d) sin run alguno ⇒ dispara (caso finplan#1382 intacto).
// Bordes: `ready_at` ilegible ⇒ statu quo (head SHA); run del Reviewer ANTERIOR al
// ready ⇒ no cuenta; run en `failure` ⇒ no cuenta (AP-025); Creator con el job
// `skipped` o fantasma >6 h ⇒ no cede; PR nacido no-draft ⇒ ventana desde su creación;
// >50 runs ajenos más nuevos que el del Reviewer ⇒ pagina; tope agotado ⇒ no decide.
// Ejecuta el script EMBEBIDO real con el cargador compartido (EXACTAMENTE los
// argumentos de github-script@v7). Cuelga del piggyback de check-embedded-js.
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const NAME = 'Materializar review en la apertura del PR (open-review-failsafe)';
const wf = yaml.load(readFileSync('.github/workflows/claude-code.yml', 'utf8'));
let step = null;
for (const job of Object.values(wf.jobs || {})) for (const st of job.steps || []) if (st.name === NAME) step = st;
if (!step) { console.error(`CHECK-OPEN-REVIEW-FAILSAFE ROJO: step «${NAME}» no encontrado en claude-code.yml`); process.exit(1); }
const run = cargarStep(step.with.script, 'open-review-failsafe');

const WF = 'Claude Code';
const REV = 'Opus Reviewer';
const BRANCH = 'claude/issue-40-20261005-0700';
const READY = '2026-10-05T10:16:18Z';
const PR = { number: 50, title: 'feat: algo (#40)', draft: false, created_at: '2026-10-05T09:40:00Z', head: { ref: BRANCH, sha: '331439a8aaaa' } };
const rev = (id, extra = {}) => ({ id, name: REV, head_branch: BRANCH, head_sha: '8d5c4f4dbbbb', status: 'completed', conclusion: 'success', created_at: '2026-10-05T10:16:21Z', ...extra });
const cre = (id, extra = {}) => ({ id, name: WF, event: 'issue_comment', head_branch: 'main', display_title: PR.title, status: 'in_progress', created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), ...extra });

async function caso(world) {
  const w = { labels: [], comments: [], notices: [], warnings: [], fetches: [] };
  const github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      pulls: { list: async () => ({ data: [world.pr || PR] }) },
      issues: {
        listEventsForTimeline: async () => {
          if (world.timelineDown) throw new Error('API caída (timeline)');
          return { data: world.timeline ?? [{ event: 'convert_to_draft', created_at: '2026-10-05T09:41:00Z' }, { event: 'ready_for_review', created_at: READY }] };
        },
        createComment: async p => { w.comments.push(p.body); },
      },
    },
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    w.fetches.push(`${method} ${u.pathname}${u.search}`);
    const json = data => ({ ok: true, status: 200, json: async () => data });
    if (init.headers?.Authorization !== 'Bearer pat') throw new Error('lectura/escritura sin el PAT');
    let m;
    if ((m = u.pathname.match(/\/issues\/(\d+)\/labels(?:\/(.+))?$/))) {
      if (method === 'POST') w.labels.push(...JSON.parse(init.body).labels);
      return { ok: true, status: 200 };
    }
    if ((m = u.pathname.match(/\/actions\/runs\/(\d+)\/jobs$/))) {
      const skipped = (world.skipped || []).includes(Number(m[1]));
      return json({ jobs: [{ name: 'call / claude', status: skipped ? 'completed' : 'in_progress', conclusion: skipped ? 'skipped' : null }] });
    }
    if (u.pathname.endsWith('/actions/runs')) {
      const q = u.searchParams;
      if (q.get('status')) {
        if (world.creatorDown) return { ok: false, status: 502 };
        return json({ workflow_runs: (world.creators || []).filter(r => r.status === q.get('status')) });
      }
      let runs = world.reviewers || [];
      if (q.get('head_sha')) runs = runs.filter(r => r.head_sha === q.get('head_sha'));
      if (q.get('branch')) runs = runs.filter(r => r.head_branch === q.get('branch'));
      const c = q.get('created');
      if (c) { if (!c.startsWith('>=')) throw new Error(`filtro created inesperado: ${c}`); runs = runs.filter(r => r.created_at >= c.slice(2)); }
      runs = [...runs].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
      const per = Number(q.get('per_page') || 30), page = Number(q.get('page') || 1);
      return json({ total_count: runs.length, workflow_runs: runs.slice((page - 1) * per, page * per) });
    }
    throw new Error(`fetch inesperado: ${method} ${url}`);
  };
  const context = { repo: { owner: 'o', repo: 'r' }, runId: 37292273081, workflow: WF, eventName: 'issue_comment',
    payload: { issue: { number: 40, title: 'Issue cuarenta' } } };
  const core = { setOutput() {}, info() {}, notice: m => w.notices.push(String(m)), warning: m => w.warnings.push(String(m)) };
  try {
    await run({ github, context, core }, {
      env: { ARM_PAT: 'pat', IN_REVIEWER_WF: REV, GITHUB_API_URL: 'https://api.github.com' },
      globales: { fetch, setTimeout: fn => { fn(); return 0; } },
    });
  } catch (e) { w.threw = e; }
  w.fired = w.labels.includes('needs-review');
  return w;
}

let fails = 0;
const check = (ok, msg, w) => {
  console.log(`${ok ? '  ok ' : '  ROJO'} ${msg}`);
  if (!ok) { fails++; if (w) console.log('       ', JSON.stringify({ labels: w.labels, notices: w.notices, warnings: w.warnings, threw: w.threw?.message, fetches: w.fetches })); }
};

// (b) asesoramiento#2707: Reviewer del head anterior (8d5c4f4d) nacido tras el ready, head avanzado a 331439a8.
{
  const w = await caso({ reviewers: [rev(37295512768)] });
  check(!w.fired && !w.threw && w.comments.length === 0, '(b) run del Reviewer del head ANTERIOR nacido tras el ready + head avanzado ⇒ no dispara', w);
  check(w.fetches.some(f => /branch=claude%2Fissue-40|branch=claude\/issue-40/.test(f) && /created=%3E%3D2026-10-05T10%3A16%3A18Z|created=>=2026-10-05T10:16:18Z/.test(f)), '(b) la consulta es por ventana (branch + created>=ready_at del último ready_for_review)', w);
}
// (c) Creator en vuelo para el PR ⇒ cede (por título de PR en issue_comment y por head_branch en pull_request_review).
{
  const w = await caso({ creators: [cre(37296746394)] });
  check(!w.fired && !w.threw, '(c) Creator en vuelo (issue_comment sobre el PR) ⇒ no dispara', w);
  const w2 = await caso({ creators: [cre(37296746394, { event: 'pull_request_review', display_title: 'otro', head_branch: BRANCH, status: 'queued' })] });
  check(!w2.fired && !w2.threw, '(c) Creator en cola (pull_request_review, misma rama) ⇒ no dispara', w2);
  const w3 = await caso({ creators: [cre(37296746394)], skipped: [37296746394] });
  check(w3.fired, '(c) run del Creator con el job skipped (comentario sin trigger) ⇒ no cuenta, dispara', w3);
  const w4 = await caso({ creators: [cre(37296746394, { display_title: 'otro PR' }), cre(37292273081)] });
  check(w4.fired, '(c) runs de otro PR o el propio run ⇒ no cuentan, dispara', w4);
  const fantasma = await caso({ creators: [cre(37000000001, { status: 'queued', created_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString() })] });
  check(fantasma.fired, '(c) run fantasma en queued de hace >6 h ⇒ no cuenta (filtro de edad del guard), dispara', fantasma);
  const w5 = await caso({ creatorDown: true });
  check(w5.fired && w5.warnings.some(m => /sin cinturón/.test(m)), '(c) runs del Creator ilegibles ⇒ sin cinturón (statu quo), dispara', w5);
}
// (d) sin run alguno ⇒ dispara (finplan#1382).
{
  const w = await caso({});
  check(w.fired && !w.threw && w.comments.some(c => /<!-- open-review-failsafe -->/.test(c)), '(d) sin run del Reviewer ni Creator ⇒ needs-review + comentario (finplan#1382 intacto)', w);
}
// Bordes.
{
  const antes = await caso({ reviewers: [rev(1, { created_at: '2026-10-05T09:50:00Z' })] });
  check(antes.fired, 'run del Reviewer ANTERIOR al ready ⇒ no cuenta, dispara', antes);
  const fallido = await caso({ reviewers: [rev(1, { conclusion: 'failure' })] });
  check(fallido.fired, 'run del Reviewer en failure tras el ready ⇒ no cuenta (AP-025), dispara', fallido);
  const noDraft = await caso({ timeline: [], reviewers: [rev(1, { created_at: '2026-10-05T09:40:03Z' })] });
  check(!noDraft.fired && noDraft.fetches.some(f => /created=(%3E%3D|>=)2026-10-05T09(%3A|:)40(%3A|:)00Z/.test(f)), 'PR nacido no-draft (sin ready_for_review) ⇒ ventana desde su creación', noDraft);
  const ciegoViejo = await caso({ timelineDown: true, reviewers: [rev(1)] });
  check(ciegoViejo.fired && ciegoViejo.fetches.some(f => /head_sha=331439a8aaaa/.test(f)) && ciegoViejo.warnings.some(m => /statu quo/.test(m)), 'ready_at ilegible ⇒ dedupe por head SHA actual (statu quo), con aviso', ciegoViejo);
  const ciegoActual = await caso({ timelineDown: true, reviewers: [rev(1, { head_sha: PR.head.sha })] });
  check(!ciegoActual.fired, 'ready_at ilegible + run para el head actual ⇒ no dispara (statu quo)', ciegoActual);
  // Volumen (nit del Reviewer de PR #324): >50 runs ajenos más nuevos que el del
  // Reviewer en la rama ⇒ el del Reviewer cae fuera de la primera página.
  const ajenos = n => Array.from({ length: n }, (_, i) => rev(90000 + i, { name: 'CI', conclusion: 'skipped', created_at: `2026-10-05T11:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }));
  const volumen = await caso({ reviewers: [rev(1), ...ajenos(150)] });
  check(!volumen.fired && !volumen.threw && volumen.fetches.some(f => /page=2/.test(f)), '>50 (150) runs ajenos más nuevos que el del Reviewer ⇒ pagina y no dispara', volumen);
  const volumenSin = await caso({ reviewers: ajenos(150) });
  check(volumenSin.fired, '150 runs ajenos sin Reviewer ⇒ agota la ventana (página corta) y dispara', volumenSin);
  const tope = await caso({ reviewers: ajenos(1000) });
  check(!tope.fired && tope.warnings.some(m => /no se decide/.test(m)), 'tope de páginas agotado sin match ⇒ lectura no fiable, no dispara', tope);
  const draft = await caso({ pr: { ...PR, draft: true } });
  check(!draft.fired && draft.fetches.length === 0, 'PR en draft ⇒ no toca nada (AP-047)', draft);
}

if (fails) { console.error(`CHECK-OPEN-REVIEW-FAILSAFE ROJO: ${fails} caso(s) fallan.`); process.exit(1); }
console.log('check-open-review-failsafe verde.');
