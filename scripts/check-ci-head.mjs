#!/usr/bin/env node
// check-ci-head — banco de `vendored/scripts/ci-head.cjs` (AP-137, central#399,
// ruling mensual 2026-11-01, posición 16): el estado de CI del head se lee con el
// `GITHUB_TOKEN` del job (`checks: read`) y se materializa en `.pipeline/ci-head.md`
// para el Reviewer.
//
// Parte 1 — el módulo REAL con un `github` simulado, casos del ruling (punto 5):
//  (a) check-run `success` ⇒ fila sin anotaciones; (b) `failure` con 3
//  anotaciones ⇒ las 3; (c) 25 anotaciones ⇒ 20; (d) mensaje de 500 caracteres ⇒
//  300; (e) `listForRef` lanza 403 ⇒ `lectura de CI falló: 403 …`, sin lanzar;
//  (f) primera línea con el SHA pasado. Más: `leerCiHeadPr` usa el head de
//  `pulls.get` y rotula su propio fallo con `<status> <message>`.
// Parte 2 — integración: el script EMBEBIDO real del step «Estado de CI del head
// (AP-137)» de `reviewer.yml`, con el cargador compartido y `GITHUB_WORKSPACE` en
// un directorio temporal: escribe `.pipeline/ci-head.md`, excluye `.pipeline/` y,
// sin módulo, deja `lectura de CI falló: módulo no injertado` sin lanzar.
// Parte 3 — costura (YAML): el step va justo antes de «Run Reviewer» con su mismo
// `if:` y `github-token: ${{ github.token }}`; `reviewer.yml` concede `checks: read`;
// el step del agente de `claude-code.yml` lleva `CI_READ_TOKEN: ${{ github.token }}`.
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);
const FUENTE = 'vendored/scripts/ci-head.cjs';
const CH = require(resolve(FUENTE));

let casos = 0;
const fallos = [];
const afirma = (cond, msg) => { casos++; if (!cond) fallos.push(msg); };

const SHA = 'abc1234def5678abc1234def5678abc1234def56';
const AHORA = new Date('2026-11-02T09:00:00Z');
const err = (status, message) => Object.assign(new Error(message), { status });

// `github` simulado: `runs` = check-runs; `anot` = id ⇒ anotaciones; `throwIn` =
// nombre del método que lanza. Registra el `ref` pedido.
function simula({ runs = [], anot = {}, statuses = [], state = 'success', throwIn = null, headSha = SHA } = {}) {
  const pedidos = [];
  const tira = (m) => { if (throwIn && throwIn.m === m) throw throwIn.e; };
  return {
    pedidos,
    rest: {
      pulls: { get: async (p) => { pedidos.push(['pulls.get', p.pull_number]); tira('pulls.get'); return { data: { head: { sha: headSha } } }; } },
      checks: {
        listForRef: async (p) => { pedidos.push(['listForRef', p.ref]); tira('listForRef'); return { data: { total_count: runs.length, check_runs: runs } }; },
        listAnnotations: async (p) => { pedidos.push(['listAnnotations', p.check_run_id]); tira('listAnnotations'); return { data: anot[p.check_run_id] || [] }; },
      },
      repos: { getCombinedStatusForRef: async (p) => { pedidos.push(['combined', p.ref]); tira('combined'); return { data: { state, statuses } }; } },
    },
  };
}
const anotaciones = (n, msg = i => `fallo ${i}`) => Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.ts`, start_line: i + 1, message: msg(i) }));
const filasAnot = t => t.split('\n').filter(l => /^ {2}- /.test(l));
const lee = (g, sha = SHA) => CH.leerCiHead({ github: g, owner: 'o', repo: 'r', sha, ahora: AHORA });

// ── Parte 1 ──────────────────────────────────────────────────────────────────
{ // (a) success ⇒ fila sin anotaciones
  const g = simula({ runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }], anot: { 1: anotaciones(3) } });
  const t = await lee(g);
  afirma(t.includes('- `ci` — status: completed, conclusion: success'), '(a) falta la fila del check-run success');
  afirma(filasAnot(t).length === 0, `(a) un check-run success no debe traer anotaciones: ${filasAnot(t).length}`);
  afirma(!g.pedidos.some(p => p[0] === 'listAnnotations'), '(a) no se piden anotaciones de un success');
}
{ // (b) failure con 3 anotaciones ⇒ las 3
  const g = simula({ runs: [{ id: 7, name: 'tests', status: 'completed', conclusion: 'failure' }], anot: { 7: anotaciones(3) } });
  const t = await lee(g);
  const f = filasAnot(t);
  afirma(f.length === 3, `(b) esperaba 3 anotaciones, hay ${f.length}`);
  afirma(f[0] === '  - src/f0.ts:1 — fallo 0', `(b) formato de anotación: ${JSON.stringify(f[0])}`);
}
{ // timed_out también trae anotaciones
  const g = simula({ runs: [{ id: 8, name: 'lento', status: 'completed', conclusion: 'timed_out' }], anot: { 8: anotaciones(2) } });
  afirma(filasAnot(await lee(g)).length === 2, '(b′) timed_out debe traer sus anotaciones');
}
{ // (c) 25 anotaciones ⇒ 20
  const g = simula({ runs: [{ id: 9, name: 'tests', status: 'completed', conclusion: 'failure' }], anot: { 9: anotaciones(25) } });
  afirma(filasAnot(await lee(g)).length === 20, '(c) 25 anotaciones deben quedar en 20');
}
{ // (d) mensaje de 500 caracteres ⇒ 300
  const g = simula({ runs: [{ id: 3, name: 'lint', status: 'completed', conclusion: 'failure' }], anot: { 3: anotaciones(1, () => 'x'.repeat(500)) } });
  const f = filasAnot(await lee(g));
  const msg = (f[0] || '').split(' — ').slice(1).join(' — ');
  afirma(msg.length === 300, `(d) el mensaje debe quedar en 300 caracteres, tiene ${msg.length}`);
}
{ // (e) listForRef lanza 403 ⇒ texto de fallo, sin lanzar
  const g = simula({ throwIn: { m: 'listForRef', e: err(403, 'Resource not accessible by integration') } });
  let t, lanzo = false;
  try { t = await lee(g); } catch { lanzo = true; }
  afirma(!lanzo, '(e) leerCiHead no debe lanzar');
  afirma(/^lectura de CI falló: 403 Resource not accessible by integration$/m.test(t || ''), `(e) texto de fallo: ${JSON.stringify(t)}`);
  afirma((t || '').split('\n')[0].includes(SHA), '(e) también en fallo la primera línea lleva el SHA');
}
{ // (f) primera línea con el SHA pasado y la hora de lectura
  const g = simula({ runs: [] });
  const t = await lee(g);
  const l1 = t.split('\n')[0];
  afirma(l1.includes(`SHA ${SHA}`) && l1.includes(AHORA.toISOString()), `(f) primera línea: ${JSON.stringify(l1)}`);
  afirma(g.pedidos.every(p => p[0] === 'listAnnotations' || p[1] === SHA), '(f) se lee CI del SHA pasado');
}
{ // estado combinado: contextos y estado
  const g = simula({ state: 'failure', statuses: [{ context: 'ext/ci', state: 'failure', description: 'roto' }] });
  const t = await lee(g);
  afirma(t.includes('## Estado combinado: failure') && t.includes('- `ext/ci` — failure (roto)'), '(g) falta el estado combinado');
}
{ // leerCiHeadPr: head real de pulls.get; su fallo lleva <status> <message>
  const real = 'f'.repeat(40);
  const g = simula({ headSha: real });
  const t = await CH.leerCiHeadPr({ github: g, owner: 'o', repo: 'r', pull_number: 5, ahora: AHORA });
  afirma(t.split('\n')[0].includes(`SHA ${real}`) && g.pedidos.some(p => p[0] === 'listForRef' && p[1] === real), '(h) leerCiHeadPr debe leer el head de pulls.get');
  const g2 = simula({ throwIn: { m: 'pulls.get', e: err(404, 'Not Found') } });
  const t2 = await CH.leerCiHeadPr({ github: g2, owner: 'o', repo: 'r', pull_number: 5, ahora: AHORA });
  afirma(/^lectura de CI falló: 404 Not Found$/m.test(t2) && !t2.includes('módulo no injertado'), `(h′) fallo de pulls.get mal rotulado: ${JSON.stringify(t2)}`);
}

// ── Parte 2 y 3: step embebido de reviewer.yml y costuras ────────────────────
const rv = yaml.load(readFileSync('.github/workflows/reviewer.yml', 'utf8'));
const pasos = rv.jobs.review.steps;
const iCi = pasos.findIndex(s => s && s.name === 'Estado de CI del head (AP-137)');
const iRun = pasos.findIndex(s => s && s.name === 'Run Reviewer');
afirma(iCi >= 0 && iCi === iRun - 1, `(costura) el step de CI debe ir justo antes de «Run Reviewer» (índices ${iCi}/${iRun})`);
const ciStep = pasos[iCi] || {};
afirma(iRun >= 0 && ciStep.if === pasos[iRun].if, '(costura) el step de CI debe llevar el mismo `if:` que «Run Reviewer»');
afirma(/^actions\/github-script@/.test(ciStep.uses || '') && ciStep.with && ciStep.with['github-token'] === '${{ github.token }}', '(costura) github-script con `github-token: ${{ github.token }}`');
afirma(rv.permissions && rv.permissions.checks === 'read' && rv.permissions.statuses === 'read', '(costura) reviewer.yml debe conceder checks/statuses: read');
const cc = yaml.load(readFileSync('.github/workflows/claude-code.yml', 'utf8'));
const agente = Object.values(cc.jobs).flatMap(j => j.steps || []).find(s => s && s.id === 'creator');
afirma(agente && agente.name === 'Run Claude Code' && agente.env && agente.env.CI_READ_TOKEN === '${{ github.token }}', '(costura) el step del agente («Run Claude Code», id creator) debe llevar `CI_READ_TOKEN: ${{ github.token }}`');

if (ciStep.with && typeof ciStep.with.script === 'string') {
  const run = cargarStep(ciStep.with.script, 'Estado de CI del head');
  const core = () => { const w = []; return { w, warning: m => w.push(m), info: () => {}, notice: () => {} }; };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: { number: 5 } } };
  const montar = (conModulo) => {
    const ws = mkdtempSync(join(tmpdir(), 'ci-head-'));
    mkdirSync(join(ws, '.git/info'), { recursive: true });
    if (conModulo) { mkdirSync(join(ws, 'scripts')); copyFileSync(FUENTE, join(ws, 'scripts/ci-head.cjs')); }
    return ws;
  };
  { // con módulo: fichero escrito y `.pipeline/` excluido (idempotente)
    const ws = montar(true);
    const c = core();
    const g = simula({ runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'failure' }], anot: { 1: anotaciones(2) } });
    await run({ github: g, context, core: c }, { env: { GITHUB_WORKSPACE: ws } });
    await run({ github: g, context, core: c }, { env: { GITHUB_WORKSPACE: ws } });
    const f = join(ws, '.pipeline/ci-head.md');
    const t = existsSync(f) ? readFileSync(f, 'utf8') : '';
    afirma(t.split('\n')[0].includes(`SHA ${SHA}`) && filasAnot(t).length === 2, `(int) el step debe escribir el CI del head: ${JSON.stringify(t.slice(0, 200))}`);
    const ex = readFileSync(join(ws, '.git/info/exclude'), 'utf8').split('\n').filter(l => l === '.pipeline/');
    afirma(ex.length === 1, `(int) \`.pipeline/\` debe quedar en .git/info/exclude una sola vez (hay ${ex.length})`);
    rmSync(ws, { recursive: true, force: true });
  }
  { // sin módulo: fichero de fallo, warning, sin lanzar
    const ws = montar(false);
    const c = core();
    let lanzo = false;
    try { await run({ github: simula(), context, core: c }, { env: { GITHUB_WORKSPACE: ws } }); } catch { lanzo = true; }
    const f = join(ws, '.pipeline/ci-head.md');
    const t = existsSync(f) ? readFileSync(f, 'utf8') : '';
    afirma(!lanzo && /^lectura de CI falló: módulo no injertado$/m.test(t) && c.w.length > 0, `(int) sin módulo: ${JSON.stringify(t)} / lanzó=${lanzo}`);
    rmSync(ws, { recursive: true, force: true });
  }
} else afirma(false, '(int) el step de CI no tiene `with.script`');

if (fallos.length) {
  console.error('CHECK-CI-HEAD ROJO:');
  for (const f of fallos) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-ci-head verde: ${casos} casos sobre ${FUENTE}, el step «Estado de CI del head (AP-137)» de reviewer.yml y CI_READ_TOKEN de claude-code.yml.`);
