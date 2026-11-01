#!/usr/bin/env node
// check-critica — banco de las transiciones del gate de crítica por estado
// (AP-128, central#359, ruling mensual 2026-11-01 posición 7). Ejecuta el módulo
// `vendored/scripts/critica.cjs`, el gate EMBEBIDO real `check_critica` de
// `claude-code.yml` y el post-step real «Verificación de presencia del
// resultado» de `critic.yml` (cargador compartido de AP-105) contra una API de
// GitHub en memoria.
//
// Casos del ruling:
//  pieza 1 — bloqueante r1 con `critica-cubre` ⇒ solo la épica cambia; r3 con
//    `critica-cubre` ⇒ `critica-na` en épica y cubiertos; lgtm con y sin
//    `critica-cubre`; sin marcador en épica ⇒ `critica-na` en la cadena
//    parseada; sin marcador y cadena ilegible ⇒ solo la épica.
//  pieza 2 — arm retenido + lgtm ⇒ un arm con el marcador de origen; arm
//    posterior en línea propia ⇒ no re-emite; cita entre backticks ⇒ sí; hold
//    ⇒ no; `correctivo` con marcador ⇒ exento; sin marcador ⇒ retenido;
//    `watchdog-rearm` con `critica:hallazgos` ⇒ retenido, labels intactas,
//    `arm-retenido: watchdog-rearm`; ping sin marcador con `critica:hallazgos`
//    ⇒ ronda nueva (como hoy).
//  pieza 7 — `cedeAlCritic`, `esArm` (con el fixture del falso positivo del
//    2026-10-30 en central#359) y el contador de re-arms con `arm-reemitido`.
// Costuras: la copia `copia-gate` del gate es literal a la del módulo;
// `scripts/critica.cjs` idéntico a `vendored/scripts/critica.cjs`; el detector
// del Watchdog carga el módulo y usa las tres funciones.
// Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import yaml from 'js-yaml';
import { cargarStep } from './lib/github-script.mjs';

const require = createRequire(import.meta.url);
const C = require(resolve('vendored/scripts/critica.cjs'));

let fallos = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok ' : '  ROJO'} ${msg}`); if (!ok) fallos++; };

const stepsDe = (f) => {
  const wf = yaml.load(readFileSync(f, 'utf8'));
  const out = [];
  for (const job of Object.values(wf.jobs || {})) for (const st of job.steps || []) out.push(st);
  return out;
};
const need = (st, nombre) => { if (!st) { console.error(`CHECK-CRITICA ROJO: step ${nombre} no encontrado`); process.exit(1); } return st; };
const gateSrc = need(stepsDe('.github/workflows/claude-code.yml').find((s) => s.id === 'check_critica'), 'check_critica').with.script;
const postSrc = need(stepsDe('.github/workflows/critic.yml').find((s) => s.name === 'Verificación de presencia del resultado'), 'critic/Verificación').with.script;
const gate = cargarStep(gateSrc, 'check_critica');
const post = cargarStep(postSrc, 'critic-post');

// ── Mundo en memoria ──────────────────────────────────────────────────────────
let nextId = 1;
const com = (body, { assoc = 'OWNER', login = 'propietario' } = {}) => ({ id: nextId++, body, author_association: assoc, user: { login } });
function mundo({ issues = {}, comentarios = [] } = {}) {
  // issues: { [n]: { labels: [...], body } }
  const w = { issues: JSON.parse(JSON.stringify(issues)), comentarios: [...comentarios], creados: [], añadidas: [], quitadas: [], fallaGet: new Set() };
  const get = (n) => { if (w.fallaGet.has(n) || !w.issues[n]) throw new Error(`404 #${n}`); return w.issues[n]; };
  w.github = {
    paginate: async (fn, p) => (await fn(p)).data,
    rest: {
      issues: {
        listComments: async () => ({ data: w.comentarios }),
        get: async (p) => { const i = get(p.issue_number); return { data: { number: p.issue_number, body: i.body || '', labels: i.labels.map((name) => ({ name })) } }; },
        addLabels: async (p) => { const i = get(p.issue_number); for (const l of p.labels) if (!i.labels.includes(l)) i.labels.push(l); w.añadidas.push(...p.labels.map((l) => `${p.issue_number}:${l}`)); return { data: [] }; },
        removeLabel: async (p) => { const i = get(p.issue_number); if (!i.labels.includes(p.name)) throw new Error('404 label'); i.labels = i.labels.filter((l) => l !== p.name); w.quitadas.push(`${p.issue_number}:${p.name}`); return { data: [] }; },
        createComment: async (p) => { const c = com(p.body); w.comentarios.push(c); w.creados.push({ n: p.issue_number, body: p.body }); return { data: c }; },
      },
    },
  };
  return w;
}
const coreDe = (out) => ({ setOutput: (k, v) => { out[k] = String(v); }, notice() {}, warning() {}, info() {}, setFailed: (m) => { out.failed = m; } });
const O = { owner: 'o', repo: 'r' };

async function correrGate(w, n, armBody) {
  const out = {};
  const i = w.issues[n];
  await gate({ github: w.github, context: { repo: O, payload: { issue: { number: n, body: i.body, labels: i.labels.map((name) => ({ name })) }, comment: { body: armBody } } }, core: coreDe(out) });
  return out;
}
async function correrPost(w, n, ronda) {
  const out = {};
  const i = w.issues[n];
  await post({ github: w.github, context: { repo: O, payload: { issue: { number: n, labels: i.labels.map((name) => ({ name })) } } }, core: coreDe(out) },
    { env: { RONDA: String(ronda), RUN_URL: 'https://x/run/1', GITHUB_WORKSPACE: process.cwd() } });
  return out;
}
const veredicto = (ronda, v, { cubre = null, extra = '' } = {}) => com(`**Crítica · ronda ${ronda}/3 · ${v === 'lgtm' ? 'LGTM' : 'BLOQUEANTE'}**\n<!-- critica: ronda=${ronda} veredicto=${v} -->\n${cubre ? `<!-- critica-cubre: ${cubre.map((x) => `#${x}`).join(' ')} -->\n` : ''}${extra}`);
const gateCom = (origen) => com(`**claude-code · gate de crítica**: …\n\n<!-- critica-gate -->\n<!-- arm-retenido: ${origen} -->`);
const arms = (w) => w.creados.filter((c) => C.esArm(c.body));

// ── Costuras ──────────────────────────────────────────────────────────────────
{
  const mod = readFileSync('vendored/scripts/critica.cjs', 'utf8');
  const tramo = (t) => { const a = t.indexOf('// ── copia-gate:inicio'); const b = t.indexOf('// ── copia-gate:fin ──'); return a >= 0 && b > a ? t.slice(a, b) : null; };
  check(tramo(mod) && tramo(mod) === tramo(gateSrc), 'costura: la sección copia-gate de check_critica es literal a la de critica.cjs');
  check(existsSync('scripts/critica.cjs') && readFileSync('scripts/critica.cjs', 'utf8') === mod, 'costura: scripts/critica.cjs idéntico a vendored/scripts/critica.cjs');
  const scan = stepsDe('.github/workflows/watchdog.yml').find((s) => s.id === 'scan');
  const ws = scan ? scan.with.script : '';
  check(/\.cola-central\/vendored\/scripts\/critica\.cjs/.test(ws) && /CRIT\.cedeAlCritic\(/.test(ws) && /CRIT\.esArm\(/.test(ws) && /CRIT\.cuentaComoRearm\(/.test(ws),
    'costura: el detector del Watchdog carga critica.cjs y usa cedeAlCritic, esArm y cuentaComoRearm');
  check(!/el Critic arma al Creator él mismo/.test(gateSrc) && /re-emite el arm retenido/.test(gateSrc), 'pieza 2(d): el texto del gate ya no promete que el Critic arma');
}

// ── Pieza 7 / esArm ───────────────────────────────────────────────────────────
{
  check(C.esArm('@claude\n\nhaz X') === true, 'esArm: mención en línea propia ⇒ arm');
  check(C.esArm('  @claude haz X') === true, 'esArm: mención con sangría al inicio de línea ⇒ arm');
  check(C.esArm('ver `@claude` en el body') === false, 'esArm: mención entre backticks ⇒ no es arm');
  check(C.esArm('el arm es el @claude del Architect') === false, 'esArm: mención en medio de prosa ⇒ no es arm');
  check(C.esArm('```\n@claude\n```') === false, 'esArm: mención en bloque cercado ⇒ no es arm');
  check(C.esArm('ping\n<!-- ping-creator -->') === true, 'esArm: sentinel ping-creator ⇒ arm');
  // Fixture: comentario de evidencia del 2026-10-30 01:33Z en central#359 (fila de la tabla).
  const fixture359 = '| #3269 (#3267) | Igual. `armed_at` es el `@claude` de la respuesta del Architect a la crítica r1 | 1 architect-resolve **NULO** (40758072111, 26 s), 17.969 |';
  check(C.esArm(fixture359) === false, 'esArm: fixture central#359 (cita entre backticks en tabla) ⇒ no es arm');
  check(C.cedeAlCritic(['critica:hallazgos']) === true, 'cedeAlCritic: critica:hallazgos ⇒ cede');
  check(C.cedeAlCritic(['critica:pendiente', 'epica']) === true, 'cedeAlCritic: critica:pendiente ⇒ cede');
  check(C.cedeAlCritic(['critica:lgtm']) === false, 'cedeAlCritic: critica:lgtm ⇒ no cede');
  check(C.cuentaComoRearm('@claude\n<!-- watchdog-rearm -->') === true, 'contador: watchdog-rearm ⇒ cuenta');
  check(C.cuentaComoRearm('@claude\n<!-- watchdog-rearm -->\n<!-- arm-reemitido: watchdog-rearm -->') === false, 'contador: watchdog-rearm re-emitido ⇒ no cuenta (hallazgo G/D r3)');
}

// ── exencionGate (módulo) ─────────────────────────────────────────────────────
{
  const E = C.exencionGate;
  check(E(['critica:lgtm'], '@claude', '').exento, 'exención: critica:lgtm');
  check(E(['auditoria'], '@claude', '').exento, 'exención: auditoría');
  check(E(['critica-na'], '@claude', '').exento, 'exención: critica-na');
  check(E(['correctivo', 'epica'], '@claude', '<!-- correctivo-auditor: #77 -->\nEvidencia… auditoría #77').exento, 'exención: correctivo del Auditor (`correctivo-auditor: #<panel>` en la 1.ª línea, literal del ruling)');
  check(E(['correctivo', 'epica'], '@claude', '<!-- correctivo-auditor -->\nEvidencia…').exento, 'exención: correctivo-auditor sin número de panel también vale');
  check(!E(['epica'], '@claude', '<!-- correctivo-auditor: #77 -->\nx').exento, 'sin exención: marcador sin label correctivo');
  check(!E(['correctivo', 'epica'], '@claude', 'Evidencia…\n<!-- correctivo-auditor: #77 -->').exento, 'sin exención: marcador fuera de la 1.ª línea (posicional)');
  check(!E(['correctivo'], '@claude', 'Correctivo del Architect').exento, 'sin exención: correctivo sin marcador (caso #2933)');
  check(E(['epica'], '@claude\n<!-- epic-partial-relaunch -->', '').exento, 'exención: epic-partial-relaunch');
  check(E(['epica', 'critica:hallazgos'], '@claude\n<!-- epic-partial-relaunch-por-estado -->', '').exento, 'exención: variante epic-partial-relaunch-por-estado');
  check(E(['epica'], '@claude\n<!-- watchdog-rearm -->', '').exento, 'exención: watchdog-rearm sin crítica en curso');
  const r = E(['critica:hallazgos'], '@claude\n<!-- watchdog-rearm -->', '');
  check(!r.exento && r.mecanico && r.origen === 'watchdog-rearm', 'retenido: watchdog-rearm con critica:hallazgos ⇒ mecánico');
  check(!E(['critica:pendiente'], '@claude\n<!-- arm-de-cola -->', '').exento, 'retenido: arm-de-cola con critica:pendiente');
  check(E([], '@claude haz `watchdog-rearm`', '').origen === 'manual', 'origen: marcador citado entre backticks ⇒ manual');
  check(E([], '@claude\n<!-- rearm-enmienda: 1,2 -->', '').origen === 'rearm-enmienda', 'origen: rearm-enmienda parametrizado');
}

// ── planLabels / hallazgosAbiertos / textoReemision / cadena ──────────────────
{
  const p1 = C.planLabels({ veredicto: 'bloqueante' }, 1, ['critica:pendiente']);
  check(p1.caso === 'bloqueante' && !p1.arm && p1.issue.poner.join() === 'critica:hallazgos' && p1.issue.quitar.join() === 'critica:pendiente' && p1.cubiertos === null, 'planLabels: bloqueante r1');
  const p3 = C.planLabels({ veredicto: 'bloqueante' }, 3, ['critica:pendiente']);
  check(p3.caso === 'ronda3' && p3.arm && p3.cierre === 'critica-na' && p3.cubiertos.poner.join() === 'critica-na', 'planLabels: bloqueante r3 ⇒ critica-na y arm');
  const pl = C.planLabels({ veredicto: 'lgtm' }, 2, ['critica:lgtm']);
  check(pl.issue.poner.length === 0 && pl.arm, 'planLabels: idempotente si la sesión ya puso critica:lgtm');
  const pf = C.planLabels(null, 1, ['critica:pendiente']);
  check(pf.caso === 'fail-open' && pf.cierre === 'critica-na' && pf.arm, 'planLabels: sin marcador ⇒ fail-open');
  const body = '**Crítica · ronda 3/3 · BLOQUEANTE**\n\n### Hallazgos bloqueantes\n\n**[H/G] (nuevo) El gate no puede require.**\n- detalle\n\n**[D] (ronda 2, sin resolver) Orden.**\n\n### No bloqueantes\n- [X] (nuevo) no cuenta\n';
  const h = C.hallazgosAbiertos(body);
  check(h.length === 2 && /^\*\*\[H\/G\]/.test(h[0]) && /^\*\*\[D\]/.test(h[1]), 'hallazgosAbiertos: nuevos y sin resolver, sin los no bloqueantes');
  const t = C.textoReemision({ origen: 'watchdog-rearm', ronda: 2, caso: 'lgtm' });
  check(C.esArm(t) && /^<!-- watchdog-rearm -->$/m.test(t) && /^<!-- arm-reemitido: watchdog-rearm -->$/m.test(t) && !C.cuentaComoRearm(t), 'textoReemision: arm con marcador de origen + arm-reemitido, no cuenta como re-arm');
  // Review de #387: un hallazgo que NOMBRA un marcador no falsifica el origen del arm de ronda 3.
  const hm = C.hallazgosAbiertos('### Hallazgos bloqueantes\n\n**[G] (nuevo) el `watchdog-rearm` y <!-- epic-auto-launch --> sin guard; @claude ping-creator.**\n');
  const t3 = C.textoReemision({ origen: 'manual', ronda: 3, caso: 'ronda3', hallazgos: hm });
  check(hm.length === 1 && C.esArm(t3) && C.origenArm(t3) === 'manual' && !['epic-auto-launch', 'watchdog-rearm', 'arm-de-cola', 'ping-creator', 'epic-partial-relaunch'].some((m) => t3.includes(m)) && !t3.includes('<!-- epic') && /arm-reemitido: manual/.test(t3) && (t3.match(/@claude/g) || []).length === 1,
    'textoReemision ronda 3: hallazgo que cita watchdog-rearm/epic-auto-launch/ping-creator no casa includes con origen manual');
  const db = { 2: '<!-- launch-next: #3 -->', 3: '<!-- epic-audit: ADR-1, #1-#3 -->' };
  const r = await C.cadenaDesdeBody('<!-- launch-next: #2 -->', async (n) => { if (!(n in db)) throw new Error('404'); return db[n]; });
  check(r.completa && r.eslabones.join() === '2,3', 'cadenaDesdeBody: épica → #2 → #3 (epic-audit)');
}

// ── Gate check_critica (step real) ────────────────────────────────────────────
{
  let w = mundo({ issues: { 10: { labels: [], body: 'Issue' } } });
  let o = await correrGate(w, 10, '@claude adelante');
  check(o.blocked === 'true' && w.añadidas.includes('10:critica:pendiente') && /<!-- arm-retenido: manual -->/.test(w.creados[0]?.body || '') && /<!-- critica-gate -->/.test(w.creados[0]?.body || ''),
    'gate: ping sin crítica ⇒ retenido, critica:pendiente y arm-retenido: manual');

  w = mundo({ issues: { 11: { labels: ['correctivo', 'epica'], body: '<!-- correctivo-auditor: #9 -->\nauditoría #9' } } });
  o = await correrGate(w, 11, '@claude');
  check(o.blocked === 'false' && w.creados.length === 0, 'gate: correctivo con correctivo-auditor ⇒ exento');

  w = mundo({ issues: { 12: { labels: ['correctivo'], body: 'Correctivo del Architect' } } });
  o = await correrGate(w, 12, '@claude');
  check(o.blocked === 'true', 'gate: correctivo sin marcador ⇒ retenido');

  w = mundo({ issues: { 13: { labels: ['epica'], body: 'eslabón' } } });
  o = await correrGate(w, 13, '@claude\n<!-- epic-partial-relaunch -->');
  check(o.blocked === 'false', 'gate: epic-partial-relaunch ⇒ exento');

  w = mundo({ issues: { 14: { labels: ['critica:hallazgos'], body: 'x' } } });
  o = await correrGate(w, 14, '@claude\n\nRe-arm.\n\n<!-- watchdog-rearm -->');
  check(o.blocked === 'true' && w.añadidas.length === 0 && w.quitadas.length === 0 && /<!-- arm-retenido: watchdog-rearm -->/.test(w.creados[0]?.body || '') && w.issues[14].labels.join() === 'critica:hallazgos',
    'gate: watchdog-rearm con critica:hallazgos ⇒ retenido, labels intactas, sin ronda nueva');

  w = mundo({ issues: { 15: { labels: ['critica:hallazgos'], body: 'x' } } });
  o = await correrGate(w, 15, '@claude corregido');
  check(o.blocked === 'true' && w.quitadas.includes('15:critica:hallazgos') && w.añadidas.includes('15:critica:pendiente'), 'gate: ping del Architect con critica:hallazgos ⇒ ronda nueva');

  w = mundo({ issues: { 16: { labels: [], body: 'x' } } });
  o = await correrGate(w, 16, '@claude\n<!-- watchdog-rearm -->');
  check(o.blocked === 'false', 'gate: watchdog-rearm sin crítica en curso ⇒ exento (como hoy)');

  w = mundo({ issues: { 17: { labels: ['mensual:aprobada'], body: 'x' } } });
  o = await correrGate(w, 17, '@claude');
  check(o.blocked === 'true' && w.creados.length === 0, 'gate: mensual:aprobada sin cola-mensual-arm ⇒ ignorado (AP-121)');
}

// ── Post-step de critic.yml (step real) ───────────────────────────────────────
{
  // bloqueante r1 con critica-cubre ⇒ solo la épica cambia de label.
  let w = mundo({ issues: { 20: { labels: ['epica', 'critica:pendiente'], body: '' }, 21: { labels: [] }, 22: { labels: [] } },
    comentarios: [com('@claude'), gateCom('manual'), veredicto(1, 'bloqueante', { cubre: [21, 22] })] });
  await correrPost(w, 20, 1);
  check(w.issues[20].labels.includes('critica:hallazgos') && !w.issues[20].labels.includes('critica:pendiente') && w.issues[21].labels.length === 0 && arms(w).length === 0,
    'post: bloqueante r1 con critica-cubre ⇒ solo la épica pasa a critica:hallazgos, sin arm');

  // bloqueante r3 con critica-cubre ⇒ critica-na en épica y cubiertos, arm con hallazgos.
  w = mundo({ issues: { 20: { labels: ['epica', 'critica:pendiente'], body: '' }, 21: { labels: [] }, 22: { labels: [] } },
    comentarios: [com('@claude'), gateCom('manual'), veredicto(3, 'bloqueante', { cubre: [21, 22], extra: '\n### Hallazgos bloqueantes\n\n**[G] (nuevo) Falta X.**\n' })] });
  await correrPost(w, 20, 3);
  check([20, 21, 22].every((n) => w.issues[n].labels.includes('critica-na')) && !w.issues[20].labels.includes('critica:pendiente'),
    'post: bloqueante r3 con critica-cubre ⇒ critica-na en épica y cubiertos');
  check(arms(w).length === 1 && /\[G\] \(nuevo\) Falta X/.test(arms(w)[0].body) && /critica-leida/.test(arms(w)[0].body), 'post: arm de ronda 3 lista los hallazgos sin resolver y pide critica-leida');

  // lgtm con critica-cubre + arm retenido ⇒ critica:lgtm en todos y un arm con el origen.
  w = mundo({ issues: { 20: { labels: ['epica', 'critica:pendiente'], body: '' }, 21: { labels: [] } },
    comentarios: [com('@claude\n<!-- arm-de-cola -->'), gateCom('arm-de-cola'), veredicto(2, 'lgtm', { cubre: [21] })] });
  await correrPost(w, 20, 2);
  check(w.issues[20].labels.includes('critica:lgtm') && w.issues[21].labels.includes('critica:lgtm'), 'post: lgtm con critica-cubre ⇒ critica:lgtm en la épica y en el eslabón');
  check(arms(w).length === 1 && /^<!-- arm-de-cola -->$/m.test(arms(w)[0].body) && /^<!-- arm-reemitido: arm-de-cola -->$/m.test(arms(w)[0].body), 'post: arm retenido + lgtm (también en épica) ⇒ un arm con el marcador de origen');

  // lgtm sin critica-cubre ⇒ solo el issue.
  w = mundo({ issues: { 30: { labels: ['critica:pendiente'], body: '' }, 31: { labels: [] } }, comentarios: [com('@claude'), gateCom('manual'), veredicto(1, 'lgtm')] });
  await correrPost(w, 30, 1);
  check(w.issues[30].labels.includes('critica:lgtm') && w.issues[31].labels.length === 0 && arms(w).length === 1, 'post: lgtm sin critica-cubre ⇒ solo el issue, un arm');

  // watchdog-rearm retenido ⇒ re-emisión que el contador del Watchdog no cuenta.
  w = mundo({ issues: { 32: { labels: ['critica:pendiente'], body: '' } }, comentarios: [com('@claude\n<!-- watchdog-rearm -->'), gateCom('watchdog-rearm'), veredicto(2, 'lgtm')] });
  await correrPost(w, 32, 2);
  check(arms(w).length === 1 && /^<!-- watchdog-rearm -->$/m.test(arms(w)[0].body) && !C.cuentaComoRearm(arms(w)[0].body), 'post: watchdog-rearm re-emitido conserva el marcador y no gasta cap');

  // sin arm-retenido (crítica pedida por label) ⇒ sin arm.
  w = mundo({ issues: { 33: { labels: ['critica:pendiente'], body: '' } }, comentarios: [veredicto(1, 'lgtm')] });
  await correrPost(w, 33, 1);
  check(w.issues[33].labels.includes('critica:lgtm') && arms(w).length === 0, 'post: lgtm sin arm-retenido ⇒ critica:lgtm, sin arm');

  // arm posterior en línea propia ⇒ no re-emite.
  w = mundo({ issues: { 34: { labels: ['critica:pendiente'], body: '' } }, comentarios: [com('@claude'), gateCom('manual'), com('@claude\nArm tras crítica LGTM (sesión de transición)'), veredicto(1, 'lgtm')] });
  await correrPost(w, 34, 1);
  check(arms(w).length === 0, 'post: arm posterior en línea propia ⇒ no re-emite');

  // cita entre backticks posterior ⇒ sí re-emite.
  w = mundo({ issues: { 35: { labels: ['critica:pendiente'], body: '' } }, comentarios: [com('@claude'), gateCom('manual'), com('nota: el `@claude` de arriba'), veredicto(1, 'lgtm')] });
  await correrPost(w, 35, 1);
  check(arms(w).length === 1, 'post: cita entre backticks posterior ⇒ sí re-emite');

  // hold ⇒ critica:lgtm sin arm.
  w = mundo({ issues: { 36: { labels: ['critica:pendiente', 'pausa-cola'], body: '' } }, comentarios: [com('@claude'), gateCom('manual'), veredicto(1, 'lgtm')] });
  await correrPost(w, 36, 1);
  check(w.issues[36].labels.includes('critica:lgtm') && arms(w).length === 0 && w.creados.some((c) => /sin arm/.test(c.body)), 'post: hold ⇒ critica:lgtm, comentario «sin arm», sin arm');

  // gate de antes de AP-128 (sin línea arm-retenido) ⇒ retención manual.
  w = mundo({ issues: { 37: { labels: ['critica:pendiente'], body: '' } }, comentarios: [com('@claude'), com('gate viejo\n\n<!-- critica-gate -->'), veredicto(1, 'lgtm')] });
  await correrPost(w, 37, 1);
  check(arms(w).length === 1, 'post: critica-gate sin arm-retenido (anterior a AP-128) ⇒ re-emite como manual');

  // marcador de autor no TRUSTED ⇒ no cuenta como veredicto (fail-open).
  w = mundo({ issues: { 38: { labels: ['critica:pendiente'], body: '' } }, comentarios: [com('<!-- critica: ronda=1 veredicto=lgtm -->', { assoc: 'NONE', login: 'x' })] });
  await correrPost(w, 38, 1);
  check(!w.issues[38].labels.includes('critica:lgtm') && w.issues[38].labels.includes('critica-na'), 'post: veredicto de autor no TRUSTED ⇒ ignorado (fail-open)');

  // mensual:aprobada ⇒ labels sí, arm nunca (AP-121).
  w = mundo({ issues: { 39: { labels: ['critica:pendiente', 'mensual:aprobada'], body: '' } }, comentarios: [com('@claude'), gateCom('manual'), veredicto(1, 'lgtm')] });
  await correrPost(w, 39, 1);
  check(w.issues[39].labels.includes('critica:lgtm') && arms(w).length === 0, 'post: ruling mensual:aprobada ⇒ critica:lgtm, sin arm (AP-121)');

  // sin marcador en épica ⇒ critica-na en la cadena parseada.
  w = mundo({ issues: { 40: { labels: ['epica', 'critica:pendiente'], body: '<!-- launch-next: #41 -->' }, 41: { labels: [], body: '<!-- launch-next: #42 -->' }, 42: { labels: [], body: '<!-- epic-audit: ADR-9, #40-#42 -->' } },
    comentarios: [com('@claude'), gateCom('manual')] });
  await correrPost(w, 40, 1);
  check([40, 41, 42].every((n) => w.issues[n].labels.includes('critica-na')) && arms(w).length === 1 && w.creados.some((c) => /critica-no-realizada: ronda=1/.test(c.body)),
    'post: sin marcador en épica ⇒ critica-na en la cadena parseada + arm (fail-open)');

  // sin marcador y cadena ilegible ⇒ solo la épica.
  w = mundo({ issues: { 50: { labels: ['epica', 'critica:pendiente'], body: '<!-- launch-next: #51 -->' }, 51: { labels: [], body: '' } }, comentarios: [] });
  w.fallaGet.add(51);
  await correrPost(w, 50, 1);
  check(w.issues[50].labels.includes('critica-na') && !w.issues[51].labels.includes('critica-na'), 'post: sin marcador y cadena ilegible ⇒ critica-na solo en la épica');
}

if (fallos) { console.error(`CHECK-CRITICA ROJO: ${fallos} caso(s).`); process.exit(1); }
console.log('check-critica verde.');
