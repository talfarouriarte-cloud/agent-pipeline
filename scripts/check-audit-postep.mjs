#!/usr/bin/env node
// check-audit-postep — banco del post-step «Materializar auditoria-completa
// (post-step determinista)» de claude-code.yml, rama `informe-no-publicado`
// (AP-127, central#356: un único re-arm automático por panel).
//
// Ejecuta el script EMBEBIDO real (no una copia) contra mocks de `github`,
// `context` y `core`, y comprueba el desenlace de cada caso: re-arm con
// marcador `audit-rearm-auto`, `stalled` + `informe-no-publicado`, o camino
// «publicado» (veredicto derivado + `auditoria-completa`). Los casos de cadena
// re-alimentan el comentario que el propio step publicó en la sesión siguiente:
// fijan que ningún texto del post-step satisface `HAS_REPORT` (crítica ronda 3
// de #356). Cuelga del piggyback de `check-embedded-js.mjs` por la misma razón
// que sus hermanos: su paso propio de `ci.yml` sería un cambio de workflow.
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const NOMBRE = 'Materializar auditoria-completa (post-step determinista)';
const wf = yaml.load(readFileSync('.github/workflows/claude-code.yml', 'utf8'));
let step = null;
for (const job of Object.values(wf.jobs || {})) {
  for (const st of job.steps || []) if (st.name === NOMBRE) step = st;
}
if (!step) { console.error(`CHECK-AUDIT-POSTEP ROJO: step «${NOMBRE}» no encontrado en claude-code.yml`); process.exit(1); }
if (!/steps\.llm_exec\.outputs\.kind/.test(String((step.env || {}).LLM_EXEC_KIND || ''))) {
  console.error('CHECK-AUDIT-POSTEP ROJO: el step no recibe `LLM_EXEC_KIND` desde `steps.llm_exec.outputs.kind` (AP-091)'); process.exit(1);
}
const run = cargarStep(step.with.script, NOMBRE);

const TALLA_PRE = { body: '#10 · M <!-- talla-pre: M --> · 1·1·1·1·1 = 5 — x' };
const PARCIAL_METRICAS = { body: '<!-- audit-parcial: metricas -->\n### Parcial · métricas de proceso\n(a) PRs por issue: 1\n' };
const PARCIAL_BACKTICKS = { body: '<!-- audit-parcial: metricas -->\n### Parcial\nirá en el bloque `## Métricas de proceso` del informe final\n' };
const INFORME = { body: '## Métricas de proceso\n(a) 1\n\n## Análisis de repescas (5 whys)\nSin repescas.' };
// Texto literal del comentario `informe-no-publicado` previo a AP-127 (citaba la cadena de HAS_REPORT).
const INFORME_NO_PUBLICADO_ANTIGUO = { body: '**claude-code · post-step de auditoría**: la sesión del Auditor terminó SIN informe publicado (ningún comentario contiene el bloque `## Métricas de proceso`). NO se aplica `auditoria-completa` — el process-review no debe correr contra un panel vacío (clase informe-no-publicado, finplan#1296/#1295). Escalado vía `stalled`.\n\n<!-- informe-no-publicado -->' };
const REARM = { body: '@claude retoma\n\n<!-- audit-rearm-auto -->' };

async function caso({ comments, kind = 'alive' }) {
  const calls = { labels: [], comments: [] };
  const github = {
    paginate: async (fn, args) => (await fn(args)).data,
    rest: { issues: {
      listComments: async () => ({ data: comments }),
      listEventsForTimeline: async () => ({ data: [] }),
      get: async () => ({ data: { labels: [] } }),
      addLabels: async a => { calls.labels.push(...a.labels); },
      createComment: async a => { calls.comments.push(a.body); },
    } },
  };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { issue: { number: 7 } } };
  const core = { setOutput() {}, setFailed: m => { calls.failed = m; }, notice() {}, warning() {}, info() {} };
  await run({ github, context, core }, { env: { LLM_EXEC_KIND: kind } });
  const rearm = calls.comments.find(c => /<!--\s*audit-rearm-auto\s*-->/.test(c));
  return {
    rearm: !!rearm && /^@claude\b/.test(rearm),
    stalled: calls.labels.includes('stalled'),
    noPublicado: calls.comments.some(c => /<!--\s*informe-no-publicado\s*-->/.test(c)),
    published: calls.labels.includes('auditoria-completa'),
    comments: calls.comments,
  };
}

const soloRearm = r => r.rearm && !r.stalled && !r.noPublicado && !r.published;
const soloStall = r => !r.rearm && r.stalled && r.noPublicado && !r.published;
const HAS_REPORT = /##\s*Métricas de proceso/;   // copia del detector, solo para el aserto de cadena

const BANCO = [
  ['(a) [talla-pre] y sesión viva ⇒ re-arm con marcador, sin stalled',
    { comments: [TALLA_PRE] }, soloRearm],
  ['(a-bis) panel sin ningún comentario y sesión viva ⇒ re-arm',
    { comments: [] }, soloRearm],
  ['(b) [parcial de métricas con ### y sin la cadena] ⇒ published=false ⇒ re-arm',
    { comments: [TALLA_PRE, PARCIAL_METRICAS] }, soloRearm],
  ['(b-bis) parcial que cita `## Métricas de proceso` entre backticks ⇒ el marcador audit-parcial lo excluye ⇒ re-arm',
    { comments: [TALLA_PRE, PARCIAL_BACKTICKS] }, soloRearm],
  ['(f-bis) comentario `informe-no-publicado` anterior a AP-127 (cita la cadena literal) ⇒ published=false ⇒ re-arm',
    { comments: [TALLA_PRE, INFORME_NO_PUBLICADO_ANTIGUO] }, soloRearm],
  ['(c) [parcial, audit-rearm-auto] ⇒ stalled, sin segundo re-arm',
    { comments: [PARCIAL_METRICAS, REARM] }, soloStall],
  ['(d) kind=instant ⇒ stalled sin re-arm',
    { comments: [TALLA_PRE], kind: 'instant' }, soloStall],
  ['(d-bis) kind=ilegible ⇒ re-arm (solo la firma instantánea completa lo impide)',
    { comments: [TALLA_PRE], kind: 'ilegible' }, soloRearm],
  ['(e) informe con `## Métricas de proceso` como encabezado ⇒ published=true, camino actual',
    { comments: [TALLA_PRE, INFORME] }, r => r.published && !r.rearm && !r.stalled
      && r.comments.some(c => /<!--\s*audit-verdict:\s*clean\s*-->/.test(c))],
];

const rojos = [];
for (const [nombre, input, ok] of BANCO) {
  let r;
  try { r = await caso(input); } catch (e) { rojos.push(`${nombre}: excepción ${e.message}`); continue; }
  if (!ok(r)) rojos.push(`${nombre}: obtenido ${JSON.stringify(r)}`);
}

// Cadena (crítica ronda 3 de #356): el comentario que el propio post-step deja
// NO cuenta como informe en la sesión siguiente.
try {
  // (f) instant ⇒ stalled; re-arm humano; la 2.ª sesión vive y muere sin informe ⇒ su re-arm automático.
  const d = await caso({ comments: [TALLA_PRE], kind: 'instant' });
  const tras = await caso({ comments: [TALLA_PRE, ...d.comments.map(body => ({ body }))] });
  if (!soloRearm(tras)) rojos.push(`(f) panel con [informe-no-publicado] y sin informe ⇒ debía re-armar (published=false): obtenido ${JSON.stringify(tras)}`);
  // (g) re-arm automático ⇒ la retoma muere sin informe ⇒ stalled, nunca auditoria-completa.
  const a = await caso({ comments: [TALLA_PRE] });
  const seg = await caso({ comments: [TALLA_PRE, ...a.comments.map(body => ({ body }))] });
  if (!soloStall(seg)) rojos.push(`(g) [talla-pre, re-arm del step] sin informe ⇒ debía stallear: obtenido ${JSON.stringify(seg)}`);
  // (h) tras el stall del 2.º fallo, un re-arm humano que muere sin informe sigue sin auditoria-completa.
  const ter = await caso({ comments: [TALLA_PRE, ...a.comments.map(body => ({ body })), ...seg.comments.map(body => ({ body }))] });
  if (ter.published || !ter.stalled) rojos.push(`(h) panel con [re-arm, informe-no-publicado] sin informe ⇒ debía stallear sin auditoria-completa: obtenido ${JSON.stringify(ter)}`);
  const emitidos = [...d.comments, ...a.comments, ...seg.comments];
  const fuga = emitidos.filter(c => HAS_REPORT.test(c));
  if (fuga.length) rojos.push(`(i) un comentario del post-step contiene la cadena de HAS_REPORT: ${JSON.stringify(fuga)}`);
} catch (e) { rojos.push(`cadena: excepción ${e.message}`); }

if (rojos.length) { console.error('CHECK-AUDIT-POSTEP ROJO:'); rojos.forEach(e => console.error('  - ' + e)); process.exit(1); }
console.log(`check-audit-postep verde: ${BANCO.length} casos + 4 de cadena del post-step de auditoría (AP-127).`);
