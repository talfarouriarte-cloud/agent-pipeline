#!/usr/bin/env bash
# Hook PostToolUse (Bash) — apertura MECÁNICA del draft en el primer push de hito.
#
# Motivo (AP-057, repesca finplan#1684 / aud. finplan#1700): AP-047 movió la
# apertura del PR del cierre al primer hito, pero la dejó como acto de PROSA en
# `creator.md`. Medición en la primera épica que la ejercita POST-despliegue:
# **0/7 PRs nacieron draft**, y 2 de esas 7 aperturas las tuvo que hacer el
# estado (sesiones muertas en `success` sin PR) — exactamente la clase que
# AP-047 existía para cerrar. La doctrina del propio AP-047 aplicada a sí misma:
# un canal declarativo no puede ser el belt de otro canal declarativo. Aquí el
# PRIMER PUSH **ES** la apertura: el Creator deja de poder olvidarla.
#
# Contrato de hooks: este hook NUNCA bloquea (el push ya ocurrió). Sale 0
# siempre. Cuando abre el draft lo comunica al modelo por
# `hookSpecificOutput.additionalContext` (canal informativo, no error).
#
# FAIL-OPEN en toda duda (no-git, rama que no parsea, `gh` ausente o sin auth,
# PR ya existente, base indeterminable, fallo de `gh pr create`): se sale 0 en
# silencio. Un bug aquí no debe brickear al Creator; el peor caso es volver al
# statu quo (apertura discrecional + red residual AP-023/AP-047).
#
# ANCLAJE (clase de fallo «regex-polarity», PR #1133): la detección del push se
# hace a INICIO DE SEGMENTO del comando, jamás por substring — un `grep 'git
# push'` que solo CITE el literal no debe abrir un PR. Igual el parse de la
# rama (`^claude/issue-N-`) y la búsqueda de PR existente (`--head` exacto).

set -u

input=$(cat 2>/dev/null) || exit 0

if command -v python3 >/dev/null 2>&1; then
  JSONER=python3
elif command -v jq >/dev/null 2>&1; then
  JSONER=jq
else
  exit 0
fi

if [ "$JSONER" = python3 ]; then
  cmd=$(printf '%s' "$input" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null) || exit 0
else
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
fi
[ -n "${cmd:-}" ] || exit 0

# ── 1. ¿El comando ejecutaba un push? Anclado al inicio de cada segmento del
# shell (`;`, `&&`, `||`, `|`, salto de línea), tolerando prefijos de entorno
# (`VAR=x git push`), rutas absolutas y el wrapper `git-push.sh` de la action.
# (Mismo `seg_match` que `pr-polarity.sh`: los hooks se injertan fichero a
# fichero — no hay librería común que compartir sin inventar una superficie
# nueva de graft; se duplica a propósito, con el mismo comentario.)
seg_match() { # $1 = patrón anclado del ejecutable+subcomando
  printf '%s\n' "$cmd" | sed 's/\$(/\n/g; s/`/\n/g' | tr ';|&\n' '\n\n\n\n' \
    | grep -Eq "^[[:space:]]*[({]?[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*([^[:space:]]*/)?$1([[:space:]]|$)"
}
seg_match '(bash[[:space:]]+|sh[[:space:]]+)?([^[:space:]]*/)?(git[[:space:]]+push|git-push\.sh)' || exit 0

# ── 2. Estado, no salida del comando: el push CUAJÓ si la rama existe en el
# remoto (más robusto que parsear stdout/stderr de git).
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
[ -n "${branch:-}" ] || exit 0

# ── 3. Solo ramas de Creator, y el número de issue se DERIVA de la rama.
issue=$(printf '%s' "$branch" | sed -nE 's|^claude/issue-([0-9]+)-.*$|\1|p')
[ -n "${issue:-}" ] || exit 0

git rev-parse --verify --quiet "refs/remotes/origin/${branch}" >/dev/null 2>&1 || exit 0

# ── 4. ¿Ya hay PR para esta rama? (`--head` es match exacto de rama, no
# substring.) `--state all`: si hubo uno y se cerró, no se abre otro.
command -v gh >/dev/null 2>&1 || exit 0
existing=$(gh pr list --head "$branch" --state all --limit 1 --json number --jq '.[0].number' 2>/dev/null) || exit 0
[ -z "${existing:-}" ] || exit 0

# ── 5. Base del PR: pin explícito del consumidor si lo hay, si no la rama por
# defecto del repo (mismo criterio que el post-step AP-023 de `claude-code.yml`,
# que abre desde el estado contra `inputs.default_branch`).
base="${PIPELINE_BASE_BRANCH:-}"
if [ -z "$base" ]; then
  base=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name 2>/dev/null) || base=""
fi
[ -n "${base:-}" ] || exit 0
[ "$base" != "$branch" ] || exit 0

# ── 6. Título: el del issue (truncado con seguridad UTF-8), con caída a un
# título determinista si la API no responde.
issue_title=$(gh issue view "$issue" --json title --jq .title 2>/dev/null) || issue_title=""
title="WIP #${issue} — draft de hito"
if [ -n "${issue_title:-}" ]; then
  if [ "$JSONER" = python3 ]; then
    issue_title=$(printf '%s' "$issue_title" | python3 -c 'import sys;t=sys.stdin.read().strip();print(t if len(t)<=180 else t[:179]+"…")' 2>/dev/null) || issue_title=""
  else
    issue_title=""
  fi
  [ -n "$issue_title" ] && title="$issue_title"
fi

# ── 7. Body: polaridad PROVISIONAL + huella pre-reviewer + «Alcance restante».
# Cumple lo que el hook `pr-polarity` exige de un `gh pr create` del Creator
# (este hook no pasa por él: no es una llamada a la tool Bash).
tmp=$(mktemp 2>/dev/null) || exit 0
cat > "$tmp" <<EOF
<!-- partial-pr -->
<!-- draft-mecanico-de-hito -->

Refs #${issue}

Draft abierto MECÁNICAMENTE por el hook \`draft-pr-on-push\` (AP-057) en el primer
push de hito de la rama \`${branch}\`. La apertura del PR es una transición por
ESTADO, no un acto discrecional del Creator: el PR existe desde el primer hito
para que el trabajo pusheado nunca quede sin PR si la sesión muere.

Este body es un PLACEHOLDER. El Creator lo sustituye en el siguiente hito
(\`gh pr edit --body-file …\`, que resuelve el PR por la rama actual) y fija la
polaridad DEFINITIVA antes de \`gh pr ready\`: marcador \`full-pr\` + la palabra de
autoclose con el número del issue si completa el alcance, o marcador \`partial-pr\`
+ \`Refs #${issue}\` + «Alcance restante» real si es híbrido.

### Alcance restante

Draft mecánico de hito — el Creator aún no ha declarado el alcance restante; lo
edita en el siguiente hito. Si esta sección sigue así al mergear, el PR se trata
como PARCIAL (el issue queda abierto y se re-arma).

pre-reviewer: no ejecutado — pendiente (draft de hito)
EOF

url=$(gh pr create --draft --base "$base" --head "$branch" --title "$title" --body-file "$tmp" 2>&1) || { rm -f "$tmp"; exit 0; }
rm -f "$tmp"

# ── 8. Avisar al modelo por el canal informativo (no es un error).
msg="Hook draft-pr-on-push (AP-057): tu primer push de hito abrió AUTOMÁTICAMENTE el PR en DRAFT contra '${base}' (${url}). NO ejecutes 'gh pr create' — ya existe. A partir de ahora: (1) en cada hito actualiza el body con 'gh pr edit --body-file'; (2) al cerrar, fija la polaridad definitiva (<!-- full-pr --> + Closes #${issue} si completas el alcance, o <!-- partial-pr --> + Refs #${issue} + «Alcance restante»), actualiza la huella 'pre-reviewer:' y el título, y marca 'gh pr ready'. El draft NO despierta al Reviewer (guard AP-047)."

if [ "$JSONER" = python3 ]; then
  MSG="$msg" python3 -c 'import json,os;print(json.dumps({"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":os.environ["MSG"]}}))' 2>/dev/null || printf '%s\n' "$msg"
else
  jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}' 2>/dev/null || printf '%s\n' "$msg"
fi

exit 0
