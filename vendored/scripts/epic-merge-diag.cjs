'use strict';
// epic-merge-diag — identidad POSITIVA del sticky `epic-merge-diag` y estado
// que ese sticky tiene que conservar entre reescrituras (AP-093, central#245 +
// central#264). Lo consume el reusable `epic-merge.yml` (`diag`, dedupe del
// camino manual y `armQueue`), que se limita a hacerle `require`.
//
// QUÉ CIERRA. (1) `diag()` reconocía su sticky por SUBSTRING del marcador
// (`body.includes('<!-- epic-merge-diag -->')`) y el autor no discrimina: el
// Reviewer postea con el MISMO PAT. En asesoramiento#2286 una review REVIEW que
// citaba el marcador entre backticks fue sobrescrita 64 s después de nacer;
// el veredicto solo sobrevivió en `userContentEdits`. Es la 2.ª ocurrencia en
// el mismo instrumento: la 1.ª se midió en la ronda 2 de la review de AP-064
// y la lección llegó al belt de AP-064 pero no aquí. Clase AP-063: EFECTUAR ≠
// CITAR. (2) El camino de merge MANUAL deduplicaba buscando «MERGEADO» en
// cualquier comentario con el marcador, y `diag()` reescribe el cuerpo
// COMPLETO en cada llamada: un diag posterior al merge (el del arm de cola,
// p. ej.) borraba el «MERGEADO» y el evento `closed` del mismo merge se
// declaraba «merge MANUAL» y reprocesaba sentinels + cola (asesoramiento#2280).
// (3) Por esa misma puerta, `armQueue` corría una vez por evaluación del MISMO
// merge: dos arms de cola por merge, a veces de dos issues distintos
// (central#264, aud. asesoramiento#2326/#2328).
//
// POR QUÉ VIVE AQUÍ (AP-068): el cuerpo embebido en `.github/workflows/**` no
// lo puede pushear un agente ni lo ejecuta un banco; aquí lo gatea el CI del
// central (`scripts/check-epic-merge-diag.mjs`). Zona de rigor `vendored/`:
// todo diff despliega a los DOS consumidores en su siguiente run.

// Despojo de código: el MISMO que usa el belt de AP-064 — no una copia.
const { despojarCodigo } = require('./resolve-cross-issue-failsafe.cjs');

const MARKER = '<!-- epic-merge-diag -->';
// Anclado a la PRIMERA línea del cuerpo YA despojado de código. El sticky
// propio nace con el marcador en la línea 1 desde siempre (legacy incluido),
// y un veredicto del Reviewer no puede tenerlo ahí: la cabecera ADR-063 exige
// el veredicto como primera palabra — anclaje a línea 1 y
// veredicto-primera-palabra son mutuamente excluyentes.
const STICKY_L1 = /^\s*<!--\s*epic-merge-diag\s*-->\s*$/;
// Estado persistente del sticky, en LÍNEA PROPIA tras el mensaje. `diag()` lo
// arrastra de la versión anterior en cada reescritura: el mensaje es volátil,
// el estado no.
const MERGED_LINE = '<!-- epic-merge-merged -->';
const MERGED_RE = /^[ \t]*<!--\s*epic-merge-merged\s*-->[ \t]*$/m;
const POP_RE = /^[ \t]*<!--\s*serial-pop:\s*#(\d+)\s*-->[ \t]*$/gm;
// Legacy (stickies anteriores a AP-093, sin línea de estado): el mensaje de
// merge en el FORMATO PROPIO de la línea 2, no «MERGEADO» suelto en el cuerpo.
const LEGACY_MERGED_RE = /^\*\*epic-merge\*\* \([^)\n]*\): MERGEADO\b/m;
// Mensajes de `diag()` que certifican que ESTE job procesó un merge.
const MSG_MERGED_RE = /^mergeado\b/i;

const popLine = (n) => `<!-- serial-pop: #${n} -->`;
const popOrigenLine = (pr) => `<!-- serial-pop-origen: #${pr} -->`;

function lineaPropia(body, linea) {
  const esc = linea.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  return new RegExp(`^[ \\t]*${esc}[ \\t]*$`, 'm').test(despojarCodigo(body));
}

// ¿Es `c` el sticky de epic-merge? Identidad positiva: autor = login del PAT
// Y marcador en la línea 1 del cuerpo despojado. Citar el marcador —entre
// backticks, en un bloque cercado o a media frase— no casa.
function esStickyPropio(c, login) {
  if (!c || !login || !c.user || c.user.login !== login) return false;
  const primera = despojarCodigo(c.body).split(/\r?\n/)[0];
  return STICKY_L1.test(primera);
}

// El sticky vigente (el más reciente que casa), o null. Con null, `diag()`
// CREA uno nuevo: jamás reescribe un comentario ajeno.
function seleccionarSticky(comentarios, login) {
  const mine = (comentarios || []).filter((c) => esStickyPropio(c, login));
  return mine.length ? mine[mine.length - 1] : null;
}

function estadoDe(body) {
  const b = despojarCodigo(body);
  const pops = [...b.matchAll(POP_RE)].map((m) => Number(m[1]));
  return { merged: MERGED_RE.test(b) || LEGACY_MERGED_RE.test(b), pops };
}

// ¿Consta en el sticky que epic-merge ya procesó el merge de este PR? Es el
// dedupe del camino manual, acotado al sticky seleccionado (no a cualquier
// comentario del PR).
function stickyMergeado(sticky) {
  return !!sticky && estadoDe(sticky.body).merged;
}

// Cuerpo nuevo del sticky: marcador en línea 1, mensaje, y el estado de la
// versión anterior + el que aporte esta llamada.
function construirCuerpo(prevBody, msg, iso, { pop } = {}) {
  const prev = prevBody ? estadoDe(prevBody) : { merged: false, pops: [] };
  const merged = prev.merged || MSG_MERGED_RE.test(String(msg || ''));
  // Un pop solo es «de este merge» si el merge ya consta: el barrido de cola
  // del `finally` corre también en evaluaciones PRE-merge, y un pop suyo
  // registrado aquí vetaría el pop legítimo del merge posterior.
  const pops = merged ? [...new Set([...prev.pops, ...(pop ? [Number(pop)] : [])])] : [];
  const lineas = [MARKER, `**epic-merge** (${iso}): ${msg}`];
  if (merged) lineas.push(MERGED_LINE);
  for (const n of pops) lineas.push(popLine(n));
  return lineas.join('\n');
}

// Marcadores del comentario de arm de cola (central#264). `serial-pop: #N` es
// el del ruling; `serial-pop-origen: #PR` lo ata al MERGE: un issue re-encolado
// por el guard serial tras un pop de OTRO merge tiene que poder armarse otra
// vez (si no, la cabeza FIFO quedaría vetada para siempre y con ella la cola).
function marcadoresPop(next, pr) {
  return pr ? `${popLine(next)}\n${popOrigenLine(pr)}` : popLine(next);
}

// Idempotencia de `armQueue` por merge: motivo para NO armar, o null.
//  (a) el sticky del PR ya registra un pop de ESTE merge (cubre el doble arm
//      de dos issues DISTINTOS: la 2.ª evaluación ve la cabeza nueva de la
//      cola, pero el sticky es el mismo);
//  (b) el issue siguiente ya tiene un arm de cola de ESTE merge (cubre la
//      ventana en que el pop se posteó y el sticky no llegó a escribirse).
// Sin PR (cierre por estado) no hay merge que deduplicar: null.
function popYaEmitido({ sticky, comentariosSiguiente, next, pr, login }) {
  if (!pr) return null;
  if (sticky) {
    const { pops } = estadoDe(sticky.body);
    if (pops.length) return `el sticky del PR #${pr} ya registra el pop de #${pops.join(', #')} para este merge`;
  }
  const hit = (comentariosSiguiente || []).find((c) => (!login || (c.user && c.user.login === login))
    && lineaPropia(c.body, popLine(next)) && lineaPropia(c.body, popOrigenLine(pr)));
  return hit ? `#${next} ya tiene el arm de cola de este merge (${hit.html_url || hit.id})` : null;
}

module.exports = {
  MARKER, esStickyPropio, seleccionarSticky, estadoDe, stickyMergeado,
  construirCuerpo, marcadoresPop, popYaEmitido,
};
