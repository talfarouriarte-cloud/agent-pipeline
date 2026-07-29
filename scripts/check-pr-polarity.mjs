#!/usr/bin/env node
// check-pr-polarity — banco EJECUTABLE del hook `vendored/claude/hooks/pr-polarity.sh`
// (2026-07-29, AP-078).
//
// Por qué existe. `check-hooks.mjs` vigila la capa de hooks en su forma
// ESTÁTICA —que el `command` de settings.json apunte a un fichero presente, que
// ningún .sh quede huérfano, que `bash -n` pase— y eso es anti-drift, no
// comportamiento: un hook sintácticamente válido que bloquea lo que debía dejar
// pasar (o al revés) sale verde por los tres. Ese hueco no era caro mientras el
// hook tuvo UNA condición; AP-078 le añade una superficie nueva (`gh pr edit`
// con body) y un vocabulario cerrado, y las dos formas de fallar son caras en
// direcciones opuestas:
//   - bloquear de más ⇒ una sesión de Creator atascada contra un gate que no
//     debía morder, en `vendored/`, que despliega EN VIVO a los dos consumidores
//     sin gradualidad;
//   - bloquear de menos ⇒ el gate vuelve a ser prosa y la huella vuelve a ser
//     incontable, que es exactamente lo que AP-078 vino a cerrar.
// Un banco de casos es lo único que distingue las dos.
//
// Ejecuta el hook DE VERDAD (mismo contrato que el harness: JSON por stdin con
// `.tool_input.command`, veredicto por exit code — 0 = deja pasar, 2 = bloquea)
// y contrasta el exit code observado con el esperado. Verde: exit 0.
// Cuelga del piggyback de `check-embedded-js.mjs` (misma razón documentada
// allí: un paso propio de `ci.yml` viajaría como parche pendiente de un humano).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = 'vendored/claude/hooks/pr-polarity.sh';

const tmp = mkdtempSync(join(tmpdir(), 'pr-polarity-'));
const bodyFile = (name, content) => {
  const p = join(tmp, name);
  writeFileSync(p, content);
  return p;
};

// Cuerpos canónicos reutilizados por los casos.
const HUELLA_OK = 'pre-reviewer: ejecutado · 3 hallazgos · 3 aplicados';
const FULL_OK = `<!-- full-pr -->\nCloses #187\n${HUELLA_OK}\n`;
const PARCIAL_OK = `<!-- partial-pr -->\nRefs #187\n### Alcance restante\n- nada\n${HUELLA_OK}\n`;

const fFull = bodyFile('full.md', FULL_OK);
const fParcial = bodyFile('parcial.md', PARCIAL_OK);
// El body EXACTO que emite el hook hermano `draft-pr-on-push` al abrir el draft
// de hito: si el vocabulario de AP-078 no lo admitiera, el gate se mordería a sí
// mismo en el primer push de CADA sesión de la flota.
const fDraftHook = bodyFile(
  'draft-hook.md',
  '<!-- partial-pr -->\n<!-- draft-mecanico-de-hito -->\nRefs #187\n### Alcance restante\n- por determinar\npre-reviewer: no ejecutado — pendiente (draft de hito)\n',
);
const motivo = (m) => bodyFile(
  `m-${Buffer.from(m).toString('hex').slice(0, 24)}.md`,
  `<!-- partial-pr -->\nRefs #187\n### Alcance restante\n- x\npre-reviewer: no ejecutado — ${m}\n`,
);

const CASOS = [
  // ── superficie: qué se gatea y qué no ────────────────────────────────────
  ['no-es-gh-pr', 'echo hola', 0, 'comando ajeno: fail-open'],
  ['create-ok-full', `gh pr create --draft --body-file ${fFull}`, 0, 'create con full+Closes+huella'],
  ['create-ok-parcial', `gh pr create --draft --body-file ${fParcial}`, 0, 'create con partial+Refs+alcance+huella'],
  ['create-sin-polaridad', `gh pr create --body-file ${bodyFile('np.md', `Refs #187\n${HUELLA_OK}\n`)}`, 2, 'create sin marcador de polaridad'],
  ['create-sin-huella', `gh pr create --body-file ${bodyFile('nh.md', '<!-- full-pr -->\nCloses #187\n')}`, 2, 'create sin huella pre-reviewer'],
  // AP-078: `gh pr edit` entra en la superficie SOLO si fija body.
  ['edit-sin-body', 'gh pr edit --add-label needs-review', 0, 'edit sin body: fuera de la superficie'],
  ['edit-solo-titulo', 'gh pr edit --title "otro titulo"', 0, 'edit solo de titulo: fuera de la superficie'],
  ['edit-body-ok', `gh pr edit --body-file ${fFull}`, 0, 'edit que fija body valido'],
  ['edit-body-sin-huella', `gh pr edit --body-file ${bodyFile('eh.md', '<!-- full-pr -->\nCloses #187\n')}`, 2, 'edit que fija body SIN huella: el caso del cierre'],
  ['edit-body-sin-polaridad', `gh pr edit --body-file ${bodyFile('ep.md', `Refs #187\n${HUELLA_OK}\n`)}`, 2, 'edit que fija body sin polaridad'],
  // Cuerpo invisible por sustitución de comando: fail-open explícito, no un
  // veredicto inventado sobre texto que el hook no puede leer.
  ['edit-body-substitucion', 'gh pr edit --body "$(cat body.md)"', 0, 'body por sustitucion: fail-open'],
  ['create-body-substitucion', 'gh pr create --body "$(cat body.md)"', 0, 'body por sustitucion en create: fail-open'],
  // Anclaje a inicio de segmento, jamás substring (clase «regex-polarity», PR #1133).
  ['mencion-en-grep', "grep -n 'gh pr edit --body' docs/agents/creator.md", 0, 'mera MENCION del literal: no bloquea'],

  // ── vocabulario cerrado del motivo ───────────────────────────────────────
  ['motivo-draft-hito', `gh pr create --draft --body-file ${fDraftHook}`, 0, 'body literal del hook draft-pr-on-push'],
  ['motivo-hito-intermedio', `gh pr edit --body-file ${motivo('pendiente (hito intermedio)')}`, 0, 'motivo pendiente (hito intermedio)'],
  ['motivo-harness', `gh pr edit --body-file ${motivo('harness-sin-subagentes')}`, 0, 'motivo harness-sin-subagentes'],
  ['motivo-inline', `gh pr edit --body-file ${motivo('sustituido-inline')}`, 0, 'motivo sustituido-inline'],
  ['motivo-otro', `gh pr edit --body-file ${motivo('otro: el diff es de un solo caracter')}`, 0, 'escape otro: <texto>'],
  ['motivo-otro-vacio', `gh pr edit --body-file ${motivo('otro:')}`, 2, 'escape otro: SIN texto no cuenta'],
  // Las CUATRO redacciones reales que la auditoría finplan#1743/#1736 tuvo que
  // normalizar a mano. Son el corpus que justifica el vocabulario: si alguna
  // volviera a pasar, el gate no estaría cerrando lo que dice cerrar.
  ['prosa-real-1736', `gh pr edit --body-file ${motivo('esta sesión tiene los subagentes deshabilitados por configuración del harness')}`, 2, 'prosa libre real (aud. finplan#1736 Obs.1)'],
  ['prosa-real-1737', `gh pr edit --body-file ${motivo('la herramienta de subagentes está deshabilitada en esta sesión')}`, 2, 'prosa libre real (finplan#1737)'],
  ['prosa-real-1738', `gh pr edit --body-file ${motivo('Do not call the AgentTool unless the user requested it')}`, 2, 'prosa libre real: instruccion citada verbatim (finplan#1738/#1741)'],
  ['prosa-real-1742', `gh pr edit --body-file ${motivo('el subagente de pre-review está deshabilitado en esta sesión')}`, 2, 'prosa libre real (finplan#1742)'],
  // La rama `ejecutado` NO se acota: su heterogeneidad no era el problema medido.
  ['ejecutado-libre', `gh pr edit --body-file ${bodyFile('ej.md', '<!-- full-pr -->\nCloses #187\npre-reviewer: ejecutado, sin hallazgos\n')}`, 0, 'rama ejecutado sigue libre'],
];

let fallos = 0;
for (const [id, cmd, esperado, desc] of CASOS) {
  const payload = JSON.stringify({ tool_input: { command: cmd } });
  let observado = 0;
  try {
    execFileSync('bash', [HOOK], { input: payload, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    observado = typeof e.status === 'number' ? e.status : -1;
  }
  if (observado !== esperado) {
    console.error(`  ✗ ${id}: esperado exit=${esperado}, observado exit=${observado} — ${desc}`);
    console.error(`     cmd: ${cmd}`);
    fallos++;
  }
}

rmSync(tmp, { recursive: true, force: true });

if (fallos) {
  console.error(`check-pr-polarity ROJO: ${fallos} de ${CASOS.length} casos fallan.`);
  process.exit(1);
}
console.log(`check-pr-polarity verde: ${CASOS.length} casos del hook pr-polarity se comportan como el mandato declara.`);
