#!/usr/bin/env node
// check-gate-head — banco de `vendored/scripts/gate-head.cjs` (AP-139, central#408,
// ruling 2026-11-04, posición 18): el gate de merge se ata al HEAD — el LGTM al SHA
// revisado (`reviewer-lgtm-sha`) y el CI al SHA de su run.
//
// Parte 1 — el módulo REAL (no una copia), casos del punto 8 del ruling:
//  (a) `shaRevisado`; (b) `lgtmVigente` por SHA; (c) `ciOkPorRun`; (d) `remats`;
//  (e) `esUpdateDeBase`; (f) `revisadoPorCadena`; (g) `lgtmVigente` por cadena
//  `web-flow`; (h) `decidirAp024`, una fila por rama; más (i) el hallazgo D de la
//  crítica ronda 3: un REVIEW/NITS posterior al marcador revoca el LGTM por cadena
//  (y `needs-review` pendiente sobre un head `web-flow` también).
// Parte 2 — costura (regex sobre los YAML, método de
// `check-turn-close-detection.mjs`): `epic-merge.yml`, `watchdog.yml`, `reviewer.yml`.
// Se ejercita a sí misma: cada costura revertida en memoria tiene que ponerla roja.
// Parte 3 — integración: el step `scan` REAL de `watchdog.yml` sobre un mundo en
// memoria, con el módulo (`.cola-central` enlazado) y sin él (modo previo).
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { readFileSync, existsSync, mkdtempSync, symlinkSync } from 'fs';
import { createRequire } from 'module';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);
const FUENTES = ['vendored/scripts/gate-head.cjs', 'scripts/gate-head.cjs'];
const fuente = FUENTES.find(f => existsSync(f));
if (!fuente) {
  console.log('::warning::check-gate-head — no encuentro `gate-head.cjs`: el banco NO se ha ejecutado.');
  process.exit(0);
}
const GH = require(resolve(fuente));

let fails = 0, n = 0;
const check = (ok, msg, extra) => {
  n++;
  if (process.env.GATE_HEAD_VERBOSE || !ok) console.log(`${ok ? '  ok ' : '  ROJO'} ${msg}`);
  if (!ok) { fails++; if (extra !== undefined) console.log('       ', JSON.stringify(extra)); }
};

const PAT = 'talfarouriarte-cloud';
const sha = c => c.repeat(40);
const A = sha('a'), B = sha('b'), C = sha('c'), X = sha('e');
const com = (login, body, created_at = '2026-11-04T09:00:00Z') => ({ user: { login }, body, created_at });
const marca = s => `**reviewer · \`lgtm\` materializado sobre \`${s.slice(0, 7)}\`**\n\n<!-- reviewer-lgtm-sha: ${s} -->`;
// Commits: `{ parents, committerLogin }`. W = merge `web-flow` con primera madre `p1`.
const W = (p1, p2 = X) => ({ parents: [p1, p2], committerLogin: 'web-flow' });
const propio = p => ({ parents: [p], committerLogin: 'claude[bot]' });

// ── (a) shaRevisado ─────────────────────────────────────────────────────────
check(GH.shaRevisado([com(PAT, marca(A)), com(PAT, 'texto'), com(PAT, marca(B))], PAT) === B, '(a) dos marcadores del PAT ⇒ el último');
check(GH.shaRevisado([com('claude[bot]', marca(A))], PAT) === null, '(a) marcador en un comentario de otro autor ⇒ null');
check(GH.shaRevisado([com(PAT, `Cito el marcador \`<!-- reviewer-lgtm-sha: ${A} -->\` en prosa.`)], PAT) === null, '(a) marcador citado en prosa (no en línea propia) ⇒ null');
check(GH.shaRevisado([], PAT) === null, '(a) sin comentarios ⇒ null');

// ── (b) lgtmVigente por SHA ─────────────────────────────────────────────────
check(GH.lgtmVigente({ labels: ['lgtm'], shaRevisado: A, headSha: A, commits: new Map(), ultimoEsLgtm: true }) === true, '(b) label y SHA iguales ⇒ true');
check(GH.lgtmVigente({ labels: ['lgtm'], shaRevisado: A, headSha: B, commits: new Map([[B, propio(A)]]), ultimoEsLgtm: true }) === false, '(b) SHA distinto (commit propio) ⇒ false');
check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: A, commits: new Map(), ultimoEsLgtm: true }) === false, '(b) sin label ⇒ false');
check(GH.lgtmVigente({ labels: ['lgtm'], shaRevisado: null, headSha: A, commits: new Map(), ultimoEsLgtm: true }) === false, '(b) sin marcador ⇒ false');

// ── (c) ciOkPorRun ──────────────────────────────────────────────────────────
const run = (o) => ({ name: 'CI', conclusion: 'success', head_sha: A, ...o });
check(GH.ciOkPorRun({ run: run({ head_sha: B }), headSha: A, ciName: 'CI' }) === false, '(c) success con SHA distinto ⇒ false');
check(GH.ciOkPorRun({ run: run(), headSha: A, ciName: 'CI' }) === true, '(c) success con el mismo SHA ⇒ true');
check(GH.ciOkPorRun({ run: run({ conclusion: 'skipped' }), headSha: A, ciName: 'CI' }) === false, '(c) skipped ⇒ false');
check(GH.ciOkPorRun({ run: run({ name: 'Opus Reviewer' }), headSha: A, ciName: 'CI' }) === false, '(c) otro workflow ⇒ false');
check(GH.ciOkPorRun({ run: null, headSha: A, ciName: 'CI' }) === false, '(c) sin run (evento labeled) ⇒ false');

// ── (d) remats ──────────────────────────────────────────────────────────────
const rm = s => ({ body: `x\n\n<!-- watchdog-lgtm-rematerialize: ${s} -->\n<!-- watchdog-capa: schedule -->` });
check(GH.remats({ comentarios: [rm(A)], headSha: A }) === 1, '(d) forma con SHA del head ⇒ 1');
check(GH.remats({ comentarios: [rm(B)], headSha: A }) === 0, '(d) forma con SHA de otro head ⇒ 0');
check(GH.remats({ comentarios: [{ body: 'x\n\n<!-- watchdog-lgtm-rematerialize -->' }], headSha: A }) === 1, '(d) solo forma vieja ⇒ 1');
check(GH.remats({ comentarios: [{ body: '<!-- watchdog-lgtm-rematerialize -->' }, rm(B)], headSha: A }) === 0, '(d) forma vieja + forma con SHA de otro head ⇒ 0 (la vieja solo cuenta sin ninguna con SHA)');

// ── (e) esUpdateDeBase ──────────────────────────────────────────────────────
check(GH.esUpdateDeBase(W(A)) === true, '(e) dos madres + web-flow ⇒ true');
check(GH.esUpdateDeBase({ parents: [A, X], committerLogin: 'github-actions[bot]' }) === false, '(e) dos madres + otro committer (append-only AP-130) ⇒ false');
check(GH.esUpdateDeBase({ parents: [A], committerLogin: 'web-flow' }) === false, '(e) una madre ⇒ false');
{
  const m = GH.mapaCommits([{ sha: B, parents: [{ sha: A }, { sha: X }], committer: { login: 'web-flow' } }]);
  check(GH.esUpdateDeBase(m.get(B)) === true, '(e) `mapaCommits` normaliza la forma de `pulls.listCommits`');
}

// ── (f) revisadoPorCadena ───────────────────────────────────────────────────
check(GH.revisadoPorCadena({ headSha: A, shaRevisado: A, commits: new Map() }) === true, '(f) head = revisado ⇒ true');
check(GH.revisadoPorCadena({ headSha: B, shaRevisado: A, commits: new Map([[B, W(A)]]), marcadosUpdate: new Set([A]) }) === true, '(f) head = merge web-flow cuya primera madre es el revisado (marcada) ⇒ true');
check(GH.revisadoPorCadena({ headSha: C, shaRevisado: A, commits: new Map([[C, W(B)], [B, W(A)]]), marcadosUpdate: new Set([A, B]) }) === true, '(f) dos merges web-flow encadenados (ambos marcados) ⇒ true');
check(GH.revisadoPorCadena({ headSha: C, shaRevisado: A, commits: new Map([[C, W(B)], [B, W(A)]]), marcadosUpdate: new Set([A]) }) === false, '(f) dos merges web-flow, el segundo sin marcador ⇒ false');
check(GH.revisadoPorCadena({ headSha: C, shaRevisado: A, commits: new Map([[C, W(B)], [B, propio(A)]]), marcadosUpdate: new Set([A, B]) }) === false, '(f) merge web-flow sobre un commit propio posterior al revisado ⇒ false');
check(GH.revisadoPorCadena({ headSha: B, shaRevisado: A, commits: new Map([[B, { parents: [A, X], committerLogin: 'github-actions[bot]' }]]), marcadosUpdate: new Set([A]) }) === false, '(f) merge append-only no web-flow ⇒ false');
check(GH.revisadoPorCadena({ headSha: B, shaRevisado: A, commits: new Map([[B, W(X, A)]]), marcadosUpdate: new Set([A, X]) }) === false, '(f) el revisado solo como SEGUNDA madre ⇒ false (se sigue la primera)');

// ── (g) lgtmVigente por cadena ──────────────────────────────────────────────
check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), marcadosUpdate: new Set([A]), ultimoEsLgtm: true }) === true, '(g) sin label y head = merge web-flow del revisado ⇒ true');

// ── (iv)/(v) enmienda del Architect, punto 2: solo los `updateBranch` de epic-merge ─
{
  const marcaUpd = s2 => com(PAT, `**epic-merge · \`updateBranch\`**\n\n<!-- epic-merge-update-branch: ${s2} -->`);
  const set = GH.shasUpdateMarcados([marcaUpd(A), com('claude[bot]', `<!-- epic-merge-update-branch: ${B} -->`), com(PAT, `cita \`<!-- epic-merge-update-branch: ${C} -->\``)], PAT);
  check(set.has(A) && !set.has(B) && !set.has(C), '(iv) `shasUpdateMarcados`: solo el autor PAT y en línea propia');
  check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), marcadosUpdate: GH.shasUpdateMarcados([marcaUpd(A)], PAT), ultimoEsLgtm: true }) === true, '(iv) merge web-flow con marcador de su primera madre ⇒ true');
  check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), marcadosUpdate: new Set(), ultimoEsLgtm: true }) === false, '(v) merge web-flow sin marcador («Resolve conflicts» web) ⇒ false');
  check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), ultimoEsLgtm: true }) === false, '(v) sin conjunto de marcados ⇒ false (fail-closed)');
}

// ── (i) crítica ronda 3, D: todo LGTM vigente exige que el último veredicto sea LGTM
{
  const M = new Set([A]);
  const ult = cs => GH.ultimoVeredicto(cs, PAT) === 'LGTM';
  check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), marcadosUpdate: M, ultimoEsLgtm: ult([com(PAT, 'LGTM'), com(PAT, marca(A)), com(PAT, 'REVIEW\n🔴')]) }) === false, '(i) head = merge web-flow del revisado + REVIEW posterior ⇒ false');
  check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), marcadosUpdate: M, ultimoEsLgtm: ult([com(PAT, 'LGTM'), com(PAT, marca(A)), com(PAT, 'NITS\n- x')]) }) === false, '(ii) mismo caso con NITS posterior ⇒ false');
  check(GH.lgtmVigente({ labels: ['lgtm'], shaRevisado: A, headSha: A, commits: new Map(), ultimoEsLgtm: ult([com(PAT, 'LGTM'), com(PAT, marca(A)), com(PAT, 'REVIEW\n🔴')]) }) === false, '(iii) rama 1 (label + SHA igual) con REVIEW posterior ⇒ false');
}
check(GH.lgtmVigente({ labels: ['lgtm'], shaRevisado: A, headSha: A, commits: new Map(), ultimoEsLgtm: false }) === false, '(i) último veredicto no-LGTM con label y SHA iguales ⇒ false');
check(GH.lgtmVigente({ labels: ['needs-review'], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), marcadosUpdate: new Set([A]), ultimoEsLgtm: true }) === false, '(i) `needs-review` pendiente sobre el head web-flow ⇒ false');
check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), marcadosUpdate: new Set([A]) }) === false, '(i) `ultimoEsLgtm` ausente ⇒ false (fail-closed)');
{
  const cs = [com(PAT, 'LGTM\n\nok'), com(PAT, marca(A)), com(PAT, 'REVIEW\n\n🔴 algo')];
  check(GH.ultimoVeredicto(cs, PAT) === 'REVIEW', '(i) `ultimoVeredicto` ⇒ el último veredicto del Reviewer');
  check(GH.ultimoVeredicto([com('claude[bot]', 'LGTM yo')], PAT) === null, '(i) `ultimoVeredicto` ignora a otros autores');
  check(GH.ultimoVeredicto([com(PAT, marca(A))], PAT) === null, '(i) el marcador del SHA revisado no es un veredicto');
}

// ── (E2) AP-142, central#418: paso mecánico del Watchdog en la cadena ─────────
{
  const MEC = (p1, p2 = X) => ({ parents: [p1, p2], committerLogin: 'github-actions[bot]' });
  const marcaMec = (m, h0, login = PAT) => com(login, `**watchdog · merge mecánico**\n\n${GH.marcaMecanico(m, h0)}`);
  const vig = (cs, o = {}) => GH.lgtmVigente({ labels: ['lgtm', 'ci-verde'], shaRevisado: A, headSha: B, commits: new Map([[B, MEC(A)]]),
    marcadosUpdate: new Set(), marcadosMecanico: GH.shasMecanicoMarcados(cs, PAT), ultimoEsLgtm: true, ...o });
  check(vig([marcaMec(B, A)]) === true, '(E2) head M marcado sobre H0 revisado, con `lgtm` ⇒ vigente');
  check(vig([]) === false, '(E2) M sin marcador ⇒ no');
  check(vig([marcaMec(B, A, 'claude[bot]')]) === false, '(E2) marcador de un autor no de confianza ⇒ no');
  check(vig([marcaMec(B, C)]) === false, '(E2) `parents[0]` ≠ `revisado=` del marcador ⇒ no');
  check(vig([marcaMec(B, A)], { labels: ['ci-verde'] }) === false, '(E2) cadena mecánica sin la label `lgtm` viva ⇒ no');
  check(vig([marcaMec(B, A)], { commits: new Map([[B, { parents: [A], committerLogin: 'x' }]]) }) === false, '(E2) M con una sola madre ⇒ no');
  check(GH.shasMecanicoMarcados([com(PAT, `cita \`${GH.marcaMecanico(B, A)}\``)], PAT).size === 0, '(E2) marcador citado en prosa ⇒ no cuenta');
  // Cadena mixta: M mecánico sobre un merge web-flow de updateBranch sobre el revisado.
  check(GH.lgtmVigente({ labels: ['lgtm'], shaRevisado: A, headSha: C, commits: new Map([[C, MEC(B)], [B, W(A)]]), marcadosUpdate: new Set([A]),
    marcadosMecanico: new Map([[C, B]]), ultimoEsLgtm: true }) === true, '(E2) cadena mixta mecánico + web-flow marcados ⇒ vigente');
  // decidirAp024 sobre un head mecánico: no re-materializa; sin `lgtm` ⇒ Reviewer.
  const dm = o => GH.decidirAp024({ ultimoEsLgtm: true, hasLgtm: true, shaRevisado: A, headSha: B, headSinCambiosDesdeVeredicto: false,
    commits: new Map([[B, MEC(A)]]), marcadosUpdate: new Set(), marcadosMecanico: new Map([[B, A]]), remats: 0, rectHold: false, ...o });
  check(dm({}) === null, '(E2) decidirAp024: head mecánico marcado con `lgtm` ⇒ null (no se toca nada)');
  check(dm({ hasLgtm: false }) === 'reviewer', "(E2) decidirAp024: head mecánico sin `lgtm` ⇒ 'reviewer'");
  check(dm({ marcadosMecanico: new Map() }) === 'reviewer', "(E2) decidirAp024: head mecánico SIN marcador ⇒ 'reviewer'");
}

// ── (h) decidirAp024 ────────────────────────────────────────────────────────
const d = o => GH.decidirAp024({ ultimoEsLgtm: true, hasLgtm: false, shaRevisado: A, headSha: A, headSinCambiosDesdeVeredicto: false, commits: new Map(), remats: 0, rectHold: false, ...o });
check(d({}) === 'remat', "(h) 'remat': crash con head = revisado");
check(d({ headSha: B, commits: new Map([[B, W(A)]]), marcadosUpdate: new Set([A]) }) === 'remat', "(h) 'remat': head de updateBranch de epic-merge");
check(d({ headSha: B, commits: new Map([[B, W(A)]]), marcadosUpdate: new Set() }) === 'reviewer', "(h) 'reviewer': head web-flow sin marcador de updateBranch");
check(d({ remats: 1 }) === null, '(h) null: cap 1 por head agotado');
check(d({ shaRevisado: null, headSinCambiosDesdeVeredicto: true }) === 'rellenar-y-remat', "(h) 'rellenar-y-remat': sin marcador, head sin cambios, sin `lgtm`");
check(d({ shaRevisado: null, headSinCambiosDesdeVeredicto: true, hasLgtm: true }) === 'rellenar-y-remat', "(h) 'rellenar-y-remat': sin marcador, head sin cambios, con `lgtm`");
check(d({ shaRevisado: null, headSinCambiosDesdeVeredicto: false }) === 'reviewer', "(h) 'reviewer': sin marcador, head con cambios");
check(d({ headSha: B, commits: new Map([[B, propio(A)]]) }) === 'reviewer', "(h) 'reviewer': marcador de otro head sin cadena");
check(d({ hasLgtm: true }) === null, '(h) null: con `lgtm` vigente');
check(d({ rectHold: true }) === null, '(h) null: con `rectHold`');
check(d({ ultimoEsLgtm: false }) === null, '(h) null: último veredicto no-LGTM');

// ── Parte 2: costura ────────────────────────────────────────────────────────
const leer = f => (existsSync(f) ? readFileSync(f, 'utf8') : null);
const EM = leer('.github/workflows/epic-merge.yml');
const WD = leer('.github/workflows/watchdog.yml');
const RVW = leer('.github/workflows/reviewer.yml');

function costuras(em, wd, rv) {
  const f = [];
  if (em != null) {
    if (!/GH\.lgtmVigente\(/.test(em)) f.push('epic-merge.yml no invoca `lgtmVigente`');
    if (!/GH\.ciOkPorRun\(/.test(em)) f.push('epic-merge.yml no invoca `ciOkPorRun`');
    if (!/pulls\.merge\(\{[^}]*\bsha:\s*pf\.head\.sha/.test(em)) f.push('epic-merge.yml no pasa `sha: pf.head.sha` a `pulls.merge`');
    if (em.includes('/^\\s*LGTM\\b/')) f.push('epic-merge.yml aún contiene el regex del respaldo por comentarios (`/^\\s*LGTM\\b/`)');
    {
      const trozos = em.split('pulls.updateBranch(');
      // AP-141: el tercero es el `behind` de la relectura del reintento 5xx.
      if (trozos.length !== 4) f.push(`epic-merge.yml llama a \`pulls.updateBranch\` ${trozos.length - 1} veces (se esperaban 3)`);
      else if (!trozos[0].includes('epic-merge-update-branch') || !trozos.slice(0, 3).every(t => /await marcarUpdateBranch\(/.test(t.slice(Math.max(0, t.length - 700)))))
        f.push('epic-merge.yml: `epic-merge-update-branch` no se publica (`marcarUpdateBranch`) antes de cada `pulls.updateBranch`');
      if (!/GH\.shasUpdateMarcados\(/.test(em) || !/marcadosUpdate, (marcadosMecanico, )?ultimoEsLgtm/.test(em)) f.push('epic-merge.yml no pasa los `updateBranch` marcados a `lgtmVigente`');
      // AP-142 E2: el merge mecánico marcado del Watchdog también entra en GATE 2.
      if (!/GH\.shasMecanicoMarcados\(comments, await loginPAT\(\)\)/.test(em) || !/marcadosUpdate, marcadosMecanico, ultimoEsLgtm/.test(em)) f.push('epic-merge.yml no pasa los merges mecánicos marcados (`shasMecanicoMarcados`) a `lgtmVigente` (AP-142 E2)');
    }
    if (!/gate-head\.cjs`\); \}\s*\n\s*catch \(e\) \{ await diag\([^\n]*fail-closed[^\n]*\); return; \}/.test(em)) f.push('epic-merge.yml no carga `gate-head.cjs` fail-closed (diag + return)');
  }
  if (wd != null) {
    if (!/GH\.decidirAp024\(/.test(wd)) f.push('watchdog.yml no invoca `decidirAp024`');
    if (!wd.includes('watchdog-lgtm-rematerialize: ')) f.push('watchdog.yml no escribe la forma con SHA de `watchdog-lgtm-rematerialize`');
    if (!wd.includes('watchdog-lgtm-ci-rearm')) f.push('watchdog.yml no contiene `watchdog-lgtm-ci-rearm`');
    // AP-142 E2: el belt AP-024 y la rama `lgtm` sin CI ven los merges mecánicos marcados.
    if (!/marcadosUpdate: marcados, marcadosMecanico: mecanicosM,/.test(wd) || !/marcadosMecanico: lgtmMecanicos, ultimoEsLgtm: true/.test(wd)) f.push('watchdog.yml no pasa `marcadosMecanico` a `decidirAp024`/`lgtmVigente` (AP-142 E2)');
    if (!wd.includes("'lgtm-sin-ci'")) f.push('watchdog.yml no declara la anomalía `lgtm-sin-ci`');
    if (!wd.includes('gate-head ausente: AP-024 en modo previo')) f.push('watchdog.yml no contiene el aviso literal del modo previo');
    const iRev = wd.indexOf("ap024 === 'reviewer'");
    const iAuto = wd.indexOf("else if (process.env.IN_AUTOMERGE === 'false')");
    if (iRev < 0 || iAuto < 0 || iRev > iAuto) f.push('watchdog.yml: la rama del punto 5 (`ap024 === \'reviewer\'`) no está ANTES de la de `IN_AUTOMERGE === \'false\'`');
    // Modo previo (punto 7): la condición de hoy, literal, en la rama `!GH`.
    const m = wd.match(/\} else if \(!GH\) \{([\s\S]*?)\n {16}\}\n/);
    const previo = m ? m[1] : '';
    if (!previo.includes('gate-head ausente: AP-024 en modo previo')) f.push('watchdog.yml: el aviso del modo previo no está en la rama `!GH`');
    if (!/headAfterVerdict = new Date\(headCommit\.commit\.committer\.date\) > new Date\(lastVerdict\.created_at\)/.test(previo)
      || !previo.includes('if (!hasLgtm && !headAfterVerdict && remats < 1 && !rectHold)')
      || !previo.includes('${LGTM_REMAT_MARK}')) f.push('watchdog.yml: la rama `!GH` no conserva literal la condición AP-024 de hoy (`headAfterVerdict` por fecha + marcador sin SHA)');
    if (/ap024|revSha|lgtm-ci-rearm/.test(previo)) f.push('watchdog.yml: la rama `!GH` usa piezas del gate por head (las ramas 5-6 deben quedar inactivas)');
    // Las ramas 5 y 6 exigen el módulo.
    if (!/else if \(GH && ap024 === 'reviewer'\)/.test(wd)) f.push('watchdog.yml: la rama del punto 5 no exige el módulo (`GH && …`)');
    if (!/else if \(GH && gateHeadOk && hasLgtm && GH\.lgtmVigente\(/.test(wd)) f.push('watchdog.yml: la rama `lgtm` sin CI no exige el módulo');
  }
  if (rv != null) {
    const ocurr = rv.split('reviewer-lgtm-sha').length - 1;
    if (ocurr !== 1) f.push(`reviewer.yml contiene \`reviewer-lgtm-sha\` ${ocurr} veces (debe ser UNA)`);
    const iM = rv.indexOf('reviewer-lgtm-sha');
    const iL = rv.indexOf("JSON.stringify({ labels: ['lgtm'] })");
    if (iL < 0 || iM < 0 || iM > iL) f.push('reviewer.yml: el marcador no se escribe ANTES de la llamada `POST …/labels` con `lgtm`');
    if (!/if \(!marcado\) \{[^\n]*return; \}/.test(rv)) f.push('reviewer.yml: sin marcador publicado no corta antes de la label (fail-closed)');
    // La forma que escribe reviewer.yml casa con el lector del módulo.
    const lit = (rv.match(/<!-- reviewer-lgtm-sha: \$\{headSha\} -->/) || [])[0];
    if (!lit || !GH.PATRONES.MARCA_SHA_RE.test(`x\n\n${lit.replace('${headSha}', 'f'.repeat(40))}`)) f.push('reviewer.yml: la forma del marcador no casa con `MARCA_SHA_RE` del módulo');
  }
  return f;
}

const fallosCostura = costuras(EM, WD, RVW);
for (const x of fallosCostura) check(false, `costura — ${x}`);
if (EM == null || WD == null || RVW == null) console.log('::warning::check-gate-head — falta algún workflow (¿consumidor?): costura parcial.');
// Auto-ejercicio: cada costura revertida en memoria la pone roja.
if (EM != null && WD != null && RVW != null) {
  const mut = [
    ['epic-merge sin sha', () => costuras(EM.replace(/, sha: pf\.head\.sha \}\)/, ' })'), WD, RVW)],
    ['epic-merge con respaldo', () => costuras(EM + '\n/^\\s*LGTM\\b/\n', WD, RVW)],
    ['epic-merge sin ciOkPorRun', () => costuras(EM.replace(/GH\.ciOkPorRun\(/g, 'X('), WD, RVW)],
    ['watchdog rama 5 tras IN_AUTOMERGE', () => costuras(EM, WD.replace(/ap024 === 'reviewer'/g, 'ap024 === "reviewer"'), RVW)],
    ['watchdog sin aviso', () => costuras(EM, WD.replace('gate-head ausente: AP-024 en modo previo', 'x'), RVW)],
    ['watchdog modo previo alterado', () => costuras(EM, WD.replace('if (!hasLgtm && !headAfterVerdict && remats < 1 && !rectHold)', 'if (!hasLgtm && remats < 1)'), RVW)],
    ['reviewer marcador duplicado', () => costuras(EM, WD, RVW + '\n// reviewer-lgtm-sha\n')],
    ['epic-merge updateBranch sin marcador', () => costuras(EM.replace(/await marcarUpdateBranch\(shaGate\)/, 'null'), WD, RVW)],
    ['reviewer sin fail-closed', () => costuras(EM, WD, RVW.replace(/if \(!marcado\) \{/, 'if (false) {'))],
    ['epic-merge sin marcadosMecanico', () => costuras(EM.replace('marcadosUpdate, marcadosMecanico, ultimoEsLgtm', 'marcadosUpdate, ultimoEsLgtm'), WD, RVW)],
    ['watchdog AP-024 sin marcadosMecanico', () => costuras(EM, WD.replace('marcadosMecanico: mecanicosM,', ''), RVW)],
  ];
  for (const [nom, fn] of mut) check(fn().length > fallosCostura.length, `auto-ejercicio: «${nom}» pone la costura roja`);
}

// ── Parte 3: integración con el scan REAL del Watchdog ─────────────────────
if (WD != null) {
  const steps = Object.values(yaml.load(WD).jobs || {}).flatMap(j => j.steps || []);
  const scanStep = steps.find(st => st.id === 'scan');
  const scanRun = cargarStep(scanStep.with.script, 'scan');
  const WS_CON = mkdtempSync(join(tmpdir(), 'gh-wd-'));
  symlinkSync(process.cwd(), join(WS_CON, '.cola-central'));
  const WS_SIN = mkdtempSync(join(tmpdir(), 'gh-wd-sin-'));
  const T = min => new Date(Date.now() + min * 60000).toISOString();
  const HEAD = '9'.repeat(40), PREV = '8'.repeat(40);
  async function scan({ comentarios, labels = [], commits = [], headDate = T(-60), eventos = [], ciRuns = [], automerge = 'true', ws = WS_CON }) {
    const w = { out: {}, pat: [], comentarios: [], warnings: [] };
    const pr = { number: 5, title: 'x', body: '', draft: false, node_id: 'n', head: { ref: 'claude/issue-4-x', sha: HEAD }, base: { ref: 'main', sha: 'b0' },
      labels: labels.map(name => ({ name })), created_at: T(-600), updated_at: T(-60), user: { login: 'claude[bot]' } };
    const conocidos = {
      pulls: { list: async () => ({ data: [pr] }), get: async () => ({ data: { ...pr, mergeable: true, mergeable_state: 'clean' } }),
        listCommits: async () => ({ data: commits }) },
      repos: { getCommit: async p => ({ data: { sha: p.ref, commit: { message: 'feat', committer: { date: headDate } } } }) },
      issues: { listComments: async p => ({ data: p.issue_number === 5 ? comentarios : [] }), listEvents: async () => ({ data: eventos }),
        createComment: async p => { w.comentarios.push(p.body); return { data: { id: 1 } }; } },
      actions: { listWorkflowRunsForRepo: async () => ({ data: { workflow_runs: ciRuns } }), listJobsForWorkflowRun: async () => ({ data: { total_count: 0, jobs: [] } }) },
    };
    const vacio = async () => ({ data: [] });
    const rest = new Proxy({}, { get: (_, ns) => new Proxy({}, { get: (_, m) => (conocidos[ns] && conocidos[ns][m]) || vacio }) });
    const github = { rest, graphql: async () => ({}), paginate: async (fn, p) => { const r = await fn(p); return Array.isArray(r.data) ? r.data : (r.data && (r.data.workflow_runs || r.data.items)) || []; } };
    const fetch = async (url, o = {}) => { if (/statuses/.test(url)) return { ok: true, status: 201, json: async () => ({}) };
      w.pat.push(`${o.method || 'GET'} ${url.replace(/^https:\/\/api\.github\.com\/repos\/o\/r/, '')}${o.body ? ' ' + o.body : ''}`); return { ok: true, status: 200, json: async () => ([]), text: async () => '' }; };
    const core = { setOutput: (k, v) => { w.out[k] = String(v); }, notice() {}, warning: m => w.warnings.push(String(m)), info() {}, setFailed() {} };
    await scanRun({ github, context: { repo: { owner: 'o', repo: 'r' }, eventName: 'schedule', payload: {}, runId: 1 }, core },
      { env: { GITHUB_WORKSPACE: ws, STATUS_TOKEN: 'x', ARM_PAT: 'x', IN_CREATOR_WF: 'Claude Code', IN_REVIEWER_WF: 'Opus Reviewer', IN_CI_WF: 'CI',
        IN_EPIC_MERGE_WF: 'Epic merge', IN_EXTRA_WFS: '', IN_LOOKBACK_MIN: '45', IN_SKIP_LABELS: 'human-needed,pause-agents', IN_AUTOMERGE: automerge, IN_DEFAULT_BRANCH: 'main' },
        globales: { fetch } });
    w.anomalias = JSON.parse(w.out.anomalies || '[]');
    return w;
  }
  const LG = com(PAT, 'LGTM\n\nok', T(-30));
  const MK = s2 => com(PAT, marca(s2), T(-30));
  const tiene = (w, re) => w.pat.some(x => re.test(x));
  {
    const w = await scan({ comentarios: [LG, MK(HEAD)] });
    check(tiene(w, /^POST \/issues\/5\/labels .*"lgtm"/) && w.comentarios.some(b => b.includes(`<!-- watchdog-lgtm-rematerialize: ${HEAD} -->`)),
      "(int) 'remat': marcador = head, sin `lgtm` ⇒ `lgtm` por PAT + marcador con SHA", w);
  }
  {
    const w = await scan({ comentarios: [LG, MK(HEAD), { body: `x\n\n<!-- watchdog-lgtm-rematerialize: ${HEAD} -->`, user: { login: 'github-actions[bot]' }, created_at: T(-10) }] });
    check(!tiene(w, /"lgtm"/), '(int) cap 1 por head: con el marcador del head ya presente ⇒ sin re-materializar', w);
  }
  {
    const WF = [{ sha: HEAD, parents: [{ sha: PREV }, { sha: '7'.repeat(40) }], committer: { login: 'web-flow' } }];
    const UPD = com(PAT, `x\n\n<!-- epic-merge-update-branch: ${PREV} -->`, T(-20));
    const w = await scan({ comentarios: [LG, MK(PREV), UPD], commits: WF });
    check(tiene(w, /^POST \/issues\/5\/labels .*"lgtm"/), "(int) 'remat': head `web-flow` de updateBranch de epic-merge sobre el SHA revisado ⇒ `lgtm`", w);
    const w2 = await scan({ comentarios: [LG, MK(PREV)], commits: WF });
    check(tiene(w2, /^POST \/issues\/5\/labels .*"needs-review"/) && !tiene(w2, /^POST \/issues\/5\/labels .*"lgtm"/), "(int) head `web-flow` SIN marcador de updateBranch («Resolve conflicts») ⇒ turno del Reviewer", w2);
  }
  {
    const w = await scan({ comentarios: [LG], headDate: T(-120) });
    check(tiene(w, new RegExp(`^POST /issues/5/comments .*reviewer-lgtm-sha: ${HEAD}`)) && tiene(w, /^POST \/issues\/5\/labels .*"lgtm"/),
      "(int) 'rellenar-y-remat': sin marcador, head sin cambios ⇒ marcador por PAT + `lgtm`", w);
  }
  {
    const w = await scan({ comentarios: [LG], labels: ['lgtm'], headDate: T(-120) });
    const iC = w.pat.findIndex(x => /reviewer-lgtm-sha/.test(x)), iD = w.pat.findIndex(x => /^DELETE \/issues\/5\/labels\/lgtm/.test(x)),
      iP = w.pat.findIndex(x => /^POST \/issues\/5\/labels .*"lgtm"/.test(x));
    check(iC >= 0 && iC < iD && iD < iP, "(int) 'rellenar-y-remat' con `lgtm` puesta (PR en vuelo) ⇒ marcador y luego DELETE + POST de `lgtm` (re-dispara epic-merge)", w);
  }
  for (const automerge of ['true', 'false']) {
    const w = await scan({ comentarios: [LG, MK(PREV)], labels: ['lgtm'], commits: [{ sha: HEAD, parents: [{ sha: PREV }], committer: { login: 'claude[bot]' } }], automerge });
    check(tiene(w, /^DELETE \/issues\/5\/labels\/lgtm/) && tiene(w, /^POST \/issues\/5\/labels .*"needs-review"/) && w.comentarios.some(b => b.includes('watchdog-turn-relaunch')),
      `(int) 'reviewer': commit propio tras el SHA revisado (automerge=${automerge}) ⇒ quita \`lgtm\` + \`needs-review\` por PAT, cap 2`, w);
  }
  {
    const w = await scan({ comentarios: [LG], headDate: T(10) });
    check(tiene(w, /^POST \/issues\/5\/labels .*"needs-review"/) && !tiene(w, /reviewer-lgtm-sha/), "(int) 'reviewer': sin marcador y head posterior al veredicto ⇒ `needs-review`, sin relleno", w);
  }
  const labeled = [{ event: 'labeled', label: { name: 'lgtm' }, created_at: T(-20) }];
  {
    const w = await scan({ comentarios: [LG, MK(HEAD)], labels: ['lgtm', 'ci-verde'], eventos: labeled });
    check(tiene(w, /^DELETE \/issues\/5\/labels\/lgtm/) && tiene(w, /^POST \/issues\/5\/labels .*"lgtm"/) && w.comentarios.some(b => b.includes(`<!-- watchdog-lgtm-ci-rearm: ${HEAD} -->`)),
      '(int) `lgtm` vigente ≥ 15 min sin CI en su head ⇒ DELETE + POST de `lgtm` + `watchdog-lgtm-ci-rearm`', w);
  }
  {
    const w = await scan({ comentarios: [LG, MK(HEAD)], labels: ['lgtm'], eventos: labeled,
      ciRuns: [{ name: 'CI', head_sha: HEAD, status: 'in_progress', conclusion: null, created_at: T(-5), id: 1 }] });
    check(!tiene(w, /lgtm/) && !w.comentarios.some(b => b.includes('watchdog-lgtm-ci-rearm')), '(int) con run de CI sobre el head ⇒ sin re-arm', w);
  }
  {
    const w = await scan({ comentarios: [LG, MK(HEAD)], labels: ['lgtm'], eventos: [{ event: 'labeled', label: { name: 'lgtm' }, created_at: T(-5) }] });
    check(!w.comentarios.some(b => b.includes('watchdog-lgtm-ci-rearm')), '(int) `labeled` de hace < 15 min ⇒ sin re-arm', w);
  }
  {
    const w = await scan({ comentarios: [LG, MK(HEAD), { body: `x\n\n<!-- watchdog-lgtm-ci-rearm: ${HEAD} -->`, user: { login: 'github-actions[bot]' }, created_at: T(-10) }], labels: ['lgtm'], eventos: labeled });
    check(w.anomalias.some(a => a.type === 'lgtm-sin-ci') && !tiene(w, /lgtm/), '(int) re-arm ya hecho para el head ⇒ anomalía `lgtm-sin-ci`, sin tocar labels', w.anomalias);
  }
  // AP-146 (4′, central#427): head M con la línea E1′ `watchdog-merge-mecanico-ci: pendiente <M>`.
  {
    const E1P = com(PAT, `x\n\n<!-- watchdog-merge-mecanico: ${HEAD} revisado=${PREV} -->\n<!-- watchdog-merge-mecanico-ci: pendiente ${HEAD} -->`, T(-30));
    const labRerun = t => ({ event: 'labeled', label: { name: 'ci-rerun' }, created_at: t });
    const lgtmEscrita = w => tiene(w, /^DELETE \/issues\/5\/labels\/lgtm/) || tiene(w, /^POST \/issues\/5\/labels .*"lgtm"/);
    {
      const w = await scan({ comentarios: [LG, MK(HEAD), E1P], labels: ['lgtm'], eventos: labeled });
      check(tiene(w, /^POST \/issues\/5\/labels .*"ci-rerun"/) && !lgtmEscrita(w) && w.comentarios.some(b => b.includes(`<!-- watchdog-ci-rerun: ${HEAD} -->`))
        && !w.comentarios.some(b => b.includes('watchdog-lgtm-ci-rearm')),
        '(int, AP-146 g) head con marcador E1′ y sin run de CI ⇒ `POST ci-rerun` por PAT, sin tocar `lgtm`', w);
    }
    {
      const w = await scan({ comentarios: [LG, MK(HEAD), E1P], labels: ['lgtm', 'ci-rerun'], eventos: [...labeled, labRerun(T(-16))] });
      const b = w.comentarios.find(x => x.includes(`<!-- watchdog-lgtm-ci-rearm: ${HEAD} -->`)) || '';
      check(tiene(w, /^DELETE \/issues\/5\/labels\/lgtm/) && tiene(w, /^POST \/issues\/5\/labels .*"lgtm"/) && b.includes('consumidor sin `ci-rerun`')
        && b.includes(`<!-- watchdog-e1p-respaldo: ${HEAD} -->`) && !tiene(w, /"ci-rerun"/),
        '(int, AP-146 h) `ci-rerun` ≥ 15 min sin run de CI sobre M ⇒ respaldo DELETE + POST de `lgtm` con diag «consumidor sin `ci-rerun`»', w);
    }
    {
      const w = await scan({ comentarios: [LG, MK(HEAD), E1P], labels: ['lgtm', 'ci-rerun'], eventos: [...labeled, labRerun(T(-5))] });
      check(!lgtmEscrita(w) && !tiene(w, /"ci-rerun"/) && !w.comentarios.some(b => /watchdog-(lgtm-ci-rearm|ci-rerun)/.test(b)),
        '(int, AP-146) `ci-rerun` de hace < 15 min ⇒ espera: ni `lgtm` ni `ci-rerun`', w);
    }
    {
      const w = await scan({ comentarios: [LG, MK(HEAD), E1P], labels: ['lgtm', 'ci-rerun'], eventos: [...labeled, labRerun(T(-60))] });
      const b = w.comentarios.find(x => x.includes('watchdog-lgtm-ci-rearm')) || '';
      check(b.includes('`ci-rerun` residual anterior al merge mecánico') && !b.includes('consumidor sin'),
        '(int, AP-146) `ci-rerun` residual anterior al marcador E1′ ⇒ respaldo con su propio motivo, no «consumidor sin `ci-rerun`»', w);
    }
    {
      const w = await scan({ comentarios: [LG, MK(HEAD), E1P, com('github-actions[bot]', `x\n\n<!-- watchdog-ci-rerun: ${HEAD} -->`, T(-20))], labels: ['lgtm'], eventos: labeled });
      check(tiene(w, /^DELETE \/issues\/5\/labels\/lgtm/) && !tiene(w, /"ci-rerun"/) && w.comentarios.some(b => b.includes('consumidor sin `ci-rerun`')),
        '(int, AP-146) `ci-rerun` ya re-puesta una vez por la red (cap 1 por head) y retirada sin run ⇒ respaldo', w);
    }
    {
      const E1PX = com('claude[bot]', `<!-- watchdog-merge-mecanico-ci: pendiente ${HEAD} -->`, T(-30));
      const w = await scan({ comentarios: [LG, MK(HEAD), E1PX], labels: ['lgtm'], eventos: labeled });
      check(tiene(w, /^DELETE \/issues\/5\/labels\/lgtm/) && !tiene(w, /"ci-rerun"/) && !w.comentarios.some(b => b.includes('watchdog-e1p-respaldo')),
        '(int, AP-146) línea E1′ de un autor no de confianza ⇒ red AP-139 de hoy', w);
    }
  }
  {
    const w = await scan({ comentarios: [LG], headDate: T(-120), ws: WS_SIN });
    check(w.warnings.some(m => m.includes('gate-head ausente: AP-024 en modo previo; ramas 5-6 inactivas'))
      && tiene(w, /^POST \/issues\/5\/labels .*"lgtm"/) && w.comentarios.some(b => /<!-- watchdog-lgtm-rematerialize -->/.test(b)) && !tiene(w, /reviewer-lgtm-sha/),
      '(int) módulo ausente ⇒ aviso literal + AP-024 de hoy (marcador sin SHA), sin relleno', w);
  }
  {
    const w = await scan({ comentarios: [LG, MK(PREV)], labels: ['lgtm'], commits: [{ sha: HEAD, parents: [{ sha: PREV }], committer: { login: 'claude[bot]' } }], ws: WS_SIN });
    check(!tiene(w, /needs-review/) && !tiene(w, /^DELETE/), '(int) módulo ausente ⇒ las ramas 5-6 no corren', w);
  }
}

if (fails) {
  console.error(`CHECK-GATE-HEAD ROJO: ${fails}/${n} aserciones fallan (módulo ${fuente}).`);
  process.exit(1);
}
console.log(`check-gate-head verde: ${n} aserciones sobre el módulo REAL ${fuente} (casos a–i del ruling de #408 y i–v de la enmienda del Architect) + costura de epic-merge/watchdog/reviewer con auto-ejercicio + integración con el scan REAL de watchdog.yml (con y sin módulo).`);
