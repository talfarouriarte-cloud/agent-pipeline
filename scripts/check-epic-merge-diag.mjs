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
import { existsSync, readFileSync } from 'fs';
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

// ── El estado sale del HECHO, no del texto (review de AP-093, 🔴 1) ────────
// Suelto con `loose_audit=true` y `issues.create` de la auditoría en 5xx:
// `createAuditIdempotent` diagnostica «crear auditoría … falló» y devuelve null
// SIN lanzar, así que ningún diag dice «mergeado». Con el estado derivado del
// mensaje, el pop se descartaba, el `closed` del mismo merge se declaraba
// «merge MANUAL» y el 2.º `armQueue` armaba la cabeza nueva: #21 y #22 por UN
// merge (ciclo 2 de #264). `merged` es `mergeEnEsteJob` del reusable.
const f0 = m.construirCuerpo(b1, 'suelto #19 sin label de épica: régimen de SUELTO.', 'T0');
const f1 = m.construirCuerpo(f0, 'crear auditoría «Auditoría #19» falló: 502 Bad Gateway', 'T1', { merged: true });
caso('merge en este job + mensaje sin «mergeado» (crear auditoría falló) ⇒ consta merge', m.stickyMergeado(c(9, f1)));
const f2 = m.construirCuerpo(f1, 'serie libre (merge del suelto #19): armado el siguiente de la cola, #21.', 'T2', { pop: 21, merged: true });
caso('…y el pop de ese merge queda registrado', m.estadoDe(f2).pops.join() === '21');
caso('…y el `closed` del mismo merge NO se declara «merge MANUAL»', m.stickyMergeado(c(9, f2)));
caso('…y el 2.º armQueue (cabeza nueva #22) es no-op (a)',
  m.popYaEmitido({ sticky: c(9, f2), comentariosSiguiente: [], next: 22, pr: 20, login: PAT }) !== null);
caso('evaluación PRE-merge (`merged: false`) con pop del barrido ⇒ ni merge ni pop',
  (() => { const b = m.construirCuerpo(f0, 'serie libre (barrido): armado #5.', 'T', { pop: 5, merged: false }); return !m.stickyMergeado(c(9, b)) && m.estadoDe(b).pops.length === 0; })());
// Costura con el reusable: el hecho solo protege si `diag()` lo pasa. En el
// consumidor el workflow no existe (llega por `workflow_call`): se omite.
const WF = '.github/workflows/epic-merge.yml';
if (existsSync(WF)) {
  const wf = readFileSync(WF, 'utf8');
  caso('epic-merge.yml: `diag()` pasa `merged: mergeEnEsteJob` a `construirCuerpo`',
    /EMD\.construirCuerpo\([^\n]*merged:\s*mergeEnEsteJob/.test(wf));
  caso('epic-merge.yml: `mergeEnEsteJob` se declara ANTES de `diag()` (sin zona muerta del `let`)',
    wf.indexOf('let mergeEnEsteJob') !== -1 && wf.indexOf('let mergeEnEsteJob') < wf.indexOf('async function diag('));
  caso('epic-merge.yml: `postMerge` fija `mergeEnEsteJob = true`',
    /async function postMerge\([^)]*\)\s*\{[^]*?mergeEnEsteJob = true/.test(wf));
}

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

// ── Reintento de «Base branch was modified» (central#333, AP-125) ──────────
const BBM = 'Base branch was modified. Review and try the merge again.';
caso('reintento: «Base branch was modified» con 0 previos ⇒ update-branch', m.decidirReintentoMerge({ mensaje: BBM, reintentosPrevios: 0 }).accion === 'update-branch');
caso('reintento: con 2 previos ⇒ update-branch', m.decidirReintentoMerge({ mensaje: BBM, reintentosPrevios: 2 }).accion === 'update-branch');
caso('reintento: con 3 previos ⇒ stalled', m.decidirReintentoMerge({ mensaje: BBM, reintentosPrevios: 3 }).accion === 'stalled');
caso('reintento: otro mensaje ⇒ diag (statu quo)', m.decidirReintentoMerge({ mensaje: 'Required status check "ci" is expected.', reintentosPrevios: 0 }).accion === 'diag');
caso('reintento: cap 3 y marcador literal del ruling (con head sha)', m.MERGE_RETRY_CAP === 3 && m.marcadorReintento('abc1234') === '<!-- merge-retry-base-modified: abc1234 -->');
caso('reintento: el contador cuenta marcadores de CUALQUIER sha y no las citas sin sha',
  m.contarReintentos([{ body: m.marcadorReintento('abc1234') }, { body: `x\n${m.marcadorReintento('def5678')}` }, { body: 'cita `merge-retry-base-modified`' }]) === 2);
caso('reintento (c′): base modificada con 3 previos e intento5xx 1 ⇒ stalled (AP-125 §3 intacta)', m.decidirReintentoMerge({ mensaje: BBM, reintentosPrevios: 3, intento5xx: 1 }).accion === 'stalled');

// ── Reintento ante 5xx de GitHub en el mismo run (central#412, AP-141) ─────
const d5 = (o) => m.decidirReintentoMerge(o).accion;
caso('5xx (a): status 500, intento5xx 1 ⇒ reintentar-5xx', d5({ mensaje: 'Server Error', status: 500, intento5xx: 1 }) === 'reintentar-5xx');
caso('5xx (b): status 502, intento5xx 2 ⇒ reintentar-5xx', d5({ mensaje: 'Bad Gateway', status: 502, intento5xx: 2 }) === 'reintentar-5xx');
caso('5xx (c): status 503, intento5xx 3 ⇒ stalled-5xx', d5({ mensaje: 'Service Unavailable', status: 503, intento5xx: 3 }) === 'stalled-5xx');
caso('5xx (d): sin status, mensaje «Server Error», intento5xx 1 ⇒ reintentar-5xx', d5({ mensaje: 'Server Error', intento5xx: 1 }) === 'reintentar-5xx');
caso('5xx (d′): sin status, «Gateway Timeout» y «Gateway Time-out» ⇒ reintentar-5xx', d5({ mensaje: 'Gateway Timeout', intento5xx: 1 }) === 'reintentar-5xx' && d5({ mensaje: 'Gateway Time-out', intento5xx: 1 }) === 'reintentar-5xx');
caso('5xx (e): status 422 «Pull Request has merge conflicts» ⇒ diag (sin cambio)', d5({ mensaje: 'Pull Request has merge conflicts', status: 422, intento5xx: 1 }) === 'diag');
caso('5xx (f): «Base branch was modified» (status 405) ⇒ update-branch (sin cambio)', d5({ mensaje: BBM, status: 405, reintentosPrevios: 0, intento5xx: 0 }) === 'update-branch');
caso('5xx: un status 4xx con mensaje de 5xx manda el status ⇒ diag', d5({ mensaje: 'Server Error', status: 403, intento5xx: 1 }) === 'diag');
caso('5xx: llamada de hoy (sin status ni intento5xx) con otro mensaje ⇒ diag', d5({ mensaje: 'Required status check "ci" is expected.', reintentosPrevios: 0 }) === 'diag');
caso('5xx: cap 3 y marcador literal con head sha', m.MERGE_5XX_CAP === 3 && m.marcadorReintento5xx('abc1234') === '<!-- merge-retry-5xx: abc1234 -->');

if (existsSync('.github/workflows/epic-merge.yml')) {
  const y = readFileSync('.github/workflows/epic-merge.yml', 'utf8');
  const ini = y.indexOf('} catch (e0) {');
  const fin = y.indexOf('} catch (eB) {', ini);
  const bloque = ini >= 0 && fin > ini ? y.slice(ini, y.indexOf('\n              }\n', fin)) : '';
  const bucleIni = bloque.indexOf('while (e) {');
  const bucle = bucleIni >= 0 ? bloque.slice(bucleIni) : '';
  caso('costura: el catch del merge clasifica con `status: e.status` y el conteo de base modificada',
    /EMD\.decidirReintentoMerge\(\{ mensaje: e\.message, status: e\.status, reintentosPrevios: 0, intento5xx \}\)/.test(bloque)
    && /EMD\.decidirReintentoMerge\(\{ mensaje: e\.message, status: e\.status, reintentosPrevios: previos, intento5xx \}\)/.test(bloque));
  caso('costura: marcador `merge-retry-5xx` en un try que solo hace core.warning',
    /try \{\s*await github\.rest\.issues\.createComment\([^]*?EMD\.marcadorReintento5xx\(shaGate\)[^]*?\} catch \(eC\) \{ core\.warning\([^)]*\); \}/.test(bloque));
  caso('costura: esperas de 30 s y 60 s', /ESPERAS_5XX_MS = \[30000, 60000\]/.test(bloque) && /await espera\(ESPERAS_5XX_MS\[intento5xx - 1\]\)/.test(bloque));
  caso('costura: tope de 3 intentos por `MERGE_5XX_CAP` del módulo (stalled-5xx)', /r\.accion === 'stalled-5xx'/.test(bloque) && /rr\.accion === 'stalled-5xx'/.test(bloque));
  caso('costura: relectura de head, labels y behind antes de cada reintento',
    /github\.rest\.pulls\.get\(\{ owner, repo, pull_number: prNumber \}\)/.test(bucle)
    && /fr\.head\.sha !== shaGate/.test(bucle) && /lbs\.includes\('lgtm'\)/.test(bucle) && /lbs\.includes\('ci-verde'\)/.test(bucle)
    && /fr\.mergeable_state === 'behind'/.test(bucle)
    && bucle.indexOf('pulls.get(') < bucle.lastIndexOf("pulls.merge({ owner, repo, pull_number: prNumber, merge_method: 'squash', sha: shaGate })"));
  caso('costura: el bucle va en su propio try (catch eB, sin subir al catch exterior)', /try \{\s*while \(e\) \{/.test(bloque) && bloque.includes('} catch (eB) {'));
  const lineas = bucle.split('\n');
  const sinSalida = lineas.filter((l, i) => /\breturn;/.test(l) && !/(diag|stalled5xx)\(/.test(l) && !/(diag|stalled5xx)\(/.test(lineas[i - 1] || ''));
  caso('costura: ningún `return` del bucle sin `diag` o `stalled`', bucle.length > 0 && /\breturn;/.test(bucle) && sinSalida.length === 0);

  // El `catch` REAL del YAML ejecutado con un `github` simulado (esperas a 0).
  const finCatch = y.indexOf('\n              }\n', fin);
  const cuerpo = ini >= 0 && finCatch > ini ? y.slice(ini + 1, finCatch + 16) : '';
  const E = (status, msg) => Object.assign(new Error(msg), { status });
  const sim = async (merges, gets = []) => {
    const log = []; let gi = 0;
    const github = { paginate: async () => [], rest: {
      issues: { createComment: async (o) => { log.push(`comment#${o.issue_number}`); }, addLabels: async (o) => { log.push(`label:${o.labels}`); }, deleteComment: async () => {} },
      pulls: {
        merge: async () => { log.push('merge'); const x = merges.shift(); if (x) throw x; },
        updateBranch: async () => { log.push('update'); },
        get: async () => { log.push('get'); const g = gets[gi++] || {}; if (g instanceof Error) throw g;
          return { data: { head: { sha: g.sha || 'abc1234' }, labels: (g.labels || ['lgtm', 'ci-verde']).map((name) => ({ name })), mergeable_state: g.ms || 'clean', merged: !!g.merged } }; } } } };
    const core = { warning: () => {}, notice: () => {}, setFailed: () => log.push('failed') };
    const diag = async (_p, msg) => { log.push(`diag:${msg}`); };
    const f = new Function('github', 'core', 'diag', 'EMD', 'pf', 'owner', 'repo', 'prNumber', 'issueNumber', 'marcarUpdateBranch', 'desmarcarUpdateBranch', 'setTimeout', 'primero',
      `return (async () => { try { throw primero; } ${cuerpo} return 'mergeado'; })();`);
    const fin_ = await f(github, core, diag, m, { head: { sha: 'abc1234' } }, 'o', 'r', 7, 9, async () => 1, async () => {}, (fn) => fn(), merges.shift());
    return { fin: fin_ || 'sin-merge', log, merges: log.filter((l) => l === 'merge').length, stalled: log.includes('label:stalled') };
  };
  try {
    let r = await sim([E(500, 'Server Error'), null]);
    caso('sim: 500 y luego merge ⇒ mergeado en el mismo run', r.fin === 'mergeado' && r.merges === 1 && r.log.includes('get'));
    r = await sim([E(500, 'Server Error'), E(502, 'Bad Gateway'), E(503, 'Service Unavailable')]);
    caso('sim: 5xx ×3 ⇒ 3 intentos de merge en total y `stalled`', r.fin === 'sin-merge' && r.merges === 2 && r.stalled && r.log.some((l) => /5xx de GitHub ×3/.test(l)));
    r = await sim([E(500, 'Server Error'), E(409, 'moved')]);
    caso('sim: 5xx y luego 409 ⇒ diag sin reintento (AP-139)', !r.stalled && r.merges === 1 && r.log.some((l) => /head movido entre gate y merge/.test(l)));
    r = await sim([E(500, 'Server Error')], [{ sha: 'def5678' }]);
    caso('sim: head movido en la relectura ⇒ diag, sin merge', r.merges === 0 && !r.stalled && r.log.some((l) => /head movido durante el reintento 5xx/.test(l)));
    r = await sim([E(500, 'Server Error')], [{ labels: ['lgtm'] }]);
    caso('sim: `ci-verde` retirada en la relectura ⇒ diag sin stalled', r.merges === 0 && !r.stalled && r.log.some((l) => /gates retirados/.test(l)));
    r = await sim([E(500, 'Server Error')], [{ ms: 'behind' }]);
    caso('sim: rama behind en la relectura ⇒ updateBranch, sin merge', r.merges === 0 && r.log.includes('update'));
    r = await sim([E(500, 'Server Error')], [{ merged: true }]);
    caso('sim: el 5xx sí mergeó ⇒ sigue por postMerge', r.fin === 'mergeado' && r.merges === 0);
    r = await sim([E(500, 'Server Error')], [E(502, 'Bad Gateway'), E(504, 'Gateway Timeout')]);
    caso('sim: relectura con 5xx cuenta como intento ⇒ stalled al 3.º', r.stalled && r.merges === 0);
    r = await sim([E(500, 'Server Error')], [E(404, 'Not Found')]);
    caso('sim: relectura con error no 5xx ⇒ stalled', r.stalled && r.log.some((l) => /relectura falló/.test(l)));
    r = await sim([E(422, 'Pull Request has merge conflicts')]);
    caso('sim: 422 ⇒ diag, sin reintento (statu quo)', r.merges === 0 && !r.log.includes('get') && r.log.some((l) => /MERGE FALLÓ: Pull Request has merge conflicts/.test(l)));
    r = await sim([E(405, BBM)]);
    caso('sim: base modificada ⇒ updateBranch (AP-125 §3, statu quo)', r.log.includes('update') && r.log.some((l) => /base modificada \(1\/3\)/.test(l)));
  } catch (eS) { caso(`sim: el catch del YAML ejecuta sin excepción (${eS.message})`, false); }
}

if (fallos.length) {
  console.error(`CHECK-EPIC-MERGE-DIAG ROJO (${fuente}): ${fallos.length} caso(s) fallan:`);
  for (const f of fallos) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check-epic-merge-diag verde (${fuente}): todos los casos pasan.`);
