'use strict';
// creator-turn-close-failsafe — cola del `turn-close-failsafe` del step
// `Auto-label based on Creator's closing tag` de `claude-code.yml`: el tramo
// que decide QUÉ es un cierre del Creator SIN tag y SIN push (AP-046 + AP-071).
//
// QUÉ CIERRA AP-071 (repesca finplan#1724, aud. finplan#1736 §R1). El veredicto
// NITS de la ronda 2 de finplan#1724 pedía UNA cosa sin diff: re-publicar el
// sentinel `adr-divergence` por `gh api` (el tracking comment se lo había
// comido, AP-013). La sesión del Creator lo hizo en 1m 17s. Su Δestado fue un
// COMENTARIO: cero commits — y omitió el tag de cierre, como 8 de los 9 PRs de
// esa misma épica. El conjunto de portadores de la transición Creator→Reviewer
// era {PUSH, TAG}; sin ninguno de los dos, la rama else de AP-046 clasificó la
// sesión como terminal NO-declarado (`stalled` + `estado:esperando-architect`)
// y architect-resolve ruló 9 minutos más tarde con `derived-decision`:
// re-convocar al Reviewer. El PR mergeó 2 min después. Esa decisión era
// DERIVABLE de estado —comentario FRESCO de la sesión + cero commits
// post-veredicto + veredicto vigente ⇒ el entregable FUE el comentario y el
// turno vuelve al Reviewer—, luego el post-step la tenía a la vista y pagó
// `stalled` + una corrida del resolver + ~9 min de latencia por no mirarla.
// Clase: transición SIN PORTADOR para un tipo de entregable legítimo.
//
// Doctrina: materializar la transición que el estado ya determina, no juzgarla
// (familia AP-023/AP-036/AP-046). El rescate del resolver pasa a ser transición
// por evento en el MISMO job, latencia cero.
//
// ORDEN DE PRECEDENCIA (no se toca nada de lo anterior — este módulo es la
// COLA de la cadena, y todo lo que decide algo corre ANTES, en el step):
//   1. tag de cierre anclado en el último comentario fresco  → Auto-label
//   2. token/marcador `creator-escalated` en CUALQUIER comentario fresco
//      (AP-028/AP-035, dos canales)                          → cede al Architect
//   3. commits en el HEAD posteriores al veredicto            → `turn-close-failsafe`
//   4. ← AQUÍ: ¿el Δestado de la sesión fue un COMENTARIO?    → `comment-only` (AP-071)
//   5. si no                                                  → `escalada-materializada-con-pr` (AP-046)
// Fail-closed por construcción: sin comentario fresco EXTRA, el COMPORTAMIENTO
// de AP-046 queda intacto — mismas labels (`estado:esperando-architect` +
// `stalled`), mismo marcador, mismo dueño aguas abajo (architect-resolve).
//
// «Comportamiento», no «byte a byte» (🟡 2 de la review): al extraer el inline
// a este módulo hay CUATRO divergencias de texto, todas deliberadas y ninguna
// de enrutado — (1) el dedupe pasa de regex con `\s*` a `String.includes` de la
// forma exacta (el único emisor la escribe así); (2) el dedupe cubre ADEMÁS
// `MARK_COMMENT_ONLY`, para que las dos vías no se pisen en la misma ventana;
// (3) el cuerpo publicado gana la frase que dice POR QUÉ `comment-only` no
// aplicó; (4) el `core.warning` gana ese mismo motivo. Se enumeran aquí para
// que un Auditor que diffee inline-vs-módulo no tenga que re-litigar si alguna
// era intencionada: un enunciado literalmente comprobable y falso en el corpus
// es la clase que AP-065 cerró para el ancla.
//
// POR QUÉ VIVE AQUÍ Y NO EN `claude-code.yml` (AP-068). La GitHub App de
// claude-code-action no tiene permiso `workflows` (ADR-020, medido tres veces;
// la cuarta en AP-064), luego un agente NO puede pushear
// `.github/workflows/**` y este cuerpo viajaría como parche pendiente de un
// humano CADA VEZ que hubiera que ajustarlo. La restricción de GitHub es POR
// PATH: aquí el mismo código es pusheable, lo gatea el CI del central y lo
// ejecuta el banco `scripts/check-turn-close-detection.mjs` contra la función
// REAL. En el workflow queda solo la invocación (parche AP-071, acto ÚNICO).
//
// Consecuencia operativa: TODO diff de este fichero despliega a los DOS
// consumidores en su siguiente run, sin gradualidad (zona de rigor `vendored/`).

const MARK_COMMENT_ONLY = '<!-- turn-close-failsafe: comment-only -->';
const MARK_NO_DECLARADO = '<!-- escalada-materializada-con-pr -->';

// ── Vocabulario ANCLADO de terminal/escalada (jamás substring suelto) ────────
// Riesgo 1 del issue: un comentario fresco que es una ESCALADA en prosa. Hoy
// acaba (bien) en architect-resolve por AP-046; con la rama `comment-only`
// iría al Reviewer. Los dos canales anclados de la clase (AP-028 marcador HTML
// / AP-035 token de texto en primera línea) ya retornan ANTES, en el step —
// pero solo para `creator-escalated`. Esta lista cubre el resto de terminales
// del vocabulario del Creator para que la rama nueva CEDA en vez de arrastrar
// un terminal declarado hacia el Reviewer: si el Creator declaró CUALQUIER
// terminal en un comentario fresco, el turno NO es del Reviewer y el
// comportamiento AP-046 vigente (⇒ architect-resolve, que sabe leer prosa)
// sigue siendo el correcto.
//
// Ojo con el anclaje: `^\s*` en `[NEEDS-HUMAN]`/`[READY-TO-MERGE]` replica el
// criterio EXACTO del Auto-label (CLAUDE.loop.md admite sangría; PR #1133: un
// tag es un tag solo si ABRE su línea, jamás substring de prosa); los tokens
// de AP-035 se anclan a inicio de línea estricto, igual que sus post-steps.
const TERMINALES = [
  /^\s*\[NEEDS-HUMAN\]/m,
  /^\s*\[READY-TO-MERGE\]/m,
  /^\[CREATOR-ESCALATED\]/m,
  /^\[CREATOR-BLOCKED\]/m,
  /^\[ALCANCE-COMPLETO\]/m,
  /<!--\s*creator-escalated\s*-->/,
  /<!--\s*creator-blocked\s*-->/,
  /<!--\s*creator-alcance-completo\s*-->/,
];

// ── Clasificación PURA: comentarios frescos → vía ────────────────────────────
// Separada del runtime a propósito (AP-068): es la parte que DECIDE, y por
// tanto la única que puede fallar de forma interesante. Al ser pura, el banco
// ejecuta ESTA función y no una copia suya que pudiera derivar.
//
// `frescosBot`: los comentarios de `claude[bot]` creados DESPUÉS del comentario
// disparador (misma disciplina de frescura que el resto del step, lección #180),
// en orden ASCENDENTE de `created_at`.
//
// EL DISCRIMINADOR, y por qué no es «¿hay comentario fresco?» a secas. Al
// llegar aquí SIEMPRE hay al menos uno: la action crea su tracking comment
// («Claude Code is working…») ANTES de invocar al agente, y el guard de
// frescura de la cabecera del step ya habría retornado si el más reciente
// fuera anterior al disparador. Preguntar por la EXISTENCIA daría `true`
// siempre y la rama else de AP-046 quedaría inalcanzable — el fix se comería a
// su propio fail-closed.
//
// El hecho que distingue es POSICIONAL y de API, no de prosa: el tracking
// comment es, por construcción, el MÁS ANTIGUO de la ventana fresca (nace
// antes que la sesión). Cualquier comentario fresco POSTERIOR lo publicó la
// sesión —único emisor `claude[bot]` en vuelo; los post-steps publican con el
// PAT y NO firman como `claude[bot]`— y es por tanto un Δestado deliberado:
// un sentinel re-publicado, un bloque `pr-body-declarado`, un informe. Cero
// regex sobre prosa ⇒ fuera de la clase «regex polarity blindness».
//
// Residual declarado: un Δestado materializado EDITANDO un comentario previo
// (`gh api --method PATCH`) no mueve `created_at` y no se ve desde aquí. Cae
// al comportamiento AP-046 vigente, que es la dirección segura.
function clasificar(frescosBot) {
  // Orden ORDINAL, no `localeCompare` (🔵 4 de la review): las cadenas ISO-8601
  // de la API son lexicográficamente ordenables tal cual, y `localeCompare` es
  // colación ICU —donde `-` y `:` son puntuación VARIABLE y la semántica
  // depende de locale e implementación— en la línea de la que cuelga el
  // discriminador POSICIONAL entero de AP-071. Si el orden se rompiera, `[0]`
  // dejaría de ser el tracking comment y `extras` dejaría de significar lo que
  // este módulo cree, con el banco en verde (sus fixtures son todos del mismo
  // formato). Dependencia gratuita retirada.
  const frescos = [...(frescosBot || [])].sort((a, b) => {
    const x = String(a.created_at || '');
    const y = String(b.created_at || '');
    return x < y ? -1 : x > y ? 1 : 0;
  });
  if (!frescos.length) return { via: 'no-declarado', motivo: 'sin-comentario-fresco', extras: [] };

  // Fail-closed ante terminal declarado: se mira TODA la ventana fresca, no
  // solo los extras. El tag del tracking comment ya lo consumió el Auto-label
  // SOLO si el tracking era el más reciente; cuando la sesión publicó algo
  // después, el `last` del step es ese algo y el tag del tracking no se llegó
  // a mirar. Aquí sí.
  const conTerminal = frescos.find((c) => TERMINALES.some((re) => re.test(c.body || '')));
  if (conTerminal) {
    return { via: 'no-declarado', motivo: 'terminal-declarado-en-ventana-fresca', extras: [], ref: conTerminal };
  }

  const extras = frescos.slice(1);   // [0] = tracking comment de la action
  if (!extras.length) return { via: 'no-declarado', motivo: 'solo-tracking', extras: [] };
  return { via: 'comment-only', motivo: 'delta-estado-por-comentario', extras };
}

// ── Runtime: materializa la vía que el estado determina ──────────────────────
// NO lee: recibe `comments` del step, que ya los releyó («el agente acaba de
// añadir el suyo»). Dos lecturas del mismo hilo podrían discrepar entre sí y
// la costura sería una avería nueva; con una sola, el universo que clasifica
// esta función es EXACTAMENTE el que el Auto-label usó para buscar el tag.
async function run({ github, context, core, prNumber, comments, trigTs, headSha }) {
  const { owner, repo } = context.repo;
  const todos = comments || [];

  // Sin ventana fresca declarada NO se clasifica nada (🔵 5 de la review). El
  // stub garantiza hoy que `trigTs` es truthy —el guard de la cabecera del step
  // exige `triggerBody.includes('ping-creator') && triggerCreatedAtRaw` para
  // llegar hasta aquí—, luego esto es inalcanzable; pero la alternativa que
  // vivía en su sitio (`trigTs ? filtrar : todos`) era el ÚNICO fail-OPEN de un
  // módulo cuyo argumento entero es «esta cola es fail-closed por
  // construcción»: con `trigTs` vacío, TODO el historial del PR pasaba a ser
  // «ventana fresca» y cualquier PR con ≥2 comentarios de `claude[bot]`
  // clasificaba `comment-only` para siempre — el filtro de frescura (lección
  // #180, una de las mutaciones que el banco caza) neutralizado por la puerta
  // de al lado. La costura módulo↔stub es asimétrica por construcción (AP-068):
  // el día que el stub cambie, éste es de los parámetros que pueden llegar
  // `undefined` sin que nada más lo cace. Cede, y lo ANUNCIA.
  if (!trigTs) {
    core.warning(
      `PR #${prNumber}: turn-close-failsafe (cola) sin ventana fresca declarada `
      + `(\`trigTs\` ausente) — cedo sin escribir nada; el estado lo resuelven las `
      + `capas de cron, que es la dirección segura (AP-071).`);
    return { via: 'sin-trigts' };
  }

  const frescos = todos.filter((c) => new Date(c.created_at) > new Date(trigTs));

  // Idempotencia: dedupe por marcador sobre TODOS los comentarios frescos (los
  // publica el PAT ⇒ NO los firma `claude[bot]`, así que no entran en la
  // clasificación de abajo). Cubre las DOS vías: si una ya dejó rastro en esta
  // ventana, la otra no debe pisarla.
  const yaHecho = frescos.find((c) => (c.body || '').includes(MARK_COMMENT_ONLY)
    || (c.body || '').includes(MARK_NO_DECLARADO));
  if (yaHecho) {
    core.notice('turn-close-failsafe (cola): la ventana ya lleva rastro de materialización — no duplico.');
    return { via: 'dedupe' };
  }

  const frescosBot = frescos.filter((c) => c.user && c.user.login === 'claude[bot]');
  const { via, motivo, extras, ref } = clasificar(frescosBot);
  const huella = headSha ? String(headSha).slice(0, 7) : 'desconocido';

  if (via === 'comment-only') {
    // Canal ESTABLECIDO de re-convocatoria: remove+add de `needs-review` con el
    // PAT del step (el guard anti-loop del Reviewer ignora los `labeled` de
    // `claude[bot]`, y su concurrency lleva `cancel-in-progress: false`). Cero
    // labels nuevas y ningún escritor nuevo de labels de gate (`lgtm`/
    // `ci-verde`): el gate de epic-merge no se toca.
    await github.rest.issues.removeLabel({ owner, repo, issue_number: prNumber, name: 'needs-review' })
      .catch(() => { /* puede no estar: el Reviewer se autoborra al arrancar (ADR-063) */ });
    await github.rest.issues.addLabels({ owner, repo, issue_number: prNumber, labels: ['needs-review'] });
    const urls = extras.map((c) => c.html_url).filter(Boolean);
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: '**claude-code · turn-close-failsafe (causa: `comment-only`)**: la sesión '
        + 'del Creator (convocada por `ping-creator`, veredicto vigente) terminó '
        + '`success` SIN commits posteriores al veredicto y SIN tag de cierre '
        + 'anclado, pero publicó '
        + `${extras.length} comentario${extras.length === 1 ? '' : 's'} propio${extras.length === 1 ? '' : 's'} `
        + 'en la ventana fresca de esta sesión: su Δestado FUE el comentario '
        + '(entregable legítimo — sentinel re-publicado, bloque declarado, '
        + 'informe pedido por un veredicto sin diff). Transición Creator→Reviewer '
        + 'materializada por ESTADO en el mismo job: `needs-review` re-aplicada '
        + 'con el PAT, en vez de `stalled` + `estado:esperando-architect` (que '
        + 'costaba una corrida de architect-resolve y ~9 min para una decisión '
        + 'DERIVABLE — repesca finplan#1724, aud. finplan#1736 §R1, AP-071). '
        + 'Ningún token terminal casó por ninguno de los dos canales '
        + '(AP-028/AP-035), que corren ANTES que esta rama. HEAD `' + huella + '`.'
        + (urls.length ? `\n\nΔestado: ${urls.join(' · ')}` : '')
        + `\n\n${MARK_COMMENT_ONLY}`,
    });
    core.warning(
      `PR #${prNumber}: cierre sin tag y sin push con Δestado por COMENTARIO `
      + `(${extras.length} fresco${extras.length === 1 ? '' : 's'}) — needs-review re-aplicada `
      + `por turn-close-failsafe (causa: comment-only, AP-071).`);
    return { via, motivo };
  }

  // ── Rama ELSE de AP-046, COMPORTAMIENTO INTACTO (repesca finplan#1598) ───
  // Las cuatro divergencias de TEXTO respecto del inline que sustituye están
  // enumeradas en la cabecera de este fichero (🟡 2 de la review); ninguna
  // cambia labels, marcador ni dueño aguas abajo.
  // Gemelo con-PR de `escalada-materializada` (AP-036). Llegamos aquí con el
  // terminal NO-declarado del loop de PR completamente acotado por ESTADO:
  // sesión convocada por `ping-creator` (veredicto vigente), `success`, HEAD
  // SIN commits posteriores al veredicto, SIN tag de cierre anclado, SIN token
  // de escalada por ninguno de los dos canales y —desde AP-071— SIN Δestado
  // por comentario. Ese estado es un «turno-de-nadie» que el dispatcher del
  // Watchdog acabaría declarando zombi por cron (~20 min + slot del cap): se
  // materializa en el instante como escalada por ESTADO (misma semántica
  // AP-036) ⇒ architect-resolve POR EVENTO, que lee la prosa del cierre y rula
  // (escalada ⇒ resuelve/re-arma; sesión degenerada ⇒ humano por DOBLE REBOTE,
  // jamás de primera línea — ninguna vía nueva a humano).
  const porQue = {
    'sin-comentario-fresco': 'sin ningún comentario propio en la ventana fresca',
    'solo-tracking': 'sin más comentario propio que el tracking de la action (cero Δestado)',
    'terminal-declarado-en-ventana-fresca':
      'con un TERMINAL declarado y anclado en la ventana fresca — el turno no es del Reviewer',
  }[motivo] || motivo;
  await github.rest.issues.addLabels({
    owner, repo, issue_number: prNumber, labels: ['estado:esperando-architect'] });
  await github.rest.issues.addLabels({
    owner, repo, issue_number: prNumber, labels: ['stalled'] });
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: '**claude-code · escalada-materializada-con-pr**: la sesión del Creator '
      + '(convocada por `ping-creator`, veredicto vigente) terminó `success` SIN '
      + 'commits posteriores al veredicto, SIN tag de cierre anclado y SIN token '
      + 'de escalada por ninguno de los dos canales '
      + '(`[CREATOR-ESCALATED]`/`<!-- creator-escalated -->`) — un terminal '
      + 'NO-declarado dentro del loop de PR. Gemelo con-PR de '
      + '`escalada-materializada` (AP-046, repesca finplan#1598): estado '
      + 'materializado por PAT en el mismo job (doctrina estado-primario, '
      + 'protocol.md §1), sin esperar a que el dispatcher lo declare '
      + '`turno-de-nadie` por cron. `estado:esperando-architect` (el dispatcher '
      + 'cede) + `stalled` ⇒ architect-resolve POR EVENTO, que lee la prosa del '
      + 'cierre y rula (misma semántica AP-036: escalada ⇒ resuelve/re-arma; '
      + 'sesión degenerada ⇒ humano por doble rebote). La rama `comment-only` '
      + `de AP-071 NO aplica: la sesión cerró ${porQue}`
      + (ref && ref.html_url ? ` (${ref.html_url})` : '')
      + '. HEAD `' + huella + '`.'
      + `\n\n${MARK_NO_DECLARADO}`,
  });
  core.warning(
    `PR #${prNumber}: terminal no-declarado en loop de PR (success, sin push `
    + `post-veredicto, sin token de escalada, sin Δestado por comentario: ${motivo}) `
    + `materializado por estado — stalled + estado:esperando-architect `
    + `(escalada-materializada-con-pr, AP-046).`);
  return { via, motivo };
}

module.exports = run;
module.exports.clasificar = clasificar;
// El vocabulario de decisión se exporta COMPLETO y desde el MISMO sitio del que
// lo lee el runtime (🔵 3 de la review de AP-070: un export que promete «todos»
// y se queda corto no se cae, se PUDRE, y el banco que lo consuma juzgará menos
// de lo que cree, en silencio). El banco contrasta esta lista contra el FUENTE.
module.exports.PATRONES = { TERMINALES, MARK_COMMENT_ONLY, MARK_NO_DECLARADO };
