#!/usr/bin/env node
// check-enmiendas — banco de las enmiendas en vuelo y los disparos diferidos
// (central#327, ruling mensual 2026-10-06). Ejecuta los scripts EMBEBIDOS reales
// (no copias) de `claude-code.yml` (`check_flight`, `foto_enmiendas`,
// `entrega_enmiendas`), `reviewer.yml` (post-step de estado) y `epic-merge.yml`
// («Evaluar y mergear»), cargados con el cargador compartido de AP-105, contra
// una API de GitHub en memoria, y el módulo `vendored/scripts/enmiendas.cjs`.
//
// Casos del ruling (punto 8):
//  (a) ping con Creator en vuelo ⇒ `disparo-pendiente`, sin sesión, y re-arm al
//      cerrar el turno;
//  (b) enmienda posterior al inicio de la sesión ⇒ re-arm al cerrar;
//  (c) mismo conjunto ⇒ un solo re-arm;
//  (d) tope 3/24 h ⇒ `human-needed`;
//  (e) Reviewer con enmienda sin acuse ⇒ sin LGTM;
//  (f) epic-merge con enmienda sin acuse ⇒ no mergea;
//  (g) enmienda acusada ⇒ flujo normal;
//  (h) comentario no TRUSTED con el marcador ⇒ ignorado.
// Más bordes: turno sin sesión no entrega, el re-arm propio no se auto-difiere,
// exclusión ACOTADA de contendiente (enmienda 2026-10-06 de AP-100 §1), dedupe
// por superconjunto (Reviewer concurrente), re-arm del gate 3 en un PR en
// espera, marcador citado, rechazo ⇒ `human-needed`, foto pre-sesión y costuras
// (incluidas las copias de TRUSTED y del regex en `check_flight`).
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createRequire } from 'module';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);
const ENM = require(resolve('vendored/scripts/enmiendas.cjs'));
const RAIZ = process.cwd();

const stepsDe = (f) => {
  const wf = yaml.load(readFileSync(f, 'utf8'));
  const out = [];
  for (const job of Object.values(wf.jobs || {})) for (const st of job.steps || []) out.push(st);
  return out;
};
const CC = stepsDe('.github/workflows/claude-code.yml');
const RV = stepsDe('.github/workflows/reviewer.yml');
const EM = stepsDe('.github/workflows/epic-merge.yml');
const porId = (lista, id) => lista.find((s) => s.id === id);
const porNombre = (lista, re) => lista.find((s) => re.test(s.name || ''));
const need = (st, nombre) => { if (!st) { console.error(`CHECK-ENMIENDAS ROJO: step ${nombre} no encontrado`); process.exit(1); } return st; };
const flight = cargarStep(need(porId(CC, 'check_flight'), 'check_flight').with.script, 'check_flight');
const foto = cargarStep(need(porId(CC, 'foto_enmiendas'), 'foto_enmiendas').with.script, 'foto_enmiendas');
const entrega = cargarStep(need(porId(CC, 'entrega_enmiendas'), 'entrega_enmiendas').with.script, 'entrega_enmiendas');
const revStep = need(porNombre(RV, /^Materializar estado del Reviewer/), 'reviewer/Materializar estado');
const reviewer = cargarStep(revStep.with.script, 'reviewer-estado');
const emStep = need(porNombre(EM, /^Evaluar y mergear$/), 'epic-merge/Evaluar y mergear');
const epicMerge = cargarStep(emStep.with.script, 'epic-merge');

let fallos = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok ' : '  ROJO'} ${msg}`); if (!ok) fallos++; };

// Workspace de pega: los steps cargan el módulo desde sus checkouts sparse.
const WS = mkdtempSync(join(tmpdir(), 'enm-ws-'));
for (const d of ['.cola-central', '.enmiendas-central', '.epic-merge-central']) symlinkSync(RAIZ, join(WS, d));
mkdirSync(join(WS, '.git', 'info'), { recursive: true });
const EXEC = join(WS, 'claude-execution-output.json');
writeFileSync(EXEC, '[]');

// ── Mundo en memoria ──────────────────────────────────────────────────────────
const ISSUE = 40, PR = 50, RAMA = 'claude/issue-40-20261006-0900', PAT_LOGIN = 'talfarouriarte-cloud';
const HACE = (min) => new Date(Date.now() - min * 60 * 1000).toISOString();
let nextId = 1000;
const com = (item, body, { assoc = 'OWNER', login = PAT_LOGIN, min = 5, id } = {}) => {
  const cid = id || nextId++;
  return { id: cid, item, body, author_association: assoc, user: { login, type: assoc === 'NONE' ? 'Bot' : 'User' },
    created_at: HACE(min), html_url: `https://github.com/o/r/issues/${item}#issuecomment-${cid}` };
};
const enmienda = (item = ISSUE, extra = {}) => com(item, 'Cambia X por Y.\n\n<!-- enmienda -->', extra);
const acuse = (id, tipo = 'aplicada', extra = {}) => com(PR, `Hecho.\n\n<!-- enmienda-${tipo}: ${id} -->`, { assoc: 'NONE', login: 'claude[bot]', ...extra });

function mundo({ comentarios = [], labels = {}, conPR = true } = {}) {
  const w = { comentarios: [...comentarios], labels: { [ISSUE]: [...(labels[ISSUE] || [])], [PR]: [...(labels[PR] || [])] },
    creados: [], añadidas: [], quitadas: [], merges: 0, fetches: [] };
  const prObj = () => ({ number: PR, state: 'open', merged: false, draft: false, title: 'feat (#40)', created_at: HACE(600),
    head: { ref: RAMA, sha: 'abc123' }, labels: w.labels[PR].map((name) => ({ name })), mergeable_state: 'clean' });
  const crear = (n, body) => {
    const c = com(n, body, { min: 0 });
    w.comentarios.push(c); w.creados.push(c);
    return { data: c };
  };
  const conocidos = {
    issues: {
      listComments: async (p) => ({ data: w.comentarios.filter((c) => c.item === p.issue_number) }),
      createComment: async (p) => crear(p.issue_number, p.body),
      updateComment: async (p) => { const c = w.comentarios.find((x) => x.id === p.comment_id); if (c) c.body = p.body; return { data: c }; },
      addLabels: async (p) => { w.añadidas.push(...p.labels.map((l) => `${p.issue_number}:${l}`)); w.labels[p.issue_number] = [...new Set([...(w.labels[p.issue_number] || []), ...p.labels])]; return { data: [] }; },
      removeLabel: async (p) => { w.quitadas.push(`${p.issue_number}:${p.name}`); w.labels[p.issue_number] = (w.labels[p.issue_number] || []).filter((l) => l !== p.name); return { data: [] }; },
      get: async (p) => ({ data: { number: p.issue_number, title: `Issue ${p.issue_number}`, state: 'open', body: '', created_at: HACE(900),
        labels: (w.labels[p.issue_number] || []).map((name) => ({ name })), ...(p.issue_number === PR ? { pull_request: {} } : {}) } }),
      listLabelsOnIssue: async (p) => ({ data: (w.labels[p.issue_number] || []).map((name) => ({ name })) }),
    },
    pulls: {
      list: async () => ({ data: conPR ? [prObj()] : [] }),
      get: async () => ({ data: prObj() }),
      merge: async () => { w.merges++; throw new Error('MERGE-DOBLE (el banco no sigue al postMerge)'); },
    },
    repos: { getCommit: async () => ({ data: { commit: { committer: { date: HACE(60) } } } }) },
    users: { getAuthenticated: async () => ({ data: { login: PAT_LOGIN } }) },
  };
  // Lo no doblado devuelve vacío: el banco mira enmiendas, no el resto del job.
  const vacio = async () => ({ data: [] });
  const rest = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (_, m) => (conocidos[ns] && conocidos[ns][m]) || vacio }) });
  w.github = { rest, paginate: async (fn, p) => { const r = await fn(p); return Array.isArray(r.data) ? r.data : (r.data && (r.data.workflow_runs || r.data.items)) || []; } };
  // `fetch` global: comentarios/labels con el PAT (Reviewer) y espejo de status (epic-merge).
  w.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    w.fetches.push({ url: String(url), method: init.method || 'GET', body });
    const mc = String(url).match(/\/issues\/(\d+)\/comments$/);
    const ml = String(url).match(/\/issues\/(\d+)\/labels(?:\/([^/]+))?$/);
    if (mc && init.method === 'POST') crear(Number(mc[1]), body.body);
    else if (ml && init.method === 'POST') await conocidos.issues.addLabels({ issue_number: Number(ml[1]), labels: body.labels });
    else if (ml && init.method === 'DELETE') await conocidos.issues.removeLabel({ issue_number: Number(ml[1]), name: decodeURIComponent(ml[2]) });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return w;
}
const core = (w) => ({ setOutput: (k, v) => { (w.outputs ||= {})[k] = String(v); }, notice() {}, warning() {}, info() {}, setFailed: (m) => { w.failed = m; } });
const rearms = (w) => w.creados.filter((c) => /^[ \t]*<!--\s*rearm-enmienda:/m.test(c.body));

async function correrEntrega(w, { item = PR, sesion = true, runId = 777 } = {}) {
  const payload = item === PR ? { issue: { number: PR, pull_request: {} } } : { issue: { number: ISSUE } };
  await entrega({ github: w.github, context: { repo: { owner: 'o', repo: 'r' }, runId, payload }, core: core(w) },
    { env: { EXEC_FILE: sesion ? EXEC : join(WS, 'no-existe.json'), GITHUB_WORKSPACE: WS } });
}
// `pasos[run_id]` = { sesion: 'in_progress'|'success'|'skipped', entrega: 'pending'|'in_progress'|'success'|'skipped' }.
const PASO = {
  in_progress: { status: 'in_progress', conclusion: null }, pending: { status: 'pending', conclusion: null },
  success: { status: 'completed', conclusion: 'success' }, skipped: { status: 'completed', conclusion: 'skipped' },
};
async function correrFlight(w, { trigger, runs, pasos = {} }) {
  const github = {
    rest: {
      pulls: { get: async () => ({ data: { number: PR, title: 'feat (#40)', head: { ref: RAMA } } }) },
      issues: { get: async () => ({ data: { number: ISSUE, title: 'Issue 40' } }) },
      actions: {
        listWorkflowRunsForRepo: async (p) => ({ data: { workflow_runs: p.status !== 'in_progress' ? [] : runs.map((r) => ({ id: r, name: 'Claude Code', display_title: 'feat (#40)', head_branch: 'main', created_at: HACE(1) })) } }),
        listJobsForWorkflowRun: async (p) => ({ data: { jobs: [{ name: 'call / claude', status: 'in_progress', conclusion: null,
          steps: [
            { name: 'Run Claude Code', ...PASO[(pasos[p.run_id] || {}).sesion || 'in_progress'] },
            { name: 'Entregar enmiendas y disparos diferidos (cierre del turno, central#327)', ...PASO[(pasos[p.run_id] || {}).entrega || 'pending'] },
          ] }] } }),
      },
    },
  };
  const f = async (url, init) => { const m = String(url).match(/\/issues\/(\d+)\/comments$/); w.comentarios.push(com(Number(m[1]), JSON.parse(init.body).body, { assoc: 'NONE', login: 'github-actions[bot]', min: 0 })); return { ok: true, status: 201 }; };
  const out = {};
  await flight({ github, context: { repo: { owner: 'o', repo: 'r' }, runId: 800, workflow: 'Claude Code', eventName: 'issue_comment',
    payload: { issue: { number: PR, title: 'feat (#40)', pull_request: {} }, comment: trigger } },
  core: { setOutput: (k, v) => { out[k] = String(v); }, notice() {}, warning() {}, info() {} } },
  { env: { DEFAULT_GH_TOKEN: 'job' }, globales: { fetch: f } });
  return out;
}
async function correrReviewer(w) {
  const payload = { pull_request: { number: PR, head: { sha: 'abc123', ref: RAMA }, labels: w.labels[PR].map((name) => ({ name })) } };
  await reviewer({ github: w.github, context: { repo: { owner: 'o', repo: 'r' }, runId: 900, payload }, core: core(w) },
    { env: { ARM_PAT: 'pat', GITHUB_WORKSPACE: WS, STEP_OUTCOME: 'success' }, globales: { fetch: w.fetch } });
}
async function correrEpicMerge(w) {
  const pull_request = { number: PR, state: 'open', merged: false, head: { ref: RAMA, sha: 'abc123' }, labels: w.labels[PR].map((name) => ({ name })) };
  await epicMerge({ github: w.github, context: { repo: { owner: 'o', repo: 'r' }, runId: 950, eventName: 'pull_request',
    payload: { action: 'labeled', label: { name: 'lgtm' }, pull_request } }, core: core(w) },
  { env: { GITHUB_WORKSPACE: WS, IN_AUTOMERGE: 'true', IN_EPIC_LABEL: 'epica', IN_CI_WORKFLOW_NAME: 'CI', STATUS_TOKEN: 'job', IN_LOOSE_AUDIT: 'false',
    IN_PARTIAL_ROUND_CAP: '3', IN_PARTIAL_LIFETIME_CAP: '6', IN_DEFAULT_BRANCH: 'main' }, globales: { fetch: w.fetch } });
}
const VEREDICTO_LGTM = () => com(PR, 'LGTM\n\nTodo bien.', { min: 1 });

// ── (a) ping con Creator en vuelo ⇒ disparo-pendiente, sin sesión, re-arm al cerrar ──
{
  const w = mundo();
  const ping = com(PR, '@claude cambia también Z', { id: 9001, min: 2 });
  w.comentarios.push(ping);
  const out = await correrFlight(w, { trigger: ping, runs: [777, 800] });
  const dif = w.comentarios.find((c) => c.user.login === 'github-actions[bot]');
  check(out.blocked === 'true', '(a) ping con Creator en vuelo ⇒ blocked=true (sin sesión)');
  check(!!dif && /<!-- disparo-pendiente: 9001 -->/.test(dif.body) && /se entregará al terminar el turno en curso/.test(dif.body) && !/repítelo/.test(dif.body),
    '(a) el comentario deja `disparo-pendiente: <id del ping>` y dice «se entregará al terminar el turno en curso»');
  await correrEntrega(w, { runId: 777 });
  const r = rearms(w);
  check(r.length === 1 && /<!-- rearm-enmienda: 9001 -->/.test(r[0].body) && /^@claude$/m.test(r[0].body) && /<!-- ping-creator -->/.test(r[0].body) && r[0].item === PR,
    '(a) al cerrar el turno en curso: UN re-arm con ping al Creator que entrega el disparo (en el PR)');
  check(!!r[0] && r[0].body.includes(dif.html_url) && /<!-- rearm-enmienda-run: 777 -->/.test(r[0].body), '(a) el re-arm enlaza el disparo y lleva el run que lo publica');
  await correrEntrega(w, { runId: 801 });
  check(rearms(w).length === 1 && !w.añadidas.length, '(a) un disparo ya entregado no se re-entrega');
  // El re-arm lo publicó el post-step del run 777: no es contendiente de su propio re-arm.
  const out2 = await correrFlight(w, { trigger: r[0], runs: [777, 800] });
  check(out2.blocked === 'false', '(a) el re-arm propio no se auto-difiere (el run 777 ya está en post-steps)');
  const out3 = await correrFlight(w, { trigger: r[0], runs: [776, 777, 800] });
  check(out3.blocked === 'true', '(a) …pero otro Creator en vuelo (run 776) sigue contando: árbitro intacto');
  // Enmienda 2026-10-06 de AP-100 §1: exclusión ACOTADA del contendiente.
  const flightCon = async (pasos777) => {
    const w4 = mundo();
    const ping4 = com(PR, '@claude otra cosa', { min: 1 });
    w4.comentarios.push(ping4);
    const o = await correrFlight(w4, { trigger: ping4, runs: [777, 800], pasos: { 777: pasos777 } });
    return { blocked: o.blocked, diferido: w4.comentarios.some((c) => new RegExp(`<!-- disparo-pendiente: ${ping4.id} -->`).test(c.body)) };
  };
  let f4 = await flightCon({ sesion: 'success', entrega: 'pending' });
  check(f4.blocked === 'true' && f4.diferido, '(a) sesión `success` + entrega pendiente ⇒ cuenta: cede y deja `disparo-pendiente` (lo entrega él)');
  f4 = await flightCon({ sesion: 'success', entrega: 'in_progress' });
  check(f4.blocked === 'true' && f4.diferido, '(a) sesión `success` + entrega `in_progress` ⇒ cuenta: cede y deja `disparo-pendiente`');
  f4 = await flightCon({ sesion: 'success', entrega: 'success' });
  check(f4.blocked === 'false' && !f4.diferido, '(a) entrega del contendiente `completed` ⇒ no cuenta: el ping pasa (nadie lo entregaría)');
  f4 = await flightCon({ sesion: 'success', entrega: 'skipped' });
  check(f4.blocked === 'false', '(a) entrega del contendiente `completed/skipped` (p. ej. WIP rescatado) ⇒ no cuenta');
  f4 = await flightCon({ sesion: 'skipped', entrega: 'pending' });
  check(f4.blocked === 'false', '(a) sesión del contendiente `skipped` (otro guard) ⇒ no cuenta: nunca habrá entrega');
  const spoof = com(PR, '@claude\n<!-- rearm-enmienda-run: 777 -->', { assoc: 'NONE', login: 'mallory' });
  check((await correrFlight(w, { trigger: spoof, runs: [777, 800] })).blocked === 'true', '(a) un `rearm-enmienda-run` de autor no TRUSTED no exime');
}
// ── (a') turno sin sesión (AP-100 punto 2) ⇒ no entrega ──
{
  const w = mundo({ comentarios: [enmienda()] });
  await correrEntrega(w, { sesion: false });
  check(w.creados.length === 0, "(a') turno sin sesión (sin execution file) ⇒ no entrega (lo hará el siguiente turno real)");
}
// ── (b) enmienda posterior al inicio de la sesión ⇒ re-arm al cerrar ──
{
  const e = enmienda(ISSUE, { min: 1 });
  const w = mundo({ comentarios: [com(PR, '@claude empieza', { min: 30 }), e] });
  await correrEntrega(w);
  const r = rearms(w);
  check(r.length === 1 && new RegExp(`<!-- rearm-enmienda: ${e.id} -->`).test(r[0].body) && r[0].body.includes(e.html_url), '(b) enmienda en el issue durante la sesión ⇒ re-arm al cerrar que la enlaza');
  const w2 = mundo({ comentarios: [enmienda(ISSUE)], conPR: false });
  await correrEntrega(w2, { item: ISSUE });
  check(rearms(w2).length === 1 && rearms(w2)[0].item === ISSUE, '(b) sin PR abierto ⇒ el re-arm va al issue');
}
// ── (c) mismo conjunto ⇒ un solo re-arm ──
{
  const w = mundo({ comentarios: [enmienda(ISSUE), enmienda(PR)] });
  await correrEntrega(w);
  await correrEntrega(w, { runId: 778 });
  check(rearms(w).length === 1, '(c) dos cierres con el mismo conjunto pendiente ⇒ un solo re-arm');
  check(w.añadidas.includes(`${PR}:human-needed`) && w.creados.some((c) => /<!-- enmienda-sin-acuse-tras-rearm -->/.test(c.body)),
    '(c) …y el turno re-armado que acaba sin acusar el mismo conjunto ⇒ human-needed (sin bloqueo mudo)');
  const wc = mundo({ comentarios: [enmienda(ISSUE), enmienda(PR)] });
  await correrEntrega(wc);
  wc.comentarios.push(enmienda(PR));
  await correrEntrega(wc, { runId: 779 });
  check(rearms(wc).length === 2 && !wc.añadidas.length, '(c) conjunto nuevo (otra enmienda) ⇒ un re-arm más');
}
// ── (d) tope 3/24 h ⇒ human-needed ──
{
  const previos = [1, 2, 3].map((k) => com(PR, `@claude\n<!-- rearm-enmienda: ${k} -->`, { min: 60 * k }));
  const w = mundo({ comentarios: [...previos, enmienda()] });
  await correrEntrega(w);
  check(rearms(w).length === 0 && w.añadidas.includes(`${PR}:human-needed`) && w.creados.some((c) => /<!-- rearm-enmienda-tope -->/.test(c.body)),
    '(d) 3 re-arms en 24 h ⇒ human-needed + comentario, sin re-arm');
  const viejos = [1, 2, 3].map((k) => com(PR, `@claude\n<!-- rearm-enmienda: ${k} -->`, { min: 60 * 25 }));
  const w2 = mundo({ comentarios: [...viejos, enmienda()] });
  await correrEntrega(w2);
  check(rearms(w2).length === 1, '(d) 3 re-arms de hace más de 24 h ⇒ re-arm normal');
  const w3 = mundo({ comentarios: [enmienda()], labels: { [PR]: ['human-needed'] } });
  await correrEntrega(w3);
  check(w3.creados.length === 0, '(d) con human-needed en el ítem ⇒ turno humano, sin re-arm');
}
// ── (e) Reviewer con enmienda sin acuse ⇒ sin LGTM ──
{
  const e = enmienda(ISSUE, { min: 30 });
  const w = mundo({ comentarios: [e, VEREDICTO_LGTM()], labels: { [PR]: ['lgtm'] } });
  await correrReviewer(w);
  const lgtmPost = w.fetches.some((f) => f.method === 'POST' && /\/labels$/.test(f.url) && (f.body.labels || []).includes('lgtm'));
  check(!lgtmPost && !w.labels[PR].includes('lgtm'), '(e) LGTM con enmienda sin acuse ⇒ no se escribe `lgtm` y se retira la que había');
  const r = rearms(w);
  check(r.length === 1 && r[0].body.includes(e.html_url) && /^@claude$/m.test(r[0].body) && /Reviewer emitió `LGTM`/.test(r[0].body),
    '(e) el turno vuelve al Creator con un comentario (PAT) que enlaza la enmienda');
  await correrReviewer(w);
  check(rearms(w).length === 1, '(e) dedupe compartido: un segundo LGTM con el mismo conjunto no re-arma otra vez');
}
// ── (e') dedupe por superconjunto: Reviewer concurrente tras una entrega con disparo ──
{
  const e = enmienda(ISSUE, { min: 30 });
  const d = com(PR, '<!-- disparo-pendiente: 9100 -->', { assoc: 'NONE', login: 'github-actions[bot]', min: 20 });
  const w = mundo({ comentarios: [e, d] });
  await correrEntrega(w);
  check(rearms(w).length === 1 && new RegExp(`<!-- rearm-enmienda: ${[e.id, 9100].sort((a, b) => a - b).join(',')} -->`).test(rearms(w)[0].body),
    "(e') la entrega re-arma {E, D}");
  w.comentarios.push(VEREDICTO_LGTM());
  await correrReviewer(w);
  check(rearms(w).length === 1 && !w.labels[PR].includes('lgtm'), "(e') LGTM concurrente con E sin acuse: sin `lgtm` y SIN segundo re-arm ({E} ⊆ {E, D})");
  await correrEntrega(w, { runId: 781 });
  check(rearms(w).length === 1 && w.añadidas.includes(`${PR}:human-needed`) && w.creados.some((c) => /<!-- enmienda-sin-acuse-tras-rearm -->/.test(c.body)),
    "(e') el turno re-armado acaba con E sin acuse (D ya entregado) ⇒ human-needed, no re-arm de {E}");
  const w2 = mundo({ comentarios: [e, d] });
  await correrEntrega(w2);
  w2.comentarios.push(com(PR, '<!-- disparo-pendiente: 9200 -->', { assoc: 'NONE', login: 'github-actions[bot]', min: 1 }));
  await correrEntrega(w2, { runId: 782 });
  check(rearms(w2).length === 2 && !w2.añadidas.length, "(e') un disparo NUEVO da conjunto nuevo ⇒ re-arm (la entrega no cambia de semántica)");
}
// ── (f) epic-merge con enmienda sin acuse ⇒ no mergea ──
{
  const e = enmienda(PR, { min: 30 });
  const w = mundo({ comentarios: [e, VEREDICTO_LGTM()], labels: { [PR]: ['ci-verde', 'lgtm'] } });
  await correrEpicMerge(w);
  const diag = w.comentarios.find((c) => /<!-- epic-merge-diag -->/.test(c.body));
  check(w.merges === 0, '(f) epic-merge con enmienda sin acuse ⇒ no mergea');
  check(!!diag && /enmienda sin acuse/.test(diag.body) && diag.body.includes(e.html_url), '(f) diag con el enlace a la enmienda');
  const r = rearms(w);
  check(r.length === 1 && /^@claude$/m.test(r[0].body) && r[0].body.includes(e.html_url) && /epic-merge no mergea/.test(r[0].body) && r[0].item === PR,
    '(f) PR en espera sin Creator en vuelo: el gate 3 re-arma al Creator (PAT) con la enmienda enlazada');
  await correrEpicMerge(w);
  check(w.merges === 0 && rearms(w).length === 1, '(f) segunda evaluación con el mismo conjunto ⇒ sin segundo re-arm (dedupe)');
  const previos = [1, 2, 3].map((k) => com(PR, `@claude\n<!-- rearm-enmienda: ${k} -->`, { min: 60 * k }));
  const wt = mundo({ comentarios: [...previos, e, VEREDICTO_LGTM()], labels: { [PR]: ['ci-verde', 'lgtm'] } });
  await correrEpicMerge(wt);
  check(wt.merges === 0 && rearms(wt).length === 0 && wt.añadidas.includes(`${PR}:human-needed`), '(f) gate 3 con el tope agotado ⇒ human-needed, sin re-arm');
}
// ── (g) enmienda acusada ⇒ flujo normal ──
{
  const e = enmienda(ISSUE, { min: 30 });
  const base = () => [e, acuse(e.id, 'aplicada', { min: 10 }), VEREDICTO_LGTM()];
  const w = mundo({ comentarios: base() });
  await correrEntrega(w);
  check(rearms(w).length === 0 && !w.añadidas.length, '(g) entrega: enmienda acusada ⇒ sin re-arm');
  const wr = mundo({ comentarios: base() });
  await correrReviewer(wr);
  check(wr.labels[PR].includes('lgtm') && rearms(wr).length === 0, '(g) Reviewer: enmienda acusada ⇒ `lgtm` escrita');
  const wm = mundo({ comentarios: base(), labels: { [PR]: ['ci-verde', 'lgtm'] } });
  await correrEpicMerge(wm);
  check(wm.merges === 1, '(g) epic-merge: enmienda acusada ⇒ mergea');
  const e2 = enmienda(PR);
  const w2 = mundo({ comentarios: [e, e2, com(PR, `<!-- enmienda-aplicada: ${e.id}, ${e2.id} -->`, { assoc: 'NONE', login: 'claude[bot]' })] });
  await correrEntrega(w2);
  check(rearms(w2).length === 0 && !w2.añadidas.length, '(g) un acuse con varios ids acusa todos');
}
// ── (h) comentario no TRUSTED con el marcador ⇒ ignorado ──
{
  const ajena = enmienda(PR, { assoc: 'NONE', login: 'mallory' });
  const w = mundo({ comentarios: [ajena] });
  await correrEntrega(w);
  check(w.creados.length === 0, '(h) entrega: enmienda de autor no TRUSTED ⇒ ignorada');
  const wr = mundo({ comentarios: [ajena, VEREDICTO_LGTM()] });
  await correrReviewer(wr);
  check(wr.labels[PR].includes('lgtm'), '(h) Reviewer: enmienda no TRUSTED ⇒ LGTM normal');
  const wm = mundo({ comentarios: [ajena, VEREDICTO_LGTM()], labels: { [PR]: ['ci-verde', 'lgtm'] } });
  await correrEpicMerge(wm);
  check(wm.merges === 1, '(h) epic-merge: enmienda no TRUSTED ⇒ mergea');
  const e = enmienda(ISSUE);
  const wa = mundo({ comentarios: [e, acuse(e.id, 'aplicada', { login: 'mallory' })] });
  await correrEntrega(wa);
  check(rearms(wa).length === 1, '(h) un acuse de autor ajeno (ni claude[bot] ni TRUSTED) no acusa');
  const wd = mundo({ comentarios: [com(PR, '<!-- disparo-pendiente: 5 -->', { assoc: 'NONE', login: 'mallory' })] });
  await correrEntrega(wd);
  check(wd.creados.length === 0, '(h) un `disparo-pendiente` ajeno (ni github-actions[bot] ni TRUSTED) no se entrega');
}
// ── Acuse en un PR anterior del mismo issue ──
{
  const e = enmienda(ISSUE, { min: 60 });
  const w = mundo({ comentarios: [e, acuse(e.id, 'aplicada', { min: 30 })] });
  await correrEntrega(w);
  const refl = w.creados.find((c) => c.item === ISSUE && new RegExp(`<!-- enmienda-aplicada: ${e.id} -->`).test(c.body));
  check(!!refl && rearms(w).length === 0, 'acuse que solo consta en el PR ⇒ se refleja en el issue (PAT, TRUSTED)');
  await correrEntrega(w, { runId: 790 });
  check(w.creados.filter((c) => c.item === ISSUE).length === 1, 'el reflejo no se repite');
  // PR siguiente del mismo issue: no ve los comentarios del PR anterior.
  const w2 = mundo({ comentarios: [e, refl] });
  await correrEntrega(w2);
  check(w2.creados.length === 0, 'PR posterior del mismo issue: el acuse reflejado cuenta (sin re-arm ni bloqueo falso)');
}
// ── Bordes ──
{
  const citada = com(PR, 'El marcador es `<!-- enmienda -->`, en línea propia.\n\n```\n<!-- enmienda -->\n```');
  const w = mundo({ comentarios: [citada] });
  await correrEntrega(w);
  check(w.creados.length === 0, 'marcador citado (backticks o bloque cercado) ⇒ no es enmienda');
  const e = enmienda(ISSUE);
  const wr = mundo({ comentarios: [e, acuse(e.id, 'rechazada')] });
  await correrEntrega(wr);
  check(wr.añadidas.includes(`${PR}:human-needed`) && wr.creados.some((c) => new RegExp(`<!-- enmienda-rechazo-escalado: ${e.id} -->`).test(c.body)) && rearms(wr).length === 0,
    'enmienda-rechazada ⇒ human-needed + escalado, sin re-arm');
  const nCom = wr.creados.length;
  await correrEntrega(wr, { runId: 780 });
  check(wr.creados.length === nCom, 'el rechazo se escala una sola vez');
  const wm = mundo({ comentarios: [e, acuse(e.id, 'rechazada'), VEREDICTO_LGTM()], labels: { [PR]: ['ci-verde', 'lgtm', 'human-needed'] } });
  await correrEpicMerge(wm);
  check(wm.merges === 0, 'rechazo acusado + human-needed ⇒ epic-merge no mergea (kill-switch)');
  const wp = mundo({ comentarios: [enmienda()], labels: { [PR]: ['pause-agents'] } });
  await correrEntrega(wp);
  check(wp.creados.length === 0, 'pause-agents en el ítem ⇒ sin re-arm');
}
// ── Foto pre-sesión ──
{
  const e = enmienda(ISSUE);
  const w = mundo({ comentarios: [e, enmienda(PR, { assoc: 'NONE', login: 'mallory' })] });
  await foto({ github: w.github, context: { repo: { owner: 'o', repo: 'r' }, payload: { issue: { number: PR, pull_request: {} } } }, core: core(w) },
    { env: { GITHUB_WORKSPACE: WS } });
  const ruta = join(WS, '.enmiendas-pendientes.md');
  const txt = existsSync(ruta) ? readFileSync(ruta, 'utf8') : '';
  check(txt.includes(`enmienda ${e.id}`) && txt.includes('Cambia X por Y.') && !txt.includes('mallory') && txt.split('## enmienda').length === 2,
    'foto pre-sesión: cuerpo íntegro e id de las enmiendas sin acuse (solo TRUSTED)');
  check(readFileSync(join(WS, '.git', 'info', 'exclude'), 'utf8').split('\n').includes('.enmiendas-pendientes.md'), 'foto pre-sesión: fuera del árbol (.git/info/exclude)');
  const w2 = mundo({ comentarios: [e, acuse(e.id)] });
  await foto({ github: w2.github, context: { repo: { owner: 'o', repo: 'r' }, payload: { issue: { number: ISSUE } } }, core: core(w2) }, { env: { GITHUB_WORKSPACE: WS } });
  check(!existsSync(ruta), 'foto pre-sesión: nada pendiente ⇒ sin fichero (se borra el de antes)');
}
// ── Costuras ──
{
  const idx = (re) => CC.findIndex((s) => re.test(s.name || ''));
  const iEnt = CC.indexOf(porId(CC, 'entrega_enmiendas'));
  check(iEnt > idx(/^Push residual/) && iEnt < CC.indexOf(porId(CC, 'post_muerte_sin_pr')) && iEnt < idx(/^Auto-label based on Creator/),
    'costura: la entrega va tras el rescate y antes de «Materializar muerte…» y del turn-close-failsafe (Auto-label)');
  const iFoto = CC.indexOf(porId(CC, 'foto_enmiendas'));
  check(iFoto < CC.indexOf(porId(CC, 'creator')) && iFoto > idx(/^Módulos vendored del central/), 'costura: la foto va tras el checkout del módulo y antes de la sesión');
  const iMod = RV.indexOf(porNombre(RV, /^Módulos vendored del central \(enmiendas\)/));
  check(iMod > RV.findIndex((s) => s.id === 'reviewer') && iMod < RV.indexOf(revStep), 'costura: el Reviewer carga el módulo antes de su post-step de estado');
  const sc = emStep.with.script;
  check(sc.indexOf('GATE 3: enmiendas') > sc.indexOf('GATE 2: Reviewer LGTM') && sc.indexOf('GATE 3: enmiendas') < sc.indexOf('pulls.merge('), 'costura: el gate 3 de epic-merge va entre el LGTM y el merge');
  check(ENM.clave([3, 1, 3, 2]) === '1,2,3', 'módulo: la clave del conjunto es ordenada y sin duplicados');
  // `check_flight` no puede hacer `require` del módulo: sus copias deben coincidir.
  const fl = porId(CC, 'check_flight').with.script;
  check(fl.includes(`[${[...ENM.TRUSTED].map((x) => `'${x}'`).join(', ')}]`), 'costura: el gate TRUSTED de `check_flight` es el de enmiendas.cjs');
  check(fl.includes(String(ENM.REARM_RUN_RE)), 'costura: el regex `rearm-enmienda-run` de `check_flight` es el de enmiendas.cjs');
  check(/^Entregar enmiendas y disparos diferidos/.test(porId(CC, 'entrega_enmiendas').name) && fl.includes('/^Entregar enmiendas y disparos diferidos/'),
    'costura: `check_flight` reconoce el step de entrega por su nombre real');
}

if (fallos) { console.error(`CHECK-ENMIENDAS ROJO: ${fallos} caso(s) fallan.`); process.exit(1); }
console.log('check-enmiendas verde.');
