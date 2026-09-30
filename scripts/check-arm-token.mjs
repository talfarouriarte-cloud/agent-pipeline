#!/usr/bin/env node
// check-arm-token — ningún step publica la mención de arm con el GITHUB_TOKEN
// (AP-091, central#268).
//
// El ping `watchdog-rebase` del `detect` salía por `github.rest.issues.createComment`
// del step, es decir con el `GITHUB_TOKEN` del job: el comentario nacía de
// `github-actions[bot]` y el anti-loop de GitHub (un evento del token por
// defecto no dispara workflows) impedía que su `@claude` arrancase
// claude-code.yml. 3 de 3 pings estériles en la historia del marcador, el
// cap 2 quemado en 6-7 min y 28 min de PR en conflicto hasta que
// architect-resolve (que sí escribe con el PAT) lo re-armaba. El belt
// `ping-creator-materializado` no lo veía porque mira la FORMA del texto,
// no la IDENTIDAD del emisor. Este check mira la identidad, estáticamente.
//
// Regla: en todo step `actions/github-script` de los workflows y plantillas,
// una llamada de escritura de comentario/issue por el cliente `github` del
// step (`github.rest.issues.createComment|create|update|updateComment`,
// `github.rest.pulls.createReview|createReviewComment`) cuyo argumento lleve
// la mención de arm A INICIO DE LÍNEA del cuerpo (`@claude` tras `\n`, tras
// el backtick/comilla que abre el literal, o tras un salto real) o el
// centinela `<!-- ping-creator -->` (que arma por sí solo) exige que el
// step declare `github-token:` con un secret (PAT). La forma sana con el
// token por defecto del step es `patCall(...)` con el PAT, que este check no
// mira porque ya sale con el PAT.
//
// Mención en prosa (backticks escapados, «SIN @claude» a mitad de frase) NO
// cuenta: aquí se juzga la intención de ARMAR, y la forma canónica del arm es
// a inicio de línea (ADR-064/AP-063).
//
// Alcance declarado: solo github-script. Un step `run:` con `gh … comment` y
// `GH_TOKEN: ${{ github.token }}` no se mira (hoy ninguno publica arm).
//
// Cuelga del piggyback de `check-embedded-js.mjs` por la misma razón que sus
// hermanos: su paso propio de `ci.yml` sería un cambio de workflow.
import { readFileSync, readdirSync } from 'fs';
import yaml from 'js-yaml';

const DIRS = ['.github/workflows', 'templates'];
const WRITE = /github\.rest\.(?:issues\.(?:createComment|create|update|updateComment)|pulls\.(?:createReview|createReviewComment))\s*\(/g;
const ARM = /(?:\\n|\n|(?<!\\)[`'"])[ \t]*@claude\b/;
// El centinela `<!-- ping-creator -->` arma por sí solo (filtro de claude-code.yml,
// ADR-086: existe porque el render puede corromper el `@claude`): mismo rigor.
const PING = /<!--\s*ping-creator\s*-->/;

// Argumento balanceado de la llamada cuyo `(` está en `open`.
function argumento(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return src.slice(open + 1);
}

// Pura: hallazgos de un step (sin I/O), para el banco de abajo.
function hallazgos(step) {
  const script = step && step.with && step.with.script;
  if (typeof script !== 'string') return [];
  const tok = String(step.with['github-token'] || '');
  const conPat = /secrets\.[A-Z0-9_]+/.test(tok) && !/secrets\.GITHUB_TOKEN\b|github\.token/.test(tok);
  if (conPat) return [];
  const out = [];
  for (const m of script.matchAll(WRITE)) {
    const arg = argumento(script, m.index + m[0].length - 1);
    if (ARM.test(arg) || PING.test(arg)) out.push({ llamada: m[0].replace(/\s*\($/, ''), linea: script.slice(0, m.index).split('\n').length });
  }
  return out;
}

// ── Banco (corre siempre; instrumento roto ⇒ ROJO nombrando el caso) ─────────
const BANCO = [
  ['GITHUB_TOKEN + mención anclada tras \\n ⇒ rojo', "await github.rest.issues.createComment({ ...O, body: `${M}\\n@claude rebasa` });", '', 1],
  ['GITHUB_TOKEN + mención al abrir el literal ⇒ rojo', "await github.rest.issues.createComment({ ...O, body: `@claude retoma` });", '', 1],
  ['github-token PAT ⇒ verde', "await github.rest.issues.createComment({ ...O, body: `@claude retoma` });", '${{ secrets.REVIEWER_GITHUB_TOKEN }}', 0],
  ['github-token explícito = github.token ⇒ rojo', "await github.rest.issues.createComment({ body: `@claude x` });", '${{ github.token }}', 1],
  ['mención en prosa (backticks escapados) ⇒ verde', "await github.rest.issues.createComment({ body: `cierre \\`@claude\\` sin label` });", '', 0],
  ['mención a mitad de frase ⇒ verde', "await github.rest.issues.createComment({ body: `diagnóstico SIN @claude` });", '', 0],
  ['patCall con mención ⇒ verde (sale con el PAT)', "await patCall('POST', `/issues/1/comments`, { body: `@claude x` });", '', 0],
  ['issues.create con mención anclada ⇒ rojo', "await github.rest.issues.create({ title: 't', body: `a\\n@claude arma` });", '', 1],
  ['GITHUB_TOKEN + solo el centinela ping-creator ⇒ rojo', "await github.rest.issues.createComment({ body: `diagnóstico <!-- ping-creator -->` });", '', 1],
  ['centinela materializado (otro marcador) ⇒ verde', "await github.rest.issues.createComment({ body: `x <!-- ping-creator-materializado -->` });", '', 0],
];
const fallosBanco = BANCO
  .filter(([, script, tok, n]) => hallazgos({ with: { script, ...(tok ? { 'github-token': tok } : {}) } }).length !== n)
  .map(([nombre]) => nombre);
if (fallosBanco.length) {
  console.error('CHECK-ARM-TOKEN ROJO — el banco del propio check falla (el instrumento está roto):');
  fallosBanco.forEach(f => console.error('  - ' + f));
  process.exit(1);
}

const errors = [];
let steps = 0;
for (const d of DIRS) {
  let names = [];
  try { names = readdirSync(d, { recursive: true }); } catch { continue; }
  for (const f of names.filter(n => /\.ya?ml$/.test(n)).sort()) {
    const rel = `${d}/${f}`;
    let doc;
    try { doc = yaml.load(readFileSync(rel, 'utf8')); } catch { continue; }   // check-yaml reporta
    for (const [jname, job] of Object.entries((doc && doc.jobs) || {})) {
      ((job && job.steps) || []).forEach((s, i) => {
        if (!s || !s.with || typeof s.with.script !== 'string') return;
        steps++;
        for (const h of hallazgos(s)) {
          errors.push(`${rel} · job ${jname} · step ${i} («${(s.name || '').slice(0, 50)}») · línea ${h.linea} del script: \`${h.llamada}\` publica la mención de arm con el GITHUB_TOKEN — no disparará al Creator (anti-loop). Usa el PAT (\`patCall\` o \`github-token: \${{ secrets.REVIEWER_GITHUB_TOKEN }}\`).`);
        }
      });
    }
  }
}

if (errors.length) {
  console.error('CHECK-ARM-TOKEN ROJO (mención de arm publicada con GITHUB_TOKEN — ping estéril por construcción, central#268):');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`check-arm-token verde: ${steps} steps github-script, ninguna mención de arm con GITHUB_TOKEN · banco: ${BANCO.length} casos.`);
