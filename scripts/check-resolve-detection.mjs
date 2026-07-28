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
// Las regexes NO se re-teclean aquí: se extraen LITERALMENTE del fichero que
// las contiene —`docs/patches/*.patch` mientras el step siga pendiente de
// aplicación humana (ADR-020), `.github/workflows/watchdog.yml` una vez
// aplicado—, de modo que el banco no puede divergir del código que juzga.
//
// Verde: exit 0. Rojo: una regex cambió y el banco lo nota.
import { existsSync, readFileSync } from 'fs';

// Orden deliberado: el WORKFLOW primero, el parche como respaldo (ronda 3,
// pregunta abierta 1). El estado APLICADO es el que manda: si el `.patch` se
// conserva como artefacto de provenance después de aplicarlo, con el orden
// inverso el banco seguiría juzgando el parche —el fichero que ya NO es el
// código vivo— y saldría verde mientras `watchdog.yml` derivaba; el rojo
// aparecería en `check-patches` y aquí no, que es el peor sitio para no verlo.
// Mientras el step siga pendiente, `watchdog.yml` no contiene las regexes, la
// extracción queda incompleta y cae al parche sola.
const FUENTES = [
  '.github/workflows/watchdog.yml',
  'docs/patches/AP-064-watchdog-resolve-cross-issue.patch',
];
const NOMBRES = ['DES_STALL', 'ARM', 'AMBIGUO', 'FUTURO', 'ROL'];

// Extracción literal: `const <NOMBRE> = /…/flags;` en una sola línea, tal y
// como el step las declara. `new RegExp(src, flags)` sobre el texto capturado
// — nunca una copia tecleada.
const extraer = (txt) => {
  const out = {};
  for (const n of NOMBRES) {
    const m = new RegExp(`^\\s*(?:\\+\\s*)?const ${n} = /(.*)/([a-z]*);\\s*$`, 'm').exec(txt);
    if (m) out[n] = new RegExp(m[1], m[2]);
  }
  return out;
};

let fuente = null;
let R = {};
for (const f of FUENTES) {
  if (!existsSync(f)) continue;
  const cand = extraer(readFileSync(f, 'utf8'));
  if (NOMBRES.every((n) => cand[n])) { fuente = f; R = cand; break; }
}
if (!fuente) {
  // Fail-open ANUNCIADO, nunca mudo: si el step no existe en ninguna de las dos
  // formas (parche pendiente o workflow aplicado), no hay nada que juzgar —
  // pero que no lo haya tiene que verse.
  console.log('::warning::check-resolve-detection — no encuentro las regexes de resolve-cross-issue-failsafe ni en el parche ni en `.github/workflows/watchdog.yml`: el banco NO se ha ejecutado.');
  process.exit(0);
}

// ── El pipeline de derivación, calcado del step (identidad → segmentación →
// acción → refs → polaridad/modo). Si el step cambia de FORMA (no de regex),
// esta función tiene que cambiar con él: es el residual consciente de este
// banco, y por eso la parte volátil —las regexes— se extrae y no se copia.
const derivar = (comentarios) => {
  const decl = {};
  const warns = [];
  for (const c of comentarios) {
    const raw = c.body || '';
    if (raw.includes('<!-- resolve-cross-issue-materializado -->')) continue;
    if (!R.ROL.test(raw.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' '))) continue;
    const host = c.host;
    const prosa = raw.replace(/```[\s\S]*?```/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
    for (const seg of prosa.split(/\r?\n|(?<=[.;!?])\s+/)) {
      const desStall = R.DES_STALL.test(seg);
      const arm = R.ARM.test(seg);
      if (!desStall && !arm) continue;
      const refs = [...new Set([...seg.matchAll(/(?:^|[\s(\[,;:«"'])#(\d+)\b/g)].map((m) => Number(m[1])))].filter((n) => n !== host);
      if (!refs.length) continue;
      const modo = R.AMBIGUO.test(seg) ? 'negada/condicional/pospuesta' : (R.FUTURO.test(seg) ? 'futuro/intención' : null);
      if (modo) { warns.push(`${modo}: "${seg.trim()}"`); continue; }
      if (refs.length > 1) { warns.push(`multi-ref: ${refs.join(',')}`); continue; }
      const n = refs[0];
      const d = decl[n] || (decl[n] = { desStall: false, arm: false });
      if (desStall) d.desStall = true;
      if (arm) d.arm = true;
    }
  }
  return { decl, warns };
};

const ROL_MARK = '<!-- watchdog-rol: architect-resolve -->';
const CAPA = '<!-- watchdog-capa: schedule -->';
const cmt = (body, { host = 1696, rol = true } = {}) => ({ host, body: `${body}\n\n${CAPA}${rol ? `\n${ROL_MARK}` : ''}` });

// esperado: { decl, warns } — `warns` se compara por PREFIJO de clase.
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
];

const fallos = [];
const lineas = [];
for (const [nombre, comentarios, decl, warns] of CASOS) {
  const got = derivar(comentarios);
  const okDecl = JSON.stringify(got.decl) === JSON.stringify(decl);
  const okWarn = got.warns.length === warns.length && warns.every((w, i) => (got.warns[i] || '').startsWith(w));
  if (!okDecl || !okWarn) {
    fallos.push(`${nombre}: esperado decl=${JSON.stringify(decl)} warns=${JSON.stringify(warns)} — obtenido decl=${JSON.stringify(got.decl)} warns=${JSON.stringify(got.warns)}`);
  }
  lineas.push(`  ${okDecl && okWarn ? '·' : '✗'} ${nombre.padEnd(46)} decl=${JSON.stringify(got.decl)} warns=${JSON.stringify(got.warns)}`);
}

if (process.env.RESOLVE_DETECTION_VERBOSE) lineas.forEach((l) => console.log(l));
if (fallos.length) {
  console.error(`CHECK-RESOLVE-DETECTION ROJO (regexes extraídas de ${fuente}):`);
  fallos.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`check-resolve-detection verde: ${CASOS.length} casos del banco de AP-064 sobre las 5 regexes extraídas literalmente de ${fuente}.`);
