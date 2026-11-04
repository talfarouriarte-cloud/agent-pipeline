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
//   (AP142-*): central#418, ruling 2026-11-04 posición 21 + enmienda E1 —
//   inserción común en CHANGELOG, varios ficheros, `sin-config` tras ver los
//   conflictos, filtro (v) `esContendiente`/`libreDeContendiente` (fail-closed),
//   escaneo delante del Gate 0 (`soloMecanico`, `final`) con el scan REAL y
//   «Materializar» sin ping LLM con `soloMecanico` y con merge al final (E1).
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
    && ancestro && j(r.rutas) === j([ADR]) && /^merge\(registro\): append-only de .* \(watchdog, AP-\d+\)$/.test(msg) && limpio(repo))
    || j({ r, padres, prSha, baseSha, contenido, ancestro, msg });
});

await caso('(b) conflicto en medio del ADR ⇒ na no-append, árbol limpio, sin commit', async () => {
  const { repo, prSha } = escenario({ ancestro: { ...CFG_DIR, [ADR]: ANC }, pr: { [ADR]: ANC.replace('Texto.', 'Texto PR.') + BLOQ_PR }, base: { [ADR]: ANC.replace('Texto.', 'Texto base.') + BLOQ_BASE } });
  const r = correrMod(repo);
  return (r.ok === false && r.na === 'no-append' && limpio(repo) && git(repo, 'rev-parse', 'HEAD') === prSha) || j(r);
});

await caso('(c) conflicto en el ADR y en otro fichero ⇒ na fuera-del-registro (AP-142: ya no varios-conflictos)', async () => {
  const { repo, prSha } = escenario({
    ancestro: { ...CFG_DIR, [ADR]: ANC, 'src/a.txt': 'uno\n' },
    pr: { [ADR]: ANC + BLOQ_PR, 'src/a.txt': 'dos\n' },
    base: { [ADR]: ANC + BLOQ_BASE, 'src/a.txt': 'tres\n' } });
  const r = correrMod(repo);
  return (r.ok === false && r.na === 'fuera-del-registro' && r.detalle === 'src/a.txt' && limpio(repo) && git(repo, 'rev-parse', 'HEAD') === prSha) || j(r);
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

// ── AP-142 (central#418): inserción común en CHANGELOG y varios ficheros ─────
const L = a => a.join('\n') + '\n';
const CL = 'packages/app/CHANGELOG.md';
const CL_ANC = L(['# Changelog', '', '## [Unreleased]', '', '## [1.2.0]', '- viejo']);
const CL_PR = L(['# Changelog', '', '## [Unreleased]', '', '### PR', '- x', '', '## [1.2.0]', '- viejo']);
const CL_BASE = L(['# Changelog', '', '## [Unreleased]', '', '### Base', '- y', '', '## [1.2.0]', '- viejo']);
const CL_ESP = L(['# Changelog', '', '## [Unreleased]', '', '### PR', '- x', '', '### Base', '- y', '', '## [1.2.0]', '- viejo']);
await caso('(AP142-a) resolverInsercionComun: bloques bajo [Unreleased] con líneas en blanco junto a la inserción ⇒ P + X(PR) + Y(base) + S', async () => {
  const { resolverInsercionComun } = await import(MOD);
  const r = resolverInsercionComun({ ancestro: CL_ANC, ours: CL_PR, theirs: CL_BASE });
  return r === CL_ESP || j(r);
});
await caso('(AP142-a) repo real · CHANGELOG con config ⇒ ok, rutas [CHANGELOG], contenido esperado, modo insercion', async () => {
  const { repo, prSha, baseSha } = escenario({ ancestro: { ...CFG_DIR, [CL]: CL_ANC }, pr: { [CL]: CL_PR }, base: { [CL]: CL_BASE } });
  const r = correrMod(repo);
  const padres = r.ok ? git(repo, 'rev-list', '--parents', '-n', '1', r.sha).split(' ').slice(1) : [];
  return (r.ok && j(r.rutas) === j([CL]) && r.resueltas[0].modo === 'insercion' && readFileSync(join(repo, CL), 'utf8') === CL_ESP
    && padres[0] === prSha && padres[1] === baseSha && limpio(repo)) || j(r);
});
await caso("(AP142-a') sin adr-lint.config.json, el mismo CHANGELOG ⇒ ok: true", async () => {
  const { repo } = escenario({ ancestro: { [CL]: CL_ANC }, pr: { [CL]: CL_PR }, base: { [CL]: CL_BASE } });
  const r = correrMod(repo);
  return (r.ok && readFileSync(join(repo, CL), 'utf8') === CL_ESP) || j(r);
});
await caso('(AP142-b) CHANGELOG donde la base cambia una línea del ancestro ⇒ resolverInsercionComun null; repo ⇒ no-append', async () => {
  const { resolverInsercionComun } = await import(MOD);
  const base2 = CL_BASE.replace('- viejo', '- viejo (corregido)');
  const pura = resolverInsercionComun({ ancestro: CL_ANC, ours: CL_PR, theirs: base2 });
  const { repo, prSha } = escenario({ ancestro: { ...CFG_DIR, [CL]: CL_ANC }, pr: { [CL]: CL_PR.replace('- viejo', '- viejo PR') }, base: { [CL]: base2 } });
  const r = correrMod(repo);
  return (pura === null && r.ok === false && r.na === 'no-append' && r.detalle === CL && limpio(repo) && git(repo, 'rev-parse', 'HEAD') === prSha) || j({ pura, r });
});
await caso('(AP142-b2) resolverInsercionComun: borrado de una línea del ancestro o add/add ⇒ null', async () => {
  const { resolverInsercionComun } = await import(MOD);
  const borra = resolverInsercionComun({ ancestro: CL_ANC, ours: CL_PR, theirs: CL_BASE.replace('- viejo\n', '') });
  const addadd = resolverInsercionComun({ ancestro: null, ours: CL_PR, theirs: CL_BASE });
  return (borra === null && addadd === null) || j({ borra, addadd });
});
await caso('(AP142-c) dos conflictos (CHANGELOG + registro), los dos resolubles ⇒ ok, rutas de longitud 2, asunto con las dos rutas', async () => {
  const { repo } = escenario({ ancestro: { ...CFG_DIR, [ADR]: ANC, [CL]: CL_ANC }, pr: { [ADR]: ANC + BLOQ_PR, [CL]: CL_PR }, base: { [ADR]: ANC + BLOQ_BASE, [CL]: CL_BASE } });
  const r = correrMod(repo);
  const msg = r.ok ? git(repo, 'log', '-1', '--format=%s', r.sha) : '';
  return (r.ok && r.rutas.length === 2 && r.rutas.includes(ADR) && r.rutas.includes(CL)
    && readFileSync(join(repo, ADR), 'utf8') === ANC + BLOQ_BASE + BLOQ_PR && readFileSync(join(repo, CL), 'utf8') === CL_ESP
    && /^merge\(registro\): append-only de .+, .+ \(watchdog, AP-\d+\)$/.test(msg) && limpio(repo)) || j({ r, msg });
});
await caso('(AP142-d) CHANGELOG + un .ts en conflicto ⇒ na fuera-del-registro con la ruta del .ts, sin commit', async () => {
  const { repo, prSha } = escenario({ ancestro: { ...CFG_DIR, [CL]: CL_ANC, 'src/a.ts': 'uno\n' }, pr: { [CL]: CL_PR, 'src/a.ts': 'dos\n' }, base: { [CL]: CL_BASE, 'src/a.ts': 'tres\n' } });
  const r = correrMod(repo);
  return (r.ok === false && r.na === 'fuera-del-registro' && r.detalle === 'src/a.ts' && limpio(repo) && git(repo, 'rev-parse', 'HEAD') === prSha) || j(r);
});
await caso('(AP142-d2) MOTIVOS ya no tiene varios-conflictos y conserva sin-config', async () => {
  const { MOTIVOS } = await import(MOD);
  return (!MOTIVOS.includes('varios-conflictos') && MOTIVOS.includes('sin-config')) || j(MOTIVOS);
});

// ── AP-142 punto 3 (v): esContendiente (AP-100 §1) y libreDeContendiente ─────
const PR_V = { number: 5, title: 'feat: algo', head: { ref: HEAD_REF } };
const TIT = new Set(['feat: algo', 'Issue 1']);
await caso('(AP142-f) run con display_title = título del PR ⇒ contendiente', async () => {
  const { esContendiente } = await import(MOD);
  return esContendiente({ run: { display_title: 'feat: algo', head_branch: 'main' }, titles: TIT, branch: HEAD_REF }) === true;
});
await caso("(AP142-g) run de pull_request_review con display_title 'otro título' y head_branch = rama ⇒ contendiente", async () => {
  const { esContendiente } = await import(MOD);
  return esContendiente({ run: { event: 'pull_request_review', display_title: 'otro título', head_branch: HEAD_REF }, titles: TIT, branch: HEAD_REF }) === true;
});
await caso('(AP142-h) run con el título del issue de la rama ⇒ contendiente', async () => {
  const { esContendiente } = await import(MOD);
  return esContendiente({ run: { display_title: 'Issue 1', head_branch: 'main' }, titles: TIT, branch: HEAD_REF }) === true;
});
await caso('(AP142-i) run sin coincidencias ⇒ no', async () => {
  const { esContendiente } = await import(MOD);
  return esContendiente({ run: { display_title: 'otra cosa', head_branch: 'main' }, titles: TIT, branch: HEAD_REF }) === false;
});
const AHORA = Date.parse('2026-11-04T12:00:00Z');
const hace = min => new Date(AHORA - min * 60000).toISOString();
const libre = async o => (await import(MOD)).libreDeContendiente({ pr: PR_V, creatorWf: 'Claude Code', ahoraMs: AHORA,
  leerIssue: async () => 'Issue 1', listarRuns: async () => [], contarJobs: async () => 1, ...o });
await caso('(AP142-v1) sin runs ⇒ libre', async () => (await libre({})).libre === true);
await caso('(AP142-v2) FAIL-CLOSED: runs ilegibles ⇒ no es candidato', async () => {
  const r = await libre({ listarRuns: async () => { throw new Error('HTTP 502'); } });
  return (r.libre === false && /ilegibles/.test(r.motivo)) || j(r);
});
await caso('(AP142-v3) FAIL-CLOSED: issue de la rama ilegible ⇒ no es candidato', async () => {
  const r = await libre({ leerIssue: async () => { throw new Error('HTTP 404'); } });
  return (r.libre === false && /ilegible/.test(r.motivo)) || j(r);
});
await caso('(AP142-v4) Creator in_progress con el título del issue de la rama ⇒ no libre; de otro workflow o de otro ítem ⇒ libre', async () => {
  const run = (o) => ({ id: 9, name: 'Claude Code', display_title: 'Issue 1', head_branch: 'main', created_at: hace(3), ...o });
  const a = await libre({ listarRuns: async st => (st === 'in_progress' ? [run()] : []) });
  const b = await libre({ listarRuns: async st => (st === 'in_progress' ? [run({ name: 'CI' })] : []) });
  const c = await libre({ listarRuns: async st => (st === 'in_progress' ? [run({ display_title: 'otro' })] : []) });
  return (a.libre === false && b.libre === true && c.libre === true) || j({ a, b, c });
});
await caso('(AP142-v5) queued: cascarón (0 jobs, > gracia) ⇒ libre; con jobs, en gracia o jobs ilegibles ⇒ no libre', async () => {
  const q = (o) => ({ id: 9, name: 'Claude Code', display_title: 'feat: algo', head_branch: 'main', created_at: hace(10), ...o });
  const lr = r => async st => (st === 'queued' ? [r] : []);
  const cascaron = await libre({ listarRuns: lr(q()), contarJobs: async () => 0 });
  const conJobs = await libre({ listarRuns: lr(q()), contarJobs: async () => 1 });
  const gracia = await libre({ listarRuns: lr(q({ created_at: hace(1) })), contarJobs: async () => 0 });
  const ilegible = await libre({ listarRuns: lr(q()), contarJobs: async () => { throw new Error('x'); } });
  return (cascaron.libre && !conJobs.libre && !gracia.libre && !ilegible.libre) || j({ cascaron, conJobs, gracia, ilegible });
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

function doble({ live = {}, comments = [], fallaMerge = false } = {}) {
  const log = { calls: [], warnings: [], notices: [] };
  const github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      issues: { listComments: async () => ({ data: comments }) },
      pulls: { get: async () => ({ data: { draft: !!live.draft, labels: (live.labels || []).map(name => ({ name })) } }) },
    },
  };
  const core = { info() {}, notice: m => log.notices.push(m), warning: m => log.warnings.push(m), setOutput() {} };
  const fetch = async (url, o) => {
    const path = url.replace(/^https:\/\/api\.github\.com\/repos\/o\/r/, '');
    log.calls.push({ method: o.method, path, body: o.body ? JSON.parse(o.body) : null, auth: o.headers.Authorization });
    if (fallaMerge && o.method === 'PUT' && /\/merge$/.test(path)) return { ok: false, status: 405 };
    return { ok: true, status: 200 };
  };
  return { github, core, fetch, log };
}
async function iii({ cands, resultados, live, comments, fallaMerge }) {
  const d = doble({ live, comments, fallaMerge });
  const env = { ARM_PAT: 'PAT', CANDS: j(cands), RESULTADOS: resultados == null ? '' : j(resultados), IN_DEFAULT_BRANCH: 'main' };
  await run({ github: d.github, context: { repo: { owner: 'o', repo: 'r' }, eventName: 'schedule' }, core: d.core, require }, { env, globales: { fetch: d.fetch } });
  return d.log;
}
const C = { number: 5, head_ref: HEAD_REF, head_sha: 'x', rebases: 0 };
const OK = { 5: { ok: true, sha: SHA, rutas: [ADR], resueltas: [{ ruta: ADR, modo: 'append' }] } };
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
for (const na of ['sin-config', 'workflows-en-base', 'fuera-del-registro', 'no-append', 'merge-error', 'modulo-ausente', 'checkout-fallido', 'push-rechazado']) {
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
await caso('(f9b) solo una CITA del marcador entre backticks ⇒ NO es no-op (materializa)', async () => {
  const l = await iii({ cands: [C], resultados: OK, live: { labels: ['lgtm'] }, comments: [{ body: `ver \`<!-- watchdog-rebase-append: ${SHA} -->\`` }] });
  return l.calls.length > 0 || j(l);
});
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

// ── AP-142: «Materializar» con `soloMecanico` y con merge al final (E1) ───────
const MEC_MARK = { body: `x\n\n<!-- watchdog-merge-mecanico: ${SHA.padEnd(40, '0')} revisado=${'1'.repeat(40)} -->`, user: { login: 'talfarouriarte-cloud' } };
const SHA40 = SHA.padEnd(40, '0');
const OK40 = { 5: { ok: true, sha: SHA40, rutas: [ADR, CL], resueltas: [{ ruta: ADR, modo: 'append' }, { ruta: CL, modo: 'insercion' }] } };
for (const na of ['no-append', 'fuera-del-registro', 'push-rechazado', 'sin-resultado']) {
  await caso(`(AP142-m1) soloMecanico + na ${na} ⇒ sin ping LLM ni ninguna escritura`, async () => {
    const l = await iii({ cands: [{ ...C, soloMecanico: true }], resultados: na === 'sin-resultado' ? null : { 5: { ok: false, na } }, live: { labels: ['lgtm'] } });
    return (l.calls.length === 0 && l.notices.some(n => n.includes('sin ping LLM'))) || j(l);
  });
}
await caso('(AP142-m2) soloMecanico + ok sin marcador mecánico ⇒ materializa como hoy (lgtm retirada, needs-review)', async () => {
  const l = await iii({ cands: [{ ...C, soloMecanico: true }], resultados: OK, live: { labels: ['lgtm'] } });
  return (post(l).length === 1 && has(l, 'DELETE', '/issues/5/labels/lgtm') && addNR(l)) || j(l);
});
await caso('(AP142-m3) E1: ok + marcador watchdog-merge-mecanico de M (PAT) ⇒ sin tocar labels, PUT merge squash con sha M por PAT, texto por ruta', async () => {
  const l = await iii({ cands: [{ ...C, final: true, soloMecanico: true }], resultados: OK40, live: { labels: ['lgtm', 'ci-verde'] }, comments: [MEC_MARK] });
  const b = post(l), m = l.calls.find(c => c.method === 'PUT' && c.path === '/pulls/5/merge');
  return (b.length === 1 && b[0].includes(`<!-- watchdog-rebase-append: ${SHA40} -->`) && b[0].includes('append al final: base + PR')
    && b[0].includes('inserción en el mismo punto: PR encima de base') && !l.calls.some(c => /labels/.test(c.path))
    && m && m.body.merge_method === 'squash' && m.body.sha === SHA40 && pat(l)
    && l.calls.findIndex(c => c.method === 'POST') < l.calls.indexOf(m)) || j(l);
});
await caso('(AP142-m4) E1: marcador de un autor no de confianza ⇒ sin merge al final (camino de hoy)', async () => {
  const l = await iii({ cands: [C], resultados: OK40, live: { labels: ['lgtm', 'ci-verde'] }, comments: [{ ...MEC_MARK, user: { login: 'claude[bot]' } }] });
  return (!l.calls.some(c => c.method === 'PUT') && has(l, 'DELETE', '/issues/5/labels/lgtm')) || j(l);
});
await caso('(AP142-m5) E1: pulls.merge falla ⇒ diag con el error, sin reintento, labels intactas', async () => {
  const l = await iii({ cands: [{ ...C, final: true }], resultados: OK40, live: { labels: ['lgtm', 'ci-verde'] }, comments: [MEC_MARK], fallaMerge: true });
  const b = post(l);
  return (b.length === 2 && /diag \(AP-142 E1\)/.test(b[1]) && /HTTP 405/.test(b[1]) && l.calls.filter(c => c.method === 'PUT').length === 1
    && !l.calls.some(c => /labels/.test(c.path))) || j(l);
});
await caso('(AP142-m6) E1 en la red por estado: candidato materializar con marcador mecánico ⇒ merge al final', async () => {
  const l = await iii({ cands: [{ ...C, materializar: SHA40 }], resultados: null, live: { labels: ['lgtm', 'ci-verde'] }, comments: [MEC_MARK] });
  return (l.calls.some(c => c.method === 'PUT' && c.body.sha === SHA40) && !l.calls.some(c => /labels/.test(c.path))) || j(l);
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
// AP-139 (central#408): GATE 2 ya no tiene respaldo por comentarios. El LGTM vale
// por el SHA revisado (`reviewer-lgtm-sha`, autor PAT): head = ese SHA con `lgtm`,
// o head alcanzable desde él solo por merges `web-flow`. El merge append-only lo
// commitea `github-actions[bot]` (no `web-flow`): cambia el head y deja el LGTM
// anterior sin valor (AP-130 §3 por construcción).
const PREV_J = 'b2'.repeat(20);   // head revisado antes del merge mecánico
const HEAD_J = 'a1'.repeat(20);   // head vivo del PR
const cm = (msg, min, { sha = HEAD_J, parents = [PREV_J, 'c3'.repeat(20)], login = 'github-actions[bot]' } = {}) =>
  ({ sha, parents: parents.map(x => ({ sha: x })), committer: { login }, commit: { message: msg, committer: { date: T(min) } } });
const feat = (min) => cm('feat', min, { sha: PREV_J, parents: ['d4'.repeat(20)], login: 'claude[bot]' });
const vd = (v, min) => ({ id: min, body: `${v}\nok`, user: { login: REV }, created_at: T(min) });
const mk = (sha, min) => ({ id: 2000 + min, body: `**reviewer · \`lgtm\` materializado**\n\n<!-- reviewer-lgtm-sha: ${sha} -->`, user: { login: REV }, created_at: T(min) });
const upd = (sha, min) => ({ id: 3000 + min, body: `x\n\n<!-- epic-merge-update-branch: ${sha} -->`, user: { login: REV }, created_at: T(min) });
const marcaAppend = min => ({ id: 1000 + min, body: `**watchdog · merge append-only**\n\n<!-- watchdog-rebase-append: ${SHA} -->`, user: { login: REV }, created_at: T(min) });
async function gateEM({ comments = [], commits = [], labels = ['lgtm', 'ci-verde'], estado = 'clean', updateFalla = false } = {}) {
  const w = { merged: false, diags: [], orden: [], borrados: [] };
  const pr = { number: 50, state: 'open', merged: false, draft: false, title: 'feat: algo', body: 'Refs #40', head: { ref: 'claude/issue-40-x', sha: HEAD_J }, base: { ref: 'main', sha: 'b0' }, labels: labels.map(name => ({ name })) };
  const conocidos = {
    issues: {
      get: async p => ({ data: p.issue_number === 40 ? { number: 40, state: 'open', title: 'Issue 40', body: '', labels: [{ name: 'epica' }] } : { number: p.issue_number, labels: [], body: '' } }),
      listComments: async p => ({ data: p.issue_number === 50 ? comments : [] }),
      createComment: async p => { w.diags.push(p.body); w.orden.push('comment:' + p.body); return { data: { id: 77 } }; },
      deleteComment: async p => { w.borrados.push(p.comment_id); return { data: {} }; },
    },
    pulls: {
      get: async () => ({ data: { ...pr, mergeable_state: estado } }),
      listCommits: async () => ({ data: commits }),
      updateBranch: async p => { w.orden.push('update:' + p.expected_head_sha); if (updateFalla) throw Object.assign(new Error('merge conflict'), { status: 422 }); return { data: {} }; },
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
await caso('(j0) control: sin merge mecánico, LGTM con SHA revisado = head y label lgtm ⇒ mergea (el doble llega al merge)', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(HEAD_J, 0)], commits: [feat(-5)] });
  return w.merged || j(w);
});
await caso('(j0b) sin merge mecánico ni label, LGTM por comentario con head = SHA revisado ⇒ NO mergea (GATE 2 sin respaldo, AP-139)', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(HEAD_J, 0)], commits: [feat(-5)], labels: ['ci-verde'] });
  return !w.merged || j(w);
});
await caso('(j1) merge mecánico + marcador, sin label, LGTM solo sobre el head ANTERIOR ⇒ NO mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(PREV_J, 0), marcaAppend(11)], commits: [feat(-5), cm(SUBJ, 10)], labels: ['ci-verde'] });
  return !w.merged || j(w);
});
await caso('(j2) merge mecánico SIN marcador (iii no terminó), sin label, LGTM anterior ⇒ NO mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(PREV_J, 0)], commits: [feat(-5), cm(SUBJ, 10)], labels: ['ci-verde'] });
  return !w.merged || j(w);
});
await caso('(j3) label `lgtm` superviviente (DELETE fallido) con LGTM anterior al merge mecánico ⇒ NO mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(PREV_J, 0), marcaAppend(11)], commits: [feat(-5), cm(SUBJ, 10)] });
  return !w.merged || j(w);
});
await caso('(j4) LGTM POSTERIOR al merge mecánico, con su SHA revisado = head ⇒ mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(PREV_J, 0), marcaAppend(11), vd('LGTM', 30), mk(HEAD_J, 30)], commits: [feat(-5), cm(SUBJ, 10)] });
  return w.merged || j(w);
});
await caso('(j5) REVIEW posterior al merge mecánico ⇒ NO mergea', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(PREV_J, 0), marcaAppend(11), vd('REVIEW', 30)], commits: [feat(-5), cm(SUBJ, 10)], labels: ['ci-verde'] });
  return !w.merged || j(w);
});

await caso('(j6) LGTM POSTERIOR que CITA el marcador (en línea propia y entre backticks) ⇒ mergea', async () => {
  const cita = { ...vd('LGTM', 30), body: `LGTM\n- marcador \`<!-- watchdog-rebase-append: ${SHA} -->\` presente\n<!-- watchdog-rebase-append: ${SHA} -->` };
  const w = await gateEM({ comments: [vd('LGTM', 0), marcaAppend(11), cita, mk(HEAD_J, 30)], commits: [feat(-5), cm(SUBJ, 10)] });
  return w.merged || j(w);
});
await caso('(j7) comentario no-veredicto que CITA el marcador entre backticks no estorba ⇒ el LGTM posterior con su SHA mergea', async () => {
  const nota = { id: 40, body: `nota: \`<!-- watchdog-rebase-append: ${SHA} -->\``, user: { login: REV }, created_at: T(40) };
  const w = await gateEM({ comments: [vd('LGTM', 0), marcaAppend(11), vd('LGTM', 30), mk(HEAD_J, 30), nota], commits: [feat(-5), cm(SUBJ, 10)] });
  return w.merged || j(w);
});
await caso('(j8) head = merge `web-flow` de `updateBranch` sobre el SHA revisado, sin label ⇒ mergea (AP-125 §3 por la cadena, AP-139)', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(PREV_J, 0), upd(PREV_J, 5)], commits: [feat(-5), cm('Merge branch main', 10, { login: 'web-flow' })], labels: ['ci-verde'] });
  return w.merged || j(w);
});
await caso('(j9) head `web-flow` sobre el SHA revisado + REVIEW posterior ⇒ NO mergea (crítica ronda 3, D)', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(PREV_J, 0), upd(PREV_J, 5), vd('REVIEW', 20)], commits: [feat(-5), cm('Merge branch main', 10, { login: 'web-flow' })], labels: ['ci-verde'] });
  return !w.merged || j(w);
});
await caso('(j10) head = merge `web-flow` SIN marcador de updateBranch de epic-merge («Resolve conflicts» web) ⇒ NO mergea (enmienda del Architect, punto 2)', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(PREV_J, 0)], commits: [feat(-5), cm('Merge branch main', 10, { login: 'web-flow' })], labels: ['ci-verde'] });
  return !w.merged || j(w);
});
await caso('(j11) rama `behind`: marcador `epic-merge-update-branch` del head ANTES de `updateBranch` (con `expected_head_sha`), sin merge', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(HEAD_J, 0)], commits: [feat(-5)], estado: 'behind' });
  const iM = w.orden.findIndex(x => x.includes(`<!-- epic-merge-update-branch: ${HEAD_J} -->`));
  const iU = w.orden.indexOf('update:' + HEAD_J);
  return (!w.merged && iM >= 0 && iU > iM && !w.borrados.length) || j(w.orden);
});
await caso('(j12) rama `behind` con `updateBranch` fallido ⇒ el marcador se borra', async () => {
  const w = await gateEM({ comments: [vd('LGTM', 0), mk(HEAD_J, 0)], commits: [feat(-5)], estado: 'behind', updateFalla: true });
  return (!w.merged && w.borrados.includes(77)) || j({ orden: w.orden, borrados: w.borrados });
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
await caso('(k4) HEAD = merge mecánico y solo una CITA del marcador entre backticks ⇒ candidato `materializar`', async () => {
  const { cands, HEAD } = await scanRed({ msg: SUBJ, comments: [{ body: 'ver `<!-- watchdog-rebase-append: feedbeef0000 -->`', user: { login: REV }, created_at: T(-20) }] });
  return (Array.isArray(cands) && cands.length === 1 && cands[0].materializar === HEAD) || j(cands);
});
await caso('(k3) HEAD normal ⇒ sin candidato', async () => {
  const { cands } = await scanRed({ msg: 'feat: algo' });
  return (Array.isArray(cands) && cands.length === 0) || j(cands);
});

// ── AP-142: el scan REAL delante del Gate 0 ───────────────────────────────────
async function scanDelante({ labels = ['lgtm', 'ci-verde'], runsCreator = [], ref = HEAD_REF, comments, issueFalla = false, sinModulo = false, estado = 'dirty' }) {
  const out = {};
  const H = 'f'.repeat(40);
  const pr = { number: 5, title: 'feat: algo', body: '', draft: false, head: { ref, sha: H }, base: { ref: 'main' }, labels: labels.map(name => ({ name })), created_at: T(-60), updated_at: T(-60), user: { login: 'claude[bot]' } };
  const ahora = new Date().toISOString();
  // Siempre un run del pipeline ajeno en vuelo ⇒ Gate 0 cerrado.
  const ajeno = { id: 1, name: 'CI', display_title: 'otro PR', head_branch: 'claude/issue-9-y', created_at: ahora, status: 'in_progress' };
  const cs = comments || [{ body: 'LGTM\n\nok', user: { login: REV }, created_at: T(-30) }, { body: `<!-- reviewer-lgtm-sha: ${H} -->`, user: { login: REV }, created_at: T(-30) }];
  const conocidos = {
    pulls: { list: async () => ({ data: [pr] }), get: async () => ({ data: { ...pr, mergeable: estado === 'dirty' ? false : true, mergeable_state: estado } }) },
    issues: { listComments: async p => ({ data: p.issue_number === 5 ? cs : [] }), get: async () => { if (issueFalla) throw new Error('HTTP 404'); return { data: { title: 'Issue 1' } }; } },
    actions: {
      listWorkflowRunsForRepo: async p => ({ data: { workflow_runs: p.status === 'in_progress' ? [ajeno, ...runsCreator.map(r => ({ created_at: ahora, ...r }))] : [] } }),
      listJobsForWorkflowRun: async () => ({ data: { total_count: 1, jobs: [] } }) },
  };
  const vacio = async () => ({ data: [] });
  const rest = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (_, m) => (conocidos[ns] && conocidos[ns][m]) || vacio }) });
  const github = { rest, paginate: async (fn, p) => { const r = await fn(p); return Array.isArray(r.data) ? r.data : (r.data && (r.data.workflow_runs || r.data.items)) || []; } };
  const fetch = async () => ({ ok: true, status: 200, json: async () => ([]), text: async () => '' });
  const warnings = [];
  const core = { setOutput: (k, v) => { out[k] = String(v); }, notice() {}, warning: m => warnings.push(String(m)), info() {} };
  await scanRun({ github, context: { repo: { owner: 'o', repo: 'r' }, eventName: 'schedule', payload: {}, runId: 1 }, core },
    { env: { GITHUB_WORKSPACE: sinModulo ? SC_SIN : SC_WS, STATUS_TOKEN: 'x', ARM_PAT: 'x', IN_CREATOR_WF: 'Claude Code', IN_REVIEWER_WF: 'Opus Reviewer', IN_CI_WF: 'CI',
      IN_EPIC_MERGE_WF: 'Epic merge', IN_EXTRA_WFS: '', IN_LOOKBACK_MIN: '45', IN_SKIP_LABELS: 'human-needed,pause-agents', IN_AUTOMERGE: 'true', IN_DEFAULT_BRANCH: 'main' },
      globales: { fetch } });
  return { cands: JSON.parse(out.adr_append || 'null'), warnings, H };
}
const SC_SIN = mkdtempSync(join(tmpdir(), 'aam-wd-sin-'));
await caso('(AP142-s1) Gate 0 cerrado · PR dirty con lgtm + ci-verde + LGTM vigente, sin contendiente ⇒ candidato soloMecanico con final', async () => {
  const { cands } = await scanDelante({});
  return (Array.isArray(cands) && cands.length === 1 && cands[0].number === 5 && cands[0].soloMecanico === true && cands[0].final === true) || j(cands);
});
await caso('(AP142-s2) Gate 0 cerrado · sin ci-verde ⇒ candidato soloMecanico sin final', async () => {
  const { cands } = await scanDelante({ labels: ['lgtm'] });
  return (cands.length === 1 && cands[0].soloMecanico && cands[0].final === false) || j(cands);
});
await caso('(AP142-s3) Gate 0 cerrado · sin lgtm, en hold, rama no claude/ o no dirty ⇒ sin candidatos', async () => {
  const a = await scanDelante({ labels: ['ci-verde'] });
  const b = await scanDelante({ labels: ['lgtm', 'pause-agents'] });
  const c = await scanDelante({ ref: 'feature/humano' });
  const d = await scanDelante({ estado: 'clean' });
  return [a, b, c, d].every(x => j(x.cands) === '[]') || j([a.cands, b.cands, c.cands, d.cands]);
});
await caso('(AP142-s4) Gate 0 cerrado · Creator vivo por título del PR, por issue de la rama o por head_branch ⇒ sin candidatos', async () => {
  const r1 = await scanDelante({ runsCreator: [{ id: 2, name: 'Claude Code', display_title: 'feat: algo', head_branch: 'main' }] });
  const r2 = await scanDelante({ runsCreator: [{ id: 3, name: 'Claude Code', display_title: 'Issue 1', head_branch: 'main' }] });
  const r3 = await scanDelante({ runsCreator: [{ id: 4, name: 'Claude Code', display_title: 'otro título', head_branch: HEAD_REF, event: 'pull_request_review' }] });
  return [r1, r2, r3].every(x => j(x.cands) === '[]') || j([r1.cands, r2.cands, r3.cands]);
});
await caso('(AP142-s5) Gate 0 cerrado · FAIL-CLOSED: issue de la rama ilegible o módulo ausente ⇒ sin candidatos (con aviso)', async () => {
  const a = await scanDelante({ issueFalla: true });
  const b = await scanDelante({ sinModulo: true });
  return (j(a.cands) === '[]' && j(b.cands) === '[]' && b.warnings.some(w => w.includes('merge-mecanico') && w.includes('fail-closed'))) || j([a.cands, b.cands, b.warnings]);
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
await caso('(AP142-costura) escaneo dirty ANTES del Gate 0 con (i)–(v) por el módulo; soloMecanico solo con el gate cerrado; el ping LLM lo excluye; marcador E1 antes del push', async () => {
  const scan = steps.find(s => s.id === 'scan').with.script;
  const iGate = scan.indexOf('// ── Gate 0:');
  const pre = scan.slice(scan.indexOf('// ── Merge mecánico DELANTE del Gate 0'), iGate);
  const cerrado = scan.slice(iGate, scan.indexOf('// ── Dispatcher de TURNO'));
  const mat = st.with.script;
  const mg = steps.find(s => s.id === 'adr_append').run;
  const fallos = [];
  if (!pre || iGate < 0) fallos.push('sin bloque delante del Gate 0');
  if (!pre.includes("pr.head.ref.startsWith('claude/')") || !pre.includes('skip(pr.labels)') || !pre.includes("labels.includes('lgtm')")) fallos.push('filtros (i)/(ii)/(iv)');
  if (!/mergeable_state !== 'dirty'/.test(pre) || !/rebases >= 2/.test(pre)) fallos.push('filtro (iii)');
  if (!/MM\.libreDeContendiente\(/.test(pre) || !/merge-mecanico\.cjs/.test(pre) || !/if \(!MM\) core\.warning/.test(pre)) fallos.push('(v) por el módulo, fail-closed sin él');
  if (!/GH\.lgtmVigente\(/.test(pre) || !pre.includes("labels.includes('ci-verde')") || !pre.includes('marcadosMecanico')) fallos.push('E1 final: lgtmVigente + ci-verde');
  if (!/soloMecanico: true/.test(cerrado) || !/core\.setOutput\('adr_append'/.test(cerrado)) fallos.push('gate cerrado sin output soloMecanico');
  if (/soloMecanico: true/.test(scan.slice(scan.indexOf('// ── Dispatcher de TURNO')))) fallos.push('soloMecanico también con el gate abierto');
  const iSolo = mat.indexOf('if (c.soloMecanico)'), iPing = mat.indexOf('${REBASE_MARK}\\n@claude');
  if (iSolo < 0 || iPing < 0 || iSolo > iPing) fallos.push('el ping LLM no excluye soloMecanico');
  const iMarca = mg.indexOf('watchdog-merge-mecanico: ${m} revisado=${h}'), iPush = mg.indexOf('git -C .repo push');
  if (iMarca < 0 || iPush < 0 || iMarca > iPush) fallos.push('marcador E1 no va antes del push');
  // El módulo implementa AP-100 §1 (título del PR, issue de la rama, head_branch).
  const mm = readFileSync('vendored/scripts/merge-mecanico.cjs', 'utf8');
  if (!/ts\.has\(run\.display_title\) \|\| \(!!branch && run\.head_branch === branch\)/.test(mm) || !/claude\\\/issue-\(\\d\+\)-/.test(mm)) fallos.push('merge-mecanico.cjs no implementa AP-100 §1');
  return fallos.length === 0 || j(fallos);
});

if (fallos.length) {
  console.error(`check-adr-append-merge ROJO (${fallos.length}/${casos}):`);
  for (const f of fallos) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-adr-append-merge verde: ${casos} casos sobre vendored/scripts/adr-append-merge.mjs, el step «Materializar rebase append-only» y la red por estado del scan de watchdog.yml, y GATE 2 de epic-merge.yml (AP-130).`);
