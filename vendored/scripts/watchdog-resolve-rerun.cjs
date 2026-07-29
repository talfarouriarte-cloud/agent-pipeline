'use strict';
// watchdog-resolve-rerun — post-step de terminal de architect-resolve que
// EJECUTA el único remedio que el propio resolver prescribe para el CI rojo
// no-atribuible: re-lanzar los jobs fallidos (AP-077, repesca finplan#1741 /
// aud. finplan#1743).
//
// QUÉ CIERRA. El 2026-07-29, sobre finplan#1741 (LGTM ya emitido, rojo por un
// guard wall-clock AJENO a los 9 ficheros del diff), TRES corridas de la capa
// de vigilancia diagnosticaron correctamente «flaky de contención; remedio =
// re-lanzar los jobs fallidos» y las TRES vieron DENEGADAS las dos formas del
// comando. La asimetría es medible en el árbol: el prompt del resolver ordena
// `gh api -X POST repos/<r>/actions/runs/<id>/rerun-failed-jobs`, y su
// `--allowedTools` trae `Bash(gh api repos/*)` — el prefijo se rompe con el
// `-X POST` intercalado, y `gh run rerun` no está en la lista. Autoridad de
// DIAGNÓSTICO sin autoridad de REMEDIO: clase 5 del pipeline-map (mandate/
// toolbox drift), mismo molde que el incidente #1120 (16 denegaciones de
// `gh issue create` ⇒ `human-needed` espurio). Coste medido: 3 h 26 min de
// cadena muerta, 3 corridas (2 REDUNDANTES) y 1 gate humano — la única
// intervención humana en vuelo en 6 unidades de trabajo consecutivas.
//
// POR QUÉ UN POST-STEP Y NO DOS ENTRADAS DE ALLOWLIST. Ampliar el allowlist
// del LLM le da el remedio pero deja su ejercicio en la prosa de una sesión
// que puede morir entre el diagnóstico y el comando (clase AP-011: el paso
// procedimental barato al final). El patrón de la casa es «materializar lo
// DECLARADO» (AP-064): el resolver declara el ruling con un marcador anclado y
// un paso determinista lo ejecuta al cerrar el job. Cero ampliación del
// allowlist, cero permiso nuevo (la escritura sale por el MISMO PAT que ya usa
// el post-step hermano de esta etapa) y el remedio deja de depender de que la
// sesión llegue viva al final.
//
// LO QUE ESTE BELT NO HACE. No decide nada: no clasifica el rojo, no juzga si
// el flaky es de contención. Eso lo rula el resolver leyendo el log. Aquí solo
// se verifica que lo declarado SIGUE describiendo el estado (el CI del head
// vigente está en rojo completado, el rojo NO es atribuible al diff) y se
// ejecuta la diferencia. Misma doctrina que AP-036: rular lo declarado, no
// juzgarlo.
//
// CAP Y CORTACIRCUITO. Cap **1 por PR y head SHA**, con marcador propio
// (`watchdog-resolve-rerun-materializado: <headSha>`) que NO consume el cap 2
// de `watchdog-turn-relaunch` ni el retry 1/1 de `watchdog-ci-retry` — misma
// separación que `watchdog-lgtm-rematerialize` (AP-024). Si el re-run del
// resolver también sale rojo, el tick siguiente vuelve a levantar
// `pr-ci-red-persistent`, el cap ya está agotado para ese head y el resolver
// aplica `stalled` + diagnóstico: el cortacircuito a `human-needed` queda
// INTACTO. El riesgo «enmascarar regresiones a base de re-runs» está acotado
// por esas tres cosas a la vez (cap 1, filtro no-atribuible, cortacircuito).
//
// POR QUÉ VIVE AQUÍ Y NO EN `watchdog.yml` (doctrina AP-068). La GitHub App de
// claude-code-action no tiene permiso `workflows` (ADR-020, medido cuatro
// veces), luego un agente NO puede pushear `.github/workflows/**`: un belt
// embebido allí queda secuestrado en un fichero que solo un humano re-aplica
// cada vez que hay que arreglarle una regex. La restricción es POR PATH y solo
// cubre `.github/workflows/`: este módulo, servido al workspace del consumidor
// por `graft-vendored` (AP-009, mismo camino que `adr-lint.mjs`), es pusheable
// por un agente, lo gatea el CI del central y lo ejecuta el banco de casos de
// `scripts/check-resolve-rerun.mjs`. En el workflow solo queda la invocación.
//
// Consecuencia operativa: TODO diff de este fichero despliega a los DOS
// consumidores en su siguiente run, sin gradualidad (zona de rigor `vendored/`).

// ── Vocabulario ANCLADO ──
// El ruling es la ÚNICA señal de identidad que este belt lee, y por eso va
// anclado a inicio de línea sobre el texto DESPOJADO de código: el login del
// token no distingue al resolver (comenta con el PAT del humano, igual que un
// rescate manual), y el marcador de CAPA lo llevan también los post-steps
// deterministas de esta misma capa. La forma de fallo real no es la
// suplantación sino la CITA —un Reviewer o un humano copiando el marcador en
// su prosa—, y contra eso el ancla + el despojo son la defensa (clase AP-063:
// EFECTUAR ≠ CITAR; en la ronda 2 de AP-064 un `body.includes(…)` casó una
// review que citaba el marcador entre backticks).
const RULING = /^ {0,3}<!--\s*watchdog-resolve-rerun\s*-->[ \t]*$/m;
// Las tres formas que Markdown admite para citar, despojadas antes de anclar:
// bloques cercados (``` o ~~~, de tres caracteres o más), spans en línea y —por
// la vía del ancla de 0-3 espacios— los bloques INDENTADOS de cuatro espacios.
const CERCA = /^[ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm;
const INLINE = /`+[^`\n]*`+/g;

const MARK = (sha) => `<!-- watchdog-resolve-rerun-materializado: ${sha} -->`;
const MAX = 3;            // tope duro de re-runs materializados por corrida
const MAX_PAGS = 10;      // tope de páginas del barrido fresco
const RESPALDO_MIN = 40;  // ventana de respaldo si `run_started_at` es ilegible

const despojar = (t) => String(t || '').replace(CERCA, '\n').replace(INLINE, ' ');

// Atribuibilidad recomputada CONTRA EL ESTADO, no leída de la prosa: mismo
// criterio que el fast-path #1268 del detector (todos los ficheros con
// anotación de fallo viven en el diff del PR ⇒ atribuible). Es el guard que
// mantiene este belt fuera de la vía `ping-creator`: el rojo atribuible se
// corrige, no se re-lanza.
//
// `legible: false` (sin anotaciones, o API caída) NO bloquea: el resolver ya
// bajó el log y ruló sobre él, y el fast-path del detector ya falla-open a
// retry en ese mismo caso. Lo que se exige es que NO conste lo contrario.
async function atribuible({ github, core, owner, repo, pull_number, run_id }) {
  try {
    const { data: jobs } = await github.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id, per_page: 50 });
    const anns = [];
    for (const j of (jobs.jobs || []).filter((j) => j.conclusion === 'failure')) {
      const { data: a } = await github.rest.checks.listAnnotations({ owner, repo, check_run_id: j.id, per_page: 100 }).catch(() => ({ data: [] }));
      anns.push(...a.filter((x) => x.annotation_level === 'failure' && x.path && x.path !== '.github'));
    }
    const ficheros = [...new Set(anns.map((a) => a.path))];
    if (!ficheros.length) return { atribuible: false, legible: false, ficheros };
    const prFiles = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number, per_page: 100 });
    const tocados = new Set(prFiles.map((f) => f.filename));
    return { atribuible: ficheros.every((f) => tocados.has(f)), legible: true, ficheros };
  } catch (e) {
    core.warning(`resolve-rerun: atribuibilidad de #${pull_number} ilegible (${e.message}) — se trata como NO atribuible, igual que el fast-path del detector.`);
    return { atribuible: false, legible: false, ficheros: [] };
  }
}

async function run({ github, context, core, skipLabels }) {
  const { owner, repo } = context.repo;
  const SKIP = String(skipLabels != null ? skipLabels : (process.env.IN_SKIP_LABELS || ''))
    .split(',').map((s) => s.trim()).filter(Boolean);
  const CI_WF = process.env.IN_CI_WF || '';
  const CAPA = `<!-- watchdog-capa: ${context.eventName} -->`;

  // Ventana = vida del job. El `since` de `listCommentsForRepo` filtra por
  // `updated_at`, así que una EDICIÓN vieja entra: por eso el corte real se
  // hace después, contra `created_at`.
  let since = null;
  try { since = (await github.rest.actions.getWorkflowRun({ owner, repo, run_id: context.runId })).data.run_started_at; }
  catch (e) { core.warning(`resolve-rerun: run_started_at ilegible (${e.message}) — ventana de respaldo de ${RESPALDO_MIN} min.`); }
  if (!since) since = new Date(Date.now() - RESPALDO_MIN * 60 * 1000).toISOString();

  // Barrido fresco. El fallo del barrido deja el belt MUDO, y que lo esté tiene
  // que verse: es la clase entera que este belt cierra, un piso más arriba.
  const candidatos = new Map();   // nº de PR → comentario de ruling
  const vistos = new Set();       // dedupe por id (la paginación puede repetir en el corte de página, AP-076)
  let pags = 0;
  try {
    for await (const page of github.paginate.iterator(github.rest.issues.listCommentsForRepo, {
      owner, repo, since, per_page: 100, sort: 'created', direction: 'asc',
    })) {
      for (const c of page.data || []) {
        if (vistos.has(c.id)) continue;
        vistos.add(c.id);
        if ((c.created_at || '') < since) continue;              // edición vieja: entró por `updated_at`
        if (!RULING.test(despojar(c.body))) continue;
        const n = Number(String(c.issue_url || '').split('/').pop());
        if (!n || candidatos.has(n)) continue;
        candidatos.set(n, c);
      }
      if (++pags >= MAX_PAGS) { core.warning(`resolve-rerun: barrido fresco TRUNCADO en ${MAX_PAGS} páginas — un ruling más antiguo de esta ventana puede haberse quedado fuera.`); break; }
    }
  } catch (e) {
    core.warning(`resolve-rerun: barrido fresco ilegible (${e.message}) — belt MUDO en esta corrida; ningún ruling se materializa.`);
    return;
  }
  if (!candidatos.size) { core.info('resolve-rerun: ningún ruling declarado en la ventana — nada que materializar.'); return; }

  let hechos = 0;
  for (const [n, decl] of candidatos) {
    if (hechos >= MAX) { core.warning(`resolve-rerun: tope MAX=${MAX} alcanzado en esta corrida — el resto de rulings se recogen en el tick siguiente.`); break; }

    let pr;
    try { pr = (await github.rest.pulls.get({ owner, repo, pull_number: n })).data; }
    catch (e) { core.warning(`resolve-rerun: #${n} no es un PR legible (${e.message}) — el ruling de re-run solo aplica a PRs; sin actuar.`); continue; }
    if (pr.state !== 'open') { core.notice(`resolve-rerun: #${n} ya no está abierto — nada que re-lanzar.`); continue; }

    const labels = (pr.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
    const excl = labels.filter((l) => SKIP.includes(l));
    if (excl.length) { core.notice(`resolve-rerun: #${n} lleva label de exclusión (${excl.join(', ')}) — kill-switch, sin actuar.`); continue; }

    const head = pr.head.sha;
    let cs = [];
    try { cs = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: n, per_page: 100 }); }
    catch (e) { core.warning(`resolve-rerun: comentarios de #${n} ilegibles (${e.message}) — fail-closed: sin poder leer el cap, no se re-lanza.`); continue; }
    // Cap 1 por PR y head SHA. Se cuenta sobre TODO el historial (no sobre la
    // ventana): el cap es por head, y un head vive más que un job.
    if (cs.some((c) => String(c.body || '').includes(MARK(head)))) {
      core.notice(`resolve-rerun: #${n} — cap 1 agotado para el head ${head.slice(0, 7)}; el cortacircuito (stalled ⇒ human-needed) queda intacto.`);
      continue;
    }

    if (!CI_WF) { core.warning('resolve-rerun: `IN_CI_WF` vacío — sin el nombre del workflow de CI no se puede identificar el run; fail-closed.'); continue; }
    let ci = null;
    try {
      const { data: runs } = await github.rest.actions.listWorkflowRunsForRepo({ owner, repo, head_sha: head, per_page: 20 });
      ci = (runs.workflow_runs || []).filter((r) => r.name === CI_WF)
        .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))[0] || null;
    } catch (e) { core.warning(`resolve-rerun: runs de CI de #${n} ilegibles (${e.message}) — fail-closed.`); continue; }
    // Frescura POR ESTADO: el ruling se materializa solo si el head VIGENTE
    // sigue en rojo completado. Un ruling viejo, o uno citado en prosa sobre un
    // PR ya verde o con push nuevo, es inocuo por construcción.
    if (!ci || ci.status !== 'completed' || ci.conclusion !== 'failure') {
      core.notice(`resolve-rerun: #${n} — el CI del head vigente no está en rojo completado (${ci ? `${ci.status}/${ci.conclusion}` : 'sin run'}); el ruling ya no describe el estado, sin actuar.`);
      continue;
    }

    const attr = await atribuible({ github, core, owner, repo, pull_number: n, run_id: ci.id });
    if (attr.atribuible) {
      core.warning(`resolve-rerun: #${n} — rojo ATRIBUIBLE al diff (${attr.ficheros.join(', ')}); el remedio de esa vía es \`ping-creator\`, no el re-run. Sin actuar.`);
      continue;
    }

    // Se ejecuta ANTES de afirmar nada. Tragar el fallo y comentar igualmente
    // dejaría un rastro falso al Auditor y quemaría el cap sobre un re-run que
    // no ocurrió, que es la clase exacta que este belt existe para cerrar.
    try { await github.rest.actions.reRunWorkflowFailedJobs({ owner, repo, run_id: ci.id }); }
    catch (e) {
      core.warning(`resolve-rerun: #${n} — \`rerun-failed-jobs\` sobre el run ${ci.id} falló (${e.message}); NO se afirma el re-run y NO se deja marcador: el cap sigue libre para el tick siguiente.`);
      continue;
    }

    await github.rest.issues.createComment({
      owner, repo, issue_number: n,
      body: `**watchdog · resolve-rerun (AP-077)**: el resolver rulló «rojo NO atribuible al diff — flaky de contención, re-lanzar» (${decl.html_url}) y ese ruling se ha MATERIALIZADO: re-lanzados los jobs fallidos del run ${ci.id} sobre el head \`${head.slice(0, 7)}\`.\n\n`
        + `Cap **1 por PR y head SHA**, con contador propio: no consume el retry 1/1 del detector (\`watchdog-ci-retry\`) ni el cap 2 del dispatcher de turno. Si el CI vuelve a rojo sobre este mismo head, el cap queda agotado y el cortacircuito de siempre (\`stalled\` + diagnóstico ⇒ \`human-needed\`) sigue intacto.\n\n`
        + `${attr.legible ? `Atribuibilidad recomputada contra el estado: ${attr.ficheros.length} fichero(s) con fallo anotado, no todos tocados por el diff.` : 'Atribuibilidad no recomputable (sin anotaciones legibles): mismo fail-open que el fast-path del detector.'}\n\n`
        + `${MARK(head)}\n${CAPA}`,
    });
    hechos++;
    core.warning(`resolve-rerun: #${n} — ruling materializado (run ${ci.id} re-lanzado sobre ${head.slice(0, 7)}).`);
  }
}

module.exports = run;
module.exports.atribuible = atribuible;
module.exports.despojar = despojar;
// Vocabulario de decisión COMPLETO — el banco lo contrasta contra los
// `const X = /…/` del FUENTE y se pone rojo si divergen (misma aserción que
// `check-resolve-detection` sobre AP-064: un export que promete «los patrones»
// y no los trae todos no se cae, se PUDRE, y el banco que lo consuma juzgará
// menos de lo que cree).
module.exports.PATRONES = { RULING, CERCA, INLINE };
module.exports.MARK = MARK;
