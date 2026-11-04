'use strict';
// merge-mecanico — selección de los PRs `dirty` que el Watchdog resuelve con el
// merge mecánico DELANTE del Gate 0 (AP-142, central#418, ruling 2026-11-04,
// posición 21, punto 3 (v)).
//
// Con paralelismo (`serial-ok`, AP-121) el repo casi nunca está callado y el Gate
// 0 del scan dejaba sin dueño a un PR `dirty` (sin merge-ref ni checks). Delante
// del gate solo entra un PR sin contendiente vivo sobre el MISMO ítem, con la
// definición de AP-100 §1 (`claude-code.yml`, vuelo único): un run del Creator en
// `in_progress`/`queued` cuyo `display_title` es el título del PR o el del issue
// de su rama `claude/issue-N-*`, o cuya `head_branch` es la rama del PR.
//
// FAIL-CLOSED (al revés que el vuelo único, que deja pasar): si no se lee el
// issue de la rama o no se listan los runs, el PR NO es candidato delante del
// gate y queda para el camino de detrás. Un job ilegible de un `queued` cuenta
// como contendiente. Sin este módulo el scan no entrega candidatos delante del
// gate (el llamador lo hace explícito).
//
// Vive en `.cjs` porque el scan (`actions/github-script@v7`) carga con
// `require`; `adr-append-merge.mjs` lo reexporta (`esContendiente`). Banco:
// `scripts/check-adr-append-merge.mjs`.

// Mismo filtro de edad que el Gate 0 y el vuelo único (runs fantasma en `queued`).
const MAX_RUN_AGE_MS = 6 * 60 * 60 * 1000;
// Gracia de los cascarones del Gate 0 (`QUEUED_GRACE_MIN` de `watchdog.yml`).
const QUEUED_GRACE_MS = 2 * 60 * 1000;
const RAMA_ISSUE_RE = /^claude\/issue-(\d+)-/;

// Pura. ¿El run está ligado al mismo ítem? (AP-100 §1: título del PR, título del
// issue de la rama, o misma `head_branch`.) No mira estado ni workflow.
function esContendiente({ run, titles, branch }) {
  if (!run) return false;
  const ts = titles instanceof Set ? titles : new Set(titles || []);
  return ts.has(run.display_title) || (!!branch && run.head_branch === branch);
}

// ¿No hay contendiente vivo sobre el PR? ⇒ { libre, motivo }. `leerIssue(n)` ⇒
// título; `listarRuns(status)` ⇒ runs; `contarJobs(runId)` ⇒ total de jobs.
// Cualquier error de lectura ⇒ `libre: false` (fail-closed).
async function libreDeContendiente({ pr, creatorWf, leerIssue, listarRuns, contarJobs, ahoraMs = Date.now() }) {
  const branch = (pr && pr.head && pr.head.ref) || '';
  const titles = new Set([pr && pr.title].filter(Boolean));
  const m = branch.match(RAMA_ISSUE_RE);
  if (m) {
    try {
      const t = await leerIssue(Number(m[1]));
      if (t) titles.add(t);
    } catch (e) { return { libre: false, motivo: `issue #${m[1]} de la rama ilegible: ${e.message}` }; }
  }
  for (const status of ['in_progress', 'queued']) {
    let runs;
    try { runs = await listarRuns(status); }
    catch (e) { return { libre: false, motivo: `runs ${status} ilegibles: ${e.message}` }; }
    for (const r of runs || []) {
      if (r.name !== creatorWf) continue;
      const edad = ahoraMs - new Date(r.created_at).getTime();
      if (!(edad < MAX_RUN_AGE_MS)) continue;
      if (!esContendiente({ run: r, titles, branch })) continue;
      if (status === 'in_progress' || edad < QUEUED_GRACE_MS) return { libre: false, motivo: `run ${r.id} (${status}) sobre el ítem` };
      let jobs = 1;
      try { jobs = Number(await contarJobs(r.id)) || 0; } catch (e) { jobs = 1; }
      if (jobs > 0) return { libre: false, motivo: `run ${r.id} (queued, con jobs) sobre el ítem` };
    }
  }
  return { libre: true, motivo: null };
}

module.exports = { esContendiente, libreDeContendiente, MAX_RUN_AGE_MS, QUEUED_GRACE_MS };
