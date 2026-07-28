#!/usr/bin/env node
// check-patches — consumidor mecánico de los parches PENDIENTES DE APLICACIÓN
// HUMANA (2026-07-28, hallazgo 🟡 6 de la review de AP-064).
//
// La GitHub App de claude-code-action no tiene permiso `workflows` (ADR-020),
// así que un cambio en `.github/workflows/**` producido por un agente no puede
// pushearse: viaja como `docs/patches/*.patch` y lo aplica un humano. Ese
// pendiente era un mandato de MEMORIA HUMANA sin consumidor — el patrón que
// este repo se comprometió a no acumular (AP-008) — y además tiene una forma
// de fallo silenciosa propia: el hunk va anclado a un fichero que el repo toca
// a menudo, luego el primer cambio que aterrice cerca lo rompe SIN RUIDO, y
// nadie se entera hasta que alguien intenta aplicarlo semanas después.
//
// Este check le pone consumidor. Para cada `docs/patches/*.patch`:
//   - aplica limpio          → PENDIENTE: se anuncia (una línea por parche,
//                              con el SHA contra el que se verificó si el
//                              propio parche lo declara). NO es rojo: el
//                              pendiente es legítimo hasta que el humano actúe.
//   - reverse-aplica limpio  → YA APLICADO: el parche es artefacto de
//                              provenance; se puede borrar. Tampoco es rojo.
//   - ninguna de las dos     → ROJO: el parche ha DERIVADO respecto del árbol.
//                              Ya no es aplicable y nadie lo sabía.
// Verde (o pendiente): exit 0. Corre en el CI del central.
import { readdirSync, existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const DIR = 'docs/patches';
const errors = [];
const pendientes = [];
const aplicados = [];

const files = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.patch')).sort() : [];

const aplica = (file, reverse) => {
  const args = ['apply', '--check', ...(reverse ? ['--reverse'] : []), `${DIR}/${file}`];
  try { execFileSync('git', args, { stdio: 'pipe' }); return null; }
  catch (e) { return String(e.stderr || e.message).trim().split('\n')[0]; }
};

for (const f of files) {
  // El parche puede declarar el SHA contra el que se verificó, en una línea de
  // comentario `# verificado-contra: <sha>` antes del primer `diff --git`.
  const cab = readFileSync(`${DIR}/${f}`, 'utf8').split('diff --git')[0];
  const sha = /verificado-contra:\s*([0-9a-f]{7,40})/i.exec(cab);
  const ref = sha ? ` (verificado contra ${sha[1]})` : '';
  const fwd = aplica(f, false);
  if (!fwd) { pendientes.push(`${f}: aplica limpio — PENDIENTE de \`git apply ${DIR}/${f}\` por un humano${ref}`); continue; }
  const rev = aplica(f, true);
  if (!rev) { aplicados.push(`${f}: ya aplicado en el árbol — artefacto de provenance, borrable`); continue; }
  errors.push(`${f}: DERIVADO — ni aplica ni reverse-aplica contra el árbol actual; el pendiente que transporta ya no es ejecutable. Regenéralo o bórralo. (git apply: ${fwd})`);
}

if (errors.length) { console.error('CHECK-PATCHES ROJO:'); errors.forEach(e => console.error('  - ' + e)); process.exit(1); }
for (const p of pendientes) console.log(`::warning::check-patches — ${p}`);
aplicados.forEach(a => console.log(`  · ${a}`));
console.log(`check-patches verde: ${files.length} parche(s) en ${DIR}/, ${pendientes.length} pendiente(s) de aplicación humana, ${aplicados.length} ya aplicado(s), 0 derivado(s).`);
