#!/usr/bin/env bash
# Hook PreToolUse (Edit|Write|MultiEdit|NotebookEdit) — disciplina de commits.
#
# Motivo: la instrucción "commits parciales según avanzas" vive en docs e
# issues y ningún Creator la sigue (pérdida total de trabajo en el caso A5
# #949: run murió con todo sin commitear). Este hook la hace mecánica:
# no se puede seguir editando con demasiado trabajo sin commitear+pushear.
#
# Contrato de hooks de Claude Code: exit 0 = permitir; exit 2 = bloquear,
# y stderr se devuelve al modelo como razón. Bash NO está hookeado, así
# que commitear/pushear siempre es una salida disponible (sin deadlock).
#
# Fail-open: ante cualquier duda (no-git, error inesperado) se permite la
# edición. Un bug aquí no debe brickear al Creator.

set -u

DIRTY_MAX=4      # ficheros modificados/sin trackear antes de bloquear
UNPUSHED_MAX=2   # commits locales sin pushear antes de bloquear

# Fuera de un repo git (o git roto): permitir.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# ── Check 1: trabajo sin commitear.
dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "${dirty:-0}" -ge "$DIRTY_MAX" ]; then
  cat >&2 <<EOF
BLOQUEADO por disciplina de commits: tienes ${dirty} ficheros modificados sin commitear (límite: $((DIRTY_MAX - 1))).
Antes de seguir editando: (1) commitea lo que llevas en un commit parcial con mensaje descriptivo, (2) pushea la rama. Después continúa. Si algún fichero es scratch que no debe commitearse, descártalo o añádelo a .gitignore.
EOF
  exit 2
fi

# ── Check 2: commits locales acumulados sin pushear. Un commit local en un
# sandbox que muere vale lo mismo que nada.
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
if [ -n "$upstream" ]; then
  ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
else
  # Rama aún no pusheada: contar contra la base del repo.
  # Rama base parametrizable (agent-pipeline): PIPELINE_BASE_BRANCH o autodetección.
  base="${PIPELINE_BASE_BRANCH:-$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')}"
  base="${base:-main}"
  ahead=$(git rev-list --count "origin/${base}..HEAD" 2>/dev/null || echo 0)
fi
if [ "${ahead:-0}" -gt "$UNPUSHED_MAX" ]; then
  cat >&2 <<EOF
BLOQUEADO por disciplina de commits: llevas ${ahead} commits sin pushear (límite: ${UNPUSHED_MAX}).
Pushea la rama ahora (git push -u origin HEAD si es nueva) y después continúa editando.
EOF
  exit 2
fi

exit 0
