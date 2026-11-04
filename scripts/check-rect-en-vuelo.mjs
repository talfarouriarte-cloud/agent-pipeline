#!/usr/bin/env node
// check-rect-en-vuelo — banco de `vendored/scripts/rect-en-vuelo.cjs` (AP-055
// extraído verbatim del scan del Watchdog; segundo llamador: el gate de merge
// de `epic-merge.yml` — central#304, ruling mensual 2026-11-01, posición 4;
// AP-125). Doble de API en memoria (patrón AP-091): `compareCommits` con patch
// y `getContent` con el volumen vigente para la atribución al `## (ADR|AP)-N`.
//
// Dos capas: (1) el módulo (clave en sus DOS formas, dedupe por clave, PR que
// no cita); (2) el gate de merge REAL de epic-merge sobre un PR `lgtm` +
// `ci-verde`: con una rectificación del ADR citado sin marcador NO mergea,
// retira `lgtm` y re-convoca; con el marcador ya puesto, mergea solo si hay
// un veredicto del Reviewer POSTERIOR al marcador (review de PR #383, 🔴). Más las
// costuras con los dos llamadores. Cuelga del piggyback de
// `check-embedded-js.mjs`. Verde: exit 0.
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);
const FUENTES = ['vendored/scripts/rect-en-vuelo.cjs', 'scripts/rect-en-vuelo.cjs'];
const fuente = FUENTES.find(f => existsSync(f));
if (!fuente) {
  console.log('::warning::check-rect-en-vuelo — no encuentro `rect-en-vuelo.cjs`: el banco NO se ha ejecutado.');
  process.exit(0);
}
const RV = require(resolve(fuente));
const fallos = [];
const caso = (nombre, ok) => { if (!ok) fallos.push(nombre); };
const J = x => JSON.stringify(x);

const VOL = [
  '# Decisiones', '',
  '## ADR-5 — Algo', 'texto', '### Revisión R·1 (2026-10-30, issue #9) — el campo `rank`', 'cuerpo', '',
  '## AP-6 — Otra', 'texto', '**Enmienda (2026-07-13).** ahora vale X', '',
].join('\n');
const PATCH = ['@@ -1,3 +1,5 @@', ' texto', '+### Revisión R·1 (2026-10-30, issue #9) — el campo `rank`', '+cuerpo', ' texto', '+**Enmienda (2026-07-13).** ahora vale X'].join('\n');
function api({ patch = PATCH, commits = 1, vol = VOL } = {}) {
  return {
    rest: {
      repos: {
        compareCommits: async () => ({ data: { commits: Array.from({ length: commits }, (_, i) => ({ sha: 's' + i })), files: [{ filename: 'docs/decisions.md', patch }] } }),
        getContent: async () => ({ data: vol }),
      },
    },
  };
}
const PR = (titulo, body = '') => ({ number: 7, title: titulo, body, base: { sha: 'b0', ref: 'main' } });

const r1 = await RV.detectar({ github: api(), O: { owner: 'o', repo: 'r' }, pr: PR('feat (ADR-5)') });
caso('`### Revisión R·1` bajo `## ADR-5`, PR cita ADR-5 ⇒ clave `ADR-5·R·1`', J(r1.map(r => r.clave)) === J(['ADR-5·R·1']));
const r2 = await RV.detectar({ github: api(), O: { owner: 'o', repo: 'r' }, pr: PR('feat', 'Implementa AP-6.') });
caso('`**Enmienda (2026-07-13).**` bajo `## AP-6` ⇒ `AP-6·enmienda-2026-07-13`', J(r2.map(r => r.clave)) === J(['AP-6·enmienda-2026-07-13']));
caso('clave ya marcada ⇒ `yaMarcada` true', RV.yaMarcada([{ body: `aviso\n${RV.marcador('ADR-5·R·1')}` }], 'ADR-5·R·1') === true);
caso('marcador de OTRA clave ⇒ `yaMarcada` false', RV.yaMarcada([{ body: RV.marcador('ADR-5·R·2') }], 'ADR-5·R·1') === false);
caso('PR que no cita el ADR ⇒ vacío', (await RV.detectar({ github: api(), O: {}, pr: PR('feat', 'cita ADR-9') })).length === 0);
caso('PR sin citas ⇒ vacío', (await RV.detectar({ github: api(), O: {}, pr: PR('feat') })).length === 0);
caso('base sin commits nuevos ⇒ vacío', (await RV.detectar({ github: api({ commits: 0 }), O: {}, pr: PR('ADR-5') })).length === 0);
caso('`## ADR-7` NUEVO (header de bloque sin ordinal) no es rectificación',
  (await RV.detectar({ github: api({ patch: '+## ADR-7 — Nuevo', vol: '## ADR-7 — Nuevo' }), O: {}, pr: PR('ADR-7') })).length === 0);

// ── AP-135 (central#393): `layout: "dir"` y `cargarCfg` ──────────────────────
const DIR_VOL = ['## ADR-5 — Algo', 'texto', '### Revisión R·1 (2026-10-30, issue #9) — el campo `rank`', 'cuerpo'].join('\n');
const DIR_PATCH = ['@@ -1,2 +1,4 @@', ' texto', '+### Revisión R·1 (2026-10-30, issue #9) — el campo `rank`', '+cuerpo'].join('\n');
const apiDir = (filename) => ({ rest: { repos: {
  compareCommits: async () => ({ data: { commits: [{ sha: 's0' }], files: [{ filename, patch: DIR_PATCH }] } }),
  getContent: async () => ({ data: DIR_VOL }),
} } });
const CFG_DIR = { layout: 'dir', dir: 'docs/decisions/adr' };
const ra = await RV.detectar({ github: apiDir('docs/decisions/adr/ADR-5.md'), O: {}, pr: PR('feat (ADR-5)'), cfg: CFG_DIR });
caso('(a) `docs/decisions/adr/ADR-5.md` con cfg dir ⇒ clave `ADR-5·R·1`', J(ra.map(r => r.clave)) === J(['ADR-5·R·1']));
const rb = await RV.detectar({ github: apiDir('docs/decisions/adr/ADR-5.md'), O: {}, pr: PR('feat (ADR-5)'), cfg: null });
caso('(b) mismo patch con cfg null ⇒ no detecta (statu quo del regex heredado)', rb.length === 0);
const rc = await RV.detectar({ github: apiDir('docs/decisions.md'), O: {}, pr: PR('feat (ADR-5)'), cfg: CFG_DIR });
caso('(c) `docs/decisions.md` con cfg dir ⇒ sigue detectando (índice)', J(rc.map(r => r.clave)) === J(['ADR-5·R·1']));
caso('cfg dir: un fichero fuera de `<dir>/ADR-N.md` no entra',
  (await RV.detectar({ github: apiDir('docs/decisions/adr/notas.md'), O: {}, pr: PR('feat (ADR-5)'), cfg: CFG_DIR })).length === 0);
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const apiCfg = (fn) => ({ rest: { repos: { getContent: fn } } });
const conCfg = (txt) => apiCfg(async (p) => {
  if (p.path !== 'adr-lint.config.json') throw new Error('path inesperado');
  return { data: { content: b64(txt), encoding: 'base64' } };
});
const err404 = Object.assign(new Error('Not Found'), { status: 404 });
const cc = (github) => RV.cargarCfg({ github, O: { owner: 'o', repo: 'r' }, ref: 'main' });
caso('(d) cargarCfg: 404 ⇒ null', (await cc(apiCfg(async () => { throw err404; }))) === null);
caso('(d) cargarCfg: contenido no JSON ⇒ null', (await cc(conCfg('{no json'))) === null);
caso('(d) cargarCfg: `{"layout":"volumes"}` ⇒ null', (await cc(conCfg('{"layout":"volumes"}'))) === null);
caso('(d) cargarCfg: `{}` ⇒ null', (await cc(conCfg('{}'))) === null);
caso('(d) cargarCfg: `{"layout":"dir"}` ⇒ dir por defecto', J(await cc(conCfg('{"layout":"dir"}'))) === J({ layout: 'dir', dir: 'docs/decisions/adr' }));
caso('(d) cargarCfg: `{"layout":"dir","dir":"x/y/"}` ⇒ `dir:"x/y"`', J(await cc(conCfg('{"layout":"dir","dir":"x/y/"}'))) === J({ layout: 'dir', dir: 'x/y' }));
let lanzo = false, rRed;
try { rRed = await cc(apiCfg(async () => { throw new Error('ECONNRESET'); })); } catch (e) { lanzo = true; }
caso('(d) cargarCfg: error de red ⇒ null sin lanzar', !lanzo && rRed === null);
caso('cargarCfg: respuesta sin `content` (p. ej. directorio o raw) ⇒ null', (await cc(apiCfg(async () => ({ data: 'texto' })))) === null);
const escReSrc = (f) => existsSync(f) ? (readFileSync(f, 'utf8').match(/^const escRe = .*$/m) || [])[0] : null;
const escReOrigen = escReSrc('vendored/scripts/adr-append-merge.mjs');
if (escReOrigen) caso('`escRe` copiada = la de `adr-append-merge.mjs` (mismo fuente)', escReSrc(fuente) === escReOrigen);
caso('`escRe` escapa los metacaracteres de una ruta', new RegExp(`^${RV.escRe('a.b+(c)')}$`).test('a.b+(c)') && !new RegExp(`^${RV.escRe('a.b')}$`).test('axb'));

// ── Costuras ────────────────────────────────────────────────────────────────
const WD = '.github/workflows/watchdog.yml';
const EM = '.github/workflows/epic-merge.yml';
if (existsSync(WD)) {
  const wd = readFileSync(WD, 'utf8');
  caso('watchdog: el scan llama a `RV.detectar` (sin copia local del detector)', wd.includes('await RV.detectar({ github, O, pr,') && !wd.includes('const rectCand = '));
  caso('watchdog: el scan pasa `cfg` de `cargarCfg` cacheado por `base.ref` (AP-135)', wd.includes('RV.cargarCfg({ github, O, ref: pr.base.ref })') && wd.includes('rectCfgs.set(pr.base.ref') && wd.includes('await RV.detectar({ github, O, pr, cfg,'));
  caso('watchdog: el `RECT_MARK_RE` local del belt AP-024 = el del módulo', wd.includes(`const RECT_MARK_RE = ${RV.RECT_MARK_RE.toString()};`));
}
if (existsSync(EM)) {
  const emTxt = readFileSync(EM, 'utf8');
  caso('epic-merge: el gate carga el módulo del checkout sparse', emTxt.includes('.epic-merge-central/vendored/scripts/rect-en-vuelo.cjs'));
  caso('epic-merge: el gate pasa `cfg` de `cargarCfg` a `detectar` (AP-135)', emTxt.includes('RV.cargarCfg({ github, O: { owner, repo }, ref: (pf || pr).base.ref })') && emTxt.includes('pr: pf || pr, cfg,'));
  const iGate = emTxt.indexOf('await RV.detectar(');
  const iMerge = emTxt.indexOf('await github.rest.pulls.merge(');
  caso('epic-merge: el gate de rectificación corre ANTES del merge', iGate > 0 && iMerge > iGate);

  // ── Gate REAL: evento `labeled: lgtm` sobre un PR verde de #40 que cita ADR-5.
  let emStep = null;
  for (const job of Object.values(yaml.load(emTxt).jobs || {}))
    for (const st of job.steps || []) if (st.name === 'Evaluar y mergear') emStep = st;
  const epicMerge = cargarStep(emStep.with.script, 'epic-merge');
  const WS = mkdtempSync(join(tmpdir(), 'rv-ws-'));
  symlinkSync(process.cwd(), join(WS, '.epic-merge-central'));
  // AP-139: GATE 2 exige el SHA revisado (`reviewer-lgtm-sha`) igual al head.
  const H1 = '1'.repeat(40);
  const MK = (id) => ({ id, body: `**reviewer · \`lgtm\` materializado**\n\n<!-- reviewer-lgtm-sha: ${H1} -->`, user: { login: 'talfarouriarte-cloud' } });
  async function gate({ prComments = [{ id: 96, body: 'LGTM\nok', user: { login: 'talfarouriarte-cloud' } }, MK(97)], labels = ['lgtm', 'ci-verde'] } = {}) {
    const w = { merged: false, labels: [...labels], comments: [...prComments], added: [], removed: [] };
    const pr = { number: 50, state: 'open', merged: false, draft: false, title: 'feat: rank (ADR-5)', body: 'Refs #40', head: { ref: 'claude/issue-40-x', sha: H1 }, base: { ref: 'main', sha: 'b0' }, labels: w.labels.map(name => ({ name })) };
    const issue = { number: 40, state: 'open', title: 'Issue 40', body: '', labels: [{ name: 'epica' }] };
    const conocidos = {
      issues: {
        get: async p => ({ data: p.issue_number === 40 ? issue : { number: p.issue_number, labels: [], body: '' } }),
        listComments: async p => ({ data: p.issue_number === 50 ? w.comments : [] }),
        createComment: async p => { if (p.issue_number === 50) w.comments.push({ id: w.comments.length + 1, body: p.body, user: { login: 'talfarouriarte-cloud' } }); return { data: { id: 1 } }; },
        removeLabel: async p => { w.removed.push(p.name); return { data: [] }; },
        addLabels: async p => { w.added.push(...p.labels); return { data: [] }; },
      },
      pulls: {
        get: async () => ({ data: { ...pr, mergeable_state: 'clean' } }),
        merge: async () => { w.merged = true; return { data: {} }; },
      },
      repos: api().rest.repos,
      users: { getAuthenticated: async () => ({ data: { login: 'talfarouriarte-cloud' } }) },
    };
    const vacio = async () => ({ data: [] });
    const rest = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (_, m) => (conocidos[ns] && conocidos[ns][m]) || vacio }) });
    const github = { rest, paginate: async (fn, p) => { const r = await fn(p); return Array.isArray(r.data) ? r.data : []; } };
    const fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
    const core = { setOutput() {}, notice() {}, info() {}, warning() {}, setFailed() {} };
    await epicMerge({ github, context: { repo: { owner: 'o', repo: 'r' }, runId: 1, eventName: 'pull_request', payload: { action: 'labeled', label: { name: 'lgtm' }, pull_request: pr } }, core },
      { env: { GITHUB_WORKSPACE: WS, IN_AUTOMERGE: 'true', IN_EPIC_LABEL: 'epica', IN_CI_WORKFLOW_NAME: 'CI', STATUS_TOKEN: 'job', IN_LOOSE_AUDIT: 'false',
        IN_PARTIAL_ROUND_CAP: '3', IN_PARTIAL_LIFETIME_CAP: '6', IN_DEFAULT_BRANCH: 'main' }, globales: { fetch } });
    return w;
  }
  const g1 = await gate();
  caso('gate real: rectificación de ADR citado sin marcador ⇒ NO mergea, retira `lgtm`, re-aplica `needs-review`, marcador con clave',
    !g1.merged && g1.removed.includes('lgtm') && g1.added.includes('needs-review') && g1.comments.some(c => c.body.includes(RV.marcador('ADR-5·R·1'))));
  const REV = 'talfarouriarte-cloud';
  const MARCA = { id: 99, body: `aviso previo\n${RV.marcador('ADR-5·R·1')}`, user: { login: 'x' } };
  const reAvisos = w => w.comments.filter(c => c.body.includes('aterrizada EN VUELO')).length;
  const LGTM = (id) => ({ id, body: 'LGTM\nok', user: { login: REV } });
  const g2 = await gate({ prComments: [LGTM(98), MK(99), MARCA, LGTM(100)] });
  caso('gate real: clave ya marcada + LGTM POSTERIOR al marcador ⇒ mergea sin volver a comentar', g2.merged && !g2.removed.includes('lgtm') && reAvisos(g2) === 0);
  // AP-139: sin respaldo por comentarios en GATE 2 — sin label y con el head = SHA
  // revisado el LGTM no es vigente; el corte llega antes del gate 4.
  const g3 = await gate({ prComments: [LGTM(98), MK(99), MARCA], labels: ['ci-verde'] });
  caso('gate real: clave ya marcada, LGTM solo ANTERIOR al marcador, sin label `lgtm` ⇒ NO mergea y no re-comenta (GATE 2 sin respaldo, AP-139)',
    !g3.merged && reAvisos(g3) === 0 && g3.comments.some(c => c.body.includes('LGTM no vigente')));
  const g4 = await gate({ prComments: [LGTM(98), MK(99), MARCA] });
  caso('gate real: clave ya marcada, label `lgtm` re-puesta sin veredicto posterior ⇒ NO mergea', !g4.merged && reAvisos(g4) === 0);
  // Módulo: `consumida` con la relación de orden.
  caso('`consumida`: veredicto anterior al marcador ⇒ false', RV.consumida([LGTM(1), MARCA], 'ADR-5·R·1', REV) === false);
  caso('`consumida`: REVIEW posterior ⇒ true', RV.consumida([MARCA, { body: 'REVIEW\nx', user: { login: REV } }], 'ADR-5·R·1', REV) === true);
  caso('`consumida`: LGTM posterior de OTRO login ⇒ false', RV.consumida([MARCA, { body: 'LGTM', user: { login: 'y' } }], 'ADR-5·R·1', REV) === false);
  caso('`consumida`: sin marcador ⇒ false', RV.consumida([LGTM(1)], 'ADR-5·R·1', REV) === false);
}

if (fallos.length) {
  console.error(`CHECK-RECT-EN-VUELO ROJO (${fuente}): ${fallos.length} caso(s) fallan:`);
  for (const x of fallos) console.error(`  ✗ ${x}`);
  process.exit(1);
}
console.log(`check-rect-en-vuelo verde (${fuente}): todos los casos pasan.`);
