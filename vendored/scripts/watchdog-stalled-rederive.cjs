'use strict';
// watchdog-stalled-rederive — firma determinista de la etapa `detect` del
// reusable `watchdog.yml` que RE-DERIVA POR ESTADO los `stalled` cuyo run del
// evento `labeled` murió cancelado (AP-086; cuerpo pusheable por doctrina
// AP-068, stub en `docs/patches/AP-086-watchdog-stalled-rederive.patch`).
//
// QUÉ CIERRA. La retoma de un `stalled` dependía de que el run de `watchdog.yml`
// disparado por su evento `issues: labeled` SOBREVIVIERA. Si ese run muere
// `cancelled` (colisión de concurrencia en ventana de tráfico) NINGÚN barrido
// posterior re-derivaba desde estado el `stalled` pendiente de ruling: el issue
// quedaba huérfano indefinidamente aunque el Watchdog corriera en verde cada
// tick. Transición single-shot por evento sin re-derivación por estado — la
// MISMA clase que motivó `open-review-failsafe` (AP-016), la re-materialización
// de `lgtm` (AP-024) y `reviewer-no-verdict-relaunch` (AP-025), esta vez en la
// arista `labeled: stalled` → architect-resolve. Evidencia: finplan#1810, run
// del `labeled` cancelado a los segundos, ≥12 runs `success` del Watchdog
// después y CERO ruling; >3 h huérfano frente a los 13 min de un `stalled`
// cuyo run de evento sobrevivió.
//
// LA FIRMA. Un issue/PR `open` con label `stalled` + NINGÚN Δestado del resolver
// posterior al último `labeled: stalled` (ni comentario de engagement de
// architect-resolve ni retirada del label) + edad del `labeled` > 1 tick
// (~REDERIVE_MIN, margen para que el camino por evento corra primero) ⇒ se
// re-encamina a architect-resolve re-disparando el `labeled` (relabel `stalled`
// remove+add con el PAT — un `labeled` del GITHUB_TOKEN no dispara el workflow
// del consumidor, anti-loop de GitHub, mismo motivo que AP-024/AP-016/AP-025).
//
// POR QUÉ RELABEL Y NO INYECTAR ANOMALÍA. La firma re-crea EXACTAMENTE el evento
// que murió («como si el `labeled` acabara de llegar», cuerpo del issue #194):
// re-fire de `labeled: stalled` ⇒ nuevo run de watchdog ⇒ su detect encamina el
// item a architect-resolve por el camino de evento ya existente, sin vocabulario
// nuevo obligatorio en el prompt del resolver. Es el patrón de AP-024 (relabel
// `lgtm` por PAT) y AP-016 (relabel `needs-review` por PAT) trasladado a esta
// arista.
//
// POR QUÉ NO SKIP_LABELS COMPLETO. `stalled` es la señal que DISPARA
// architect-resolve (cabecera de `watchdog.yml`: «`stalled` YA NO excluye … es
// la señal que dispara architect-resolve»), así que un `stalled` sobre un issue
// `auditoria`/`process-proposal` —que el dispatcher de turno SÍ excluye— sigue
// siendo trabajo legítimo del resolver: excluirlo aquí dejaría huérfano
// justamente el caso medido (finplan#1810 es una auditoría). La exclusión de
// esta firma es SOLO el kill-switch duro compartido: `pause-agents` (parada
// global) y `human-needed` (ya escalado — no se re-dispara sobre lo que un
// humano posee).
//
// DEDUPE SIN BUCLE. El relabel mueve el `labeled` a «ahora», así que la firma
// no se auto-apaga (a diferencia de AP-024, cuya acción hace presente el label
// ausente). El bucle rápido lo corta el gate de edad —tras el nudge, el nuevo
// `labeled` es fresco y la firma calla REDERIVE_MIN minutos—; el bucle lento lo
// corta el marcador propio: tras UN nudge sin ruling, cuando el marcador propio
// envejece más de ESCALATE_MIN sin que aparezca un Δestado del resolver, se
// ESCALA a `human-needed` (architect-resolve, que vive DENTRO del sistema, no
// respondió — clase watchdog-roto/AP-025) con marcador de persistencia que
// deduplica el escalado. Nunca más de un nudge + un escalado por episodio.
//
// IDEMPOTENTE Y FAIL-CLOSED. Todo Δestado sale por el PAT; leer el estado real
// antes de actuar; ante API ilegible NO se actúa y se anuncia (nunca mudo).
//
// POR QUÉ VIVE AQUÍ Y NO EN `watchdog.yml` (AP-068). La GitHub App de
// claude-code-action no tiene permiso `workflows` (ADR-020): un agente NO puede
// pushear `.github/workflows/**`. Este módulo, servido al workspace del
// consumidor por `graft-vendored` (AP-009), SÍ es pusheable, lo gatea el CI del
// central y lo ejecuta `scripts/check-stalled-rederive.mjs`; en el workflow solo
// queda el stub que lo invoca (parche pendiente de aplicación humana).
//
// Zona de rigor `vendored/`: TODO diff aquí despliega a los DOS consumidores en
// su siguiente run, sin gradualidad.

const REDERIVE_MARK = '<!-- stalled-rederivado-por-estado -->';
const PERSIST_MARK = '<!-- stalled-rederive-persistent -->';
const REARM_MARK = '<!-- watchdog-rearm -->';
const AUTOLAUNCH_MARK = '<!-- epic-auto-launch -->';
// Marcador de CAPA del watchdog (cualquier eventName): lo llevan todos los
// comentarios que emite la capa de vigilancia, incluido el ruling de
// architect-resolve. Su presencia POSTERIOR al `labeled` es la firma positiva
// de «el camino por evento corrió y engancharon» — jamás substring: en línea
// propia y sobre el cuerpo despojado (EFECTUAR ≠ CITAR, AP-063).
const CAPA_MARK = /^[ \t]*<!--\s*watchdog-capa:[^>]*-->[ \t]*$/m;
// `@claude` a inicio de línea = re-arm materializado (el resolver re-armó por
// evento). Mismo anclaje que el filtro de `claude-code.yml` (jamás mid-line).
const CLAUDE_ARM = /^[ \t]*@claude\b/m;

const REDERIVE_MIN = 20;    // edad mínima del `labeled` antes de nudgear (~1 tick)
const ESCALATE_MIN = 40;    // edad del nudge propio sin ruling antes de escalar a humano
const MAX = 5;              // tope duro de issues re-derivados por corrida
// Kill-switch duro compartido: NO es skip_labels (ver cabecera). `stalled` es
// la señal de architect-resolve; solo se respetan las paradas de verdad.
const HARD_SKIP = ['pause-agents', 'human-needed'];

const ageMin = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;
const nombresLabel = (arr) => (arr || []).map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean);
// Un comentario es NUESTRO si porta cualquiera de los dos marcadores de esta
// firma: no cuenta como «Δestado del resolver» (si no, nuestro propio nudge se
// leería como ruling y la firma se auto-apagaría tras una sola corrida).
const esNuestro = (body) => body.includes(REDERIVE_MARK) || body.includes(PERSIST_MARK);
// Despojo mínimo para el anclaje de marcadores: fuera bloques cercados y spans
// en línea, para que un marcador CITADO no cuente como emitido (AP-063).
const despojar = (raw) => (raw || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');

// ── Derivación PURA: (estado del issue) → decisión ───────────────────────────
// Separada del runtime (doctrina AP-068) para que el banco ejecute ESTA función
// y no una copia. `item` = { labeledAt, comments: [{ body, createdAt }] }.
//   labeledAt : ISO del último `labeled: stalled` (o null si no se pudo leer).
//   comments  : comentarios del issue (body + createdAt).
// Devuelve { accion, motivo } donde `accion` ∈ 'nudge' | 'escalate' | 'skip'.
function decidir(item) {
  const { labeledAt, comments } = item;
  // Sin ancla de `labeled` no hay firma: fail-closed (no re-derivar a ciegas).
  if (!labeledAt) return { accion: 'skip', motivo: 'sin evento `labeled: stalled` legible — fail-closed, no se re-deriva a ciegas' };

  const lts = new Date(labeledAt).getTime();
  const posteriores = comments.filter((c) => c.createdAt && new Date(c.createdAt).getTime() > lts);
  const nuestros = posteriores.filter((c) => esNuestro(c.body || ''));
  // Δestado del resolver POSTERIOR al `labeled`: un comentario NO nuestro de la
  // capa (marcador de capa en línea propia) o un re-arm materializado
  // (`@claude`/`watchdog-rearm`/`epic-auto-launch`). Si existe, el camino por
  // evento corrió y engancharon: nada que re-derivar.
  const ruling = posteriores.some((c) => {
    if (esNuestro(c.body || '')) return false;
    const d = despojar(c.body || '');
    return CAPA_MARK.test(d) || CLAUDE_ARM.test(c.body || '') || d.includes(REARM_MARK) || d.includes(AUTOLAUNCH_MARK);
  });
  if (ruling) return { accion: 'skip', motivo: 'hay Δestado del resolver posterior al `labeled` — el camino por evento corrió, nada que re-derivar' };

  // Ya escalado a humano: terminal, no se re-toca (dedupe del escalado).
  if (comments.some((c) => (c.body || '').includes(PERSIST_MARK))) {
    return { accion: 'skip', motivo: 'ya escalado a `human-needed` por persistencia — terminal' };
  }

  // Gate de edad: margen para que el camino por evento corra primero.
  if (ageMin(labeledAt) <= REDERIVE_MIN) {
    return { accion: 'skip', motivo: `el \`labeled\` es fresco (${ageMin(labeledAt).toFixed(1)} min ≤ ${REDERIVE_MIN}) — se deja correr el camino por evento` };
  }

  const nudgePrevio = nuestros.length
    ? nuestros.reduce((a, c) => (new Date(c.createdAt).getTime() > new Date(a.createdAt).getTime() ? c : a))
    : null;
  if (!nudgePrevio) {
    return { accion: 'nudge', motivo: `\`stalled\` sin ruling del resolver y \`labeled\` de hace ${ageMin(labeledAt).toFixed(0)} min — se re-dispara el camino por evento (relabel por PAT)` };
  }
  // Ya nudgeamos y SIGUE sin ruling: si el nudge propio envejeció más de
  // ESCALATE_MIN, architect-resolve (que vive DENTRO del sistema) no respondió
  // ⇒ escalar a humano. Si no, seguir esperando (sin re-nudgear).
  if (ageMin(nudgePrevio.createdAt) > ESCALATE_MIN) {
    return { accion: 'escalate', motivo: `re-derivado hace ${ageMin(nudgePrevio.createdAt).toFixed(0)} min y sigue sin ruling — architect-resolve no responde; escalado a \`human-needed\`` };
  }
  return { accion: 'skip', motivo: `re-derivado hace ${ageMin(nudgePrevio.createdAt).toFixed(1)} min — esperando el ruling del run re-disparado` };
}

// ── Runtime: enumera `stalled`, lee estado real, materializa la diferencia ────
// `github` DEBE estar autenticado con el PAT (`REVIEWER_GITHUB_TOKEN`): el
// relabel re-dispara `labeled` en el consumidor y un `labeled` del GITHUB_TOKEN
// no lo haría (anti-loop de GitHub). El stub de `watchdog.yml` pasa
// `github-token: ${{ secrets.REVIEWER_GITHUB_TOKEN }}`.
async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const CAPA = `<!-- watchdog-capa: ${context.eventName} -->`;

  let stalled = [];
  try {
    stalled = await github.paginate(github.rest.issues.listForRepo, {
      owner, repo, state: 'open', labels: 'stalled', per_page: 100,
    });
  } catch (e) {
    core.warning(`stalled-rederive: no se pudo listar issues \`stalled\` (${e.message}) — sin actuar.`);
    return;
  }
  if (!stalled.length) { core.info('stalled-rederive: sin issues `stalled` abiertos — nada que verificar.'); return; }

  let hechos = 0;
  for (const it of stalled) {
    if (hechos >= MAX) { core.warning(`stalled-rederive: tope de ${MAX} re-derivaciones por corrida alcanzado — el resto lo recoge el tick siguiente.`); break; }
    const n = it.number;
    const labels = nombresLabel(it.labels);
    const excl = labels.filter((l) => HARD_SKIP.includes(l));
    if (excl.length) { core.info(`stalled-rederive: #${n} lleva kill-switch duro (${excl.join(', ')}) — sin actuar.`); continue; }

    // Último `labeled: stalled` de la timeline (el evento cuyo run pudo morir).
    let labeledAt = null;
    try {
      const ev = await github.paginate(github.rest.issues.listEventsForTimeline, { owner, repo, issue_number: n, per_page: 100 });
      for (const e of ev) {
        if (e.event === 'labeled' && e.label && e.label.name === 'stalled' && e.created_at) {
          if (!labeledAt || new Date(e.created_at).getTime() > new Date(labeledAt).getTime()) labeledAt = e.created_at;
        }
      }
    } catch (e) {
      core.warning(`stalled-rederive: timeline de #${n} ilegible (${e.message}) — fail-closed, sin actuar.`);
      continue;
    }

    let comments = [];
    try {
      const cs = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: n, per_page: 100 });
      comments = cs.map((c) => ({ body: c.body || '', createdAt: c.created_at }));
    } catch (e) {
      core.warning(`stalled-rederive: comentarios de #${n} ilegibles (${e.message}) — sin actuar.`);
      continue;
    }

    const { accion, motivo } = decidir({ labeledAt, comments });
    if (accion === 'skip') { core.info(`stalled-rederive: #${n} — ${motivo}.`); continue; }

    if (accion === 'escalate') {
      try {
        await github.rest.issues.addLabels({ owner, repo, issue_number: n, labels: ['human-needed'] });
        await github.rest.issues.createComment({ owner, repo, issue_number: n,
          body: `**watchdog · stalled-rederive**: ${motivo}. El \`stalled\` se re-derivó por estado y architect-resolve —que vive DENTRO del sistema de vigilancia— no dejó ruling; se escala a decisión humana (clase watchdog-roto, misma doctrina que \`reviewer-no-verdict-persistent\`/AP-025).\n\n${PERSIST_MARK}\n${CAPA}` });
        hechos++;
        core.warning(`stalled-rederive: #${n} escalado a \`human-needed\` — ${motivo}.`);
      } catch (e) {
        core.warning(`stalled-rederive: #${n} — el escalado a \`human-needed\` falló (${e.message}); NO se afirma. Lo recoge el tick siguiente.`);
      }
      continue;
    }

    // accion === 'nudge': relabel `stalled` remove+add con el PAT ⇒ re-fire de
    // `labeled: stalled` en el consumidor. El comentario del marcador se publica
    // DESPUÉS del relabel: así queda posterior al nuevo `labeled` y no se lee a
    // sí mismo como el ruling que espera. Fail-closed en cada punto.
    try {
      try { await github.rest.issues.removeLabel({ owner, repo, issue_number: n, name: 'stalled' }); }
      catch (e) { if (e.status !== 404) throw e; }
      await github.rest.issues.addLabels({ owner, repo, issue_number: n, labels: ['stalled'] });
    } catch (e) {
      core.warning(`stalled-rederive: #${n} — el relabel de \`stalled\` falló (${e.message}); NO se afirma la re-derivación. Lo recoge el tick siguiente.`);
      continue;
    }
    try {
      await github.rest.issues.createComment({ owner, repo, issue_number: n,
        body: `**watchdog · stalled-rederive**: ${motivo}. Re-derivación por ESTADO de un \`stalled\` cuyo run del evento \`labeled\` no dejó rastro de ruling (AP-086): se re-dispara el camino por evento exactamente como si el \`labeled\` acabara de llegar. Solo se re-encamina al resolver —este belt no decide nada nuevo (doctrina AP-036: rular lo declarado, no juzgarlo)—; si el run re-disparado tampoco deja ruling, el escalado a humano es automático.\n\n${REDERIVE_MARK}\n${CAPA}` });
    } catch (e) {
      core.warning(`stalled-rederive: #${n} — relabel hecho pero el comentario del marcador falló (${e.message}); el dedupe se apoya en el marcador, el tick siguiente puede re-nudgear.`);
    }
    hechos++;
    core.warning(`stalled-rederive: #${n} re-derivado por estado — ${motivo}.`);
  }
}

module.exports = run;
module.exports.decidir = decidir;
module.exports.REDERIVE_MARK = REDERIVE_MARK;
module.exports.PERSIST_MARK = PERSIST_MARK;
module.exports.REDERIVE_MIN = REDERIVE_MIN;
module.exports.ESCALATE_MIN = ESCALATE_MIN;
