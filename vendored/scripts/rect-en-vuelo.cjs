'use strict';
// rect-en-vuelo — detector de rectificaciones de ADR/AP aterrizadas EN VUELO
// (AP-055, repesca finplan#1688), extraído VERBATIM del scan de `watchdog.yml`
// (central#304, ruling mensual 2026-11-01, posición 4; AP-125). Dos llamadores
// con la MISMA detección, la MISMA clave y el MISMO marcador:
//   · el scan del Watchdog (sin cambio de comportamiento);
//   · el gate de merge de `epic-merge.yml`, justo antes de mergear — sin él, una
//     rectificación aterrizada entre el LGTM y el merge solo la veía el Watchdog
//     si un tick caía en la ventana.
// La I/O de labels/comentario la hace cada llamador; aquí solo la detección
// (lecturas de la API) y el dedupe por clave.
//
// Residual declarado (crítica ronda 3, [H]): el filtro de fichero sigue siendo
// el de AP-055 (`/decisions[^/]*\.md$/i`). Un consumidor con `layout: "dir"`
// (AP-111, `<dir>/ADR-NNN.md`) no se ve: ninguno de los dos jobs tiene en disco
// el `adr-lint.config.json` del consumidor y la función que lo traduciría a
// rutas no existe. Ampliarlo exige decidir de dónde se lee esa config.
//
// POR QUÉ VIVE AQUÍ (AP-068): banco `scripts/check-rect-en-vuelo.mjs`.

const RECT_MARK = '<!-- rectificacion-en-vuelo';   // prefijo; el marcador emitido lleva la clave en cualquiera de sus DOS formas (§CLAVE abajo): `<!-- rectificacion-en-vuelo: ADR-231·R·1 -->` o `<!-- rectificacion-en-vuelo: AP-006·enmienda-2026-07-13 -->`
const RECT_MARK_RE = /<!--\s*rectificacion-en-vuelo:\s*[^>]*-->/;   // cadena COMPLETA con clave (clase 6: jamás substring de prosa; una cita transportada por AP-054 llega con `<!--` escapado a `&lt;!--` y no casa)
const ADR_HEAD = /^##\s*(ADR|AP)-(\d+)\b/;   // `+n` normaliza los ceros a la izquierda (`ADR-005` ≡ `ADR-5`) SOLO para cruzar; la clave del marcador usa la forma LITERAL del header
const RECT_ORD = /\bR\s*[·.]\s*(\d+)/;   // `\b`: sin frontera, la `R` puede ser la SEGUNDA letra de otra palabra (`PR.1`, `PR·2`) y el ordinal dispararía la rama (a) sin vocablo. `### Revisión R·1 (…)` y `(R·1)` conservan la frontera
const RECT_VOCAB = /Rectificaci[oó]n|Rectifica|Derogaci[oó]n|Deroga|Enmienda|Revisi[oó]n/i;
const RECT_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;   // fecha de la rectificación cuando la línea la trae (`**Enmienda (2026-07-13).**`): parte ESTABLE de la clave sin ordinal
const rectCand = t => {
  if (/^#{2,6}\s+/.test(t)) return ADR_HEAD.test(t)
    ? (RECT_VOCAB.test(t) && RECT_ORD.test(t))   // header de BLOQUE: solo si se declara rectificación CON ordinal
    : (RECT_VOCAB.test(t) || RECT_ORD.test(t));  // sub-encabezado dentro del bloque
  return /^>?\s*\*\*(?:Rectifica|Deroga|Enmienda)/i.test(t);
};

const marcador = (clave) => `${RECT_MARK}: ${clave} -->`;
const yaMarcada = (comments, clave) => (comments || []).some((c) => (c.body || '').includes(marcador(clave)));
// ¿Hay un veredicto del Reviewer (`login`) POSTERIOR al último marcador de la
// clave? `comments` en orden cronológico (el de `listComments` paginado). Sin
// esto, una clave ya marcada dejaba pasar el merge: el marcador retira `lgtm`,
// pero el respaldo por comentarios de GATE 2 de epic-merge resucita el LGTM
// ANTERIOR a la rectificación (review de PR #383, 🔴). Misma relación de orden
// que el guard del belt `watchdog-lgtm-rematerialize` (AP-024).
const VEREDICTO_RE = /^\s*(LGTM|REVIEW|NITS)\b/;
const consumida = (comments, clave, login) => {
  const cs = comments || [];
  let iMarca = -1;
  cs.forEach((c, i) => { if ((c.body || '').includes(marcador(clave))) iMarca = i; });
  if (iMarca < 0) return false;
  return cs.slice(iMarca + 1).some((c) => c.user && c.user.login === login && VEREDICTO_RE.test(c.body || ''));
};

// [{ clave, linea }] de las rectificaciones añadidas en la base desde el punto
// de partida del PR (`pr.base.sha…pr.base.ref`) atribuidas a un ADR/AP que el
// PR CITA en título/body. Lanza si el compare falla (el llamador decide).
async function detectar({ github, O, pr, warn = () => {}, info = () => {} }) {
  const cited = new Set([...`${pr.title || ''}\n${pr.body || ''}`.matchAll(/\b(ADR|AP)-(\d+)\b/g)].map(m => `${m[1]}-${+m[2]}`));
  if (!cited.size) return [];   // PR que no cita ADR/AP: nada que invalidar
  // `compareCommits` y no `compareCommitsWithBasehead`: es la
  // superficie ya EJERCIDA por la casa (`claude-code.yml:1594` y el
  // modo de PR huérfano de este mismo scan). Un método inexistente
  // caería en el `catch` del llamador y dejaría el detector inerte en
  // SILENCIO — precisamente la clase de fallo que este AP cierra.
  const { data: cmp } = await github.rest.repos.compareCommits({
    ...O, base: pr.base.sha, head: pr.base.ref });
  if (!(cmp.commits || []).length) return [];   // la base no avanzó desde el arranque del PR
  // `compareCommits` trunca `files` a 300 SIN señal en el cuerpo:
  // con la lista al tope, el volumen de decisiones puede quedar
  // fuera y el bucle no vería nada que avisar — silencio, no
  // warning. Se declara al log (AP-052: un límite no escrito se
  // lee como cobertura).
  if ((cmp.files || []).length >= 300) warn(`rect-en-vuelo #${pr.number}: el compare devuelve ${cmp.files.length} ficheros (tope 300 de la API) — la lista puede estar TRUNCADA y un volumen de decisiones quedar fuera; rectificaciones posiblemente NO evaluadas.`);
  const rects = new Map();
  for (const f of cmp.files || []) {
    if (!/decisions[^/]*\.md$/i.test(f.filename)) continue;
    if (!f.patch) {   // diff demasiado grande: GitHub omite el patch — residual honesto, no silencioso
      warn(`rect-en-vuelo #${pr.number}: ${f.filename} sin patch en el compare (diff grande) — rectificaciones de ese fichero NO evaluadas.`);
      continue;
    }
    const cand = new Set(f.patch.split('\n')
      .filter(l => l.startsWith('+') && !l.startsWith('+++'))
      .map(l => l.slice(1).trim())
      .filter(t => t && rectCand(t)));
    if (!cand.size) continue;
    // Lectura del fichero VIGENTE para atribuir cada línea a su
    // bloque contenedor (el header no viaja en el patch). `raw`
    // en vez de base64 porque estos volúmenes superan holgadamente
    // el límite del JSON con `content`.
    let lines = null;
    try {
      const { data: rawFile } = await github.rest.repos.getContent({ ...O, path: f.filename, ref: pr.base.ref, mediaType: { format: 'raw' } });
      lines = String(rawFile).split('\n');
    } catch (e) { info(`rect-en-vuelo/content ${f.filename}: ${e.message}`); }
    if (!lines) lines = f.patch.split('\n').filter(l => !l.startsWith('-') && !l.startsWith('@@')).map(l => l.replace(/^[+ ]/, ''));
    let cur = null, curDisp = null;
    for (const ln of lines) {
      const t = ln.trim();
      const h = t.match(ADR_HEAD);
      if (h) { cur = `${h[1]}-${+h[2]}`; curDisp = `${h[1]}-${h[2]}`; }
      if (!cand.has(t)) continue;
      cand.delete(t);
      if (!cur) continue;                 // rectificación antes de todo header: no atribuible
      if (!cited.has(cur)) continue;      // rectificación de un ADR/AP que este PR no cita: no es su base normativa
      // CLAVE del marcador — DOS formas, ambas declaradas en
      // `protocol.md` y en el §Decisión 2 del AP:
      //   · `ADR-N·R·M` cuando la rectificación lleva ordinal
      //     (finplan/wmcb: `### Revisión R·1 (…)`);
      //   · `ADR-N·<vocablo>[-<fecha>]` cuando NO lo lleva — la
      //     forma del central (`AP-006·enmienda-2026-07-13`).
      // El sufijo sin ordinal se deriva del VOCABLO (+ fecha si
      // la línea la trae), NO del texto completo de la línea: un
      // slug del texto cambia con cualquier edición posterior
      // (typo, reformulación, fecha corregida), el compare vuelve
      // a ver la línea como AÑADIDA, la clave ya no casa y el
      // dedupe emite un SEGUNDO comentario —con su segunda
      // retirada de `lgtm`— por la MISMA rectificación: el cap
      // «1 por rectificación» dejaba de ser duro justo en la rama
      // sin ordinal. Desempate por sufijo `-2`, `-3`… si dos
      // rectificaciones del MISMO bloque comparten vocablo y
      // fecha: colisionarían y la segunda se perdería en
      // SILENCIO, que es peor que un comentario de más.
      const headTxt = t.replace(/^[#>\s]+/, '');
      const ord = t.match(RECT_ORD);
      const voc = /Rectifica/i.test(t) ? 'rectificacion' : /Deroga/i.test(t) ? 'derogacion' : /Enmienda/i.test(t) ? 'enmienda' : /Revisi/i.test(t) ? 'revision' : '';   // vocablo CANÓNICO sin diacríticos (conjunto cerrado, explícito: nada de normalize/rangos de combining chars invisibles en el fuente)
      const date = (t.match(RECT_DATE) || [])[1];
      const suf = ord ? `R·${ord[1]}` : `${voc || 'rect'}${date ? `-${date}` : ''}`;
      let key = `${curDisp}·${suf}`;
      for (let n = 2; rects.has(key) && rects.get(key).head !== headTxt; n++) key = `${curDisp}·${suf}-${n}`;
      if (!rects.has(key)) rects.set(key, { key, head: headTxt });
    }
    for (const t of cand) warn(`rect-en-vuelo #${pr.number}: línea de rectificación añadida en ${f.filename} no localizable en la base para atribuirla a su ADR — «${t.slice(0, 80)}» NO evaluada.`);
  }
  return [...rects.values()].map((r) => ({ clave: r.key, linea: r.head }));
}

module.exports = { RECT_MARK, RECT_MARK_RE, ADR_HEAD, RECT_ORD, RECT_VOCAB, RECT_DATE, rectCand, marcador, yaMarcada, consumida, detectar };
