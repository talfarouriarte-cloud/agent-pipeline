#!/usr/bin/env node
// check-epic-audit-guard — banco de `vendored/scripts/epic-audit-guard.cjs`
// (central#368, ruling mensual 2026-11-01, posición 4; AP-125): guard de rango
// al consumir `epic-audit` y dedupe de panel consciente del veredicto.
//
// Dos capas. (1) Las funciones puras del módulo, con los casos (a)–(g) del
// ruling. (2) El `postMerge` REAL de `epic-merge.yml` (camino de merge manual,
// patrón de `check-absorcion.mjs`) sobre la API en memoria, para lo que la
// decisión pura no ve: la interacción del `prematuro` con el pop de cola
// (crítica ronda 3, [J]: un issue, un dueño del arm) y la adopción de un panel
// con veredicto (el P0 literal de #368). Cuelga del piggyback de
// `check-embedded-js.mjs`. Verde: exit 0.
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);
const FUENTES = ['vendored/scripts/epic-audit-guard.cjs', 'scripts/epic-audit-guard.cjs'];
const fuente = FUENTES.find(f => existsSync(f));
if (!fuente) {
  console.log('::warning::check-epic-audit-guard — no encuentro `epic-audit-guard.cjs`: el banco NO se ha ejecutado.');
  process.exit(0);
}
const G = require(resolve(fuente));   // un SyntaxError aquí es ROJO, y debe serlo
const fallos = [];
const caso = (nombre, ok) => { if (!ok) fallos.push(nombre); };
const iss = (number, labels, state = 'open', extra = {}) => ({ number, state, labels: labels.map(name => ({ name })), ...extra });
const J = x => JSON.stringify(x);

// ── (a) parseRango ─────────────────────────────────────────────────────────
caso('(a) `ADR-318, #3348-#3352` ⇒ 3348-3352', J(G.parseRango('ADR-318, #3348-#3352')) === J({ first: 3348, last: 3352 }));
caso('(a) `correctivos #3088-#3088` ⇒ 3088-3088', J(G.parseRango('correctivos #3088-#3088')) === J({ first: 3088, last: 3088 }));
caso('(a) guion largo `#10–#12` ⇒ 10-12', J(G.parseRango('ADR-1, #10–#12')) === J({ first: 10, last: 12 }));
caso('(a) alcance sin `#a-#b` ⇒ null', G.parseRango('ADR-318') === null && G.parseRango('x') === null);
caso('(a) sin rango ⇒ `crear`', G.decidirEpicAudit({ scope: 'ADR-318', issueNumber: 5, issuesDelIntervalo: [iss(6, ['epica'])], epicLabel: 'epica' }).accion === 'crear');

// ── (b)–(d) pendientes ─────────────────────────────────────────────────────
const R = { first: 100, last: 105 };
const conPR = [iss(101, ['epica'], 'open', { pull_request: {} }), iss(102, ['bug'])];
caso('(b) PR abierto interior + issue ajeno sin la label ⇒ 0 pendientes ⇒ `crear`',
  G.pendientes(conPR, 100, 'epica', R).length === 0
  && G.decidirEpicAudit({ scope: '#100-#105', issueNumber: 100, issuesDelIntervalo: conPR, epicLabel: 'epica' }).accion === 'crear');
caso('(b) la label es la del INPUT, no el literal `epica`',
  J(G.pendientes([iss(101, ['epic']), iss(102, ['epica'])], 100, 'epic', R)) === '[101]');
caso('(c) issue con label abierto con `partial-pr` mergeado ⇒ pendiente (manda el estado)',
  J(G.pendientes([iss(103, ['epica'], 'open', { body: '<!-- partial-pr -->' })], 100, 'epica', R)) === '[103]');
caso('(d) issue con label cerrado `not_planned` ⇒ no pendiente',
  G.pendientes([iss(103, ['epica'], 'closed', { state_reason: 'not_planned' })], 100, 'epica', R).length === 0);
caso('(d) fuera del intervalo (hijo de partición > last) ⇒ no pendiente (residual declarado)',
  G.pendientes([iss(106, ['epica'])], 100, 'epica', R).length === 0);
caso('(d) el propio issue que consume el sentinel nunca es pendiente',
  G.pendientes([iss(100, ['epica'])], 100, 'epica', R).length === 0);

// ── (e)/(f) decisión ───────────────────────────────────────────────────────
const e = G.decidirEpicAudit({ scope: 'ADR-294, #3104-#3105', issueNumber: 3104, issuesDelIntervalo: [iss(3105, ['epica'])], epicLabel: 'epica' });
caso('(e) P0 de #368: 3104 < last=3105 con #3105 abierto ⇒ `prematuro`, pendiente menor 3105',
  e.accion === 'prematuro' && e.pendientes[0] === 3105);
const f = G.decidirEpicAudit({ scope: 'ADR-294, #3104-#3105', issueNumber: 3105, issuesDelIntervalo: [iss(3104, ['epica'])], epicLabel: 'epica' });
caso('(f) issueNumber = last con un issue del intervalo abierto ⇒ `rango-abierto`', f.accion === 'rango-abierto' && J(f.pendientes) === '[3104]');
caso('(f) issueNumber = last sin pendientes ⇒ `crear`',
  G.decidirEpicAudit({ scope: 'ADR-294, #3104-#3105', issueNumber: 3105, issuesDelIntervalo: [iss(3104, ['epica'], 'closed')], epicLabel: 'epica' }).accion === 'crear');

// ── [J] dueño único del arm del pendiente menor ────────────────────────────
caso('[J] pendiente armado por el pop de este merge ⇒ sin `stalled`',
  G.destinoPrematuro({ pendienteMenor: 3105, labelsPendiente: [], prAbierto: false, armadoAhora: 3105 }).stalled === false);
caso('[J] pendiente `serial-activo` / `en-cola` / con PR ⇒ sin `stalled`',
  ['serial-activo', 'en-cola'].every(l => G.destinoPrematuro({ pendienteMenor: 3105, labelsPendiente: [l], armadoAhora: null }).stalled === false)
  && G.destinoPrematuro({ pendienteMenor: 3105, labelsPendiente: [], prAbierto: true, armadoAhora: null }).stalled === false);
caso('[J] pendiente sin dueño ⇒ `stalled` en el pendiente menor',
  J(G.destinoPrematuro({ pendienteMenor: 3105, labelsPendiente: [], prAbierto: false, armadoAhora: 999 })) === J({ issue: 3105, stalled: true, motivo: null }));
caso('[J] el cuerpo lleva el marcador del intermedio',
  G.cuerpoPrematuro({ issueConSentinel: 3104, pendientes: [3105], destino: { issue: 3105, stalled: true } }).includes('<!-- epic-audit-prematuro: #3104 -->'));

// ── (g) decidirAdopcion ────────────────────────────────────────────────────
const BASE = 'Auditoría de épica · ADR-294, #3104-#3105';
const V = [{ body: 'Informe.\n<!-- audit-verdict: findings -->' }];
const conV = G.decidirAdopcion({ number: 3109, title: BASE }, V, [{ title: BASE, conVeredicto: true }], BASE);
caso('(g) panel abierto con `audit-verdict` ⇒ no se adopta; título «(re-auditoría 1)»',
  conV.adoptar === false && conV.titulo === `${BASE} (re-auditoría 1)`);
const conV2 = G.decidirAdopcion({ number: 3109, title: BASE }, V,
  [{ title: BASE, conVeredicto: true }, { title: `${BASE} (re-auditoría 1)`, conVeredicto: true }, { title: 'Auditoría de épica · ADR-1', conVeredicto: true }], BASE);
caso('(g) con un «(re-auditoría 1)» cerrado con veredicto ⇒ «(re-auditoría 2)» (paneles de otro alcance no cuentan)',
  conV2.adoptar === false && conV2.titulo === `${BASE} (re-auditoría 2)`);
caso('(g) panel abierto sin veredicto ⇒ se adopta', G.decidirAdopcion({ number: 3109, title: BASE }, [{ body: 'en curso' }], [], BASE).adoptar === true);
caso('(g) veredicto CITADO sin cadena completa no cuenta', G.tieneVeredicto([{ body: 'el marcador `audit-verdict:` falta' }]) === false);
caso('(g) `RE_VERDICT` = el del post-step del Auditor en claude-code.yml',
  !existsSync('.github/workflows/claude-code.yml') || readFileSync('.github/workflows/claude-code.yml', 'utf8').includes(`const RE_VERDICT = ${G.RE_VERDICT.toString()};`));

// ── Costura + `postMerge` REAL ─────────────────────────────────────────────
const EM = '.github/workflows/epic-merge.yml';
if (existsSync(EM)) {
  const emTxt = readFileSync(EM, 'utf8');
  caso('costura: epic-merge carga el módulo del checkout sparse', emTxt.includes('.epic-merge-central/vendored/scripts/epic-audit-guard.cjs'));
  caso('costura: los DOS consumidores pasan por el guard', (emTxt.match(/await guardEpicAudit\(scopeAm, issueNumber\)/g) || []).length === 2);
  let emStep = null;
  for (const job of Object.values(yaml.load(emTxt).jobs || {}))
    for (const st of job.steps || []) if (st.name === 'Evaluar y mergear') emStep = st;
  const epicMerge = cargarStep(emStep.with.script, 'epic-merge');
  const WS = mkdtempSync(join(tmpdir(), 'eag-ws-'));
  symlinkSync(process.cwd(), join(WS, '.epic-merge-central'));

  // Merge MANUAL del PR 50 de `issueN` (`epica`); `issues` = mundo inicial.
  async function mergeManual({ issueN, issues }) {
    const db = new Map(issues.map(i => [i.number, { state: 'open', labels: [], comments: [], body: '', title: `Issue ${i.number}`, created_at: '2026-10-22T13:00:00Z', ...i }]));
    db.set(50, { number: 50, state: 'closed', labels: [], comments: [], body: '<!-- full-pr -->', title: 'feat', pull_request: {} });
    const get = n => { const i = db.get(n); if (!i) throw new Error('404'); return i; };
    const conLabels = i => ({ ...i, labels: i.labels.map(name => ({ name })) });
    let cid = 1, nid = 3200;
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
        create: async p => { const n = nid++; db.set(n, { number: n, state: 'open', labels: p.labels, comments: [], body: p.body, title: p.title }); return { data: { number: n } }; },
        listForRepo: async p => ({ data: [...db.values()].filter(i => (p.state === 'all' || i.state === (p.state || 'open')) && !i.pull_request
          && (!p.labels || p.labels.split(',').every(n => i.labels.includes(n)))).map(conLabels) }),
      },
      users: { getAuthenticated: async () => ({ data: { login: 'talfarouriarte-cloud' } }) },
    };
    const vacio = async () => ({ data: [] });
    const rest = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (_, m) => (conocidos[ns] && conocidos[ns][m]) || vacio }) });
    const github = { rest, paginate: async (fn, p) => { const r = await fn(p); return Array.isArray(r.data) ? r.data : []; } };
    const fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
    const pull_request = { number: 50, state: 'closed', merged: true, body: '<!-- full-pr -->', head: { ref: `claude/issue-${issueN}-20261022-1300`, sha: 'abc' }, base: { ref: 'main', sha: 'b0' }, labels: [] };
    const avisos = [];
    const core = { setOutput() {}, notice() {}, info() {}, warning: m => avisos.push(String(m)), setFailed: m => avisos.push(String(m)) };
    await epicMerge({ github, context: { repo: { owner: 'o', repo: 'r' }, runId: 1, eventName: 'pull_request', payload: { action: 'closed', pull_request } }, core },
      { env: { GITHUB_WORKSPACE: WS, IN_AUTOMERGE: 'true', IN_EPIC_LABEL: 'epica', IN_CI_WORKFLOW_NAME: 'CI', STATUS_TOKEN: 'job', IN_LOOSE_AUDIT: 'false',
        IN_PARTIAL_ROUND_CAP: '3', IN_PARTIAL_LIFETIME_CAP: '6', IN_DEFAULT_BRANCH: 'main' }, globales: { fetch } });
    return { db, avisos };
  }
  const SENT = '<!-- epic-audit: ADR-294, #3104-#3105 -->';
  const paneles = db => [...db.values()].filter(i => (i.labels || []).includes('auditoria'));
  const tiene = (db, n, re) => db.get(n).comments.some(c => re.test(c.body || ''));

  // (e-real) el incidente: #3105 `en-cola` ⇒ el pop lo arma; sin panel; marcador sin `stalled`.
  {
    const { db } = await mergeManual({ issueN: 3104, issues: [
      { number: 3104, labels: ['epica'], body: `Eslabón 1/2.\n${SENT}` },
      { number: 3105, labels: ['epica', 'en-cola'], body: `Eslabón 2/2.\n${SENT}` },
    ] });
    caso('(e-real) intermedio con sentinel de fin ⇒ NO se crea panel', paneles(db).length === 0);
    caso('(e-real) la serie se libera igual: el pop arma #3105', tiene(db, 3105, /<!-- arm-de-cola -->/));
    caso('(e-real) [J] #3105 lleva `epic-audit-prematuro: #3104` y NO `stalled` (un solo dueño del arm)',
      tiene(db, 3105, /<!-- epic-audit-prematuro: #3104 -->/) && !db.get(3105).labels.includes('stalled'));
  }
  // (e-real, sin dueño) cola vacía: nadie arma #3105 ⇒ `stalled` + marcador.
  {
    const { db } = await mergeManual({ issueN: 3104, issues: [
      { number: 3104, labels: ['epica'], body: `Eslabón 1/2.\n${SENT}` },
      { number: 3105, labels: ['epica'], body: 'Eslabón 2/2.' },
    ] });
    caso('(e-real) pendiente sin dueño del arm ⇒ `stalled` + marcador en #3105, sin panel',
      paneles(db).length === 0 && db.get(3105).labels.includes('stalled') && tiene(db, 3105, /<!-- epic-audit-prematuro: #3104 -->/));
  }
  // (e-real, con cadena) `epic-audit` + `launch-next` en el intermedio ⇒ se sigue la cadena.
  {
    const { db } = await mergeManual({ issueN: 3104, issues: [
      { number: 3104, labels: ['epica'], body: `Eslabón 1/2.\n${SENT}\n<!-- launch-next: #3105 -->` },
      { number: 3105, labels: ['epica'], body: 'Eslabón 2/2.' },
    ] });
    caso('(e-real) prematuro con `launch-next` ⇒ sin panel, #3105 armado por su cadena, sin `stalled`',
      paneles(db).length === 0 && tiene(db, 3105, /<!-- epic-auto-launch -->/) && !db.get(3105).labels.includes('stalled'));
  }
  // (g-real) el P0 de #368: el panel #3109 ya tiene veredicto al mergear el último.
  {
    const { db } = await mergeManual({ issueN: 3105, issues: [
      { number: 3104, labels: ['epica'], state: 'closed', body: SENT },
      { number: 3105, labels: ['epica'], body: SENT },
      { number: 3109, labels: ['auditoria'], title: 'Auditoría de épica · ADR-294, #3104-#3105', comments: [{ id: 900, body: 'Informe parcial.\n<!-- audit-verdict: findings -->', user: { login: 'x' } }] },
    ] });
    const nuevos = paneles(db).filter(i => i.number !== 3109);
    caso('(g-real) panel con veredicto NO se adopta: nace «(re-auditoría 1)» armado en su body',
      nuevos.length === 1 && nuevos[0].title === 'Auditoría de épica · ADR-294, #3104-#3105 (re-auditoría 1)' && /@claude arranca la auditoría/.test(nuevos[0].body));
    caso('(g-real) el panel viejo no recibe claim ni arm nuevo', db.get(3109).comments.length === 1);
  }
  // (f-real) último eslabón con un issue del intervalo abierto ⇒ panel con la línea de rango abierto.
  {
    const { db } = await mergeManual({ issueN: 3105, issues: [
      { number: 3104, labels: ['epica'], body: 'reabierto' },
      { number: 3105, labels: ['epica'], body: SENT },
    ] });
    const p = paneles(db);
    caso('(f-real) `rango-abierto` ⇒ panel creado con línea y marcador',
      p.length === 1 && p[0].body.includes('<!-- epic-audit-rango-abierto: #3104 -->') && /Rango abierto al consumir/.test(p[0].body));
  }
}

if (fallos.length) {
  console.error(`CHECK-EPIC-AUDIT-GUARD ROJO (${fuente}): ${fallos.length} caso(s) fallan:`);
  for (const x of fallos) console.error(`  ✗ ${x}`);
  process.exit(1);
}
console.log(`check-epic-audit-guard verde (${fuente}): todos los casos pasan.`);
