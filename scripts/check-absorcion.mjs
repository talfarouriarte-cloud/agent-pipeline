#!/usr/bin/env node
// check-absorcion — banco de `vendored/scripts/absorcion.cjs` (AP-122,
// central#307): `Absorbe #N` con consumidor mecánico al mergear el PR que
// absorbe, y devolución a `en-cola` si se cierra sin merge.
//
// Corre el módulo REAL contra una API de GitHub en memoria (issues, labels,
// comentarios). La costura con `epic-merge.yml` (que `postMerge` y la rama
// `closed` sin merge carguen el módulo) se comprueba por texto. Cuelga del
// piggyback de `check-embedded-js.mjs`.
import { mkdtempSync, readFileSync, symlinkSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);
const ABS = require(resolve('vendored/scripts/absorcion.cjs'));

function api(issues) {
  const w = { removed: [], added: [], comments: [], closed: [] };
  const db = new Map(issues.map(i => [i.number, { state: 'open', labels: [], comments: [], ...i }]));
  const get = n => { const i = db.get(n); if (!i) throw new Error('404'); return i; };
  const github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      issues: {
        get: async p => ({ data: get(p.issue_number) }),
        listComments: async p => ({ data: get(p.issue_number).comments }),
        removeLabel: async p => {
          const i = get(p.issue_number);
          if (!i.labels.includes(p.name)) throw new Error('404 label');
          i.labels = i.labels.filter(l => l !== p.name); w.removed.push(`${p.issue_number}:${p.name}`);
        },
        addLabels: async p => { const i = get(p.issue_number); i.labels.push(...p.labels); w.added.push(...p.labels.map(l => `${p.issue_number}:${l}`)); },
        createComment: async p => { get(p.issue_number).comments.push({ body: p.body }); w.comments.push({ n: p.issue_number, body: p.body }); },
        update: async p => { const i = get(p.issue_number); i.state = p.state; w.closed.push(`${p.issue_number}:${p.state_reason}`); },
      },
    },
  };
  return { github, w, db, O: { owner: 'o', repo: 'r' } };
}

// ── `postMerge` REAL de epic-merge.yml (review PR #380 🟡 2) ────────────────
// Merge MANUAL (`pull_request: closed`, merged) del PR 50 de #40 (`epica`). El
// mundo en memoria guarda issues, labels y comentarios; lo no doblado devuelve
// vacío (el caso mira la absorción y ENCADENAR, no el resto del job).
let emStep = null;
for (const job of Object.values(yaml.load(readFileSync('.github/workflows/epic-merge.yml', 'utf8')).jobs || {}))
  for (const st of job.steps || []) if (st.name === 'Evaluar y mergear') emStep = st;
const epicMerge = emStep ? cargarStep(emStep.with.script, 'epic-merge') : null;
const WS = mkdtempSync(join(tmpdir(), 'abs-ws-'));
for (const d of ['.cola-central', '.epic-merge-central']) symlinkSync(process.cwd(), join(WS, d));

async function mergeManual({ prBody, issues }) {
  const db = new Map(issues.map(i => [i.number, { state: 'open', labels: [], comments: [], body: '', title: `Issue ${i.number}`, ...i }]));
  db.set(50, { number: 50, state: 'closed', labels: [], comments: [], body: prBody, title: 'feat (#40)', pull_request: {} });
  const get = n => { const i = db.get(n); if (!i) throw new Error('404'); return i; };
  const conLabels = i => ({ ...i, labels: i.labels.map(name => ({ name })) });
  let cid = 1;
  const crear = (n, body) => { const c = { id: cid++, body, user: { login: 'talfarouriarte-cloud' }, created_at: new Date().toISOString(), html_url: `https://github.com/o/r/issues/${n}#issuecomment-${cid}` }; get(n).comments.push(c); return { data: c }; };
  const conocidos = {
    issues: {
      get: async p => ({ data: conLabels(get(p.issue_number)) }),
      listComments: async p => ({ data: get(p.issue_number).comments }),
      createComment: async p => crear(p.issue_number, p.body),
      updateComment: async p => { for (const i of db.values()) for (const c of i.comments) if (c.id === p.comment_id) c.body = p.body; return { data: {} }; },
      addLabels: async p => { const i = get(p.issue_number); i.labels = [...new Set([...i.labels, ...p.labels])]; return { data: [] }; },
      removeLabel: async p => { const i = get(p.issue_number); if (!i.labels.includes(p.name)) throw new Error('404 label'); i.labels = i.labels.filter(l => l !== p.name); return { data: [] }; },
      listLabelsOnIssue: async p => ({ data: get(p.issue_number).labels.map(name => ({ name })) }),
      update: async p => { const i = get(p.issue_number); if (p.state) i.state = p.state; return { data: {} }; },
      listForRepo: async p => ({ data: [...db.values()].filter(i => i.state === 'open' && !i.pull_request
        && (!p.labels || p.labels.split(',').every(n => i.labels.includes(n)))).map(conLabels) }),
    },
    users: { getAuthenticated: async () => ({ data: { login: 'talfarouriarte-cloud' } }) },
  };
  const vacio = async () => ({ data: [] });
  const rest = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (_, m) => (conocidos[ns] && conocidos[ns][m]) || vacio }) });
  const github = { rest, paginate: async (fn, p) => { const r = await fn(p); return Array.isArray(r.data) ? r.data : (r.data && (r.data.workflow_runs || r.data.items)) || []; } };
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  const pull_request = { number: 50, state: 'closed', merged: true, body: prBody, head: { ref: 'claude/issue-40-20261101-1200', sha: 'abc' }, labels: [] };
  const avisos = [];
  const core = { setOutput() {}, notice() {}, info() {}, warning: m => avisos.push(String(m)), setFailed: m => avisos.push(String(m)) };
  await epicMerge({ github, context: { repo: { owner: 'o', repo: 'r' }, runId: 1, eventName: 'pull_request', payload: { action: 'closed', pull_request } }, core },
    { env: { GITHUB_WORKSPACE: WS, IN_AUTOMERGE: 'true', IN_EPIC_LABEL: 'epica', IN_CI_WORKFLOW_NAME: 'CI', STATUS_TOKEN: 'job', IN_LOOSE_AUDIT: 'false',
      IN_PARTIAL_ROUND_CAP: '3', IN_PARTIAL_LIFETIME_CAP: '6', IN_DEFAULT_BRANCH: 'main' }, globales: { fetch } });
  return { db, avisos };
}
const autoLaunch = (db, n) => db.get(n).comments.some(c => /<!-- epic-auto-launch -->/.test(c.body));

const BANCO = [
  ['(a) leerAbsorbidos acepta `Absorbe #12` a inicio de línea (varias, sin duplicados)',
    () => JSON.stringify(ABS.leerAbsorbidos('Closes #5\nAbsorbe #12\nAbsorbe #13  \r\nAbsorbe #12')) === '[12,13]'],
  ['(a) leerAbsorbidos rechaza «no Absorbe #12», backticks, `Absorbe#12` y bloque cercado',
    () => ABS.leerAbsorbidos('no Absorbe #12\n`Absorbe #12`\nAbsorbe#12\n```\nAbsorbe #12\n```\nAbsorbe #12 y más').length === 0],
  ['(b) materialización: issue abierto con en-cola ⇒ labels fuera, estado:cierre-pendiente-humano, comentario con marcador, cierre completed',
    async () => {
      const { github, w, db, O } = api([{ number: 12, labels: ['en-cola', 'stalled'] }]);
      const h = await ABS.materializarAbsorcion({ github, ...O, prNumber: 40, issues: [12] });
      const i = db.get(12);
      return h.length === 1 && i.state === 'closed' && w.closed.includes('12:completed')
        && !i.labels.includes('en-cola') && !i.labels.includes('stalled') && i.labels.includes('estado:cierre-pendiente-humano')
        && w.comments.some(c => c.n === 12 && /PR #40 mergeado/.test(c.body) && c.body.includes('<!-- cola-absorbida: #40 -->'));
    }],
  ['(b) materialización: issue ya cerrado ⇒ no-op',
    async () => {
      const { github, w, O } = api([{ number: 12, state: 'closed', labels: ['en-cola'] }]);
      const h = await ABS.materializarAbsorcion({ github, ...O, prNumber: 40, issues: [12] });
      return h.length === 0 && w.removed.length === 0 && w.added.length === 0 && w.comments.length === 0 && w.closed.length === 0;
    }],
  ['(b) materialización: issue inexistente ⇒ aviso, sigue con el resto',
    async () => {
      const { github, O } = api([{ number: 13, labels: ['en-cola'] }]);
      const avisos = [];
      const h = await ABS.materializarAbsorcion({ github, ...O, prNumber: 40, issues: [99, 13], warn: m => avisos.push(m) });
      return JSON.stringify(h) === '[13]' && avisos.length === 1;
    }],
  ['(c) cancelación: devuelve en-cola SOLO al issue con cola-absorbida de ESTE PR (o de su issue)',
    async () => {
      const { github, w, db, O } = api([
        { number: 12, comments: [{ body: 'adenda\n<!-- cola-absorbida: #40 -->' }] },
        { number: 13, comments: [{ body: 'adenda\n<!-- cola-absorbida: #77 -->' }] },
        { number: 14, comments: [{ body: 'adenda\n<!-- cola-absorbida: #30 -->' }] },
        { number: 15, comments: [] },
      ]);
      const h = await ABS.cancelarAbsorcion({ github, ...O, prNumber: 40, origenes: [30], issues: [12, 13, 14, 15] });
      return JSON.stringify(h) === '[12,14]' && db.get(12).labels.includes('en-cola') && db.get(14).labels.includes('en-cola')
        && !db.get(13).labels.includes('en-cola') && !db.get(15).labels.includes('en-cola')
        && w.comments.filter(c => /cerrado sin merge/.test(c.body)).length === 2;
    }],
  ['(c) cancelación idempotente: una segunda pasada no re-comenta',
    async () => {
      const { github, w, O } = api([{ number: 12, comments: [{ body: '<!-- cola-absorbida: #40 -->' }] }]);
      await ABS.cancelarAbsorcion({ github, ...O, prNumber: 40, issues: [12] });
      const h2 = await ABS.cancelarAbsorcion({ github, ...O, prNumber: 40, issues: [12] });
      return h2.length === 0 && w.comments.length === 1;
    }],
  ['(c) marcador citado entre backticks no cuenta',
    async () => {
      const { github, O } = api([{ number: 12, comments: [{ body: 'ver `<!-- cola-absorbida: #40 -->`' }] }]);
      return (await ABS.cancelarAbsorcion({ github, ...O, prNumber: 40, issues: [12] })).length === 0;
    }],
  ['(b) materialización: #N protegido (serial-activo / human-needed / pause-agents / auditoria / auditoria-completa) ⇒ aviso, no se toca',
    async () => {
      const prot = ABS.PROTEGIDAS.map((l, k) => ({ number: 20 + k, labels: [l] }));
      const { github, w, db, O } = api([...prot, { number: 30, labels: ['en-cola'] }]);
      const avisos = [];
      const h = await ABS.materializarAbsorcion({ github, ...O, prNumber: 40, issues: [...prot.map(i => i.number), 30], warn: m => avisos.push(m) });
      return ABS.PROTEGIDAS.length === 5 && JSON.stringify(h) === '[30]' && avisos.length === 5
        && prot.every(i => db.get(i.number).state === 'open') && w.comments.every(c => c.n === 30) && w.closed.join() === '30:completed';
    }],
  ['(d) absorcionVigente: último marcador sin cancelación ⇒ {origen}; con cancelación posterior ⇒ null; re-marcado tras cancelar ⇒ vigente',
    () => {
      const m = x => ({ body: `<!-- cola-absorbida: #${x} -->` }), c = { body: '<!-- cola-absorbida-cancelada -->' };
      return JSON.stringify(ABS.absorcionVigente([{ body: 'x' }, m(40)])) === '{"origen":40}'
        && ABS.absorcionVigente([m(40), c]) === null
        && JSON.stringify(ABS.absorcionVigente([m(40), c, m(55)])) === '{"origen":55}'
        && JSON.stringify(ABS.absorcionVigente([{ body: '<!-- cola-absorbida -->' }])) === '{"origen":null}'
        && ABS.absorcionVigente([]) === null
        && ABS.absorcionVigente([{ body: '`<!-- cola-absorbida: #40 -->`' }]) === null;
    }],
  ['(e) postMerge: `Absorbe #41` sobre el launch-next #41 ⇒ #41 cerrado por estado y SIN epic-auto-launch; diag lo registra',
    async () => {
      if (!epicMerge) return false;
      const { db } = await mergeManual({ prBody: '<!-- full-pr -->\nCloses #40\nAbsorbe #41',
        issues: [{ number: 40, labels: ['epica'], body: 'x\n<!-- launch-next: #41 -->' }, { number: 41, labels: ['epica', 'en-cola'], body: 'y\n<!-- launch-next: #42 -->' }, { number: 42, labels: ['epica'] }] });
      return db.get(41).state === 'closed' && db.get(41).labels.includes('estado:cierre-pendiente-humano') && !autoLaunch(db, 41)
        && db.get(50).comments.some(c => /launch-next #41 absorbido por este PR/.test(c.body));
    }],
  ['(e) control: postMerge con launch-next NO absorbido (#42) ⇒ epic-auto-launch en #42 (el banco recorre ENCADENAR)',
    async () => {
      if (!epicMerge) return false;
      const { db } = await mergeManual({ prBody: '<!-- full-pr -->\nCloses #40\nAbsorbe #41',
        issues: [{ number: 40, labels: ['epica'], body: 'x\n<!-- launch-next: #42 -->' }, { number: 41, labels: ['epica', 'en-cola'] }, { number: 42, labels: ['epica'] }] });
      return db.get(41).state === 'closed' && autoLaunch(db, 42) && !autoLaunch(db, 41);
    }],
  ['costura: epic-merge.yml carga absorcion.cjs en postMerge (materializar) y en closed sin merge (cancelar)',
    () => {
      const em = readFileSync('.github/workflows/epic-merge.yml', 'utf8');
      return /\.epic-merge-central\/vendored\/scripts\/absorcion\.cjs/.test(em)
        && /ABS\.materializarAbsorcion\(/.test(em) && /ABS\.cancelarAbsorcion\(/.test(em);
    }],
];

const rojos = [];
for (const [nombre, fn] of BANCO) {
  try { if (!(await fn())) rojos.push(nombre); } catch (e) { rojos.push(`${nombre}: excepción ${e.message}`); }
}
if (rojos.length) { console.error('CHECK-ABSORCION ROJO:'); rojos.forEach(e => console.error('  - ' + e)); process.exit(1); }
console.log(`check-absorcion verde: ${BANCO.length} casos de absorción de alcance (AP-122).`);
