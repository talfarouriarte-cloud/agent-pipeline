#!/usr/bin/env bash
# Hook PreToolUse (Bash) — disciplina de tests: SOLO ficheros afectados,
# y (AP-089) push antes de verificar en ramas ya publicadas.
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
BENCH_ERE='(^|[;&|[:space:]])(pnpm([[:space:]]+--filter[[:space:]]+[^[:space:]]+)?[[:space:]]+(run[[:space:]]+)?bench|npm[[:space:]]+run[[:space:]]+bench)([[:space:]:]|$)'
if ! printf '%s' "$cmd" | grep -Eq "$RUNNER_ERE" && ! printf '%s' "$cmd" | grep -Eq "$BENCH_ERE"; then
  exit 0
fi

# ── Check «push antes de verificar» (AP-089). Orden de ronda: fix → typecheck
# → commit → push → tests. Si la rama ya está publicada (tiene upstream) y hay
# trabajo sin pushear, bloquear la verificación: un árbol sin pushear muere
# con la sesión (finplan PR #1974: 12 nits perdidos; #2299/#2301: rondas
# «success» con checklist marcado y tip remoto sin mover), mientras que un
# push aún sin verificar cuesta un run de CI que ci.yml cancela al siguiente
# push. Sin upstream (antes del hito 1) no actúa: ahí cubre draft-pr-on-push.
# Sobreescribible por repo con PIPELINE_VERIFY_AFTER_PUSH=0. Fail-open.
if [ "${PIPELINE_VERIFY_AFTER_PUSH:-1}" != "0" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
  if [ -n "$upstream" ]; then
    # .claude/** se excluye del conteo: el graft vendored puede dejarlo sucio
    # al arrancar (central#271) y no es trabajo del Creator.
    dirty=$(git status --porcelain 2>/dev/null | grep -Ev '^.. \.claude/' | wc -l | tr -d ' ')
    ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
    if [ "${dirty:-0}" -gt 0 ] || [ "${ahead:-0}" -gt 0 ]; then
      cat >&2 <<EOF2
BLOQUEADO por disciplina de push (AP-089): vas a lanzar verificación con ${dirty} ficheros sin commitear y ${ahead} commits sin pushear en una rama ya publicada.
Orden de ronda: fix → typecheck → commit → push → tests. Commitea y pushea lo que llevas AHORA (git push origin HEAD) y después lanza los tests. Si la sesión muere durante la verificación, lo que no está pusheado se pierde; CI es el gate de la suite.
EOF2
      exit 2
    fi
  fi
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
