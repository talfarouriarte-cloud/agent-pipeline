#!/usr/bin/env node
// check-liveness-belts — banco de los belts de liveness de AP-091 (central#259,
// #212): preflight de credencial, clasificador de la sesión LLM, firma de
// FLOTA CAÍDA y belt de conclusiones del heartbeat.
//
// Los cuatro viven EMBEBIDOS en workflows (el preflight tiene que ser el
// PRIMER step del job, antes de cualquier checkout: no puede requerir un
// módulo del workspace). Por eso este banco no copia su lógica: EXTRAE el
// `script:` real de cada step por nombre y lo ejecuta contra un DOBLE de la
// API — la costura script↔API es justo lo que un banco de funciones puras no
// ve. Las copias del preflight (Creator y detect) y del clasificador (Creator,
// Reviewer, architect) deben ser IDÉNTICAS: una deriva entre copias es ROJO.
//
// Caso de reproducción de central#212 (178 rojos de la etapa architect sin
// escalada): historial sintético con la forma medida —architect en rojo en
// cada tick con anomalía, intercalado con ticks sin anomalía que concluyen
// `success` con architect `skipped`— DEBE escalar. Si el template anterior está
// en el clon, se ejecuta TAMBIÉN contra él y se exige que NO escale: eso es la
// reproducción del defecto, no solo el test del arreglo.
//
// Cuelga del piggyback de `check-embedded-js.mjs`.
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const fallos = [];
let casos = 0;

function stepScript(src, job, name) {
  const doc = yaml.load(src);
  const st = ((doc.jobs[job] || {}).steps || []).find(s => s.name === name);
  if (!st || !st.with || typeof st.with.script !== 'string') throw new Error(`step «${name}» no encontrado en job ${job}`);
  return st.with.script;
}
const leer = (f, job, name) => stepScript(readFileSync(f, 'utf8'), job, name);

// ── Doble de la API ──────────────────────────────────────────────────────────
function doble({ workflows = [], runs = {}, jobs = {}, issues = [], comments = {}, fetchStatus = [200], throwOn = null } = {}) {
  const log = { created: [], commented: [], outputs: {}, failed: null, warnings: [], dispatch: 0 };
  const guard = n => { if (throwOn === n) throw new Error(`API caída (${n})`); };
  const github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      issues: {
        listForRepo: async () => { guard('listForRepo'); return { data: issues }; },
        listComments: async p => ({ data: comments[p.issue_number] || [] }),
        create: async p => { log.created.push(p); return { data: { number: 9000 + log.created.length } }; },
        createComment: async p => { log.commented.push(p); return { data: {} }; },
      },
      actions: {
        getWorkflowRun: async () => { guard('getWorkflowRun'); return { data: { workflow_id: 3, html_url: 'https://x/run/self' } }; },
        listRepoWorkflows: async () => ({ data: workflows }),
        listWorkflowRuns: async p => {
          guard('listWorkflowRuns');
          return { data: { workflow_runs: (runs[p.workflow_id] || []).slice(0, p.per_page || 30) } };
        },
        listJobsForWorkflowRun: async p => ({ data: { jobs: jobs[p.run_id] || [] } }),
        createWorkflowDispatch: async () => { log.dispatch++; },
        downloadJobLogsForWorkflowRun: async () => ({ data: '' }),
      },
    },
  };
  const core = {
    info() {}, notice() {}, warning: m => log.warnings.push(String(m)),
    setOutput: (k, v) => { log.outputs[k] = String(v); },
    setFailed: m => { log.failed = String(m); },
  };
  let i = 0;
  const fetch = async () => ({ status: fetchStatus[Math.min(i++, fetchStatus.length - 1)], ok: false });
  return { github, core, fetch, log };
}

async function correr(script, env, d) {
  const context = { repo: { owner: 'o', repo: 'r' }, runId: 1, eventName: 'schedule' };
  const fn = new AsyncFunction('github', 'context', 'core', 'fetch', 'require', 'process', script);
  await fn(d.github, context, d.core, d.fetch, require, { env: { ...env } });
  return d.log;
}

async function caso(nombre, f) {
  casos++;
  try { const r = await f(); if (r !== true) fallos.push(`${nombre}: ${r}`); }
  catch (e) { fallos.push(`${nombre}: lanzó ${e.message}`); }
}

const MARK = '<!-- watchdog-heartbeat-escalation -->';
const anclado = (txt, m) => new RegExp('^[ \\t]*' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$', 'm').test(txt || '');
const CITA = { number: 77, body: 'Auditoría: el barrido contó 1 hit de `<!-- watchdog-heartbeat-escalation -->` citado en prosa.' };
const ABIERTA = mode => ({ number: 55, body: `escalada previa\n\n${mode}\n${MARK}` });
const j = x => JSON.stringify(x);

// ── 1. Preflight de credencial ──────────────────────────────────────────────
const PRE = 'Preflight de credencial (fail-fast, AP-091)';
const preCreator = leer('.github/workflows/claude-code.yml', 'claude', PRE);
const preDetect = leer('.github/workflows/watchdog.yml', 'detect', PRE);
if (preCreator !== preDetect) fallos.push('preflight: las copias de claude-code.yml y watchdog.yml DIVERGEN');
const MODE_401 = '<!-- pipeline-credential-401 -->';
const envPre = { PREFLIGHT_PAT: 'x', PREFLIGHT_ROLE: 'creator', PREFLIGHT_WAIT_MS: '1' };

await caso('preflight · 200 ⇒ sigue, sin escalada', async () => {
  const l = await correr(preCreator, envPre, doble({ fetchStatus: [200] }));
  return (l.outputs.dead === 'false' && !l.failed && !l.created.length) || j(l);
});
await caso('preflight · 401,401 ⇒ escala (marcadores anclados) y aborta', async () => {
  const l = await correr(preCreator, envPre, doble({ fetchStatus: [401, 401] }));
  const c = l.created[0];
  return (l.outputs.dead === 'true' && !!l.failed && l.created.length === 1 && c.labels.includes('human-needed')
    && anclado(c.body, MODE_401) && anclado(c.body, MARK)) || j(l);
});
await caso('preflight · 401 transitorio (401,200) ⇒ sigue', async () => {
  const l = await correr(preCreator, envPre, doble({ fetchStatus: [401, 200] }));
  return (l.outputs.dead === 'false' && !l.failed && !l.created.length) || j(l);
});
await caso('preflight · 503,503 ⇒ fail-open con aviso', async () => {
  const l = await correr(preCreator, envPre, doble({ fetchStatus: [503, 503] }));
  return (l.outputs.dead === 'false' && !l.failed && !l.created.length && l.warnings.length === 1) || j(l);
});
await caso('preflight · marcador CITADO en otro human-needed NO silencia (central#212)', async () => {
  const l = await correr(preCreator, envPre, doble({ fetchStatus: [401, 401], issues: [CITA] }));
  return (l.created.length === 1 && !l.commented.length) || j(l);
});
await caso('preflight · escalada abierta en otro modo ⇒ transición por comentario', async () => {
  const l = await correr(preCreator, envPre, doble({ fetchStatus: [401, 401], issues: [ABIERTA('<!-- watchdog-detect-red-streak -->')] }));
  return (!l.created.length && l.commented.length === 1 && anclado(l.commented[0].body, MODE_401) && !!l.failed) || j(l);
});
await caso('preflight · modo ya declarado ⇒ idempotente', async () => {
  const l = await correr(preCreator, envPre, doble({ fetchStatus: [401, 401], issues: [ABIERTA(MODE_401)] }));
  return (!l.created.length && !l.commented.length && !!l.failed) || j(l);
});

// ── 2. Clasificador de la sesión LLM ────────────────────────────────────────
const CLS = 'Clasificar la ejecución LLM (firma de flota, AP-091)';
const clsC = leer('.github/workflows/claude-code.yml', 'claude', CLS);
const clsR = leer('.github/workflows/reviewer.yml', 'review', CLS);
const clsA = leer('.github/workflows/watchdog.yml', 'architect', CLS);
if (clsC !== clsR || clsC !== clsA) fallos.push('clasificador: las copias de Creator/Reviewer/architect DIVERGEN (el detect lee las tres por el mismo nombre de step)');
const tmp = mkdtempSync(join(tmpdir(), 'lvb-'));
const exec = (nombre, json) => { const f = join(tmp, nombre); if (json !== null) writeFileSync(f, JSON.stringify(json)); return f; };
const RES = o => [{ type: 'system', subtype: 'init' }, { type: 'result', subtype: 'success', is_error: true, ...o }];
for (const [nombre, f, esperado] of [
  ['muerte instantánea medida en finplan PR #2085 (num_turns 1, coste 0, modelUsage {})', exec('a.json', RES({ num_turns: 1, total_cost_usd: 0, modelUsage: {} })), 'instant'],
  ['sesión viva', exec('b.json', RES({ num_turns: 14, total_cost_usd: 1.3, modelUsage: { 'claude-opus-5-5': { inputTokens: 9 } } })), 'alive'],
  ['firma incompleta: coste > 0', exec('c.json', RES({ num_turns: 1, total_cost_usd: 0.02, modelUsage: {} })), 'alive'],
  ['firma no juzgable: sin campo modelUsage', exec('d.json', RES({ num_turns: 1, total_cost_usd: 0 })), 'ilegible'],
  ['firma no juzgable: sin campo total_cost_usd', exec('e.json', RES({ num_turns: 1, modelUsage: {} })), 'ilegible'],
  ['sin coste pero con turnos > 1', exec('f.json', RES({ num_turns: 9, modelUsage: {} })), 'alive'],
  ['execution file ausente', exec('no-existe.json', null), 'ilegible'],
]) await caso(`clasificador · ${nombre} ⇒ ${esperado}`, async () => {
  const k = (await correr(clsC, { EXEC_FILE: f }, doble())).outputs.kind;
  return k === esperado || `dio ${k}`;
});

// ── 3. Firma de FLOTA CAÍDA (detect) ────────────────────────────────────────
const FLEET = leer('.github/workflows/watchdog.yml', 'detect', 'Firma de flota caída (AP-091)');
const FLEET_ARCH = leer('.github/workflows/watchdog.yml', 'architect', 'Firma de flota caída (AP-091)');
if (FLEET !== FLEET_ARCH) fallos.push('flota: las copias de detect y de la etapa architect DIVERGEN');
const MODE_FLEET = '<!-- pipeline-fleet-down -->';
// Costura productor↔consumidor (review de #280): la firma de flota lee los
// steps-marcador POR NOMBRE, y el doble de la API no puede fabricarlos por su
// cuenta — un renombrado o un typo en UN workflow dejaría esa etapa en `none`
// (neutra) para siempre con todo en verde. Los nombres se extraen del script
// real de la firma y se exigen, con su `if:`, en los tres jobs productores.
const constante = n => { const m = FLEET.match(new RegExp(`const ${n} = '([^']+)';`)); if (!m) throw new Error(`flota: constante ${n} no encontrada en el script`); return m[1]; };
const STEP_DEAD = constante('STEP_DEAD'), STEP_ALIVE = constante('STEP_ALIVE');
for (const [f, job] of [['.github/workflows/claude-code.yml', 'claude'], ['.github/workflows/reviewer.yml', 'review'], ['.github/workflows/watchdog.yml', 'architect']]) {
  casos++;
  const steps = (yaml.load(readFileSync(f, 'utf8')).jobs[job] || {}).steps || [];
  const cls = steps.find(s => s.name === CLS);
  if (!cls || cls.id !== 'llm_exec') fallos.push(`flota: ${f} job ${job} — el clasificador no existe o su id no es \`llm_exec\``);
  for (const [nombre, kind] of [[STEP_DEAD, 'instant'], [STEP_ALIVE, 'alive']]) {
    const st = steps.filter(s => s.name === nombre);
    const gate = new RegExp(`steps\\.llm_exec\\.outputs\\.kind\\s*==\\s*'${kind}'`);
    if (st.length !== 1) fallos.push(`flota: ${f} job ${job} — ${st.length} steps «${nombre}» (se exige exactamente 1 con el nombre que lee la firma de flota)`);
    else if (!gate.test(String(st[0].if || ''))) fallos.push(`flota: ${f} job ${job} — el step «${nombre}» no está gateado por \`steps.llm_exec.outputs.kind == '${kind}'\` (if: ${st[0].if})`);
  }
}
const WFS = [{ id: 1, name: 'Claude Code' }, { id: 2, name: 'Opus Reviewer' }, { id: 3, name: 'Watchdog' }];
const envFleet = { IN_CREATOR_WF: 'Claude Code', IN_REVIEWER_WF: 'Opus Reviewer' };
const marcador = k => [{ name: STEP_DEAD, conclusion: k === 'instant' ? 'success' : 'skipped' },
  { name: STEP_ALIVE, conclusion: k === 'alive' ? 'success' : 'skipped' }];
// Secuencia, más reciente primero: [workflow_id, instant|alive|none]. Un minuto
// entre runs; `haceMin` desplaza toda la historia hacia el pasado (frescura).
function flota(seq, haceMin = 0) {
  const runs = {}, jobs = {};
  seq.forEach(([wf, k], i) => {
    const id = 100 + i;
    (runs[wf] = runs[wf] || []).push({ id, name: WFS[wf - 1].name, conclusion: k === 'alive' ? 'success' : 'failure',
      updated_at: new Date(Date.now() - (haceMin + i + 1) * 60000).toISOString(), html_url: `https://x/run/${id}` });
    jobs[id] = [{ name: 'job', conclusion: 'failure', steps: k === 'none' ? [{ name: 'Scan', conclusion: 'success' }] : marcador(k) }];
  });
  return { workflows: WFS, runs, jobs };
}
await caso('flota · 3 muertes instantáneas de architect ⇒ escala', async () => {
  const l = await correr(FLEET, envFleet, doble(flota([[3, 'instant'], [3, 'instant'], [3, 'instant'], [1, 'alive']])));
  return (l.created.length === 1 && anclado(l.created[0].body, MODE_FLEET) && anclado(l.created[0].body, MARK) && l.outputs.fleet_down === 'true') || j(l);
});
await caso('flota · 2 muertes y una sesión viva ⇒ no escala', async () => {
  const l = await correr(FLEET, envFleet, doble(flota([[3, 'instant'], [2, 'instant'], [1, 'alive'], [3, 'instant']])));
  return (!l.created.length && l.outputs.fleet_down === 'false') || j(l);
});
await caso('flota · etapas mezcladas con un run sin sesión (neutro) ⇒ escala', async () => {
  const l = await correr(FLEET, envFleet, doble(flota([[1, 'instant'], [3, 'none'], [2, 'instant'], [3, 'instant']])));
  return l.created.length === 1 || j(l);
});
await caso('flota · escalada abierta en otro modo ⇒ transición por comentario', async () => {
  const l = await correr(FLEET, envFleet, doble({ ...flota([[3, 'instant'], [3, 'instant'], [3, 'instant']]), issues: [ABIERTA(MODE_401)] }));
  return (!l.created.length && l.commented.length === 1 && anclado(l.commented[0].body, MODE_FLEET)) || j(l);
});
await caso('flota · etapa architect: la 3.ª muerte es la de ESTE run ⇒ escala en el mismo tick', async () => {
  const l = await correr(FLEET_ARCH, { ...envFleet, FLEET_SELF_KIND: 'instant' }, doble(flota([[3, 'instant'], [2, 'instant'], [1, 'alive']])));
  return (l.created.length === 1 && anclado(l.created[0].body, MODE_FLEET)) || j(l);
});
await caso('flota · la misma historia vista desde detect (sin run propio) ⇒ aún no escala', async () => {
  const l = await correr(FLEET, envFleet, doble(flota([[3, 'instant'], [2, 'instant'], [1, 'alive']])));
  return !l.created.length || j(l);
});
await caso('flota · solo el resolver cae (Creator vivo intercalado) ⇒ escala POR ETAPA', async () => {
  const l = await correr(FLEET, envFleet, doble(flota([[3, 'instant'], [1, 'alive'], [3, 'none'], [3, 'instant'], [2, 'alive'], [3, 'instant']])));
  return (l.created.length === 1 && /etapa Watchdog · architect/.test(l.created[0].body)) || j(l);
});
await caso('flota · resolver: 3.ª muerte en ESTE run con Creator vivo intercalado ⇒ escala en el mismo tick', async () => {
  const l = await correr(FLEET_ARCH, { ...envFleet, FLEET_SELF_KIND: 'instant' }, doble(flota([[3, 'instant'], [1, 'alive'], [3, 'instant']])));
  return l.created.length === 1 || j(l);
});
await caso('flota · resolver con una sesión viva propia entre medias ⇒ no escala', async () => {
  const l = await correr(FLEET, envFleet, doble(flota([[3, 'instant'], [3, 'instant'], [3, 'alive'], [3, 'instant']])));
  return !l.created.length || j(l);
});
await caso('flota · 3 muertes de hace 6 h y ninguna sesión después ⇒ NO escala (frescura; cerrar el issue es seguro)', async () => {
  const l = await correr(FLEET, envFleet, doble(flota([[2, 'instant'], [2, 'instant'], [2, 'instant'], [1, 'alive']], 360)));
  return (!l.created.length && l.outputs.fleet_down === 'false') || j(l);
});
await caso('flota · etapa architect: muerte PROPIA sobre 2 muertes viejas ⇒ escala (el eslabón propio es fresco)', async () => {
  const l = await correr(FLEET_ARCH, { ...envFleet, FLEET_SELF_KIND: 'instant' }, doble(flota([[3, 'instant'], [3, 'instant']], 360)));
  return l.created.length === 1 || j(l);
});
await caso('flota · presupuesto de listJobs agotado con racha a medias ⇒ avisa (no reset mudo)', async () => {
  const l = await correr(FLEET, envFleet, doble(flota([[3, 'instant'], ...Array.from({ length: 29 }, () => [3, 'none'])])));
  return (!l.created.length && l.warnings.some(w => /presupuesto/.test(w))) || j(l);
});
await caso('flota · API caída ⇒ fail-soft (no lanza, avisa)', async () => {
  const l = await correr(FLEET, envFleet, doble({ throwOn: 'getWorkflowRun' }));
  return (!l.created.length && l.warnings.length === 1) || j(l);
});

// ── 4. Heartbeat: belt de conclusiones (reproducción de central#212) ─────────
const HB_PATH = 'templates/watchdog-heartbeat.template.yml';
const HB_STEP = 'Revivir watchdog si está muerto (o escalar si corre y falla)';
const HB = leer(HB_PATH, 'heartbeat', HB_STEP);
const MODE_STAGE = '<!-- watchdog-stage-red-streak -->';
const MODE_RED = '<!-- watchdog-detect-red-streak -->';
const ahora = Date.now();
// Más reciente primero: [conclusión del run, conclusión de architect | null (no existió)].
function hist(forma) {
  const rs = [], jobs = {};
  forma.forEach(([rc, arch], i) => {
    const id = 500 + i;
    rs.push({ id, status: 'completed', conclusion: rc, created_at: new Date(ahora - (i + 1) * 10 * 60000).toISOString() });
    jobs[id] = [{ name: 'watchdog / detect', conclusion: rc === 'failure' && arch === null ? 'failure' : 'success' },
      ...(arch ? [{ name: 'watchdog / architect', conclusion: arch }] : [])];
  });
  return { runs: { 'watchdog.yml': rs }, jobs };
}
// Forma medida en finplan PR #2085: architect rojo en cada tick con anomalía,
// intercalado con ticks sin anomalía (run `success`, architect `skipped`).
const FORMA_212 = Array.from({ length: 30 }, (_, i) => i % 2 === 0 ? ['failure', 'failure'] : ['success', 'skipped']);

await caso('heartbeat · forma de central#212 (architect rojo intercalado con success) ⇒ ESCALA', async () => {
  const l = await correr(HB, {}, doble(hist(FORMA_212)));
  return (l.created.length === 1 && anclado(l.created[0].body, MODE_STAGE) && anclado(l.created[0].body, MARK)) || j(l);
});
await caso('heartbeat · marcador CITADO en otro human-needed NO silencia', async () => {
  const l = await correr(HB, {}, doble({ ...hist([['failure', null], ['failure', null], ['failure', null]]), issues: [CITA] }));
  return (l.created.length === 1 && anclado(l.created[0].body, MODE_RED)) || j(l);
});
await caso('heartbeat · detect rojo K=3 a nivel de run ⇒ sigue escalando (regresión AP-059)', async () => {
  const l = await correr(HB, {}, doble(hist([['failure', null], ['failure', null], ['failure', null], ['success', 'skipped']])));
  return (l.created.length === 1 && anclado(l.created[0].body, MODE_RED)) || j(l);
});
await caso('heartbeat · architect rojo K=3 hace >3 h y solo ticks sin anomalía después ⇒ NO escala (frescura del rojo)', async () => {
  const forma = [...Array.from({ length: 20 }, () => ['success', 'skipped']), ['failure', 'failure'], ['failure', 'failure'], ['failure', 'failure']];
  const l = await correr(HB, {}, doble(hist(forma)));
  return (!l.created.length && !l.commented.length && !l.dispatch) || j(l);
});
await caso('heartbeat · sano (architect success reciente) ⇒ no escala', async () => {
  const l = await correr(HB, {}, doble(hist([['success', 'success'], ['failure', 'failure'], ['failure', 'failure'], ['success', 'skipped']])));
  return (!l.created.length && !l.commented.length && !l.dispatch) || j(l);
});

// Reproducción del defecto contra el template ANTERIOR a AP-091, si está en el
// clon. Fail-open ANUNCIADO: con `fetch-depth: 1` (CI) no hay historia.
let repro = 'no ejecutada (template anterior no disponible en el clon)';
try {
  const revs = execFileSync('git', ['log', '--format=%H %s', '--', HB_PATH], { stdio: 'pipe' }).toString().trim().split('\n');
  const previa = revs.find(l => l && !/ AP-091/.test(l));
  const rev = previa && previa.split(' ')[0];
  const viejo = rev && stepScript(execFileSync('git', ['show', `${rev}:${HB_PATH}`], { stdio: 'pipe' }).toString(), 'heartbeat', HB_STEP);
  if (viejo && viejo !== HB) {
    casos++;
    const l = await correr(viejo, {}, doble(hist(FORMA_212)));
    if (l.created.length || l.commented.length) fallos.push(`reproducción: el template anterior (${rev.slice(0, 7)}) SÍ escala la forma de #212 — el banco no reproduce el defecto`);
    else repro = `reproducida (el template ${rev.slice(0, 7)} NO escala la forma de #212; el vigente sí)`;
  }
} catch (e) { repro = `no ejecutada (${String(e.message).split('\n')[0]})`; }

if (fallos.length) {
  console.error('CHECK-LIVENESS-BELTS ROJO:');
  fallos.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(`check-liveness-belts verde: ${casos} casos · reproducción de central#212: ${repro}.`);
