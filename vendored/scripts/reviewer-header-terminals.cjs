'use strict';
// reviewer-header-terminals — los dos terminales de la CABECERA del veredicto
// del Reviewer que se materializan por estado en el post-step «Materializar
// estado del Reviewer» de `reviewer.yml` (AP-129, central#362, funde #308).
//
// QUÉ CIERRA. Dos decisiones que el Reviewer ya había tomado viajaban como
// prosa sin consumidor mecánico:
//   (1) `[NEEDS-HUMAN]: <razón>` en un REVIEW solo llegaba a `human-needed` si
//       el Creator, convocado por el ping, repetía el tag en su cierre: una
//       sesión entera para copiar una línea (#308; asesoramiento PR #3380,
//       2 de 2 reservas REDUNDANTES).
//   (2) Una condición sobre el eslabón SIGUIENTE escrita en un LGTM («esta
//       decisión tiene que estar tomada antes de lanzar el 3/3») no la leía
//       nadie: `epic-merge` mergeaba y consumía `launch-next` en 2 min (#362,
//       P0 aud. asesoramiento#3046 y cuatro ciclos más).
// Ahora el post-step lee la cabecera y escribe el estado: `human-needed` en el
// primer caso, `launch-hold` en el PR en el segundo (lo consume
// `launch-hold.cjs` desde `epic-merge`).
//
// POR QUÉ VIVE AQUÍ (AP-068): función PURA + runtime, pusheable por un agente,
// gateada por el CI del central y ejecutada por `scripts/check-reviewer-header.mjs`
// contra la función REAL. En el workflow solo queda la invocación.
//
// Zona de rigor `vendored/`: todo diff de este fichero despliega a los DOS
// consumidores en su siguiente run.

const MARK_NEEDS_HUMAN = '<!-- needs-human-materializado -->';
const MARK_LAUNCH_HOLD = '<!-- launch-hold-declarado -->';
const MARK_PING = '<!-- ping-creator -->';
const LABEL_HOLD = 'launch-hold';

// Anclados a inicio de línea (clase PR #1133: un tag citado entre backticks o
// a media frase NO es un tag emitido). Veredicto: misma regex que `reviewer.yml`.
const RE_VEREDICTO = /^\s*(LGTM|REVIEW|NITS)\b/;
const RE_NEEDS_HUMAN = /^\s*\[NEEDS-HUMAN\]:\s*(.+)$/m;
const RE_LAUNCH_HOLD = /^\s*\[LAUNCH-HOLD\]:\s*(.+)$/m;

// ── Clasificación PURA ───────────────────────────────────────────────────────
// La cabecera son las líneas desde la primera hasta la primera línea en blanco
// (`reviewer.md` § «Cabecera de control de loop»). Fuera de ella nada cuenta:
// el cuerpo de la review cita el vocabulario a menudo.
function clasificarCabecera(body) {
  const lineas = String(body || '').replace(/^\s*\n/, '').replace(/\r/g, '').split('\n');
  const fin = lineas.findIndex((l) => /^\s*$/.test(l));
  const cab = (fin === -1 ? lineas : lineas.slice(0, fin)).join('\n');
  const mV = (lineas[0] || '').match(RE_VEREDICTO);
  const veredicto = mV ? mV[1] : null;
  const avisos = [];
  const mN = cab.match(RE_NEEDS_HUMAN);
  const needsHuman = mN ? mN[1].trim() : null;
  const mL = cab.match(RE_LAUNCH_HOLD);
  let launchHold = null;
  if (mL) {
    if (veredicto === 'LGTM') launchHold = mL[1].trim();
    else avisos.push(`[LAUNCH-HOLD] en un veredicto ${veredicto || 'ausente'}: se ignora (solo vale en un LGTM; un ${veredicto || 'no-veredicto'} ya frena el merge).`);
  }
  const ping = cab.includes(MARK_PING);
  return { veredicto, needsHuman, launchHold, ping, avisos };
}

// ── Runtime ──────────────────────────────────────────────────────────────────
// Labels con el PAT (`pat`, el `REVIEWER_GITHUB_TOKEN` del step): un `labeled`
// del GITHUB_TOKEN no dispara workflows, y `human-needed`/`launch-hold` tienen
// consumidores por evento. Comentarios con el `github` del step. Owner/repo
// del entorno del runner (`GITHUB_REPOSITORY`); si falta, del `html_url` del
// veredicto.
function repoDe(lastVc) {
  const env = process.env.GITHUB_REPOSITORY || '';
  if (/^[^/]+\/[^/]+$/.test(env)) { const [owner, repo] = env.split('/'); return { owner, repo }; }
  const m = String((lastVc && lastVc.html_url) || '').match(/github\.com\/([^/]+)\/([^/]+)\//);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function ponerLabel({ github, core, O, prNumber, label, pat }) {
  if (pat && typeof fetch === 'function') {
    const res = await fetch(`https://api.github.com/repos/${O.owner}/${O.repo}/issues/${prNumber}/labels`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ labels: [label] }),
    });
    if (!res.ok) { core.warning(`reviewer-header: label ${label} por PAT: HTTP ${res.status}`); return false; }
    return true;
  }
  core.warning(`reviewer-header: sin PAT — ${label} se aplica con el token del step (su \`labeled\` no dispara workflows).`);
  await github.rest.issues.addLabels({ ...O, issue_number: prNumber, labels: [label] });
  return true;
}

// Sin label no hay marcador (🟡 1 de la review de PR #388): el comentario
// afirma un estado que `launch-hold.decidir` lee SOLO de la label, y el marcador
// publicado deduplicaría el reintento de un re-run del post-step.
async function asegurarLabel({ github, core, O, prNumber, label, pat, labels }) {
  if (labels.includes(label)) return true;
  if (await ponerLabel({ github, core, O, prNumber, label, pat })) return true;
  core.warning(`PR #${prNumber}: cabecera NO materializada — ${label} no se aplicó; sin marcador, un re-run del post-step lo reintenta.`);
  return false;
}

async function run({ github, core, prNumber, lastVc, prLabels, pat }) {
  const cab = clasificarCabecera(lastVc && lastVc.body);
  cab.avisos.forEach((a) => core.warning(`PR #${prNumber}: ${a}`));
  if (!cab.needsHuman && !cab.launchHold) return { via: 'nada', cab };
  const O = repoDe(lastVc);
  if (!O) { core.warning(`PR #${prNumber}: reviewer-header sin owner/repo — no materializo la cabecera.`); return { via: 'sin-repo', cab }; }

  // Dedupe por marcador en comentarios posteriores al veredicto (un re-run del
  // post-step sobre el mismo veredicto no duplica).
  let posteriores = [];
  try {
    const cs = await github.paginate(github.rest.issues.listComments, { ...O, issue_number: prNumber, per_page: 100 });
    posteriores = cs.filter((c) => new Date(c.created_at) > new Date(lastVc.created_at));
  } catch (e) { core.warning(`PR #${prNumber}: reviewer-header no pudo leer comentarios (${e.message}) — materializo sin dedupe.`); }
  const ya = (m) => posteriores.some((c) => (c.body || '').includes(m));
  const labels = prLabels || [];
  const hechos = [];

  if (cab.needsHuman) {
    if (cab.ping) core.warning('cabecera contradictoria: NEEDS-HUMAN con ping');
    if (!ya(MARK_NEEDS_HUMAN)) {
      if (await asegurarLabel({ github, core, O, prNumber, label: 'human-needed', pat, labels })) {
        await github.rest.issues.createComment({ ...O, issue_number: prNumber,
          body: `**reviewer · needs-human-materializado**: el Reviewer reservó el merge al propietario: «${cab.needsHuman}». Label aplicada por estado, sin sesión del Creator.\n\n${MARK_NEEDS_HUMAN}` });
        hechos.push('needs-human');
      } else hechos.push('needs-human-sin-label');
    }
  }
  if (cab.launchHold) {
    if (!ya(MARK_LAUNCH_HOLD)) {
      if (await asegurarLabel({ github, core, O, prNumber, label: LABEL_HOLD, pat, labels })) {
        await github.rest.issues.createComment({ ...O, issue_number: prNumber,
          body: `**reviewer · launch-hold**: el LGTM condiciona el eslabón SIGUIENTE: «${cab.launchHold}». Si este PR es un eslabón de épica con \`launch-next\`, epic-merge mergea y NO lanza el siguiente eslabón; en cualquier otro camino (parcial, suelto, cierre de épica) el hold no tiene efecto.\n\n${MARK_LAUNCH_HOLD}` });
        hechos.push('launch-hold');
      } else hechos.push('launch-hold-sin-label');
    }
  }
  if (!hechos.length) core.notice(`PR #${prNumber}: cabecera del Reviewer ya materializada (marcador presente) — no duplico.`);
  return { via: hechos.length ? hechos.join('+') : 'dedupe', cab };
}

module.exports = { clasificarCabecera, run, repoDe,
  PATRONES: { MARK_NEEDS_HUMAN, MARK_LAUNCH_HOLD, MARK_PING, LABEL_HOLD, RE_VEREDICTO, RE_NEEDS_HUMAN, RE_LAUNCH_HOLD } };
