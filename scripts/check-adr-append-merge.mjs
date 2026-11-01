#!/usr/bin/env node
// check-adr-append-merge — banco del merge mecánico append-only del registro de
// decisiones (central#370, AP-130).
//
// Dos mitades:
//   (a)–(e), (g), (h): `vendored/scripts/adr-append-merge.mjs` de verdad (CLI en
//   subproceso) sobre repos git temporales con un `origin` bare, igual que el
//   clon `fetch-depth: 0` del step de watchdog.yml.
//   (f): el step `Materializar rebase append-only` de watchdog.yml EXTRAÍDO por
//   nombre (`cargarStep`, mismo patrón que check-liveness-belts) contra un doble
//   de la API cuyo `pulls.get` devuelve labels VIVAS distintas de las del scan.
//   Además, (i) la costura del scan: el bloque PR-dirty entrega candidatos y ya
//   no publica el ping él mismo.
//   (j): el gate REAL de epic-merge (step «Evaluar y mergear») tras un merge
//   mecánico: el LGTM anterior no cuenta, ni por label ni por el respaldo de
//   comentarios de GATE 2 (review de #389 🔴).
//   (k): la red por estado del scan: HEAD = merge mecánico sin marcador ⇒
//   candidato `materializar` (review de #389 🟡).
//
// Cuelga del piggyback de `check-embedded-js.mjs`.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, symlinkSync } from 'fs';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname, resolve } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);
const MOD = resolve('vendored/scripts/adr-append-merge.mjs');
if (!existsSync(MOD)) { console.error(`check-adr-append-merge ROJO: no existe ${MOD}`); process.exit(1); }
const fallos = [];
let casos = 0;
const caso = async (nombre, f) => {
  casos++;
  try { const r = await f(); if (r !== true) fallos.push(`${nombre}: ${r}`); }
  catch (e) { fallos.push(`${nombre}: lanzó ${e.message}`); }
};
const j = x => JSON.stringify(x);

// ── Repos temporales ────────────────────────────────────────────────────────
const git = (dir, ...a) => {
  const r = spawnSync('git', ['-c', 'user.email=bank@local', '-c', 'user.name=bank', '-c', 'init.defaultBranch=main', ...a], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const escribir = (dir, files) => {
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
};
const HEAD_REF = 'claude/issue-1-x';
// ancestro → rama del PR (pr) y, después, la base avanza (base). Devuelve el
// clon «del runner» y el SHA del PR antes del merge.
function escenario({ ancestro, pr, base }) {
  const root = mkdtempSync(join(tmpdir(), 'adr-append-'));
  const origin = join(root, 'origin.git'), work = join(root, 'work'), repo = join(root, 'repo');
  mkdirSync(origin); git(origin, 'init', '-q', '--bare', '-b', 'main');
  mkdirSync(work); git(work, 'init', '-q', '-b', 'main'); git(work, 'remote', 'add', 'origin', origin);
  escribir(work, ancestro); git(work, 'add', '-A'); git(work, 'commit', '-qm', 'ancestro'); git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-qb', HEAD_REF); escribir(work, pr); git(work, 'add', '-A'); git(work, 'commit', '-qm', 'pr'); git(work, 'push', '-q', 'origin', HEAD_REF);
  const prSha = git(work, 'rev-parse', 'HEAD');
  git(work, 'checkout', '-q', 'main'); escribir(work, base); git(work, 'add', '-A'); git(work, 'commit', '-qm', 'base'); git(work, 'push', '-q', 'origin', 'main');
  const baseSha = git(work, 'rev-parse', 'HEAD');
  git(root, 'clone', '-q', origin, repo);
  return { repo, prSha, baseSha };
}
const correrMod = repo => {
  const r = spawnSync(process.execPath, [MOD, '--repo', repo, '--base', 'main', '--head', HEAD_REF], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const limpio = repo => git(repo, 'status', '--porcelain') === '' && !existsSync(join(repo, '.git', 'MERGE_HEAD'));

const CFG_DIR = { 'adr-lint.config.json': j({ layout: 'dir', dir: 'docs/decisions/adr' }) };
const ADR = 'docs/decisions/adr/ADR-007.md';
const ANC = '## ADR-007 — Algo\n\n### Contexto\n\nTexto.\n';
const BLOQ_BASE = '\n### ADR-007·R·1 (2026-11-01) — Enmienda E1\n\nCambio del Architect.\n';
const BLOQ_PR = '\n### Implementado (PR #9)\n\nHecho.\n';

await caso('(a) dir · dos appends al mismo ADR ⇒ ok, merge de 2 padres, ancestro+base+PR, sin reescritura', async () => {
  const { repo, prSha, baseSha } = escenario({ ancestro: { ...CFG_DIR, [ADR]: ANC }, pr: { [ADR]: ANC + BLOQ_PR }, base: { [ADR]: ANC + BLOQ_BASE } });
  const r = correrMod(repo);
  if (!r.ok) return j(r);
  const padres = git(repo, 'rev-list', '--parents', '-n', '1', r.sha).split(' ').slice(1);
  const contenido = readFileSync(join(repo, ADR), 'utf8');
  const ancestro = spawnSync('git', ['merge-base', '--is-ancestor', prSha, r.sha], { cwd: repo }).status === 0;
  const msg = git(repo, 'log', '-1', '--format=%s', r.sha);
  return (padres.length === 2 && padres[0] === prSha && padres[1] === baseSha && contenido === ANC + BLOQ_BASE + BLOQ_PR
    && ancestro && r.ruta === ADR && /^merge\(registro\): append-only de .* \(watchdog, AP-130\)$/.test(msg) && limpio(repo))
    || j({ r, padres, prSha, baseSha, contenido, ancestro, msg });
});

await caso('(b) conflicto en medio del ADR ⇒ na no-append, árbol limpio, sin commit', async () => {
  const { repo, prSha } = escenario({ ancestro: { ...CFG_DIR, [ADR]: ANC }, pr: { [ADR]: ANC.replace('Texto.', 'Texto PR.') + BLOQ_PR }, base: { [ADR]: ANC.replace('Texto.', 'Texto base.') + BLOQ_BASE } });
  const r = correrMod(repo);
  return (r.ok === false && r.na === 'no-append' && limpio(repo) && git(repo, 'rev-parse', 'HEAD') === prSha) || j(r);
});

await caso('(c) conflicto en el ADR y en otro fichero ⇒ na varios-conflictos', async () => {
  const { repo, prSha } = escenario({
    ancestro: { ...CFG_DIR, [ADR]: ANC, 'src/a.txt': 'uno\n' },
    pr: { [ADR]: ANC + BLOQ_PR, 'src/a.txt': 'dos\n' },
    base: { [ADR]: ANC + BLOQ_BASE, 'src/a.txt': 'tres\n' } });
  const r = correrMod(repo);
  return (r.ok === false && r.na === 'varios-conflictos' && limpio(repo) && git(repo, 'rev-parse', 'HEAD') === prSha) || j(r);
});

await caso('(c2) único conflicto fuera del registro ⇒ na fuera-del-registro', async () => {
  const { repo } = escenario({ ancestro: { ...CFG_DIR, 'src/a.txt': 'uno\n' }, pr: { 'src/a.txt': 'uno\ndos\n' }, base: { 'src/a.txt': 'uno\ntres\n' } });
  const r = correrMod(repo);
  return (r.ok === false && r.na === 'fuera-del-registro' && limpio(repo)) || j(r);
});

await caso('(d) volumes · dos appends al último volumen ⇒ ok', async () => {
  const VOL = 'docs/decisions/decisions-150-current.md';
  const cfg = { 'adr-lint.config.json': j({ layout: 'volumes', volumes: ['docs/decisions/decisions-001-149.md', VOL] }) };
  const { repo, baseSha } = escenario({ ancestro: { ...cfg, [VOL]: '## ADR-150 — X\n' }, pr: { [VOL]: '## ADR-150 — X\n## ADR-152 — PR\n' }, base: { [VOL]: '## ADR-150 — X\n## ADR-151 — Base\n' } });
  const r = correrMod(repo);
  return (r.ok && readFileSync(join(repo, VOL), 'utf8') === '## ADR-150 — X\n## ADR-151 — Base\n## ADR-152 — PR\n'
    && git(repo, 'rev-list', '--parents', '-n', '1', r.sha).split(' ').includes(baseSha)) || j(r);
});

await caso('(e) sin adr-lint.config.json ⇒ na sin-config (sin defaults de normalizeConfig)', async () => {
  const VOL = 'docs/decisions/decisions-150-current.md';   // ruta de los defaults: aun así no aplica
  const { repo, prSha } = escenario({ ancestro: { [VOL]: 'a\n' }, pr: { [VOL]: 'a\npr\n' }, base: { [VOL]: 'a\nbase\n' } });
  const r = correrMod(repo);
  return (r.ok === false && r.na === 'sin-config' && limpio(repo) && git(repo, 'rev-parse', 'HEAD') === prSha) || j(r);
});

await caso('(g) la base trae un cambio en .github/workflows/** ⇒ na workflows-en-base sin merge intentado', async () => {
  const { repo, prSha } = escenario({ ancestro: { ...CFG_DIR, [ADR]: ANC }, pr: { [ADR]: ANC + BLOQ_PR }, base: { [ADR]: ANC + BLOQ_BASE, '.github/workflows/ci.yml': 'name: CI\n' } });
  const r = correrMod(repo);
  return (r.ok === false && r.na === 'workflows-en-base' && limpio(repo) && git(repo, 'rev-parse', 'HEAD') === prSha) || j(r);
});

await caso('(h) add/add del mismo ADR-NNN.md ⇒ na no-append', async () => {
  const NEW = 'docs/decisions/adr/ADR-008.md';
  const { repo } = escenario({ ancestro: { ...CFG_DIR, [ADR]: ANC }, pr: { [NEW]: '## ADR-008 — PR\n' }, base: { [NEW]: '## ADR-008 — Base\n' } });
  const r = correrMod(repo);
  return (r.ok === false && r.na === 'no-append' && limpio(repo)) || j(r);
});

await caso('(a2) ancestro sin \\n final y bloque de la base sin \\n final ⇒ líneas separadas', async () => {
  const { resolverAppendOnly } = await import(MOD);
  const r = resolverAppendOnly({ ancestro: 'a', ours: 'a\npr\n', theirs: 'a\nbase' });
  return r === 'a\nbase\npr\n' || j(r);
});

// ── (f) step (iii) contra un doble de la API ────────────────────────────────
const wf = yaml.load(readFileSync('.github/workflows/watchdog.yml', 'utf8'));
const steps = wf.jobs.detect.steps;
const st = steps.find(s => s.name === 'Materializar rebase append-only');
if (!st || typeof st.with?.script !== 'string') { console.error('check-adr-append-merge ROJO: step «Materializar rebase append-only» no encontrado en watchdog.yml (job detect)'); process.exit(1); }
const run = cargarStep(st.with.script, 'Materializar rebase append-only');
const SHA = 'abc1234def5678';

function doble({ live = {}, comments = [] } = {}) {
  const log = { calls: [], warnings: [], notices: [] };
  const github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      issues: { listComments: async () => ({ data: comments }) },
      pulls: { get: async () => ({ data: { draft: !!live.draft, labels: (live.labels || []).map(name => ({ name })) } }) },
    },
  };
  const core = { info() {}, notice: m => log.notices.push(m), warning: m => log.warnings.push(m), setOutput() {} };
  const fetch = async (url, o) => { log.calls.push({ method: o.method, path: url.replace(/^https:\/\/api\.github\.com\/repos\/o\/r/, ''), body: o.body ? JSON.parse(o.body) : null, auth: o.headers.Authorization }); return { ok: true, status: 200 }; };
  return { github, core, fetch, log };
}
async function iii({ cands, resultados, live, comments }) {
  const d = doble({ live, comments });
  const env = { ARM_PAT: 'PAT', CANDS: j(cands), RESULTADOS: resultados == null ? '' : j(resultados), IN_DEFAULT_BRANCH: 'main' };
  await run({ github: d.github, context: { repo: { owner: 'o', repo: 'r' }, eventName: 'schedule' }, core: d.core, require }, { env, globales: { fetch: d.fetch } });
  return d.log;
}
const C = { number: 5, head_ref: HEAD_REF, head_sha: 'x', rebases: 0 };
const OK = { 5: { ok: true, sha: SHA, ruta: ADR } };
const has = (l, m, p) => l.calls.some(c => c.method === m && c.path === p);
const post = l => l.calls.filter(c => c.method === 'POST' && c.path === '/issues/5/comments').map(c => c.body.body);
const addNR = l => l.calls.some(c => c.method === 'POST' && c.path === '/issues/5/labels' && c.body.labels.includes('needs-review'));
const pat = l => l.calls.every(c => c.auth === 'Bearer PAT');

await caso('(f1) ok + lgtm vivo + sin REVIEW/NITS ⇒ marcador, DELETE lgtm, DELETE+POST needs-review por PAT', async () => {
  const l = await iii({ cands: [C], resultados: OK, live: { labels: ['lgtm'] }, comments: [{ body: 'LGTM\n\nbien' }] });
  const b = post(l);
  return (b.length === 1 && b[0].includes(`<!-- watchdog-rebase-append: ${SHA} -->`) && !b[0].includes('<!-- watchdog-rebase -->')
    && has(l, 'DELETE', '/issues/5/labels/lgtm') && has(l, 'DELETE', '/issues/5/labels/needs-review') && addNR(l) && pat(l)) || j(l);
});
await caso('(f2) ok + lgtm + último veredicto REVIEW ⇒ DELETE lgtm, ninguna needs-review', async () => {
  const l = await iii({ cands: [C], resultados: OK, live: { labels: ['lgtm'] }, comments: [{ body: 'LGTM' }, { body: 'REVIEW\n@claude arregla' }] });
  return (post(l).length === 1 && has(l, 'DELETE', '/issues/5/labels/lgtm') && !addNR(l)) || j(l);
});
await caso('(f3) ok + draft ⇒ solo comentario', async () => {
  const l = await iii({ cands: [C], resultados: OK, live: { draft: true } });
  return (post(l).length === 1 && l.calls.length === 1) || j(l);
});
await caso('(f4) ok sin lgtm, no draft ⇒ DELETE+POST needs-review', async () => {
  const l = await iii({ cands: [C], resultados: OK, live: {} });
  return (post(l).length === 1 && !has(l, 'DELETE', '/issues/5/labels/lgtm') && has(l, 'DELETE', '/issues/5/labels/needs-review') && addNR(l)) || j(l);
});
await caso('(f5) labels del scan ≠ vivas: lgtm ya retirada en vivo ⇒ no se DELETEa lgtm', async () => {
  const l = await iii({ cands: [{ ...C, labels: ['lgtm'] }], resultados: OK, live: { labels: [] } });
  return (!has(l, 'DELETE', '/issues/5/labels/lgtm') && addNR(l)) || j(l);
});
for (const na of ['sin-config', 'workflows-en-base', 'varios-conflictos', 'fuera-del-registro', 'no-append', 'merge-error', 'modulo-ausente', 'checkout-fallido', 'push-rechazado']) {
  await caso(`(f6) na ${na} ⇒ ping LLM con REBASE_MARK, ping-creator, línea -na y cap rebases+1`, async () => {
    const l = await iii({ cands: [{ ...C, rebases: 1 }], resultados: { 5: { ok: false, na } }, live: { labels: ['lgtm'] } });
    const b = post(l);
    return (b.length === 1 && l.calls.length === 1 && /^<!-- watchdog-rebase -->\n@claude rebasa esta rama sobre `origin\/main`/.test(b[0])
      && b[0].includes('<!-- ping-creator -->') && new RegExp(`^<!-- watchdog-rebase-append-na: ${na} -->$`, 'm').test(b[0])
      && l.notices.some(n => n.includes('2/2')) && pat(l)) || j(l);
  });
}
await caso('(f7) candidato sin entrada en resultados ⇒ na sin-resultado', async () => {
  const l = await iii({ cands: [C], resultados: { 99: { ok: true, sha: SHA } }, live: {} });
  return /^<!-- watchdog-rebase-append-na: sin-resultado -->$/m.test(post(l)[0] || '') || j(l);
});
await caso('(f8) output resultados vacío (step (ii) muerto/skipped) ⇒ na sin-resultado', async () => {
  const l = await iii({ cands: [C], resultados: null, live: {} });
  return /^<!-- watchdog-rebase-append-na: sin-resultado -->$/m.test(post(l)[0] || '') || j(l);
});
await caso('(f9) marcador con el mismo sha ya presente ⇒ no-op total', async () => {
  const l = await iii({ cands: [C], resultados: OK, live: { labels: ['lgtm'] }, comments: [{ body: `x\n<!-- watchdog-rebase-append: ${SHA} -->` }] });
  return l.calls.length === 0 || j(l);
});
await caso('(f10) el marcador append no cuenta para el tope de watchdog-rebase', async () =>
  !`<!-- watchdog-rebase-append: ${SHA} -->`.includes('<!-- watchdog-rebase -->') && !'<!-- watchdog-rebase-append-na: x -->'.includes('<!-- watchdog-rebase -->'));

await caso('(f11) candidato `materializar` (red del scan) sin resultados ⇒ marcador del sha del HEAD, sin ping LLM', async () => {
  const l = await iii({ cands: [{ ...C, materializar: SHA }], resultados: null, live: { labels: ['lgtm'] } });
  const b = post(l);
  return (b.length === 1 && b[0].includes(`<!-- watchdog-rebase-append: ${SHA} -->`) && !b[0].includes('<!-- watchdog-rebase -->')
    && b[0].includes('Materialización tardía') && has(l, 'DELETE', '/issues/5/labels/lgtm') && addNR(l)) || j(l);
});

// ── (j) gate REAL de epic-merge tras un merge mecánico ──────────────────────
const emWf = yaml.load(readFileSync('.github/workflows/epic-merge.yml', 'utf8'));
let emStep = null;
for (const job of Object.values(emWf.jobs || {})) for (const s of job.steps || []) if (s.name === 'Evaluar y mergear') emStep = s;
if (!emStep) { console.error('check-adr-append-merge ROJO: step «Evaluar y mergear» no encontrado en epic-merge.yml'); process.exit(1); }
const epicMerge = cargarStep(emStep.with.script, 'epic-merge');
const EM_WS = mkdtempSync(join(tmpdir(), 'aam-em-'));
symlinkSync(process.cwd(), join(EM_WS, '.epic-merge-central'));
const REV = 'talfarouriarte-cloud';
const T = min => new Date(Date.parse('2026-11-01T12:00:00Z') + min * 60000).toISOString();
const SUBJ = `merge(registro): append-only de ${ADR} (watchdog, AP-130)`;
const cm = (msg, min) => ({ sha: 's' + min, commit: { message: msg, committer: { date: T(min) } } });
const vd = (v, min) => ({ id: min, body: `${v}\nok`, user: { login: REV }, created_at: T(min) });
const marcaAppend = min => ({ id: 1000 + min, body: `**watchdog · merge append-only**\n\n<!-- watchdog-rebase-append: ${SHA} -->`, user: { login: REV }, created_at: T(min) });
async function gateEM({ comments = [], commits = [], labels = ['lgtm', 'ci-verde'] } = {}) {
  const w = { merged: false, diags: [] };
  const pr = { number: 50, state: 'open', merged: false, draft: false, title: 'feat: algo', body: 'Refs #40', head: { ref: 'claude/issue-40-x', sha: 'h1' }, base: { ref: 'main', sha: 'b0' }, labels: labels.map(name => ({ name })) };
  const conocidos = {
    issues: {
      get: async p => ({ data: p.issue_number === 40 ? { number: 40, state: 'open', title: 'Issue 40', body: '', labels: [{ name: 'epica' }] } : { number: p.issue_number, labels: [], body: '' } }),
      listComments: async p => ({ data: p.issue_number === 50 ? comments : [] }),
      createComment: async p => { w.diags.push(p.body); return { data: { id: 1 } }; },
    },
    pulls: {
      get: async () => ({ data: { ...pr, mergeable_state: 'clean' } }),
      listCommits: async () => ({ data: commits }),
      merge: async () => { w.merged = true; return { data: {} }; },
    },
    users: { getAuthenticated: async () => ({ data: { login: REV } }) },
  };
  const vacio = async () => ({ data: [] });
  const rest = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (_, m) => (conocidos[ns] && conocidos[ns][m]) || vacio }) });
  const github = { rest, paginate: async (fn, p) => { const r = await fn(p); return Array.isArray(r.data) ? r.data : []; } };
  const fetch = async (url, o) => { if (o && o.body) w.diags.push(String(o.body)); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
  const core = { setOutput() {}, notice() {}, info: m => w.diags.push(String(m)), warning() {}, setFailed() {} };
  await epicMerge({ github, context: { repo: { owner: 'o', repo: 'r' }, runId: 1, eventName: 'pull_request', payload: { action: 'labeled', label: { name: 'lgtm' }, pull_request: pr } }, core },
    { env: { GITHUB_WORKSPACE: EM_WS, IN_AUTOMERGE: 'true', IN_EPIC_LABEL: 'epica', IN_CI_WORKFLOW_NAME: 'CI', STATUS_TOKEN: 'job', IN_LOOSE_AUDIT: 'false',
      IN_PARTIAL_ROUND_CAP: '3', IN_PARTIAL_LIFETIME_CAP: '6', IN_DEFAULT_BRANCH: 'main' }, globales: { fetch } });
  return w;
}
await caso('(j0) control: sin merge mecánico, label lgtm ⇒ mergea (el doble llega al merge)', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0)], commits: [cm('feat', -5)] });
  return w.merged || j(w);
});
await caso('(j0b) control: sin merge mecánico ni label, LGTM por comentario (respaldo de GATE 2) ⇒ mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0)], commits: [cm('feat', -5)], labels: ['ci-verde'] });
  return w.merged || j(w);
});
await caso('(j1) merge mecánico + marcador, sin label, LGTM solo ANTERIOR (respaldo de GATE 2) ⇒ NO mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), marcaAppend(11)], commits: [cm('feat', -5), cm(SUBJ, 10)], labels: ['ci-verde'] });
  return !w.merged || j(w);
});
await caso('(j2) merge mecánico SIN marcador (iii no terminó), sin label, LGTM anterior ⇒ NO mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0)], commits: [cm('feat', -5), cm(SUBJ, 10)], labels: ['ci-verde'] });
  return !w.merged || j(w);
});
await caso('(j3) label `lgtm` superviviente (DELETE fallido) con LGTM anterior al merge mecánico ⇒ NO mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), marcaAppend(11)], commits: [cm(SUBJ, 10)] });
  return !w.merged || j(w);
});
await caso('(j4) LGTM POSTERIOR al merge mecánico y al marcador ⇒ mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), marcaAppend(11), vd('LGTM', 30)], commits: [cm(SUBJ, 10)] });
  return w.merged || j(w);
});
await caso('(j5) REVIEW posterior al merge mecánico ⇒ NO mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), marcaAppend(11), vd('REVIEW', 30)], commits: [cm(SUBJ, 10)], labels: ['ci-verde'] });
  return !w.merged || j(w);
});

// ── (k) red por estado del scan ─────────────────────────────────────────────
const scanRun = cargarStep(steps.find(s => s.id === 'scan').with.script, 'scan');
const SC_WS = mkdtempSync(join(tmpdir(), 'aam-wd-'));
symlinkSync(process.cwd(), join(SC_WS, '.cola-central'));
async function scanRed({ msg, comments = [] }) {
  const out = {};
  const HEAD = 'feedbeef0000';
  const pr = { number: 5, title: 'x', body: '', draft: false, head: { ref: HEAD_REF, sha: HEAD }, base: { ref: 'main' }, labels: [], created_at: T(-60), updated_at: T(-60), user: { login: 'claude[bot]' } };
  const conocidos = {
    pulls: { list: async () => ({ data: [pr] }), get: async () => ({ data: { ...pr, mergeable: true, mergeable_state: 'clean' } }) },
    repos: { getCommit: async p => ({ data: { sha: p.ref, commit: { message: p.ref === HEAD ? msg : 'x', committer: { date: T(-30) } } } }) },
    issues: { listComments: async p => ({ data: p.issue_number === 5 ? comments : [] }) },
    actions: { listWorkflowRunsForRepo: async () => ({ data: { workflow_runs: [] } }), listJobsForWorkflowRun: async () => ({ data: { total_count: 0, jobs: [] } }) },
  };
  const vacio = async () => ({ data: [] });
  const rest = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (_, m) => (conocidos[ns] && conocidos[ns][m]) || vacio }) });
  const github = { rest, paginate: async (fn, p) => { const r = await fn(p); return Array.isArray(r.data) ? r.data : (r.data && (r.data.workflow_runs || r.data.items)) || []; } };
  const fetch = async () => ({ ok: true, status: 200, json: async () => ([]), text: async () => '' });
  const core = { setOutput: (k, v) => { out[k] = String(v); }, notice() {}, warning() {}, info() {} };
  await scanRun({ github, context: { repo: { owner: 'o', repo: 'r' }, eventName: 'schedule', payload: {}, runId: 1 }, core },
    { env: { GITHUB_WORKSPACE: SC_WS, STATUS_TOKEN: 'x', ARM_PAT: 'x', IN_CREATOR_WF: 'Claude Code', IN_REVIEWER_WF: 'Opus Reviewer', IN_CI_WF: 'CI',
      IN_EPIC_MERGE_WF: 'Epic merge', IN_EXTRA_WFS: '', IN_LOOKBACK_MIN: '45', IN_SKIP_LABELS: 'human-needed,pause-agents', IN_AUTOMERGE: 'true', IN_DEFAULT_BRANCH: 'main' },
      globales: { fetch } });
  return { cands: JSON.parse(out.adr_append || 'null'), HEAD };
}
await caso('(k1) HEAD = merge mecánico sin marcador ⇒ candidato `materializar` con el sha del HEAD', async () => {
  const { cands, HEAD } = await scanRed({ msg: `${SUBJ}\n` });
  return (Array.isArray(cands) && cands.length === 1 && cands[0].number === 5 && cands[0].materializar === HEAD) || j(cands);
});
await caso('(k2) HEAD = merge mecánico CON su marcador ⇒ sin candidato', async () => {
  const { cands } = await scanRed({ msg: SUBJ, comments: [{ body: '<!-- watchdog-rebase-append: feedbeef0000 -->', user: { login: REV }, created_at: T(-20) }] });
  return (Array.isArray(cands) && cands.length === 0) || j(cands);
});
await caso('(k3) HEAD normal ⇒ sin candidato', async () => {
  const { cands } = await scanRed({ msg: 'feat: algo' });
  return (Array.isArray(cands) && cands.length === 0) || j(cands);
});

// ── (i) costura del scan y de los steps ─────────────────────────────────────
await caso('(i) el modo PR-dirty entrega candidatos y no publica el ping; steps nuevos tras el scan', async () => {
  const scan = steps.find(s => s.id === 'scan').with.script;
  const dirty = scan.slice(scan.indexOf("prFull.mergeable_state === 'dirty'"), scan.indexOf('pr-dirty-persistent'));
  const iScan = steps.findIndex(s => s.id === 'scan');
  const iCo = steps.findIndex(s => s.name === 'Checkout del consumidor (merge append-only, AP-130)');
  const iMg = steps.findIndex(s => s.id === 'adr_append');
  const iMat = steps.indexOf(st);
  const mg = steps[iMg] || {};
  return (dirty.includes('adrAppend.push(') && !dirty.includes('@claude') && /core\.setOutput\('adr_append', '\[\]'\)/.test(scan)
    && iScan < iCo && iCo < iMg && iMg < iMat && steps[iCo]['continue-on-error'] === true && mg['continue-on-error'] === true
    && /^always\(\) && /.test(st.if) && /trap .*resultados=/.test(mg.run) && mg.run.includes('vendored/scripts/adr-append-merge.mjs')
    && mg.run.includes('if (!c.materializar)'))
    || j({ iScan, iCo, iMg, iMat });
});

if (fallos.length) {
  console.error(`check-adr-append-merge ROJO (${fallos.length}/${casos}):`);
  for (const f of fallos) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-adr-append-merge verde: ${casos} casos sobre vendored/scripts/adr-append-merge.mjs, el step «Materializar rebase append-only» y la red por estado del scan de watchdog.yml, y GATE 2 de epic-merge.yml (AP-130).`);
