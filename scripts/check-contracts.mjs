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

if (errors.length) {
  console.error('CHECK-CONTRACTS ROJO (rotura de contrato de reusable — desplegaría a los dos consumidores):');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`check-contracts verde: ${declared.length} reusables, contrato fiel.`);
