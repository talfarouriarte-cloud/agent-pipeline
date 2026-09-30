#!/usr/bin/env node
// check-bake-guard — banco del guard de horneado (AP-021 + AP-029) del step
// `check_chain` de claude-code.yml, ampliado por AP-096 (central#260) a los
// arms de issues con label `correctivo` fuera de cadena.
//
// Ejecuta el script EMBEBIDO real (no una copia) contra mocks de `github`,
// `context` y `core`, y comprueba el desenlace de cada caso: output `broken`,
// label `stalled` y marcador del comentario. Instrumento roto ⇒ ROJO nombrando
// el caso. Cuelga del piggyback de `check-embedded-js.mjs` por la misma razón
// que sus hermanos: su paso propio de `ci.yml` sería un cambio de workflow.
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

const wf = yaml.load(readFileSync('.github/workflows/claude-code.yml', 'utf8'));
let script = null;
for (const job of Object.values(wf.jobs || {})) {
  for (const st of job.steps || []) if (st.id === 'check_chain') script = st.with.script;
}
if (!script) { console.error('CHECK-BAKE-GUARD ROJO: step `check_chain` no encontrado en claude-code.yml'); process.exit(1); }
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('github', 'context', 'core', 'process', script);

const NOW = '2026-09-30T10:00:00Z';
const OLD = '2026-07-01T00:00:00Z';
const BLOCK_OK = '## Invariantes funcionales\n\n- I1 ⇐ ADR-1 A1: x\n  pre-épica: rojo — reproducido\n';
const BLOCK_NO_DRY = '## Invariantes funcionales\n\n- I1 ⇐ ADR-1 A1: x\n  pre-correctivo: rojo — reproducido\n- I2 ⇐ ADR-1 A2: y\n  pre-correctivo: verde — no-regresión\n';
const TAIL = '\n<!-- epic-audit: correctivos #1-#1 -->';

async function caso({ labels, body = '', created = NOW, comments = [], arm = '@claude arma', chain = {}, pr = false }) {
  const calls = { labels: [], comments: [], removed: [] };
  const outputs = {};
  const issue = { number: 1, labels: labels.map(name => ({ name })), body, created_at: created, ...(pr ? { pull_request: {} } : {}) };
  const github = { rest: { issues: {
    listComments: async () => ({ data: comments }),
    addLabels: async a => { calls.labels.push(...a.labels); },
    removeLabel: async a => { calls.removed.push(a.name); },
    createComment: async a => { calls.comments.push(a.body); },
    get: async a => ({ data: { body: chain[a.issue_number] || '' } }),
  } } };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { issue, comment: { body: arm } } };
  const core = { setOutput: (k, v) => { outputs[k] = String(v); }, setFailed: m => { outputs.failed = m; }, notice() {}, warning() {} };
  await run(github, context, core, { env: { IN_EPIC_LABEL: 'epica' } });
  return { broken: outputs.broken, stalled: calls.labels.includes('stalled'), comments: calls.comments, removed: calls.removed };
}

const has = (r, re) => r.comments.some(c => re.test(c));
const BANCO = [
  ['suelto correctivo sin bloque ⇒ stall sin-invariantes',
    { labels: ['correctivo'], body: 'Issue suelto.' },
    r => r.broken === 'true' && r.stalled && has(r, /<!-- sin-invariantes-stall -->/) && has(r, /edita ESTE issue/)],
  ['suelto correctivo con bloque y pre-épica ⇒ pasa',
    { labels: ['correctivo'], body: BLOCK_OK },
    r => r.broken === 'false' && !r.stalled && r.comments.length === 0],
  ['suelto correctivo con bloque y pre-correctivo ×2 ⇒ stall dry-run con candidatas listadas',
    { labels: ['correctivo'], body: BLOCK_NO_DRY },
    r => r.broken === 'true' && r.stalled && has(r, /<!-- dry-run-ausente-stall -->/) && has(r, /`pre-correctivo:` ×2/)],
  ['suelto correctivo sin bloque + invariantes-na de confianza ⇒ pasa',
    { labels: ['correctivo'], body: 'x', comments: [{ body: '<!-- invariantes-na -->', author_association: 'OWNER' }] },
    r => r.broken === 'false' && !r.stalled],
  ['invariantes-na de autor NO de confianza ⇒ no cuenta',
    { labels: ['correctivo'], body: 'x', comments: [{ body: '<!-- invariantes-na -->', author_association: 'NONE' }] },
    r => r.broken === 'true' && r.stalled],
  ['suelto correctivo re-armado por watchdog-rearm ⇒ exento',
    { labels: ['correctivo'], body: 'x', arm: '@claude retoma\n<!-- watchdog-rearm -->' },
    r => r.broken === 'false' && !r.stalled],
  ['stall ya emitido ⇒ re-asegura stalled sin comentario nuevo (dedup)',
    { labels: ['correctivo'], body: 'x', comments: [{ body: 'guard\n<!-- sin-invariantes-stall -->', author_association: 'OWNER' }] },
    r => r.broken === 'true' && r.stalled && r.comments.length === 0],
  ['suelto correctivo pre-corte AP-029 con bloque sin pre-épica ⇒ pasa',
    { labels: ['correctivo'], body: BLOCK_NO_DRY, created: OLD },
    r => r.broken === 'false' && !r.stalled],
  ['issue sin epica ni correctivo ⇒ fuera de perímetro',
    { labels: ['bug'], body: 'x' },
    r => r.broken === 'false' && !r.stalled && r.comments.length === 0],
  ['contexto PR ⇒ fuera de perímetro',
    { labels: ['correctivo'], body: 'x', pr: true },
    r => r.broken === 'false' && !r.stalled],
  ['epica primer eslabón sin bloque ⇒ stall (regresión AP-021)',
    { labels: ['epica'], body: 'Eslabón 1\n<!-- launch-next: #2 -->', chain: { 2: 'Eslabón 2' + TAIL } },
    r => r.broken === 'true' && r.stalled && has(r, /<!-- sin-invariantes-stall -->/) && has(r, /edita el issue de épica/)],
  ['epica con bloque y pre-épica aguas abajo ⇒ pasa (regresión AP-029)',
    { labels: ['epica'], body: 'Eslabón 1\n<!-- launch-next: #2 -->', chain: { 2: BLOCK_OK + TAIL } },
    r => r.broken === 'false' && !r.stalled],
  ['epica correctiva con bloque pre-correctivo ⇒ stall dry-run con candidatas',
    { labels: ['epica', 'correctivo'], body: BLOCK_NO_DRY + TAIL },
    r => r.broken === 'true' && has(r, /<!-- dry-run-ausente-stall -->/) && has(r, /`pre-correctivo:` ×2/)],
  ['epica eslabón epic-auto-launch sin bloque ⇒ exento',
    { labels: ['epica'], body: 'x' + TAIL, arm: '@claude\n<!-- epic-auto-launch -->' },
    r => r.broken === 'false' && !r.stalled],
  ['epica degenerada no correctiva ⇒ degrada y continúa',
    { labels: ['epica'], body: 'x' },
    r => r.broken === 'false' && !r.stalled && r.removed.includes('epica')],
  ['epica degenerada correctiva sin bloque ⇒ degrada y stallea como suelto',
    { labels: ['epica', 'correctivo'], body: 'x' },
    r => r.broken === 'true' && r.stalled && r.removed.includes('epica') && has(r, /<!-- sin-invariantes-stall -->/)],
  ['epica multi-eslabón rota ⇒ cadena-sin-auditoria (regresión)',
    { labels: ['epica'], body: 'x\n<!-- launch-next: #2 -->', chain: { 2: 'sin sentinel' } },
    r => r.broken === 'true' && has(r, /<!-- cadena-sin-auditoria -->/)],
];

const rojos = [];
for (const [nombre, input, ok] of BANCO) {
  let r;
  try { r = await caso(input); } catch (e) { rojos.push(`${nombre}: excepción ${e.message}`); continue; }
  if (!ok(r)) rojos.push(`${nombre}: obtenido ${JSON.stringify(r)}`);
}
if (rojos.length) { console.error('CHECK-BAKE-GUARD ROJO:'); rojos.forEach(e => console.error('  - ' + e)); process.exit(1); }
console.log(`check-bake-guard verde: ${BANCO.length} casos del guard de horneado (AP-021/AP-029/AP-096).`);
