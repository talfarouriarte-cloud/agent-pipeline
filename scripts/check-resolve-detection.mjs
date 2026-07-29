#!/usr/bin/env node
// check-resolve-detection — banco de casos EJECUTABLE de la detección de
// declaraciones cross-issue del post-step `resolve-cross-issue-failsafe`
// (AP-064). Nacido del hallazgo 🟡 4 de la ronda 2 de la review.
//
// Por qué existe: el belt decide si materializa una transición leyendo PROSA
// ESPAÑOLA con el vocabulario anclado que `PATRONES` exporta —verbos de acción
// más filtros de polaridad y de atribución—, y ahí
// ya han fallado DOS veces por la misma causa —`á` no es `\w` en JS, así que
// `retir\w*` se corta antes de la tilde y `\b` tras `á` no existe—, las dos
// veces cazadas EJECUTANDO el banco, no releyendo el diff. Un banco que vive
// en un comentario de un hilo de PR es disciplina sin consumidor: en cuanto
// alguien toca una regex, la evidencia ya no está y el cambio se juzga
// leyendo, que es exactamente lo que falló.
//
// Esta cabecera NO enumera las regexes a propósito (🔵 3 de la review de
// AP-073): decía «cuatro (`DES_STALL`, `ARM`, `AMBIGUO`, `FUTURO`)» y ya eran
// seis. Es la clase que AP-070 cerró un piso más abajo con el gate
// `PATRONES`↔fuente —una enumeración que promete «todas» y se queda corta sin
// que nada se ponga rojo—, y aquí no hay gate barato posible. Una cabecera que
// no cuenta no se puede desactualizar: la lista viva es `PATRONES`, y su
// completitud SÍ está gateada más abajo.
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
import { existsSync, readFileSync } from 'fs';
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

// `PATRONES` COMPLETO — 🔵 3 de la review de AP-070. El módulo exporta su
// vocabulario de decisión bajo un nombre que promete «todos»; `CAPA_MARK`
// entró en AP-070 y se quedó fuera, sin que nada se pusiera rojo, porque hoy
// ese export no tiene consumidor. Un export sin consumidor no se cae: se
// PUDRE, y el día que un banco futuro lo consuma creyendo la promesa juzgará
// menos de lo que cree, en silencio. Añadir `CAPA_MARK` a mano habría sido el
// mismo mandato de memoria para el patrón siguiente; el gate es contrastar la
// lista contra el FUENTE. Es la única aserción del banco que mira el TEXTO del
// módulo y no su comportamiento — a propósito: lo que se juzga aquí es
// precisamente que la declaración y el código no divergen.
const fuenteTxt = readFileSync(fuente, 'utf8');
const REGEX_DECL = [...fuenteTxt.matchAll(/^const ([A-Z][A-Z_0-9]*) = \//gm)].map((m) => m[1]);
const PATRONES = belt.PATRONES || {};
const faltan = REGEX_DECL.filter((n) => !(n in PATRONES));
const sobran = Object.keys(PATRONES).filter((n) => !REGEX_DECL.includes(n));
if (faltan.length || sobran.length) {
  console.error(`CHECK-RESOLVE-DETECTION ROJO: \`PATRONES\` no es el vocabulario de decisión completo de ${fuente}${faltan.length ? ` — falta(n) ${faltan.join(', ')}` : ''}${sobran.length ? ` — sobra(n) ${sobran.join(', ')}` : ''}. Un export que promete «los patrones» y no los trae todos es lo que un banco futuro consumiría con confianza.`);
  process.exit(1);
}
if (!REGEX_DECL.length) {
  console.error(`CHECK-RESOLVE-DETECTION ROJO: no encuentro ningún \`const X = /…/\` en ${fuente} — la aserción de \`PATRONES\` sería vacua (pasaría con el módulo entero reescrito).`);
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
  // AP-070: sin marcador de ROL el belt sigue sin materializar NADA (`decl={}`,
  // que es lo que este caso probaba y sigue probando), pero la mudez ya no es
  // muda: se anuncia. Un comentario de la capa sin marcador era indistinguible
  // de «nadie declaró nada» — silencio leído como cobertura, la clase de #166
  // un piso por debajo de sí misma.
  ['(a) declaración de la capa SIN marcador de rol', [cmt('Re-arm del eslabón 1/3 en #1694.', { rol: false })], {}, ['sin-marcador-de-rol']],
  ['(a-bis) MISMA prosa CON marcador', [cmt('Cierro el turno: el eslabón 3/3 (#1695) se armará al mergear este PR.')], {}, ['futuro/intención']],
  ['(b) intención «voy a re-armar»', [cmt('Voy a re-armar #1694 en cuanto termine aquí.')], {}, ['futuro/intención']],
  ['(b-bis) «procedo a retirar»', [cmt('Procedo a retirar la label `stalled` de #1694.')], {}, ['futuro/intención']],
  ['(d) pretérito «retiré/re-armé»', [cmt('Retiré la label `stalled` de #1694 y re-armé el eslabón 1/3 allí.')], { 1694: { desStall: true, arm: true } }, []],
  // 🟡 2 de la review de AP-070 — CUERPOS VERBATIM, no prosa inventada. Estos
  // dos casos nacieron en AP-064 con fixtures aproximados, y AP-070 los estaba
  // promoviendo a «coste medido y congelado» sin contrastarlos contra el
  // emisor real: peso normativo sobre un cuerpo que nadie publica. Los de
  // abajo son literales de `.github/workflows/watchdog.yml` —`:1446`
  // (ping-creator) y `:281`/`:361` (circuit-breaker)—, con el `${CAPA}` que
  // ambos emiten. Los dos callan, y por razones que conviene tener escritas:
  // el de ping-creator porque «arm» suelto NO casa `ARM` (que exige
  // `arm{o,é,a,ar,ado}`) y porque `fp#1344` no casa el patrón de refs (le
  // precede `p`, no espacio ni puntuación); el del circuit-breaker porque no
  // trae ningún `#N` ni vocabulario de acción. Lo que asertan ahora es que los
  // emisores REALES de la capa no disparan el aviso — que es el dato que el AP
  // creía tener y no tenía.
  ['(e) post-step hermano ping-creator (cuerpo REAL, watchdog.yml:1446)', [{ host: 1696, body: `@claude — retoma según el diagnóstico del comentario anterior del watchdog (ping-creator sin mención de arm: co-ocurrencia materializada mecánicamente, fp#1344).\n\n<!-- ping-creator-materializado -->\n${CAPA}` }], {}, []],
  ['(g) circuit-breaker (cuerpo REAL, watchdog.yml:281/:361)', [{ host: 1696, body: `Doble rebote tras recuperación autónoma: cortacircuito. Requiere decisión humana.\n\n<!-- watchdog-circuit-breaker -->\n${CAPA}` }], {}, []],
  // Ronda 2, 🟡 2: los OTROS emisores de `watchdog-capa:` que la lista negra no
  // cubría. El de AP-055 interpola encabezados ARBITRARIOS de `decisions.md`:
  // el día que una rectificación se titule con vocabulario de arm, la lista
  // negra habría dejado pasar el vector. El guard positivo no.
  // AQUÍ, y solo aquí, queda CONGELADO el falso positivo del aviso — su coste
  // declarado. `(f)` es el único emisor REAL que lo dispara hoy: el diag de
  // AP-055 (`watchdog.yml:595`) interpola `${lista}`, cuyo `headTxt` (`:552`)
  // es el texto CRUDO de la línea de rectificación de `decisions.md`, luego un
  // encabezado con `#N` y vocabulario de arm sale verbatim en el cuerpo.
  // `(g-bis)` es HIPOTÉTICO y se marca como tal: representa la clase «post-step
  // determinista hermano cuya prosa sí deriva» para que el día que nazca uno el
  // banco ya diga qué pasa, no para medir el ruido de hoy. En los dos, `decl={}`
  // — cero acción: el falso positivo cuesta una línea de log y el falso NEGATIVO
  // que este AP cierra costaba una cadena parada. No se filtran con lista negra
  // de marcadores hermanos: se pudre en silencio (mismo argumento que eligió el
  // guard positivo para las acciones).
  ['(f) rectificación en vuelo (AP-055) con vocabulario de arm', [{ host: 1696, body: `**watchdog**: rectificación EN VUELO — «### Revisión R·1 (2026-07-15, issue #1694) — re-arm del eslabón»\n${CAPA}` }], {}, ['sin-marcador-de-rol']],
  ['(g-bis) hermano determinista HIPOTÉTICO con vocabulario de arm', [{ host: 1696, body: `**watchdog · hermano determinista**: re-arm de #1694 suspendido.\n${CAPA}` }], {}, ['sin-marcador-de-rol']],
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
  // ── AP-070: los tres bordes que acotan el aviso nuevo ──
  // Sin ellos el caso (a) sería una aserción sin límite: probaría que el aviso
  // salta, no que salta SOLO donde debe. Un aviso que salta siempre deja de ser
  // señal (misma doctrina que el nivel de log de AP-065), así que sus tres
  // fronteras se gatean junto con él y no se dejan a la lectura del diff.
  //
  // (l) Fuera de la capa: un comentario del Creator o del humano puede hablar
  // de re-armar #N sin ser jamás una declaración del resolver. Sin marcador de
  // CAPA no hay aviso — el aviso mide una capa, no el repo entero.
  ['(l) declaración FUERA de la capa (ni rol ni capa) ⇒ ni acción ni aviso', [{ host: 1696, body: 'Re-arm del eslabón 1/3 en #1694, como acordamos.' }], {}, []],
  // (m) EFECTUAR ≠ CITAR, también para el marcador de capa: documentar cómo se
  // cierra un comentario de la capa no convierte al documento en uno. Misma
  // trampa que ya destruyó una review por `body.includes(...)` (AP-063 /
  // `epic-merge.yml:127`). El marcador va DENTRO de un bloque cercado y en
  // línea propia —si no, `CAPA_MARK` no casaría ni sin despojar y el caso sería
  // vacuo respecto de lo que dice probar (lo era: lo cazó la mutación
  // «el aviso deja de despojar el código citado», que sobrevivió)— y la frase
  // de arm va FUERA, sin ambigüedad, para que el aviso dependa solo del
  // despojado.
  ['(m) marcador de CAPA citado en bloque cercado ⇒ sin aviso', [{ host: 1696, body: 'Así se cierra un comentario de esta capa:\n```\n<!-- watchdog-capa: schedule -->\n```\nY el re-arm de #1694 lo materializó el resolver.' }], {}, []],
  // (n) El aviso anuncia lo que se habría MATERIALIZADO, no lo que se mencionó:
  // una frase en futuro no declara ejecutada ninguna transición, luego no hay
  // nada que se haya quedado sin red y callar es lo correcto. Comparte
  // `escanear` con la rama que sí actúa, así que esta equivalencia no puede
  // derivar (por eso el escaneo se factorizó en vez de duplicarse).
  ['(n) sin rol, con capa, pero en FUTURO ⇒ sin aviso (nada que materializar)', [cmt('Voy a re-armar #1694 en cuanto termine aquí.', { rol: false })], {}, []],
  // ── AP-073: los cuatro casos siguientes son PROSA REAL, no sintética ──────
  // Los 4 filtros de polaridad anteriores se calibraron contra frases escritas
  // para el banco. Al correr esta misma `derivar` sobre los comentarios REALES
  // de architect-resolve del repo, el ruling de #166 (issuecomment-5107010600)
  // derivaba un arm sobre #171 desde dos segmentos LITERALES suyos, que van
  // aquí verbatim. Es la única familia de casos del banco cuya fuente es una
  // corrida de producción y no la imaginación del autor — y es la que encontró
  // el fallo que 28 casos sintéticos no vieron.
  ['(o) REAL fp/central #166: «el re-arm … se perdió» ⇒ reporte-de-fallo',
    [cmt('La anomalía real: el re-arm del parcial #171 se perdió — causa MEDIDA')], {}, ['reporte-de-fallo']],
  ['(p) REAL #166: «debía subir la ronda y re-armar este issue» ⇒ reporte-de-fallo',
    [cmt('Tras mergear #171 la rama post-merge de `epic-merge` debía subir la ronda y re-armar este issue.')], {}, ['reporte-de-fallo']],
  // (q) aísla `AUTO_DEST`: sin vocabulario de fallo, el único motivo para no
  // materializar es que el DESTINO de la acción es el propio hilo y el `#N`
  // ajeno es el objeto de otro verbo. Sin este caso, `AUTO_DEST` sería una
  // rama muerta — `FALLIDO` la tapa en los dos casos reales de arriba.
  ['(q) destino es el propio hilo, `#N` ajeno es otro objeto ⇒ destino-ambiguo',
    [cmt('Tras mergear #171, re-armé este issue.')], {}, ['destino-ambiguo']],
  // (r) La INSTANCIA CANÓNICA no puede caer con los filtros nuevos: lleva «en
  // su hilo», que es a un carácter de distancia de `AUTO_DEST`. Duplica a
  // propósito el caso de cabecera del banco — si un día alguien mete `su hilo`
  // en `AUTO_DEST`, el belt se queda mudo justo en el caso que lo justifica y
  // este caso es el que lo dice.
  ['(r) canónica con «en su hilo» SIGUE materializando (anti-regresión AP-073)',
    [cmt('`stalled` retirada de #1694 y re-arm del eslabón 1/3 allí (detalle en su hilo).')],
    { 1694: { desStall: true, arm: true } }, []],
  // ── 🟡 1 de la review de AP-073: «este MISMO issue» ───────────────────────
  // `AUTO_DEST` nació exigiendo que `issue`/`hilo` fuera INMEDIATAMENTE detrás
  // de `este`, y dejaba fuera la variante con `mismo` — que es justo la forma
  // que la fila de `protocol.md` y el mensaje del propio aviso usan para
  // describir el filtro, y que aparece en 7 comentarios REALES de este repo
  // (medido con la misma sonda que produjo el AP). La dirección del fallo es la
  // mala: sin cubrirla el belt no calla, deriva y materializa sobre el `#N`
  // ajeno. Mutación que lo fija: quitar `(?:mismo\s+)?` de `AUTO_DEST` devuelve
  // este caso a `decl={"171":{arm:true}}`.
  ['(q-bis) «este MISMO issue» como destino ⇒ destino-ambiguo',
    [cmt('Tras mergear #171, re-armé este mismo issue.')], {}, ['destino-ambiguo']],
  // ── 🟡 2 de la review de AP-073: el COSTE de `AUTO_DEST`, CONGELADO ───────
  // AQUÍ, y solo aquí, queda fijado el falso NEGATIVO que `AUTO_DEST` compra —
  // su precio declarado, no un defecto que alguien deba «arreglar». El filtro
  // mira el SEGMENTO entero, no la cláusula que rige el verbo de acción: una
  // declaración cross-issue LEGÍTIMA que además mencione «este issue» por otro
  // motivo deja al belt mudo sobre el `#N` real. La frase de abajo está dentro
  // del vocabulario que el mandato le PIDE al resolver (pretérito, un solo
  // segmento: sin `.;!?` intermedio no hay corte) y antes de AP-073
  // materializaba #1694.
  // Se acepta porque es fail-open —cero acción, nunca acción de más— y porque
  // la alternativa (parser de dependencias sobre prosa libre) falla del lado
  // peligroso; se CONGELA porque el precedente del repo es congelar el coste y
  // no dejarlo a la lectura del diff (AP-070 hizo lo mismo con `(f)`/`(g-bis)`
  // para el falso positivo del aviso). Sin este caso, el día que alguien vea al
  // belt callar sobre una declaración buena no tendrá dónde leer que era el
  // precio pactado, y lo «arreglará» aflojando `AUTO_DEST` — que es justo lo
  // que `(r)` impide en la otra dirección.
  ['(s) COSTE declarado: declaración LEGÍTIMA que además dice «este issue» ⇒ mudo',
    [cmt('Retiré `stalled` de #1694 y re-armé el eslabón allí, dejando este issue listo para el merge.')],
    {}, ['destino-ambiguo']],
  // ── AP-076: el belt es INMUNE a la deriva de paginación que sí mordía a la
  // sonda. Los dos paginan el mismo endpoint en `desc`, y paginar por `page=N`
  // una lista que muta REPITE el elemento del corte cuando alguien comenta a
  // mitad de barrido. En la sonda eso ensuciaba el ledger (entradas con el mismo
  // `id` ⇒ corrupto según su propia L1) y se arregló deduplicando. Aquí NO hace
  // falta —`decl` es una UNIÓN keyada por `#N`, como dice el comentario de la
  // paginación del módulo—, y esa inmunidad pasa de ser una afirmación en prosa
  // a ser una aserción: si alguien convirtiera `decl` en algo acumulativo (un
  // contador, una lista de acciones), este caso lo diría. El comentario va
  // DUPLICADO a propósito, que es exactamente lo que la deriva entrega.
  ['(t) el MISMO comentario dos veces (deriva de paginación) ⇒ `decl` idéntica',
    [cmt('`stalled` retirada de #1694 y re-arm del eslabón 1/3 allí (detalle en su hilo).'),
      cmt('`stalled` retirada de #1694 y re-arm del eslabón 1/3 allí (detalle en su hilo).')],
    { 1694: { desStall: true, arm: true } }, []],
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

// ── Contrato de RUNTIME del belt: la costura módulo↔stub y los GUARDS ────────
// El banco de arriba juzga la DERIVACIÓN; esto juzga lo que decide si el belt
// ESCRIBE, que es la otra mitad del comportamiento.
//
// Nació (AP-068, ronda 1 🟡 3) cubriendo solo la COSTURA, el único punto del
// mecanismo sin gate y con deriva ASIMÉTRICA: el stub que invoca el módulo vive
// en `watchdog.yml` (parche pendiente, no pusheable por un agente, no parseado
// mientras lo esté) y el módulo sí es pusheable. Un rename de `skipLabels`
// pasaba el banco y el CI en verde y apagaba el kill-switch por label de
// exclusión EN RUNTIME, en silencio.
//
// AP-069 lo AMPLÍA al resto de guards, que era el residual (d) declarado de
// AP-068 —«el dedupe por ventana, la clasificación de issue virgen, el 404
// benigno de `removeLabel` y el tope `MAX` siguen sin caso»—. La razón para
// cerrarlo ahora y no «cuando el belt se despliegue» es que la asimetría es la
// MISMA que motivó la costura: estos guards viven en el módulo pusheable, su
// única prueba en producción llega el día que el humano aplique el parche, y
// para entonces cualquier deriva introducida entre medias se estrena en
// runtime. Cada guard falla además hacia el lado CARO —materializar donde no
// debía, o afirmar en prosa un estado que no se alcanzó, que es literalmente la
// clase que AP-064 existe para cerrar—, así que la ausencia de caso no era
// coste cero mientras tanto: era la ventana abierta.
//
// El caso de CONTROL no es decorativo: sin él los casos negativos serían vacuos
// (pasarían también si el doble no llegara nunca al punto de escritura).
const DECL = `\`stalled\` retirada de #1694 y re-arm del eslabón 1/3 allí.\n${CAPA}\n${ROL_MARK}`;
const { MARK } = belt;
// Mismo molde que los guards de `derivar` y del runtime: si el módulo deja de
// exportar el marcador, el banco se pone rojo igual —por «ningún cuerpo
// publicado contiene `undefined`»— pero sin nombrar la causa, y el caso del
// dedupe por ventana pasaría a construir su comentario con `undefined` dentro.
if (typeof MARK !== 'string' || !MARK) {
  console.error('CHECK-RESOLVE-DETECTION ROJO: `resolve-cross-issue-failsafe.cjs` ya no exporta `MARK` — el dedupe por ventana y las aserciones de CUERPO quedarían juzgando `undefined`.');
  process.exit(1);
}

// Las escrituras se registran CON el issue destino (`removeLabel#1694`): sin el
// número, el caso del tope `MAX` —tres materializaciones de cuatro declaradas—
// no se puede asertar, solo contar.
async function correrBelt({
  skipLabels, envSkip, labels,
  declaracion = DECL,          // prosa del resolver que entra por el barrido fresco
  destino = {},                // override del estado del issue DESTINO (`issues.get`)
  comentariosDestino = [],     // lo que `listComments` devuelve para el destino
  removeLabelErr,              // error que `removeLabel` lanza, si se quiere probar esa rama
  runErr,                      // error de `getWorkflowRun` (⇒ ventana de respaldo)
  creadoHace,                  // ms: antigüedad del `created_at` del comentario fresco
  paginasRelleno = 0,          // páginas extra del barrido (para el tope MAX_PAGS)
  barridoErr,                  // error del barrido paginado
} = {}) {
  const escrituras = [];
  const cuerpos = [];
  const avisos = [];
  const ahora = new Date().toISOString();
  // `run_started_at` se fija aquí y se DEVUELVE: los casos de la capa de
  // lectura contrastan contra este valor el `since` que el belt pide, en vez de
  // re-derivarlo (que es la clase AP-008: dos cálculos del mismo dato).
  const runStartedAt = new Date(Date.now() - 60_000).toISOString();
  const comentario = {
    issue_url: 'https://api.github.com/repos/o/r/issues/1696',
    body: declaracion, html_url: 'https://example/1',
    // `created_at` y `updated_at` se separan a propósito: el `since` de
    // `listCommentsForRepo` filtra por `updated_at`, así que una EDICIÓN vieja
    // entra en la ventana con su `created_at` fuera de ella.
    created_at: creadoHace == null ? ahora : new Date(Date.now() - creadoHace).toISOString(),
    updated_at: ahora,
  };
  let params = null;            // lo que el belt pide al barrido fresco
  // Los comentarios del destino que el caso declara «en ventana» se estampan
  // AQUÍ, en la misma llamada que fija `run_started_at` (🔵 6 de la review):
  // sellarlos al cargar el módulo ataba el banco al reloj de pared —si pasaban
  // más de 60 s hasta el caso, el comentario caía fuera de `since` y los casos
  // del dedupe se ponían rojos por una razón que no es la que prueban—. El
  // sentinel es `created_at: null`, que `enVentana` emite y nadie más usa.
  const delDestino = comentariosDestino.map((c) => (c.created_at == null ? { ...c, created_at: ahora } : c));
  const paginate = async () => delDestino;               // comentarios del DESTINO
  // El barrido fresco: registra lo que se le pide y sirve las páginas que el
  // caso declare. `paginasRelleno` son páginas SIN declaración — sirven para
  // empujar al belt contra su tope `MAX_PAGS` sin cambiar lo que deriva.
  paginate.iterator = async function* (_fn, p) {
    params = p;
    if (barridoErr) throw barridoErr;
    yield { data: [comentario] };
    for (let i = 0; i < paginasRelleno; i++) {
      yield { data: [{ issue_url: 'https://api.github.com/repos/o/r/issues/9', body: 'relleno', html_url: 'https://example/x', created_at: ahora, updated_at: ahora }] };
    }
  };
  const github = {
    paginate,
    rest: {
      actions: { getWorkflowRun: async () => { if (runErr) throw runErr; return { data: { run_started_at: runStartedAt } }; } },
      issues: {
        get: async ({ issue_number }) => ({ data: { number: issue_number, state: 'open', body: '@claude arranca', labels: labels.map((name) => ({ name })), ...destino } }),
        listComments: 'listComments',
        listCommentsForRepo: 'listCommentsForRepo',
        // Se registra la LLAMADA, no el éxito: la rama que importa en el caso
        // del fallo no-404 es «se intentó retirar y NO se publicó comentario».
        removeLabel: async ({ issue_number }) => { escrituras.push(`removeLabel#${issue_number}`); if (removeLabelErr) throw removeLabelErr; },
        createComment: async ({ issue_number, body }) => { escrituras.push(`createComment#${issue_number}`); cuerpos.push(body); },
      },
    },
  };
  const core = { info() {}, notice() {}, warning(m) { avisos.push(m); } };
  const context = { repo: { owner: 'o', repo: 'r' }, eventName: 'schedule', runId: 1 };
  const previo = process.env.IN_SKIP_LABELS;
  if (envSkip === undefined) delete process.env.IN_SKIP_LABELS; else process.env.IN_SKIP_LABELS = envSkip;
  try {
    await belt({ github, context, core, skipLabels });
  } finally {
    if (previo === undefined) delete process.env.IN_SKIP_LABELS; else process.env.IN_SKIP_LABELS = previo;
  }
  return { escrituras, cuerpos, avisos, params, runStartedAt };
}

if (typeof belt !== 'function') {
  console.error('CHECK-RESOLVE-DETECTION ROJO: `resolve-cross-issue-failsafe.cjs` ya no exporta el runtime como función — el stub de `watchdog.yml` hace `belt({...})` y reventaría en cada corrida.');
  process.exit(1);
}

const SKIP = 'pause-agents,human-needed';
// `created_at: null` es el sentinel que `correrBelt` estampa con SU reloj, en
// la misma llamada que fija la ventana: el banco no depende de cuánto tarde en
// llegar a este caso.
const enVentana = (body) => ({ body, created_at: null });
// Cuatro destinos declarados en cuatro segmentos: uno por segmento, porque más
// de un `#N` en el MISMO segmento es fail-open por multi-referencia. Sirve para
// asertar el tope `MAX` del módulo, que hoy es 3.
const DECL_4 = `\`stalled\` retirada de #1001.\n\`stalled\` retirada de #1002.\n\`stalled\` retirada de #1003.\n\`stalled\` retirada de #1004.\n${CAPA}\n${ROL_MARK}`;
// Declaración de des-stall Y NADA MÁS. Necesaria para aislar la rama «no queda
// nada materializado»: con la declaración completa (`DECL`) el arm sigue
// pendiente aunque `removeLabel` falle, luego el belt publica —correctamente—
// por el arm. El banco cazó esta confusión al escribirlo, que es para lo que
// está: la expectativa inicial de este caso era la equivocada, no el módulo.
const DECL_DS = `\`stalled\` retirada de #1694.\n${CAPA}\n${ROL_MARK}`;
const err = (status) => Object.assign(new Error(`API ${status}`), { status });

// [nombre, opts, escrituras esperadas, aserción opcional sobre el CUERPO publicado]
const CONTRATO = [
  ['control: sin label de exclusión, el belt SÍ materializa',
    { skipLabels: SKIP, labels: ['stalled'] },
    ['removeLabel#1694', 'createComment#1694'],
    { contiene: ['@claude', '<!-- watchdog-rearm -->', MARK] }],
  ['kill-switch por el parámetro que pasa el stub',
    { skipLabels: SKIP, labels: ['stalled', 'pause-agents'] },
    []],
  ['kill-switch por el env del stub (rename del parámetro inocuo)',
    { envSkip: SKIP, labels: ['stalled', 'pause-agents'] },
    []],
  // ── AP-069: los guards que el residual (d) de AP-068 dejó sin caso ──
  // Dedupe por VENTANA. Sin él, cada tick del watchdog re-materializaría la
  // misma declaración mientras siga en la ventana: comentario duplicado en el
  // destino y, si llevaba arm, una sesión de Creator por tick.
  ['dedupe: ya materializado en esta ventana ⇒ no-op',
    { skipLabels: SKIP, labels: ['stalled'], comentariosDestino: [enVentana(`ya materializado\n${MARK}`)] },
    []],
  // Destino fuera de alcance. Un PR no se arma por esta vía (su equivalente es
  // `ping-creator`) y un issue cerrado no tiene nada que reanudar.
  ['destino que es un PR ⇒ fuera de alcance',
    { skipLabels: SKIP, labels: ['stalled'], destino: { pull_request: { url: 'x' } } },
    []],
  ['destino cerrado ⇒ nada que reanudar',
    { skipLabels: SKIP, labels: ['stalled'], destino: { state: 'closed' } },
    []],
  // Issue VIRGEN (ningún `@claude` en body ni en comentarios): prohibición
  // absoluta del rol (`watchdog.md` § Prohibiciones). El des-stall SÍ procede
  // —no es un arm—, pero el comentario NO puede salir con cabecera de arm: si
  // saliera, el filtro de `claude-code.yml` despertaría a un Creator sobre un
  // issue que nadie armó nunca. Por eso el caso asierta el CUERPO y no solo la
  // lista de llamadas.
  ['issue VIRGEN: des-stall sí, arm JAMÁS (y el cuerpo no puede pedirlo)',
    { skipLabels: SKIP, labels: ['stalled'], destino: { body: 'Issue sin armar todavía.' } },
    ['removeLabel#1694', 'createComment#1694'],
    { noContiene: ['@claude', '<!-- watchdog-rearm -->'] }],
  // Nada que materializar: `stalled` ausente y arm ya posteado en la ventana.
  // Es el caso NORMAL cuando el resolver sí ejecutó lo que declaró.
  ['lo declarado ya está materializado ⇒ no-op',
    { skipLabels: SKIP, labels: [], comentariosDestino: [enVentana('@claude arranca')] },
    []],
  // `removeLabel` 404 = la label ya no estaba (carrera con el resolver vivo):
  // el estado deseado SÍ se alcanzó, luego se publica.
  // Con `DECL_DS` (des-stall y nada más) el 404 es la ÚNICA razón por la que el
  // belt puede publicar aquí: con la declaración completa el arm pendiente lo
  // publicaría igual y el caso sería vacuo respecto de esta rama — verificado
  // por mutación (apagar la rama del 404 con `DECL` deja el banco en verde).
  ['removeLabel 404 (carrera benigna) ⇒ estado alcanzado, se publica',
    { skipLabels: SKIP, labels: ['stalled'], declaracion: DECL_DS, removeLabelErr: err(404) },
    ['removeLabel#1694', 'createComment#1694'],
    { contiene: ['`stalled` retirada por estado'] }],
  // `removeLabel` fallo REAL y nada más que materializar: NO se publica. Un
  // comentario que afirmara la retirada sin haberla hecho reproduciría DENTRO
  // del belt la clase exacta que AP-064 cierra, y el marcador dedupearía
  // además su propio reintento del tick siguiente.
  ['removeLabel 500 sin arm pendiente ⇒ ni comentario ni marcador',
    { skipLabels: SKIP, labels: ['stalled'], declaracion: DECL_DS, removeLabelErr: err(500) },
    ['removeLabel#1694']],
  // Tope duro por corrida: 4 destinos declarados, 3 materializados.
  ['tope MAX por corrida: 4 declarados ⇒ 3 materializados',
    { skipLabels: SKIP, labels: ['stalled'], declaracion: DECL_4 },
    ['removeLabel#1001', 'createComment#1001', 'removeLabel#1002', 'createComment#1002', 'removeLabel#1003', 'createComment#1003']],

  // ── AP-070: la capa de LECTURA, residual (c) declarado por AP-069 ──
  // AP-069 cubrió lo que decide si el belt ESCRIBE y dejó escrito que la
  // LECTURA seguía sin caso: la ventana de frescura, el filtro por `created_at`
  // y el truncado del barrido. Que estén en el mismo módulo pusheable y sin
  // gate es la misma asimetría que ya justificó cerrar los guards de escritura;
  // la diferencia es la DIRECCIÓN de su fallo, y por eso no era coste cero:
  // una lectura rota no materializa de más — **deja de leer**, y un belt que no
  // ve la declaración es indistinguible de un belt que no hacía falta. Es
  // literalmente la avería que #166 existe para que no vuelva a ser silenciosa,
  // dentro del instrumento que la vigila.
  ['frescura: la ventana es `run_started_at`, no un lookback fijo',
    { skipLabels: SKIP, labels: ['stalled'] },
    ['removeLabel#1694', 'createComment#1694'],
    { since: 'run-started' }],
  // Fail-open del lado correcto: si la API no da la hora de arranque, el belt
  // NO se queda ciego —usaría una ventana vacía y no vería nada— sino que cae a
  // la ventana de respaldo acotada, y lo dice.
  ['frescura: `run_started_at` ilegible ⇒ respaldo de 40 min, anunciado',
    { skipLabels: SKIP, labels: ['stalled'], runErr: err(403) },
    ['removeLabel#1694', 'createComment#1694'],
    { since: 'respaldo', avisa: ['ventana de respaldo'] }],
  // El vector de DOBLE ARM. `since` de `listCommentsForRepo` filtra por
  // `updated_at`: corregir un typo horas después reinyecta la declaración en la
  // ventana de otro tick, con el arm de la primera vez ya fuera de la ventana
  // del destino ⇒ el belt lo leería como no-materializado y armaría otra vez.
  // El filtro por `created_at` es lo único que lo impide, y no tenía caso.
  ['edición reinyectada (`updated_at` fresco, `created_at` viejo) ⇒ no se deriva',
    { skipLabels: SKIP, labels: ['stalled'], creadoHace: 6 * 60 * 60 * 1000 },
    []],
  // Truncado ANUNCIADO, y mordiendo por el extremo que no importa: `desc` pone
  // la declaración del resolver —la más reciente de la ventana por
  // construcción, porque este belt corre al terminar su propia etapa— en la
  // primera página. En `asc` el corte se comería justo lo que se viene a leer,
  // y el belt quedaría mudo en el único caso en que hace falta.
  // El nombre dice lo que la aserción PRUEBA (🔵 4 de la review): el doble
  // sirve la declaración en la primera página sea cual sea el `direction`, así
  // que lo asertado es que el belt PIDE `desc` — no que el corte haya mordido.
  // Que pedir `desc` sea lo correcto es el porqué de arriba; el nombre es lo
  // que se lee en la salida verde y no puede prometer más.
  ['barrido: más de MAX_PAGS páginas ⇒ TRUNCADO anunciado, y el barrido pide `direction: desc`',
    { skipLabels: SKIP, labels: ['stalled'], paginasRelleno: 20 },
    ['removeLabel#1694', 'createComment#1694'],
    { avisa: ['barrido TRUNCADO'], direction: 'desc' }],
  ['barrido que falla ⇒ sin actuar y anunciado',
    { skipLabels: SKIP, labels: ['stalled'], barridoErr: err(500) },
    [],
    { avisa: ['barrido de comentarios frescos falló'] }],
  // AP-070, la otra mitad: el aviso nuevo tiene que SALIR por `core.warning` en
  // runtime, no solo existir en `derivar`. Un aviso que no llega al log es la
  // misma mudez con otro nombre.
  ['sin marcador de ROL: cero acción y aviso EN RUNTIME',
    { skipLabels: SKIP, labels: ['stalled'], declaracion: `\`stalled\` retirada de #1694 y re-arm allí.\n${CAPA}` },
    [],
    { avisa: ['NO lleva el marcador de ROL'] }],
];

for (const [nombre, opts, esperado, cuerpo] of CONTRATO) {
  let got;
  try { got = await correrBelt(opts); }
  catch (e) { fallos.push(`contrato — ${nombre}: \`run\` lanzó (${e.message})`); continue; }
  let ok = JSON.stringify(got.escrituras) === JSON.stringify(esperado);
  if (!ok) fallos.push(`contrato — ${nombre}: esperado escrituras=${JSON.stringify(esperado)} — obtenido ${JSON.stringify(got.escrituras)}`);
  for (const s of cuerpo?.contiene || []) {
    if (!got.cuerpos.some((c) => c.includes(s))) { ok = false; fallos.push(`contrato — ${nombre}: ningún cuerpo publicado contiene ${JSON.stringify(s)}`); }
  }
  for (const s of cuerpo?.noContiene || []) {
    if (got.cuerpos.some((c) => c.includes(s))) { ok = false; fallos.push(`contrato — ${nombre}: un cuerpo publicado contiene ${JSON.stringify(s)} y NO debía`); }
  }
  // AP-070 — aserciones sobre la capa de LECTURA. `avisa` mira el log (un
  // fail-open que no se anuncia es una avería muda) y `since`/`direction` miran
  // lo que el belt le PIDE a la API, que es donde se decide qué llega a ver.
  for (const s of cuerpo?.avisa || []) {
    if (!got.avisos.some((a) => a.includes(s))) { ok = false; fallos.push(`contrato — ${nombre}: ningún aviso contiene ${JSON.stringify(s)} — obtenido ${JSON.stringify(got.avisos)}`); }
  }
  if (cuerpo?.since === 'run-started' && got.params?.since !== got.runStartedAt) {
    ok = false; fallos.push(`contrato — ${nombre}: el barrido no pidió \`since\` = run_started_at (${got.runStartedAt}) sino ${JSON.stringify(got.params?.since)}`);
  }
  if (cuerpo?.since === 'respaldo') {
    const desvio = Math.abs(Date.parse(got.params?.since) - (Date.now() - 40 * 60 * 1000));
    if (!(desvio < 120_000)) { ok = false; fallos.push(`contrato — ${nombre}: la ventana de respaldo no son ~40 min (\`since\`=${JSON.stringify(got.params?.since)})`); }
  }
  if (cuerpo?.direction && got.params?.direction !== cuerpo.direction) {
    ok = false; fallos.push(`contrato — ${nombre}: el barrido pidió direction=${JSON.stringify(got.params?.direction)} y no ${JSON.stringify(cuerpo.direction)} — el truncado mordería por el extremo equivocado`);
  }
  lineas.push(`  ${ok ? '·' : '✗'} contrato: ${nombre.padEnd(56)} escrituras=${JSON.stringify(got.escrituras)}`);
}

if (process.env.RESOLVE_DETECTION_VERBOSE) lineas.forEach((l) => console.log(l));
if (fallos.length) {
  console.error(`CHECK-RESOLVE-DETECTION ROJO (derivación real de ${fuente}):`);
  fallos.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`check-resolve-detection verde: ${CASOS.length} casos del banco de AP-064 sobre la derivación REAL de ${fuente} (no una copia) + ${CONTRATO.length} aserciones de runtime ejecutando \`run\` contra un doble de la API — ESCRITURA (costura módulo↔stub, dedupe por ventana, destino fuera de alcance, issue virgen, 404 benigno de removeLabel, tope MAX: AP-069 cerró el residual (d) de AP-068) y LECTURA (ventana \`run_started_at\` y su respaldo, filtro por \`created_at\` contra la edición reinyectada, truncado \`desc\` anunciado y fallo del barrido: AP-070 cierra el residual (c) de AP-069).`);
