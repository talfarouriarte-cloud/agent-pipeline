#!/usr/bin/env node
// check-serial-guard — banco del guard serial (step `check_serial` de
// claude-code.yml), centrado en el cinturón CRUZADO de AP-097 (central#267):
// dos arms simultáneos de issues DISTINTOS deben dejar EXACTAMENTE un
// `serial-activo`.
//
// Ejecuta el script EMBEBIDO real (no una copia) contra un doble de la API. Un
// arranque simultáneo se modela como N runs que leen TODOS la misma foto (nadie
// ha escrito aún el flag) y se ejecutan uno tras otro contra esa foto; lo que se
// cuenta son las escrituras de cada uno. Cuelga del piggyback de
// `check-embedded-js.mjs` por la misma razón que sus hermanos.
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const wf = yaml.load(readFileSync('.github/workflows/claude-code.yml', 'utf8'));
let script = null;
for (const job of Object.values(wf.jobs || {})) {
  for (const st of job.steps || []) if (st.id === 'check_serial') script = st.with.script;
}
if (!script) { console.error('CHECK-SERIAL-GUARD ROJO: step `check_serial` no encontrado en claude-code.yml'); process.exit(1); }
const run = cargarStep(script, 'check_serial');

const WF = 'Claude Code';
const GUARD_STEP = 'Guard serial — un solo Creator en vuelo (solo issues)';
const T0 = Date.now() - 30 * 1000;
const at = s => new Date(T0 + s * 1000).toISOString();
const iss = (number, title, labels = [], extra = {}) => ({ number, title, labels: labels.map(name => ({ name })), ...extra });
const armRun = (id, title, s = 0, extra = {}) => ({ id, name: WF, event: 'issue_comment', display_title: title, head_branch: 'main', created_at: at(s), ...extra });

// Ejecuta el guard para UN run contra la foto compartida `world`.
async function guard(world, runId, issue) {
  const w = { added: [], removed: [], comments: [], outputs: {}, warnings: [] };
  let flagReads = 0;
  const listForRepo = async p => {
    if (p.labels === 'serial-activo') {
      if (flagReads++ > 0 && world.flaggedFresh) return { data: world.flaggedFresh };
      return { data: world.flagged || [] };
    }
    // Con el cargador fiel `require` existe y el guard carga cola-prioridad.cjs
    // (pausa AP-103, orden AP-102): el doble respeta el filtro por label.
    if (p.labels === 'pausa-cola') return { data: world.pausa || [] };
    if (world.issuesDown) throw new Error('API caída (issues)');
    return { data: world.issues || [] };
  };
  const github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      pulls: { list: async () => ({ data: world.prs || [] }) },
      issues: {
        listForRepo,
        listComments: async p => ({ data: (world.comments || {})[p.issue_number] || [] }),
        addLabels: async p => { w.added.push(...p.labels.map(l => `${p.issue_number}:${l}`)); },
        removeLabel: async p => { w.removed.push(`${p.issue_number}:${p.name}`); },
        createComment: async p => { w.comments.push({ n: p.issue_number, body: p.body }); },
      },
      actions: {
        // Por defecto el guard de cada run está EN CURSO (arranque simultáneo);
        // `world.guardDone` lista los runs que ya lo pasaron.
        listJobsForWorkflowRun: async p => {
          if ((world.jobsDown || []).includes(p.run_id)) throw new Error('API caída (jobs)');
          const status = (world.guardDone || []).includes(p.run_id) ? 'completed' : 'in_progress';
          return { data: { jobs: [{ steps: [{ name: GUARD_STEP, status }] }] } };
        },
        listWorkflowRunsForRepo: async p => {
          if (world.runsDown) throw new Error('API caída (runs)');
          return { data: { workflow_runs: (world.runs || []).filter(r => (r.status || 'in_progress') === p.status) } };
        },
      },
    },
  };
  const context = { repo: { owner: 'o', repo: 'r' }, runId, workflow: WF, payload: { issue } };
  const core = { setOutput: (k, v) => { w.outputs[k] = String(v); }, notice() {}, warning: m => w.warnings.push(String(m)), info() {} };
  await run({ github, context, core });
  return w;
}

const A = iss(10, 'Correctivo A');
const B = iss(11, 'Correctivo B');
const AUD = iss(12, 'Auditoría épica X', ['auditoria']);
const has = (w, re) => w.comments.some(c => re.test(c.body));
const serialCount = ws => ws.reduce((n, w) => n + w.added.filter(l => l.endsWith(':serial-activo')).length, 0);

const BANCO = [
  ['dos arms de issues DISTINTOS a 2 s ⇒ exactamente un serial-activo (el más antiguo); el otro stalled + marcador',
    async () => {
      const world = { runs: [armRun(100, A.title, 0), armRun(101, B.title, 2)], issues: [A, B] };
      const [wa, wb] = [await guard(world, 100, A), await guard(world, 101, B)];
      return serialCount([wa, wb]) === 1 && wa.added.includes('10:serial-activo') && wa.outputs.blocked === 'false'
        && wb.outputs.blocked === 'true' && wb.added.includes('11:stalled') && !wb.added.includes('11:serial-activo')
        && has(wb, /<!-- serial-toctou-cruzado -->/) && has(wb, /run `100`/);
    }],
  ['orden de ejecución inverso (el perdedor corre primero) ⇒ mismo desenlace',
    async () => {
      const world = { runs: [armRun(100, A.title, 0), armRun(101, B.title, 2)], issues: [A, B] };
      const [wb, wa] = [await guard(world, 101, B), await guard(world, 100, A)];
      return serialCount([wa, wb]) === 1 && wa.added.includes('10:serial-activo') && wb.added.includes('11:stalled');
    }],
  ['tres arms simultáneos ⇒ un serial-activo, dos stalled',
    async () => {
      const C = iss(13, 'Correctivo C');
      const world = { runs: [armRun(100, A.title, 0), armRun(101, B.title, 1), armRun(102, C.title, 2)], issues: [A, B, C] };
      const ws = [await guard(world, 100, A), await guard(world, 101, B), await guard(world, 102, C)];
      const stalled = ws.reduce((n, w) => n + w.added.filter(l => l.endsWith(':stalled')).length, 0);
      return serialCount(ws) === 1 && stalled === 2;
    }],
  ['el ganador sólo ve al perdedor (id mayor) ⇒ toma el mutex',
    async () => {
      const world = { runs: [armRun(100, A.title, 0), armRun(101, B.title, 2)], issues: [A, B] };
      const w = await guard(world, 100, A);
      return w.added.includes('10:serial-activo') && w.comments.length === 0;
    }],
  ['el perdedor no ve al ganador (API rancia) ⇒ statu quo: toma (no empeora)',
    async () => {
      const world = { runs: [armRun(101, B.title, 2)], issues: [A, B] };
      const w = await guard(world, 101, B);
      return w.added.includes('11:serial-activo');
    }],
  ['run anterior de un issue de AUDITORÍA ⇒ no es contendiente',
    async () => {
      const world = { runs: [armRun(100, AUD.title, 0), armRun(101, B.title, 2)], issues: [AUD, B] };
      const w = await guard(world, 101, B);
      return w.added.includes('11:serial-activo') && !w.added.includes('11:stalled');
    }],
  ['run anterior del loop de un PR abierto ⇒ no es contendiente',
    async () => {
      const world = { runs: [armRun(100, 'Mi PR', 0), armRun(101, B.title, 2)], issues: [B, iss(20, 'Mi PR', [], { pull_request: {} })],
        prs: [{ number: 20, title: 'Mi PR', head: { ref: 'feature/x' } }] };
      const w = await guard(world, 101, B);
      return w.added.includes('11:serial-activo');
    }],
  ['run anterior de otro workflow ⇒ no es contendiente',
    async () => {
      const world = { runs: [armRun(100, A.title, 0, { name: 'Epic merge' }), armRun(101, B.title, 2)], issues: [A, B] };
      const w = await guard(world, 101, B);
      return w.added.includes('11:serial-activo');
    }],
  ['run cruzado fuera de la ventana TOCTOU (15 min antes) ⇒ no es contendiente',
    async () => {
      const world = { runs: [armRun(100, A.title, -15 * 60), armRun(101, B.title, 2)], issues: [A, B] };
      const w = await guard(world, 101, B);
      return w.added.includes('11:serial-activo');
    }],
  ['POP DE COLA: holder A creado hace 3 min, serie ya liberada, run aún in_progress con su guard pasado ⇒ B toma serial-activo',
    async () => {
      const world = { runs: [armRun(100, A.title, -180), armRun(101, B.title, 2)], issues: [A, B], guardDone: [100] };
      const w = await guard(world, 101, B);
      return w.added.includes('11:serial-activo') && !w.added.includes('11:stalled') && w.outputs.blocked === 'false';
    }],
  ['guard del cruzado pasado y su flag escrito tras la lectura ⇒ cuenta: B cede (stalled)',
    async () => {
      const world = { runs: [armRun(100, A.title, 0), armRun(101, B.title, 2)], issues: [A, B], guardDone: [100], flaggedFresh: [A] };
      const w = await guard(world, 101, B);
      return w.added.includes('11:stalled') && !w.added.includes('11:serial-activo');
    }],
  ['jobs del cruzado ilegibles ⇒ fail-closed: cuenta como contendiente',
    async () => {
      const world = { runs: [armRun(100, A.title, -180), armRun(101, B.title, 2)], issues: [A, B], guardDone: [100], jobsDown: [100] };
      const w = await guard(world, 101, B);
      return w.added.includes('11:stalled') && !w.added.includes('11:serial-activo');
    }],
  ['lista de issues caída ⇒ sin cinturón cruzado (statu quo) y aviso',
    async () => {
      const world = { runs: [armRun(100, A.title, 0), armRun(101, B.title, 2)], issuesDown: true };
      const w = await guard(world, 101, B);
      return w.added.includes('11:serial-activo') && w.warnings.some(m => /cinturón cruzado/.test(m));
    }],
  ['lista de runs caída ⇒ toma sin cinturón (degradación pre-Change-B)',
    async () => {
      const world = { runsDown: true, issues: [A, B] };
      const w = await guard(world, 101, B);
      return w.added.includes('11:serial-activo');
    }],
  ['marcador ya emitido ⇒ re-asegura stalled sin comentario nuevo (dedup)',
    async () => {
      const world = { runs: [armRun(100, A.title, 0), armRun(101, B.title, 2)], issues: [A, B],
        comments: { 11: [{ body: 'x\n<!-- serial-toctou-cruzado -->' }] } };
      const w = await guard(world, 101, B);
      return w.added.includes('11:stalled') && w.comments.length === 0;
    }],
  ['regresión AP-033 Change B: dos arranques del MISMO issue ⇒ cede SIN re-etiquetar',
    async () => {
      const world = { runs: [armRun(100, A.title, 0), armRun(101, A.title, 1)], issues: [A] };
      const [w1, w2] = [await guard(world, 100, A), await guard(world, 101, A)];
      return serialCount([w1, w2]) === 1 && w2.outputs.blocked === 'true' && !w2.added.includes('10:stalled') && has(w2, /<!-- serial-guard -->/);
    }],
  ['regresión: serie ocupada por otro serial-activo ⇒ en-cola (no stalled)',
    async () => {
      const world = { runs: [armRun(90, A.title, -300), armRun(101, B.title, 2)], issues: [A, B], flagged: [A] };
      const w = await guard(world, 101, B);
      return w.added.includes('11:en-cola') && !w.added.includes('11:stalled') && w.outputs.blocked === 'true';
    }],
];

const rojos = [];
for (const [nombre, fn] of BANCO) {
  try { if (!(await fn())) rojos.push(nombre); } catch (e) { rojos.push(`${nombre}: excepción ${e.message}`); }
}
if (rojos.length) { console.error('CHECK-SERIAL-GUARD ROJO:'); rojos.forEach(e => console.error('  - ' + e)); process.exit(1); }
console.log(`check-serial-guard verde: ${BANCO.length} casos del guard serial (AP-033 Change B + cinturón cruzado AP-097).`);
