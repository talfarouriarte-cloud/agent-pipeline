#!/usr/bin/env node
// check-absorcion — banco de `vendored/scripts/absorcion.cjs` (AP-122,
// central#307): `Absorbe #N` con consumidor mecánico al mergear el PR que
// absorbe, y devolución a `en-cola` si se cierra sin merge.
//
// Corre el módulo REAL contra una API de GitHub en memoria (issues, labels,
// comentarios). La costura con `epic-merge.yml` (que `postMerge` y la rama
// `closed` sin merge carguen el módulo) se comprueba por texto. Cuelga del
// piggyback de `check-embedded-js.mjs`.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

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
