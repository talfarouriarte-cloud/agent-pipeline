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
  };
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const declared = Object.keys(manifest).filter(k => !k.startsWith('_'));

// Superficie real en disco, solo de los que son reusables.
const onDisk = {};
for (const f of readdirSync(WFDIR).filter(f => /\.ya?ml$/.test(f))) {
  let doc;
  try { doc = yaml.load(readFileSync(`${WFDIR}/${f}`, 'utf8')); }
  catch { continue; } // check-yaml ya reporta el parseo roto
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
