#!/usr/bin/env node
// check-turn-close-detection — banco de casos EJECUTABLE de la cola del
// `turn-close-failsafe` (`vendored/scripts/creator-turn-close-failsafe.cjs`,
// AP-046 + AP-071): la clasificación que decide si un cierre del Creator SIN
// tag y SIN push fue un Δestado por COMENTARIO (⇒ Reviewer) o un terminal
// NO-declarado (⇒ architect-resolve).
//
// Por qué existe. El cuerpo del belt es pusheable (vive en `vendored/`,
// AP-068) pero su SITIO DE INVOCACIÓN no lo es (`.github/workflows/**`, ADR-020
// — viaja como `docs/patches/AP-071-*.patch`). Sin banco, la única evidencia de
// que la rama nueva no se come el fail-closed de AP-046 sería leer el diff, que
// es exactamente lo que ya falló dos veces en la familia AP-064 (`á` no es `\w`
// en JS: cazado EJECUTANDO, no releyendo).
//
// El riesgo específico que este banco congela: la pregunta ingenua «¿publicó la
// sesión un comentario fresco?» es SIEMPRE `true` —la action crea su tracking
// comment antes de invocar al agente—, luego una implementación que la usara
// dejaría la rama else de AP-046 INALCANZABLE, con CI y lectura en verde. Los
// casos `solo-tracking` de abajo son ese gate.
//
// Verde: exit 0. Rojo: la clasificación real cambió y el banco lo nota.
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

// El central lo tiene en `vendored/`; el workspace del consumidor lo recibe en
// `scripts/` por el graft (AP-009). Se prueba el del central primero: es el
// fichero FUENTE, y es el que un PR modifica.
const FUENTES = [
  'vendored/scripts/creator-turn-close-failsafe.cjs',
  'scripts/creator-turn-close-failsafe.cjs',
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
  console.log('::warning::check-turn-close-detection — no encuentro `creator-turn-close-failsafe.cjs` en ninguna de sus dos ubicaciones: el banco NO se ha ejecutado.');
  process.exit(0);
}

const { clasificar } = belt;
if (typeof clasificar !== 'function') {
  console.error('CHECK-TURN-CLOSE-DETECTION ROJO: `creator-turn-close-failsafe.cjs` ya no exporta `clasificar` — el banco quedaría mudo sin decirlo.');
  process.exit(1);
}
if (typeof belt !== 'function') {
  console.error('CHECK-TURN-CLOSE-DETECTION ROJO: el export por defecto de `creator-turn-close-failsafe.cjs` ya no es la función `run` que el stub del workflow invoca — la costura módulo↔stub estaría rota y el parche AP-071 fallaría en runtime.');
  process.exit(1);
}

// `PATRONES` COMPLETO — misma aserción que `check-resolve-detection` (🔵 3 de la
// review de AP-070): un export que promete «el vocabulario de decisión» y se
// queda corto no se cae, se PUDRE, y el banco siguiente juzgará menos de lo que
// cree, en silencio. Es la única aserción que mira el TEXTO del módulo y no su
// comportamiento — a propósito: lo que se juzga es que declaración y código no
// divergen.
const fuenteTxt = readFileSync(fuente, 'utf8');
const DECL = [...fuenteTxt.matchAll(/^const ([A-Z][A-Z_0-9]*) = /gm)].map((m) => m[1]);
const PATRONES = belt.PATRONES || {};
const faltan = DECL.filter((n) => !(n in PATRONES));
const sobran = Object.keys(PATRONES).filter((n) => !DECL.includes(n));
if (!DECL.length) {
  console.error(`CHECK-TURN-CLOSE-DETECTION ROJO: no encuentro ningún \`const X = …\` de nivel superior en ${fuente} — la aserción de \`PATRONES\` sería vacua (pasaría con el módulo entero reescrito).`);
  process.exit(1);
}
if (faltan.length || sobran.length) {
  console.error(`CHECK-TURN-CLOSE-DETECTION ROJO: \`PATRONES\` no es el vocabulario de decisión completo de ${fuente}${faltan.length ? ` — falta(n) ${faltan.join(', ')}` : ''}${sobran.length ? ` — sobra(n) ${sobran.join(', ')}` : ''}.`);
  process.exit(1);
}

const fallos = [];
const lineas = [];

// ── Parte 1: clasificación PURA ──────────────────────────────────────────────
// `c(n, body)` — comentario fresco de la sesión; `n` ordena por `created_at`.
// El [0] de la ventana fresca es SIEMPRE el tracking comment de la action.
const c = (n, body, extra = {}) => ({
  created_at: `2026-07-24T10:0${n}:00Z`,
  html_url: `https://github.com/o/r/pull/1724#issuecomment-${n}`,
  body,
  ...extra,
});
const TRACKING = c(0, 'Claude Code is working…\n\n[View job run](https://github.com/o/r/actions/runs/1)');

const CASOS = [
  // El caso de origen, verbatim en su forma: el veredicto NITS pedía UNA cosa
  // sin diff (re-publicar el sentinel por `gh api`) y la sesión lo hizo.
  ['INSTANCIA fp#1724 — sentinel re-publicado por gh api',
    [TRACKING, c(1, '<!-- adr-divergence: ADR-232 §4 aceptada por el Reviewer en la ronda 1 -->')],
    { via: 'comment-only', extras: 1 }],
  ['tracking + bloque pr-body-declarado',
    [TRACKING, c(1, '<!-- pr-body-declarado:start -->\nRefs #1724\n<!-- partial-pr -->\n<!-- pr-body-declarado:end -->')],
    { via: 'comment-only', extras: 1 }],
  ['tracking + DOS comentarios propios',
    [TRACKING, c(1, 'Informe pedido por el veredicto.'), c(2, '<!-- adr-divergence -->')],
    { via: 'comment-only', extras: 2 }],
  // ── El gate que impide que el fix se coma su propio fail-closed ──
  // La action SIEMPRE crea su tracking comment antes de invocar al agente: una
  // detección por EXISTENCIA de comentario fresco daría `comment-only` aquí y
  // la rama else de AP-046 quedaría inalcanzable, en verde.
  ['solo tracking (AP-046 INTACTA)', [TRACKING], { via: 'no-declarado', motivo: 'solo-tracking' }],
  ['ventana fresca vacía', [], { via: 'no-declarado', motivo: 'sin-comentario-fresco' }],
  // ── Fail-closed ante terminal declarado (Riesgo 1 del issue) ──
  ['[NEEDS-HUMAN] anclado en un extra',
    [TRACKING, c(1, '[NEEDS-HUMAN]: el veredicto admite dos lecturas.')],
    { via: 'no-declarado', motivo: 'terminal-declarado-en-ventana-fresca' }],
  ['[NEEDS-HUMAN] en el TRACKING con extra posterior (el Auto-label no llegó a mirarlo)',
    [c(0, '[NEEDS-HUMAN]: decisión de producto.'), c(1, '<!-- adr-divergence -->')],
    { via: 'no-declarado', motivo: 'terminal-declarado-en-ventana-fresca' }],
  ['[CREATOR-ESCALATED] anclado (canal AP-035)',
    [TRACKING, c(1, '[CREATOR-ESCALATED]\n\nEl gate A3′ del ADR admite dos lecturas.')],
    { via: 'no-declarado', motivo: 'terminal-declarado-en-ventana-fresca' }],
  ['marcador HTML creator-blocked (canal AP-028)',
    [TRACKING, c(1, 'Paro limpio.\n\n<!-- creator-blocked -->')],
    { via: 'no-declarado', motivo: 'terminal-declarado-en-ventana-fresca' }],
  ['[ALCANCE-COMPLETO] anclado',
    [TRACKING, c(1, '[ALCANCE-COMPLETO]\n\nYa estaba en la base.')],
    { via: 'no-declarado', motivo: 'terminal-declarado-en-ventana-fresca' }],
  ['[READY-TO-MERGE] anclado', [TRACKING, c(1, '  [READY-TO-MERGE] nits aplicados.')],
    { via: 'no-declarado', motivo: 'terminal-declarado-en-ventana-fresca' }],
  // ── Clase PR #1133: un tag CITADO no es un tag emitido ──
  // El anclaje a inicio de línea es el mismo criterio del Auto-label. Sin él,
  // cualquier comentario que mencione el vocabulario congelaría la rama nueva.
  ['tag CITADO entre backticks a media frase (no ancla)',
    [TRACKING, c(1, 'Re-publico el sentinel; el gatillo `[NEEDS-HUMAN]` de CLAUDE.md no aplica aquí.')],
    { via: 'comment-only', extras: 1 }],
  ['marcador CITADO en prosa sin su forma HTML',
    [TRACKING, c(1, 'Nada que escalar: esto no es creator-escalated.')],
    { via: 'comment-only', extras: 1 }],
  // ── Orden: el discriminador es POSICIONAL, luego el orden de llegada del
  // array no puede decidir nada (la API los devuelve ascendentes, pero eso es
  // un detalle de la API y no una propiedad que el módulo deba heredar).
  ['array desordenado — el tracking sigue siendo el [0] por created_at',
    [c(1, '<!-- adr-divergence -->'), TRACKING],
    { via: 'comment-only', extras: 1 }],
];

for (const [nombre, frescos, esperado] of CASOS) {
  let got;
  try { got = clasificar(frescos); }
  catch (e) { fallos.push(`clasificar — ${nombre}: lanzó (${e.message})`); continue; }
  let ok = got.via === esperado.via;
  if (!ok) fallos.push(`clasificar — ${nombre}: esperado via=${esperado.via} — obtenido ${got.via}`);
  if (esperado.motivo && got.motivo !== esperado.motivo) {
    ok = false;
    fallos.push(`clasificar — ${nombre}: esperado motivo=${esperado.motivo} — obtenido ${got.motivo}`);
  }
  if (esperado.extras !== undefined && (got.extras || []).length !== esperado.extras) {
    ok = false;
    fallos.push(`clasificar — ${nombre}: esperado ${esperado.extras} extra(s) — obtenido ${(got.extras || []).length}`);
  }
  lineas.push(`  ${ok ? '·' : '✗'} clasificar: ${nombre.padEnd(64)} via=${got.via} (${got.motivo})`);
}

// ── Parte 2: contrato de RUNTIME contra un doble de la API ───────────────────
// Aserta la COSTURA (los nombres de parámetro que el stub del parche pasa) y
// las ESCRITURAS reales. El stub vive en un fichero no pusheable y no parseado
// por `check-embedded-js` mientras el parche esté pendiente: si alguien
// renombra un parámetro aquí, nada más lo cazaría.
const PAT_USER = { login: 'talfarouriarte-cloud' };
const BOT = { login: 'claude[bot]' };
const conAutor = (cm, user = BOT) => ({ ...cm, user });

async function correr({ comments, trigTs = '2026-07-24T09:00:00Z', removeLabelError = null }) {
  const escrituras = [];
  const cuerpos = [];
  const avisos = [];
  const github = {
    rest: {
      issues: {
        addLabels: async ({ labels }) => { escrituras.push(`addLabels:${labels.join('+')}`); },
        removeLabel: async ({ name }) => {
          if (removeLabelError) { escrituras.push(`removeLabel:${name}:ERROR`); throw removeLabelError; }
          escrituras.push(`removeLabel:${name}`);
        },
        createComment: async ({ body }) => { escrituras.push('createComment'); cuerpos.push(body); },
      },
    },
  };
  const core = {
    warning: (m) => avisos.push(String(m)),
    notice: (m) => avisos.push(String(m)),
    info: (m) => avisos.push(String(m)),
  };
  const context = { repo: { owner: 'o', repo: 'r' } };
  const out = await belt({
    github, context, core, prNumber: 1724, comments, trigTs, headSha: 'deadbeefcafe1234',
  });
  return { escrituras, cuerpos, avisos, out };
}

const NEEDS = ['removeLabel:needs-review', 'addLabels:needs-review', 'createComment'];
const ARCH = ['addLabels:estado:esperando-architect', 'addLabels:stalled', 'createComment'];

const CONTRATO = [
  // La línea `Δestado:` apunta FUERA del módulo y es justo la que un humano usa
  // para auditar QUÉ fue el Δestado (🔵 6 de la review): `extras.map(c =>
  // c.html_url).filter(Boolean)` degrada a cadena vacía EN SILENCIO si el shape
  // del comentario cambia, y sin aserción esa pérdida pasaría en verde.
  ['comment-only ⇒ re-convocatoria del Reviewer',
    { comments: [TRACKING, c(1, '<!-- adr-divergence -->')].map((x) => conAutor(x)) },
    NEEDS,
    { contiene: [
      '<!-- turn-close-failsafe: comment-only -->', 'deadbee',
      'Δestado: https://github.com/o/r/pull/1724#issuecomment-1',
      '1 comentario propio',
    ],
      noContiene: ['<!-- escalada-materializada-con-pr -->', 'comentarios propios'] }],
  // Plural + separador ` · `: el recuento y el enlazado son texto generado, y su
  // forma en singular ya está gateada arriba. Con DOS extras cambian los dos.
  ['comment-only con DOS extras ⇒ plural y separador ` · ` en Δestado',
    { comments: [TRACKING, c(1, 'Informe pedido por el veredicto.'), c(2, '<!-- adr-divergence -->')]
      .map((x) => conAutor(x)) },
    NEEDS,
    { contiene: [
      '2 comentarios propios',
      'Δestado: https://github.com/o/r/pull/1724#issuecomment-1 · https://github.com/o/r/pull/1724#issuecomment-2',
    ] }],
  // El único fail-OPEN que quedaba (🔵 5 de la review), ahora cerrado y
  // ANUNCIADO: sin `trigTs` no hay ventana fresca que clasificar. Sin este
  // guard, todo el historial del PR contaría como fresco y el filtro de
  // frescura de abajo quedaría neutralizado por la puerta de al lado.
  ['sin trigTs ⇒ cede sin escribir nada (fail-closed anunciado)',
    { comments: [TRACKING, c(1, '<!-- adr-divergence -->')].map((x) => conAutor(x)), trigTs: '' },
    [],
    {}],
  ['solo tracking ⇒ AP-046 intacta',
    { comments: [conAutor(TRACKING)] },
    ARCH,
    { contiene: ['<!-- escalada-materializada-con-pr -->'], noContiene: ['<!-- turn-close-failsafe: comment-only -->'] }],
  // Frescura (lección #180): un comentario propio ANTERIOR al disparador es de
  // una ronda pasada, no el Δestado de esta sesión. Sin el filtro, cualquier PR
  // con historial caería en `comment-only` para siempre.
  ['extra ANTERIOR al disparador ⇒ no cuenta (frescura, lección #180)',
    { comments: [
      conAutor({ ...c(1, '<!-- adr-divergence -->'), created_at: '2026-07-24T08:00:00Z' }),
      conAutor(TRACKING),
    ] },
    ARCH,
    { contiene: ['<!-- escalada-materializada-con-pr -->'] }],
  // Los post-steps publican con el PAT ⇒ NO firman como `claude[bot]`. Si un
  // comentario suyo contara como Δestado de la sesión, el belt se auto-
  // alimentaría: el diagnóstico de una vía haría que la siguiente corrida
  // clasificara `comment-only`.
  ['comentario fresco del PAT ⇒ no es Δestado de la sesión',
    { comments: [conAutor(TRACKING), conAutor(c(1, '**claude-code · post-step**: diagnóstico.'), PAT_USER)] },
    ARCH,
    { contiene: ['<!-- escalada-materializada-con-pr -->'] }],
  ['dedupe por marcador comment-only ⇒ cero escrituras',
    { comments: [conAutor(TRACKING), conAutor(c(1, 'ya\n<!-- turn-close-failsafe: comment-only -->'), PAT_USER)] },
    [],
    {}],
  ['dedupe por marcador AP-046 ⇒ cero escrituras',
    { comments: [conAutor(TRACKING), conAutor(c(1, 'ya\n<!-- escalada-materializada-con-pr -->'), PAT_USER)] },
    [],
    {}],
  // El Reviewer se autoborra `needs-review` como primer paso (ADR-063), así que
  // en estado normal la label NO está: el 404 del remove es el caso NORMAL, no
  // el excepcional, y tragárselo es obligatorio o la re-convocatoria muere.
  ['404 benigno de removeLabel ⇒ el add sigue',
    { comments: [TRACKING, c(1, '<!-- adr-divergence -->')].map((x) => conAutor(x)),
      removeLabelError: Object.assign(new Error('Label does not exist'), { status: 404 }) },
    ['removeLabel:needs-review:ERROR', 'addLabels:needs-review', 'createComment'],
    { contiene: ['<!-- turn-close-failsafe: comment-only -->'] }],
  ['terminal anclado en la ventana ⇒ AP-046 intacta y lo DICE',
    { comments: [TRACKING, c(1, '[NEEDS-HUMAN]: ambiguo.')].map((x) => conAutor(x)) },
    ARCH,
    { contiene: ['<!-- escalada-materializada-con-pr -->', 'TERMINAL declarado'] }],
];

for (const [nombre, opts, esperado, cuerpo] of CONTRATO) {
  let got;
  try { got = await correr(opts); }
  catch (e) { fallos.push(`contrato — ${nombre}: \`run\` lanzó (${e.message})`); continue; }
  let ok = JSON.stringify(got.escrituras) === JSON.stringify(esperado);
  if (!ok) fallos.push(`contrato — ${nombre}: esperado escrituras=${JSON.stringify(esperado)} — obtenido ${JSON.stringify(got.escrituras)}`);
  for (const s of cuerpo?.contiene || []) {
    if (!got.cuerpos.some((x) => x.includes(s))) { ok = false; fallos.push(`contrato — ${nombre}: ningún cuerpo publicado contiene ${JSON.stringify(s)}`); }
  }
  for (const s of cuerpo?.noContiene || []) {
    if (got.cuerpos.some((x) => x.includes(s))) { ok = false; fallos.push(`contrato — ${nombre}: un cuerpo publicado contiene ${JSON.stringify(s)} y NO debía`); }
  }
  lineas.push(`  ${ok ? '·' : '✗'} contrato: ${nombre.padEnd(64)} escrituras=${JSON.stringify(got.escrituras)}`);
}

// ── Parte 3: el stub del parche pendiente sigue casando con el módulo ────────
// La costura módulo↔stub es ASIMÉTRICA por construcción (AP-068): un agente
// puede editar este módulo y NO puede tocar —ni ver gateado por
// `check-embedded-js`— el `belt({ … })` de `claude-code.yml`, que vive dentro
// de `docs/patches/AP-071-*.patch` mientras el humano no lo aplique. Un rename
// de parámetro dejaría el belt leyendo `undefined` en runtime con banco y CI
// VERDES. `check-patches` verifica que el parche APLICA; esto verifica que lo
// que aplica sigue HABLANDO el mismo idioma.
const PARCHE = 'docs/patches/AP-071-turn-close-comment-only.patch';
if (existsSync(PARCHE)) {
  const txt = readFileSync(PARCHE, 'utf8');
  const inv = txt.split('\n').filter((l) => l.startsWith('+')).join('\n');
  const REQUERIDOS = ['prNumber', 'comments', 'trigTs', 'headSha'];
  const ausentes = REQUERIDOS.filter((k) => !new RegExp(`\\b${k}\\s*[:,}]`).test(inv));
  if (ausentes.length) {
    fallos.push(`costura — el stub de ${PARCHE} no pasa ${ausentes.join(', ')} a \`run\`: el belt los leería \`undefined\` en runtime, con banco y CI verdes`);
  }
  if (!inv.includes('creator-turn-close-failsafe.cjs')) {
    fallos.push(`costura — el stub de ${PARCHE} no hace \`require\` de \`creator-turn-close-failsafe.cjs\``);
  }
  lineas.push(`  ${ausentes.length ? '✗' : '·'} costura: stub del parche pendiente ↔ firma de \`run\``);
} else {
  // Fail-open ANUNCIADO: el parche desaparece legítimamente cuando el humano lo
  // aplica (entonces el stub vive en el workflow y `check-embedded-js` lo
  // parsea). Callar aquí convertiría ese día en una pérdida silenciosa de
  // cobertura.
  console.log(`::warning::check-turn-close-detection — ${PARCHE} no existe: la aserción de costura módulo↔stub NO se ha ejecutado (esperado si el parche ya se aplicó y se borró; anómalo en cualquier otro caso).`);
}

if (process.env.TURN_CLOSE_DETECTION_VERBOSE) lineas.forEach((l) => console.log(l));
if (fallos.length) {
  console.error(`CHECK-TURN-CLOSE-DETECTION ROJO (clasificación real de ${fuente}):`);
  fallos.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`check-turn-close-detection verde: ${CASOS.length} casos de clasificación + ${CONTRATO.length} aserciones de runtime sobre la función REAL de ${fuente} (no una copia) + la costura módulo↔stub del parche AP-071.`);
