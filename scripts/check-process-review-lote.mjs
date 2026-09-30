#!/usr/bin/env node
// check-process-review-lote — banco del disparo por LOTES de la revisión de
// proceso (AP-098, central#279) y de la semántica «panel consumido = veredicto
// del Auditor» del guard de panel de claude-code.yml.
//
// Ejecuta los scripts EMBEBIDOS reales (no copias) contra un doble de la API:
//  - step `lote` de process-review.yml (selector: modo p0 | lote | nada);
//  - step `check_panel` de claude-code.yml (guard `panel-sin-consumir`).
// Cuelga del piggyback de `check-embedded-js.mjs` por la misma razón que sus
// hermanos (un paso propio de ci.yml sería un cambio de workflow pendiente).
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function stepScript(file, id) {
  const wf = yaml.load(readFileSync(file, 'utf8'));
  for (const job of Object.values(wf.jobs || {})) {
    for (const st of job.steps || []) if (st.id === id) return st.with.script;
  }
  console.error(`CHECK-PROCESS-REVIEW-LOTE ROJO: step \`${id}\` no encontrado en ${file}`);
  process.exit(1);
}
const selector = new AsyncFunction('github', 'context', 'core', stepScript('.github/workflows/process-review.yml', 'lote'));
const guardPanel = new AsyncFunction('github', 'context', 'core', stepScript('.github/workflows/claude-code.yml', 'check_panel'));

const DIA = 24 * 3600 * 1000;
const hace = d => new Date(Date.now() - d * DIA).toISOString();
const VERDICT = '<!-- audit-verdict: findings -->';
const DONE = 'Sin propuestas.\n<!-- process-proposals: 0 -->\n<!-- process-review-done -->';
// Panel de auditoría: `verdict`/`done` = días atrás (null = ausente).
const panel = (number, { verdict = 1, done = null, p0 = false, labels = [], state = 'open' } = {}) => ({
  number, state, title: `Auditoría ${number}`,
  labels: ['auditoria', 'auditoria-completa', ...labels].map(name => ({ name })),
  comments: [
    ...(verdict !== null ? [{ body: VERDICT, created_at: hace(verdict) }] : []),
    ...(p0 ? [{ body: '<!-- audit-p0: trabajo-perdido -->', created_at: hace(verdict ?? 0) }] : []),
    ...(done !== null ? [{ body: DONE, created_at: hace(done) }] : []),
  ],
});

function api(world, w) {
  const byNum = new Map(world.panels.map(p => [p.number, p]));
  const listForRepo = async p => {
    if (world.down) throw new Error('API caída');
    let xs = world.panels.filter(i => p.state === 'all' || i.state === p.state);
    if (p.labels) xs = xs.filter(i => i.labels.some(l => l.name === p.labels));
    return { data: xs };
  };
  const listComments = async p => ({ data: byNum.has(p.issue_number) ? byNum.get(p.issue_number).comments : (world.issueComments || {})[p.issue_number] || [] });
  return {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      issues: {
        listForRepo, listComments,
        addLabels: async p => { w.added.push(...p.labels.map(l => `${p.issue_number}:${l}`)); },
        createComment: async p => { w.comments.push({ n: p.issue_number, body: p.body }); },
      },
    },
  };
}

async function lote(world, { evento = 'schedule', issue = null } = {}) {
  const w = { added: [], comments: [], outputs: {}, failed: null };
  const context = { repo: { owner: 'o', repo: 'r' }, eventName: evento, payload: issue ? { issue } : {} };
  const core = { setOutput: (k, v) => { w.outputs[k] = String(v); }, notice() {}, warning() {}, info() {}, setFailed: m => { w.failed = m; } };
  await selector(api(world, w), context, core);
  return w;
}
const nPend = (k, extra = {}) => Array.from({ length: k }, (_, i) => panel(100 + i, extra));
// Última revisión de lote hace 2 días (panel ya auto-archivado).
const REVISADO = panel(90, { verdict: 5, done: 2, state: 'closed' });
const paneles = w => (w.outputs.paneles || '').split(' ').filter(Boolean).map(Number);

const BANCO = [
  ['9 pendientes (cron, última revisión de lote hace 2 días) ⇒ no corre',
    async () => { const w = await lote({ panels: [REVISADO, ...nPend(9)] }); return w.outputs.modo === 'nada' && !w.failed; }],
  ['10 pendientes (cron) ⇒ corre el lote con los 10',
    async () => { const w = await lote({ panels: [REVISADO, ...nPend(10)] }); return w.outputs.modo === 'lote' && paneles(w).length === 10; }],
  ['3 pendientes y 15 días desde la última revisión de lote ⇒ corre',
    async () => {
      const w = await lote({ panels: [panel(90, { verdict: 20, done: 15, state: 'closed' }), ...nPend(3)] });
      return w.outputs.modo === 'lote' && paneles(w).length === 3;
    }],
  ['3 pendientes y 13 días ⇒ no corre',
    async () => {
      const w = await lote({ panels: [panel(90, { verdict: 20, done: 13, state: 'closed' }), ...nPend(3)] });
      return w.outputs.modo === 'nada';
    }],
  ['sin revisión de lote previa: cuenta desde el veredicto pendiente más antiguo (15 días) ⇒ corre',
    async () => { const w = await lote({ panels: [panel(100, { verdict: 15 }), panel(101, { verdict: 1 })] }); return w.outputs.modo === 'lote' && paneles(w).join() === '100,101'; }],
  ['P0 (labeled auditoria-completa) con 9 pendientes ⇒ corre SOLO esa',
    async () => {
      const p0 = panel(200, { p0: true });
      const w = await lote({ panels: [REVISADO, ...nPend(8), p0] }, { evento: 'issues', issue: p0 });
      return w.outputs.modo === 'p0' && paneles(w).join() === '200';
    }],
  ['P0 por label human-needed del panel (cinturón) ⇒ corre SOLO esa',
    async () => {
      const p0 = panel(201, { labels: ['human-needed'] });
      const w = await lote({ panels: [REVISADO, ...nPend(2), p0] }, { evento: 'issues', issue: p0 });
      return w.outputs.modo === 'p0' && paneles(w).join() === '201';
    }],
  ['labeled NO-P0 con 9 pendientes ⇒ no corre (espera lote)',
    async () => {
      const ps = [REVISADO, ...nPend(9)];
      const w = await lote({ panels: ps }, { evento: 'issues', issue: ps[5] });
      return w.outputs.modo === 'nada';
    }],
  ['labeled NO-P0 que completa el décimo ⇒ el evento es tick: corre el lote',
    async () => {
      const ps = [REVISADO, ...nPend(10)];
      const w = await lote({ panels: ps }, { evento: 'issues', issue: ps[10] });
      return w.outputs.modo === 'lote' && paneles(w).length === 10;
    }],
  ['labeled sobre un panel ya revisado ⇒ run duplicado, sin sesión',
    async () => {
      const hecho = panel(300, { done: 0 });
      const w = await lote({ panels: [hecho, ...nPend(12)] }, { evento: 'issues', issue: hecho });
      return w.outputs.modo === 'nada';
    }],
  ['la revisión de un P0 no reinicia el reloj del lote',
    async () => {
      const w = await lote({ panels: [panel(90, { verdict: 20, done: 15, state: 'closed' }), panel(91, { verdict: 2, done: 1, p0: true, state: 'closed' }), ...nPend(3)] });
      return w.outputs.modo === 'lote' && paneles(w).length === 3;
    }],
  ['cron sin lote cumplido pero con un P0 rezagado ⇒ corre SOLO el P0',
    async () => {
      const w = await lote({ panels: [REVISADO, ...nPend(4), panel(210, { p0: true })] });
      return w.outputs.modo === 'p0' && paneles(w).join() === '210';
    }],
  ['workflow_dispatch con 2 pendientes ⇒ lote forzado',
    async () => { const w = await lote({ panels: [REVISADO, ...nPend(2)] }, { evento: 'workflow_dispatch' }); return w.outputs.modo === 'lote' && paneles(w).length === 2; }],
  ['panel sin audit-verdict o con pause-agents ⇒ no es pendiente',
    async () => {
      const w = await lote({ panels: [REVISADO, ...nPend(9), panel(400, { verdict: null }), panel(401, { labels: ['pause-agents'] })] });
      return w.outputs.modo === 'nada';
    }],
  ['API caída ⇒ fail-closed: nada + rojo',
    async () => { const w = await lote({ panels: [], down: true }); return w.outputs.modo === 'nada' && !!w.failed; }],
];

// ── Guard de panel (claude-code.yml, `check_panel`) ─────────────────────────
async function guard(world) {
  const w = { added: [], comments: [], outputs: {} };
  process.env.IN_EPIC_LABEL = 'epica';
  const issue = { number: 1, body: 'Épica nueva', labels: [{ name: 'epica' }] };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { issue, comment: { body: 'arm' } } };
  const core = { setOutput: (k, v) => { w.outputs[k] = String(v); }, setFailed: m => { w.failed = m; }, notice() {}, warning() {}, info() {} };
  await guardPanel(api({ ...world, issueComments: { 1: [] } }, w), context, core);
  return w;
}
BANCO.push(
  ['guard de panel: auditoría ABIERTA con audit-verdict (esperando lote) ⇒ consumida, arma',
    async () => { const w = await guard({ panels: [panel(500)] }); return w.outputs.blocked === 'false' && !w.added.length; }],
  ['guard de panel: auditoría abierta SIN audit-verdict ⇒ bloquea',
    async () => { const w = await guard({ panels: [panel(501, { verdict: null })] }); return w.outputs.blocked === 'true' && w.added.includes('1:stalled'); }],
);

let rojos = 0;
for (const [nombre, caso] of BANCO) {
  let ok = false;
  try { ok = await caso(); } catch (e) { console.error(`  excepción: ${e.message}`); }
  console.log(`${ok ? '✓' : '✗'} ${nombre}`);
  if (!ok) rojos++;
}
if (rojos) { console.error(`CHECK-PROCESS-REVIEW-LOTE ROJO: ${rojos}/${BANCO.length} casos fallan.`); process.exit(1); }
console.log(`check-process-review-lote verde: ${BANCO.length} casos.`);
