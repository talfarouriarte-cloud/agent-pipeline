'use strict';
// gate-head — el gate de merge se ata al HEAD: el LGTM vale para el SHA que el
// Reviewer revisó y el CI para el SHA sobre el que corrió (AP-139, central#408,
// ruling 2026-11-04, posición 18).
//
// Antes, `epic-merge` aceptaba un `workflow_run` del CI `success` sin comparar su
// `head_sha` con el head vivo del PR, resucitaba por comentarios el último LGTM
// aunque hubiera commits posteriores y mergeaba sin fijar el SHA: un push durante
// el CI del head revisado mergeaba código sin CI ni review (hueco 1 de #408).
//
// Funciones PURAS y síncronas, sin I/O: el llamador lee de la API y pasa los datos.
// Llamadores:
//   · `reviewer.yml` — post-step que materializa `lgtm`: escribe el marcador
//     `reviewer-lgtm-sha` (literal propio, una sola vez; el banco afirma que su
//     forma casa con `MARCA_SHA_RE`).
//   · `epic-merge.yml` — GATE 1 (`ciOkPorRun`) y GATE 2 (`lgtmVigente`), desde el
//     checkout sparse `.epic-merge-central/vendored/scripts/`; fail-closed.
//   · `watchdog.yml` — belt AP-024 (`decidirAp024`, `remats`), rama del Reviewer por
//     head nuevo y `lgtm` sin CI, desde `.cola-central/vendored/scripts/`; sin
//     módulo, AP-024 en modo previo.
//
// POR QUÉ VIVE AQUÍ (AP-068): el JS embebido en `.github/workflows/**` no lo
// ejecuta un banco; este sí. Banco: `scripts/check-gate-head.mjs`.

// Marcador del SHA revisado: línea propia, SHA de 40. Una cita en prosa (no en
// línea propia) no cuenta (clase PR #1133 / AP-063).
const MARCA_SHA_RE = /^<!-- reviewer-lgtm-sha: ([0-9a-f]{40}) -->$/m;
const marcaLgtmSha = sha => `<!-- reviewer-lgtm-sha: ${sha} -->`;
// Re-materialización de `lgtm` (AP-024). Forma con SHA (AP-139: cap 1 por head) y
// forma vieja sin SHA (cap 1 por PR, anterior a AP-139).
const REMAT_SHA_RE = /^<!-- watchdog-lgtm-rematerialize: ([0-9a-f]{7,40}) -->$/gm;
const REMAT_VIEJA = '<!-- watchdog-lgtm-rematerialize -->';
// Veredicto del Reviewer: primera palabra del comentario (cabecera ADR-063).
const VEREDICTO_RE = /^\s*(LGTM|REVIEW|NITS)\b/;
// Committer de los merges que crea GitHub en `pulls.updateBranch` / «Update branch».
const WEB_FLOW = 'web-flow';

// `<sha40>` del ÚLTIMO comentario de `loginPat` con el marcador en línea propia, o null.
function shaRevisado(comentarios, loginPat) {
  let sha = null;
  for (const c of comentarios || []) {
    if (!c || !c.user || c.user.login !== loginPat) continue;
    const m = MARCA_SHA_RE.exec(c.body || '');
    if (m) sha = m[1];
  }
  return sha;
}

// Primera palabra del último veredicto de `loginReviewer` ('LGTM'|'REVIEW'|'NITS'), o null.
function ultimoVeredicto(comentarios, loginReviewer) {
  let v = null;
  for (const c of comentarios || []) {
    if (!c || !c.user || c.user.login !== loginReviewer) continue;
    const m = VEREDICTO_RE.exec(c.body || '');
    if (m) v = m[1];
  }
  return v;
}

// Mapa `sha → { parents: [sha…], committerLogin }` desde `pulls.listCommits`.
function mapaCommits(listCommits) {
  const m = new Map();
  for (const c of listCommits || []) {
    if (!c || !c.sha) continue;
    m.set(c.sha, {
      parents: (c.parents || []).map(p => (typeof p === 'string' ? p : p && p.sha)).filter(Boolean),
      committerLogin: (c.committer && c.committer.login) || null,
    });
  }
  return m;
}

// Merge de la base creado por GitHub (`updateBranch`): dos madres y committer
// `web-flow`. `updateBranch` falla ante conflicto ⇒ no lleva código de resolución.
// El merge append-only del Watchdog (AP-130, `github-actions[bot]`) o del Creator ⇒ false.
function esUpdateDeBase(commit) {
  return !!commit && Array.isArray(commit.parents) && commit.parents.length === 2
    && commit.committerLogin === WEB_FLOW;
}

const leer = (commits, sha) => (commits instanceof Map ? commits.get(sha) : (commits || {})[sha]);

// ¿El head es el SHA revisado, o se llega a él por la PRIMERA madre pasando solo
// por merges `web-flow`?
function revisadoPorCadena({ headSha, shaRevisado: rev, commits }) {
  if (!rev || !headSha) return false;
  if (headSha === rev) return true;
  let cur = headSha;
  for (let i = 0; i < 500; i++) {
    const c = leer(commits, cur);
    if (!esUpdateDeBase(c)) return false;
    cur = c.parents[0];
    if (cur === rev) return true;
  }
  return false;
}

// LGTM vigente para el head. Exige SIEMPRE que el último veredicto del Reviewer sea
// LGTM (crítica ronda 3, D: un REVIEW/NITS sobre un head `web-flow` no escribe
// marcador y, sin esto, la rama por cadena seguiría dando el LGTM anterior por bueno).
//   · head = SHA revisado: con la label `lgtm` viva.
//   · head ≠ SHA revisado: por la cadena `web-flow`, sin la label (`ci.yml` la
//     retira en el `synchronize` del `updateBranch`) y sin `needs-review` pendiente
//     (una review convocada sobre ese head aún no ha hablado).
function lgtmVigente({ labels, shaRevisado: rev, headSha, commits, ultimoEsLgtm }) {
  if (ultimoEsLgtm !== true || !rev || !headSha) return false;
  const ls = labels || [];
  if (rev === headSha) return ls.includes('lgtm');
  if (ls.includes('needs-review')) return false;
  return revisadoPorCadena({ headSha, shaRevisado: rev, commits });
}

// Decisión del belt AP-024 (Watchdog). Solo si el último veredicto es LGTM y no
// hay `rectHold` (AP-055). ⇒ 'remat' | 'rellenar-y-remat' | 'reviewer' | null.
function decidirAp024({ ultimoEsLgtm, hasLgtm, shaRevisado: rev, headSha, headSinCambiosDesdeVeredicto, commits, remats: n, rectHold }) {
  if (ultimoEsLgtm !== true || rectHold) return null;
  if (rev) {
    if (!revisadoPorCadena({ headSha, shaRevisado: rev, commits })) return 'reviewer';
    return !hasLgtm && (Number(n) || 0) < 1 ? 'remat' : null;
  }
  return headSinCambiosDesdeVeredicto === true ? 'rellenar-y-remat' : 'reviewer';
}

// El run del `workflow_run` es un CI verde DEL HEAD vivo.
function ciOkPorRun({ run, headSha, ciName }) {
  return !!run && !!headSha && run.name === ciName && run.conclusion === 'success' && run.head_sha === headSha;
}

// Re-materializaciones ya hechas para este head. La forma vieja sin SHA cuenta 1
// si no hay ninguna con SHA (cap por PR de antes de AP-139).
function remats({ comentarios, headSha }) {
  let conSha = 0, delHead = 0, vieja = false;
  for (const c of comentarios || []) {
    const b = (c && c.body) || '';
    for (const m of b.matchAll(REMAT_SHA_RE)) {
      conSha++;
      if (headSha && (m[1] === headSha || (m[1].length < 40 && headSha.startsWith(m[1])))) delHead++;
    }
    if (b.includes(REMAT_VIEJA)) vieja = true;
  }
  if (!conSha) return vieja ? 1 : 0;
  return delHead;
}

module.exports = {
  shaRevisado, ultimoVeredicto, mapaCommits, esUpdateDeBase, revisadoPorCadena,
  lgtmVigente, decidirAp024, ciOkPorRun, remats, marcaLgtmSha,
  PATRONES: { MARCA_SHA_RE, REMAT_SHA_RE, REMAT_VIEJA, VEREDICTO_RE, WEB_FLOW },
};
