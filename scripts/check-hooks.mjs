#!/usr/bin/env node
// check-hooks — anti-drift de la capa de hooks vendored (2026-07-28, nit 3 de
// la review de AP-057). `vendored/claude/**` lo sirve el graft (AP-009) EN VIVO
// a los dos consumidores en su siguiente run, sin gradualidad, y hasta ahora el
// CI del central no lo miraba en absoluto: un rename de hook sin tocar
// settings.json dejaba a los dos consumidores apuntando a un fichero
// inexistente —efecto en runtime: silencio, y CI verde—, y un error de sintaxis
// en cualquier hook se desplegaba igual. Es la clase que AP-052 § «Puntos
// ciegos» nombra: el estado de despliegue efectivo se INFIERE, no se LEE.
//
// Verifica, en las dos direcciones (mismo patrón que check-labels):
//   1. Todo `command` de settings.json referencia un .sh presente en hooks/.
//   2. Ningún .sh de hooks/ queda huérfano (el graft lo copia igual: sería
//      código muerto desplegado en vivo).
//   3. `bash -n` sobre cada .sh (sintaxis; no ejecuta nada).
// Verde: exit 0. Corre en el CI del central.
import { readFileSync, readdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

const DIR = 'vendored/claude';
const HOOKS = `${DIR}/hooks`;
const errors = [];

const settings = JSON.parse(readFileSync(`${DIR}/settings.json`, 'utf8'));
const files = readdirSync(HOOKS).filter(f => f.endsWith('.sh'));
const referenced = new Set();
let commands = 0;

for (const [event, matchers] of Object.entries(settings.hooks || {})) {
  for (const m of matchers) {
    for (const h of m.hooks || []) {
      commands++;
      const cmd = h.command || '';
      // Los hooks se invocan como `bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/<f>`:
      // en el consumidor viven bajo .claude/hooks/, injertados desde aquí.
      const ref = /\.claude\/hooks\/([A-Za-z0-9._-]+)/.exec(cmd);
      if (!ref) {
        errors.push(`${event}: command sin ruta \`.claude/hooks/<fichero>\` reconocible — \`${cmd}\``);
        continue;
      }
      referenced.add(ref[1]);
      if (!existsSync(`${HOOKS}/${ref[1]}`)) {
        errors.push(`${event}: \`${ref[1]}\` no existe en ${HOOKS}/ — los consumidores recibirían un hook que apunta a la nada (silencio en runtime)`);
      }
    }
  }
}

for (const f of files) {
  if (!referenced.has(f)) errors.push(`${HOOKS}/${f}: no lo referencia ningún hook de settings.json — el graft lo despliega igual (código muerto en vivo)`);
  try {
    execFileSync('bash', ['-n', `${HOOKS}/${f}`], { stdio: 'pipe' });
  } catch (e) {
    errors.push(`${HOOKS}/${f}: \`bash -n\` ROJO — ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
}

if (errors.length) { console.error('CHECK-HOOKS ROJO:'); errors.forEach(e => console.error('  - ' + e)); process.exit(1); }
console.log(`check-hooks verde: ${commands} hooks declarados en settings.json, ${files.length} scripts presentes, todos referenciados y con sintaxis válida.`);

// ── 4. Banco de comportamiento de test-discipline (AP-089): el hook decide
// sobre estado git real, así que se ejercita en un repo temporal con remoto.
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

const HOOK = resolve(`${HOOKS}/test-discipline.sh`);
const tmp = mkdtempSync(join(tmpdir(), 'td-'));
const sh = (cmd, cwd) => execFileSync('bash', ['-lc', cmd], { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x' } });
const runFull = (cmd, cwd, env = {}) => spawnSync('bash', [HOOK], { cwd, input: JSON.stringify({ tool_input: { command: cmd } }), env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env }, encoding: 'utf8' });
const run = (cmd, cwd, env) => runFull(cmd, cwd, env).status;
// AP-133: listado con el MISMO modo que el hook (una entrada por fichero).
const listed = (cwd, path) => sh('git status --porcelain=v1 -z --untracked-files=all', cwd).toString().split('\0').some(e => e.slice(3) === path);
const paths = n => Array.from({ length: n }, (_, i) => `src/t${i}.test.ts`).join(' ');
const bank = [];
try {
  sh('git init -q --bare -b main remote.git && git init -q -b main wt && cd wt && git remote add origin ../remote.git && echo a > a.ts && git add . && git commit -qm init', tmp);
  const wt = join(tmp, 'wt');
  bank.push(['sin upstream, dirty, tests scoped ⇒ permite (pre-hito 1)', run('npx vitest run a.ts', wt), 0]);
  sh('git push -q -u origin main', wt);
  bank.push(['upstream, limpio, tests scoped ⇒ permite', run('npx vitest run a.ts', wt), 0]);
  writeFileSync(join(wt, 'a.ts'), 'b');
  bank.push(['upstream, dirty, tests scoped ⇒ BLOQUEA', run('npx vitest run a.ts', wt), 2]);
  bank.push(['upstream, dirty, bench ⇒ BLOQUEA', run('pnpm --filter app bench', wt), 2]);
  // AP-101 (central#300): formas de runner que el ERE no reconocía.
  bank.push(['upstream, dirty, node node_modules/.bin/vitest scoped ⇒ BLOQUEA', run('node node_modules/.bin/vitest run a.ts', wt), 2]);
  bank.push(['upstream, dirty, ./node_modules/.bin/vitest scoped ⇒ BLOQUEA', run('./node_modules/.bin/vitest run a.ts', wt), 2]);
  bank.push(['upstream, dirty, pnpm exec vitest scoped ⇒ BLOQUEA', run('pnpm exec vitest run a.ts', wt), 2]);
  bank.push(['upstream, dirty, pnpm -F app test scoped ⇒ BLOQUEA', run('pnpm -F app test a.ts', wt), 2]);
  bank.push(['upstream, dirty, typecheck ⇒ permite (exento)', run('pnpm typecheck', wt), 0]);
  bank.push(['upstream, dirty, git push ⇒ permite (salida siempre disponible)', run('git push origin HEAD', wt), 0]);
  sh('git commit -qam edit', wt);
  bank.push(['upstream, ahead sin push, tests ⇒ BLOQUEA', run('npx vitest run a.ts', wt), 2]);
  sh('git push -q', wt);
  bank.push(['upstream, pusheado, tests ⇒ permite', run('npx vitest run a.ts', wt), 0]);
  // El graft registra lo injertado en .git/info/exclude: nunca sale en porcelain.
  sh('mkdir -p .claude/skills && echo x > .claude/skills/S.md && echo .claude/skills/S.md >> .git/info/exclude', wt);
  bank.push(['upstream, .claude/ injertado (exclude), tests ⇒ permite (central#271)', run('npx vitest run a.ts', wt), 0]);
  sh('rm -rf .claude', wt);
  bank.push(['pusheado, suite completa ⇒ BLOQUEA (check original intacto)', run('pnpm test', wt), 2]);
  bank.push(['pusheado, pnpm -F @scope/app test sin rutas ⇒ BLOQUEA (suite del paquete)', run('pnpm -F @scope/app test', wt), 2]);
  bank.push(['pusheado, pnpm --filter app test sin rutas ⇒ BLOQUEA', run('pnpm --filter app test', wt), 2]);
  bank.push(['pusheado, node node_modules/.bin/vitest sin rutas ⇒ BLOQUEA', run('node node_modules/.bin/vitest run', wt), 2]);
  bank.push(['pusheado, node node_modules/.bin/vitest scoped ⇒ permite', run('node node_modules/.bin/vitest run src/a.test.ts', wt), 0]);
  bank.push(['pusheado, pnpm -F app test scoped ⇒ permite', run('pnpm -F app test src/a.test.ts', wt), 0]);
  bank.push(['pusheado, pnpm -F app typecheck ⇒ permite (no es runner)', run('pnpm -F app typecheck', wt), 0]);
  // ── AP-133: .claude/** por blob contra origin/<base> (base por `git remote show origin`).
  sh('mkdir -p .claude/skills/T && echo v1 > .claude/skills/T/SKILL.md && git add . && git commit -qm skill && git push -q', wt);
  sh('git checkout -qb feat && echo v2 > .claude/skills/T/SKILL.md && git commit -qam v2 && git push -q -u origin feat', wt);
  sh('git checkout -q main && mkdir -p .claude/skills/E && echo base > .claude/skills/E/SKILL.md && git add . && git commit -qm E && git push -q && git checkout -q feat', wt);
  writeFileSync(join(wt, '.claude/skills/T/SKILL.md'), 'v3\n');
  bank.push(['AP-133 (a) skill M con blob ≠ base ⇒ BLOQUEA', run('npx vitest run a.ts', wt), 2]);
  writeFileSync(join(wt, '.claude/skills/T/SKILL.md'), 'v1\n');
  bank.push(['AP-133 (b) skill M con el blob de la base (AP-097) ⇒ permite', run('npx vitest run a.ts', wt), 0]);
  sh('git checkout -q -- .claude && mkdir -p .claude/skills/N && echo nueva > .claude/skills/N/SKILL.md', wt);
  bank.push(['AP-133 (c) untracked nuevo en dir nuevo, sin blob en base ⇒ BLOQUEA (entrada de FICHERO)', listed(wt, '.claude/skills/N/SKILL.md') ? run('npx vitest run a.ts', wt) : 'no-listado', 2]);
  sh('rm -rf .claude/skills/N && mkdir -p .claude/skills/E && echo base > .claude/skills/E/SKILL.md', wt);
  bank.push(["AP-133 (c′) ?? en dir ausente del HEAD con el blob de la base (AP-097) ⇒ permite", listed(wt, '.claude/skills/E/SKILL.md') ? run('npx vitest run a.ts', wt) : 'no-listado', 0]);
  sh('rm -rf .claude/skills/E && ln -s /etc/hostname .claude/skills/L.md', wt);
  bank.push(['AP-133 (h) enlace simbólico en .claude/ ⇒ no cuenta', run('npx vitest run a.ts', wt), 0]);
  sh('rm -f .claude/skills/L.md && git remote set-url origin /nonexistent/remote.git && rm -f .git/pipeline-base', wt);
  writeFileSync(join(wt, '.claude/skills/T/SKILL.md'), 'v3\n');
  bank.push(["AP-133 (d′) PIPELINE_BASE_BRANCH=main, remoto inalcanzable, skill M ≠ base ⇒ BLOQUEA", run('npx vitest run a.ts', wt, { PIPELINE_BASE_BRANCH: 'main' }), 2]);
  sh('git checkout -q -- .claude && git remote set-url origin ../remote.git', wt);
  // Remoto cuyo HEAD apunta a una rama inexistente ⇒ `HEAD branch: (unknown)`.
  sh('git init -q --bare -b nada remote2.git && git clone -q remote.git wt2 2>/dev/null && cd wt2 && git remote set-url origin ../remote2.git && git push -q -u origin main', tmp);
  const wt2 = join(tmp, 'wt2');
  writeFileSync(join(wt2, '.claude/skills/T/SKILL.md'), 'v9\n');
  const d = runFull('npx vitest run a.ts', wt2);
  bank.push(['AP-133 (d) base (unknown), sin env ni caché ⇒ permite (fail-open) + stderr', d.status === 0 && d.stderr.includes('test-discipline: base no resoluble, .claude/** excluido como antes') ? 0 : `${d.status}/${d.stderr.trim()}`, 0]);
  // ── AP-133: tope de rutas por invocación (árbol limpio y pusheado).
  bank.push(['AP-133 (e) 26 rutas ⇒ BLOQUEA', run(`npx vitest run ${paths(26)}`, wt), 2]);
  bank.push(['AP-133 (f) 25 rutas ⇒ permite', run(`npx vitest run ${paths(25)}`, wt), 0]);
  bank.push(['AP-133 (g) PIPELINE_MAX_TEST_PATHS=0 + 40 rutas ⇒ permite', run(`npx vitest run ${paths(40)}`, wt, { PIPELINE_MAX_TEST_PATHS: '0' }), 0]);
  bank.push(['AP-133 (i) `> /tmp/out.log` no cuenta como ruta', run(`npx vitest run ${paths(25)} > /tmp/out.log`, wt), 0]);
  bank.push(['AP-133 (i′) `>/tmp/out.log` pegado y `| tee /tmp/x.log` no cuentan', Math.max(run(`npx vitest run ${paths(25)} >/tmp/out.log`, wt), run(`npx vitest run ${paths(25)} 2>&1 | tee /tmp/x.log`, wt)), 0]);
  writeFileSync(join(wt, 'a.ts'), 'c');
  bank.push(['override PIPELINE_VERIFY_AFTER_PUSH=0 ⇒ permite', spawnSync('bash', [HOOK], { cwd: wt, input: JSON.stringify({ tool_input: { command: 'npx vitest run a.ts' } }), env: { ...process.env, CLAUDE_PROJECT_DIR: wt, PIPELINE_VERIFY_AFTER_PUSH: '0' }, encoding: 'utf8' }).status, 0]);
} finally { rmSync(tmp, { recursive: true, force: true }); }
const bad = bank.filter(([, got, want]) => got !== want);
if (bad.length) { console.error('CHECK-HOOKS ROJO (banco test-discipline):'); bad.forEach(([n, g, w]) => console.error(`  - ${n}: exit ${g}, esperado ${w}`)); process.exit(1); }
console.log(`check-hooks verde: banco test-discipline ${bank.length}/${bank.length}.`);
