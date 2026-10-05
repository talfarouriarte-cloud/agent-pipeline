#!/usr/bin/env node
// check-arbol-rescate — banco del rescate del árbol sin pushear por estado
// (AP-101, central#300, ruling mensual 2026-10-05): step `rescate` («Push
// residual con token de workflows (post-sesión)») de claude-code.yml y las
// cesiones de los post-steps que vienen detrás.
//
// Casos mínimos del ruling (punto 8):
//  1. árbol sucio con PR ⇒ commit WIP + push + comentario con marcador +
//     `estado:esperando-architect` + `stalled`;
//  2. árbol sucio SOLO con rutas AP-097 ⇒ nada;
//  3. rama virgen con árbol sucio ⇒ push SIN PR;
//  4. fallo de push ⇒ comentario de error (sin el token) y step rojo.
// Más: residual de solo commits sigue abriendo PR (central#46), rama fuera de
// claude/* intacta, fallo tras el push (comentario/etiquetado) que dice «SÍ
// está en la rama» y reintenta los labels, la foto pre-sesión (`arbol_pre`)
// que resta la suciedad heredada, y las cesiones de Auto-label/turn-close-failsafe y de
// «Materializar muerte del Creator sin PR».
//
// Ejecuta el `run:` y los scripts EMBEBIDOS reales (no copias): el bash sobre
// repos git temporales con remoto local (la URL credencializada se redirige con
// `url.<local>.insteadOf`, sin costura en el step) y un `gh` doble en el PATH;
// los github-script contra un doble de la API. Cuelga del piggyback de
// `check-embedded-js.mjs` como sus hermanos.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, rmSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync, execFileSync } from 'child_process';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const wf = yaml.load(readFileSync('.github/workflows/claude-code.yml', 'utf8'));
const all = Object.values(wf.jobs || {}).flatMap(j => j.steps || []);
const byId = id => all.find(s => s.id === id);
const byName = n => all.find(s => s.name === n);
const rescate = byId('rescate');
const arbolPre = byId('arbol_pre');
const muerteStep = byId('post_muerte_sin_pr');
const autoLabel = byName("Auto-label based on Creator's closing tag");
for (const [k, v] of Object.entries({ rescate, arbol_pre: arbolPre, post_muerte_sin_pr: muerteStep, 'Auto-label': autoLabel })) {
  if (!v) { console.error(`CHECK-ARBOL-RESCATE ROJO: step \`${k}\` no encontrado en claude-code.yml`); process.exit(1); }
}

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok ' : '  ROJO'} ${msg}`); if (!ok) fails++; };

// Orden: el rescate corre ANTES de todo post-step de materialización.
{
  const idx = s => all.indexOf(s);
  const later = ['Materializar muerte del Creator sin PR (post-step determinista)', "Auto-label based on Creator's closing tag",
    'Materializar review en la apertura del PR (open-review-failsafe)', 'Re-review por estado de rama (post-step determinista)'];
  check(later.every(n => byName(n) && idx(byName(n)) > idx(rescate)), 'el step `rescate` precede a muerte-sin-PR, Auto-label, open-review-failsafe y re-review');
  const graft = all.findIndex(s => /graft-vendored/.test(s.uses || ''));
  check(graft >= 0 && idx(arbolPre) > graft && idx(arbolPre) < idx(byId('creator')) && arbolPre.env.PRE_SNAPSHOT === rescate.env.PRE_SNAPSHOT,
    'la foto pre-sesión (`arbol_pre`) va tras el graft y antes de la sesión, al mismo fichero que lee `rescate`');
  check(/steps\.rescate\.outputs\.wip != 'true'/.test(byName('Materializar review en la apertura del PR (open-review-failsafe)').if), 'open-review-failsafe cede con WIP rescatado');
  check(/secrets\.WORKFLOWS_PUSH_TOKEN \|\| secrets\.REVIEWER_GITHUB_TOKEN/.test(rescate.env.PUSH_TOKEN), 'token de push = WORKFLOWS_PUSH_TOKEN, si no REVIEWER_GITHUB_TOKEN (corre en consumidores)');
  check(!/git add (-A|\.|--all)/.test(rescate.run) && !/commit -a/.test(rescate.run), 'el rescate jamás usa `git add -A`/`.`/`commit -a`');
}

// ── Bash: el `run:` real sobre repos temporales ─────────────────────────────
const TOKEN = 'tok-secreto-123';
const URL = `https://x-access-token:${TOKEN}@github.com/o/r.git`;
const tmp = mkdtempSync(join(tmpdir(), 'rescate-'));
const gitEnv = { GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x' };
const sh = (cmd, cwd = tmp) => execFileSync('bash', ['-c', cmd], { cwd, stdio: 'pipe', encoding: 'utf8', env: { ...process.env, ...gitEnv } }).trim();
mkdirSync(join(tmp, 'bin'));
writeFileSync(join(tmp, 'bin', 'gh'), `#!/usr/bin/env bash
{ printf '%s\\x1f' "$@"; printf '\\x1e'; } >> "$GH_LOG"
if [ "$1 $2" = "pr list" ]; then [ -z "\${FAKE_PR_FAIL:-}" ] || exit 1; [ -n "\${FAKE_PR:-}" ] && echo "$FAKE_PR"; exit 0; fi
if [ "$1" = "api" ] && [ -n "\${FAKE_API_FAIL:-}" ]; then exit 1; fi
if [ "$1 $2" = "pr comment" ] && [ -n "\${FAKE_RESC_COMMENT_FAIL:-}" ] && printf '%s' "$*" | grep -q 'arbol-rescatado-por-estado'; then exit 1; fi
exit 0
`);
chmodSync(join(tmp, 'bin', 'gh'), 0o755);
sh('git init -q --bare -b main remote.git && git init -q -b main seed && cd seed && echo a > a.ts && printf "base\\n" > CLAUDE.md && echo "{}" > .mcp.json && git add . && git commit -qm init && git remote add origin ../remote.git && git push -q origin main');

let k = 0;
// Prepara un clon en `branch`; `published` ⇒ la rama existe ya en el remoto.
function clone(branch, { published = true, remote = 'remote.git' } = {}) {
  const wt = `wt${++k}`;
  sh(`git clone -q ${remote} ${wt} && cd ${wt} && git checkout -q -b ${branch}`);
  if (published) sh(`cd ${wt} && git commit -q --allow-empty -m hito && git push -q origin ${branch}`);
  return join(tmp, wt);
}
function runRescate(wt, { pr = '', remote = 'remote.git', eventIssue = '', eventIsPr = 'false', eventPr = '', prFail = '', apiFail = '', commentFail = '', snapshot = '' } = {}) {
  const log = join(tmp, `gh-${k}.log`), out = join(tmp, `out-${k}`);
  writeFileSync(log, ''); writeFileSync(out, '');
  const env = { ...process.env, PATH: `${join(tmp, 'bin')}:${process.env.PATH}`, GH_LOG: log, FAKE_PR: pr,
    GITHUB_OUTPUT: out, GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '777', GITHUB_SERVER_URL: 'https://github.com',
    PUSH_TOKEN: TOKEN, GH_TOKEN: 'pat', IN_DEFAULT_BRANCH: 'main', EVENT_ISSUE: eventIssue, EVENT_IS_PR: eventIsPr, EVENT_PR: eventPr, FAKE_PR_FAIL: prFail,
    FAKE_API_FAIL: apiFail, FAKE_RESC_COMMENT_FAIL: commentFail, PRE_SNAPSHOT: snapshot,
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${join(tmp, remote)}.insteadOf`, GIT_CONFIG_VALUE_0: URL,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const v of Object.keys(gitEnv)) delete env[v];
  const r = spawnSync('bash', ['-c', rescate.run], { cwd: wt, env, encoding: 'utf8' });
  const calls = readFileSync(log, 'utf8').split('\x1e').filter(Boolean).map(c => c.split('\x1f').filter((x, i, a) => i < a.length - 1 || x));
  const outputs = Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => l.split('=')));
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls, outputs };
}
// Ejecuta el `run:` real de la foto pre-sesión en `wt`; devuelve la ruta de la foto.
function foto(wt) {
  const f = join(tmp, `foto-${k}.z`);
  const r = spawnSync('bash', ['-c', arbolPre.run], { cwd: wt, env: { ...process.env, PRE_SNAPSHOT: f }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`foto pre-sesión falló: ${r.stderr}`);
  return f;
}
const remoteHead = (branch, remote = 'remote.git') => { try { return sh(`git --git-dir=${remote} log -1 --format=%s ${branch}`); } catch { return null; } };
const remoteFiles = (branch, remote = 'remote.git') => sh(`git --git-dir=${remote} show --name-only --format= ${branch}`).split('\n').filter(Boolean).sort();
const has = (calls, ...prefix) => calls.filter(c => prefix.every((p, i) => c[i] === p));

try {
  // 1. Árbol sucio con PR abierto.
  {
    const br = 'claude/issue-40-1';
    const wt = clone(br);
    sh('echo b > a.ts && mkdir -p "dir" && echo n > "dir/b c.ts" && echo rev > CLAUDE.md && mkdir -p .claude && echo x > .claude/s.md && echo "{\\"x\\":1}" > .mcp.json && git add .mcp.json', wt);
    const r = runRescate(wt, { pr: '50' });
    check(r.status === 0, `(1) árbol sucio con PR ⇒ exit 0 (got ${r.status}: ${r.stderr.trim().split('\n').pop()})`);
    check(/^wip\(creator\): árbol sin pushear al cierre de la sesión — rescatado por estado \(run 777\)$/.test(remoteHead(br) || ''), '(1) commit WIP pusheado con el mensaje del ruling');
    check(JSON.stringify(remoteFiles(br)) === JSON.stringify(['a.ts', 'dir/b c.ts']), `(1) el WIP lleva SOLO rutas fuera de AP-097 (got ${remoteFiles(br)})`);
    check(/M CLAUDE\.md/.test(sh('git status --porcelain', wt)) && /M  \.mcp\.json/.test(sh('git status --porcelain', wt)), '(1) CLAUDE.md y .mcp.json staged (AP-097) quedan fuera del commit');
    const com = has(r.calls, 'pr', 'comment', '50');
    check(com.length === 1 && /<!-- arbol-rescatado-por-estado -->/.test(com[0].join(' ')) && /dir\/b c\.ts/.test(com[0].join(' ')) && /no rehagas/.test(com[0].join(' ')), '(1) comentario en el PR con marcador, lista de ficheros y «no rehagas»');
    const lab = r.calls.filter(c => c[0] === 'api').map(c => c.join(' '));
    check(lab.length === 2 && /issues\/50\/labels/.test(lab[0]) && /estado:esperando-architect/.test(lab[0]) && /labels\[\]=stalled/.test(lab[1]), '(1) `estado:esperando-architect` y después `stalled` en el PR');
    check(!has(r.calls, 'pr', 'create').length, '(1) no se abre PR');
    check(r.outputs.wip === 'true' && r.outputs.pr === '50', '(1) outputs wip=true pr=50');
  }
  // 2. Árbol sucio SOLO con rutas AP-097 (y sin commits residuales).
  {
    const br = 'claude/issue-41-2';
    const wt = clone(br);
    const before = remoteHead(br);
    sh('echo rev > CLAUDE.md && echo l > CLAUDE.local.md && mkdir -p .claude .husky && echo x > .claude/s.md && echo h > .husky/pre-commit && echo r > .ripgreprc && echo "{}" > .claude.json && echo "[x]" > .gitmodules && echo "{\\"x\\":2}" > .mcp.json', wt);
    const r = runRescate(wt, { pr: '51' });
    check(r.status === 0 && r.calls.length === 0 && remoteHead(br) === before && r.outputs.wip === 'false', '(2) solo rutas AP-097 sucias ⇒ nada (sin commit, sin push, sin gh)');
  }
  // 3. Rama virgen con árbol sucio, sin PR.
  {
    const br = 'claude/issue-42-3';
    const wt = clone(br, { published: false });
    sh('echo v > a.ts && echo nuevo > n.ts', wt);
    const r = runRescate(wt, { eventIssue: '42' });
    check(r.status === 0 && /^wip\(creator\)/.test(remoteHead(br) || ''), '(3) rama virgen con árbol sucio ⇒ rama pusheada con el WIP');
    check(!has(r.calls, 'pr', 'create').length && !r.calls.some(c => c[0] === 'api'), '(3) rama virgen ⇒ SIN PR y sin labels');
    const com = has(r.calls, 'issue', 'comment', '42');
    check(com.length === 1 && /claude\/issue-42-3/.test(com[0].join(' ')) && /`n\.ts`/.test(com[0].join(' ')) && /arbol-rescatado-por-estado/.test(com[0].join(' ')), '(3) una línea en el issue con la rama y los ficheros');
    check(r.outputs.wip === 'true' && r.outputs.pr === '', '(3) outputs wip=true sin pr');
  }
  // 4. Fallo de push (el remoto rechaza y su salida filtra el token).
  {
    sh(`git clone -q --bare remote.git remote-rechaza.git && printf '#!/usr/bin/env bash\\necho "rechazado para https://x-access-token:${TOKEN}@github.com/o/r.git" >&2\\nexit 1\\n' > remote-rechaza.git/hooks/pre-receive && chmod +x remote-rechaza.git/hooks/pre-receive`);
    const br = 'claude/issue-43-4';
    const wt = clone(br, { published: false, remote: 'remote-rechaza.git' });
    sh('echo f > a.ts', wt);
    const r = runRescate(wt, { pr: '53', remote: 'remote-rechaza.git' });
    const com = has(r.calls, 'pr', 'comment', '53');
    check(r.status !== 0, '(4) fallo de push ⇒ step rojo (fail-loud)');
    check(com.length === 1 && /arbol-rescate-fallido/.test(com[0].join(' ')) && /rechazado/.test(com[0].join(' ')), '(4) comentario en el PR con el error');
    check(!r.calls.flat().some(a => a.includes(TOKEN)), '(4) el token no aparece en el comentario');
    check(!r.calls.some(c => c[0] === 'api') && r.outputs.wip === 'false', '(4) sin labels ni wip=true');
  }
  // 5. Solo commits residuales en rama virgen sin PR ⇒ push + PR (central#46 intacto).
  {
    const br = 'claude/issue-44-5';
    const wt = clone(br, { published: false });
    sh('echo c > a.ts && git commit -qam "feat: algo"', wt);
    const r = runRescate(wt);
    check(r.status === 0 && remoteHead(br) === 'feat: algo' && has(r.calls, 'pr', 'create').length === 1 && r.outputs.wip === 'false', '(5) solo commits residuales ⇒ push + PR (comportamiento central#46)');
  }
  // 7. Borrados y `git mv` sin commitear (staged y sin stagear) no tumban el rescate.
  {
    const br = 'claude/issue-45-7';
    const wt = clone(br);
    sh('echo 1 > x.ts && echo 2 > y.ts && echo 3 > z.ts && git add . && git commit -qm base3 && git push -q origin HEAD', wt);
    sh('git mv x.ts x2.ts && git rm -q y.ts && rm z.ts && echo m > a.ts', wt);
    const r = runRescate(wt, { pr: '55' });
    const st = sh(`git --git-dir=remote.git show --name-status --format= ${br}`);
    check(r.status === 0 && /^wip\(creator\)/.test(remoteHead(br) || ''), `(7) rename + borrados staged/sin stagear ⇒ rescate OK (got ${r.status}: ${r.stdout.trim().split('\n').pop()})`);
    check(/^D\ty\.ts$/m.test(st) && /^D\tz\.ts$/m.test(st) && /^M\ta\.ts$/m.test(st) && /x2\.ts/.test(st), '(7) el WIP lleva los borrados, el rename y las modificaciones');
  }
  // 8. `gh pr list` falla en contexto PR ⇒ respaldo con el PR del evento (no rama virgen).
  {
    const br = 'claude/issue-46-8';
    const wt = clone(br);
    sh('echo q > a.ts', wt);
    const r = runRescate(wt, { prFail: '1', eventPr: '56', eventIsPr: 'true', eventIssue: '56' });
    check(r.status === 0 && has(r.calls, 'pr', 'comment', '56').length === 1 && r.calls.filter(c => c[0] === 'api' && /issues\/56\/labels/.test(c.join(' '))).length === 2 && r.outputs.pr === '56', '(8) lectura de PR fallida en contexto PR ⇒ marcador + labels en el PR del evento');
  }
  // 9. Falla el comentario del rescate DESPUÉS del push ⇒ el fallo dice que el WIP
  //    SÍ está en la rama y se aplican igualmente los labels del turno del Creator.
  {
    const br = 'claude/issue-47-9';
    const wt = clone(br);
    sh('echo w > a.ts', wt);
    const r = runRescate(wt, { pr: '57', commentFail: '1' });
    const sha = sh('git rev-parse --short HEAD', wt);
    const err = has(r.calls, 'pr', 'comment', '57').map(c => c.join(' ')).filter(c => /arbol-rescate-fallido/.test(c));
    check(r.status !== 0 && /^wip\(creator\)/.test(remoteHead(br) || ''), '(9) comentario del rescate fallido tras el push ⇒ step rojo con el WIP en el remoto');
    check(err.length === 1 && /SÍ está en la rama/.test(err[0]) && err[0].includes(sha) && /no rehagas/.test(err[0]) && !/muere con el runner/.test(err[0]), '(9) el comentario de fallo dice que el WIP SÍ está (con su sha) y «no rehagas»');
    check(r.calls.some(c => c[0] === 'api' && /labels\[\]=stalled/.test(c.join(' '))) && r.calls.some(c => c[0] === 'api' && /estado:esperando-architect/.test(c.join(' '))), '(9) aun así se aplican `estado:esperando-architect` y `stalled`');
  }
  // 10. Falla el etiquetado tras el push ⇒ mismo texto «SÍ está», no «muere».
  {
    const br = 'claude/issue-48-10';
    const wt = clone(br);
    sh('echo e > a.ts', wt);
    const r = runRescate(wt, { pr: '58', apiFail: '1' });
    const err = has(r.calls, 'pr', 'comment', '58').map(c => c.join(' ')).filter(c => /arbol-rescate-fallido/.test(c));
    check(r.status !== 0 && err.length === 1 && /SÍ está en la rama/.test(err[0]) && /etiquetado/.test(err[0]) && !/muere con el runner/.test(err[0]), '(10) etiquetado fallido tras el push ⇒ comentario «SÍ está en la rama», no «muere»');
  }
  // 11. Foto pre-sesión: la suciedad heredada que la sesión no toca no se rescata;
  //     una ruta ya sucia que la sesión modifica, sí.
  {
    const br = 'claude/issue-49-11';
    const wt = clone(br);
    sh('echo g > residuo-graft.txt && echo pre > a.ts', wt);
    const f = foto(wt);
    const quieto = runRescate(wt, { pr: '59', snapshot: f });
    check(quieto.status === 0 && quieto.calls.length === 0 && quieto.outputs.wip === 'false', '(11) solo suciedad idéntica a la foto pre-sesión ⇒ nada (sin WIP, sin re-arm)');
    sh('echo sesion > a.ts && echo n > nuevo.ts', wt);
    const r = runRescate(wt, { pr: '59', snapshot: f });
    check(r.status === 0 && JSON.stringify(remoteFiles(br)) === JSON.stringify(['a.ts', 'nuevo.ts']), `(11) con foto: el WIP lleva lo que tocó la sesión y no el residuo heredado (got ${remoteFiles(br)})`);
  }
  // 6. Rama fuera de claude/* ⇒ nada.
  {
    const wt = clone('main-local', { published: false });
    sh('git checkout -q main && echo z > a.ts', wt);
    const r = runRescate(wt, { pr: '9' });
    check(r.status === 0 && r.calls.length === 0 && remoteHead('main') === 'init', '(6) rama base ⇒ nada');
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

// ── github-script: cesiones ─────────────────────────────────────────────────
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const muerte = new AsyncFunction('github', 'context', 'core', 'require', muerteStep.with.script);
const autolabel = new AsyncFunction('github', 'context', 'core', autoLabel.with.script);
const core = w => ({ setOutput: (k2, v) => { w.outputs[k2] = String(v); }, notice() {}, warning() {}, info() {} });
const T0 = Date.now() - 600000;
const at = s => new Date(T0 + s * 1000).toISOString();

async function withEnv(vars, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, vars);
  try { return await fn(); } finally { process.env = saved; }
}

async function postMuerte({ rescueWip, rescuePr = '', prs = [] }) {
  const w = { added: [], removed: [], comments: [], created: [], outputs: {}, fetches: 0 };
  const github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      pulls: { list: async () => ({ data: prs }), create: async p => { w.created.push(p); return { data: { number: 99 } }; }, update: async () => ({}) },
      git: { listMatchingRefs: async () => ({ data: [{ ref: 'refs/heads/claude/issue-40-1' }] }) },
      repos: { compareCommits: async () => ({ data: { ahead_by: 2, behind_by: 0, commits: [{ commit: { message: 'wip(creator): x' } }] } }) },
      issues: {
        get: async () => ({ data: { labels: [{ name: 'serial-activo' }] } }),
        listForRepo: async () => ({ data: [] }),
        listComments: async () => ({ data: [] }),
        addLabels: async p => { w.added.push(...p.labels.map(l => `${p.issue_number}:${l}`)); },
        removeLabel: async p => { w.removed.push(p.name); },
        createComment: async p => { w.comments.push(p.body); },
      },
    },
  };
  const dir = mkdtempSync(join(tmpdir(), 'rescate-exec-'));
  const exec = join(dir, 'claude-execution-output.json');
  writeFileSync(exec, JSON.stringify([{ type: 'result', num_turns: 30, total_cost_usd: 1 }]));
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { w.fetches++; return { ok: true, json: async () => ({}) }; };
  const context = { repo: { owner: 'o', repo: 'r' }, runId: 1, payload: { issue: { number: 40, title: 'x', labels: [] }, comment: { created_at: at(0) } } };
  try {
    await withEnv({ EXEC_FILE: exec, STEP_CREATOR_OUTCOME: 'success', IN_DEFAULT_BRANCH: 'main', RESCUE_WIP: rescueWip, RESCUE_PR: rescuePr, DEFAULT_GH_TOKEN: 't' },
      () => muerte(github, context, core(w), require));
  } finally { globalThis.fetch = savedFetch; rmSync(dir, { recursive: true, force: true }); }
  return w;
}
{
  const w = await postMuerte({ rescueWip: 'true' });
  check(w.created.length === 0, '(muerte) rama virgen con WIP rescatado ⇒ NO se abre PR desde el estado (AP-023 cede)');
  check(w.added.includes('40:stalled'), '(muerte) rama virgen con WIP rescatado ⇒ residual: `stalled` (re-arm «no rehagas»)');
  const c = await postMuerte({ rescueWip: '' });
  check(c.created.length === 1, '(muerte, control) sin rescate ⇒ AP-023 abre el PR como siempre');
  const draft = [{ number: 50, draft: true, node_id: 'N', created_at: at(-10), head: { ref: 'claude/issue-40-1' } }];
  const d = await postMuerte({ rescueWip: 'true', rescuePr: '50', prs: draft });
  check(d.added.length === 0 && d.fetches === 0 && d.comments.length === 0, '(muerte) draft con WIP rescatado ⇒ ni ready ni needs-review');
  const dm = await postMuerte({ rescueWip: 'true', rescuePr: '', prs: draft });
  check(dm.fetches === 0 && !dm.added.includes('50:needs-review') && dm.added.join() === '50:estado:esperando-architect,50:stalled' && /arbol-rescatado-por-estado/.test(dm.comments.join()), '(muerte) WIP rescatado sin ver el PR ⇒ muerte-sin-PR materializa el turno del Creator en el PR');
  const dc = await postMuerte({ rescueWip: '', prs: draft });
  check(dc.added.includes('50:needs-review'), '(muerte, control) draft sin rescate ⇒ ready + needs-review (AP-047)');
}

async function runAutoLabel({ closing, marker, rescueWip = '' }) {
  const w = { added: [], comments: [], outputs: {} };
  const trigger = { user: { login: 'owner' }, created_at: at(0), body: 'NITS\n@claude <!-- ping-creator -->' };
  const comments = [trigger, { user: { login: 'claude[bot]' }, created_at: at(60), body: closing }];
  if (marker) comments.push({ user: { login: 'owner' }, created_at: at(70), body: 'rescate\n\n<!-- arbol-rescatado-por-estado -->' });
  const github = {
    rest: {
      issues: {
        listComments: async () => ({ data: comments }),
        addLabels: async p => { w.added.push(...p.labels); },
        removeLabel: async () => ({}),
        createComment: async p => { w.comments.push(p.body); },
      },
      pulls: { get: async () => ({ data: { head: { sha: 'abc1234def' }, draft: false } }) },
      repos: { getCommit: async () => ({ data: { commit: { committer: { date: at(65) } } } }) },
    },
  };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { issue: { number: 50, pull_request: {} }, comment: trigger } };
  await withEnv({ WAS_DRAFT: 'false', IN_REVIEWER_WF: 'Opus Reviewer', RESCUE_WIP: rescueWip }, () => autolabel(github, context, core(w)));
  return w;
}
{
  check((await runAutoLabel({ closing: 'trabajo en curso', marker: true })).added.length === 0, '(auto-label) sin tag + marcador fresco ⇒ turn-close-failsafe cede');
  check((await runAutoLabel({ closing: 'trabajo en curso', marker: false })).added.includes('needs-review'), '(auto-label, control) sin tag ni marcador + push ⇒ turn-close-failsafe aplica needs-review');
  check((await runAutoLabel({ closing: '@reviewer listo', marker: true })).added.length === 0, '(auto-label) `@reviewer` + marcador fresco ⇒ cede (no manda el WIP al Reviewer)');
  check((await runAutoLabel({ closing: '@reviewer listo', marker: false, rescueWip: 'true' })).added.length === 0, '(auto-label) output wip=true sin marcador legible ⇒ cede');
  check((await runAutoLabel({ closing: '[NEEDS-HUMAN]: duda', marker: true })).added.includes('human-needed'), '(auto-label) `[NEEDS-HUMAN]` sigue mandando con rescate');
}

if (fails) { console.error(`CHECK-ARBOL-RESCATE ROJO: ${fails} caso(s) fallan.`); process.exit(1); }
console.log('check-arbol-rescate verde.');
