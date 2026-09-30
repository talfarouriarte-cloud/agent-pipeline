#!/usr/bin/env node
// check-epic-merge-diag — banco de casos EJECUTABLE del selector del sticky
// `epic-merge-diag` y de la idempotencia del pop de cola por merge
// (`vendored/scripts/epic-merge-diag.cjs`, AP-093 — central#245 + central#264).
//
// Por qué existe. El selector anterior (`body.includes(marker)`) destruyó DOS
// veces una review del Reviewer que citaba el marcador (review de AP-064;
// asesoramiento#2286). Ambas veces la lectura del diff no lo vio: lo que
// congela la clase es ejecutar los casos, no releer el código.
//
// Verde: exit 0. Rojo: el comportamiento real cambió y el banco lo nota.
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

// Central primero (fichero FUENTE); el consumidor lo recibe en `scripts/`.
const FUENTES = ['vendored/scripts/epic-merge-diag.cjs', 'scripts/epic-merge-diag.cjs'];
let fuente = null;
let m = null;
for (const f of FUENTES) {
  if (!existsSync(f)) continue;
  m = require(resolve(f));   // un SyntaxError aquí es ROJO, y debe serlo
  fuente = f;
  break;
}
if (!m) {
  console.log('::warning::check-epic-merge-diag — no encuentro `epic-merge-diag.cjs` en ninguna de sus dos ubicaciones: el banco NO se ha ejecutado.');
  process.exit(0);
}

const PAT = 'talfarouriarte-cloud';
const MARK = '<!-- epic-merge-diag -->';
const c = (id, body, login = PAT, extra = {}) => ({ id, body, user: { login }, ...extra });
const fallos = [];
const caso = (nombre, ok) => { if (!ok) fallos.push(nombre); };

// ── Costura: el despojo es el del belt de AP-064, no una copia ─────────────
const rcf = require(resolve(fuente.replace('epic-merge-diag.cjs', 'resolve-cross-issue-failsafe.cjs')));
caso('resolve-cross-issue-failsafe exporta `despojarCodigo`', typeof rcf.despojarCodigo === 'function');

// ── Selector del sticky (ruling #245, punto 3) ─────────────────────────────
const propio = c(1, `${MARK}\n**epic-merge** (2026-09-28T10:16:36Z): Reviewer aún no LGTM (esperando-reviewer); espero.`);
const review = c(2, 'REVIEW\n<!-- ping-creator -->\n@claude\n\n🔴 1. El diag de `<!-- epic-merge-diag -->` se sobrescribe…');
const cercado = c(3, 'NITS\n\n```\n<!-- epic-merge-diag -->\n**epic-merge** (x): MERGEADO\n```');
const cercadoL1 = c(4, `\`\`\`\n${MARK}\n\`\`\`\ntexto`);
const legacy = c(5, `${MARK}\n**epic-merge** (2026-07-01T00:00:00Z): MERGEADO + lanzado #12 (labels de bloqueo limpiadas si las había).`);
const ajeno = c(6, `${MARK}\n**epic-merge** (x): suplantado`, 'otra-cuenta');
const inline = c(7, `\`${MARK}\` es el sticky de epic-merge`);

caso('(a) sticky propio → casa', m.esStickyPropio(propio, PAT));
caso('(b) review del Reviewer que cita el marcador entre backticks → NO casa', !m.esStickyPropio(review, PAT));
caso('(c) marcador dentro de un bloque cercado → NO casa', !m.esStickyPropio(cercado, PAT));
caso('(c′) bloque cercado en la línea 1 → NO casa', !m.esStickyPropio(cercadoL1, PAT));
caso('(c″) span inline en la línea 1 → NO casa', !m.esStickyPropio(inline, PAT));
caso('(d) sticky legacy con marcador en línea 1 → casa (migración sin duplicado)', m.esStickyPropio(legacy, PAT));
caso('autor distinto del PAT → NO casa', !m.esStickyPropio(ajeno, PAT));
caso('seleccionar: review citando + sticky → el sticky', m.seleccionarSticky([propio, review], PAT)?.id === 1);
caso('seleccionar: review citando DESPUÉS del sticky → sigue el sticky (el incidente #2286)', m.seleccionarSticky([propio, review, cercado], PAT)?.id === 1);
caso('seleccionar: solo la review citando → null (diag crea uno nuevo)', m.seleccionarSticky([review, cercado, inline], PAT) === null);

// ── Cuerpo y estado persistente (ruling #245, punto 2) ─────────────────────
const b1 = m.construirCuerpo(null, 'Reviewer aún no LGTM; espero.', 'T1');
caso('cuerpo nuevo: marcador en línea 1', b1.split('\n')[0] === MARK && m.esStickyPropio(c(9, b1), PAT));
caso('cuerpo nuevo pre-merge: no consta merge', !m.stickyMergeado(c(9, b1)));
const b2 = m.construirCuerpo(b1, 'MERGEADO + lanzado #2280 (labels de bloqueo limpiadas si las había).', 'T2');
caso('mensaje MERGEADO → consta merge', m.stickyMergeado(c(9, b2)));
const b3 = m.construirCuerpo(b2, 'serie libre (merge del suelto #7): armado el siguiente de la cola, #8.', 'T3', { pop: 8 });
caso('diag POSTERIOR al merge sin «MERGEADO» → el merge SIGUE constando (defecto 2 de #245)', m.stickyMergeado(c(9, b3)));
caso('…y el pop del merge queda registrado', m.estadoDe(b3).pops.join() === '8');
const b4 = m.construirCuerpo(b3, 'manual: otra cosa', 'T4');
caso('el estado se arrastra en reescrituras sucesivas', m.stickyMergeado(c(9, b4)) && m.estadoDe(b4).pops.join() === '8');
caso('«mergeado pero lanzar #N falló» → consta merge', m.stickyMergeado(c(9, m.construirCuerpo(null, 'mergeado pero lanzar #3 falló: x', 'T'))));
caso('«MERGE FALLÓ» → NO consta merge', !m.stickyMergeado(c(9, m.construirCuerpo(null, 'MERGE FALLÓ: 405 (¿ya mergeado / …)', 'T'))));
caso('legacy con «MERGEADO» en su línea de mensaje → consta merge', m.stickyMergeado(legacy));
caso('dedupe manual acotado al sticky: una review que cita «MERGEADO» y el marcador no cuenta',
  !m.stickyMergeado(m.seleccionarSticky([review, cercado], PAT)));
const pre = m.construirCuerpo(b1, 'serie libre (barrido): armado #5.', 'T', { pop: 5 });
caso('pop PRE-merge (barrido del finally) NO se registra como pop del merge', m.estadoDe(pre).pops.length === 0);
caso('sin sticky no consta merge (el camino manual procesa)', !m.stickyMergeado(null));

// ── Idempotencia de armQueue por merge (ruling, punto 5 / #264) ────────────
// Simulación del estado que ven dos evaluaciones del MISMO merge (PR #20):
// la cola arranca con [#21, #22] y cada arm retira `en-cola` de su elegido.
function simular({ escribeSticky = true } = {}) {
  const cola = [21, 22];
  const comentarios = { 21: [], 22: [] };
  let sticky = c(100, m.construirCuerpo(null, 'MERGEADO (suelto #19). Lanzando siguiente…', 'T0'));
  const arms = [];
  for (let evaluacion = 0; evaluacion < 2; evaluacion++) {
    const next = cola[0];
    if (!next) break;
    const ya = m.popYaEmitido({ sticky, comentariosSiguiente: comentarios[next], next, pr: 20, login: PAT });
    if (ya) continue;
    cola.shift();
    comentarios[next].push(c(200 + evaluacion, `@claude arranca — turno de cola.\n\n<!-- arm-de-cola -->\n${m.marcadoresPop(next, 20)}`));
    arms.push(next);
    if (escribeSticky) sticky = c(100, m.construirCuerpo(sticky.body, `serie libre: armado #${next}.`, 'T1', { pop: next }));
    else cola.unshift(next); // el guard lo re-encola: la 2.ª evaluación ve la MISMA cabeza
  }
  return arms;
}
caso('dos evaluaciones sobre el mismo merge ⇒ un solo arm (issues distintos, ciclo 2 de #264)', simular().join() === '21');
caso('dos evaluaciones, sticky sin escribir ⇒ un solo arm (mismo issue, ciclo 1 de #264)', simular({ escribeSticky: false }).join() === '21');
const armPrevio = c(300, `@claude arranca.\n\n<!-- arm-de-cola -->\n${m.marcadoresPop(21, 20)}`);
caso('issue re-encolado tras el pop de OTRO merge ⇒ se puede armar (liveness de la cola)',
  m.popYaEmitido({ sticky: null, comentariosSiguiente: [armPrevio], next: 21, pr: 30, login: PAT }) === null);
caso('marcadores de pop CITADOS entre backticks no cuentan',
  m.popYaEmitido({ sticky: null, comentariosSiguiente: [c(301, 'el arm lleva `<!-- serial-pop: #21 -->` y `<!-- serial-pop-origen: #20 -->`')], next: 21, pr: 20, login: PAT }) === null);
caso('sin PR (cierre por estado) no hay merge que deduplicar',
  m.popYaEmitido({ sticky: null, comentariosSiguiente: [armPrevio], next: 21, pr: null, login: PAT }) === null);
caso('arm sin PR lleva solo el marcador del ruling', m.marcadoresPop(21, null) === '<!-- serial-pop: #21 -->');

if (fallos.length) {
  console.error(`CHECK-EPIC-MERGE-DIAG ROJO (${fuente}): ${fallos.length} caso(s) fallan:`);
  for (const f of fallos) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check-epic-merge-diag verde (${fuente}): todos los casos pasan.`);
