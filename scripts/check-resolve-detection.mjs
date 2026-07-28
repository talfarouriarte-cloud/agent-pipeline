#!/usr/bin/env node
// check-resolve-detection — banco de casos EJECUTABLE de la detección de
// declaraciones cross-issue del post-step `resolve-cross-issue-failsafe`
// (AP-064). Nacido del hallazgo 🟡 4 de la ronda 2 de la review.
//
// Por qué existe: el belt decide si materializa una transición leyendo PROSA
// ESPAÑOLA con cuatro regexes (`DES_STALL`, `ARM`, `AMBIGUO`, `FUTURO`), y ahí
// ya han fallado DOS veces por la misma causa —`á` no es `\w` en JS, así que
// `retir\w*` se corta antes de la tilde y `\b` tras `á` no existe—, las dos
// veces cazadas EJECUTANDO el banco, no releyendo el diff. Un banco que vive
// en un comentario de un hilo de PR es disciplina sin consumidor: en cuanto
// alguien toca una regex, la evidencia ya no está y el cambio se juzga
// leyendo, que es exactamente lo que falló.
//
// AP-068 — QUÉ CAMBIÓ Y POR QUÉ IMPORTA. Hasta aquí este banco (a) extraía las
// regexes con un regex-sobre-texto del `.patch` o del `.yml`, porque el código
// estaba secuestrado dentro de `.github/workflows/**` y no había módulo que
// importar, y (b) REIMPLANTABA el pipeline de derivación (identidad →
// segmentación → acción → refs → polaridad), con un residual declarado en su
// propio comentario: «si el step cambia de FORMA, esta función tiene que
// cambiar con él». Eran dos formas que alguien tenía que mantener sincronizadas
// a mano — un mandato de memoria (clase AP-008) dentro del gate que existe para
// no tenerlos. Con el belt extraído a `vendored/scripts/…cjs` el banco
// EJECUTA la función real: no hay copia que pueda derivar, y un cambio de forma
// —no solo de regex— se juzga aquí.
//
// Verde: exit 0. Rojo: la derivación real cambió y el banco lo nota.
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

// El central lo tiene en `vendored/`; el workspace del consumidor lo recibe en
// `scripts/` por el graft (AP-009). Se prueba el del central primero: es el
// fichero FUENTE, y es el que un PR modifica.
const FUENTES = [
  'vendored/scripts/resolve-cross-issue-failsafe.cjs',
  'scripts/resolve-cross-issue-failsafe.cjs',
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
  console.log('::warning::check-resolve-detection — no encuentro `resolve-cross-issue-failsafe.cjs` en ninguna de sus dos ubicaciones: el banco NO se ha ejecutado.');
  process.exit(0);
}

const { derivar } = belt;
if (typeof derivar !== 'function') {
  console.error('CHECK-RESOLVE-DETECTION ROJO: `resolve-cross-issue-failsafe.cjs` ya no exporta `derivar` — el banco quedaría mudo sin decirlo.');
  process.exit(1);
}

const ROL_MARK = '<!-- watchdog-rol: architect-resolve -->';
const CAPA = '<!-- watchdog-capa: schedule -->';
const cmt = (body, { host = 1696, rol = true } = {}) => ({ host, body: `${body}\n\n${CAPA}${rol ? `\n${ROL_MARK}` : ''}` });

// esperado: { decl, avisos } — `avisos` se compara por CLASE.
const CASOS = [
  ['INSTANCIA fp#1711', [cmt('`stalled` retirada de #1694 y re-arm del eslabón 1/3 allí (detalle en su hilo).')],
    { 1694: { desStall: true, arm: true } }, []],
  ['solo des-stall', [cmt('Retirada la label `stalled` de #1694.')], { 1694: { desStall: true, arm: false } }, []],
  ['solo arm', [cmt('Re-arm del eslabón 1/3 en #1694.')], { 1694: { desStall: false, arm: true } }, []],
  ['negado', [cmt('No retiro `stalled` de #1694 hasta que el humano decida.')], {}, ['negada/condicional/pospuesta']],
  ['condicional', [cmt('Habría que re-armar #1694 si el CI sale verde.')], {}, ['negada/condicional/pospuesta']],
  ['pendiente', [cmt('Queda pendiente el re-arm de #1694.')], {}, ['negada/condicional/pospuesta']],
  ['in-thread (sin #N ajeno)', [cmt('Retirada la label `stalled` y re-armado el turno.')], {}, []],
  ['auto-ref', [cmt('Retirada la label `stalled` de #1696 y re-arm allí.', { host: 1696 })], {}, []],
  ['multi-ref', [cmt('Re-arm de #1694 y #1695 en el mismo movimiento.')], {}, ['multi-ref']],
  ['prosa sin accion', [cmt('El diagnóstico de #1694 queda publicado en su hilo.')], {}, []],
  ['dentro de code fence', [cmt('Ejemplo de lo que NO hice:\n```\nre-arm de #1694\n```')], {}, []],
  ['mencion en marcador', [cmt('Sin acción.\n<!-- launch-next: #1694 re-arm -->')], {}, []],
  ['(a) Creator sin marcador de rol', [cmt('Re-arm del eslabón 1/3 en #1694.', { rol: false })], {}, []],
  ['(a-bis) MISMA prosa CON marcador', [cmt('Cierro el turno: el eslabón 3/3 (#1695) se armará al mergear este PR.')], {}, ['futuro/intención']],
  ['(b) intención «voy a re-armar»', [cmt('Voy a re-armar #1694 en cuanto termine aquí.')], {}, ['futuro/intención']],
  ['(b-bis) «procedo a retirar»', [cmt('Procedo a retirar la label `stalled` de #1694.')], {}, ['futuro/intención']],
  ['(d) pretérito «retiré/re-armé»', [cmt('Retiré la label `stalled` de #1694 y re-armé el eslabón 1/3 allí.')], { 1694: { desStall: true, arm: true } }, []],
  ['(e) post-step hermano ping-creator', [{ host: 1696, body: `**watchdog · ping-creator**: arm materializado en #1694.\n<!-- ping-creator-materializado -->\n${CAPA}` }], {}, []],
  // Ronda 2, 🟡 2: los OTROS emisores de `watchdog-capa:` que la lista negra no
  // cubría. El de AP-055 interpola encabezados ARBITRARIOS de `decisions.md`:
  // el día que una rectificación se titule con vocabulario de arm, la lista
  // negra habría dejado pasar el vector. El guard positivo no.
  ['(f) rectificación en vuelo (AP-055) con vocabulario de arm', [{ host: 1696, body: `**watchdog**: rectificación EN VUELO — «### Revisión R·1 (2026-07-15, issue #1694) — re-arm del eslabón»\n${CAPA}` }], {}, []],
  ['(g) circuit-breaker', [{ host: 1696, body: `**watchdog · circuit-breaker**: re-arm de #1694 suspendido.\n${CAPA}` }], {}, []],
  // Ronda 2, 🟡 2 / epic-merge: un marcador CITADO no es un marcador emitido
  // (misma clase que AP-063: EFECTUAR ≠ CITAR). Esta review, que cita el
  // marcador entre backticks y habla de re-armar #1694, NO es del resolver.
  ['(h) review que CITA el marcador de rol', [{ host: 1696, body: 'El belt exige `<!-- watchdog-rol: architect-resolve -->`; sin él no materializa el re-arm de #1694.' }], {}, []],
  ['(i) marcador de rol dentro de un bloque cercado', [{ host: 1696, body: 'Así se emite:\n```\n<!-- watchdog-rol: architect-resolve -->\n```\nY re-armé #1694.' }], {}, []],
  // Ronda 3, 🟡 3 — CASO DE CONGELACIÓN, no de corrección. El guard de
  // identidad resuelve QUIÉN habla, no DE QUIÉN es la acción: el resolver
  // NARRANDO en pasado un arm ajeno se deriva como declaración propia
  // (`ARM` casa «re-armado»; `AMBIGUO` no casa —«quedó» no es «queda»—; y
  // `FUTURO` tampoco, porque es pretérito, que es la forma que el mandato
  // PIDE). Si ese arm ajeno cae fuera de la ventana del job, el belt re-arma:
  // es el ÚNICO frente donde no cae del lado seguro (fail-activo), acotado por
  // el guard serial y por MAX=3. Se acepta declarado —residual (f) de AP-064—
  // a cambio de no meter heurística de atribución en prosa libre. El esperado
  // de abajo es el comportamiento ACTUAL: si alguien lo cambia, que sea
  // mirando este caso y no descubriéndolo en producción.
  ['(j) NARRACIÓN de un arm ajeno (fail-activo declarado)', [cmt('El eslabón 2/3 (#1695) ya quedó re-armado por epic-merge al mergear.')], { 1695: { desStall: false, arm: true } }, []],
  // AP-068 — el belt ya no lee el `host` de un campo que el banco inventaba:
  // `derivar` lo recibe calculado, y un comentario sin host no puede
  // atribuirse a nadie. Caso nuevo, cubre la rama `if (!host) continue`.
  ['(k) comentario sin host derivable', [{ host: NaN, body: `Re-arm del eslabón 1/3 en #1694.\n${ROL_MARK}` }], {}, []],
];

// `derivar` devuelve además `host`/`url` por declaración (los necesita el
// runtime para componer la cita). El banco juzga SOLO el par acción→issue:
// comparar el objeto entero ataría el test a datos de presentación.
const soloAcciones = (decl) => Object.fromEntries(
  Object.entries(decl).map(([n, d]) => [n, { desStall: d.desStall, arm: d.arm }]),
);

const fallos = [];
const lineas = [];
for (const [nombre, comentarios, decl, avisos] of CASOS) {
  const got = derivar(comentarios);
  const gotDecl = soloAcciones(got.decl);
  const gotClases = got.avisos.map((a) => a.clase);
  const okDecl = JSON.stringify(gotDecl) === JSON.stringify(decl);
  const okAviso = gotClases.length === avisos.length && avisos.every((w, i) => gotClases[i] === w);
  if (!okDecl || !okAviso) {
    fallos.push(`${nombre}: esperado decl=${JSON.stringify(decl)} avisos=${JSON.stringify(avisos)} — obtenido decl=${JSON.stringify(gotDecl)} avisos=${JSON.stringify(gotClases)}`);
  }
  lineas.push(`  ${okDecl && okAviso ? '·' : '✗'} ${nombre.padEnd(46)} decl=${JSON.stringify(gotDecl)} avisos=${JSON.stringify(gotClases)}`);
}

// ── Contrato de RUNTIME del belt: la costura módulo↔stub y los GUARDS ────────
// El banco de arriba juzga la DERIVACIÓN; esto juzga lo que decide si el belt
// ESCRIBE, que es la otra mitad del comportamiento.
//
// Nació (AP-068, ronda 1 🟡 3) cubriendo solo la COSTURA, el único punto del
// mecanismo sin gate y con deriva ASIMÉTRICA: el stub que invoca el módulo vive
// en `watchdog.yml` (parche pendiente, no pusheable por un agente, no parseado
// mientras lo esté) y el módulo sí es pusheable. Un rename de `skipLabels`
// pasaba el banco y el CI en verde y apagaba el kill-switch por label de
// exclusión EN RUNTIME, en silencio.
//
// AP-069 lo AMPLÍA al resto de guards, que era el residual (d) declarado de
// AP-068 —«el dedupe por ventana, la clasificación de issue virgen, el 404
// benigno de `removeLabel` y el tope `MAX` siguen sin caso»—. La razón para
// cerrarlo ahora y no «cuando el belt se despliegue» es que la asimetría es la
// MISMA que motivó la costura: estos guards viven en el módulo pusheable, su
// única prueba en producción llega el día que el humano aplique el parche, y
// para entonces cualquier deriva introducida entre medias se estrena en
// runtime. Cada guard falla además hacia el lado CARO —materializar donde no
// debía, o afirmar en prosa un estado que no se alcanzó, que es literalmente la
// clase que AP-064 existe para cerrar—, así que la ausencia de caso no era
// coste cero mientras tanto: era la ventana abierta.
//
// El caso de CONTROL no es decorativo: sin él los casos negativos serían vacuos
// (pasarían también si el doble no llegara nunca al punto de escritura).
const DECL = `\`stalled\` retirada de #1694 y re-arm del eslabón 1/3 allí.\n${CAPA}\n${ROL_MARK}`;
const { MARK } = belt;

// Las escrituras se registran CON el issue destino (`removeLabel#1694`): sin el
// número, el caso del tope `MAX` —tres materializaciones de cuatro declaradas—
// no se puede asertar, solo contar.
async function correrBelt({
  skipLabels, envSkip, labels,
  declaracion = DECL,          // prosa del resolver que entra por el barrido fresco
  destino = {},                // override del estado del issue DESTINO (`issues.get`)
  comentariosDestino = [],     // lo que `listComments` devuelve para el destino
  removeLabelErr,              // error que `removeLabel` lanza, si se quiere probar esa rama
} = {}) {
  const escrituras = [];
  const cuerpos = [];
  const ahora = new Date().toISOString();
  const comentario = {
    issue_url: 'https://api.github.com/repos/o/r/issues/1696',
    body: declaracion, html_url: 'https://example/1', created_at: ahora, updated_at: ahora,
  };
  const paginate = async () => comentariosDestino;       // comentarios del DESTINO
  paginate.iterator = async function* () { yield { data: [comentario] }; };
  const github = {
    paginate,
    rest: {
      actions: { getWorkflowRun: async () => ({ data: { run_started_at: new Date(Date.now() - 60_000).toISOString() } }) },
      issues: {
        get: async ({ issue_number }) => ({ data: { number: issue_number, state: 'open', body: '@claude arranca', labels: labels.map((name) => ({ name })), ...destino } }),
        listComments: 'listComments',
        listCommentsForRepo: 'listCommentsForRepo',
        // Se registra la LLAMADA, no el éxito: la rama que importa en el caso
        // del fallo no-404 es «se intentó retirar y NO se publicó comentario».
        removeLabel: async ({ issue_number }) => { escrituras.push(`removeLabel#${issue_number}`); if (removeLabelErr) throw removeLabelErr; },
        createComment: async ({ issue_number, body }) => { escrituras.push(`createComment#${issue_number}`); cuerpos.push(body); },
      },
    },
  };
  const core = { info() {}, notice() {}, warning() {} };
  const context = { repo: { owner: 'o', repo: 'r' }, eventName: 'schedule', runId: 1 };
  const previo = process.env.IN_SKIP_LABELS;
  if (envSkip === undefined) delete process.env.IN_SKIP_LABELS; else process.env.IN_SKIP_LABELS = envSkip;
  try {
    await belt({ github, context, core, skipLabels });
  } finally {
    if (previo === undefined) delete process.env.IN_SKIP_LABELS; else process.env.IN_SKIP_LABELS = previo;
  }
  return { escrituras, cuerpos };
}

if (typeof belt !== 'function') {
  console.error('CHECK-RESOLVE-DETECTION ROJO: `resolve-cross-issue-failsafe.cjs` ya no exporta el runtime como función — el stub de `watchdog.yml` hace `belt({...})` y reventaría en cada corrida.');
  process.exit(1);
}

const SKIP = 'pause-agents,human-needed';
const AHORA = new Date().toISOString();
const enVentana = (body) => ({ body, created_at: AHORA });
// Cuatro destinos declarados en cuatro segmentos: uno por segmento, porque más
// de un `#N` en el MISMO segmento es fail-open por multi-referencia. Sirve para
// asertar el tope `MAX` del módulo, que hoy es 3.
const DECL_4 = `\`stalled\` retirada de #1001.\n\`stalled\` retirada de #1002.\n\`stalled\` retirada de #1003.\n\`stalled\` retirada de #1004.\n${CAPA}\n${ROL_MARK}`;
// Declaración de des-stall Y NADA MÁS. Necesaria para aislar la rama «no queda
// nada materializado»: con la declaración completa (`DECL`) el arm sigue
// pendiente aunque `removeLabel` falle, luego el belt publica —correctamente—
// por el arm. El banco cazó esta confusión al escribirlo, que es para lo que
// está: la expectativa inicial de este caso era la equivocada, no el módulo.
const DECL_DS = `\`stalled\` retirada de #1694.\n${CAPA}\n${ROL_MARK}`;
const err = (status) => Object.assign(new Error(`API ${status}`), { status });

// [nombre, opts, escrituras esperadas, aserción opcional sobre el CUERPO publicado]
const CONTRATO = [
  ['control: sin label de exclusión, el belt SÍ materializa',
    { skipLabels: SKIP, labels: ['stalled'] },
    ['removeLabel#1694', 'createComment#1694'],
    { contiene: ['@claude', '<!-- watchdog-rearm -->', MARK] }],
  ['kill-switch por el parámetro que pasa el stub',
    { skipLabels: SKIP, labels: ['stalled', 'pause-agents'] },
    []],
  ['kill-switch por el env del stub (rename del parámetro inocuo)',
    { envSkip: SKIP, labels: ['stalled', 'pause-agents'] },
    []],
  // ── AP-069: los guards que el residual (d) de AP-068 dejó sin caso ──
  // Dedupe por VENTANA. Sin él, cada tick del watchdog re-materializaría la
  // misma declaración mientras siga en la ventana: comentario duplicado en el
  // destino y, si llevaba arm, una sesión de Creator por tick.
  ['dedupe: ya materializado en esta ventana ⇒ no-op',
    { skipLabels: SKIP, labels: ['stalled'], comentariosDestino: [enVentana(`ya materializado\n${MARK}`)] },
    []],
  // Destino fuera de alcance. Un PR no se arma por esta vía (su equivalente es
  // `ping-creator`) y un issue cerrado no tiene nada que reanudar.
  ['destino que es un PR ⇒ fuera de alcance',
    { skipLabels: SKIP, labels: ['stalled'], destino: { pull_request: { url: 'x' } } },
    []],
  ['destino cerrado ⇒ nada que reanudar',
    { skipLabels: SKIP, labels: ['stalled'], destino: { state: 'closed' } },
    []],
  // Issue VIRGEN (ningún `@claude` en body ni en comentarios): prohibición
  // absoluta del rol (`watchdog.md` § Prohibiciones). El des-stall SÍ procede
  // —no es un arm—, pero el comentario NO puede salir con cabecera de arm: si
  // saliera, el filtro de `claude-code.yml` despertaría a un Creator sobre un
  // issue que nadie armó nunca. Por eso el caso asierta el CUERPO y no solo la
  // lista de llamadas.
  ['issue VIRGEN: des-stall sí, arm JAMÁS (y el cuerpo no puede pedirlo)',
    { skipLabels: SKIP, labels: ['stalled'], destino: { body: 'Issue sin armar todavía.' } },
    ['removeLabel#1694', 'createComment#1694'],
    { noContiene: ['@claude', '<!-- watchdog-rearm -->'] }],
  // Nada que materializar: `stalled` ausente y arm ya posteado en la ventana.
  // Es el caso NORMAL cuando el resolver sí ejecutó lo que declaró.
  ['lo declarado ya está materializado ⇒ no-op',
    { skipLabels: SKIP, labels: [], comentariosDestino: [enVentana('@claude arranca')] },
    []],
  // `removeLabel` 404 = la label ya no estaba (carrera con el resolver vivo):
  // el estado deseado SÍ se alcanzó, luego se publica.
  // Con `DECL_DS` (des-stall y nada más) el 404 es la ÚNICA razón por la que el
  // belt puede publicar aquí: con la declaración completa el arm pendiente lo
  // publicaría igual y el caso sería vacuo respecto de esta rama — verificado
  // por mutación (apagar la rama del 404 con `DECL` deja el banco en verde).
  ['removeLabel 404 (carrera benigna) ⇒ estado alcanzado, se publica',
    { skipLabels: SKIP, labels: ['stalled'], declaracion: DECL_DS, removeLabelErr: err(404) },
    ['removeLabel#1694', 'createComment#1694'],
    { contiene: ['`stalled` retirada por estado'] }],
  // `removeLabel` fallo REAL y nada más que materializar: NO se publica. Un
  // comentario que afirmara la retirada sin haberla hecho reproduciría DENTRO
  // del belt la clase exacta que AP-064 cierra, y el marcador dedupearía
  // además su propio reintento del tick siguiente.
  ['removeLabel 500 sin arm pendiente ⇒ ni comentario ni marcador',
    { skipLabels: SKIP, labels: ['stalled'], declaracion: DECL_DS, removeLabelErr: err(500) },
    ['removeLabel#1694']],
  // Tope duro por corrida: 4 destinos declarados, 3 materializados.
  ['tope MAX por corrida: 4 declarados ⇒ 3 materializados',
    { skipLabels: SKIP, labels: ['stalled'], declaracion: DECL_4 },
    ['removeLabel#1001', 'createComment#1001', 'removeLabel#1002', 'createComment#1002', 'removeLabel#1003', 'createComment#1003']],
];

for (const [nombre, opts, esperado, cuerpo] of CONTRATO) {
  let got;
  try { got = await correrBelt(opts); }
  catch (e) { fallos.push(`contrato — ${nombre}: \`run\` lanzó (${e.message})`); continue; }
  let ok = JSON.stringify(got.escrituras) === JSON.stringify(esperado);
  if (!ok) fallos.push(`contrato — ${nombre}: esperado escrituras=${JSON.stringify(esperado)} — obtenido ${JSON.stringify(got.escrituras)}`);
  for (const s of cuerpo?.contiene || []) {
    if (!got.cuerpos.some((c) => c.includes(s))) { ok = false; fallos.push(`contrato — ${nombre}: ningún cuerpo publicado contiene ${JSON.stringify(s)}`); }
  }
  for (const s of cuerpo?.noContiene || []) {
    if (got.cuerpos.some((c) => c.includes(s))) { ok = false; fallos.push(`contrato — ${nombre}: un cuerpo publicado contiene ${JSON.stringify(s)} y NO debía`); }
  }
  lineas.push(`  ${ok ? '·' : '✗'} contrato: ${nombre.padEnd(56)} escrituras=${JSON.stringify(got.escrituras)}`);
}

if (process.env.RESOLVE_DETECTION_VERBOSE) lineas.forEach((l) => console.log(l));
if (fallos.length) {
  console.error(`CHECK-RESOLVE-DETECTION ROJO (derivación real de ${fuente}):`);
  fallos.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`check-resolve-detection verde: ${CASOS.length} casos del banco de AP-064 sobre la derivación REAL de ${fuente} (no una copia) + ${CONTRATO.length} aserciones de runtime ejecutando \`run\` contra un doble de la API (costura módulo↔stub, dedupe por ventana, destino fuera de alcance, issue virgen, 404 benigno de removeLabel y tope MAX — AP-069 cierra el residual (d) de AP-068).`);
