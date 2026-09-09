#!/usr/bin/env node
// check-stalled-rederive — banco EJECUTABLE de la firma `stalled` re-derivado
// por estado del detect de `watchdog.yml` (AP-086). Ejecuta la función REAL de
// `vendored/scripts/watchdog-stalled-rederive.cjs`, no una copia: la decisión
// de re-derivar/escalar y la costura módulo↔stub del runtime son la parte que
// puede derivar en silencio (módulo pusheable, stub en parche pendiente que
// `check-embedded-js` no parsea mientras lo esté). Un banco que vive en el body
// de un PR es disciplina sin consumidor: en cuanto alguien toca la firma, la
// evidencia ya no está y el cambio se juzga leyendo — la clase exacta que la
// casa persigue (misma doctrina que `check-resolve-detection`).
//
// Verde: exit 0. Rojo: la derivación real o el runtime cambiaron y el banco lo
// nota.
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

// El central lo tiene en `vendored/`; el workspace del consumidor lo recibe en
// `scripts/` por el graft (AP-009). Se prueba el del central primero: es el
// FUENTE, y es el que un PR modifica.
const FUENTES = [
  'vendored/scripts/watchdog-stalled-rederive.cjs',
  'scripts/watchdog-stalled-rederive.cjs',
];

let fuente = null;
let belt = null;
for (const f of FUENTES) {
  if (!existsSync(f)) continue;
  belt = require(resolve(f));   // un SyntaxError aquí es ROJO, y debe serlo
  fuente = f;
  break;
}
if (!belt) {
  // Fail-open ANUNCIADO, nunca mudo: si el módulo no está, no hay nada que
  // juzgar — pero que no lo haya tiene que verse.
  console.log('::warning::check-stalled-rederive — no encuentro `watchdog-stalled-rederive.cjs` en ninguna de sus dos ubicaciones: el banco NO se ha ejecutado.');
  process.exit(0);
}

const { decidir, REDERIVE_MARK, PERSIST_MARK, REDERIVE_MIN, ESCALATE_MIN } = belt;
for (const [nombre, val] of [['decidir', typeof decidir === 'function'], ['REDERIVE_MARK', !!REDERIVE_MARK], ['PERSIST_MARK', !!PERSIST_MARK], ['REDERIVE_MIN', Number.isFinite(REDERIVE_MIN)], ['ESCALATE_MIN', Number.isFinite(ESCALATE_MIN)]]) {
  if (!val) { console.error(`CHECK-STALLED-REDERIVE ROJO: \`${fuente}\` ya no exporta \`${nombre}\` — el banco quedaría mudo sin decirlo.`); process.exit(1); }
}

const fallos = [];
const lineas = [];
const agoMin = (m) => new Date(Date.now() - m * 60000).toISOString();
const CAPA = '<!-- watchdog-capa: schedule -->';
const cmt = (body, ageMin) => ({ body, createdAt: agoMin(ageMin) });

// ── Banco de la derivación pura `decidir` ────────────────────────────────────
// [nombre, item, accion esperada]
const OLD = REDERIVE_MIN + 10;     // `labeled` claramente viejo
const FRESH = REDERIVE_MIN - 5;    // `labeled` fresco
const CASOS = [
  ['sin `labeled` legible ⇒ fail-closed', { labeledAt: null, comments: [] }, 'skip'],
  ['`labeled` fresco ⇒ se deja correr el evento', { labeledAt: agoMin(FRESH), comments: [] }, 'skip'],
  ['viejo, sin ruling, sin nudge previo ⇒ nudge', { labeledAt: agoMin(OLD), comments: [] }, 'nudge'],
  ['ruling por marcador de CAPA posterior ⇒ skip',
    { labeledAt: agoMin(OLD), comments: [cmt(`ruling del resolver\n${CAPA}`, OLD - 5)] }, 'skip'],
  ['ruling por `@claude` (re-arm) posterior ⇒ skip',
    { labeledAt: agoMin(OLD), comments: [cmt('@claude arranca — retoma', OLD - 5)] }, 'skip'],
  ['ruling por `<!-- watchdog-rearm -->` posterior ⇒ skip',
    { labeledAt: agoMin(OLD), comments: [cmt('re-arm\n<!-- watchdog-rearm -->', OLD - 5)] }, 'skip'],
  // El comentario de la capa ANTERIOR al `labeled` no cuenta: el ruling debe ser
  // posterior al evento cuyo run murió.
  ['marcador de capa ANTERIOR al `labeled` ⇒ nudge',
    { labeledAt: agoMin(OLD), comments: [cmt(`viejo\n${CAPA}`, OLD + 20)] }, 'nudge'],
  // Nuestro propio nudge NO es ruling (si lo fuera, la firma se auto-apagaría).
  ['nudge propio reciente (sin ruling ajeno) ⇒ esperar',
    { labeledAt: agoMin(ESCALATE_MIN + 20), comments: [cmt(`nudge\n${REDERIVE_MARK}\n${CAPA}`, ESCALATE_MIN - 10)] }, 'skip'],
  ['nudge propio viejo (> ESCALATE_MIN) sin ruling ⇒ escalate',
    { labeledAt: agoMin(ESCALATE_MIN + OLD), comments: [cmt(`nudge\n${REDERIVE_MARK}\n${CAPA}`, ESCALATE_MIN + 5)] }, 'escalate'],
  ['ya escalado (marcador de persistencia) ⇒ terminal',
    { labeledAt: agoMin(OLD), comments: [cmt(`escalado\n${PERSIST_MARK}\n${CAPA}`, OLD - 5)] }, 'skip'],
  // EFECTUAR ≠ CITAR: un marcador de capa CITADO en bloque cercado no es ruling.
  ['marcador de capa CITADO en code-fence ⇒ nudge',
    { labeledAt: agoMin(OLD), comments: [cmt(`así se cierra:\n\`\`\`\n${CAPA}\n\`\`\``, OLD - 5)] }, 'nudge'],
];
for (const [nombre, item, esperada] of CASOS) {
  const { accion } = decidir(item);
  const ok = accion === esperada;
  if (!ok) fallos.push(`decidir — ${nombre}: esperado \`${esperada}\`, obtenido \`${accion}\``);
  lineas.push(`  ${ok ? '·' : '✗'} decidir: ${nombre.padEnd(52)} → ${accion}`);
}

// ── Contrato de RUNTIME: la costura módulo↔stub y las escrituras ─────────────
// Ejecuta `run` contra un doble mínimo de la API. Registra CADA escritura con
// su issue destino para asertar el orden (relabel = remove seguido de add) y el
// cuerpo publicado.
async function correrBelt({
  labelsIssue = ['stalled'],
  labeledAgeMin = OLD,          // edad del `labeled: stalled`
  labeledPresent = true,        // si false, timeline sin evento de stalled
  comentarios = [],             // [{ body, ageMin }]
  timelineErr,                  // error de listEventsForTimeline
  listErr,                      // error de listForRepo
  removeErr,                    // error de removeLabel
} = {}) {
  const escrituras = [];
  const cuerpos = [];
  const avisos = [];
  const timeline = labeledPresent
    ? [{ event: 'labeled', label: { name: 'stalled' }, created_at: agoMin(labeledAgeMin) }]
    : [{ event: 'labeled', label: { name: 'otra' }, created_at: agoMin(labeledAgeMin) }];
  const issueComments = comentarios.map((c) => ({ body: c.body, created_at: agoMin(c.ageMin) }));

  const paginate = async (fn, params) => {
    if (fn === 'listForRepo') { if (listErr) throw listErr; return [{ number: 1810, labels: labelsIssue.map((name) => ({ name })) }]; }
    if (fn === 'listEventsForTimeline') { if (timelineErr) throw timelineErr; return timeline; }
    if (fn === 'listComments') return issueComments;
    return [];
  };
  const github = {
    paginate,
    rest: {
      issues: {
        listForRepo: 'listForRepo',
        listEventsForTimeline: 'listEventsForTimeline',
        listComments: 'listComments',
        removeLabel: async ({ issue_number, name }) => { escrituras.push(`removeLabel:${name}#${issue_number}`); if (removeErr) throw removeErr; },
        addLabels: async ({ issue_number, labels }) => { escrituras.push(`addLabels:${labels.join('+')}#${issue_number}`); },
        createComment: async ({ issue_number, body }) => { escrituras.push(`createComment#${issue_number}`); cuerpos.push(body); },
      },
    },
  };
  const core = { info() {}, notice() {}, warning(m) { avisos.push(m); } };
  const context = { repo: { owner: 'o', repo: 'r' }, eventName: 'schedule', runId: 1 };
  await belt({ github, context, core });
  return { escrituras, cuerpos, avisos };
}

const err = (status) => Object.assign(new Error(`API ${status}`), { status });

// [nombre, opts, escrituras esperadas, aserción opcional sobre cuerpo/avisos]
const CONTRATO = [
  ['control: viejo sin ruling ⇒ relabel (remove→add) + comentario del marcador',
    { labeledAgeMin: OLD },
    ['removeLabel:stalled#1810', 'addLabels:stalled#1810', 'createComment#1810'],
    { contiene: [REDERIVE_MARK, 'stalled-rederive'] }],
  ['kill-switch duro `human-needed` ⇒ sin actuar',
    { labelsIssue: ['stalled', 'human-needed'] },
    []],
  ['kill-switch duro `pause-agents` ⇒ sin actuar',
    { labelsIssue: ['stalled', 'pause-agents'] },
    []],
  // `auditoria`/`process-proposal` NO son kill-switch de esta firma: un `stalled`
  // sobre una auditoría es trabajo legítimo de architect-resolve (el caso medido,
  // finplan#1810). Debe re-derivar igual que un stalled pelado.
  ['`auditoria` NO excluye (es el caso medido) ⇒ relabel',
    { labelsIssue: ['stalled', 'auditoria'] },
    ['removeLabel:stalled#1810', 'addLabels:stalled#1810', 'createComment#1810']],
  ['`labeled` fresco ⇒ sin actuar (se deja correr el evento)',
    { labeledAgeMin: FRESH },
    []],
  ['ruling posterior (capa) ⇒ sin actuar',
    { labeledAgeMin: OLD, comentarios: [{ body: `ruling\n${CAPA}`, ageMin: OLD - 5 }] },
    []],
  ['nudge propio viejo sin ruling ⇒ escalado a `human-needed` con marcador de persistencia',
    { labeledAgeMin: ESCALATE_MIN + OLD, comentarios: [{ body: `nudge\n${REDERIVE_MARK}\n${CAPA}`, ageMin: ESCALATE_MIN + 5 }] },
    ['addLabels:human-needed#1810', 'createComment#1810'],
    { contiene: [PERSIST_MARK] }],
  // 404 benigno al retirar `stalled` (carrera): se sigue re-añadiendo y
  // comentando — el estado deseado (re-fire del `labeled`) se alcanza igual.
  ['removeLabel 404 (carrera benigna) ⇒ add + comentario igualmente',
    { labeledAgeMin: OLD, removeErr: err(404) },
    ['removeLabel:stalled#1810', 'addLabels:stalled#1810', 'createComment#1810']],
  // Timeline ilegible ⇒ fail-closed: no se re-deriva a ciegas, y se anuncia.
  ['timeline ilegible ⇒ fail-closed, sin actuar y anunciado',
    { timelineErr: err(500) },
    [],
    { avisa: ['timeline'] }],
  // listForRepo ilegible ⇒ sin actuar y anunciado.
  ['listForRepo ilegible ⇒ sin actuar y anunciado',
    { listErr: err(500) },
    [],
    { avisa: ['no se pudo listar'] }],
];

for (const [nombre, opts, esperado, extra] of CONTRATO) {
  let got;
  try { got = await correrBelt(opts); }
  catch (e) { fallos.push(`contrato — ${nombre}: \`run\` lanzó (${e.message})`); continue; }
  let ok = JSON.stringify(got.escrituras) === JSON.stringify(esperado);
  if (!ok) fallos.push(`contrato — ${nombre}: esperado escrituras=${JSON.stringify(esperado)} — obtenido ${JSON.stringify(got.escrituras)}`);
  for (const s of extra?.contiene || []) {
    if (!got.cuerpos.some((c) => c.includes(s))) { ok = false; fallos.push(`contrato — ${nombre}: ningún cuerpo publicado contiene ${JSON.stringify(s)}`); }
  }
  for (const s of extra?.avisa || []) {
    if (!got.avisos.some((a) => a.includes(s))) { ok = false; fallos.push(`contrato — ${nombre}: ningún aviso contiene ${JSON.stringify(s)} — obtenido ${JSON.stringify(got.avisos)}`); }
  }
  lineas.push(`  ${ok ? '·' : '✗'} contrato: ${nombre.padEnd(58)} escrituras=${JSON.stringify(got.escrituras)}`);
}

if (process.env.STALLED_REDERIVE_VERBOSE) lineas.forEach((l) => console.log(l));
if (fallos.length) {
  console.error(`CHECK-STALLED-REDERIVE ROJO (derivación/runtime real de ${fuente}):`);
  fallos.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`check-stalled-rederive verde: ${CASOS.length} casos de la derivación pura \`decidir\` + ${CONTRATO.length} aserciones de runtime ejecutando \`run\` contra un doble de la API (relabel remove→add por PAT, kill-switch duro, auditoría NO excluida, gate de edad, ruling posterior, escalado por persistencia, 404 benigno y fail-closed de timeline) sobre la firma REAL de ${fuente} (no una copia).`);
