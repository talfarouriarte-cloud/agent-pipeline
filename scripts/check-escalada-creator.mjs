#!/usr/bin/env node
// check-escalada-creator — banco de `vendored/scripts/escalada-creator.cjs`
// (AP-136, central#392, ruling mensual 2026-11-01, posición 14): la escalada del
// Creator (`[CREATOR-ESCALATED]`) se materializa por ESTADO del PR de la rama, sea
// cual sea el evento que armó la sesión, y quien convoca al Reviewer cede ante ella.
//
// Parte 1 — el módulo REAL (no una copia), casos del ruling (punto 5):
//  (a) `resolverPr` con `issue_comment` sin `pull_request` + PR en la rama con
//      sufijo ⇒ ese PR; (a′) dos PRs con el prefijo ⇒ el más reciente; (a″)
//      `claude/issue-400-…` con issueN=40 ⇒ no casa; (b) `issue_comment` sobre PR ⇒
//      `issue.number`; (c) sin rama, `Refs #N` en el body ⇒ ese PR; (d) nada ⇒ null;
//  (e) `escaladaFresca`: token anterior a la ventana ⇒ false, dentro ⇒ true, entre
//      backticks ⇒ false (token y belt HTML); el literal del token es EL MISMO que
//      el de `creator-turn-close-failsafe.cjs`;
//  (f) `cedeAnteEscalada`; (g) `mergeBloqueadoPorEscalada`.
// Parte 2 — integración: los scripts EMBEBIDOS reales de `claude-code.yml` con el
// cargador compartido y `GITHUB_WORKSPACE` apuntando a un directorio temporal con
// el módulo: step creator-escalated (sesión del issue ⇒ `stalled` +
// `estado:esperando-architect`, PR sigue draft, sin `needs-review`; dedupe; sesión
// desde PR intacta; PR ready ⇒ vuelve a draft) y materializador de `ready` (draft +
// escalada ⇒ ni ready ni needs-review; sin escalada ⇒ como hoy). La integración de
// `open-review-failsafe` vive en su propio banco (`check-open-review-failsafe.mjs`).
// Parte 3 — costura (regex sobre los YAML).
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);
const FUENTES = ['vendored/scripts/escalada-creator.cjs', 'scripts/escalada-creator.cjs'];
const fuente = FUENTES.find(f => existsSync(f));
if (!fuente) {
  console.log('::warning::check-escalada-creator — no encuentro `escalada-creator.cjs`: el banco NO se ha ejecutado.');
  process.exit(0);
}
const ESC = require(resolve(fuente));

let fails = 0;
const check = (ok, msg, extra) => {
  console.log(`${ok ? '  ok ' : '  ROJO'} ${msg}`);
  if (!ok) { fails++; if (extra !== undefined) console.log('       ', JSON.stringify(extra)); }
};

// ── Parte 1: el módulo ──────────────────────────────────────────────────────
const RAMA = 'claude/issue-40-20261005-0700';
const prA = { number: 50, created_at: '2026-10-05T09:40:00Z', head: { ref: RAMA }, body: 'Refs #40' };
{
  const pIssue = { issue: { number: 40 } };
  check(ESC.resolverPr({ payload: pIssue, prsAbiertos: [prA], issueN: 40 }) === 50, '(a) issue_comment sin pull_request + PR en `claude/issue-40-20261005-0700` ⇒ ese PR');
  const prB = { number: 51, created_at: '2026-10-06T09:40:00Z', head: { ref: 'claude/issue-40-20261006-0700' }, body: '' };
  check(ESC.resolverPr({ payload: pIssue, prsAbiertos: [prA, prB], issueN: 40 }) === 51, '(a′) dos PRs abiertos con el prefijo ⇒ el más reciente');
  const prC = { number: 52, created_at: '2026-10-05T09:40:00Z', head: { ref: 'claude/issue-400-20261005-0700' }, body: '' };
  check(ESC.resolverPr({ payload: pIssue, prsAbiertos: [prC], issueN: 40 }) === null, '(a″) `claude/issue-400-…` con issueN=40 ⇒ no casa');
  check(ESC.resolverPr({ payload: { issue: { number: 77, pull_request: {} } }, prsAbiertos: [prA], issueN: null }) === 77, '(b) issue_comment sobre PR ⇒ issue.number (comportamiento actual)');
  check(ESC.resolverPr({ payload: { pull_request: { number: 78 } }, prsAbiertos: [], issueN: null }) === 78, '(b) evento de PR ⇒ pull_request.number');
  const prD = { number: 53, created_at: '2026-10-05T09:40:00Z', head: { ref: 'feat/x' }, body: 'Algo.\n\nRefs #40\n' };
  const prE = { number: 54, created_at: '2026-10-05T09:40:00Z', head: { ref: 'feat/y' }, body: 'Refs #400' };
  check(ESC.resolverPr({ payload: pIssue, prsAbiertos: [prE, prD], issueN: 40 }) === 53, '(c) sin rama y con `Refs #40` en el body ⇒ ese PR (`Refs #400` no casa)');
  check(ESC.resolverPr({ payload: pIssue, prsAbiertos: [{ ...prD, body: 'Closes #40' }], issueN: 40 }) === 53, '(c) `Closes #40` también casa');
  check(ESC.resolverPr({ payload: pIssue, prsAbiertos: [prE], issueN: 40 }) === null, '(d) nada ⇒ null');
  check(ESC.resolverPr({ payload: {}, prsAbiertos: [prA], issueN: null }) === null, '(d) sin issue ni PR en el payload ⇒ null');
}
{
  const bot = (t, body) => ({ user: { login: 'claude[bot]' }, created_at: t, body });
  const DESDE = '2026-10-05T10:00:00Z';
  check(!ESC.escaladaFresca([bot('2026-10-05T09:59:59Z', '[CREATOR-ESCALATED] E5.6.1')], DESDE), '(e) token anterior a la ventana ⇒ false');
  check(ESC.escaladaFresca([bot('2026-10-05T10:05:00Z', '[CREATOR-ESCALATED] E5.6.1\n\nResumen…')], DESDE), '(e) token dentro de la ventana ⇒ true');
  check(ESC.escaladaFresca([bot('2026-10-05T10:05:00Z', 'Escalo.\n\n<!-- creator-escalated -->')], DESDE), '(e) belt HTML dentro de la ventana ⇒ true');
  check(!ESC.escaladaFresca([bot('2026-10-05T10:05:00Z', 'No emito `[CREATOR-ESCALATED]` aquí.')], DESDE), '(e) token entre backticks ⇒ false');
  check(!ESC.escaladaFresca([bot('2026-10-05T10:05:00Z', 'El belt es `<!-- creator-escalated -->`, no lo emito.')], DESDE), '(e) belt HTML entre backticks ⇒ false');
  check(!ESC.escaladaFresca([bot('2026-10-05T10:05:00Z', 'Ver:\n```\n<!-- creator-escalated -->\n```')], DESDE), '(e) belt HTML en bloque de código ⇒ false');
  check(!ESC.escaladaFresca([{ user: { login: 'owner' }, created_at: '2026-10-05T10:05:00Z', body: '[CREATOR-ESCALATED] cita' }], DESDE), '(e) comentario que no es de claude[bot] ⇒ false');
  check(!ESC.escaladaFresca([bot('2026-10-05T10:05:00Z', 'ya\n\n<!-- creator-escalated-materializado -->')], DESDE), '(e) el marcador `-materializado` no es una escalada');
  check(ESC.escaladaFresca([bot('2026-10-05T09:00:00Z', '[CREATOR-ESCALATED] x')], null), '(e) desdeISO nulo ⇒ todos los comentarios del bot');
  const TC = require(resolve(existsSync('vendored/scripts/creator-turn-close-failsafe.cjs') ? 'vendored/scripts/creator-turn-close-failsafe.cjs' : 'scripts/creator-turn-close-failsafe.cjs'));
  const sources = (TC.PATRONES?.TERMINALES || []).map(r => `${r.source}/${r.flags}`);
  check(sources.includes(`${ESC.PATRONES.TOKEN_ESCALADA.source}/${ESC.PATRONES.TOKEN_ESCALADA.flags}`)
    && ESC.PATRONES.TOKEN_ESCALADA.source === '^\\[CREATOR-ESCALATED\\]',
    '(e) el literal del token es EL MISMO que el de creator-turn-close-failsafe.cjs (`/^\\[CREATOR-ESCALATED\\]/m`)', sources);
  check(sources.includes(`${ESC.PATRONES.BELT_ESCALADA.source}/${ESC.PATRONES.BELT_ESCALADA.flags}`), '(e) el belt HTML es el mismo patrón que el de creator-turn-close-failsafe.cjs');
}
{
  check(ESC.cedeAnteEscalada({ labelsPr: [], fresca: true }) === true, '(f) escalada fresca ⇒ cede');
  check(ESC.cedeAnteEscalada({ labelsPr: ['estado:esperando-architect'], fresca: false }) === true, '(f) sin fresca y `estado:esperando-architect` ⇒ cede');
  check(ESC.cedeAnteEscalada({ labelsPr: ['stalled'], fresca: false }) === true, '(f) sin fresca y `stalled` ⇒ cede');
  check(ESC.cedeAnteEscalada({ labelsPr: ['epica', 'ci-verde'], fresca: false }) === false, '(f) sin nada ⇒ no cede');
  check(ESC.mergeBloqueadoPorEscalada(['lgtm', 'ci-verde', 'estado:esperando-architect']) === true, '(g) con `estado:esperando-architect` ⇒ merge bloqueado');
  check(ESC.mergeBloqueadoPorEscalada(['lgtm', 'ci-verde', 'stalled']) === false, '(g) sin la label ⇒ no bloquea');
  check(ESC.mergeBloqueadoPorEscalada(undefined) === false, '(g) labels ausentes ⇒ no bloquea');
}

// ── Parte 2: integración con los scripts embebidos reales ───────────────────
const wf = yaml.load(readFileSync('.github/workflows/claude-code.yml', 'utf8'));
const steps = Object.values(wf.jobs || {}).flatMap(j => j.steps || []);
const NAME_ESC = 'Materializar escalada del Creator con PR abierto (creator-escalated)';
const stepEsc = steps.find(s => s.name === NAME_ESC);
const stepMuerte = steps.find(s => s.id === 'post_muerte_sin_pr');
if (!stepEsc || !stepMuerte) { console.error('CHECK-ESCALADA-CREATOR ROJO: steps creator-escalated / post_muerte_sin_pr no encontrados'); process.exit(1); }
const runEsc = cargarStep(stepEsc.with.script, 'creator-escalated');
const runMuerte = cargarStep(stepMuerte.with.script, 'post_muerte_sin_pr');

const ws = mkdtempSync(join(tmpdir(), 'escalada-ws-'));
mkdirSync(join(ws, 'scripts'));
copyFileSync(fuente, join(ws, 'scripts', 'escalada-creator.cjs'));
const wsVacio = mkdtempSync(join(tmpdir(), 'escalada-ws-vacio-'));

const TRIG = '2026-10-05T10:00:00Z';
const ESCALADA = { user: { login: 'claude[bot]' }, created_at: '2026-10-05T10:30:00Z', body: '[CREATOR-ESCALATED] E5.6.1 fuera de ±10 %' };
const prBase = { number: 50, draft: true, node_id: 'PR_N', created_at: '2026-10-05T10:10:00Z', head: { ref: RAMA, sha: 'abc' }, labels: [], body: 'Refs #40\n<!-- partial-pr -->' };

function mundo({ pr = prBase, comentarios = {}, lecturaCaida = false } = {}) {
  const w = { added: [], removed: [], comments: [], graphql: [], fetches: [], notices: [], warnings: [] };
  const lista = num => comentarios[num] || [];
  const github = {
    // `paginate` devuelve la lista completa; la llamada directa, solo la 1.ª página (100).
    paginate: async (fn, p) => (await fn({ ...p, __todo: true })).data,
    graphql: async (q, v) => { w.graphql.push(q.match(/(\w+)\(input/)?.[1] || q); return {}; },
    rest: {
      pulls: {
        list: async () => ({ data: pr ? [pr] : [] }),
        get: async () => ({ data: pr }),
        update: async () => ({}),
        create: async () => { throw new Error('no debe abrir PR'); },
      },
      git: { listMatchingRefs: async () => ({ data: [{ ref: `refs/heads/${RAMA}` }] }) },
      repos: { compareCommits: async () => ({ data: { ahead_by: 1, behind_by: 0, commits: [] } }) },
      issues: {
        get: async () => ({ data: { labels: [] } }),
        listForRepo: async () => ({ data: [] }),
        listComments: async p => {
          if (lecturaCaida) throw new Error('HTTP 502');
          return { data: p.__todo ? lista(p.issue_number) : lista(p.issue_number).slice(0, 100) };
        },
        addLabels: async p => { w.added.push(...p.labels.map(l => `${p.issue_number}:${l}`)); },
        removeLabel: async p => { w.removed.push(`${p.issue_number}:${p.name}`); },
        createComment: async p => { w.comments.push(`${p.issue_number}:${p.body}`); },
      },
    },
  };
  const core = { setOutput() {}, info() {}, notice: m => w.notices.push(String(m)), warning: m => w.warnings.push(String(m)) };
  const fetch = async (url, init = {}) => { w.fetches.push(`${init.method || 'GET'} ${url}`); return { ok: true, status: 200, json: async () => ({}) }; };
  return { w, github, core, fetch };
}

async function escalated({ payload, workspace = ws, ...m }) {
  const { w, github, core, fetch } = mundo(m);
  const context = { repo: { owner: 'o', repo: 'r' }, payload };
  try { await runEsc({ github, context, core }, { env: { GITHUB_WORKSPACE: workspace }, globales: { fetch } }); }
  catch (e) { w.threw = e.message; }
  return w;
}
const payIssue = { issue: { number: 40 }, comment: { created_at: TRIG } };
{
  // (a, 1.er ruling) sesión del issue + escalada en su draft ⇒ stalled + estado, sigue draft, sin needs-review.
  const w = await escalated({ payload: payIssue, comentarios: { 50: [ESCALADA] } });
  check(!w.threw && w.added.join() === '50:estado:esperando-architect,50:stalled' && w.comments.some(c => /<!-- creator-escalated-materializado -->/.test(c))
    && w.graphql.length === 0 && !w.added.some(l => /needs-review/.test(l)),
    '(int) sesión de issue_comment sin pull_request + escalada en el draft ⇒ stalled + estado:esperando-architect, sigue draft, sin needs-review', w);
  // Escalada publicada en el ISSUE disparador.
  const wi = await escalated({ payload: payIssue, comentarios: { 40: [ESCALADA] } });
  check(wi.added.join() === '50:estado:esperando-architect,50:stalled', '(int) escalada en el ISSUE disparador ⇒ se materializa en el PR de la rama', wi);
  // (b, 1.er ruling) dedupe.
  const wd = await escalated({ payload: payIssue, comentarios: { 50: [ESCALADA, { user: { login: 'pat' }, created_at: '2026-10-05T10:31:00Z', body: 'x\n\n<!-- creator-escalated-materializado -->' }] } });
  check(wd.added.length === 0 && wd.comments.length === 0, '(int) marcador `creator-escalated-materializado` ya presente ⇒ no duplica', wd);
  // (c, 1.er ruling) sesión desde PR ⇒ comportamiento idéntico al actual.
  const wp = await escalated({ payload: { issue: { number: 50, pull_request: {} }, comment: { created_at: TRIG } }, comentarios: { 50: [ESCALADA] } });
  check(wp.added.join() === '50:estado:esperando-architect,50:stalled', '(int) sesión desde el PR (issue_comment con pull_request) ⇒ materializa como hoy', wp);
  const wpv = await escalated({ payload: { issue: { number: 50, pull_request: {} } , comment: { created_at: TRIG } }, workspace: wsVacio, comentarios: { 50: [ESCALADA] } });
  check(wpv.added.join() === '50:estado:esperando-architect,50:stalled' && wpv.warnings.some(m => /no injertado/.test(m)), '(int) sesión desde el PR sin módulo ⇒ fail-open al comportamiento actual, con aviso', wpv);
  const wiv = await escalated({ payload: payIssue, workspace: wsVacio, comentarios: { 50: [ESCALADA] } });
  check(wiv.added.length === 0 && wiv.warnings.some(m => /no injertado/.test(m)), '(int) sesión del issue sin módulo ⇒ statu quo (nada), con aviso', wiv);
  // Camino ready (#3373/#3384): PR ya ready ⇒ vuelve a draft y se retira needs-review.
  const wr = await escalated({ payload: payIssue, pr: { ...prBase, draft: false, labels: [{ name: 'needs-review' }] }, comentarios: { 50: [ESCALADA] } });
  check(wr.added.join() === '50:estado:esperando-architect,50:stalled' && wr.graphql.includes('convertPullRequestToDraft') && wr.removed.includes('50:needs-review'),
    '(int) PR ya ready + escalada ⇒ stalled + estado + convertPullRequestToDraft + retira needs-review', wr);
  // Sin escalada / escalada anterior al disparador ⇒ nada.
  const wn = await escalated({ payload: payIssue, comentarios: { 50: [{ ...ESCALADA, created_at: '2026-10-05T09:00:00Z' }] } });
  check(wn.added.length === 0, '(int) escalada anterior al comentario disparador ⇒ nada', wn);
  const wsin = await escalated({ payload: payIssue, pr: null, comentarios: { 40: [ESCALADA] } });
  check(wsin.added.length === 0 && !wsin.threw, '(int) sin PR abierto de la sesión ⇒ nada', wsin);
  // Nits del Reviewer (#398): lecturas fail-open y comentarios del PR paginados.
  const wc = await escalated({ payload: payIssue, lecturaCaida: true, comentarios: { 50: [ESCALADA] } });
  check(!wc.threw && wc.added.length === 0 && wc.warnings.some(m => /lectura del PR\/issue de la sesión falló/.test(m)),
    '(int) lectura caída (5xx) ⇒ no lanza, no materializa, con aviso (fail-open)', wc);
  const relleno = Array.from({ length: 120 }, (_, i) => ({ user: { login: 'pat' }, created_at: '2026-10-05T10:20:00Z', body: `r${i}` }));
  const wpg = await escalated({ payload: payIssue, comentarios: { 50: [...relleno, ESCALADA] } });
  check(wpg.added.join() === '50:estado:esperando-architect,50:stalled', '(int) escalada más allá del comentario 100 del PR ⇒ se lee (paginado)', wpg);
  const wpgd = await escalated({ payload: payIssue, comentarios: { 50: [...relleno, ESCALADA, { user: { login: 'pat' }, created_at: '2026-10-05T10:31:00Z', body: 'x\n\n<!-- creator-escalated-materializado -->' }] } });
  check(wpgd.added.length === 0, '(int) marcador `-materializado` más allá del comentario 100 ⇒ no duplica (paginado)', wpgd);
}

async function muerte({ outcome = 'success', jobStatus = '', workspace = ws, ...m }) {
  const { w, github, core, fetch } = mundo(m);
  const dir = mkdtempSync(join(tmpdir(), 'escalada-exec-'));
  const exec = join(dir, 'claude-execution-output.json');
  writeFileSync(exec, JSON.stringify([{ type: 'result', num_turns: 30, total_cost_usd: 1 }]));
  const context = { repo: { owner: 'o', repo: 'r' }, runId: 1, payload: { issue: { number: 40, title: 'x', labels: [] }, comment: { created_at: TRIG } } };
  try {
    await runMuerte({ github, context, core, require }, {
      env: { GITHUB_WORKSPACE: workspace, EXEC_FILE: exec, STEP_CREATOR_OUTCOME: outcome, JOB_STATUS: jobStatus, IN_DEFAULT_BRANCH: 'main', RESCUE_WIP: '', RESCUE_PR: '', DEFAULT_GH_TOKEN: 't' },
      globales: { fetch } });
  } catch (e) { w.threw = e.message; } finally { rmSync(dir, { recursive: true, force: true }); }
  w.ready = w.fetches.some(f => /graphql/.test(f));
  return w;
}
{
  // (e, 1.er ruling) draft + escalada ⇒ no ready, no needs-review.
  const w = await muerte({ comentarios: { 50: [ESCALADA] } });
  check(!w.threw && !w.ready && !w.added.some(l => /needs-review/.test(l)) && w.comments.length === 0 && w.notices.some(m => /AP-136/.test(m)),
    '(int) materializador de ready: draft + success + escalada fresca ⇒ ni ready ni needs-review (lo materializa creator-escalated)', w);
  const wi = await muerte({ comentarios: { 40: [ESCALADA] } });
  check(!wi.ready && !wi.added.some(l => /needs-review/.test(l)), '(int) materializador de ready: escalada en el ISSUE ⇒ cede igual', wi);
  const wl = await muerte({ pr: { ...prBase, labels: [{ name: 'estado:esperando-architect' }] } });
  check(!wl.ready && !wl.added.some(l => /needs-review/.test(l)), '(int) materializador de ready: draft con `estado:esperando-architect` ⇒ cede', wl);
  // Sesión que no terminó en success: creator-escalated no correrá ⇒ lo materializa aquí.
  const wf2 = await muerte({ outcome: 'failure', comentarios: { 50: [ESCALADA] } });
  check(!wf2.ready && wf2.added.join() === '50:estado:esperando-architect,50:stalled' && wf2.comments.some(c => /creator-escalated-materializado/.test(c)) && !wf2.added.some(l => /needs-review/.test(l)),
    '(int) materializador de ready: draft + failure + escalada ⇒ stalled + estado (creator-escalated no corre), sin ready', wf2);
  // Pre-reviewer 2: la sesión en success pero el JOB en rojo (post-step anterior) ⇒ creator-escalated no correrá.
  const wj = await muerte({ jobStatus: 'failure', comentarios: { 50: [ESCALADA] } });
  check(!wj.ready && wj.added.join() === '50:estado:esperando-architect,50:stalled', '(int) materializador de ready: sesión success pero job.status failure + escalada ⇒ stalled + estado aquí', wj);
  const wjs = await muerte({ jobStatus: 'success', comentarios: { 50: [ESCALADA] } });
  check(!wjs.ready && wjs.added.length === 0, '(int) materializador de ready: job.status success + escalada ⇒ cede sin materializar (lo hace creator-escalated)', wjs);
  // Pre-reviewer 1: un marcador `-materializado` de una escalada ANTERIOR (fuera de la ventana) no deduplica.
  const viejo = { user: { login: 'pat' }, created_at: '2026-10-05T09:00:00Z', body: 'x\n\n<!-- creator-escalated-materializado -->' };
  const wm = await muerte({ outcome: 'failure', comentarios: { 50: [viejo, ESCALADA] } });
  check(wm.added.join() === '50:estado:esperando-architect,50:stalled', '(int) materializador de ready: marcador de una escalada anterior a la ventana ⇒ no deduplica, materializa', wm);
  const fresco = { ...viejo, created_at: '2026-10-05T10:31:00Z' };
  const wmf = await muerte({ outcome: 'failure', comentarios: { 50: [ESCALADA, fresco] } });
  check(wmf.added.length === 0 && wmf.comments.length === 0, '(int) materializador de ready: marcador fresco ⇒ no duplica', wmf);
  // Pre-reviewer 3: PR ya ready + escalada + job no success ⇒ materializa y devuelve a draft.
  const wrf = await muerte({ outcome: 'failure', pr: { ...prBase, draft: false, labels: [{ name: 'needs-review' }] }, comentarios: { 50: [ESCALADA] } });
  check(wrf.added.join() === '50:estado:esperando-architect,50:stalled' && wrf.graphql.includes('convertPullRequestToDraft') && wrf.removed.includes('50:needs-review'),
    '(int) materializador de ready: PR ya ready + failure + escalada ⇒ stalled + estado + vuelta a draft + retira needs-review', wrf);
  const wrs = await muerte({ pr: { ...prBase, draft: false }, comentarios: { 50: [ESCALADA] } });
  check(wrs.added.length === 0 && wrs.graphql.length === 0 && !wrs.ready, '(int) materializador de ready: PR ya ready + success + escalada ⇒ nada aquí (creator-escalated lo materializa)', wrs);
  // (d, 1.er ruling) draft + success SIN escalada ⇒ actúa como hoy.
  const wc = await muerte({});
  check(wc.ready && wc.added.includes('50:needs-review') && wc.comments.some(c => /creator-muerto-draft-materializado-ready/.test(c)), '(int, control) draft + success sin escalada ⇒ ready + needs-review (AP-047 intacto)', wc);
  const wv = await muerte({ workspace: wsVacio, comentarios: { 50: [ESCALADA] } });
  check(wv.ready && wv.added.includes('50:needs-review') && wv.warnings.some(m => /no injertado/.test(m)), '(int) sin módulo ⇒ fail-open al comportamiento actual, con aviso', wv);
}
rmSync(ws, { recursive: true, force: true });
rmSync(wsVacio, { recursive: true, force: true });

// ── Parte 3: costura ────────────────────────────────────────────────────────
{
  check(!/github\.event_name == 'pull_request_review'/.test(stepEsc.if || ''), 'costura: el `if:` de creator-escalated ya no filtra por tipo de evento');
  check(/success\(\)/.test(stepEsc.if || '') && /steps\.check_flight\.outputs\.blocked/.test(stepEsc.if || ''), 'costura: el `if:` de creator-escalated conserva success() y los steps.* de guarda');
  const inv = s => /scripts\/escalada-creator\.cjs/.test(s || '');
  const orf = steps.find(s => s.name === 'Materializar review en la apertura del PR (open-review-failsafe)');
  check(inv(stepEsc.with.script) && /resolverPr/.test(stepEsc.with.script) && /escaladaFresca/.test(stepEsc.with.script) && /convertPullRequestToDraft/.test(stepEsc.with.script), 'costura: creator-escalated invoca el módulo (resolverPr, escaladaFresca) y devuelve a draft');
  check(orf && inv(orf.with.script) && /cedeAnteEscalada/.test(orf.with.script), 'costura: open-review-failsafe invoca el módulo (cedeAnteEscalada)');
  check(orf && orf.with.script.indexOf('cedeAnteEscalada') < orf.with.script.indexOf("labels: ['needs-review']"), 'costura: open-review-failsafe cede ANTES de aplicar needs-review');
  const ms = stepMuerte.with.script;
  check(inv(ms) && /cedeAnteEscalada/.test(ms) && ms.indexOf('cedeAnteEscalada') < ms.indexOf('markPullRequestReadyForReview'), 'costura: el materializador de ready invoca el módulo y cede antes del markReady');
  const idx = s => steps.indexOf(s);
  check(idx(orf) < idx(stepEsc) && idx(stepMuerte) < idx(stepEsc), 'costura: open-review-failsafe y el materializador de ready corren ANTES que creator-escalated (leen la ventana ellos mismos)');
  const em = readFileSync('.github/workflows/epic-merge.yml', 'utf8');
  check(em.includes('.epic-merge-central/vendored/scripts/escalada-creator.cjs') && /mergeBloqueadoPorEscalada/.test(em), 'costura: el gate de epic-merge carga el módulo del checkout sparse');
  const iCi = em.indexOf('if (!ciOk)'), iEsc = em.indexOf('mergeBloqueadoPorEscalada'), iGate2 = em.indexOf('// GATE 2: Reviewer LGTM');
  check(iCi > 0 && iEsc > iCi && iEsc < iGate2, 'costura: el gate de escalada va junto al gate ciOk (antes de GATE 2)');
}

if (fails) { console.error(`CHECK-ESCALADA-CREATOR ROJO: ${fails} caso(s) fallan.`); process.exit(1); }
console.log(`check-escalada-creator verde (${fuente}): módulo, integración y costura.`);
