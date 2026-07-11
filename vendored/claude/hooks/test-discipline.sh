#!/usr/bin/env bash
# Hook PreToolUse (Bash) — disciplina de tests: SOLO ficheros afectados.
#
# Motivo: la suite completa (`pnpm test`, `vitest run` sin rutas) cuelga la
# sesión del Creator y ha causado pérdida de trabajo reincidente pese a la
# regla escrita (CLAUDE.md, plantilla de issue). Este hook la hace mecánica.
# CI corre la suite completa en el PR: el gate global ya existe.
#
# Contrato: exit 0 = permitir; exit 2 = bloquear (stderr vuelve al modelo).
# Fail-open: sin stdin parseable o sin jq, permitir — un bug aquí no debe
# brickear al Creator.

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

# ¿Invoca un runner de tests?
# Patrón de runners detectados: sobreescribible por repo en
# .claude/hooks/test-discipline.pattern (una línea, ERE). Default: stack JS del origen.
PATTERN_FILE="$CLAUDE_PROJECT_DIR/.claude/hooks/test-discipline.pattern"
if [ -f "$PATTERN_FILE" ]; then RUNNER_ERE=$(head -1 "$PATTERN_FILE"); else RUNNER_ERE='(^|[;&|[:space:]])(npx[[:space:]]+)?vitest([[:space:]]|$)|pnpm([[:space:]]+-r)?([[:space:]]+--[^[:space:]]+)*[[:space:]]+test([[:space:]]|$|:)|npm[[:space:]]+(run[[:space:]]+)?test([[:space:]]|$)'; fi
if ! printf '%s' "$cmd" | grep -Eq "$RUNNER_ERE"; then
  exit 0
fi

# Permitido si trae rutas de fichero (test scoped) DESPUÉS del runner:
# extensión de fuente o ruta con «/» en la cola del comando.
tail=$(printf '%s' "$cmd" | sed -E 's/.*((npx[[:space:]]+)?vitest|pnpm([[:space:]]+-r)?([[:space:]]+--[^[:space:]]+)*[[:space:]]+test[^[:space:]]*|npm[[:space:]]+(run[[:space:]]+)?test)//')
if printf '%s' "$tail" | grep -Eq '\.[cm]?[jt]sx?([[:space:]]|$|"|'"'"')|[[:space:]][^-][^[:space:]]*/[^[:space:]]+'; then
  exit 0
fi

cat >&2 <<'EOF'
BLOQUEADO por disciplina de tests: estás lanzando la suite completa (o vitest sin rutas / en modo watch), que cuelga la sesión y pierde trabajo.
Ejecuta SOLO los ficheros afectados: `npx vitest run <ruta1> <ruta2>` (rutas explícitas). El gate de suite completa es el CI del PR, no tu sesión.
EOF
exit 2
