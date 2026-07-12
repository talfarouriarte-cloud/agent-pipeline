#!/usr/bin/env node
// check-yaml — verifica que TODOS los ficheros de .github/workflows/ parsean
// como YAML válido. Caza corrupción de sintaxis antes del merge: el modo de
// fallo real es smart-quotes / caracteres invisibles introducidos al editar un
// workflow en la web (2026-07-12, régimen de aterrizaje del central). No valida
// semántica ni runtime — solo que el fichero es YAML parseable.
// Verde: exit 0. Corre en el CI del central.
import { readFileSync, readdirSync } from 'fs';
import yaml from 'js-yaml';

const DIR = '.github/workflows';
const files = readdirSync(DIR).filter(f => /\.ya?ml$/.test(f)).sort();

const errors = [];
for (const f of files) {
  try {
    yaml.load(readFileSync(`${DIR}/${f}`, 'utf8'));
  } catch (e) {
    const where = e.mark ? ` (línea ${e.mark.line + 1}, col ${e.mark.column + 1})` : '';
    errors.push(`${f}: YAML inválido${where} — ${e.reason || e.message}`);
  }
}

if (errors.length) {
  console.error('CHECK-YAML ROJO:');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`check-yaml verde: ${files.length} workflows parsean.`);
