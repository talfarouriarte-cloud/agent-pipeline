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
// `informeMd` (literal de «sin informes de vitest»), `semanaIso`, `leerZip`
// (stored y deflate) y `componer` (serie de un punto por semana, top del punto
// `artifact` más reciente).
// Parte 2 — costura (YAML) de `.github/workflows/suite-steward.yml` contra el
// ruling: inputs y defaults, permisos ≡ contrato AP-003, artifact entre jobs,
// `fetch-depth: 0`, `--allowedTools` cerrado, modelo con override y fallback,
// 4 × `max_turns` en `inicial`, pin de claude-code-action y paso de model-usage
// idénticos a `critic.yml`; la plantilla del stub (cron, `modo`, `with` ⊆ inputs).
// Parte 3 — integración: el script EMBEBIDO real del step «Calcular métricas
// (AP-140)» con el cargador compartido y un `github` simulado (artifacts en zip,
// histórico desde log, rojos e inestables; sin workflow de CI; `modo` inválido).
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { deflateRawSync } from 'zlib';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

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
  igual(t.semanal.delta, { tests: 15.4, msTotal: 28.6, msPorTest: 11.4 }, '(c) Δ% semana a semana');
  igual(t.cuatroSemanas.delta, { tests: 50, msTotal: 80, msPorTest: 20 }, '(c) Δ% a 4 semanas');
  igual([t.semanal.desde, t.cuatroSemanas.desde, t.puntos], ['2026-10-28', '2026-10-07', 5], '(c) puntos de comparación');
  igual(M.tendencia([serie[0]]), null, '(c) serie de 1 punto ⇒ null');
  igual(M.tendencia(serie.slice(0, 3)).cuatroSemanas, null, '(c) 3 puntos ⇒ sin Δ a 4 semanas');
  // [G] ronda 3: log (pared) frente a artifact (suma por fichero) no se comparan
  const mixta = serie.map((p, i) => ({ ...p, fuente: i < 4 ? 'log' : 'artifact' }));
  const tm = M.tendencia(mixta);
  afirma(tm.semanal.comparable === false && /cambio de fuente \(log → artifact\)/.test(tm.semanal.motivo) && tm.semanal.delta === null, `(c) frontera log→artifact no comparable: ${JSON.stringify(tm.semanal)}`);
  afirma(tm.cuatroSemanas.comparable === false, '(c) Δ a 4 semanas con un cambio de fuente en medio ⇒ no comparable');
  const tl = M.tendencia(serie.map(p => ({ ...p, fuente: 'log' })));
  afirma(tl.semanal.comparable === true && tl.semanal.delta.tests === 15.4 && tl.cuatroSemanas.comparable === true, '(c) log↔log sí comparable');
}

{ // (g) enmienda del Architect: serie [log, log, artifact, artifact] ⇒ Δ% por tramo de la misma fuente
  const t = M.tendencia([
    { fecha: '2026-10-14', tests: 100, msTotal: 1000, fuente: 'log' },
    { fecha: '2026-10-21', tests: 110, msTotal: 1200, fuente: 'log' },
    { fecha: '2026-10-28', tests: 120, msTotal: 1300, fuente: 'artifact' },
    { fecha: '2026-11-04', tests: 150, msTotal: 1950, fuente: 'artifact' },
  ]);
  igual(t.tramos.map(x => x.delta && [x.delta.tests, x.delta.msTotal]), [[10, 20], null, [25, 50]], '(g) tramos log→log y artifact→artifact definidos, log→artifact null');
  igual(t.tramos.map(x => Object.keys(x).filter(k => k !== 'motivo').sort().join()), Array(3).fill('comparable,delta,desde,hasta'), '(g) una sola forma de tramo: `delta` siempre presente (objeto o null)');
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
    { run: 3, path: '', message: 'algo petó sin fichero' },
  ]);
  igual(r.porClase, { literal: 1, timeout: 1, entorno: 0, 'aserción': 2 }, 'rojos: por clase');
  igual(r.porFichero.map(e => [e.fichero, e.fallos]), [['p/a.test.ts', 2], ['(sin fichero)', 1]], 'rojos: por fichero (runs distintos)');
  const g = M.rojos([
    { run: 1, path: '.github', message: 'Process completed with exit code 1.' },
    { run: 2, path: '.github', message: 'Process completed with exit code 137' },
    { run: 3, path: '', message: ' Process completed with exit code 2. ' },
    { run: 4, path: '.github', message: 'The job running on runner X has exceeded the maximum execution time of 30 minutes.' },
    { run: 4, path: 'p/a.test.ts', message: 'expected 1 to be 2' },
  ]);
  igual([g.anotaciones, g.porClase], [2, { literal: 0, timeout: 1, entorno: 0, 'aserción': 1 }], 'rojos: «Process completed with exit code N» descartada; el timeout del job (`.github`) cuenta');
  igual(g.porFichero.map(e => [e.fichero, e.fallos]), [['(sin fichero)', 1], ['p/a.test.ts', 1]], 'rojos: `.github` no es un fichero ⇒ `(sin fichero)`');
}

{ // informeMd y semanaIso
  const md = M.informeMd({ repo: 'o/r', semana: '2026-W45', hayArtifacts: false, serie: [{ fecha: '2026-11-03', fuente: 'log', run: 9, tests: 4706, msTotal: 727950 }], tendencia: null, top: [], rojos: M.rojos([]), inestables: [] });
  afirma(md.includes('sin informes de vitest: falta el upload en `ci.yaml`'), '(md) literal sin artifacts');
  afirma(md.includes('Δ%: `null`') && md.includes('## Top 20') && md.includes('## Rojos de la semana') && md.includes('## Inestables'), '(md) secciones');
  igual([M.semanaIso('2026-11-02T05:17:00Z'), M.semanaIso('2026-11-04'), M.semanaIso('2027-01-01')], ['2026-W45', '2026-W45', '2026-W53'], 'semanaIso');
}

// Zip mínimo como el de `actions/upload-artifact@v4` (sin CRC: `leerZip` no lo lee).
function zip(entradas) {
  const locales = [], central = [];
  let off = 0;
  for (const { nombre, texto, deflate } of entradas) {
    const n = Buffer.from(nombre), crudo = Buffer.from(texto), datos = deflate ? deflateRawSync(crudo) : crudo;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(deflate ? 8 : 0, 8);
    h.writeUInt32LE(datos.length, 18); h.writeUInt32LE(crudo.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(datos.length, 20); c.writeUInt32LE(crudo.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locales.push(h, n, datos); central.push(c, n);
    off += 30 + n.length + datos.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entradas.length, 8); e.writeUInt16LE(entradas.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locales, cd, e]);
}

const informe = (...fs) => JSON.stringify({ testResults: fs });
{ // leerZip y componer
  const z = M.leerZip(zip([{ nombre: 'dir/', texto: '' }, { nombre: 'a.json', texto: '{"x":1}' }, { nombre: 'b.json', texto: '{"y":2}', deflate: true }]));
  igual(z.map(f => [f.nombre, f.datos.toString()]), [['a.json', '{"x":1}'], ['b.json', '{"y":2}']], 'leerZip: stored y deflate, sin directorios');
  let lanzo = false; try { M.leerZip(Buffer.from('no es un zip')); } catch { lanzo = true; }
  afirma(lanzo, 'leerZip: basura ⇒ lanza (el step lo convierte en aviso)');
  const m = M.componer({
    repo: 'o/r', rama: 'main', modo: 'semanal', generado: '2026-11-08T23:00:00Z',
    dias: [{ fecha: '2026-11-08', run: 30, reportes: [JSON.parse(informe(fichero('p/a.test.ts', 0, 900, ['passed', 'passed'])))] }, { fecha: '2026-11-06', run: 29, logs: ['sin resumen'] }],
    semanas: [{ fecha: '2026-10-28', run: 20, logs: [LOG, 'otro job sin resumen'] }, { fecha: '2026-10-20', run: 10, logs: [LOG] }],
  });
  igual(m.serie.map(p => [p.fecha, p.fuente, p.tests, p.msTotal, p.msPared]), [['2026-10-20', 'log', 4706, 1582060, 727950], ['2026-10-28', 'log', 4706, 1582060, 727950], ['2026-11-08', 'artifact', 2, 900, null]], 'componer: un punto por semana, día sin datos fuera');
  afirma(m.tendencia.tramos[0].comparable && m.tendencia.tramos[1].delta === null && m.semana === '2026-W45' && m.hayArtifacts, `componer: tramos y semana (${JSON.stringify(m.tendencia.tramos)})`);
  igual([m.top.map(e => e.fichero), m.detalleDe, m.serie.some(p => 'agregado' in p)], [['p/a.test.ts'], { fecha: '2026-11-08', run: 30 }, false], 'componer: top del artifact más reciente, sin `agregado` en la serie');
}

// ── Parte 2 — costura ───────────────────────────────────────────────────────
const WF = '.github/workflows/suite-steward.yml';
const wf = existsSync(WF) ? yaml.load(readFileSync(WF, 'utf8')) : null;
afirma(!!wf, `(costura) ${WF} no existe`);
let calc = null;
if (wf) {
  const wc = (wf.on || wf[true] || {}).workflow_call || {};
  const ins = wc.inputs || {};
  igual(Object.fromEntries(Object.entries(ins).map(([k, v]) => [k, v.default])), {
    runner: 'ubuntu-latest', default_branch: 'main', ci_workflow_name: 'CI', report_artifact_prefix: 'vitest-report',
    steward_model: 'claude-opus-5-5', steward_fallback_model: 'claude-fable-5-1', max_turns: 80, modo: 'semanal',
    timeout_minutes: 60, timeout_minutes_inicial: 240,
  }, '(costura) inputs y defaults del ruling');
  igual(Object.keys(wc.secrets || {}), ['CLAUDE_CODE_OAUTH_TOKEN', 'REVIEWER_GITHUB_TOKEN'], '(costura) secrets');
  const contrato = JSON.parse(readFileSync('templates/workflow-contracts.json', 'utf8'))['suite-steward.yml'];
  igual(wf.permissions, { contents: 'read', issues: 'write', actions: 'read', checks: 'read' }, '(costura) permisos del ruling');
  igual(contrato && contrato.permissions_required, wf.permissions, '(costura) permisos ≡ contrato AP-003');
  const met = wf.jobs.metricas || {}, st = wf.jobs.steward || {};
  igual([met.name, st.name, st.needs], ['Métricas de la suite', 'Suite steward', 'metricas'], '(costura) jobs');
  const CH = require(resolve('vendored/scripts/ci-head.cjs'));
  afirma(CH.JOBS_PIPELINE.has(met.name) && CH.JOBS_PIPELINE.has(st.name), '(costura) los dos jobs en JOBS_PIPELINE de ci-head.cjs (no son CI)');
  const ps = met.steps || [], qs = st.steps || [];
  const graft = s => s && s.uses === 'talfarouriarte-cloud/agent-pipeline/.github/actions/graft-vendored@main';
  calc = ps.find(s => s && s.name === 'Calcular métricas (AP-140)') || null;
  afirma(ps.findIndex(graft) >= 0 && ps.findIndex(graft) < ps.indexOf(calc), '(costura) metricas: graft antes del cálculo');
  afirma(calc && calc.with && calc.with['github-token'] === '${{ github.token }}', '(costura) el cálculo usa github.token, no el PAT');
  const up = ps.find(s => /^actions\/upload-artifact@/.test((s && s.uses) || ''));
  const down = qs.find(s => /^actions\/download-artifact@/.test((s && s.uses) || ''));
  afirma(up && up.with.name === 'suite-steward-metricas' && up.with.path === '.suite-steward/' && up.with['retention-days'] === 7, '(costura) upload del artifact suite-steward-metricas (7 días)');
  afirma(down && down.with.name === 'suite-steward-metricas' && down.with.path === '.suite-steward/', '(costura) el steward baja el mismo artifact a .suite-steward/');
  const co = qs.find(s => /^actions\/checkout@/.test((s && s.uses) || ''));
  afirma(co && co.with && co.with['fetch-depth'] === 0, '(costura) checkout del steward con fetch-depth: 0');
  afirma(qs.findIndex(graft) >= 0, '(costura) steward con graft');
  igual(st['timeout-minutes'], "${{ inputs.modo == 'inicial' && inputs.timeout_minutes_inicial || inputs.timeout_minutes }}", '(costura) timeout propio en inicial');
  const pres = qs.find(s => s && s.id === 'presupuesto');
  afirma(pres && /MAX_TURNS \* 4/.test(pres.run) && pres.env.MAX_TURNS === '${{ inputs.max_turns }}', '(costura) 4 × max_turns en inicial');
  const ses = qs.find(s => s && s.id === 'steward') || {};
  const cr = yaml.load(readFileSync('.github/workflows/critic.yml', 'utf8'));
  const crPasos = cr.jobs.critic.steps;
  const crSes = crPasos.find(s => s && s.id === 'critic');
  igual(ses.uses, crSes.uses, '(costura) mismo pin de claude-code-action que critic.yml');
  const args = String((ses.with || {}).claude_args || '');
  afirma(args.includes('--allowedTools "Read,Glob,Grep,Bash(git log:*),Bash(git grep:*),Bash(gh issue list:*),Bash(gh issue view:*),Bash(gh issue create:*),Bash(gh issue comment:*),Bash(gh issue close:*),Bash(gh api:*)"'), '(costura) --allowedTools cerrado del ruling');
  afirma(args.includes('--model ${{ vars.PIPELINE_STEWARD_MODEL || inputs.steward_model }}') && args.includes('--fallback-model ${{ inputs.steward_fallback_model }}'), '(costura) modelo con override y fallback');
  afirma(args.includes('--max-turns ${{ steps.presupuesto.outputs.turnos }}'), '(costura) --max-turns del paso Presupuesto');
  afirma((ses.env || {}).ANTHROPIC_API_KEY === '' && /docs\/agents\/suite-steward\.md/.test(String(ses.with && ses.with.prompt)), '(costura) blindaje OAuth y mandato en el prompt');
  const mu = n => (n || []).find(s => s && s.name === 'Anotar el consumo LLM (model-usage, AP-099)');
  igual(mu(qs) && mu(qs).with.script, mu(crPasos) && mu(crPasos).with.script, '(costura) paso de model-usage idéntico al de critic.yml');
  afirma(mu(qs) && mu(qs).env.EXEC_FILE === '${{ steps.steward.outputs.execution_file }}', '(costura) model-usage lee el execution_file del steward');

  const stub = yaml.load(readFileSync('templates/stubs/stub-suite-steward.yml', 'utf8'));
  const on = stub.on || stub[true];
  igual(on.schedule, [{ cron: '17 5 * * 1' }], '(stub) lunes 05:17 UTC');
  igual(on.workflow_dispatch.inputs.modo.options, ['semanal', 'inicial'], '(stub) workflow_dispatch con modo');
  afirma(stub.jobs.call.uses === 'talfarouriarte-cloud/agent-pipeline/.github/workflows/suite-steward.yml@main', '(stub) llama al reusable del central');
  afirma(Object.keys(stub.jobs.call.with || {}).every(k => k in ins), '(stub) todo `with` es un input del reusable');
  igual(stub.permissions, wf.permissions, '(stub) concede los permisos del contrato');
}

// ── Parte 3 — integración del step real ─────────────────────────────────────
if (calc && typeof calc.with.script === 'string') {
  const run = cargarStep(calc.with.script, 'Calcular métricas (AP-140)');
  const DIA = 86400000, hace = d => new Date(Date.now() - d * DIA).toISOString();
  const simula = ({ workflows = [{ id: 77, name: 'CI' }] } = {}) => {
    const llamadas = [];
    const runsPush = [{ id: 101, created_at: hace(1) }, { id: 90, created_at: hace(9) }];
    const runsPr = [
      { id: 201, conclusion: 'success', run_attempt: 2 },
      { id: 202, conclusion: 'failure', run_attempt: 1 },
      { id: 203, conclusion: 'success', run_attempt: 1 },
    ];
    const jobs = {
      101: [{ id: 1, conclusion: 'success' }],
      90: [{ id: 2, conclusion: 'success' }, { id: 3, conclusion: 'success' }],
      201: [{ id: 11, run_attempt: 1, conclusion: 'failure' }, { id: 12, run_attempt: 2, conclusion: 'success' }],
      202: [{ id: 21, run_attempt: 1, conclusion: 'failure' }, { id: 22, run_attempt: 1, conclusion: 'skipped' }],
    };
    const rest = {
      actions: {
        listRepoWorkflows: async () => ({ data: workflows }),
        listWorkflowRuns: async p => { llamadas.push(['runs', p.event]); return { data: p.event === 'push' ? runsPush : runsPr }; },
        listWorkflowRunArtifacts: async p => ({ data: p.run_id === 101 ? [{ id: 5, name: 'vitest-report-app-1', expired: false }, { id: 6, name: 'otro', expired: false }] : [] }),
        downloadArtifact: async p => {
          llamadas.push(['zip', p.artifact_id]);
          const b = zip([{ nombre: 'report.json', texto: informe(fichero('packages/app/lento.test.ts', 0, 4000, ['passed', 'passed', 'failed']), fichero('packages/app/rapido.test.ts', 0, 10, ['passed'])), deflate: true }]);
          return { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };   // octokit entrega un ArrayBuffer
        },
        listJobsForWorkflowRun: async p => ({ data: jobs[p.run_id] || [] }),
        downloadJobLogsForWorkflowRun: async p => ({ data: p.job_id === 2 ? LOG : '2026-11-04T09:00:00.0000000Z lint ok\n' }),
      },
      checks: {
        listAnnotations: async p => ({ data: p.check_run_id === 11
          ? [{ annotation_level: 'failure', path: 'packages/app/flaky.test.ts', message: 'Test timed out in 5000ms.' }]
          : [{ annotation_level: 'failure', path: 'packages/app/lento.test.ts', message: 'el hash es el literal capturado' }, { annotation_level: 'failure', path: '.github', message: 'Process completed with exit code 1.' }, { annotation_level: 'warning', path: 'x', message: 'aviso' }] }),
      },
    };
    return { rest, paginate: async (f, p) => (await f(p)).data, llamadas };
  };
  const core = () => { const c = { out: {}, w: [], fallo: null }; Object.assign(c, { setOutput: (k, v) => { c.out[k] = v; }, setFailed: m => { c.fallo = m; }, warning: m => c.w.push(m), info: () => {}, notice: () => {} }); return c; };
  const context = { repo: { owner: 'o', repo: 'r' } };
  const montar = () => {
    const ws = mkdtempSync(join(tmpdir(), 'suite-steward-'));
    mkdirSync(join(ws, 'scripts')); copyFileSync(FUENTE, join(ws, 'scripts/suite-metricas.cjs'));
    return ws;
  };
  const env = (ws, modo = 'semanal') => ({ env: { GITHUB_WORKSPACE: ws, MODO: modo, CI_WORKFLOW_NAME: 'CI', DEFAULT_BRANCH: 'main', REPORT_PREFIX: 'vitest-report' } });
  const leer = ws => {
    const f = join(ws, '.suite-steward/metricas.json');
    return existsSync(f) ? { json: JSON.parse(readFileSync(f, 'utf8')), md: readFileSync(join(ws, '.suite-steward/metricas.md'), 'utf8') } : null;
  };
  { // artifacts del run del día + histórico desde log de la semana anterior + rojos
    const ws = montar(), c = core(), g = simula();
    await run({ github: g, context, core: c }, env(ws));
    const r = leer(ws);
    afirma(!!r && !c.fallo, `(int) escribe metricas.json y metricas.md (fallo: ${c.fallo})`);
    if (r) {
      const m = r.json;
      igual(m.serie.map(p => [p.run, p.fuente, p.tests, p.msTotal]), [[90, 'log', 4706, 1582060], [101, 'artifact', 3, 4010]], '(int) serie: semana desde log (solo el job con resumen) y día desde artifact');
      igual(m.top.map(e => e.fichero), ['packages/app/lento.test.ts', 'packages/app/rapido.test.ts'], '(int) top desde el zip del artifact `vitest-report-*`');
      afirma(g.llamadas.filter(l => l[0] === 'zip').length === 1, '(int) solo baja artifacts con el prefijo');
      afirma(m.tendencia.semanal.comparable === false && r.md.includes('cambio de fuente (log → artifact)'), '(int) frontera log→artifact marcada');
      igual(m.rojos.porClase, { literal: 1, timeout: 1, entorno: 0, 'aserción': 0 }, '(int) rojos por clase (solo nivel failure, sin la genérica del runner)');
      afirma(!m.rojos.porFichero.some(e => e.fichero === '.github'), '(int) `.github` no aparece como fichero en rojos');
      igual(m.inestables, [{ run: 201, fichero: 'packages/app/flaky.test.ts' }], '(int) inestable: rojo en intento 1, verde en el 2');
      igual([m.runsRojos, c.out.semana, m.modo, m.avisos], [2, M.semanaIso(new Date().toISOString()), 'semanal', []], '(int) runs rojos, output semana, sin avisos');
      afirma(!g.llamadas.some(l => l[0] === 'runs' && !['push', 'pull_request'].includes(l[1])), '(int) solo runs de push y de PR');
    }
    rmSync(ws, { recursive: true, force: true });
  }
  { // sin workflow de CI: informe con aviso, sin lanzar
    const ws = montar(), c = core();
    let lanzo = false;
    try { await run({ github: simula({ workflows: [{ id: 1, name: 'Deploy' }] }), context, core: c }, env(ws, 'inicial')); } catch { lanzo = true; }
    const r = leer(ws);
    afirma(!lanzo && r && r.md.includes('no hay workflow con name «CI»') && r.md.includes('sin informes de vitest') && c.w.length === 1 && !c.fallo, `(int) sin workflow de CI: ${r && r.md.slice(0, 120)} / lanzó=${lanzo}`);
    rmSync(ws, { recursive: true, force: true });
  }
  { // modo inválido: rojo y sin fichero
    const ws = montar(), c = core();
    await run({ github: simula(), context, core: c }, env(ws, 'mensual'));
    afirma(/modo inválido/.test(c.fallo || '') && !leer(ws), '(int) modo inválido ⇒ setFailed, sin métricas');
    rmSync(ws, { recursive: true, force: true });
  }
} else afirma(false, '(int) el step «Calcular métricas (AP-140)» no tiene `with.script`');

if (fallos.length) {
  console.error('CHECK-SUITE-METRICAS ROJO:');
  for (const f of fallos) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-suite-metricas verde: ${casos} casos sobre ${FUENTE}, la costura de ${WF} y su step «Calcular métricas (AP-140)» real.`);
