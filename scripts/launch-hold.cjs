'use strict';
// launch-hold — consumidor en `epic-merge` del `[LAUNCH-HOLD]` del LGTM
// (AP-129, central#362). El post-step del Reviewer pone la label `launch-hold`
// en el PR (`reviewer-header-terminals.cjs`); aquí, al mergear, el `launch-next`
// NO se consume: el eslabón siguiente queda `stalled` +
// `estado:esperando-architect` con la decisión pendiente citada, y lo arma
// architect-resolve tras decidirla (`watchdog.md` § «Régimen autónomo»).
//
// QUÉ CIERRA. Épica ADR-290 (aud. asesoramiento#3046): el LGTM de PR #3044
// decía «esta decisión tiene que estar tomada antes de lanzar el eslabón 3/3»;
// epic-merge mergeó y lanzó #3039 2 min después, nadie tomó la decisión y el
// Auditor acabó en 🔴 sin válvula + correctivo sin armar + `human-needed`.
//
// AP-068: pusheable, con banco (`scripts/check-reviewer-header.mjs`, casos
// g–j). Zona de rigor `vendored/`.

const { clasificarCabecera } = require('./reviewer-header-terminals.cjs');

const MARK_HOLD_DECLARADO = '<!-- launch-hold-declarado -->';
const MARK_HOLD = '<!-- launch-hold -->';
const LABEL = 'launch-hold';

// ¿El PR mergeado retiene el lanzamiento del siguiente? Lee la LABEL (estado),
// no la prosa: la escribió el post-step del Reviewer desde la cabecera anclada.
function decidir({ prLabels }) {
  return (prLabels || []).includes(LABEL);
}

// Texto de la decisión pendiente: el del último comentario
// `launch-hold-declarado` (el post-step lo cita entre «»); si falta, la
// captura `[LAUNCH-HOLD]:` de la cabecera del último LGTM.
function textoHold(comments) {
  const cs = comments || [];
  const decl = cs.filter((c) => (c.body || '').includes(MARK_HOLD_DECLARADO)).pop();
  if (decl) {
    const m = (decl.body || '').match(/«([\s\S]*)»/);
    if (m) return m[1].trim();
  }
  const lgtms = cs.filter((c) => clasificarCabecera(c.body).veredicto === 'LGTM');
  for (let i = lgtms.length - 1; i >= 0; i--) {
    const t = clasificarCabecera(lgtms[i].body).launchHold;
    if (t) return t;
  }
  return '(texto no recuperable: lee la cabecera del último LGTM del PR)';
}

// Retiene el eslabón siguiente. Mismo par y orden de labels que
// `escalada-materializada-con-pr` (estado visible primero, `stalled` después:
// su `labeled` convoca a architect-resolve por evento).
async function retener({ github, owner, repo, siguiente, prNumber, texto }) {
  await github.rest.issues.addLabels({ owner, repo, issue_number: siguiente, labels: ['estado:esperando-architect'] });
  await github.rest.issues.addLabels({ owner, repo, issue_number: siguiente, labels: ['stalled'] });
  await github.rest.issues.createComment({ owner, repo, issue_number: siguiente,
    body: `**epic-merge · launch-hold**: el LGTM del PR #${prNumber} condiciona este eslabón: «${texto}». No se arma por la cadena: decide architect-resolve (enmienda/ruling en este issue) y arma él.\n\n${MARK_HOLD}` });
}

module.exports = { decidir, textoHold, retener, PATRONES: { MARK_HOLD_DECLARADO, MARK_HOLD, LABEL } };
