#!/usr/bin/env bash
# Modo degradado: quando o cockpit não responde, baixa o log do job falho pela
# API do GitHub e faz um palpite heurístico (grep de padrões comuns) para não
# deixar o resumo vazio. Emite markdown no stdout, no MESMO formato do
# render-summary (marcador de estado + admonition). Sempre sai 0 (best-effort).
#   $1 = URL do job falho (com /job/<id>)   $2 = rótulo do job (opcional)
# Env: GH_TOKEN (actions: read), GITHUB_API_URL, GITHUB_REPOSITORY.
set -uo pipefail
target="${1:-}"
job_label="${2:-}"
: "${DIAG_TITLE:=🔎 Diagnóstico automático da falha}"
api="${GITHUB_API_URL:-https://api.github.com}"
repo="${GITHUB_REPOSITORY:-}"

emit_header() {
  printf '<!-- estado:indisponivel -->\n'
  printf '## %s\n\n' "$DIAG_TITLE"
  [ -n "$job_label" ] && printf '<sub>Job: **%s**</sub>\n\n' "$job_label"
  printf '![diagnostico](https://img.shields.io/badge/diagnostico-HEUR%%C3%%8DSTICO-d29922?style=flat-square)\n\n'
}

# Sem token/deps/URL: só o cabeçalho degradado.
if [ -z "${GH_TOKEN:-}" ] || [ -z "$repo" ] || ! command -v curl >/dev/null 2>&1 \
   || ! printf '%s' "$target" | grep -q '/job/'; then
  emit_header
  printf '> [!CAUTION]\n> **Cockpit indisponível** e não foi possível baixar o log para análise heurística.\n\n'
  [ -n "$target" ] && printf '<sub>Run analisado: %s</sub>\n' "$target"
  exit 0
fi

job_id="$(printf '%s' "$target" | sed -E 's#.*/job/([0-9]+).*#\1#')"
log="$(curl -sSL \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$api/repos/$repo/actions/jobs/$job_id/logs" 2>/dev/null || true)"

emit_header

# Padrões comuns, do mais específico ao mais genérico. Primeira linha que casar
# vira a "assinatura heurística".
sig=""
if [ -n "$log" ]; then
  sig="$(printf '%s' "$log" | grep -m1 -iE \
    'does not allow (updating|redeploy)|blob upload invalid|version .* already exists|COMPILATION ERROR|cannot find symbol|BUILD FAILURE|Could not resolve dependencies|Connection refused|No space left on device|OutOfMemoryError|npm ERR!|error TS[0-9]+|\[ERROR\]|Exception in thread|FAILED|permission denied' \
    2>/dev/null | sed -E 's/^[0-9-]+T[0-9:.]+Z[[:space:]]*//; s/[[:space:]]+/ /g' | cut -c1-160 || true)"
fi

printf '> [!CAUTION]\n> **Cockpit indisponível** — diagnóstico heurístico a partir do log do job.\n'
if [ -n "$sig" ]; then
  printf '> Sinal encontrado: `%s`\n\n' "$sig"
else
  printf '> Nenhum padrão de erro conhecido foi encontrado no log.\n\n'
fi
printf '_Este é um palpite automático sem consultar a base de curadoria; confirme na esteira._\n\n'
[ -n "$target" ] && printf '<sub>Run analisado: %s</sub>\n' "$target"
exit 0
