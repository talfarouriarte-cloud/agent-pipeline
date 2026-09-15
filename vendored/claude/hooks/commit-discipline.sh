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
#
# ── Check 3 (AP-087): contador de ediciones desde el último push ──────────────
# Los Checks 1 y 2 keyan por VOLUMEN DE ESTADO (ficheros dirty / commits sin
# pushear). El P0 medido (repesca finplan#1975 / PR #1974; recurrencia
# finplan#2005 / PR #2004) NO los dispara: una ronda de nits resolvió 12 ítems en
# ≤3 ficheros y en 0 commits (todo en working tree) y la sesión murió justo antes
# del `commit+push` final ⇒ 12 nits PERDIDOS y rehechos por una sesión fresca; la
# recurrencia alcanzó `human-needed` + re-arm humano. Pocos ficheros y cero
# commits: Check 1 (dirty<4) y Check 2 (ahead=0) ambos callan. El eje que sí
# crece es el NÚMERO DE EDICIONES. Check 3 lo cuenta y bloquea la siguiente
# edición tras EDITS_MAX ediciones sin un push intermedio, forzando la cadencia
# de push-por-lote que el mandato (CLAUDE.md § «Loop protocol with Reviewer»,
# AP-087) ya exige para las rondas de review. El contador se RESETEA por ESTADO:
# cuando la ref remota de la rama avanza (hubo push), vuelve a 0.

set -u

DIRTY_MAX=4      # ficheros modificados/sin trackear antes de bloquear
UNPUSHED_MAX=2   # commits locales sin pushear antes de bloquear
EDITS_MAX=8      # ediciones desde el último push antes de bloquear (Check 3)

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

# ── Check 3: ediciones acumuladas sin push (AP-087). El marcador de reset es la
# SHA de la ref remota de la rama (`refs/remotes/origin/<rama>`), que git avanza
# en CADA push de la rama INDEPENDIENTEMENTE de si hay upstream configurado —
# más robusto que `@{u}`, que no existe si se pushea con `git push origin <rama>`
# sin `-u` (el caso del helper `git-push.sh`). Cuando esa SHA cambia respecto a
# la guardada, hubo push ⇒ el contador vuelve a 0.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
marker=$(git rev-parse --verify --quiet "refs/remotes/origin/${branch:-HEAD}" 2>/dev/null || echo unpushed)
state="$(git rev-parse --git-dir 2>/dev/null)/.commit-discipline-edits"
prev_marker=""; count=0
if [ -f "$state" ]; then
  read -r prev_marker count < "$state" 2>/dev/null || { prev_marker=""; count=0; }
fi
case "${count:-0}" in ''|*[!0-9]*) count=0 ;; esac   # fichero corrupto ⇒ desde 0
[ "$marker" = "$prev_marker" ] || count=0            # hubo push ⇒ reset

if [ "$count" -ge "$EDITS_MAX" ]; then
  cat >&2 <<EOF
BLOQUEADO por disciplina de commits: llevas ${count} ediciones sin pushear (límite: ${EDITS_MAX}), aunque toquen pocos ficheros.
Commitea y PUSHEA el lote antes de seguir editando (una ronda de review/nits NO es un solo hito: commit+push por lote, con typecheck del lote antes de su commit — CLAUDE.md § «Loop protocol with Reviewer», AP-087). El push resetea este contador.
EOF
  exit 2
fi

# No bloquea: registra esta edición. Escritura best-effort (fail-open si falla).
printf '%s %s\n' "$marker" "$((count + 1))" > "$state" 2>/dev/null || true

exit 0
