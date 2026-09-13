#!/usr/bin/env bash
# Cria um Check Run com o diagnóstico, para aparecer na aba de checks do commit/PR
# (além do resumo e do comentário). Corpo (markdown) lido do stdin. Best-effort.
#   $1 = conclusion (neutral|success|failure)  — default neutral
#   $2 = título do check                        — default "Diagnóstico automático"
# Env: GH_TOKEN (checks: write), GITHUB_REPOSITORY, CHECK_SHA (head sha do commit).
set -uo pipefail
conclusion="${1:-neutral}"
title="${2:-Diagnóstico automático}"
summary="$(cat)"
[ -z "${GH_TOKEN:-}" ] && exit 0
[ -z "${CHECK_SHA:-}" ] && exit 0
command -v curl >/dev/null 2>&1 || exit 0
command -v jq   >/dev/null 2>&1 || exit 0
api="${GITHUB_API_URL:-https://api.github.com}"
repo="${GITHUB_REPOSITORY:-}"
[ -z "$repo" ] && exit 0

# O summary do check tem limite ~65535 chars; corta com folga.
summary="$(printf '%s' "$summary" | cut -c1-60000)"
payload="$(jq -nc \
  --arg name "diagnostico-automatico" \
  --arg sha "$CHECK_SHA" \
  --arg concl "$conclusion" \
  --arg title "$title" \
  --arg summary "$summary" \
  '{name:$name, head_sha:$sha, status:"completed", conclusion:$concl,
    output:{title:$title, summary:$summary}}')"

curl -sS -X POST \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$api/repos/$repo/check-runs" \
  --data "$payload" >/dev/null 2>&1 || true
exit 0
