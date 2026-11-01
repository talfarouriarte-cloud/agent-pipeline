#!/usr/bin/env node
// check-reviewer-header — banco de casos EJECUTABLE de la cabecera del Reviewer
// materializada por estado (`vendored/scripts/reviewer-header-terminals.cjs`) y
// de su consumidor en `epic-merge` (`vendored/scripts/launch-hold.cjs`), AP-129
// (central#362, funde #308).
//
// Casos del ruling: (a)–(f) `clasificarCabecera`; costura de `run`; (g)–(i)
// `launch-hold`; (j) costura de la invocación en `postMerge` de
// `epic-merge.yml` — un `ReferenceError` ahí, después del merge y antes del
// `launch-next`, cortaría TODAS las cadenas de los dos consumidores, por eso
// es rojo de CI y no una lectura del diff. (k) costura de la invocación en
// `reviewer.yml`.
//
// Verde: exit 0. Rojo: el comportamiento real cambió y el banco lo nota.
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve, dirname } from 'path';

const require = createRequire(import.meta.url);

// Central primero (fichero FUENTE); el consumidor lo recibe en `scripts/`.
const FUENTES = ['vendored/scripts/reviewer-header-terminals.cjs', 'scripts/reviewer-header-terminals.cjs'];
let fuente = null;
let RH = null;
for (const f of FUENTES) {
  if (!existsSync(f)) continue;
  RH = require(resolve(f));   // un SyntaxError aquí es ROJO, y debe serlo
  fuente = f;
  break;
}
if (!RH) {
  console.log('::warning::check-reviewer-header — no encuentro `reviewer-header-terminals.cjs` en ninguna de sus dos ubicaciones: el banco NO se ha ejecutado.');
  process.exit(0);
}
const LH = require(resolve(dirname(fuente), 'launch-hold.cjs'));

const fallos = [];
let n = 0;
const caso = (nombre, ok, detalle = '') => { n++; if (!ok) fallos.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`); };
const { clasificarCabecera } = RH;

// ── (a)–(f) clasificación PURA ──────────────────────────────────────────────
const PING = '<!-- ping-creator -->';
let r = clasificarCabecera('REVIEW\n[NEEDS-HUMAN]: x\n<!-- reviewer-presupuesto: 30 turnos -->\n\nResumen.');
caso('(a) REVIEW + [NEEDS-HUMAN] sin ping ⇒ needsHuman=x, ping=false', r.veredicto === 'REVIEW' && r.needsHuman === 'x' && r.ping === false && r.launchHold === null, JSON.stringify(r));
r = clasificarCabecera('LGTM\n[LAUNCH-HOLD]: y\n<!-- reviewer-presupuesto: 30 turnos -->\n\nResumen.');
caso('(b) LGTM + [LAUNCH-HOLD] ⇒ launchHold=y', r.veredicto === 'LGTM' && r.launchHold === 'y' && r.needsHuman === null, JSON.stringify(r));
r = clasificarCabecera('LGTM\n<!-- reviewer-presupuesto: 30 turnos -->\n\nTodo bien.');
caso('(c) LGTM solo ⇒ ambos null', r.veredicto === 'LGTM' && r.launchHold === null && r.needsHuman === null && !r.avisos.length, JSON.stringify(r));
r = clasificarCabecera(`REVIEW\n@claude corrige el test ${PING}\n\nla línea \`[NEEDS-HUMAN]\` de CLAUDE.md no aplica.\n[NEEDS-HUMAN]: fuera de cabecera\n[LAUNCH-HOLD]: fuera de cabecera`);
caso('(d) tag entre backticks y fuera de cabecera ⇒ needsHuman=null', r.needsHuman === null && r.launchHold === null && r.ping === true && !r.avisos.length, JSON.stringify(r));
r = clasificarCabecera('REVIEW\n[LAUNCH-HOLD]: z\n\nResumen.');
caso('(e) [LAUNCH-HOLD] en un REVIEW ⇒ launchHold=null + aviso', r.launchHold === null && r.avisos.length === 1, JSON.stringify(r));
r = clasificarCabecera(`REVIEW\n@claude reserva ${PING}\n[NEEDS-HUMAN]: x\n\nResumen.`);
caso('(f) NEEDS-HUMAN con ping (forma vieja) ⇒ needsHuman=x, ping=true (fail-closed)', r.needsHuman === 'x' && r.ping === true, JSON.stringify(r));
r = clasificarCabecera('NITS\n@claude aplica los nits <!-- ping-creator -->\n\n[NEEDS-HUMAN]: en el cuerpo');
caso('(f′) NITS con NEEDS-HUMAN en el cuerpo ⇒ no cuenta', r.veredicto === 'NITS' && r.needsHuman === null, JSON.stringify(r));
r = clasificarCabecera('  LGTM\r\n  [LAUNCH-HOLD]: decisión D1 antes del 3/3\r\n\r\nResumen.');
caso('(b′) sangría y CRLF ⇒ sigue casando', r.launchHold === 'decisión D1 antes del 3/3', JSON.stringify(r));

// ── Costura y escrituras de `run` contra un doble ───────────────────────────
caso('run es función', typeof RH.run === 'function');
const firma = (RH.run.toString().match(/^async function run\(\{([^}]*)\}/) || [])[1] || '';
const params = firma.split(',').map((s) => s.trim()).filter(Boolean).sort();
caso('costura: run acepta exactamente {github, core, prNumber, lastVc, prLabels, pat}',
  JSON.stringify(params) === JSON.stringify(['core', 'github', 'lastVc', 'pat', 'prLabels', 'prNumber']), JSON.stringify(params));

async function correrRun({ body, previos = [], prLabels = [], pat = 'PAT' }) {
  const escrituras = [];
  const cuerpos = [];
  const avisos = [];
  const lastVc = { body, created_at: '2026-11-01T10:00:00Z', html_url: 'https://github.com/o/r/pull/9#issuecomment-1' };
  const github = {
    paginate: async () => [lastVc, ...previos],
    rest: { issues: {
      listComments: () => {},
      addLabels: async ({ labels }) => { escrituras.push(`gh-addLabels:${labels.join('+')}`); },
      createComment: async ({ body: b }) => { escrituras.push('createComment'); cuerpos.push(b); },
    } },
  };
  const core = { warning: (m) => avisos.push(String(m)), notice: (m) => avisos.push(String(m)), info: () => {} };
  const fetchPrev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    escrituras.push(`pat-label:${JSON.parse(opts.body).labels.join('+')}`);
    if (!String(opts.headers.Authorization).includes('PAT')) escrituras.push('pat-sin-token');
    return { ok: true, status: 200 };
  };
  const envPrev = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = 'o/r';
  let out;
  try { out = await RH.run({ github, core, prNumber: 9, lastVc, prLabels, pat }); }
  finally { globalThis.fetch = fetchPrev; if (envPrev === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = envPrev; }
  return { escrituras, cuerpos, avisos, out };
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let g = await correrRun({ body: 'REVIEW\n[NEEDS-HUMAN]: decide D2\n\nx' });
caso('run: NEEDS-HUMAN ⇒ human-needed por PAT + comentario', eq(g.escrituras, ['pat-label:human-needed', 'createComment'])
  && g.cuerpos[0].includes('<!-- needs-human-materializado -->') && g.cuerpos[0].includes('«decide D2»'), JSON.stringify(g.escrituras));
g = await correrRun({ body: `REVIEW\n@claude x ${PING}\n[NEEDS-HUMAN]: decide D2\n\nx` });
caso('run: NEEDS-HUMAN con ping ⇒ aplica igual + aviso de contradicción', eq(g.escrituras, ['pat-label:human-needed', 'createComment'])
  && g.avisos.some((a) => a.includes('cabecera contradictoria')), JSON.stringify(g));
g = await correrRun({ body: 'LGTM\n[LAUNCH-HOLD]: D1 antes del 3/3\n\nx' });
caso('run: LAUNCH-HOLD ⇒ launch-hold por PAT + comentario declarado', eq(g.escrituras, ['pat-label:launch-hold', 'createComment'])
  && g.cuerpos[0].includes('<!-- launch-hold-declarado -->'), JSON.stringify(g.escrituras));
g = await correrRun({ body: 'LGTM\n\nx' });
caso('run: LGTM solo ⇒ cero escrituras', eq(g.escrituras, []), JSON.stringify(g.escrituras));
g = await correrRun({ body: 'LGTM\n[LAUNCH-HOLD]: D1\n\nx',
  previos: [{ body: 'ya\n<!-- launch-hold-declarado -->', created_at: '2026-11-01T10:01:00Z' }] });
caso('run: dedupe por marcador posterior ⇒ cero escrituras', eq(g.escrituras, []), JSON.stringify(g.escrituras));
g = await correrRun({ body: 'LGTM\n[LAUNCH-HOLD]: D1\n\nx',
  previos: [{ body: 'viejo\n<!-- launch-hold-declarado -->', created_at: '2026-11-01T09:00:00Z' }] });
caso('run: marcador ANTERIOR al veredicto no deduplica', eq(g.escrituras, ['pat-label:launch-hold', 'createComment']), JSON.stringify(g.escrituras));
g = await correrRun({ body: 'LGTM\n[LAUNCH-HOLD]: D1\n\nx', prLabels: ['launch-hold'] });
caso('run: label ya presente ⇒ solo comentario', eq(g.escrituras, ['createComment']), JSON.stringify(g.escrituras));
g = await correrRun({ body: 'LGTM\n[LAUNCH-HOLD]: D1\n\nx', pat: '' });
caso('run: sin PAT ⇒ token del step + aviso', eq(g.escrituras, ['gh-addLabels:launch-hold', 'createComment'])
  && g.avisos.some((a) => a.includes('sin PAT')), JSON.stringify(g));

// ── (g)–(i) launch-hold ─────────────────────────────────────────────────────
caso('(g) decidir con label', LH.decidir({ prLabels: ['epica', 'lgtm', 'launch-hold'] }) === true);
caso('(g′) decidir sin label', LH.decidir({ prLabels: ['epica', 'lgtm'] }) === false && LH.decidir({}) === false);
caso('(h) textoHold desde marcador',
  LH.textoHold([{ body: 'LGTM\n[LAUNCH-HOLD]: otro\n\nx' }, { body: '**reviewer · launch-hold**: el LGTM condiciona el eslabón SIGUIENTE: «D1/E1.2 antes del 3/3». epic-merge…\n\n<!-- launch-hold-declarado -->' }]) === 'D1/E1.2 antes del 3/3');
caso('(h′) textoHold desde cabecera del último LGTM',
  LH.textoHold([{ body: 'LGTM\n[LAUNCH-HOLD]: viejo\n\nx' }, { body: 'REVIEW\n\nx' }, { body: 'LGTM\n[LAUNCH-HOLD]: nuevo\n\nx' }]) === 'nuevo');
caso('(h″) textoHold sin nada ⇒ texto de fallback, no lanza', typeof LH.textoHold([]) === 'string');
{
  const llamadas = [];
  const github = { rest: { issues: {
    addLabels: async (a) => { llamadas.push(['addLabels', a.issue_number, a.labels.join('+')]); },
    createComment: async (a) => { llamadas.push(['createComment', a.issue_number, a.body]); },
  } } };
  await LH.retener({ github, owner: 'o', repo: 'r', siguiente: 3039, prNumber: 3044, texto: 'D1' });
  caso('(i) retener: dos addLabels en orden + un createComment con marcador, todo en #siguiente',
    llamadas.length === 3
    && eq(llamadas[0], ['addLabels', 3039, 'estado:esperando-architect'])
    && eq(llamadas[1], ['addLabels', 3039, 'stalled'])
    && llamadas[2][0] === 'createComment' && llamadas[2][1] === 3039
    && llamadas[2][2].includes('<!-- launch-hold -->') && llamadas[2][2].includes('PR #3044') && llamadas[2][2].includes('«D1»'),
    JSON.stringify(llamadas));
}

// ── (j) costura de `postMerge` en epic-merge.yml ────────────────────────────
const EM = '.github/workflows/epic-merge.yml';
if (existsSync(EM)) {
  const txt = readFileSync(EM, 'utf8');
  const ini = txt.indexOf('async function postMerge(');
  const fin = ini === -1 ? -1 : txt.indexOf('async function ', ini + 10);
  const cuerpo = ini === -1 ? '' : txt.slice(ini, fin === -1 ? undefined : fin);
  const decl = cuerpo.indexOf('const prLabelsLH = (pr.labels || []).map(l => l.name)');
  const uso = cuerpo.indexOf('LH.decidir({ prLabels: prLabelsLH })');
  caso('(j) postMerge declara prLabelsLH desde `pr` ANTES de LH.decidir', ini !== -1 && decl !== -1 && uso !== -1 && decl < uso,
    `postMerge=${ini !== -1} decl=${decl} uso=${uso}`);
  caso('(j′) epic-merge carga launch-hold.cjs del checkout sparse', /require\(`\$\{process\.env\.GITHUB_WORKSPACE\}\/\.epic-merge-central\/vendored\/scripts\/launch-hold\.cjs`\)/.test(txt));
  caso('(j″) el hold va ANTES del des-bloqueo del destino', uso !== -1 && cuerpo.indexOf("for (const stale of ['stalled', 'human-needed'])") > uso);
} else {
  console.log(`::warning::check-reviewer-header — ${EM} no existe aquí (consumidor): la costura (j) NO se ha ejecutado.`);
}

// ── (k) costura de la invocación en reviewer.yml ────────────────────────────
const RY = '.github/workflows/reviewer.yml';
if (existsSync(RY)) {
  const txt = readFileSync(RY, 'utf8');
  const m = txt.match(/RH\.run\(\{([^}]*)\}\)/);
  const pas = m ? m[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean).sort() : [];
  caso('(k) reviewer.yml invoca RH.run con los seis parámetros', eq(pas, ['core', 'github', 'lastVc', 'pat', 'prLabels', 'prNumber']), JSON.stringify(pas));
  caso('(k′) reviewer.yml carga reviewer-header-terminals.cjs', txt.includes('reviewer-header-terminals.cjs'));
}

if (fallos.length) {
  console.error(`CHECK-REVIEWER-HEADER ROJO (${fuente}):`);
  fallos.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`check-reviewer-header verde: ${n} casos sobre las funciones REALES de ${fuente} y launch-hold.cjs (clasificación a–f, run, launch-hold g–i, costuras j–k).`);
