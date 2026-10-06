#!/usr/bin/env node
// check-pausa-cola — banco de casos EJECUTABLE del interruptor global
// `pausa-cola` (central#314, ruling mensual 2026-10-05, punto 8).
//
// Los casos corren el módulo REAL (`vendored/scripts/cola-prioridad.cjs`:
// `leerPausa`, `retenerEslabon`, `retenerArm`, `liberarCola`) contra una API
// de GitHub en memoria, y el guard serial EMBEBIDO real de `claude-code.yml`
// (step `check_serial`, el que lleva la retención del arm desde issue) con el
// módulo inyectado. La costura con los demás puntos (los cuatro de cola, los
// tres consumidores de `launch-next` y el scan del Watchdog) se comprueba por
// texto cuando los workflows existen (en el central; en el consumidor llegan
// por `workflow_call` y se omite).
//
// Casos del ruling: (a) pausa + merge de eslabón ⇒ eslabón a cola, nada
// armado; (b) pausa + merge de suelto ⇒ nada armado; (c) pausa + arm manual de
// issue ⇒ `en-cola` + marcador, sin sesión; (d) pausa + ping sobre PR abierto
// ⇒ pasa; (e) retirada de pausa ⇒ un solo arm de la cabeza; (f) consulta
// fallida ⇒ comportamiento actual.
//
// Verde: exit 0. Rojo: el comportamiento real cambió y el banco lo nota.
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);

// Central primero (fichero FUENTE); el consumidor lo recibe en `scripts/`.
const FUENTES = ['vendored/scripts/cola-prioridad.cjs', 'scripts/cola-prioridad.cjs'];
let fuente = null;
let m = null;
for (const f of FUENTES) {
  if (!existsSync(f)) continue;
  m = require(resolve(f));   // un SyntaxError aquí es ROJO, y debe serlo
  fuente = f;
  break;
}
if (!m) {
  console.log('::warning::check-pausa-cola — no encuentro `cola-prioridad.cjs` en ninguna de sus dos ubicaciones: el banco NO se ha ejecutado.');
  process.exit(0);
}
if (!m.leerPausa) {
  console.error(`CHECK-PAUSA-COLA ROJO (${fuente}): el módulo no exporta \`leerPausa\`.`);
  process.exit(1);
}

const fallos = [];
const caso = (nombre, ok) => { if (!ok) fallos.push(nombre); };

// ── API de GitHub en memoria ────────────────────────────────────────────────
// `pausaRota`: la consulta `labels=pausa-cola` lanza (5xx). `prs`: PRs abiertos.
// `prsRotos`: `pulls.list` lanza (5xx).
function repoFalso(issues, { prs = [], pausaRota = false, prsRotos = false } = {}) {
  const st = new Map();
  for (const i of issues) st.set(i.number, { state: 'open', comments: [], ...i, labels: [...(i.labels || [])] });
  const vista = (i) => ({ number: i.number, state: i.state, created_at: i.created_at, title: `Issue ${i.number}`, labels: i.labels.map((name) => ({ name })) });
  let cid = 1000;
  const escrituras = [];
  const R = { st, prs, escrituras, owner: 'o', repo: 'r', pausaRota };
  R.github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      pulls: { async list() { if (prsRotos) throw new Error('502 Bad Gateway'); return { data: R.prs.map((p) => ({ ...p })) }; } },
      actions: {
        async listWorkflowRunsForRepo() { return { data: { workflow_runs: [] } }; },
        async listJobsForWorkflowRun() { return { data: { jobs: [] } }; },
      },
      issues: {
        async listForRepo({ state, labels }) {
          if (labels === 'pausa-cola' && R.pausaRota) throw new Error('502 Bad Gateway');
          const data = [...st.values()]
            .filter((i) => (!state || i.state === state) && (!labels || i.labels.includes(labels)))
            .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
            .map(vista);
          return { data };
        },
        async listComments({ issue_number }) { return { data: [...st.get(issue_number).comments] }; },
        async listCommentsForRepo({ since }) {
          const corte = Date.parse(since);
          const data = [];
          for (const i of st.values()) for (const c of i.comments) if (Date.parse(c.created_at) >= corte) data.push(c);
          return { data };
        },
        async addLabels({ issue_number, labels }) {
          const i = st.get(issue_number);
          for (const l of labels) if (!i.labels.includes(l)) i.labels.push(l);
          escrituras.push(`label+ #${issue_number} ${labels.join(',')}`);
          return { data: {} };
        },
        async removeLabel({ issue_number, name }) {
          const i = st.get(issue_number);
          i.labels = i.labels.filter((l) => l !== name);
          escrituras.push(`label- #${issue_number} ${name}`);
          return { data: {} };
        },
        async createComment({ issue_number, body }) {
          // El PAT del propietario: autor de confianza, como en producción.
          st.get(issue_number).comments.push({ id: cid, body, author_association: 'OWNER',
            created_at: new Date().toISOString(), html_url: `https://github.com/o/r/issues/${issue_number}#issuecomment-${cid}` });
          cid++;
          escrituras.push(`comment #${issue_number}`);
          return { data: {} };
        },
      },
    },
  };
  return R;
}

const ARM_RE = /@claude|<!-- arm-de-cola -->|<!-- epic-auto-launch -->/;
const armados = (R) => [...R.st.values()].filter((i) => i.comments.some((c) => ARM_RE.test(c.body))).map((i) => i.number);
const lbl = (i, R) => R.st.get(i).labels;
const coment = (i, R) => R.st.get(i).comments.map((c) => c.body).join('\n');
const T = (d) => `2026-10-0${d}T10:00:00Z`;

// El pop de cola tal y como lo hacen los cuatro puntos (`armQueue`,
// `sweepQueueAtExit`, `popQueue`, «Barrido de cola al cierre»): leer la pausa;
// en pausa, nada; si no, la cabeza por el orden de central#313.
async function pop(R) {
  const pausa = await m.leerPausa(R);
  if (pausa.pausado) return { retenido: true, armado: null };
  const head = (await m.ordenarConSuspension({ ...R, items: await m.leerCola(R) }))[0];
  if (!head) return { retenido: false, armado: null };
  await R.github.rest.issues.removeLabel({ owner: R.owner, repo: R.repo, issue_number: head.number, name: 'en-cola' });
  await R.github.rest.issues.createComment({ owner: R.owner, repo: R.repo, issue_number: head.number,
    body: `@claude arranca — turno de cola. ${m.describir(head)}\n\n<!-- arm-de-cola -->` });
  return { retenido: false, armado: head.number };
}

// Consumidor de `launch-next` (postMerge / postStateClose / step `launch_next`):
// en pausa retiene #N y NO arma; si no, la cesión de AP-102 o el arm de cadena.
async function consumirLaunchNext(R, siguiente, origenNum = 10) {
  const pausa = await m.leerPausa(R);
  if (pausa.pausado) {
    await m.retenerEslabon({ ...R, siguiente, origen: `merge de #${origenNum}`, origenNum, pausa });
    return { retenido: true, armado: null };
  }
  const urgente = await m.cederEslabon({ ...R, siguiente, origen: `merge de #${origenNum}`, origenNum });
  if (urgente) return { retenido: false, armado: (await pop(R)).armado };
  if (await m.yaSuspendido({ ...R, siguiente })) return { retenido: false, armado: null };
  await R.github.rest.issues.createComment({ owner: R.owner, repo: R.repo, issue_number: siguiente,
    body: '@claude\n\nArranque automático de épica.\n\n<!-- epic-auto-launch -->' });
  return { retenido: false, armado: siguiente };
}

// ── Guard serial EMBEBIDO real (step `check_serial` de claude-code.yml) ─────
const CC = '.github/workflows/claude-code.yml';
let guardScript = null;
if (existsSync(CC)) {
  const wf = yaml.load(readFileSync(CC, 'utf8'));
  for (const job of Object.values(wf.jobs || {})) for (const s of job.steps || []) if (s.id === 'check_serial') guardScript = s.with.script;
  caso('claude-code: step `check_serial` presente', !!guardScript);
}
// `require` inyectado: cualquier ruta a `cola-prioridad.cjs` resuelve al módulo
// fuente (en Actions vive en `.cola-central/` o en `scripts/`).
const reqInyectado = (p) => (String(p).endsWith('cola-prioridad.cjs') ? m : require(p));
async function guard(R, issueNumber, armBody, { epica = false } = {}) {
  const run = cargarStep(guardScript, 'check_serial');
  const i = R.st.get(issueNumber);
  const issue = { number: issueNumber, title: `Issue ${issueNumber}`, created_at: i.created_at,
    labels: [...i.labels, ...(epica ? ['epica'] : [])].map((name) => ({ name })) };
  const out = { outputs: {}, warnings: [] };
  const context = { repo: { owner: R.owner, repo: R.repo }, runId: 500, workflow: 'Claude Code', eventName: 'issue_comment',
    payload: { issue, comment: { body: armBody, created_at: new Date().toISOString() } } };
  const core = { setOutput: (k, v) => { out.outputs[k] = String(v); }, notice() {}, info() {}, warning: (w) => out.warnings.push(String(w)) };
  const prevEpic = process.env.IN_EPIC_LABEL;
  process.env.IN_EPIC_LABEL = 'epica';
  try { await run({ github: R.github, context, core, require: reqInyectado }); }
  finally { if (prevEpic === undefined) delete process.env.IN_EPIC_LABEL; else process.env.IN_EPIC_LABEL = prevEpic; }
  return out;
}
const PAUSA_ISSUE = { number: 1, created_at: T(1), labels: ['pausa-cola'] };

// ── (a) pausa + merge de eslabón ⇒ eslabón a cola, nada armado
{
  const R = repoFalso([PAUSA_ISSUE,
    { number: 5, created_at: T(1), labels: ['en-cola'] },
    { number: 8, created_at: T(2), labels: ['en-cola', 'prioridad:urgente'] },
    { number: 11, created_at: T(3), labels: ['epica'] }]);
  const r = await consumirLaunchNext(R, 11, 10);
  const p = await pop(R);  // `armQueue` tras el merge
  caso('(a) pausa + merge de eslabón ⇒ el eslabón #11 queda `en-cola`', r.retenido && lbl(11, R).includes('en-cola'));
  caso('(a) …con `<!-- pausa-cola-retenido: #10 -->` y `<!-- eslabon-suspendido: #10 -->` en línea propia',
    /^<!-- pausa-cola-retenido: #10 -->$/m.test(coment(11, R)) && /^<!-- eslabon-suspendido: #10 -->$/m.test(coment(11, R)));
  caso('(a) …y NADA armado: ni el eslabón, ni la urgente en cola, ni la normal', armados(R).length === 0 && p.retenido && p.armado === null);
  caso('(a) …el `launch-next` cuenta como consumido (`yaSuspendido`)', await m.yaSuspendido({ ...R, siguiente: 11 }));
  // Segundo consumidor del MISMO launch-next (ADR-193 opción A): idempotente.
  const antes = R.st.get(11).comments.length;
  await consumirLaunchNext(R, 11, 10);
  caso('(a) …el otro consumidor del mismo `launch-next` no duplica el comentario ni arma', R.st.get(11).comments.length === antes && armados(R).length === 0);
}

// ── (b) pausa + merge de suelto ⇒ nada armado
{
  const R = repoFalso([PAUSA_ISSUE,
    { number: 5, created_at: T(1), labels: ['en-cola'] },
    { number: 6, created_at: T(2), labels: ['en-cola', 'prioridad:alta'] }]);
  const p = await pop(R);  // `armQueue('merge del suelto …')`
  caso('(b) pausa + merge de suelto ⇒ el pop queda retenido, nada armado', p.retenido && armados(R).length === 0);
  caso('(b) …la cola sigue intacta, sin una sola escritura', lbl(5, R).includes('en-cola') && lbl(6, R).includes('en-cola') && R.escrituras.length === 0);
}

// ── (c) pausa + arm manual de issue ⇒ `en-cola` + marcador, sin sesión
if (guardScript) {
  const R = repoFalso([PAUSA_ISSUE, { number: 20, created_at: T(2), labels: [] }]);
  const w = await guard(R, 20, '@claude arranca');
  caso('(c) pausa + arm manual ⇒ el guard bloquea (sin sesión)', w.outputs.blocked === 'true');
  caso('(c) …el issue queda `en-cola` con `<!-- pausa-cola-retenido -->`', lbl(20, R).includes('en-cola') && /^<!-- pausa-cola-retenido -->$/m.test(coment(20, R)));
  caso('(c) …sin `serial-activo` ni `stalled`', !lbl(20, R).includes('serial-activo') && !lbl(20, R).includes('stalled'));
  caso('(c) …un arm suelto NO lleva `eslabon-suspendido`', !/eslabon-suspendido/.test(coment(20, R)));
  const w2 = await guard(R, 20, '@claude otra vez');
  caso('(c) …segundo arm en la misma pausa ⇒ bloqueado, SIN segundo comentario (dedup por marcador)', w2.outputs.blocked === 'true' && R.st.get(20).comments.length === 1);
  // `serial-ok` no salta la pausa.
  const Rok = repoFalso([PAUSA_ISSUE, { number: 22, created_at: T(2), labels: ['serial-ok'] }]);
  const wok = await guard(Rok, 22, '@claude');
  caso('(c) `serial-ok` NO salta la pausa', wok.outputs.blocked === 'true' && lbl(22, Rok).includes('en-cola'));
  // Re-arm de cadena (epic-auto-launch) de un eslabón ⇒ conserva la exención de cadena al salir por la cola.
  const R2 = repoFalso([PAUSA_ISSUE, { number: 21, created_at: T(2), labels: [] }]);
  const w3 = await guard(R2, 21, '@claude\n\nArranque automático de épica tras merge de #9.\n\n<!-- epic-auto-launch -->', { epica: true });
  caso('(c) re-arm de cadena retenido ⇒ lleva además `eslabon-suspendido` (los guards de cadena/panel lo reconocen al salir)',
    w3.outputs.blocked === 'true' && m.esSuspendido(R2.st.get(21).comments));
  // Un arm-de-cola posterior abre un episodio nuevo: la siguiente retención vuelve a comentar.
  R.st.get(20).comments.push({ id: 1, body: '@claude arranca — turno de cola.\n\n<!-- arm-de-cola -->', author_association: 'OWNER', created_at: new Date().toISOString() });
  await guard(R, 20, '@claude arranca — turno de cola.\n\n<!-- arm-de-cola -->');
  caso('(c) …episodio nuevo (tras un `arm-de-cola`) ⇒ vuelve a dejar rastro', R.st.get(20).comments.filter((c) => /pausa-cola-retenido/.test(c.body)).length === 2);
}

// ── (d) pausa + ping sobre PR abierto ⇒ pasa
if (guardScript) {
  // Contexto PR: el guard serial no corre (su `if` exige contexto issue).
  const wf = readFileSync(CC, 'utf8');
  const ifSerial = (wf.match(/id: check_serial\n\s+if: \|([\s\S]*?)\n\s+uses:/) || [])[1] || '';
  caso('(d) contexto PR (rondas Reviewer↔Creator) ⇒ el step del guard no corre: su `if` exige issue sin PR',
    /github\.event_name == 'issue_comment' && !github\.event\.issue\.pull_request/.test(ifSerial) && /github\.event_name == 'issues'/.test(ifSerial));
  // Continuación desde el issue con PR propio abierto (fast-path AP-048) ⇒ no se retiene.
  const R = repoFalso([PAUSA_ISSUE, { number: 30, created_at: T(2), labels: [] }],
    { prs: [{ number: 31, title: 'PR de #30', head: { ref: 'claude/issue-30-20261005-1200' } }] });
  await guard(R, 30, '@claude continúa');
  caso('(d) issue con PR `claude/issue-N-*` abierto ⇒ la pausa NO lo retiene (trabajo en vuelo)', !/pausa-cola-retenido/.test(coment(30, R)));
  const R2 = repoFalso([PAUSA_ISSUE, { number: 32, created_at: T(2), labels: ['serial-activo'] }]);
  await guard(R2, 32, '@claude');
  caso('(d) issue con `serial-activo` (en vuelo) ⇒ la pausa NO lo re-etiqueta `en-cola`', !lbl(32, R2).includes('en-cola') && !/pausa-cola-retenido/.test(coment(32, R2)));
  // `pulls.list` fallida ⇒ en vuelo desconocido: no se retiene, decide el guard serial (review #316 🔵 3).
  const R3 = repoFalso([PAUSA_ISSUE, { number: 34, created_at: T(2), labels: [] }], { prsRotos: true });
  const w3 = await guard(R3, 34, '@claude continúa').catch(() => ({ outputs: {}, warnings: [] }));
  caso('(d) `pulls.list` fallida ⇒ la pausa NO retiene (en vuelo desconocido, pasa al guard serial)',
    !/pausa-cola-retenido/.test(coment(34, R3)) && !w3.warnings.some((w) => /retenido en cola/.test(w)));
}

// ── (e) retirada de pausa ⇒ un solo arm de la cabeza
{
  const R = repoFalso([PAUSA_ISSUE,
    { number: 5, created_at: T(1), labels: ['en-cola'] },
    { number: 11, created_at: T(3), labels: ['epica'] }]);
  await consumirLaunchNext(R, 11, 10);   // eslabón retenido durante la pausa
  const armar = async (next) => {
    await R.github.rest.issues.removeLabel({ owner: 'o', repo: 'r', issue_number: next.number, name: 'en-cola' });
    await R.github.rest.issues.createComment({ owner: 'o', repo: 'r', issue_number: next.number, body: `@claude arranca — turno de cola. ${m.describir(next)}\n\n<!-- arm-de-cola -->` });
  };
  const enPausa = await m.liberarCola({ ...R, armar });
  caso('(e) con la pausa aún puesta, el barrido de liberación no arma', enPausa.accion === 'retenido' && armados(R).length === 0);
  R.st.get(1).state = 'closed';   // el humano cierra el issue de pausa
  const r1 = await m.liberarCola({ ...R, armar });
  caso('(e) retirada de pausa ⇒ arma la cabeza: el eslabón retenido #11 (nivel 2) antes que la normal #5, más antigua',
    r1.accion === 'armado' && r1.numero === 11 && /nivel 2: eslabón suspendido/.test(coment(11, R)) && !lbl(11, R).includes('en-cola'));
  const r2 = await m.liberarCola({ ...R, armar });
  caso('(e) …UN SOLO arm: un segundo barrido inmediato ve el arm reciente y no arma', r2.accion === 'no-op' && /arm reciente/.test(r2.motivo) && armados(R).join() === '11');
  caso('(e) …la normal #5 sigue en cola', lbl(5, R).includes('en-cola') && !/arm-de-cola/.test(coment(5, R)));
  // Serie ocupada (PR claude/* abierto) ⇒ fail-closed: no arma.
  const R2 = repoFalso([{ number: 5, created_at: T(1), labels: ['en-cola'] }], { prs: [{ number: 40, head: { ref: 'claude/issue-39-x' } }] });
  const r4 = await m.liberarCola({ ...R2, armar: async () => { throw new Error('no debía armar'); } });
  caso('(e) serie ocupada por un PR `claude/*` ⇒ el barrido no arma (fail-closed)', r4.accion === 'no-op' && /ocupada/.test(r4.motivo));
  const R3 = repoFalso([{ number: 5, created_at: T(1), labels: ['en-cola'] }, { number: 6, created_at: T(1), labels: ['serial-activo'] }]);
  const r5 = await m.liberarCola({ ...R3, armar: async () => { throw new Error('no debía armar'); } });
  caso('(e) serie ocupada por `serial-activo` ⇒ el barrido no arma (fail-closed)', r5.accion === 'no-op' && /serial-activo/.test(r5.motivo));
}

// ── (f) consulta fallida ⇒ comportamiento actual
{
  const R = repoFalso([PAUSA_ISSUE, { number: 5, created_at: T(1), labels: ['en-cola'] }, { number: 11, created_at: T(3), labels: ['epica'] }], { pausaRota: true });
  const avisos = [];
  const p = await m.leerPausa({ ...R, warn: (w) => avisos.push(w) });
  caso('(f) consulta fallida ⇒ fail-open (`pausado: false`) con aviso', p.pausado === false && !!p.error && avisos.length === 1 && /fail-open/.test(avisos[0]));
  const r = await consumirLaunchNext(R, 11, 10);
  caso('(f) …el merge de eslabón arma por su cadena, como hoy', !r.retenido && r.armado === 11 && /epic-auto-launch/.test(coment(11, R)));
  const R2 = repoFalso([PAUSA_ISSUE, { number: 5, created_at: T(1), labels: ['en-cola'] }], { pausaRota: true });
  const q = await pop(R2);
  caso('(f) …el pop de cola arma la cabeza, como hoy', q.armado === 5);
  const R3 = repoFalso([PAUSA_ISSUE, { number: 5, created_at: T(1), labels: ['en-cola'] }], { pausaRota: true });
  const l = await m.liberarCola({ ...R3, armar: async () => { throw new Error('no debía armar'); } });
  caso('(f) …y el Watchdog no barre (sigue su detector de siempre)', l.accion === 'no-op' && /fallida/.test(l.motivo));
  if (guardScript) {
    const R4 = repoFalso([PAUSA_ISSUE, { number: 20, created_at: T(2), labels: [] }], { pausaRota: true });
    await guard(R4, 20, '@claude');
    caso('(f) …y el guard no retiene el arm (sigue al guard serial de siempre)', !/pausa-cola-retenido/.test(coment(20, R4)));
  }
}

// ── Bordes ────────────────────────────────────────────────────────────────
{
  const R = repoFalso([{ number: 2, created_at: T(1), labels: ['pausa-cola'], state: 'closed' }]);
  caso('issue CERRADO con `pausa-cola` ⇒ sin pausa', (await m.leerPausa(R)).pausado === false);
  const ret = (body, aa = 'OWNER') => m.esRetenido([{ body, author_association: aa }]);
  caso('marcador de retención en línea propia de autor de confianza ⇒ retenido', ret('x\n\n<!-- pausa-cola-retenido: #7 -->') && ret('<!-- pausa-cola-retenido -->'));
  caso('marcador CITADO entre backticks ⇒ NO cuenta (AP-063)', !ret('el marcador `<!-- pausa-cola-retenido -->` significa…'));
  caso('marcador de autor sin confianza ⇒ NO cuenta', !ret('<!-- pausa-cola-retenido -->', 'NONE'));
  caso('`marcaRetenido(10)` emite `<!-- pausa-cola-retenido: #10 -->`', m.marcaRetenido(10) === '<!-- pausa-cola-retenido: #10 -->' && m.RETENIDO_RE.test(m.marcaRetenido(10)));
}

// ── Costura con los workflows (solo en el central) ─────────────────────────
const EM = '.github/workflows/epic-merge.yml';
const WD = '.github/workflows/watchdog.yml';
if (existsSync(EM) && existsSync(CC) && existsSync(WD)) {
  const em = readFileSync(EM, 'utf8');
  const cc = readFileSync(CC, 'utf8');
  const wd = readFileSync(WD, 'utf8');
  const cuerpo = (src, desde, hasta) => { const a = src.indexOf(desde); const b = src.indexOf(hasta, a + 1); return a === -1 ? '' : src.slice(a, b === -1 ? undefined : b); };
  const antes = (txt, a, b) => txt.indexOf(a) !== -1 && txt.indexOf(b) !== -1 && txt.indexOf(a) < txt.indexOf(b);
  // Una sola función de lectura: nadie consulta la label por su cuenta.
  caso('lectura ÚNICA: ningún workflow consulta `labels: \'pausa-cola\'` por su cuenta (todo pasa por `leerPausa`)', !/labels: 'pausa-cola'/.test(em + cc + wd));
  caso('epic-merge `enPausa`: usa `COLA.leerPausa`', /COLA\.leerPausa\(/.test(cuerpo(em, 'async function enPausa(', 'async function ordenCola(')));
  const aq = cuerpo(em, 'async function armQueue(', 'async function armRecienteDeOtroJob');
  caso('epic-merge `armQueue`: lee la pausa ANTES de armar y lo deja en el diag', antes(aq, 'await enPausa()', 'createComment') && /retenidoPorPausa = true/.test(aq) && /RETENIDO por/.test(aq));
  const sw = cuerpo(em, 'async function sweepQueueAtExit(', '// Helper: label de estado');
  caso('epic-merge `sweepQueueAtExit`: lee la pausa ANTES de delegar en `armQueue`', antes(sw, 'await enPausa()', 'await armQueue('));
  const merge = cuerpo(em, 'const next = Number(lm[1]);', '// ── Cierre POR ESTADO');
  caso('epic-merge, camino de merge: retiene en pausa ANTES de ceder y de armar', antes(merge, 'retenerSiPausa(', 'cederAUrgente(') && antes(merge, 'retenerSiPausa(', '<!-- epic-auto-launch -->'));
  const estado = cuerpo(em, 'const already = await targetAlreadyArmed(next);', 'let prNumber = null;');
  caso('epic-merge, cierre por estado: retiene en pausa ANTES de ceder y de armar', antes(estado, 'retenerSiPausa(', 'cederAUrgente(') && antes(estado, 'retenerSiPausa(', '<!-- epic-auto-launch -->'));
  caso('epic-merge `retenerSiPausa`: usa `COLA.retenerEslabon`', /COLA\.retenerEslabon\(/.test(cuerpo(em, 'async function retenerSiPausa(', 'async function postStateClose(')));
  const pq = cuerpo(cc, 'async function popQueue(', 'core.setOutput(\'armed\'');
  caso('claude-code `popQueue`: lee la pausa ANTES de armar', antes(pq, 'COLA.leerPausa(', 'createComment'));
  const ln = cuerpo(cc, '- name: Launch next epic issue', '- name: Barrido de cola al cierre del job');
  caso('claude-code step `launch_next`: retiene en pausa ANTES de ceder y de postear el `@claude`',
    antes(ln, 'COLA.retenerEslabon(', 'COLA.cederEslabon(') && ln.indexOf('COLA.retenerEslabon(') < ln.lastIndexOf('body: \'@claude\''));
  const br = cuerpo(cc, '- name: Barrido de cola al cierre del job', 'barrido de cola al cierre falló');
  caso('claude-code «Barrido de cola al cierre»: lee la pausa ANTES de armar', antes(br, 'COLA.leerPausa(', 'createComment'));
  const gs = cuerpo(cc, '- name: Guard serial', '- name: Sync a la rama base');
  caso('claude-code guard serial: la pausa va ANTES del override `serial-ok`', antes(gs, 'COLA.retenerArm(', "l.name === 'serial-ok'"));
  caso('claude-code: el checkout del módulo corre ANTES del guard serial', antes(cc, 'path: .cola-central', '- name: Guard serial'));
  caso('watchdog: checkout sparse `.cola-central` antes del scan', antes(wd, 'path: .cola-central', '- name: Scan for stalled work'));
  const scan = cuerpo(wd, '- name: Scan for stalled work', '- name: Harvest flaky candidates');
  const lib = cuerpo(scan, 'COLA.liberarCola(', 'for (const issue of issues)');
  caso('watchdog scan: barrido de liberación con `COLA.liberarCola`, arm `arm-de-cola` por el PAT', lib !== '' && /patCall\('POST'/.test(lib) && /<!-- arm-de-cola -->/.test(lib));
  caso('watchdog scan: en pausa, un ítem `en-cola` se salta ANTES de la sospecha/cola-huerfana',
    antes(scan, "if ((pausaCola || colaLiberada) && issue.labels.some(l => l.name === 'en-cola')) continue;", 'watchdog-cola-huerfana-sospecha'));
  // Los guards en línea de cadena y panel reconocen el `eslabon-suspendido` que
  // acompaña a la retención (el de `retenerArm` va sin número).
  const inl = [...cc.matchAll(/\/(\^\[ \\t\]\*<!--\\s\*eslabon-suspendido[^/]*)\/m\.test\(/g)].map((x) => new RegExp(x[1], 'm'));
  caso('guards de cadena y panel aceptan el `eslabon-suspendido` sin número de `retenerArm`', inl.length === 2 && inl.every((re) => re.test('<!-- eslabon-suspendido -->')));
}

if (existsSync('vendored/scripts/cola-prioridad.cjs') && existsSync('scripts/cola-prioridad.cjs')) {
  caso('scripts/cola-prioridad.cjs idéntico a vendored/scripts/cola-prioridad.cjs',
    readFileSync('vendored/scripts/cola-prioridad.cjs', 'utf8') === readFileSync('scripts/cola-prioridad.cjs', 'utf8'));
}

if (fallos.length) {
  console.error(`CHECK-PAUSA-COLA ROJO (${fuente}): ${fallos.length} caso(s) fallan:`);
  for (const f of fallos) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check-pausa-cola verde (${fuente}): todos los casos pasan.`);
