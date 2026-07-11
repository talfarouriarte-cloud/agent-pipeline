#!/usr/bin/env bash
# Hook PreToolUse (Bash) — polaridad obligatoria del PR.
#
# Motivo (2026-07-07, PR #1113 tras #1103 y #1097): tres híbridos seguidos
# sin `<!-- partial-pr -->`; la regla consultiva no muerde. Este hook impide
# abrir un PR sin declarar polaridad: `<!-- partial-pr -->` (híbrido, deja el
# issue abierto y re-arma) o `<!-- full-pr -->` (completa el issue).
#
# Fail-open salvo en el caso que sabemos detectar: solo bloquea `gh pr create`
# cuyo body inline (--body) o fichero (--body-file) NO contenga un marcador.

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

printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+create' || exit 0

# Cuerpo efectivo: inline o fichero (--body-file).
body="$cmd"
bf=$(printf '%s' "$cmd" | grep -oE '\-\-body-file[= ][^[:space:]]+' | head -1 | sed -E 's/--body-file[= ]//; s/^["'"'"']//; s/["'"'"']$//')
if [ -n "${bf:-}" ] && [ -f "$bf" ]; then body=$(cat "$bf"); fi

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
