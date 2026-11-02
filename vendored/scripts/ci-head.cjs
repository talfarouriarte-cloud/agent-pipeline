'use strict';
// ci-head — estado de CI del head de un PR, materializado en fichero para el
// Reviewer (AP-137, central#399, ruling mensual 2026-11-01, posición 16).
//
// El PAT fino no tiene el permiso Checks (los tokens finos de GitHub no lo
// ofrecen): `gh pr checks` y `check-runs/<job>/annotations` daban 403 con él
// (AP-134, 10/10 paneles del lote finplan 2026-11-01). El `GITHUB_TOKEN` del job
// sí admite `checks: read`; con él, un step determinista de `reviewer.yml` lee el
// CI del head y escribe `.pipeline/ci-head.md`, fuente primaria del ítem «Estado
// de CI en el momento del veredicto» de `docs/agents/reviewer.md`.
//
// Llamador: `reviewer.yml`, step «Estado de CI del head (AP-137)», que carga
// `${GITHUB_WORKSPACE}/scripts/ci-head.cjs` (graft-vendored). NUNCA lanza:
// cualquier error se devuelve como texto `lectura de CI falló: <status> <message>`
// (fail-open — el Reviewer corre igual y dice literal que no pudo leer).
//
// POR QUÉ VIVE AQUÍ (AP-068): el JS embebido en `.github/workflows/**` no lo
// ejecuta un banco; este sí. Banco: `scripts/check-ci-head.mjs`.

const MAX_ANOTACIONES = 20;
const MAX_MENSAJE = 300;
const CONCLUSIONES_CON_ANOTACIONES = new Set(['failure', 'timed_out']);

// Mensaje de una anotación en una línea y como mucho MAX_MENSAJE caracteres
// (el último es `…` si se cortó).
function truncar(msg) {
  const s = String(msg == null ? '' : msg).replace(/\s*\n\s*/g, ' ').trim();
  return s.length > MAX_MENSAJE ? `${s.slice(0, MAX_MENSAJE - 1)}…` : s;
}

function fallo(e) {
  const status = (e && (e.status ?? (e.response && e.response.status))) || 'sin-status';
  const message = String((e && e.message) || e || 'error desconocido').replace(/\s*\n\s*/g, ' ').trim();
  return `lectura de CI falló: ${status} ${message}`;
}

function cabecera(ahora, sha) {
  return `<!-- ci-head --> Lectura de CI: ${ahora.toISOString()} · SHA ${sha || 'desconocido'}`;
}

// Lee check-runs, estado combinado y anotaciones de los check-runs fallidos del
// `sha`. Devuelve el markdown completo (primera línea: hora y SHA).
async function leerCiHead({ github, owner, repo, sha, ahora = new Date() }) {
  const lineas = [cabecera(ahora, sha), ''];
  try {
    const { data: cr } = await github.rest.checks.listForRef({ owner, repo, ref: sha, per_page: 100 });
    const runs = (cr && cr.check_runs) || [];
    const parcial = cr && cr.total_count > runs.length ? ` de ${cr.total_count}; solo la primera página` : '';
    lineas.push(`## Check-runs (${runs.length}${parcial})`, '');
    if (!runs.length) lineas.push('- (ninguno)');
    for (const r of runs) {
      lineas.push(`- \`${r.name}\` — status: ${r.status}, conclusion: ${r.conclusion == null ? '(pendiente)' : r.conclusion}`);
      if (!CONCLUSIONES_CON_ANOTACIONES.has(r.conclusion)) continue;
      const { data: an } = await github.rest.checks.listAnnotations({ owner, repo, check_run_id: r.id, per_page: MAX_ANOTACIONES });
      const todas = an || [];
      for (const a of todas.slice(0, MAX_ANOTACIONES)) {
        lineas.push(`  - ${a.path}:${a.start_line} — ${truncar(a.message)}`);
      }
    }
    const { data: cs } = await github.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha, per_page: 100 });
    const statuses = (cs && cs.statuses) || [];
    lineas.push('', `## Estado combinado: ${(cs && cs.state) || '(desconocido)'}`, '');
    if (!statuses.length) lineas.push('- (sin contextos)');
    for (const s of statuses) lineas.push(`- \`${s.context}\` — ${s.state}${s.description ? ` (${truncar(s.description)})` : ''}`);
    return `${lineas.join('\n')}\n`;
  } catch (e) {
    return `${cabecera(ahora, sha)}\n\n${fallo(e)}\n`;
  }
}

// Variante del step: resuelve el head REAL en este instante (`pulls.get`; el SHA
// del payload puede ser viejo tras un relabel `needs-review`) y lee su CI. Un
// fallo de `pulls.get` lleva su propio `<status> <message>`, no se rotula como
// módulo ausente (crítica ronda 3, no bloqueante).
async function leerCiHeadPr({ github, owner, repo, pull_number, ahora = new Date() }) {
  let sha;
  try {
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number });
    sha = pr && pr.head && pr.head.sha;
    if (!sha) throw Object.assign(new Error(`pulls.get #${pull_number} sin head.sha`), { status: 'sin-sha' });
  } catch (e) {
    return `${cabecera(ahora, null)}\n\n${fallo(e)}\n`;
  }
  return leerCiHead({ github, owner, repo, sha, ahora });
}

module.exports = { leerCiHead, leerCiHeadPr, truncar, MAX_ANOTACIONES, MAX_MENSAJE };
