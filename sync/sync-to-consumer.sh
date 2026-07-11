#!/usr/bin/env bash
# sync-to-consumer.sh — abre un PR de sincronización de vendored/ en un consumidor.
# Uso: ./sync-to-consumer.sh <owner/repo-consumidor> <rama-base>
# Requiere: gh autenticado con un token con Contents+PR RW en el consumidor.
# Ejecución HUMANA (capa 1 = human-execute); el PR resultante lo mergea el humano.
set -euo pipefail
CONSUMER="$1"; BASE="$2"
TAG=$(git -C "$(dirname "$0")/.." describe --tags --always)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
gh repo clone "$CONSUMER" "$TMP/c" -- -q --branch "$BASE" --depth 1
BR="chore/sync-agent-pipeline-$TAG"
git -C "$TMP/c" checkout -qb "$BR"
SRC="$(cd "$(dirname "$0")/../vendored" && pwd)"
# Mapa de destinos
cp "$SRC"/claude/hooks/*.sh          "$TMP/c/.claude/hooks/"
cp "$SRC"/claude/agents/*.md         "$TMP/c/.claude/agents/"
cp "$SRC"/claude/settings.json       "$TMP/c/.claude/settings.json"
for f in "$SRC"/docs-agents/*.md; do cp "$f" "$TMP/c/docs/agents/$(basename "$f")"; done
cp "$SRC"/scripts/adr-lint.mjs       "$TMP/c/scripts/adr-lint.mjs"
mkdir -p "$TMP/c/.claude/skills"
for f in "$SRC"/skills/*-SKILL.md; do
  n=$(basename "$f" -SKILL.md); mkdir -p "$TMP/c/.claude/skills/$n"
  cp "$f" "$TMP/c/.claude/skills/$n/SKILL.md"
done
# Actualizar marcador de versión en cabeceras
find "$TMP/c" -name '*.md' -newer "$TMP" -exec sed -i "s|agent-pipeline@v[0-9A-Za-z.\-]*|agent-pipeline@$TAG|" {} +
git -C "$TMP/c" add -A
git -C "$TMP/c" diff --cached --quiet && { echo "Sin cambios."; exit 0; }
git -C "$TMP/c" commit -qm "chore(sync): vendored agent-pipeline@$TAG"
git -C "$TMP/c" push -qu origin "$BR"
gh pr create -R "$CONSUMER" -B "$BASE" -H "$BR" \
  --title "chore(sync): vendored agent-pipeline@$TAG" \
  --body "Sincronización de ficheros vendorizados desde agent-pipeline@$TAG. Revisar el diff; ficheros con marcador DO-NOT-EDIT-locally. NO contiene menciones de arm."
