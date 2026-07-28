#!/usr/bin/env node
// check-hooks — anti-drift de la capa de hooks vendored (2026-07-28, nit 3 de
// la review de AP-057). `vendored/claude/**` lo sirve el graft (AP-009) EN VIVO
// a los dos consumidores en su siguiente run, sin gradualidad, y hasta ahora el
// CI del central no lo miraba en absoluto: un rename de hook sin tocar
// settings.json dejaba a los dos consumidores apuntando a un fichero
// inexistente —efecto en runtime: silencio, y CI verde—, y un error de sintaxis
// en cualquier hook se desplegaba igual. Es la clase que AP-052 § «Puntos
// ciegos» nombra: el estado de despliegue efectivo se INFIERE, no se LEE.
//
// Verifica, en las dos direcciones (mismo patrón que check-labels):
//   1. Todo `command` de settings.json referencia un .sh presente en hooks/.
//   2. Ningún .sh de hooks/ queda huérfano (el graft lo copia igual: sería
//      código muerto desplegado en vivo).
//   3. `bash -n` sobre cada .sh (sintaxis; no ejecuta nada).
// Verde: exit 0. Corre en el CI del central.
import { readFileSync, readdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

const DIR = 'vendored/claude';
const HOOKS = `${DIR}/hooks`;
const errors = [];

const settings = JSON.parse(readFileSync(`${DIR}/settings.json`, 'utf8'));
const files = readdirSync(HOOKS).filter(f => f.endsWith('.sh'));
const referenced = new Set();
let commands = 0;

for (const [event, matchers] of Object.entries(settings.hooks || {})) {
  for (const m of matchers) {
    for (const h of m.hooks || []) {
      commands++;
      const cmd = h.command || '';
      // Los hooks se invocan como `bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/<f>`:
      // en el consumidor viven bajo .claude/hooks/, injertados desde aquí.
      const ref = /\.claude\/hooks\/([A-Za-z0-9._-]+)/.exec(cmd);
      if (!ref) {
        errors.push(`${event}: command sin ruta \`.claude/hooks/<fichero>\` reconocible — \`${cmd}\``);
        continue;
      }
      referenced.add(ref[1]);
      if (!existsSync(`${HOOKS}/${ref[1]}`)) {
        errors.push(`${event}: \`${ref[1]}\` no existe en ${HOOKS}/ — los consumidores recibirían un hook que apunta a la nada (silencio en runtime)`);
      }
    }
  }
}

for (const f of files) {
  if (!referenced.has(f)) errors.push(`${HOOKS}/${f}: no lo referencia ningún hook de settings.json — el graft lo despliega igual (código muerto en vivo)`);
  try {
    execFileSync('bash', ['-n', `${HOOKS}/${f}`], { stdio: 'pipe' });
  } catch (e) {
    errors.push(`${HOOKS}/${f}: \`bash -n\` ROJO — ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
}

if (errors.length) { console.error('CHECK-HOOKS ROJO:'); errors.forEach(e => console.error('  - ' + e)); process.exit(1); }
console.log(`check-hooks verde: ${commands} hooks declarados en settings.json, ${files.length} scripts presentes, todos referenciados y con sintaxis válida.`);
