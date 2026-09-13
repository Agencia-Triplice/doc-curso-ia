#!/usr/bin/env bash
# Lê a resposta JSON de POST /api/cockpit/analisar no stdin e emite markdown
# para o resumo do job / comentário de PR no stdout. Sempre sai 0 (best-effort).
#   $1 = URL do job/run analisado (só informativo)
#   $2 = rótulo do job falho (opcional; usado quando há vários jobs)
#
# Emite um marcador oculto `<!-- estado:conhecido|novo|indisponivel -->` na 1ª
# linha para o ci.yml decidir a label do PR.
#
# Rótulos são configuráveis por env (i18n / port): DIAG_* abaixo.
set -uo pipefail
target="${1:-}"
job_label="${2:-}"
json="$(cat)"
q() { printf '%s' "$json" | jq -r "$1" 2>/dev/null; }

# ---- Rótulos (override por env para outro idioma/repo) ----------------------
: "${DIAG_TITLE:=🔎 Diagnóstico automático da falha}"
: "${DIAG_TIP_KNOWN:=**Erro já conhecido** — solução disponível na base de curadoria.}"
: "${DIAG_WARN_NEW:=**Erro ainda não catalogado** — encaminhado à curadoria.}"
: "${DIAG_CAUTION:=**Não foi possível diagnosticar automaticamente.**}"
: "${DIAG_SOLUCAO_TITLE:=💡 Solução da curadoria}"
: "${DIAG_PR_TITLE:=🛠️ Remediação sugerida}"
: "${DIAG_CMD_TITLE:=Comando sugerido:}"
: "${DIAG_DETAILS_SUMMARY:=Ver erro completo}"
: "${DIAG_NEW_BODY:=Este erro ainda não está na base de erros conhecidos. A curadoria vai catalogá-lo e disponibilizar uma solução automática nas próximas execuções. 🚧}"
# Mascote do resumo. O proxy camo do GitHub só busca URLs públicas na internet —
# um cockpit interno `svc.cluster.local` NÃO serve; use o HOST público do cockpit
# (o mesmo do COCKPIT_WEB_URL), que serve os arquivos de `static/`.
#
# Dois modos, nesta ordem de precedência:
#   1) MASCOTE_URL     — URL única e fixa (imagem estática); vence tudo.
#   2) MASCOTE_BASE_URL — base pública do cockpit; o mascote é ANIMADO e escolhido
#      por estado: mascote-{conhecido,pr,novo,indisponivel}.webp (loop transparente).
# Ambos vazios ⇒ NÃO renderiza imagem. Sem default embutido (era repo pessoal, ruim
# p/ portar): o ci.yml deriva MASCOTE_BASE_URL do COCKPIT_WEB_URL.
MASCOTE_URL="${MASCOTE_URL:-}"
MASCOTE_BASE_URL="${MASCOTE_BASE_URL:-}"

# Escapa um valor para o "path" do shields.io: '-'->'--', '_'->'__', ' '->'%20'.
enc() { printf '%s' "$1" | sed -e 's/-/--/g; s/_/__/g; s/ /%20/g'; }
badge() {
  printf '![%s](https://img.shields.io/badge/%s-%s-%s?style=flat-square)' \
    "$1" "$(enc "$1")" "$(enc "$2")" "$3"
}
conf_color() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    *alta*|*high*)  printf '2ea44f' ;;  # verde
    *med*|*medium*) printf 'd29922' ;;  # âmbar
    *baix*|*low*)   printf 'cf222e' ;;  # vermelho
    *)              printf '6e7681' ;;  # cinza
  esac
}
# Limpa ruído estrutural da assinatura: colapsa "[ERROR] [ERROR]" e espaços.
clean_sig() {
  printf '%s' "$1" | sed -E 's/(\[ERROR\])([[:space:]]*\[ERROR\])+/\1/g; s/[[:space:]]+/ /g; s/^ //; s/ $//'
}

solucao_raw=""
render_solucao_body() {
  local body
  body="$(printf '%s' "$solucao_raw" | sed -E 's/[[:space:]]*-{2,}[[:space:]]*//g; s/Confiança:.*//')"
  printf '%s' "$body" \
    | sed -E 's/([0-9]+\.)[[:space:]]+/\n\1 /g' \
    | grep -vE '^[[:space:]]*$'
}
extract_cmds() {
  printf '%s' "$solucao_raw" \
    | grep -oE '`[^`]+`' \
    | sed -E 's/^`|`$//g' \
    | grep -iE '^(mvn|git|npm|pnpm|yarn|gradle|docker|kubectl|helm|make|az|gh|curl|sh|bash|\./) ' \
    || true
}

# --- Determina estado (para marcador + badge) --------------------------------
estado="indisponivel"
if [ "$(q 'if .trace.desfecho == null then "no" else "yes" end')" = "yes" ]; then
  if [ "$(q 'if (.trace.desfecho.solucao.solucao // "") != "" then "yes" else "no" end')" = "yes" ] \
     || [ "$(q 'if .acoes.pr_disponivel then "yes" else "no" end')" = "yes" ]; then
    estado="conhecido"
  else
    estado="novo"
  fi
fi
printf '<!-- estado:%s -->\n' "$estado"

# Resolve a URL do mascote. Se MASCOTE_URL não veio fixo, escolhe o clipe animado
# por estado a partir da base pública do cockpit. A variante "pr" é o sub-caso de
# `conhecido` com remediação de PR disponível.
if [ -z "$MASCOTE_URL" ] && [ -n "$MASCOTE_BASE_URL" ]; then
  variante="$estado"
  if [ "$estado" = "conhecido" ] \
     && [ "$(q 'if .acoes.pr_disponivel then "yes" else "no" end')" = "yes" ]; then
    variante="pr"
  fi
  base="${MASCOTE_BASE_URL%/}"
  case "$variante" in
    conhecido) MASCOTE_URL="${base}/mascote-conhecido.webp" ;;
    pr)        MASCOTE_URL="${base}/mascote-pr.webp" ;;
    novo)      MASCOTE_URL="${base}/mascote-novo.webp" ;;
    *)         MASCOTE_URL="${base}/mascote-indisponivel.webp" ;;
  esac
fi

[ -n "$MASCOTE_URL" ] && printf '<img src="%s" alt="AgentiX" width="120" align="right"/>\n\n' "$MASCOTE_URL"
printf '## %s\n\n' "$DIAG_TITLE"
[ -n "$job_label" ] && printf '<sub>Job: **%s**</sub>\n\n' "$job_label"

if [ "$estado" != "indisponivel" ]; then
  assinatura="$(clean_sig "$(q '.trace.desfecho.assinatura // "—"')")"
  fingerprint="$(q '.trace.desfecho.fingerprint // "—"')"
  servico="$(q '.trace.desfecho.servico // "—"')"
  tem_solucao="$(q 'if (.trace.desfecho.solucao.solucao // "") != "" then "yes" else "no" end')"
  tem_pr="$(q 'if .acoes.pr_disponivel then "yes" else "no" end')"
  conf=""
  if [ "$tem_solucao" = "yes" ]; then
    solucao_raw="$(q '.trace.desfecho.solucao.solucao')"
    conf="$(printf '%s' "$solucao_raw" | grep -oiE 'Confiança:[[:space:]]*[A-Za-zÀ-ÿ]+' | head -1 | sed -E 's/.*:[[:space:]]*//')"
  fi

  # Badges: status + confiança + serviço + fingerprint
  if [ "$estado" = "conhecido" ]; then badge "erro" "CONHECIDO" "2ea44f"; else badge "erro" "NOVO" "d29922"; fi
  printf ' '
  [ -n "$conf" ] && { badge "confianca" "$conf" "$(conf_color "$conf")"; printf ' '; }
  badge "servico" "$servico" "1f6feb"; printf ' '
  badge "fingerprint" "$fingerprint" "6e7681"
  printf '\n\n'

  # Admonition + assinatura curta; erro cru completo em <details>
  ass_curta="$(printf '%s' "$assinatura" | cut -c1-120)"
  [ "${#assinatura}" -gt 120 ] && ass_curta="${ass_curta}…"
  if [ "$estado" = "conhecido" ]; then
    printf '> [!TIP]\n> %s\n> Assinatura: `%s`\n\n' "$DIAG_TIP_KNOWN" "$ass_curta"
  else
    printf '> [!WARNING]\n> %s\n> Assinatura: `%s`\n\n' "$DIAG_WARN_NEW" "$ass_curta"
  fi
  if [ "${#assinatura}" -gt 120 ]; then
    printf '<details><summary>%s</summary>\n\n```text\n%s\n```\n\n</details>\n\n' "$DIAG_DETAILS_SUMMARY" "$assinatura"
  fi

  # Solução curada (lista) + comando copiável
  if [ "$tem_solucao" = "yes" ]; then
    autor="$(q '.trace.desfecho.solucao.autor // ""')"
    printf '### %s\n\n' "$DIAG_SOLUCAO_TITLE"
    render_solucao_body
    printf '\n'
    cmds="$(extract_cmds)"
    [ -n "$cmds" ] && printf '\n**%s**\n\n```bash\n%s\n```\n' "$DIAG_CMD_TITLE" "$cmds"
    printf '\n'
    [ -n "$autor" ] && printf '_por %s_\n\n' "$autor"
  fi

  # Remediação de PR
  if [ "$tem_pr" = "yes" ]; then
    titulo="$(q '.acoes.pr_disponivel.titulo // "Remediação disponível"')"
    instrucao="$(q '.acoes.pr_disponivel.instrucao // "—"')"
    printf '### %s\n\n**%s**\n\n%s\n\n' "$DIAG_PR_TITLE" "$titulo" "$instrucao"
  fi

  # Erro novo: sem cura
  [ "$estado" = "novo" ] && printf '%s\n\n' "$DIAG_NEW_BODY"
else
  msg="$(q '(.trace.passos[0].rotulo // "Diagnóstico") + ": " + (.trace.passos[0].valor // "indisponível")')"
  badge "diagnostico" "INDISPONIVEL" "cf222e"
  printf '\n\n> [!CAUTION]\n> %s\n> %s\n\n' "$DIAG_CAUTION" "$msg"
fi

[ -n "$target" ] && printf '<sub>Run analisado: %s</sub>\n' "$target"
exit 0
