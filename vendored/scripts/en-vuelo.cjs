'use strict';
// en-vuelo — Gate 0 POR ÍTEM del scan del Watchdog (AP-149, central#443, ruling
// corregido 2026-11-10, posición 28, pieza 1).
//
// El Gate 0 era global: bastaba un run vivo del pipeline sobre CUALQUIER ítem para
// que el scan no evaluara nada (asesoramiento, 2026-11-10: 40 de 40 runs `success`
// del Watchdog salieron por el gate; el draft de asesoramiento#3758 quedó 27 min
// parado sin que el backstop de AP-047 llegara a verlo). Este módulo calcula el
// CONJUNTO de ítems (issues y PRs) con un run vivo; el scan salta solo esos.
//
// Identidad run ↔ ítem: la de `check_flight` (`claude-code.yml`, AP-100 §1) y
// `merge-mecanico.cjs`. Un run vale para un ítem si (i) el número está en
// `pull_requests[]`; (ii) comparte `head_branch` con el PR; (iii) su rama es
// `claude/issue-N-*` (⇒ N y el PR de esa rama); (iv) su `display_title` es el
// título del PR o del issue. Un PR y el issue de su rama `claude/issue-N-*` van
// siempre juntos.
//
// Run sin ítem identificable: del Creator o del Reviewer ⇒ `global: true` (gate
// global como hoy: no se arriesga un `markReady` ni un relanzamiento a mitad de
// una sesión que no sabemos ubicar); de otro workflow (p. ej. `Epic Merge` por
// `workflow_run`) ⇒ no cierra el gate para nadie (anti-carrera: `LIVENESS_MIN`).
// Lectura de runs o de issues caída ⇒ `global: true` (fail-closed, statu quo).
//
// Vive en `.cjs` porque el scan (`actions/github-script@v7`) carga con `require`
// desde el checkout sparse `.cola-central`. Banco: `scripts/check-en-vuelo.mjs`
// (módulo) y `scripts/check-watchdog-gate0.mjs` (integración).

const RAMA_ISSUE_RE = /^claude\/issue-(\d+)-/;
// Mismos filtros que el Gate 0 de siempre (runs fantasma y cascarones, AP-081).
const MAX_RUN_AGE_H = 6;
const QUEUED_GRACE_MIN = 2;
// Tope de páginas de runs por estado: la lista va por creación descendente y se
// corta en `MAX_RUN_AGE_H`; si aun así se llenan todas, el conjunto podría quedar
// truncado ⇒ fail-closed (`global: true`).
const MAX_PAGINAS = 5;
const POR_PAGINA = 100;

const issueDeRama = ref => {
  const m = String(ref || '').match(RAMA_ISSUE_RE);
  return m ? Number(m[1]) : null;
};

// Pura. `runs`: runs VIVOS ya filtrados (workflow del pipeline, edad, cascarones).
// `prs`: [{ number, title, head: { ref } }]; `issues`: [{ number, title }];
// `workflows`: { creator, reviewer } (nombres de workflow).
// ⇒ { items: Set<number>, global, motivo, creatorVivo }.
function itemsEnVuelo(runs, { prs = [], issues = [], workflows = {} } = {}) {
  const items = new Set();
  const creatorVivo = (runs || []).some(r => r && r.name === workflows.creator);
  const prsDeIssue = n => prs.filter(p => issueDeRama(p.head && p.head.ref) === n);
  const addPr = p => { items.add(p.number); const n = issueDeRama(p.head && p.head.ref); if (n) items.add(n); };
  const addIssue = n => { items.add(n); for (const p of prsDeIssue(n)) items.add(p.number); };
  for (const r of runs || []) {
    if (!r) continue;
    let hit = false;
    for (const x of r.pull_requests || []) {
      const num = x && x.number;
      if (!num) continue;
      const p = prs.find(q => q.number === num);
      if (p) addPr(p); else items.add(num);
      hit = true;
    }
    if (r.head_branch) {
      for (const p of prs) if (p.head && p.head.ref === r.head_branch) { addPr(p); hit = true; }
      const n = issueDeRama(r.head_branch);
      if (n) { addIssue(n); hit = true; }
    }
    if (r.display_title) {
      for (const p of prs) if (p.title === r.display_title) { addPr(p); hit = true; }
      for (const i of issues) if (i.title === r.display_title) { addIssue(i.number); hit = true; }
    }
    if (!hit && (r.name === workflows.creator || r.name === workflows.reviewer)) {
      return { items, global: true, motivo: `run ${r.id} de «${r.name}» sin ítem identificable`, creatorVivo };
    }
  }
  return { items, global: false, motivo: null, creatorVivo };
}

// Lee runs vivos e issues y calcula el conjunto. `pipeline`: nombres de workflow
// del pipeline; `prs`: los PRs abiertos que ya leyó el scan. Nunca lanza.
async function enVueloDelRepo({ github, O, pipeline = [], workflows = {}, prs = [], ahoraMs = Date.now(), warn = () => {} }) {
  const fallo = motivo => { warn(`Gate 0 por ítem: ${motivo} — gate global (fail-closed, statu quo).`); return { items: new Set(), global: true, motivo, creatorVivo: true }; };
  const ageMin = iso => (ahoraMs - new Date(iso).getTime()) / 60000;
  const vivos = [];
  for (const status of ['in_progress', 'queued']) {
    let candidatos = [];
    try {
      let completa = false;
      for (let page = 1; page <= MAX_PAGINAS; page++) {
        const { data } = await github.rest.actions.listWorkflowRunsForRepo({ ...O, status, per_page: POR_PAGINA, page });
        const rs = (data && data.workflow_runs) || [];
        candidatos.push(...rs.filter(r => pipeline.includes(r.name) && ageMin(r.created_at) < MAX_RUN_AGE_H * 60));
        if (rs.length < POR_PAGINA || rs.some(r => !(ageMin(r.created_at) < MAX_RUN_AGE_H * 60))) { completa = true; break; }
      }
      if (!completa) return fallo(`más de ${MAX_PAGINAS * POR_PAGINA} runs \`${status}\` en ${MAX_RUN_AGE_H} h (lista posiblemente truncada)`);
    } catch (e) { return fallo(`runs \`${status}\` ilegibles (${e.message})`); }
    if (status === 'in_progress') { vivos.push(...candidatos); continue; }
    for (const r of candidatos) {
      if (ageMin(r.created_at) < QUEUED_GRACE_MIN) { vivos.push(r); continue; }
      let jobs = 1;   // ilegible ⇒ cuenta como vivo
      try { jobs = Number((await github.rest.actions.listJobsForWorkflowRun({ ...O, run_id: r.id, per_page: 1 })).data.total_count) || 0; }
      catch (e) { jobs = 1; }
      if (jobs > 0) vivos.push(r);
    }
  }
  if (!vivos.length) return { items: new Set(), global: false, motivo: null, creatorVivo: false };
  let issues;
  try {
    issues = (await github.paginate(github.rest.issues.listForRepo, { ...O, state: 'open', per_page: 100 }))
      .filter(i => !i.pull_request).map(i => ({ number: i.number, title: i.title }));
  } catch (e) { return fallo(`issues abiertos ilegibles (${e.message})`); }
  // Issue de la rama de un PR de agente fuera del listado (cerrado, p. ej.): su
  // título se lee aparte. 404 ⇒ no hay título que casar; otro error ⇒ el PR y su
  // issue cuentan como en vuelo (fail-closed POR ÍTEM).
  const forzados = new Set();
  const conocidos = new Set(issues.map(i => i.number));
  for (const p of prs) {
    const n = issueDeRama(p.head && p.head.ref);
    if (!n || conocidos.has(n)) continue;
    conocidos.add(n);
    try {
      const { data } = await github.rest.issues.get({ ...O, issue_number: n });
      if (data && data.title) issues.push({ number: n, title: data.title });
    } catch (e) {
      if (e && e.status === 404) continue;
      forzados.add(n); forzados.add(p.number);
      warn(`Gate 0 por ítem: issue #${n} de la rama de PR #${p.number} ilegible (${e.message}) — el par cuenta como en vuelo.`);
    }
  }
  const r = itemsEnVuelo(vivos, { prs, issues, workflows });
  for (const n of forzados) r.items.add(n);
  return r;
}

module.exports = { itemsEnVuelo, enVueloDelRepo, issueDeRama, MAX_RUN_AGE_H, QUEUED_GRACE_MIN };
