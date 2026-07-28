#!/usr/bin/env node
// check-contracts — verifica el CONTRATO PUBLICADO de los workflows reusables
// del central (templates/workflow-contracts.json) contra los ficheros reales.
// El central sirve estos reusables a finplan y wmcb vía workflow_call@main; un
// cambio de superficie rompe a los dos consumidores en su siguiente run. El
// contrato es la fuente publicada; este check hace que romperlo sea un acto
// DELIBERADO (editar el contrato), no un efecto colateral invisible de editar
// un YAML.
//
// Semántica ASIMÉTRICA (decisión de diseño, tema 1 — 2026-07-12):
//   COMPATIBLE (pasa en silencio):
//     - input nuevo CON default / no-required que no está en el contrato.
//     - secret que deja de ser required.
//   ROMPE (rojo — exige actualizar el contrato a propósito):
//     - reusable del contrato que desaparece o deja de ser workflow_call.
//     - reusable con workflow_call sin entrada en el contrato (sin publicar).
//     - input del contrato eliminado/renombrado (rompe callers que lo pasan).
//     - input que pasa a required (rompe callers que no lo pasan).
//     - input que pierde su default (cambia el comportamiento de callers que no lo pasan).
//     - secret que pasa a required (rompe callers que no lo pasan).
//
// LÍMITE (heurística "los reusables solo revientan al ejecutarse"): esto caza
// SUPERFICIE, no runtime — límite de tamaño de expresión, permisos del caller,
// contexto del evento heredado siguen necesitando rodaje real. Necesario, no suficiente.
//
// Verde: exit 0. Corre en el CI del central.
import { readFileSync, readdirSync } from 'fs';
import yaml from 'js-yaml';

const WFDIR = '.github/workflows';
const MANIFEST = 'templates/workflow-contracts.json';

// ── Permisos como superficie de contrato (AP-022, incidente #57) ────────────
// El bloque `permissions` del job del reusable es contrato caller↔callee: GitHub
// exige que el callee pida ⊆ lo que el caller (stub) concede; un stub con bloque
// `permissions` EXPLÍCITO deja en `none` toda clave no listada, así que un
// permiso nuevo en el job del reusable es un `startup_failure` de flota
// instantáneo (PR #57 añadió `actions: read` al token ⇒ toda la flota cayó al
// merge, sin canario por el modelo graft/@main). Este check lo modela.
const RANK = { none: 0, read: 1, write: 2 };
const permRank = v => RANK[v] ?? 0;
// Normaliza un valor `permissions` a un mapa {clave:nivel}. Ojo: `typeof null
// === 'object'` en JS, así que un bloque `permissions:` BARE (YAML → null; en
// GitHub = concede/pide `none` a todo) hay que colapsarlo a {} explícitamente,
// o `perms[k]` revienta con TypeError más abajo. Una forma `read-all`/`write-all`
// (string) también cae a {} — sin-mínimo, límite conocido (AP-022, ningún
// workflow del repo la usa).
const asPerms = p => (p && typeof p === 'object') ? p : {};

// Permisos EFECTIVOS que el reusable pide al caller: unión (máximo scope por
// clave) de los permisos de cada job. El nivel de job REEMPLAZA al de workflow
// (semántica GitHub — no se fusiona); si el job no declara, hereda el de
// workflow; si ninguno declara, el job hereda lo que conceda el caller y no
// impone mínimo. `none` no impone mínimo. El caller debe conceder ⊇ esta unión.
function requiredPermissions(doc) {
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const wfPerm = has(doc, 'permissions') ? asPerms(doc.permissions) : null;
  const jobs = (doc && doc.jobs) || {};
  const req = {};
  for (const jb of Object.values(jobs)) {
    if (!jb || typeof jb !== 'object') continue;
    // El job DECLARA `permissions` (aunque sea bare/null ⇒ `none`) REEMPLAZA al
    // workflow-level; si no lo declara, HEREDA. Distinguir "declarado a null" de
    // "ausente" exige mirar la PRESENCIA de la clave, no `typeof` (null es object).
    const eff = has(jb, 'permissions') ? asPerms(jb.permissions) : (wfPerm || {});
    for (const [k, v] of Object.entries(eff)) {
      if (permRank(v) === 0) continue;
      if (permRank(v) > permRank(req[k])) req[k] = v;
    }
  }
  return req;
}

// Permisos que un stub (caller) CONCEDE al reusable: bloque explícito del job
// `call` si lo redefine, o el de workflow. Un bloque `permissions:` BARE (null)
// es EXPLÍCITO y concede `none` a todo (⇒ asPerms lo colapsa a {}, y el ⊇ emite
// el diagnóstico accionable "concede X:none pero exige X:write" en vez de
// reventar). Un stub SIN bloque explícito hereda el default del repo (no
// razonable estáticamente) ⇒ { explicit:false } y se omite del check ⊇ (el
// consumidor debe conceder ⊇ igualmente).
function grantedPermissions(doc, callJobName) {
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const job = ((doc.jobs || {})[callJobName]) || {};
  if (has(job, 'permissions')) return { explicit: true, perms: asPerms(job.permissions) };
  if (has(doc, 'permissions')) return { explicit: true, perms: asPerms(doc.permissions) };
  return { explicit: false, perms: {} };
}

const fmtPerms = p => Object.keys(p).length
  ? Object.entries(p).sort().map(([k, v]) => `${k}:${v}`).join(', ')
  : '(ninguno)';

// Referencia local a un reusable del central: .../.github/workflows/<f>.yml@ref
const REUSABLE_REF = /\/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)@/;

// Extrae la superficie de contrato de un workflow, o null si no es reusable.
function surface(doc) {
  const on = (doc && doc.on) ?? (doc && doc[true]); // 'on' es booleano true en YAML 1.1
  const wc = on && on.workflow_call;
  if (!wc || typeof wc !== 'object') return null;
  const inputs = wc.inputs || {};
  const secrets = wc.secrets || {};
  return {
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, {
      required: !!(v && v.required),
      has_default: !!(v && Object.prototype.hasOwnProperty.call(v, 'default')),
    }])),
    secrets_required: Object.entries(secrets)
      .filter(([, v]) => v && v.required)
      .map(([k]) => k).sort(),
    permissions_required: requiredPermissions(doc),
  };
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const declared = Object.keys(manifest).filter(k => !k.startsWith('_'));

// Superficie real en disco, solo de los que son reusables. `docs` retiene TODO
// workflow parseado (reusables Y stubs) para el check ⊇ de permisos de abajo.
const onDisk = {};
const docs = {};
for (const f of readdirSync(WFDIR).filter(f => /\.ya?ml$/.test(f))) {
  let doc;
  try { doc = yaml.load(readFileSync(`${WFDIR}/${f}`, 'utf8')); }
  catch { continue; } // check-yaml ya reporta el parseo roto
  docs[f] = doc;
  const s = surface(doc);
  if (s) onDisk[f] = s;
}

const errors = [];

// Reusables sin contrato publicado.
for (const f of Object.keys(onDisk)) {
  if (!declared.includes(f)) errors.push(`${f}: es workflow_call pero no tiene contrato en ${MANIFEST} — decláralo`);
}
// Reusables del contrato que desaparecieron.
for (const f of declared) {
  if (!(f in onDisk)) { errors.push(`${f}: declarado en el contrato pero ya no existe o dejó de ser workflow_call (rotura para consumidores)`); continue; }
  const M = manifest[f], A = onDisk[f];
  const Min = M.inputs || {}, Ain = A.inputs || {};
  for (const [name, m] of Object.entries(Min)) {
    if (!(name in Ain)) { errors.push(`${f}: input \`${name}\` eliminado/renombrado (rompe callers que lo pasan)`); continue; }
    const a = Ain[name];
    if (m.has_default && !a.has_default) errors.push(`${f}: input \`${name}\` perdió su default (cambia el comportamiento de callers que no lo pasan)`);
    if (!m.required && a.required) errors.push(`${f}: input \`${name}\` pasó a required (rompe callers que no lo pasan)`);
  }
  for (const [name, a] of Object.entries(Ain)) {
    if (!(name in Min) && a.required) errors.push(`${f}: input \`${name}\` es nuevo y required (rompe callers existentes) — si es intencional, publícalo en el contrato`);
  }
  const Msec = new Set(M.secrets_required || []);
  for (const s of A.secrets_required) {
    if (!Msec.has(s)) errors.push(`${f}: secret \`${s}\` pasó a required (rompe callers que no lo pasan) — si es intencional, publícalo en el contrato`);
  }

  // FIDELIDAD de permisos (AP-022): el bloque `permissions` del job del
  // reusable debe coincidir EXACTO con `permissions_required` del contrato.
  // A diferencia de inputs (asimétrico), aquí cualquier deriva es rotura
  // publicable: pedir MÁS es startup_failure de flota instantáneo (#57); pedir
  // MENOS deja el contrato rancio. Cualquiera exige editar el contrato A
  // PROPÓSITO — que es justo lo que faltó en #57.
  const Mperm = M.permissions_required || {};
  const Aperm = A.permissions_required || {};
  const permKeys = new Set([...Object.keys(Mperm), ...Object.keys(Aperm)]);
  for (const k of permKeys) {
    const m = Mperm[k], a = Aperm[k];
    if (a && !m) errors.push(`${f}: el job del reusable pide permiso \`${k}:${a}\` NO publicado en el contrato — rompería todo stub con \`permissions\` explícito sin \`${k}\` (startup_failure de flota, clase #57). Publícalo en \`permissions_required\` A PROPÓSITO`);
    else if (m && !a) errors.push(`${f}: el contrato publica \`${k}:${m}\` pero el job del reusable ya no lo pide — actualiza \`permissions_required\` (contrato rancio)`);
    else if (m !== a) errors.push(`${f}: permiso \`${k}\` divergente (contrato=${m}, reusable=${a}) — reconcilia \`permissions_required\``);
  }
}

// Check ⊇ ASIMÉTRICO stub↔reusable (AP-022, propuesta 1): cada stub del central
// (los self-*.yml; los de los consumidores viven en otros repos, invisibles
// aquí) debe CONCEDER ⊇ los `permissions_required` que publica el contrato del
// reusable que invoca. Conceder de más es válido; conceder de menos (o omitir
// una clave de un bloque explícito ⇒ `none`) es el fallo de #57.
for (const [f, doc] of Object.entries(docs)) {
  if (onDisk[f]) continue; // los reusables no son stubs de sí mismos
  const jobs = (doc && doc.jobs) || {};
  for (const [jobName, jb] of Object.entries(jobs)) {
    const uses = jb && jb.uses;
    const m = typeof uses === 'string' && uses.match(REUSABLE_REF);
    if (!m) continue;
    const target = m[1];
    if (!declared.includes(target)) continue; // solo reusables con contrato
    const need = (manifest[target].permissions_required) || {};
    if (!Object.keys(need).length) continue;
    const { explicit, perms } = grantedPermissions(doc, jobName);
    if (!explicit) continue; // sin bloque explícito: default del repo, no razonable
    for (const [k, v] of Object.entries(need)) {
      if (permRank(perms[k]) < permRank(v)) {
        errors.push(`${f} (job \`${jobName}\`): concede \`${k}:${perms[k] || 'none'}\` pero ${target} exige \`${k}:${v}\` — el callee arrancaría en startup_failure (clase #57). Concede ⊇ \`permissions_required\` [${fmtPerms(need)}]`);
      }
    }
  }
}

// Clase wmcb#20: un `inputs.X` referenciado pero NO declarado en workflow_call
// se resuelve a "" en silencio — el mecanismo que lo usa nace inerte (así
// murieron check_chain y check_panel el 2026-07-12). Toda referencia debe
// estar declarada.
for (const f of Object.keys(onDisk)) {
  const raw = readFileSync(`${WFDIR}/${f}`, 'utf8');
  const declared_inputs = new Set(Object.keys(onDisk[f].inputs || {}));
  const referenced = new Set([...raw.matchAll(/inputs\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]));
  for (const name of referenced) {
    if (!declared_inputs.has(name)) errors.push(`${f}: referencia \`inputs.${name}\` sin declararlo en workflow_call — se resuelve a "" en silencio (clase wmcb#20)`);
  }
}

// ── Fidelidad de la tabla LESSON-BEARING (AP-052, repesca finplan#1674) ─────
// Un default del central que codifica una LECCIÓN APRENDIDA (no una preferencia
// de instancia) se declara TRES veces: (a) como default real del `workflow_call`,
// (b) en la tabla `LESSON_BEARING` del step «Divergencia pin↔default» del propio
// reusable — la única copia legible en runtime, porque el reusable corre sobre el
// checkout del CONSUMIDOR y no puede leer este manifiesto—, y (c) aquí, como
// contrato publicado (fuente de los release notes, README §13). Tres copias sin
// gate = deriva garantizada: la instancia que motiva el AP es exactamente una
// copia rancia (el pin 50 del stub de finplan sobrevivió al bump 50→80 del
// central). Este check exige que las tres coincidan; subir un default sin
// actualizar las otras dos es ROJO, no un aviso que nadie lee.
const LB_STEP_ENV = 'LESSON_BEARING';
const LB_PINS_ENV = 'PINS_RECIBIDOS';
// ── CLAMP de presupuesto (AP-061, repesca finplan#1704) ────────────────────
// AP-052 hizo la divergencia pin↔default VISIBLE y la clase recurrió igual: el
// Reviewer murió a los 12m45s sobre finplan#1704 emitiendo LITERAL su propio
// aviso `pin-divergente: timeout_minutes=15 (default central: 22, AP-025)`. La
// prevención es tomar `max(pin, default)` — y NO puede vivir en un step, porque
// `timeout-minutes` es de nivel JOB y se resuelve antes de que corra ninguno.
// Vive por tanto en la expresión de cada punto de uso, lo que convierte el
// default en una CUARTA declaración. Misma doctrina que AP-052: cuatro copias
// sin gate = deriva garantizada.
//
// Forma CANÓNICA exacta (una sola, para que el gate sea legible y no un
// dialecto por fichero):
//   (inputs.budget_pin_forzado && inputs.X) || (inputs.X >= D && inputs.X) || D
// Semántica: forzado ⇒ pin · si no, pin ≥ default ⇒ pin · si no ⇒ default.
const CLAMP_VALVULA = 'budget_pin_forzado';
const clampCanonico = (name, def) => new RegExp(
  `^\\(\\s*inputs\\.${CLAMP_VALVULA}\\s*&&\\s*inputs\\.${name}\\s*\\)` +
  `\\s*\\|\\|\\s*\\(\\s*inputs\\.${name}\\s*>=\\s*${def}\\s*&&\\s*inputs\\.${name}\\s*\\)` +
  `\\s*\\|\\|\\s*${def}$`
);
for (const f of Object.keys(onDisk)) {
  const doc = docs[f];
  const rawWf = readFileSync(`${WFDIR}/${f}`, 'utf8');
  // Cuerpo de cada `${{ … }}` del fichero. Las expresiones de Actions no pueden
  // contener `}}`, así que el no-greedy es exacto.
  //
  // Las LÍNEAS DE COMENTARIO se retiran ANTES de matchear, y no «quedan fuera
  // por construcción»: esto corre sobre el texto crudo, no sobre el AST, así
  // que un `${{ … }}` escrito dentro de un `#` entraría en `exprs` igual. Sin
  // el filtro, documentar la forma canónica en un comentario —justo lo que
  // invita a hacer el mensaje de error del guard (a)+(b)— satisfaría al guard
  // (e) con CERO puntos de uso clampados: el detector anti-inerte se quedaría
  // inerte él mismo (clase wmcb#20, cuarta aplicación). El criterio es «primer
  // carácter no blanco es `#`»: un `#` a media línea puede ser contenido (una
  // ancla `#L10`, un `Bash(gh api:*)`…), no un comentario.
  const wfSinComentarios = rawWf.replace(/^[ \t]*#.*$/gm, '');
  const exprs = [...wfSinComentarios.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map(m => m[1].trim());
  const wc = ((doc && doc.on) ?? (doc && doc[true])).workflow_call;
  const realDefaults = Object.fromEntries(Object.entries(wc.inputs || {})
    .map(([k, v]) => [k, v && Object.prototype.hasOwnProperty.call(v, 'default') ? v.default : undefined]));

  // Tabla embebida en el step (puede no existir: solo `reviewer.yml` la lleva hoy).
  let tabla = null, pinsRaw = '';
  for (const job of Object.values((doc && doc.jobs) || {})) {
    for (const s of (job && job.steps) || []) {
      const env = (s && s.env) || {};
      if (typeof env[LB_STEP_ENV] !== 'string') continue;
      pinsRaw = typeof env[LB_PINS_ENV] === 'string' ? env[LB_PINS_ENV] : '';
      try { tabla = JSON.parse(env[LB_STEP_ENV]); }
      catch (e) {
        // El step es fail-open en runtime (nunca tumba una review); sin este
        // check una tabla rota lo dejaría INERTE en silencio (clase wmcb#20).
        errors.push(`${f}: la tabla \`${LB_STEP_ENV}\` del step no es JSON válido (${e.message}) — el aviso pin↔default nacería inerte (fail-open silencioso)`);
        tabla = [];
      }
      break;
    }
    if (tabla) break;
  }

  const manifiesto = (manifest[f] && manifest[f].lesson_bearing) || null;
  if (!tabla && !manifiesto) continue; // reusable sin inputs lesson-bearing: nada que verificar
  if (!tabla) { errors.push(`${f}: el contrato publica \`lesson_bearing\` pero el reusable no lleva el step con la tabla \`${LB_STEP_ENV}\` — el aviso pin↔default no existe en runtime (AP-052)`); continue; }
  if (!manifiesto) { errors.push(`${f}: el reusable lleva tabla \`${LB_STEP_ENV}\` pero el contrato no publica \`lesson_bearing\` — publícalo en ${MANIFEST} (AP-052)`); continue; }

  const enTabla = new Set(tabla.map(e => e && e.input).filter(Boolean));
  for (const name of Object.keys(manifiesto)) {
    if (!enTabla.has(name)) errors.push(`${f}: \`${name}\` es lesson-bearing en el contrato pero falta en la tabla \`${LB_STEP_ENV}\` del step — el aviso nunca se emitiría para él (AP-052)`);
  }
  for (const e of tabla) {
    const name = e && e.input;
    if (!name) { errors.push(`${f}: entrada sin \`input\` en la tabla \`${LB_STEP_ENV}\``); continue; }
    if (!(name in realDefaults)) { errors.push(`${f}: \`${name}\` en la tabla \`${LB_STEP_ENV}\` no es un input de \`workflow_call\` (referencia muerta)`); continue; }
    if (realDefaults[name] === undefined) { errors.push(`${f}: \`${name}\` es lesson-bearing pero su input no declara \`default\` — no hay lección que pisar`); continue; }
    if (String(realDefaults[name]) !== String(e.default)) {
      errors.push(`${f}: tabla \`${LB_STEP_ENV}\` RANCIA para \`${name}\` (tabla=${JSON.stringify(e.default)}, default real=${JSON.stringify(realDefaults[name])}) — el aviso compararía contra un valor que ya no se sirve (AP-052)`);
    }
    const m = manifiesto[name];
    if (!m) { errors.push(`${f}: \`${name}\` está en la tabla \`${LB_STEP_ENV}\` pero no en \`lesson_bearing\` del contrato — publícalo en ${MANIFEST} (AP-052)`); continue; }
    if (String(m.default) !== String(realDefaults[name])) {
      errors.push(`${f}: \`lesson_bearing.${name}.default\` del contrato (${JSON.stringify(m.default)}) ≠ default real (${JSON.stringify(realDefaults[name])}) — contrato rancio (AP-052)`);
    }
    if (e.ap && m.ap && e.ap !== m.ap) {
      errors.push(`${f}: la AP citada para \`${name}\` diverge (tabla=${e.ap}, contrato=${m.ap}) — reconcilia la atribución de la lección`);
    }
    if (!e.ap || !m.ap) errors.push(`${f}: \`${name}\` es lesson-bearing sin referencia AP en ${!e.ap ? `la tabla \`${LB_STEP_ENV}\`` : 'el contrato'} — una lección sin AP no es citable por el 5-whys`);
    // El step solo puede avisar de los pins que RECIBE: un input en la tabla
    // ausente del mapa `PINS_RECIBIDOS` nace inerte (clase wmcb#20 aplicada al
    // propio detector — el fallo que este AP viene a impedir, un piso más
    // arriba).
    //
    // Dos exigencias, no una:
    //  1. Que la clave y la referencia estén — con frontera de palabra, o
    //     `inputs.timeout` daría por bueno un mapa que solo lleva
    //     `inputs.timeout_minutes` (falso negativo justo en el guard anti-inerte).
    //  2. Que la referencia vaya envuelta en `toJSON(...)`. Con `${{ inputs.x }}`
    //     desnudo el mapa solo produce JSON válido para inputs numéricos: el
    //     primer lesson-bearing de tipo string rompería el `JSON.parse` del step
    //     y, por fail-open, mataría el aviso de TODOS los inputs del reusable.
    //     Sin este check pasaría en verde con el detector muerto.
    const esc = name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    const clave = new RegExp(`"${esc}"\\s*:`).test(pinsRaw);
    const envuelto = new RegExp(`toJSON\\(\\s*inputs\\.${esc}\\s*\\)`).test(pinsRaw);
    // `presente`, no «desnudo»: casa igual con `${{ inputs.x }}` que con
    // `${{ toJSON(inputs.x) }}` (envuelto ⇒ presente), así que mide PRESENCIA de
    // la referencia. Lo desnudo es el `else if`: presente pero sin envolver.
    const presente = new RegExp(`inputs\\.${esc}\\b`).test(pinsRaw);
    if (!(clave && presente)) {
      errors.push(`${f}: \`${name}\` está en la tabla \`${LB_STEP_ENV}\` pero el mapa \`${LB_PINS_ENV}\` del step no le pasa \`inputs.${name}\` — el aviso nace inerte para ese input (clase wmcb#20)`);
    } else if (!envuelto) {
      errors.push(`${f}: \`${name}\` viaja al mapa \`${LB_PINS_ENV}\` con interpolación desnuda — usa \`\${{ toJSON(inputs.${name}) }}\`, o un input no numérico produce JSON inválido y el fail-open del step mata el aviso de TODOS los inputs (AP-052)`);
    }

    // ── Clamp de presupuesto (AP-061) ────────────────────────────────────
    // Las letras son las de AP-061 §«El gate anti-deriva» y NO el orden de
    // ejecución: (d) lleva `continue` y tiene que ir primero, porque los demás
    // guards no tienen sentido sobre un default sin orden. Quien cite un guard
    // desde el ADR (§Falsable, §Riesgos) tiene que aterrizar en el mismo sitio
    // que nombra; una permutación entre las dos casas manda al lector al guard
    // equivocado.
    //
    // (d) `max(pin, default)` solo está definido sobre un tipo ORDENADO. Un
    //     lesson-bearing no numérico dejaría el clamp prometiendo una
    //     prevención que no ejecuta — mecanismo inerte EN VERDE, que es la
    //     clase que AP-052 vino a impedir un piso más arriba. ROJO, para que
    //     quien declare el primero decida explícitamente su semántica.
    if (!Number.isFinite(Number(realDefaults[name]))) {
      errors.push(`${f}: \`${name}\` es lesson-bearing con default NO numérico (${JSON.stringify(realDefaults[name])}) — el clamp \`max(pin, default)\` no está definido sobre un tipo sin orden (AP-061); o el input deja de ser lesson-bearing, o se decide y gatea su semántica de clamp`);
      continue;
    }
    // (c) La válvula tiene que existir: sin ella, el consumidor que quiere
    //     legítimamente MENOS presupuesto pierde la palanca sin recambio. Es
    //     el riesgo declarado de AP-061 y este input es su mitigación.
    if (!(CLAMP_VALVULA in realDefaults) || realDefaults[CLAMP_VALVULA] === undefined) {
      errors.push(`${f}: publica \`lesson_bearing\` pero no declara el input \`${CLAMP_VALVULA}\` con default — el clamp de AP-061 dejaría al consumidor sin válvula para un presupuesto menor deliberado`);
    }
    // (a)+(b) Fidelidad de la CUARTA declaración —forma canónica exacta con el
    //     literal del default REAL, (a)— y prohibición de uso desnudo —(b)—.
    //     Un solo recorrido las cubre porque son la misma disyunción:
    //     Todo `${{ … }}` que toque el input o es el clamp canónico con el
    //     literal del default REAL, o es la forma de diagnóstico
    //     `toJSON(inputs.X)` — que debe llevar el pin CRUDO, porque es lo que
    //     el aviso compara. Cualquier otra cosa es un punto de uso que se come
    //     el pin sin clampear: exactamente cómo `timeout_minutes: 15` mató la
    //     sesión de finplan#1704 con el aviso de AP-052 ya emitido.
    const canon = clampCanonico(esc, String(realDefaults[name]));
    const diag = new RegExp(`^toJSON\\(\\s*inputs\\.${esc}\\s*\\)$`);
    const tocan = exprs.filter(x => new RegExp(`inputs\\.${esc}\\b`).test(x));
    for (const x of tocan) {
      if (canon.test(x) || diag.test(x)) continue;
      // Elipsis explícita: un clamp con el literal rancio se corta justo por
      // donde está el fallo, y sin marca el mensaje se lee como si la expresión
      // terminara ahí (visto en el dry-run de la mutación 22→20).
      const plano = x.replace(/\s+/g, ' ');
      const corto = plano.length > 80 ? plano.slice(0, 80) + ' …' : plano;
      errors.push(`${f}: punto de uso de \`${name}\` SIN clamp — \`\${{ ${corto} }}\`. Un input lesson-bearing se consume clampado: \`\${{ (inputs.${CLAMP_VALVULA} && inputs.${name}) || (inputs.${name} >= ${realDefaults[name]} && inputs.${name}) || ${realDefaults[name]} }}\` (AP-061; el pin crudo solo viaja al mapa \`${LB_PINS_ENV}\` como \`toJSON(inputs.${name})\`)`);
    }
    // (e) Anti-inerte (clase wmcb#20, tercera aplicación al propio detector):
    //     una tabla lesson-bearing cuyo input no se consume clampado en NINGÚN
    //     sitio es un default que se declara pero no se impone.
    if (!tocan.some(x => canon.test(x))) {
      errors.push(`${f}: \`${name}\` es lesson-bearing pero NINGÚN punto de uso lleva el clamp canónico de AP-061 — el default se declara y no se impone; revisa que el literal del clamp sea \`${realDefaults[name]}\``);
    }
  }
}

if (errors.length) {
  console.error('CHECK-CONTRACTS ROJO (rotura de contrato de reusable — desplegaría a los dos consumidores):');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`check-contracts verde: ${declared.length} reusables, contrato fiel.`);
