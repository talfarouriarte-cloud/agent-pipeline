'use strict';
// critica — transiciones del gate de crítica materializadas por estado (AP-128,
// central#359, ruling mensual 2026-11-01 posición 7; funde #376, #363, #371, #311).
//
// EL HUECO. Las labels del veredicto (`critica:pendiente|hallazgos|lgtm`,
// `critica-na`) las ponía la sesión LLM del Critic por `gh api`, y el arm que el
// gate AP-116 retiene no lo re-emitía nadie tras el LGTM en épica (AP-115 §3):
// correctivos del Auditor, relanzamientos parciales, eslabones 1/N y épicas 1/1
// esperaban a un `watchdog-rearm` de architect-resolve (asesoramiento#2953,
// #2980, #2988, #3054, #3096, #3136, #3263, #3325). Tras un BLOQUEANTE, el
// detector `issue-armed-no-pr` del Watchdog tomaba el issue por arm sin PR
// (#3266, #3269, #3291, #3295), y en #3291 un `watchdog-rearm` pasó el gate con
// `critica:hallazgos` puesta.
//
// QUIÉN LO USA.
//  - `critic.yml`, post-step «Verificación de presencia del resultado»
//    (`require` del `scripts/critica.cjs` grafteado): `leerVeredicto`,
//    `planLabels`, `armRetenido`, `cadenaDesdeBody`, `textoReemision`.
//  - `claude-code.yml`, gate `check_critica`: corre ANTES de cualquier checkout
//    y no puede hacer `require` (mismo caso que las copias de `enmiendas.cjs` en
//    `check_flight`). Lleva una COPIA LITERAL de la sección delimitada por
//    `copia-gate:inicio` / `copia-gate:fin`; `scripts/check-critica.mjs` compara
//    el texto de las dos y falla si divergen.
//  - `watchdog.yml`, detector `issue-armed-no-pr` (sparse-checkout
//    `.cola-central/vendored/scripts`, como `cola-prioridad.cjs`): `esArm`,
//    `cedeAlCritic`, `cuentaComoRearm`. Sin módulo, el detector sigue como antes
//    con `core.warning` (fail-open declarado).
//
// MARCADORES (fila en `protocol.md` § Marcadores):
//  - `<!-- critica-gate -->` + `<!-- arm-retenido: <origen> -->` (comentario del
//    gate al retener un arm; `<origen>` = marcador del arm entrante o `manual`).
//  - `<!-- critica: ronda=N veredicto=bloqueante|lgtm -->` (Critic, ya existía).
//  - `<!-- critica-cubre: #a #b … -->` (Critic, en TODO veredicto de una épica:
//    los eslabones que cubre la crítica).
//  - `<!-- arm-reemitido: <origen> -->` (post-step, en el arm re-emitido: el
//    contador de re-arms del Watchdog no lo cuenta — hallazgo G/D de la ronda 3).
//  - `<!-- correctivo-auditor: #<panel> -->` (Auditor, PRIMERA línea del body del
//    correctivo: lo exime del gate).

// ── copia-gate:inicio ── (copia LITERAL en `check_critica` de claude-code.yml; el banco compara el texto)
const CRITICA_TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const CRITICA_REARM = ['epic-auto-launch', 'watchdog-rearm', 'arm-de-cola', 'rearm-enmienda', 'eslabon-suspendido'];
const CRITICA_EN_CURSO = ['critica:pendiente', 'critica:hallazgos'];
// Código citado fuera: una mención entre backticks o en bloque cercado no es arm
// ni marcador (clase AP-063; mismo literal que `resolve-cross-issue-failsafe.cjs`).
const critDespojar = (raw) => String(raw || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
// Arm = la mención al inicio de una línea propia o el sentinel `ping-creator`
// (mismo literal que `PING_RE` de `enmiendas.cjs`). Nunca substring.
const CRITICA_PING_RE = /^[ \t]*@claude(?![\w-])|<!--\s*ping-creator\s*-->/m;
const esArm = (body) => CRITICA_PING_RE.test(critDespojar(body));
// Origen del arm: el primer marcador HTML de re-arm mecánico, o `manual`.
// `epic-partial-relaunch` (y sus variantes `-por-estado…`) se reconoce aparte.
const origenArm = (body) => {
  const t = critDespojar(body);
  if (/<!--\s*epic-partial-relaunch(?:-[a-z-]+)?\s*(?::[^>]*)?-->/.test(t)) return 'epic-partial-relaunch';
  for (const m of CRITICA_REARM) if (new RegExp(`<!--\\s*${m}(?![\\w-])[^>]*-->`).test(t)) return m;
  return 'manual';
};
// Correctivo del Auditor: label `correctivo` + `<!-- correctivo-auditor: #<panel> -->` como
// PRIMERA línea no vacía del body (regla posicional AP-011).
const esCorrectivoAuditor = (labels, issueBody) => labels.includes('correctivo')
  && /^\s*<!--\s*correctivo-auditor(?::\s*#?\d+)?\s*-->[ \t]*$/m.test((String(issueBody || '').split('\n').find((l) => l.trim()) || ''));
// Exenciones del gate AP-116, en este orden (AP-128 pieza 2(c)). `exento`
// ⇒ el arm continúa. Si no, `mecanico` dice si el arm entrante es un re-arm
// mecánico retenido con la crítica en curso (no abre ronda).
const exencionGate = (labels, armBody, issueBody) => {
  const origen = origenArm(armBody);
  const enCurso = CRITICA_EN_CURSO.some((n) => labels.includes(n));
  const r = (exento, motivo) => ({ exento, motivo, origen, mecanico: !exento && origen !== 'manual' && enCurso });
  if (labels.includes('critica:lgtm')) return r(true, 'critica:lgtm');
  if (['auditoria', 'auditoria-completa'].some((n) => labels.includes(n))) return r(true, 'auditoria');
  if (labels.includes('critica-na')) return r(true, 'critica-na');
  if (esCorrectivoAuditor(labels, issueBody)) return r(true, 'correctivo-auditor');
  if (origen === 'epic-partial-relaunch') return r(true, 'epic-partial-relaunch');
  if (origen !== 'manual' && !enCurso) return r(true, `rearm:${origen}`);
  return r(false, enCurso ? 'critica-en-curso' : 'sin-critica');
};
// ── copia-gate:fin ──

const HOLDS = ['pause-agents', 'pausa-cola', 'human-needed'];
const VEREDICTO_RE = /^[ \t]*<!--\s*critica:\s*ronda=(\d)\s+veredicto=(bloqueante|lgtm)\s*-->[ \t]*$/m;
const CUBRE_RE = /^[ \t]*<!--\s*critica-cubre:\s*([^>]*?)\s*-->[ \t]*$/m;
const RETENIDO_RE = /^[ \t]*<!--\s*arm-retenido:\s*([a-z][a-z-]*)\s*-->[ \t]*$/m;
const GATE_RE = /^[ \t]*<!--\s*critica-gate\s*-->[ \t]*$/m;
const REEMITIDO_RE = /^[ \t]*<!--\s*arm-reemitido:\s*[a-z][a-z-]*\s*-->[ \t]*$/m;

const confianza = (c) => CRITICA_TRUSTED.has(c && c.author_association);

// Último veredicto materializado (marcador anclado, de un autor de confianza: el
// Critic publica con el PAT). Con `ronda`, solo el de esa ronda. Devuelve
// { ronda, veredicto, cubre: [n…], comentario } o null.
function leerVeredicto(comentarios, ronda = null) {
  let ultimo = null;
  for (const c of comentarios || []) {
    if (!confianza(c)) continue;
    const t = critDespojar(c.body);
    const m = t.match(VEREDICTO_RE);
    if (!m || (ronda != null && Number(m[1]) !== Number(ronda))) continue;
    const cu = t.match(CUBRE_RE);
    const cubre = cu ? [...new Set([...cu[1].matchAll(/#?(\d+)/g)].map((x) => Number(x[1])))] : [];
    ultimo = { ronda: Number(m[1]), veredicto: m[2], cubre, comentario: c };
  }
  return ultimo;
}

// Labels a materializar (AP-128 pieza 1). `veredicto` = salida de `leerVeredicto`
// o null (sesión muerta sin marcador ⇒ fail-open AP-117). Idempotente: en el
// issue solo pone lo que falta y solo quita lo que hay; en los cubiertos (sus
// labels no se conocen aquí) pone la de cierre y quita las de crítica en curso
// tolerando el 404.
function planLabels(veredicto, ronda, labels) {
  const tiene = (n) => (labels || []).includes(n);
  const N = Number(ronda);
  let cierre, arm, caso;
  if (!veredicto) { cierre = 'critica-na'; arm = true; caso = 'fail-open'; }
  else if (veredicto.veredicto === 'lgtm') { cierre = 'critica:lgtm'; arm = true; caso = 'lgtm'; }
  else if (N >= 3) { cierre = 'critica-na'; arm = true; caso = 'ronda3'; }
  else { cierre = 'critica:hallazgos'; arm = false; caso = 'bloqueante'; }
  const quitarTodo = ['critica:pendiente', 'critica:hallazgos'].filter((n) => n !== cierre);
  return {
    caso, arm, cierre,
    issue: { poner: tiene(cierre) ? [] : [cierre], quitar: quitarTodo.filter(tiene) },
    // Un BLOQUEANTE que no cierra el ciclo no toca a los eslabones: siguen en
    // crítica con su épica.
    cubiertos: caso === 'bloqueante' ? null : { poner: [cierre], quitar: quitarTodo },
  };
}

// Último arm retenido por el gate sin arm posterior (AP-128 pieza 2(b)).
// «Arm posterior» = comentario POSTERIOR con `esArm` (línea propia, nunca
// substring: una cita entre backticks no cuenta). Un `critica-gate` de antes de
// AP-128 (sin línea `arm-retenido`) cuenta como retención `manual`: su arm no
// lo re-emitía nadie. Devuelve { origen, comentario } o null.
function armRetenido(comentarios) {
  const cs = comentarios || [];
  let idx = -1, origen = null;
  cs.forEach((c, i) => {
    if (!confianza(c)) return;
    const t = critDespojar(c.body);
    const m = t.match(RETENIDO_RE);
    if (m) { idx = i; origen = m[1]; }
    else if (GATE_RE.test(t)) { idx = i; origen = 'manual'; }
  });
  if (idx < 0) return null;
  if (cs.slice(idx + 1).some((c) => esArm(c.body))) return null;
  return { origen, comentario: cs[idx] };
}

// Hallazgos que siguen abiertos tras la ronda 3 (pieza 5): una línea por
// hallazgo marcado «(ronda N, sin resolver)» o «(nuevo)», copiada del
// comentario del Critic. Sin marca (ronda 1) cuenta todo hallazgo `[X]`.
function hallazgosAbiertos(body) {
  const out = [];
  const hayMarcas = /\(ronda \d, sin resolver\)|\(nuevo\)/.test(String(body || ''));
  let seccionBloq = true;
  for (const raw of String(body || '').split('\n')) {
    const l = raw.trim();
    if (/^#{2,4}\s/.test(l)) seccionBloq = !/no bloqueantes|escalado/i.test(l);
    if (!seccionBloq) continue;
    if (!/^(?:[-*]\s*)?\*{0,2}\[[A-Z](?:\/[A-Z])*\]/.test(l)) continue;
    const marcado = /\(ronda \d, sin resolver\)|\(nuevo\)/.test(l);
    if (hayMarcas && !marcado) continue;
    out.push(l.length > 240 ? `${l.slice(0, 240)}…` : l);
  }
  return out;
}

// Línea de hallazgo copiada al arm de ronda 3, desactivada (review de #387):
// los guards de `claude-code.yml` leen el origen por substring sin anclar
// (`isChainRearm`, `ping-creator`), y un hallazgo que NOMBRA `watchdog-rearm`
// falsificaría el origen del arm. Se quitan los comentarios HTML y los
// literales de marcador llevan guion no separable (U+2011): se leen igual y no
// casan `includes`. Una mención `@claude` citada lleva un espacio de ancho cero.
const MARCADORES_COPIA = [...CRITICA_REARM, 'epic-partial-relaunch', 'ping-creator', 'arm-reemitido', 'arm-retenido', 'critica-gate'];
const neutralizarHallazgo = (l) => MARCADORES_COPIA.reduce(
  (t, m) => t.split(m).join(m.replace(/-/g, '\u2011')),
  String(l || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<!--|-->/g, ' '),
).replace(/@claude/g, '@\u200bclaude');

// Texto del arm re-emitido. Conserva el marcador de ORIGEN (un relaunch sigue
// siendo relaunch para los guards de cadena y serial) y añade `arm-reemitido`,
// que el contador de re-arms del Watchdog excluye: la re-emisión no gasta cap.
function textoReemision({ origen, ronda, caso, aps = 'AP-128', hallazgos = [] }) {
  const lineas = ['@claude', ''];
  if (caso === 'ronda3') {
    lineas.push(`Arm tras ronda 3 bloqueante (ronda ${ronda}, AP-117/119, ${aps}): \`critica-na\`. Hallazgos sin resolver de la crítica: ANTES de tocar código publica con \`gh api\` un comentario que empiece por el marcador \`critica-leida\` y declara, por hallazgo, «aplico» o «no aplico: <por qué>» (\`creator.md\` § «Al arrancar»).`);
    lineas.push('');
    for (const h of (hallazgos.length ? hallazgos : ['(la crítica no lista hallazgos con letra: léela entera)'])) lineas.push(`- ${neutralizarHallazgo(h)}`);
  } else if (caso === 'fail-open') {
    lineas.push(`Arm tras fail-open del Critic (AP-117, ronda ${ronda}): crítica no realizada.`);
  } else {
    lineas.push(`Arm tras crítica (ronda ${ronda}, ${aps}): el post-step del Critic re-emite el arm que el gate retuvo (origen: \`${origen}\`).`);
  }
  lineas.push('');
  if (origen && origen !== 'manual') lineas.push(`<!-- ${origen} -->`);
  lineas.push(`<!-- arm-reemitido: ${origen || 'manual'} -->`);
  return lineas.join('\n');
}

// Cadena `launch-next` desde el body de la épica, hasta el body con
// `epic-audit` (cap 20). `getBody(n)` ⇒ body del issue n (async; lanza si no
// existe). Devuelve { eslabones: [n…], completa } o lanza si no se puede leer.
async function cadenaDesdeBody(body0, getBody, cap = 20) {
  const eslabones = [];
  let body = String(body0 || '');
  for (let hops = 0; hops < cap; hops++) {
    if (/<!--\s*epic-audit:/.test(body)) return { eslabones, completa: true };
    const m = body.match(/<!--\s*launch-next:\s*#?(\d+)\s*-->/);
    if (!m) return { eslabones, completa: false };
    const n = Number(m[1]);
    if (eslabones.includes(n)) return { eslabones, completa: false };
    eslabones.push(n);
    body = String((await getBody(n)) || '');
  }
  return { eslabones, completa: false };
}

// Watchdog (pieza 7): un issue con la crítica en curso no es `issue-armed-no-pr`.
const cedeAlCritic = (labels) => CRITICA_EN_CURSO.some((n) => (labels || []).includes(n));
// Contador del cap de re-arms del Watchdog: el literal de siempre, salvo un arm
// re-emitido tras la crítica (hallazgo G/D de la ronda 3).
const cuentaComoRearm = (body) => String(body || '').includes('<!-- watchdog-rearm -->') && !REEMITIDO_RE.test(String(body || ''));

module.exports = {
  CRITICA_TRUSTED, CRITICA_REARM, CRITICA_EN_CURSO, CRITICA_PING_RE, HOLDS,
  VEREDICTO_RE, CUBRE_RE, RETENIDO_RE, REEMITIDO_RE,
  critDespojar, esArm, origenArm, esCorrectivoAuditor, exencionGate,
  leerVeredicto, planLabels, armRetenido, hallazgosAbiertos, neutralizarHallazgo, textoReemision,
  cadenaDesdeBody, cedeAlCritic, cuentaComoRearm,
};
