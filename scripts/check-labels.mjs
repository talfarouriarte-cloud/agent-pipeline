#!/usr/bin/env node
// check-labels — verifica que toda label FIJA declarada en
// templates/labels-usage.json (qué usa cada workflow) exista en
// templates/labels.json (qué se provisiona). Materializado, no inferido
// (2026-07-12, tras el drift serial-*/labels.json: un consumidor nuevo
// nacía sin las labels que el guard serial necesitaba). Dinámicas
// (estado:*, rondas:N) se auto-crean via addLabels y quedan fuera.
// Verde: exit 0. Corre en el CI del central.
import { readFileSync, readdirSync } from 'fs';

const DIR = 'templates';
const template = new Set(JSON.parse(readFileSync(`${DIR}/labels.json`, 'utf8')).map(l => l.name));
const usage = JSON.parse(readFileSync(`${DIR}/labels-usage.json`, 'utf8'));
const wfs = readdirSync('.github/workflows').filter(f => /\.ya?ml$/.test(f));

const errors = [];
// 1. Toda label declarada existe en el template.
let declared = 0;
for (const [wf, labels] of Object.entries(usage)) {
  if (wf.startsWith('_')) continue;
  for (const name of labels) {
    declared++;
    if (!template.has(name)) errors.push(`${wf} usa \`${name}\` — ausente de labels.json (consumidor nuevo nacería sin ella)`);
  }
}
// 2. Todo workflow presente tiene entrada en el manifiesto (o se olvidó declararlo).
for (const f of wfs) if (!(f in usage)) errors.push(`${f}: sin entrada en labels-usage.json (declara [] si no usa labels fijas)`);
// 3. Entradas del manifiesto que ya no corresponden a un workflow.
for (const wf of Object.keys(usage)) if (!wf.startsWith('_') && !wfs.includes(wf)) errors.push(`labels-usage.json declara ${wf} — ese workflow no existe`);

if (errors.length) { console.error('CHECK-LABELS ROJO:'); errors.forEach(e => console.error('  - ' + e)); process.exit(1); }
console.log(`check-labels verde: ${declared} labels declaradas en ${Object.keys(usage).length - 1} workflows, todas provisionadas.`);
