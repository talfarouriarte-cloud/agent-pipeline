#!/usr/bin/env node
// check-bun-npm — banco de Bun desde npm (AP-147, central#438, ruling mensual
// 2026-11-08 posición 27).
//
// `anthropics/claude-code-action` instala Bun con `setup-bun` desde GitHub
// Releases; un 504 de Releases tumbó todas las sesiones. Cada job que usa la
// action la precede con un paso `id: bun-npm` que trae Bun del registro npm y
// le pasa la ruta por `path_to_bun_executable`. Verifica, sobre los YAML de
// `.github/workflows/`, que todo job con `anthropics/claude-code-action@`:
//  (a) tiene ANTES un paso `id: bun-npm` con `continue-on-error: true` y
//      `env.BUN_VERSION` (la misma en todos los workflows);
//  (b) ese paso lleva el mismo `if:` que el de la action (no corre de balde ni
//      falta cuando la action sí corre);
//  (c) la action recibe `path_to_bun_executable: ${{ steps.bun-npm.outputs.path }}`.
// Además se ejercita a sí mismo: cada regla rota en memoria tiene que poner el
// banco ROJO. Cuelga del piggyback de `check-embedded-js.mjs` como sus hermanos.
import { readFileSync, readdirSync } from 'fs';
import yaml from 'js-yaml';

const DIR = '.github/workflows';
const ACTION = 'anthropics/claude-code-action@';
const RUTA = '${{ steps.bun-npm.outputs.path }}';
const esAction = (s) => typeof s?.uses === 'string' && s.uses.startsWith(ACTION);

function revisar(docs) {
  const errores = [];
  const versiones = new Set();
  let usos = 0;
  for (const [fichero, doc] of Object.entries(docs)) {
    for (const [job, def] of Object.entries(doc?.jobs ?? {})) {
      const steps = def?.steps ?? [];
      steps.forEach((s, i) => {
        if (!esAction(s)) return;
        usos++;
        const donde = `${fichero} › ${job} › «${s.name ?? s.id ?? i}»`;
        const j = steps.findIndex((p) => p?.id === 'bun-npm');
        if (j < 0 || j > i) { errores.push(`${donde}: sin paso previo \`id: bun-npm\``); return; }
        const b = steps[j];
        if (b['continue-on-error'] !== true) errores.push(`${donde}: el paso bun-npm no tiene \`continue-on-error: true\``);
        if (!b.env?.BUN_VERSION) errores.push(`${donde}: el paso bun-npm no declara \`env.BUN_VERSION\``);
        else versiones.add(String(b.env.BUN_VERSION));
        if (String(b.if ?? '').trim() !== String(s.if ?? '').trim()) errores.push(`${donde}: el \`if:\` del paso bun-npm no es el de la action`);
        if (s.with?.path_to_bun_executable !== RUTA) errores.push(`${donde}: falta \`path_to_bun_executable: ${RUTA}\``);
      });
    }
  }
  if (usos === 0) errores.push(`ningún job usa ${ACTION} (¿se movió la action?)`);
  if (versiones.size > 1) errores.push(`BUN_VERSION distinta entre workflows: ${[...versiones].join(', ')}`);
  return { errores, usos };
}

const docs = {};
for (const f of readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n)).sort()) {
  docs[f] = yaml.load(readFileSync(`${DIR}/${f}`, 'utf8'));
}

const { errores, usos } = revisar(docs);
if (errores.length) {
  for (const e of errores) console.error(`✗ check-bun-npm: ${e}`);
  process.exit(1);
}

// Autoejercicio: cada mutación, sobre una copia, tiene que poner el banco rojo.
function primerUso() {
  const copia = structuredClone(docs);
  for (const doc of Object.values(copia)) {
    for (const def of Object.values(doc?.jobs ?? {})) {
      const steps = def?.steps ?? [];
      const i = steps.findIndex(esAction);
      if (i >= 0) return { copia, steps, i, j: steps.findIndex((p) => p?.id === 'bun-npm') };
    }
  }
}
const MUTACIONES = {
  'sin paso bun-npm': ({ steps, j }) => { steps.splice(j, 1); },
  'paso bun-npm después de la action': ({ steps, i, j }) => { const [b] = steps.splice(j, 1); steps.splice(i, 0, b); },
  'sin continue-on-error': ({ steps, j }) => { delete steps[j]['continue-on-error']; },
  'sin BUN_VERSION': ({ steps, j }) => { delete steps[j].env.BUN_VERSION; },
  'BUN_VERSION divergente': ({ steps, j }) => { steps[j].env.BUN_VERSION = '0.0.0'; },
  'if divergente': ({ steps, j }) => { steps[j].if = 'false'; },
  'sin path_to_bun_executable': ({ steps, i }) => { delete steps[i].with.path_to_bun_executable; },
};
for (const [nombre, mutar] of Object.entries(MUTACIONES)) {
  const m = primerUso();
  mutar(m);
  if (revisar(m.copia).errores.length === 0) {
    console.error(`✗ check-bun-npm: la mutación «${nombre}» no pone el banco rojo`);
    process.exit(1);
  }
}

console.log(`check-bun-npm verde: ${usos} usos de la action con Bun desde npm; ${Object.keys(MUTACIONES).length} mutaciones rojas.`);
