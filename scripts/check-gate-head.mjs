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
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';

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
check(GH.revisadoPorCadena({ headSha: B, shaRevisado: A, commits: new Map([[B, W(A)]]) }) === true, '(f) head = merge web-flow cuya primera madre es el revisado ⇒ true');
check(GH.revisadoPorCadena({ headSha: C, shaRevisado: A, commits: new Map([[C, W(B)], [B, W(A)]]) }) === true, '(f) dos merges web-flow encadenados ⇒ true');
check(GH.revisadoPorCadena({ headSha: C, shaRevisado: A, commits: new Map([[C, W(B)], [B, propio(A)]]) }) === false, '(f) merge web-flow sobre un commit propio posterior al revisado ⇒ false');
check(GH.revisadoPorCadena({ headSha: B, shaRevisado: A, commits: new Map([[B, { parents: [A, X], committerLogin: 'github-actions[bot]' }]]) }) === false, '(f) merge append-only no web-flow ⇒ false');
check(GH.revisadoPorCadena({ headSha: B, shaRevisado: A, commits: new Map([[B, W(X, A)]]) }) === false, '(f) el revisado solo como SEGUNDA madre ⇒ false (se sigue la primera)');

// ── (g) lgtmVigente por cadena ──────────────────────────────────────────────
check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), ultimoEsLgtm: true }) === true, '(g) sin label y head = merge web-flow del revisado ⇒ true');

// ── (i) crítica ronda 3, D: todo LGTM vigente exige que el último veredicto sea LGTM
check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), ultimoEsLgtm: false }) === false, '(i) REVIEW/NITS posterior sobre el head web-flow ⇒ false');
check(GH.lgtmVigente({ labels: ['lgtm'], shaRevisado: A, headSha: A, commits: new Map(), ultimoEsLgtm: false }) === false, '(i) último veredicto no-LGTM con label y SHA iguales ⇒ false');
check(GH.lgtmVigente({ labels: ['needs-review'], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]), ultimoEsLgtm: true }) === false, '(i) `needs-review` pendiente sobre el head web-flow ⇒ false');
check(GH.lgtmVigente({ labels: [], shaRevisado: A, headSha: B, commits: new Map([[B, W(A)]]) }) === false, '(i) `ultimoEsLgtm` ausente ⇒ false (fail-closed)');
{
  const cs = [com(PAT, 'LGTM\n\nok'), com(PAT, marca(A)), com(PAT, 'REVIEW\n\n🔴 algo')];
  check(GH.ultimoVeredicto(cs, PAT) === 'REVIEW', '(i) `ultimoVeredicto` ⇒ el último veredicto del Reviewer');
  check(GH.ultimoVeredicto([com('claude[bot]', 'LGTM yo')], PAT) === null, '(i) `ultimoVeredicto` ignora a otros autores');
  check(GH.ultimoVeredicto([com(PAT, marca(A))], PAT) === null, '(i) el marcador del SHA revisado no es un veredicto');
}

// ── (h) decidirAp024 ────────────────────────────────────────────────────────
const d = o => GH.decidirAp024({ ultimoEsLgtm: true, hasLgtm: false, shaRevisado: A, headSha: A, headSinCambiosDesdeVeredicto: false, commits: new Map(), remats: 0, rectHold: false, ...o });
check(d({}) === 'remat', "(h) 'remat': crash con head = revisado");
check(d({ headSha: B, commits: new Map([[B, W(A)]]) }) === 'remat', "(h) 'remat': head de updateBranch");
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
    if (!/gate-head\.cjs`\); \}\s*\n\s*catch \(e\) \{ await diag\([^\n]*fail-closed[^\n]*\); return; \}/.test(em)) f.push('epic-merge.yml no carga `gate-head.cjs` fail-closed (diag + return)');
  }
  if (wd != null) {
    if (!/GH\.decidirAp024\(/.test(wd)) f.push('watchdog.yml no invoca `decidirAp024`');
    if (!wd.includes('watchdog-lgtm-rematerialize: ')) f.push('watchdog.yml no escribe la forma con SHA de `watchdog-lgtm-rematerialize`');
    if (!wd.includes('watchdog-lgtm-ci-rearm')) f.push('watchdog.yml no contiene `watchdog-lgtm-ci-rearm`');
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
    ['reviewer sin fail-closed', () => costuras(EM, WD, RVW.replace(/if \(!marcado\) \{/, 'if (false) {'))],
  ];
  for (const [nom, fn] of mut) check(fn().length > fallosCostura.length, `auto-ejercicio: «${nom}» pone la costura roja`);
}

if (fails) {
  console.error(`CHECK-GATE-HEAD ROJO: ${fails}/${n} aserciones fallan (módulo ${fuente}).`);
  process.exit(1);
}
console.log(`check-gate-head verde: ${n} aserciones sobre el módulo REAL ${fuente} (casos a–i del ruling de #408) + costura de epic-merge/watchdog/reviewer con auto-ejercicio.`);
