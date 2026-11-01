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
# AP-101 (central#300): también `node_modules/.bin/vitest` (con `node` delante
# o sin él, con o sin `./`), `pnpm exec vitest`, y `pnpm -F <pkg>` /
# `pnpm --filter <pkg>` / `pnpm run test`. Antes un `/` delante de `vitest`
# o un flag con valor dejaban el comando fuera del hook.
PATTERN_FILE="$CLAUDE_PROJECT_DIR/.claude/hooks/test-discipline.pattern"
PNPM_FLAGS='([[:space:]]+(-r|--recursive|-F[[:space:]]*[^-[:space:]][^[:space:]]*|--filter([[:space:]]+|=)[^[:space:]]+|--[^[:space:]]+))*'
VITEST='((npx|pnpm[[:space:]]+exec)[[:space:]]+)?(node[[:space:]]+)?([^[:space:];&|]*node_modules/\.bin/)?vitest'
PNPM_TEST='pnpm'"$PNPM_FLAGS"'[[:space:]]+(run[[:space:]]+)?test'
if [ -f "$PATTERN_FILE" ]; then RUNNER_ERE=$(head -1 "$PATTERN_FILE"); else RUNNER_ERE='(^|[;&|[:space:]])'"$VITEST"'([[:space:]]|$)|'"$PNPM_TEST"'([[:space:]]|$|:)|npm[[:space:]]+(run[[:space:]]+)?test([[:space:]]|$)'; fi
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
    # .claude/** cuenta por BLOB (AP-133), mismo criterio que la red de AP-124
    # § Riesgos (e): el graft nunca sale en porcelain (exclude / skip-worktree,
    # graft-vendored); lo que sale es la restauración AP-097 (blob de la base,
    # `M` o `??`) o trabajo de la sesión (skill editada o nueva). Cuenta salvo
    # borrado, enlace o hash filtrado igual a origin/<base>:<ruta>. Listado
    # como la red: -z y --untracked-files=all (un fichero por entrada, nunca
    # el directorio). Sin base resoluble: fail-open a la exclusión anterior.
    dirty=0; base=""; base_state=""
    while IFS= read -r -d '' ent; do
      xy=${ent:0:2}; p=${ent:3}
      case "$xy" in R*|C*) IFS= read -r -d '' _ || true;; esac
      case "$p" in
        .claude/*)
          case "$xy" in *D*) continue;; esac
          { [ -L "$p" ] || [ ! -f "$p" ]; } && continue
          if [ -z "$base_state" ]; then
            base_state=no
            cache=$(git rev-parse --git-path pipeline-base 2>/dev/null || true)
            base="${PIPELINE_BASE_BRANCH:-}"
            if [ -z "$base" ] && [ -n "$cache" ] && [ -s "$cache" ]; then base=$(head -n1 "$cache"); fi
            if [ -z "$base" ]; then
              base=$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p' | head -n1)
              [ "$base" = "(unknown)" ] && base=""
              [ -z "$base" ] || [ -z "$cache" ] || printf '%s\n' "$base" > "$cache" 2>/dev/null || true
            fi
            if [ -n "$base" ] && ! git rev-parse -q --verify "refs/remotes/origin/$base" >/dev/null 2>&1; then
              git fetch -q --depth=1 origin "+refs/heads/$base:refs/remotes/origin/$base" >/dev/null 2>&1 || true
            fi
            if [ -n "$base" ] && git rev-parse -q --verify "refs/remotes/origin/$base" >/dev/null 2>&1; then
              base_state=ok
            else
              echo 'test-discipline: base no resoluble, .claude/** excluido como antes' >&2
            fi
          fi
          [ "$base_state" = ok ] || continue
          hb=$(git hash-object --path="$p" -- "$p" 2>/dev/null || echo '?')
          [ "$(git rev-parse -q --verify "refs/remotes/origin/$base:$p" 2>/dev/null || true)" = "$hb" ] && continue
          dirty=$((dirty + 1));;
        *) dirty=$((dirty + 1));;
      esac
    done < <(git status --porcelain=v1 -z --untracked-files=all 2>/dev/null)
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

tail=$(printf '%s' "$cmd" | sed -E 's#.*(vitest|'"$PNPM_TEST"'[^[:space:]]*|npm[[:space:]]+(run[[:space:]]+)?test)##')

# ── Tope de rutas por invocación (AP-133). Un «afectados» de 100+ ficheros
# (AP-124 (b) sobre un productor muy usado) es la suite en la práctica y mata
# la sesión antes del push (aud. asesoramiento#3384). Una ruta = un token de
# la cola con el predicado de abajo; no cuentan los flags, las redirecciones
# (sueltas o pegadas) ni nada tras el primer `|`, `>`, `>>` o `2>`.
# PIPELINE_MAX_TEST_PATHS (default 25; 0 desactiva).
max_paths="${PIPELINE_MAX_TEST_PATHS:-25}"
if [ "$max_paths" != "0" ] && [ "$max_paths" -eq "$max_paths" ] 2>/dev/null; then
  npaths=0
  read -r -a toks <<< "$tail" || true
  for t in "${toks[@]+"${toks[@]}"}"; do
    case "$t" in '|'*|'>'*|'>>'*|'2>'*) break;; -*|*'>'*) continue;; esac
    if printf '%s' "$t" | grep -Eq '\.[cm]?[jt]sx?("|'"'"')?$|/'; then npaths=$((npaths + 1)); fi
  done
  if [ "$npaths" -gt "$max_paths" ]; then
    cat >&2 <<EOF3
BLOQUEADO (AP-133): ${npaths} rutas de test en una invocación es la suite en la práctica. Pushea y deja el gate al CI. En sesión corre solo los tests hermanos de los ficheros que tocaste (AP-124 (a)); los consumidores del símbolo (AP-124 (b)) los verifica el CI y se DECLARAN en el cierre (comando y número de ficheros), no se ejecutan.
EOF3
    exit 2
  fi
fi

# Permitido si trae rutas de fichero (test scoped) DESPUÉS del runner:
# extensión de fuente o ruta con «/» en la cola del comando.
if printf '%s' "$tail" | grep -Eq '\.[cm]?[jt]sx?([[:space:]]|$|"|'"'"')|[[:space:]][^-][^[:space:]]*/[^[:space:]]+'; then
  exit 0
fi

cat >&2 <<'EOF'
BLOQUEADO por disciplina de tests: estás lanzando la suite completa (o vitest sin rutas / en modo watch), que cuelga la sesión y pierde trabajo.
Ejecuta SOLO los ficheros afectados: `npx vitest run <ruta1> <ruta2>` (rutas explícitas). El gate de suite completa es el CI del PR, no tu sesión.
EOF
exit 2
