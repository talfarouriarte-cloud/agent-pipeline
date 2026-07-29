#!/usr/bin/env bash
# Hook PreToolUse (Bash) — polaridad obligatoria del PR.
#
# Motivo (2026-07-07, PR #1113 tras #1103 y #1097): tres híbridos seguidos
# sin `<!-- partial-pr -->`; la regla consultiva no muerde. Este hook impide
# abrir un PR sin declarar polaridad: `<!-- partial-pr -->` (híbrido, deja el
# issue abierto y re-arma) o `<!-- full-pr -->` (completa el issue).
#
# Fail-open salvo en el caso que sabemos detectar: solo bloquea `gh pr create`
# —y, desde AP-078, `gh pr edit` cuando fija body— cuyo body inline (--body) o
# fichero (--body-file) NO contenga un marcador.

set -u
input=$(cat 2>/dev/null) || exit 0
if command -v python3 >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null) || exit 0
elif command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
else
  exit 0
fi
[ -n "$cmd" ] || exit 0

# Detección ANCLADA a inicio de segmento del shell, jamás substring (AP-057;
# clase de fallo «regex-polarity», PR #1133). Con el substring, cualquier
# comando que solo CITE el literal —un `grep 'gh pr create'`, un heredoc que
# documente el flujo, un script de test que lo stubee— quedaba bloqueado por un
# body inexistente; medido en vivo al construir el hook hermano
# `draft-pr-on-push`. Se parte el comando por separadores de shell (`;`, `&&`,
# `||`, `|`, salto de línea) y por aperturas de sustitución (`$(`, backtick), y
# se exige que el segmento EMPIECE por la invocación (tolerando prefijos de
# entorno `VAR=x` y rutas absolutas).
#
# Los vanos `` `...` `` se DESPOJAN antes de segmentar, no se tratan como
# apertura de sustitución (2026-07-29, AP-078 — MEDIDO contra este hook en la
# sesión que lo tocaba: el `git commit -m` que describía este mismo cambio
# quedó BLOQUEADO porque su mensaje citaba `gh pr create` entre backticks). El
# split por backtick venía de la forma ARCAICA de sustitución de comando, que
# ningún agente emite; lo que sí abunda —y crece con AP-078, que suma
# `gh pr edit` a la superficie— es el literal citado en prosa: `creator.md`
# enseña «actualiza el body con `gh pr edit --body-file`», y ese literal viaja
# a mensajes de commit, bodies de PR y comentarios de auditoría. Coste de la
# elección: una sustitución con backticks deja de gatearse; la forma moderna
# `$(…)` sigue gateada y tiene banco. Queda el hueco conocido del heredoc SIN
# backticks (una línea que EMPIECE por la invocación dentro de un `<<EOF` es
# indistinguible de la invocación real), ya declarado arriba.
seg_match() { # $1 = patrón anclado del ejecutable+subcomando
  printf '%s\n' "$cmd" | sed 's/`[^`]*`/ /g; s/\$(/\n/g' | tr ';|&\n' '\n\n\n\n' \
    | grep -Eq "^[[:space:]]*[({]?[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*([^[:space:]]*/)?$1([[:space:]]|$)"
}
# Superficie gateada (AP-078). `gh pr create` SIEMPRE. `gh pr edit` SOLO cuando
# fija body — y ese caso importa más que el otro: con draft-first (AP-047) el
# body que la auditoría acaba leyendo es el del CIERRE, y ese se escribe con
# `gh pr edit --body-file`, que hasta ahora no pasaba por ningún gate. Un
# `gh pr edit --add-label` / `--title` sin body no se toca.
if seg_match 'gh[[:space:]]+pr[[:space:]]+create'; then
  :
elif seg_match 'gh[[:space:]]+pr[[:space:]]+edit'; then
  printf '%s' "$cmd" | grep -Eq -- '(--body(-file)?|-b|-F)[= ]' || exit 0
else
  exit 0
fi

# Cuerpo efectivo: inline o fichero. `gh` acepta forma LARGA y CORTA para las
# dos (`--body`/`-b`, `--body-file`/`-F`) y el allowlist del reusable las admite
# igual (`Bash(gh pr edit:*)`, `Bash(gh pr create:*)`). Mirar solo la larga
# fallaba en los DOS sentidos (hallazgo 1 del pre-reviewer de AP-078): un body
# de CIERRE escrito con `-F` esquivaba el gate entero —huella, vocabulario y
# polaridad—, y simétricamente un `gh pr create -F body.md` VÁLIDO quedaba
# BLOQUEADO, porque el fichero no se leía y `body` seguía siendo el comando.
body="$cmd"
bf=$(printf '%s' "$cmd" | grep -oE '(\-\-body-file|-F)[= ][^[:space:]]+' | head -1 | sed -E 's/(--body-file|-F)[= ]//; s/^["'"'"']//; s/["'"'"']$//')
if [ -n "${bf:-}" ] && [ -f "$bf" ]; then
  body=$(cat "$bf")
elif printf '%s' "$cmd" | grep -Eq -- '(--body|-b)[= ]["'"'"']?(\$\(|`)'; then
  # El body llega por SUSTITUCIÓN de comando (`--body "$(cat f)"`): su texto no
  # está en `$cmd` y no lo podemos leer. Fail-open explícito, coherente con la
  # cabecera de este hook («fail-open salvo en el caso que sabemos detectar»):
  # bloquear aquí sería inventar un veredicto sobre un cuerpo invisible.
  exit 0
fi

# Huella pre-reviewer obligatoria (2026-07-14, wmcb#46: ausente en el 100%
# de los PRs desde su mandato — 3 ciclos; el único mandato de body que se
# cumple 3/3 es el que tiene gate mecánico. Este es ahora ese gate).
# La huella EFECTIVA del body, no «alguna línea que hable de huellas». Un body
# puede CITAR otras huellas —AP-078 dejó las cuatro prosas históricas en
# `docs/decisions.md` y en la tabla de `creator.md`, listas para pegarse en el
# body de un Auditor o de un correctivo— y la huella CITADA no es la EMITIDA:
# es la misma clase «regex-polarity» (PR #1133) que este hook persigue en su
# cabecera, y en `vendored/`, que despliega sin gradualidad a los dos
# consumidores, un falso positivo atasca sesiones en vivo (hallazgo 2 del
# pre-reviewer de AP-078). Criterio: si alguna línea declara `ejecutado`, ÉSA es
# la efectiva —es la afirmación fuerte, y falsearla es una mentira que el
# Reviewer caza, no un problema de regex—; si no, la ÚLTIMA línea
# `no ejecutado`, que es la que el Creator acaba de escribir al cerrar. El
# anclaje a inicio de línea es lo que separa emitir de citar, y tiene banco.
huella=$(printf '%s\n' "$body" | grep -E '^pre-reviewer:[[:space:]]*ejecutado' | tail -1)
[ -n "$huella" ] || huella=$(printf '%s\n' "$body" | grep -E '^pre-reviewer:[[:space:]]*no[[:space:]]+ejecutado' | tail -1)

if [ -z "$huella" ]; then
  echo 'BLOQUEADO: el body del PR no lleva la huella del subagente pre-reviewer. Añade una línea de texto plano: `pre-reviewer: ejecutado · N hallazgos · M aplicados` o `pre-reviewer: no ejecutado — <motivo>`. Sin ella el subagente no es evaluable desde rastros públicos (mandato 2026-07-12).' >&2
  exit 2
fi

# Vocabulario CERRADO del motivo (AP-078, aud. finplan#1736 §Obs.1 +
# finplan#1743). La PRESENCIA de la huella ya estaba gateada desde wmcb#46, y
# se cumple; lo que no se podía sumar era su CONTENIDO: en dos épicas
# consecutivas, 11 de 14 PRs declararon «no ejecutado» con cuatro redacciones
# distintas del MISMO hecho, y la auditoría tuvo que normalizarlas a mano para
# poder contar. Una huella que no se puede sumar con la de al lado no mide el
# gate: lo documenta. Sólo se acota la rama `no ejecutado` — `ejecutado` ya
# lleva su forma canónica en el mandato y su heterogeneidad no era el problema
# medido (blast radius mínimo sobre `vendored/`, que despliega en vivo a los
# dos consumidores).
# El separador tolera el guion ASCII además de la raya (`—`/`-`/`--`): es
# LAXITUD DELIBERADA con banco propio, mismo criterio que el token
# `pre-épica`/`pre-epica` del guard de horneado — el carácter no lleva
# información y un teclado que no lo produzca no debe atascar una sesión. Lo que
# se acota es el MOTIVO.
if printf '%s' "$huella" | grep -Eq '^pre-reviewer:[[:space:]]*no[[:space:]]+ejecutado' \
   && ! printf '%s' "$huella" | grep -Eq '^pre-reviewer:[[:space:]]*no[[:space:]]+ejecutado[[:space:]]*(—|-{1,2})[[:space:]]*(pendiente[[:space:]]*\(draft de hito\)|pendiente[[:space:]]*\(hito intermedio\)|harness-sin-subagentes|sustituido-inline|otro:[[:space:]]*[^[:space:]])'; then
  cat >&2 <<'EOF'
BLOQUEADO: la huella `pre-reviewer: no ejecutado` lleva un motivo fuera del vocabulario CERRADO (AP-078). Usa EXACTAMENTE uno de estos:
- `pre-reviewer: no ejecutado — pendiente (draft de hito)`      (lo escribe el hook draft-pr-on-push; no lo escribes tú)
- `pre-reviewer: no ejecutado — pendiente (hito intermedio)`    (body de un hito intermedio)
- `pre-reviewer: no ejecutado — harness-sin-subagentes`         (la herramienta NO está en tu toolbox o falló al invocarla)
- `pre-reviewer: no ejecutado — sustituido-inline`              (revisión inline en su lugar: DEGRADACIÓN declarada, no equivalencia)
- `pre-reviewer: no ejecutado — otro: <texto>`                  (escape explícito; sigue siendo contable como fuera-de-vocabulario)

Antes de declarar `harness-sin-subagentes`, comprueba que es verdad: CLAUDE.md § «Autorización EXPLÍCITA de subagentes» trae la petición del usuario que la instrucción del harness condiciona (`unless the user requested it`), así que la causa histórica de 11/14 ya no aplica. Esa huella es la ÚNICA señal por la que la auditoría sabrá si el arreglo funcionó — no la falsees.
EOF
  exit 2
fi

# Sustancia, no solo etiqueta (2026-07-07, PRs #1118/#1121 con body = solo
# el marcador): parcial exige sección de informe y prohíbe Closes; full
# exige Closes.
if printf '%s' "$body" | grep -Eq '<!--[[:space:]]*partial-pr[[:space:]]*-->'; then
  if ! printf '%s' "$body" | grep -Eiq 'alcance[[:space:]]+restante'; then
    echo 'BLOQUEADO: PR parcial sin sección «Alcance restante». La siguiente sesión re-armada depende de ese informe (qué queda, por ítem de DoD, y decisiones pendientes). Añádelo al body.' >&2
    exit 2
  fi
  if printf '%s' "$body" | grep -Eiq '(close[sd]?|fixe?[sd]?)[[:space:]]+#[0-9]+'; then
    echo 'BLOQUEADO: PR parcial con Closes/Fixes — el autoclose de GitHub cerraría el issue al mergear (lección #1097). En parciales usa Refs #N.' >&2
    exit 2
  fi
  exit 0
fi
if printf '%s' "$body" | grep -Eq '<!--[[:space:]]*full-pr[[:space:]]*-->'; then
  if ! printf '%s' "$body" | grep -Eiq 'close[sd]?[[:space:]]+#[0-9]+'; then
    echo 'BLOQUEADO: PR full sin `Closes #N` — sin él, el issue no se cierra al mergear y la cadena no avanza. Añádelo al body.' >&2
    exit 2
  fi
  exit 0
fi

cat >&2 <<'EOF'
BLOQUEADO: el body del PR no declara polaridad. Añade exactamente uno:
- `<!-- full-pr -->` si este PR completa TODO el alcance del issue.
- `<!-- partial-pr -->` si es un PR híbrido/parcial (el issue queda abierto y se re-arma; incluye la sección «Informe de alcance restante»).
Sin declaración, epic-merge tratará el PR como parcial (fallo seguro y ruidoso).
EOF
exit 2
