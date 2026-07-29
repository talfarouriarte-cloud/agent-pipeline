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
  // Literal CITADO entre backticks (AP-078, medido contra este hook: el
  // `git commit -m` que describía el propio cambio quedó bloqueado). Los vanos
  // `...` se despojan antes de segmentar; el split por backtick venía de la
  // forma arcaica de sustitución, que ningún agente emite.
  ['cita-backticks-create', 'git commit -m "arreglo: un `gh pr create --body-file f` valido ya no se bloquea"', 0, 'literal citado entre backticks en un commit: no bloquea'],
  ['cita-backticks-edit', 'git commit -m "creator.md enseña `gh pr edit --body-file <fichero>` en cada hito"', 0, 'el literal que enseña creator.md, citado: no bloquea'],
  // …y la forma MODERNA de sustitución sigue gateada: el despojo no la afloja.
  ['substitucion-moderna-sigue-gateada', `X=$(gh pr create --body-file ${bodyFile('sub.md', 'sin nada\n')})`, 2, 'gh pr create dentro de $( ) sigue gateado'],

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

  // ── formas CORTAS de gh (hallazgo 1 del pre-reviewer de AP-078) ──────────
  // `gh pr edit` acepta `-b/--body` y `-F/--body-file`, y el allowlist del
  // reusable (`Bash(gh pr edit:*)`) admite las dos. Mirar solo la larga fallaba
  // en los dos sentidos: el body de CIERRE con `-F` esquivaba el gate entero, y
  // un `gh pr create -F` VÁLIDO quedaba bloqueado por no leerse el fichero.
  ['edit-F-sin-huella', `gh pr edit -F ${bodyFile('sF.md', '<!-- full-pr -->\nCloses #187\n')}`, 2, 'forma corta -F NO puede esquivar el gate'],
  ['edit-b-sin-nada', 'gh pr edit -b "body sin polaridad ni huella"', 2, 'forma corta -b NO puede esquivar el gate'],
  ['create-F-valido', `gh pr create --draft -F ${fFull}`, 0, 'create -F con body valido NO se bloquea (falso positivo simetrico)'],
  ['edit-F-motivo-malo', `gh pr edit -F ${motivo('porque la sesión no tenía subagentes')}`, 2, 'el vocabulario tambien se gatea por la forma corta'],
  ['edit-b-substitucion', 'gh pr edit -b "$(cat body.md)"', 0, 'forma corta con sustitucion: fail-open'],

  // ── huella EMITIDA vs huella CITADA (hallazgo 2 del pre-reviewer) ────────
  // Un body puede CITAR una huella histórica —las cuatro prosas viven hoy en
  // `docs/decisions.md` y en la tabla de `creator.md`— y la citada NO es la
  // emitida. Bloquear ahí es la clase «regex-polarity» (PR #1133) en `vendored/`,
  // que despliega sin gradualidad: atasca sesiones en vivo.
  ['cita-con-ejecutado-real', `gh pr edit --body-file ${bodyFile('cita.md', '<!-- full-pr -->\nCloses #187\npre-reviewer: no ejecutado — la sesión no tenía subagentes (ejemplo histórico citado)\npre-reviewer: ejecutado · 2 hallazgos · 2 aplicados\n')}`, 0, 'huella ejecutado real + cita de prosa historica: NO bloquea'],
  ['cita-sin-huella-real', `gh pr edit --body-file ${bodyFile('cita2.md', '<!-- full-pr -->\nCloses #187\npre-reviewer: no ejecutado — la sesión no tenía subagentes\n')}`, 2, 'la misma prosa SIN huella valida sigue bloqueando'],
  // Teeth del anclaje `^`: la MENCIÓN a media línea no puede convertirse en la
  // huella efectiva. Sin el ancla, `tail -1` se quedaría con la mención.
  ['mencion-media-linea', `gh pr edit --body-file ${bodyFile('men.md', '<!-- full-pr -->\nCloses #187\npre-reviewer: no ejecutado — harness-sin-subagentes\nNota: el PR anterior cerró con pre-reviewer: no ejecutado — vete a saber por qué.\n')}`, 0, 'mencion a media linea NO desplaza a la huella emitida'],
  // El caso ANTERIOR documenta la intención pero NO tiene dientes: sobrevive a
  // quitarle el `^` a la extracción (la mención pasa a ser la huella, y como no
  // EMPIEZA por `pre-reviewer:` el vocabulario ni se dispara ⇒ fail-open, mismo
  // exit 0). Éste sí los tiene, y en la dirección que duele: la huella emitida
  // es INVÁLIDA y una mención POSTERIOR la taparía. Sin el ancla, `tail -1` se
  // queda con la mención y el gate se abre en silencio sobre una huella que
  // debía bloquear — que es el modo de fallo caro, no el ruidoso.
  ['mencion-posterior-no-tapa-huella-invalida', `gh pr edit --body-file ${bodyFile('men2.md', '<!-- full-pr -->\nCloses #187\npre-reviewer: no ejecutado — porque la sesión no tenía subagentes\nNota: en finplan#1742 la huella decía pre-reviewer: no ejecutado — otra cosa.\n')}`, 2, 'mencion posterior NO puede tapar una huella emitida invalida'],

  // ── laxitud DELIBERADA del separador (hallazgo 3 del pre-reviewer) ───────
  // El guion ASCII se acepta además de la raya, mismo criterio que el token
  // `pre-épica`/`pre-epica` del guard de horneado. Sin este caso la laxitud
  // sobrevivía a su propia mutación: nadie decidía si era intencional.
  ['separador-ascii', `gh pr edit --body-file ${bodyFile('sep.md', '<!-- full-pr -->\nCloses #187\npre-reviewer: no ejecutado - harness-sin-subagentes\n')}`, 0, 'separador ASCII aceptado (laxitud deliberada)'],
  ['separador-ascii-doble', `gh pr edit --body-file ${bodyFile('sep2.md', '<!-- full-pr -->\nCloses #187\npre-reviewer: no ejecutado -- sustituido-inline\n')}`, 0, 'separador ASCII doble aceptado'],
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
