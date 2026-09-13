#!/usr/bin/env bash
# Publica (ou ATUALIZA) um comentário "sticky" no PR com o diagnóstico em
# markdown lido do stdin. Idempotente: um único comentário por PR, reescrito a
# cada run (identificado por um marcador HTML invisível). Best-effort: sai 0.
#   $1 = número do PR
# Requer: curl + jq + GH_TOKEN com permissão `pull-requests: write`.
set -uo pipefail
pr="${1:-}"
body="$(cat)"
[ -z "$pr" ] && exit 0
[ -z "${GH_TOKEN:-}" ] && exit 0
command -v curl >/dev/null 2>&1 || exit 0
command -v jq   >/dev/null 2>&1 || exit 0

MARKER="<!-- cockpit-diag -->"
api="${GITHUB_API_URL:-https://api.github.com}"
repo="${GITHUB_REPOSITORY:-}"
[ -z "$repo" ] && exit 0
body="${MARKER}
${body}"

# Procura um comentário nosso anterior (pelo marcador) para atualizar em vez de
# empilhar um novo a cada execução.
existing="$(curl -sS \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$api/repos/$repo/issues/$pr/comments?per_page=100" 2>/dev/null \
  | jq -r --arg m "$MARKER" '[.[] | select(.body // "" | contains($m))][0].id // empty' 2>/dev/null || true)"

payload="$(jq -nc --arg b "$body" '{body:$b}')"
if [ -n "$existing" ]; then
  curl -sS -X PATCH \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "$api/repos/$repo/issues/comments/$existing" \
    --data "$payload" >/dev/null 2>&1 || true
else
  curl -sS -X POST \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "$api/repos/$repo/issues/$pr/comments" \
    --data "$payload" >/dev/null 2>&1 || true
fi
exit 0
