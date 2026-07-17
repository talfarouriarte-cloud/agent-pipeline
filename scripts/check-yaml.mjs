#!/usr/bin/env node
// check-yaml — verifica que TODOS los ficheros de .github/workflows/ parsean
// como YAML válido. Caza corrupción de sintaxis antes del merge: el modo de
// fallo real es smart-quotes / caracteres invisibles introducidos al editar un
// workflow en la web (2026-07-12, régimen de aterrizaje del central). No valida
// semántica ni runtime — solo que el fichero es YAML parseable.
//
// AP-027 (2026-07-17, incidente PR #86): además, caza la clase «bloque con
// `${{ }}` sobre el límite de 21000 chars por expresión de Actions». Un
// escalar (p. ej. `script: |`) que contiene UNA sola expresión `${{ }}` se
// evalúa ENTERO como plantilla; si supera 21000 chars, GitHub rechaza el
// workflow al parsearlo — fichero inválido, runs con 0 jobs, y por `@main`
// la rotura llega a los consumidores sin canary. YAML-válido ≠ Actions-válido:
// este check cierra esa brecha de forma determinista (el saneado es mover las
// expresiones a `env:` del step — patrón epic-merge, Fase C). Umbral blando a
// 19000 (aviso, no rojo) para dar margen antes del acantilado.
// Verde: exit 0. Corre en el CI del central.
import { readFileSync, readdirSync } from 'fs';
import yaml from 'js-yaml';

const DIR = '.github/workflows';
const HARD = 21000;   // límite real de Actions por expresión/plantilla
const SOFT = 19000;   // margen de aviso
const files = readdirSync(DIR).filter(f => /\.ya?ml$/.test(f)).sort();

const errors = [];
const warnings = [];

// Recorre todos los escalares string del documento YAML con su ruta.
function* strings(node, path = '$') {
  if (typeof node === 'string') { yield [path, node]; return; }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* strings(node[i], `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) yield* strings(v, `${path}.${k}`);
  }
}

for (const f of files) {
  let doc;
  try {
    doc = yaml.load(readFileSync(`${DIR}/${f}`, 'utf8'));
  } catch (e) {
    const where = e.mark ? ` (línea ${e.mark.line + 1}, col ${e.mark.column + 1})` : '';
    errors.push(`${f}: YAML inválido${where} — ${e.reason || e.message}`);
    continue;
  }
  for (const [path, s] of strings(doc)) {
    if (!s.includes('${{')) continue;   // sin expresión no hay evaluación de plantilla: sin límite
    if (s.length > HARD) {
      errors.push(`${f}: ${path} — ${s.length} chars con \`\${{ }}\` (> ${HARD}): Actions rechazará el workflow entero. Mueve las expresiones a env: del step (AP-027).`);
    } else if (s.length > SOFT) {
      warnings.push(`${f}: ${path} — ${s.length} chars con \`\${{ }}\` (> ${SOFT}, margen antes de ${HARD}): considera mover las expresiones a env: (AP-027).`);
    }
  }
}

if (warnings.length) {
  console.error('check-yaml AVISOS (no bloquean):');
  warnings.forEach(w => console.error('  - ' + w));
}
if (errors.length) {
  console.error('CHECK-YAML ROJO:');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`check-yaml verde: ${files.length} workflows parsean y ningún bloque con expresiones supera ${HARD} chars.`);
