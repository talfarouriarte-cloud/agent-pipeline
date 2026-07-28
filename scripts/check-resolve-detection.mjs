#!/usr/bin/env node
// check-resolve-detection — banco de casos EJECUTABLE de la detección de
// declaraciones cross-issue del post-step `resolve-cross-issue-failsafe`
// (AP-064). Nacido del hallazgo 🟡 4 de la ronda 2 de la review.
//
// Por qué existe: el belt decide si materializa una transición leyendo PROSA
// ESPAÑOLA con cuatro regexes (`DES_STALL`, `ARM`, `AMBIGUO`, `FUTURO`), y ahí
// ya han fallado DOS veces por la misma causa —`á` no es `\w` en JS, así que
// `retir\w*` se corta antes de la tilde y `\b` tras `á` no existe—, las dos
// veces cazadas EJECUTANDO el banco, no releyendo el diff. Un banco que vive
// en un comentario de un hilo de PR es disciplina sin consumidor: en cuanto
// alguien toca una regex, la evidencia ya no está y el cambio se juzga
// leyendo, que es exactamente lo que falló.
//
// AP-068 — QUÉ CAMBIÓ Y POR QUÉ IMPORTA. Hasta aquí este banco (a) extraía las
// regexes con un regex-sobre-texto del `.patch` o del `.yml`, porque el código
// estaba secuestrado dentro de `.github/workflows/**` y no había módulo que
// importar, y (b) REIMPLANTABA el pipeline de derivación (identidad →
// segmentación → acción → refs → polaridad), con un residual declarado en su
// propio comentario: «si el step cambia de FORMA, esta función tiene que
// cambiar con él». Eran dos formas que alguien tenía que mantener sincronizadas
// a mano — un mandato de memoria (clase AP-008) dentro del gate que existe para
// no tenerlos. Con el belt extraído a `vendored/scripts/…cjs` el banco
// EJECUTA la función real: no hay copia que pueda derivar, y un cambio de forma
// —no solo de regex— se juzga aquí.
//
// Verde: exit 0. Rojo: la derivación real cambió y el banco lo nota.
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

// El central lo tiene en `vendored/`; el workspace del consumidor lo recibe en
// `scripts/` por el graft (AP-009). Se prueba el del central primero: es el
// fichero FUENTE, y es el que un PR modifica.
const FUENTES = [
  'vendored/scripts/resolve-cross-issue-failsafe.cjs',
  'scripts/resolve-cross-issue-failsafe.cjs',
];

let fuente = null;
let belt = null;
for (const f of FUENTES) {
  if (!existsSync(f)) continue;
  belt = require(resolve(f));   // un SyntaxError aquí es ROJO, y debe serlo
  fuente = f;
  break;
}
if (!belt) {
  // Fail-open ANUNCIADO, nunca mudo: si el módulo no está, no hay nada que
  // juzgar — pero que no lo haya tiene que verse.
  console.log('::warning::check-resolve-detection — no encuentro `resolve-cross-issue-failsafe.cjs` en ninguna de sus dos ubicaciones: el banco NO se ha ejecutado.');
  process.exit(0);
}

const { derivar } = belt;
if (typeof derivar !== 'function') {
  console.error('CHECK-RESOLVE-DETECTION ROJO: `resolve-cross-issue-failsafe.cjs` ya no exporta `derivar` — el banco quedaría mudo sin decirlo.');
  process.exit(1);
}

const ROL_MARK = '<!-- watchdog-rol: architect-resolve -->';
const CAPA = '<!-- watchdog-capa: schedule -->';
const cmt = (body, { host = 1696, rol = true } = {}) => ({ host, body: `${body}\n\n${CAPA}${rol ? `\n${ROL_MARK}` : ''}` });

// esperado: { decl, avisos } — `avisos` se compara por CLASE.
const CASOS = [
  ['INSTANCIA fp#1711', [cmt('`stalled` retirada de #1694 y re-arm del eslabón 1/3 allí (detalle en su hilo).')],
    { 1694: { desStall: true, arm: true } }, []],
  ['solo des-stall', [cmt('Retirada la label `stalled` de #1694.')], { 1694: { desStall: true, arm: false } }, []],
  ['solo arm', [cmt('Re-arm del eslabón 1/3 en #1694.')], { 1694: { desStall: false, arm: true } }, []],
  ['negado', [cmt('No retiro `stalled` de #1694 hasta que el humano decida.')], {}, ['negada/condicional/pospuesta']],
  ['condicional', [cmt('Habría que re-armar #1694 si el CI sale verde.')], {}, ['negada/condicional/pospuesta']],
  ['pendiente', [cmt('Queda pendiente el re-arm de #1694.')], {}, ['negada/condicional/pospuesta']],
  ['in-thread (sin #N ajeno)', [cmt('Retirada la label `stalled` y re-armado el turno.')], {}, []],
  ['auto-ref', [cmt('Retirada la label `stalled` de #1696 y re-arm allí.', { host: 1696 })], {}, []],
  ['multi-ref', [cmt('Re-arm de #1694 y #1695 en el mismo movimiento.')], {}, ['multi-ref']],
  ['prosa sin accion', [cmt('El diagnóstico de #1694 queda publicado en su hilo.')], {}, []],
  ['dentro de code fence', [cmt('Ejemplo de lo que NO hice:\n```\nre-arm de #1694\n```')], {}, []],
  ['mencion en marcador', [cmt('Sin acción.\n<!-- launch-next: #1694 re-arm -->')], {}, []],
  ['(a) Creator sin marcador de rol', [cmt('Re-arm del eslabón 1/3 en #1694.', { rol: false })], {}, []],
  ['(a-bis) MISMA prosa CON marcador', [cmt('Cierro el turno: el eslabón 3/3 (#1695) se armará al mergear este PR.')], {}, ['futuro/intención']],
  ['(b) intención «voy a re-armar»', [cmt('Voy a re-armar #1694 en cuanto termine aquí.')], {}, ['futuro/intención']],
  ['(b-bis) «procedo a retirar»', [cmt('Procedo a retirar la label `stalled` de #1694.')], {}, ['futuro/intención']],
  ['(d) pretérito «retiré/re-armé»', [cmt('Retiré la label `stalled` de #1694 y re-armé el eslabón 1/3 allí.')], { 1694: { desStall: true, arm: true } }, []],
  ['(e) post-step hermano ping-creator', [{ host: 1696, body: `**watchdog · ping-creator**: arm materializado en #1694.\n<!-- ping-creator-materializado -->\n${CAPA}` }], {}, []],
  // Ronda 2, 🟡 2: los OTROS emisores de `watchdog-capa:` que la lista negra no
  // cubría. El de AP-055 interpola encabezados ARBITRARIOS de `decisions.md`:
  // el día que una rectificación se titule con vocabulario de arm, la lista
  // negra habría dejado pasar el vector. El guard positivo no.
  ['(f) rectificación en vuelo (AP-055) con vocabulario de arm', [{ host: 1696, body: `**watchdog**: rectificación EN VUELO — «### Revisión R·1 (2026-07-15, issue #1694) — re-arm del eslabón»\n${CAPA}` }], {}, []],
  ['(g) circuit-breaker', [{ host: 1696, body: `**watchdog · circuit-breaker**: re-arm de #1694 suspendido.\n${CAPA}` }], {}, []],
  // Ronda 2, 🟡 2 / epic-merge: un marcador CITADO no es un marcador emitido
  // (misma clase que AP-063: EFECTUAR ≠ CITAR). Esta review, que cita el
  // marcador entre backticks y habla de re-armar #1694, NO es del resolver.
  ['(h) review que CITA el marcador de rol', [{ host: 1696, body: 'El belt exige `<!-- watchdog-rol: architect-resolve -->`; sin él no materializa el re-arm de #1694.' }], {}, []],
  ['(i) marcador de rol dentro de un bloque cercado', [{ host: 1696, body: 'Así se emite:\n```\n<!-- watchdog-rol: architect-resolve -->\n```\nY re-armé #1694.' }], {}, []],
  // Ronda 3, 🟡 3 — CASO DE CONGELACIÓN, no de corrección. El guard de
  // identidad resuelve QUIÉN habla, no DE QUIÉN es la acción: el resolver
  // NARRANDO en pasado un arm ajeno se deriva como declaración propia
  // (`ARM` casa «re-armado»; `AMBIGUO` no casa —«quedó» no es «queda»—; y
  // `FUTURO` tampoco, porque es pretérito, que es la forma que el mandato
  // PIDE). Si ese arm ajeno cae fuera de la ventana del job, el belt re-arma:
  // es el ÚNICO frente donde no cae del lado seguro (fail-activo), acotado por
  // el guard serial y por MAX=3. Se acepta declarado —residual (f) de AP-064—
  // a cambio de no meter heurística de atribución en prosa libre. El esperado
  // de abajo es el comportamiento ACTUAL: si alguien lo cambia, que sea
  // mirando este caso y no descubriéndolo en producción.
  ['(j) NARRACIÓN de un arm ajeno (fail-activo declarado)', [cmt('El eslabón 2/3 (#1695) ya quedó re-armado por epic-merge al mergear.')], { 1695: { desStall: false, arm: true } }, []],
  // AP-068 — el belt ya no lee el `host` de un campo que el banco inventaba:
  // `derivar` lo recibe calculado, y un comentario sin host no puede
  // atribuirse a nadie. Caso nuevo, cubre la rama `if (!host) continue`.
  ['(k) comentario sin host derivable', [{ host: NaN, body: `Re-arm del eslabón 1/3 en #1694.\n${ROL_MARK}` }], {}, []],
];

// `derivar` devuelve además `host`/`url` por declaración (los necesita el
// runtime para componer la cita). El banco juzga SOLO el par acción→issue:
// comparar el objeto entero ataría el test a datos de presentación.
const soloAcciones = (decl) => Object.fromEntries(
  Object.entries(decl).map(([n, d]) => [n, { desStall: d.desStall, arm: d.arm }]),
);

const fallos = [];
const lineas = [];
for (const [nombre, comentarios, decl, avisos] of CASOS) {
  const got = derivar(comentarios);
  const gotDecl = soloAcciones(got.decl);
  const gotClases = got.avisos.map((a) => a.clase);
  const okDecl = JSON.stringify(gotDecl) === JSON.stringify(decl);
  const okAviso = gotClases.length === avisos.length && avisos.every((w, i) => gotClases[i] === w);
  if (!okDecl || !okAviso) {
    fallos.push(`${nombre}: esperado decl=${JSON.stringify(decl)} avisos=${JSON.stringify(avisos)} — obtenido decl=${JSON.stringify(gotDecl)} avisos=${JSON.stringify(gotClases)}`);
  }
  lineas.push(`  ${okDecl && okAviso ? '·' : '✗'} ${nombre.padEnd(46)} decl=${JSON.stringify(gotDecl)} avisos=${JSON.stringify(gotClases)}`);
}

if (process.env.RESOLVE_DETECTION_VERBOSE) lineas.forEach((l) => console.log(l));
if (fallos.length) {
  console.error(`CHECK-RESOLVE-DETECTION ROJO (derivación real de ${fuente}):`);
  fallos.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`check-resolve-detection verde: ${CASOS.length} casos del banco de AP-064 sobre la derivación REAL de ${fuente} (no una copia).`);
