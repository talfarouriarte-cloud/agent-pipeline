'use strict';
// escalada-creator — la escalada del Creator al Architect (`[CREATOR-ESCALATED]`)
// se lee del ESTADO del PR de la rama, no del tipo de evento que armó la sesión
// (AP-136, central#392, ruling mensual 2026-11-01, posición 14).
//
// Con draft-first (AP-047/AP-057) la sesión del Creator se arma desde el ISSUE y
// escala DENTRO de su draft: es el caso normal de escalada. El post-step
// creator-escalated de `claude-code.yml` exigía un evento de PR ⇒ `skipped`; y los
// que convocan al Reviewer (materializador de `ready` de AP-095, `open-review-
// failsafe` de AP-016/AP-047) leían «PR sin `stalled`» como «turno del Reviewer».
// Aud. asesoramiento#3361/#3369 (camino draft) y #3373/#3384 (camino ready).
//
// Cuatro funciones PURAS, sin I/O. Llamadores:
//   · `claude-code.yml` — step creator-escalated (`resolverPr`, `escaladaFresca`),
//     materializador de `ready` y `open-review-failsafe` (`escaladaFresca`,
//     `cedeAnteEscalada`). Cargan `${GITHUB_WORKSPACE}/scripts/escalada-creator.cjs`
//     (graft-vendored) con fail-open al comportamiento anterior.
//   · `epic-merge.yml` — gate de merge (`mergeBloqueadoPorEscalada`), desde el
//     checkout sparse `.epic-merge-central/vendored/scripts/`.
//
// POR QUÉ VIVE AQUÍ (AP-068): el JS embebido en `.github/workflows/**` no lo
// ejecuta un banco; este sí. Banco: `scripts/check-escalada-creator.mjs`.

// Token de texto: el literal EXACTO de `creator-turn-close-failsafe.cjs`
// (`TERMINALES`) y del step creator-escalated — inicio de línea estricto (AP-035).
// Divergir aquí haría que los dos detectores discreparan sobre el mismo comentario;
// el banco afirma la igualdad de `source`.
const TOKEN_ESCALADA = /^\[CREATOR-ESCALATED\]/m;
// Belt HTML legacy (AP-028). Se busca fuera de spans de backticks: una cita en
// prosa (`` `<!-- creator-escalated -->` ``) no es una escalada (clase PR #1133).
const BELT_ESCALADA = /<!--\s*creator-escalated\s*-->/;

const sinCodigo = t => String(t || '')
  .replace(/```[\s\S]*?```/g, '')
  .replace(/`+[^`\n]*`+/g, '');

// ¿Algún comentario de `claude[bot]` creado en o después de `desdeISO` declara la
// escalada? `desdeISO` lo fija el llamador: `created_at` del comentario disparador
// si existe; si no (arm por evento `issues`), `created_at` del PR resuelto.
// `desdeISO` nulo ⇒ todos los comentarios del bot.
function escaladaFresca(comentarios, desdeISO) {
  const desde = desdeISO ? new Date(desdeISO).getTime() : -Infinity;
  return (comentarios || []).some(c => {
    if (c?.user?.login !== 'claude[bot]') return false;
    if (new Date(c.created_at).getTime() < desde) return false;
    const b = c.body || '';
    return TOKEN_ESCALADA.test(b) || BELT_ESCALADA.test(sinCodigo(b));
  });
}

// PR de la sesión, en este orden: (i) evento `issue_comment` sobre un PR ⇒ ese
// número; (ii) evento de PR ⇒ ese número; (iii) PR abierto cuya rama empieza por
// `claude/issue-<issueN>-` (el MISMO criterio de prefijo que el step de liberación
// de serie, `open-review-failsafe` y el materializador de `ready`; si casan varios,
// el más reciente); (iv) PR abierto cuyo body declara `Refs #N`/`Closes #N`.
// Ninguno ⇒ `null`.
function resolverPr({ payload, prsAbiertos, issueN }) {
  if (payload?.issue?.pull_request) return payload.issue.number;
  if (payload?.pull_request?.number) return payload.pull_request.number;
  if (!issueN) return null;
  const prs = prsAbiertos || [];
  const recientePrimero = (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0);
  const prefijoRama = `claude/issue-${issueN}-`;
  const porRama = prs.filter(p => (p?.head?.ref || '').startsWith(prefijoRama)).sort(recientePrimero);
  if (porRama.length) return porRama[0].number;
  const ref = new RegExp(`\\b(Refs|Closes)\\s+#${issueN}\\b`);
  const porBody = prs.filter(p => ref.test(p?.body || '')).sort(recientePrimero);
  return porBody.length ? porBody[0].number : null;
}

// ¿Debe ceder quien convoca al Reviewer? Escalada fresca, o el PR ya está en
// manos del Architect (`stalled`/`estado:esperando-architect`).
function cedeAnteEscalada({ labelsPr, fresca }) {
  const l = labelsPr || [];
  return !!fresca || l.includes('stalled') || l.includes('estado:esperando-architect');
}

// Gate de epic-merge: un LGTM sobre una escalada abierta no mergea (aud. #3361).
function mergeBloqueadoPorEscalada(labelsPr) {
  return (labelsPr || []).includes('estado:esperando-architect');
}

module.exports = { escaladaFresca, resolverPr, cedeAnteEscalada, mergeBloqueadoPorEscalada,
  PATRONES: { TOKEN_ESCALADA, BELT_ESCALADA } };
