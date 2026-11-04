#!/usr/bin/env node
// check-suite-metricas — banco de `vendored/scripts/suite-metricas.cjs` (AP-140,
// central#410, ruling 2026-11-04 posición 19): métricas de la suite de tests
// para el steward semanal (`suite-steward.yml`).
//
// Parte 1 — el módulo REAL, casos del punto 6 del ruling:
//  (a) dos informes de shards del mismo run ⇒ suma sin duplicar;
//  (b) `top` con empate estable por nombre;
//  (c) `tendencia` con 5 puntos ⇒ Δ% correctos; serie de 1 punto ⇒ `null`; y el
//      hallazgo [G] de la crítica ronda 3: entre fuentes distintas, no comparable;
//  (d) `clasificarFallo`: un mensaje real de cada clase y uno de aserción;
//  (e) `inestables`: fallo en intento 1 + verde en intento 2 ⇒ incluido; fallo
//      en los dos ⇒ no;
//  (f) `agregarDesdeLog` con el texto crudo de un log real (ANSI + timestamps,
//      job 126487115833 de asesoramiento-financiero) ⇒ valores; dos bloques ⇒
//      suma; sin resumen ⇒ `null`;
//  (g)–(i) de la enmienda del Architect a #410: Δ% solo por tramo de la misma
//      fuente; `tests` solo `passed`; `msTotal` = `tests Ys`, `msPared` = pared.
// Más: `seleccionarRuns` (último de cada día y de cada semana), `rojos`,
// `informeMd` (literal de «sin informes de vitest») y `semanaIso`.
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { createRequire } from 'module';
import { resolve } from 'path';

const require = createRequire(import.meta.url);
const FUENTE = 'vendored/scripts/suite-metricas.cjs';
const M = require(resolve(FUENTE));

let casos = 0;
const fallos = [];
const afirma = (cond, msg) => { casos++; if (!cond) fallos.push(msg); };
const igual = (a, b, msg) => afirma(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

const W = '/home/runner/work/asesoramiento-financiero/asesoramiento-financiero/';
const fichero = (name, startTime, endTime, estados) => ({ name: W + name, startTime, endTime, assertionResults: estados.map(status => ({ status })) });

{ // (a) shards del mismo run: cada fichero una vez; repetido en dos informes ⇒ una vez
  const s1 = { testResults: [fichero('packages/app/a.test.ts', 0, 1000, ['passed', 'passed', 'failed']), fichero('packages/app/b.test.ts', 0, 500, ['passed'])] };
  const s2 = { testResults: [fichero('packages/app/c.test.ts', 100, 400, ['passed', 'skipped']), fichero('packages/app/a.test.ts', 0, 1000, ['passed', 'passed', 'failed'])] };
  const ag = M.agregar([s1, s2]);
  igual([ag.ficheros, ag.tests, ag.msTotal], [3, 4, 1800], '(a) agregado de dos shards');
  igual(ag.porFichero.map(e => e.fichero), ['packages/app/a.test.ts', 'packages/app/b.test.ts', 'packages/app/c.test.ts'], '(a) rutas relativas al checkout y ordenadas');
  igual(M.agregar([]), { ficheros: 0, tests: 0, msTotal: 0, porFichero: [] }, '(a) sin informes');
  igual(M.relativo('/__w/r/r/packages/x.test.ts'), 'packages/x.test.ts', '(a) prefijo de contenedor');
}

{ // (b) top: por ms desc, empate por nombre
  const ag = { porFichero: [{ fichero: 'z.test.ts', tests: 1, ms: 50 }, { fichero: 'b.test.ts', tests: 1, ms: 90 }, { fichero: 'a.test.ts', tests: 1, ms: 50 }, { fichero: 'c.test.ts', tests: 1, ms: 10 }] };
  igual(M.top(ag, 3).map(e => e.fichero), ['b.test.ts', 'a.test.ts', 'z.test.ts'], '(b) top 3 con empate estable');
  igual(M.top(ag, 10).length, 4, '(b) n mayor que el total');
  igual(M.porDirectorio({ porFichero: [{ fichero: 'p/x/a.test.ts', tests: 2, ms: 5 }, { fichero: 'p/x/b.test.ts', tests: 1, ms: 5 }, { fichero: 'p/y/c.test.ts', tests: 1, ms: 20 }] }, 10),
    [{ directorio: 'p/y', ficheros: 1, tests: 1, ms: 20 }, { directorio: 'p/x', ficheros: 2, tests: 3, ms: 10 }], '(b) porDirectorio');
}

{ // (c) tendencia
  const serie = [
    { fecha: '2026-10-07', tests: 100, msTotal: 1000 },
    { fecha: '2026-10-14', tests: 110, msTotal: 1100 },
    { fecha: '2026-10-21', tests: 120, msTotal: 1300 },
    { fecha: '2026-10-28', tests: 130, msTotal: 1400 },
    { fecha: '2026-11-04', tests: 150, msTotal: 1800 },
  ];
  const t = M.tendencia([...serie].reverse());   // el orden de entrada no importa
  igual([t.semanal.tests, t.semanal.msTotal, t.semanal.msPorTest], [15.4, 28.6, 11.4], '(c) Δ% semana a semana');
  igual([t.cuatroSemanas.tests, t.cuatroSemanas.msTotal, t.cuatroSemanas.msPorTest], [50, 80, 20], '(c) Δ% a 4 semanas');
  igual([t.semanal.desde, t.cuatroSemanas.desde, t.puntos], ['2026-10-28', '2026-10-07', 5], '(c) puntos de comparación');
  igual(M.tendencia([serie[0]]), null, '(c) serie de 1 punto ⇒ null');
  igual(M.tendencia(serie.slice(0, 3)).cuatroSemanas, null, '(c) 3 puntos ⇒ sin Δ a 4 semanas');
  // [G] ronda 3: log (pared) frente a artifact (suma por fichero) no se comparan
  const mixta = serie.map((p, i) => ({ ...p, fuente: i < 4 ? 'log' : 'artifact' }));
  const tm = M.tendencia(mixta);
  afirma(tm.semanal.comparable === false && /cambio de fuente \(log → artifact\)/.test(tm.semanal.motivo) && tm.semanal.msTotal === undefined, `(c) frontera log→artifact no comparable: ${JSON.stringify(tm.semanal)}`);
  afirma(tm.cuatroSemanas.comparable === false, '(c) Δ a 4 semanas con un cambio de fuente en medio ⇒ no comparable');
  const tl = M.tendencia(serie.map(p => ({ ...p, fuente: 'log' })));
  afirma(tl.semanal.comparable === true && tl.semanal.tests === 15.4 && tl.cuatroSemanas.comparable === true, '(c) log↔log sí comparable');
}

{ // (g) enmienda del Architect: serie [log, log, artifact, artifact] ⇒ Δ% por tramo de la misma fuente
  const t = M.tendencia([
    { fecha: '2026-10-14', tests: 100, msTotal: 1000, fuente: 'log' },
    { fecha: '2026-10-21', tests: 110, msTotal: 1200, fuente: 'log' },
    { fecha: '2026-10-28', tests: 120, msTotal: 1300, fuente: 'artifact' },
    { fecha: '2026-11-04', tests: 150, msTotal: 1950, fuente: 'artifact' },
  ]);
  igual(t.tramos.map(x => x.comparable ? [x.tests, x.msTotal] : x.delta), [[10, 20], null, [25, 50]], '(g) tramos log→log y artifact→artifact definidos, log→artifact null');
  afirma(/cambio de fuente/.test(t.tramos[1].motivo), '(g) la frontera dice «cambio de fuente»');
  const md = M.informeMd({ serie: [], tendencia: t, rojos: M.rojos([]) });
  afirma(md.includes('Tramos:') && md.includes('cambio de fuente (log → artifact)'), '(g) metricas.md marca la frontera');
}

{ // (h) `tests` cuenta solo `passed`
  igual(M.agregar([{ testResults: [fichero('p/h.test.ts', 0, 10, ['passed', 'skipped', 'failed', 'passed', 'todo'])] }]).tests, 2, '(h) agregar cuenta solo passed');
}

{ // (d) clasificarFallo
  igual(M.clasificarFallo('AssertionError: el hash es el literal capturado: expected "9f2c…" to be "a41e…"'), 'literal', '(d) literal');
  igual(M.clasificarFallo('Error: Snapshot `cartera > reparto 1` mismatched'), 'literal', '(d) snapshot');
  igual(M.clasificarFallo('Error: Test timed out in 5000ms.'), 'timeout', '(d) timeout vitest');
  igual(M.clasificarFallo('Error: The job running on runner GitHub Actions 12 has exceeded the maximum execution time of 30 minutes.'), 'timeout', '(d) exceeded the maximum execution time');
  igual(M.clasificarFallo('Error: read ECONNRESET'), 'entorno', '(d) entorno ECONNRESET');
  igual(M.clasificarFallo('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory'), 'entorno', '(d) entorno heap');
  igual(M.clasificarFallo('AssertionError: expected 3 to be 4 // Object.is equality'), 'aserción', '(d) aserción');
  igual(M.clasificarFallo(null), 'aserción', '(d) sin mensaje');
}

{ // (e) inestables
  const ej = [
    { run: 11, intento: 1, conclusion: 'failure', fallidos: ['p/a.test.ts', 'p/a.test.ts'] },
    { run: 11, intento: 2, conclusion: 'success', fallidos: [] },
    { run: 12, intento: 1, conclusion: 'failure', fallidos: ['p/b.test.ts'] },
    { run: 12, intento: 2, conclusion: 'failure', fallidos: ['p/b.test.ts'] },
    { run: 13, intento: 1, conclusion: 'failure', fallidos: ['p/c.test.ts'] },
  ];
  igual(M.inestables(ej), [{ run: 11, fichero: 'p/a.test.ts' }], '(e) verde en intento 2 ⇒ inestable; rojo en los dos o sin reintento ⇒ no');
}

// (f) log real con escapes ANSI y timestamps (job 126487115833, «Verify app (shard 2/2)», crítica ronda 2)
const E = '\x1b';
const bloque = (ts1, ts2, n, dur, tests) =>
  `${ts1} ${E}[2m      Tests ${E}[22m ${E}[1m${E}[32m${n} passed${E}[39m${E}[22m${E}[2m | ${E}[22m${E}[33m33 skipped${E}[39m${E}[90m (4739)${E}[39m\n` +
  `${ts2} ${E}[2m   Duration ${E}[22m ${dur}s${E}[2m (transform 25.70s, setup 25.37s, collect 326.79s, tests ${tests}s, environment 92.75s, prepare 47.06s)${E}[22m\n`;
const LOG = '2026-11-04T09:15:49.5539120Z \n' +
  `2026-11-04T09:15:49.5550000Z ${E}[2m Test Files ${E}[22m ${E}[1m${E}[32m512 passed${E}[39m${E}[22m${E}[90m (512)${E}[39m\n` +
  bloque('2026-11-04T09:15:49.5603965Z', '2026-11-04T09:15:49.5610000Z', 4706, '727.95', '1582.06');
{
  // (i) enmienda: `msTotal` = `tests Ys`, `msPared` = `Duration Xs`
  igual(M.agregarDesdeLog(LOG), { tests: 4706, msTotal: 1582060, msPared: 727950 }, '(f)(i) log real de shard');
  const dos = LOG + bloque('2026-11-04T09:20:00.0000000Z', '2026-11-04T09:20:00.1000000Z', 100, '10.5', '2.25');
  igual(M.agregarDesdeLog(dos), { tests: 4806, msTotal: 1584310, msPared: 738450 }, '(f)(i) dos bloques de resumen ⇒ suma');
  igual(M.agregarDesdeLog('2026-11-04T09:00:00.0000000Z ##[group]Run pnpm install\nDone in 3s\n'), null, '(f) log sin resumen ⇒ null');
  afirma(!/\x1b|^\d{4}-\d{2}-\d{2}T/m.test(M.normalizarLog(LOG)), '(f) normalizar quita ANSI y timestamps');
}

{ // seleccionarRuns: último de cada día de 7 días y último de cada semana anterior
  const ahora = '2026-11-04T05:17:00Z';
  const runs = [
    { id: 1, created_at: '2026-11-03T10:00:00Z' }, { id: 2, created_at: '2026-11-03T18:00:00Z' },
    { id: 3, created_at: '2026-10-30T09:00:00Z' },
    { id: 4, created_at: '2026-10-26T09:00:00Z' }, { id: 5, created_at: '2026-10-27T09:00:00Z' },
    { id: 6, created_at: '2026-10-10T09:00:00Z' },
    { id: 7, created_at: '2026-11-05T09:00:00Z' },   // futuro: fuera
  ];
  const sel = M.seleccionarRuns(runs, ahora, 4);
  igual(sel.dias.map(x => [x.fecha, x.run.id]), [['2026-10-30', 3], ['2026-11-03', 2]], 'seleccionarRuns: días');
  igual(sel.semanas.map(x => x.run && x.run.id), [5, null, 6, null], 'seleccionarRuns: semanas (sin run ⇒ null)');
  igual(M.seleccionarRuns(runs, ahora, 8).semanas.length, 8, 'seleccionarRuns: 8 semanas en inicial');
}

{ // rojos
  const r = M.rojos([
    { run: 1, path: W + 'p/a.test.ts', message: 'el hash es el literal capturado' },
    { run: 2, path: 'p/a.test.ts', message: 'Test timed out in 5000ms' },
    { run: 2, path: 'p/a.test.ts', message: 'expected 1 to be 2' },
    { run: 3, path: '', message: 'Process completed with exit code 1.' },
  ]);
  igual(r.porClase, { literal: 1, timeout: 1, entorno: 0, 'aserción': 2 }, 'rojos: por clase');
  igual(r.porFichero.map(e => [e.fichero, e.fallos]), [['p/a.test.ts', 2], ['(sin fichero)', 1]], 'rojos: por fichero (runs distintos)');
}

{ // informeMd y semanaIso
  const md = M.informeMd({ repo: 'o/r', semana: '2026-W45', hayArtifacts: false, serie: [{ fecha: '2026-11-03', fuente: 'log', run: 9, tests: 4706, msTotal: 727950 }], tendencia: null, top: [], rojos: M.rojos([]), inestables: [] });
  afirma(md.includes('sin informes de vitest: falta el upload en `ci.yaml`'), '(md) literal sin artifacts');
  afirma(md.includes('Δ%: `null`') && md.includes('## Top 20') && md.includes('## Rojos de la semana') && md.includes('## Inestables'), '(md) secciones');
  igual([M.semanaIso('2026-11-02T05:17:00Z'), M.semanaIso('2026-11-04'), M.semanaIso('2027-01-01')], ['2026-W45', '2026-W45', '2026-W53'], 'semanaIso');
}

if (fallos.length) {
  console.error('CHECK-SUITE-METRICAS ROJO:');
  for (const f of fallos) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-suite-metricas verde: ${casos} casos sobre ${FUENTE}.`);
