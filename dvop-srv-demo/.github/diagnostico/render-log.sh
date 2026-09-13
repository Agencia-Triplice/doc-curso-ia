#!/usr/bin/env bash
# Lê a resposta JSON de POST /api/cockpit/analisar no stdin e escreve no LOG da
# action (stdout) um relatório CHAMATIVO: banner de texto (figlet ansi_shadow) +
# solução formatada + anotações nativas do GitHub Actions. SEM links do
# cockpit (uso interno). Sempre sai 0 (best-effort).
#   $1 = URL do job/run analisado (opcional, só informativo)
set -uo pipefail
target="${1:-}"
json="$(cat)"
q() { printf '%s' "$json" | jq -r "$1" 2>/dev/null; }

# ---- Rótulos (override por env para outro idioma/repo) ----------------------
# Os banners de texto (banner-*.txt) são arte pré-renderizada por pyfiglet —
# para outro idioma, regere os .txt (ver DIAGNOSTICO-AUTOMATICO.md).
: "${DIAG_LOG_TITLE:=Diagnóstico automático}"
: "${DIAG_LOG_KNOWN:=✅  ERRO JÁ CONHECIDO — solução disponível na base.}"
: "${DIAG_LOG_NEW:=🆕  ERRO AINDA NÃO CONHECIDO — encaminhado à curadoria.}"
: "${DIAG_LOG_UNAVAIL:=⚠️  DIAGNÓSTICO INDISPONÍVEL}"
: "${DIAG_LOG_SERVICO:=Serviço:}"
: "${DIAG_LOG_FINGERPRINT:=Fingerprint:}"
: "${DIAG_LOG_ASSINATURA:=Assinatura:}"
: "${DIAG_LOG_SOLUCAO:=Solução}"
: "${DIAG_LOG_PR:=🛠️  Remediação de PR sugerida:}"
: "${DIAG_LOG_CONF:=Confiança:}"
: "${DIAG_LOG_FONTES:=Fontes:}"
: "${DIAG_LOG_RUN:=Run analisado:}"
: "${DIAG_LOG_NEW_BODY:=Este erro ainda não está na nossa base de erros conhecidos. Nossa equipe vai trabalhar para catalogá-lo e disponibilizar uma solução automática nas próximas execuções. 🚧}"

# Cores ANSI (o log do GitHub Actions renderiza). Respeita NO_COLOR.
if [ -n "${NO_COLOR:-}" ]; then G=""; Y=""; R=""; B=""; D=""; O=""; CY=""; W=""; K=""; Z="";
else G=$'\033[1;32m'; Y=$'\033[1;33m'; R=$'\033[1;31m'; B=$'\033[1m'; D=$'\033[2m'; O=$'\033[38;5;208m'; CY=$'\033[1;36m'; W=$'\033[1;37m'; K=$'\033[1;30m'; Z=$'\033[0m'; fi

# Diretório do próprio script (para achar os banners pré-renderizados).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- Banner (fonte figlet ansi_shadow pré-renderizada) ---------------------
# Rótulos fixos; a arte vive em banner-*.txt (gerada offline por pyfiglet). Cada
# linha sai colorida e indentada.  $1 = cor ANSI   $2 = arquivo do banner
banner() {
  local color="$1" file="$SCRIPT_DIR/$2" ln
  [ -f "$file" ] || return 0
  while IFS= read -r ln; do printf '   %s%s%s\n' "$color$B" "$ln" "$Z"; done < "$file"
}

# Limpa ruído estrutural: colapsa "[ERROR] [ERROR]" repetido e espaços.
clean_sig() {
  printf '%s' "$1" | tr '\n' ' ' | sed -E 's/(\[ERROR\])([[:space:]]*\[ERROR\])+/\1/g; s/[[:space:]]+/ /g; s/^ //; s/ $//'
}

campos() {
  printf '   %s%s%s %s\n' "$B" "$DIAG_LOG_SERVICO" "$Z" "$servico"
  printf '   %s%s%s %s\n' "$B" "$DIAG_LOG_FINGERPRINT" "$Z" "$fingerprint"
  printf '   %s%s%s  %s\n' "$B" "$DIAG_LOG_ASSINATURA" "$Z" "$(clean_sig "$assinatura" | cut -c1-140)"
}

# Formata o texto da solução: um passo numerado por linha (com recuo pendurado
# nas quebras) e o rodapé "Confiança/Fontes" destacado em cinza.
render_solucao() {
  local raw="$1" body meta conf font
  meta="$(printf '%s' "$raw" | grep -oE 'Confiança:.*' | head -1)"
  body="$(printf '%s' "$raw" | sed -E 's/[[:space:]]*-{2,}[[:space:]]*//g; s/Confiança:.*//')"
  printf '%s' "$body" \
    | sed -E 's/([0-9]+\.)[[:space:]]+/\n\1 /g' \
    | grep -vE '^[[:space:]]*$' \
    | while IFS= read -r item; do
        printf '%s' "$item" | fold -s -w 78 \
          | awk 'NR==1{printf "     %s\n",$0; next}{printf "        %s\n",$0}'
      done
  if [ -n "$meta" ]; then
    conf="$(printf '%s' "$meta" | sed -E 's/.*Confiança:[[:space:]]*//; s/Fontes:.*//' | sed -E 's/[^[:alnum:]]+$//')"
    if printf '%s' "$meta" | grep -q 'Fontes:'; then
      font="$(printf '%s' "$meta" | sed -E 's/.*Fontes:[[:space:]]*//' | tr '\n' ' ' | cut -c1-96)"
      # Descarta quando "Fontes" na verdade capturou dump de erro (ruído).
      printf '%s' "$font" | grep -qiE '\[ERROR\]|Failed to execute|Exception' && font=""
    else
      font=""
    fi
    printf '     %s┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈%s\n' "$D" "$Z"
    [ -n "$conf" ] && printf '     %s%s%s %s%s\n' "$D$B" "$DIAG_LOG_CONF" "$Z$D" "$conf" "$Z"
    [ -n "$font" ] && printf '     %s%s%s    %s%s\n' "$D$B" "$DIAG_LOG_FONTES" "$Z$D" "$font" "$Z"
  fi
}

servico="$(q '.trace.desfecho.servico // "—"')"
fingerprint="$(q '.trace.desfecho.fingerprint // "—"')"
assinatura="$(q '.trace.desfecho.assinatura // (.trace.passos[]? | select(.chave=="assinatura") | .valor) // "—"')"

has_desfecho="$(q 'if .trace.desfecho == null then "no" else "yes" end')"
tem_solucao="$(q 'if (.trace.desfecho.solucao.solucao // "") != "" then "yes" else "no" end')"
tem_pr="$(q 'if .acoes.pr_disponivel then "yes" else "no" end')"

echo
if [ "$has_desfecho" = "yes" ] && { [ "$tem_solucao" = "yes" ] || [ "$tem_pr" = "yes" ]; }; then
  printf '::notice title=%s::%s (fingerprint %s)\n' "$DIAG_LOG_TITLE" "$DIAG_LOG_KNOWN" "$fingerprint"
  banner "$G" "banner-conhecido.txt"
  printf '   %s%s%s\n\n' "$G$B" "$DIAG_LOG_KNOWN" "$Z"
  campos
  echo
  if [ "$tem_solucao" = "yes" ]; then
    autor="$(q '.trace.desfecho.solucao.autor // "curadoria"')"
    printf '   %s💡 %s (por %s)%s\n' "$B" "$DIAG_LOG_SOLUCAO" "$autor" "$Z"
    printf '   %s──────────────────────────────────────────────────────────%s\n' "$D" "$Z"
    render_solucao "$(q '.trace.desfecho.solucao.solucao')"
    echo
  fi
  if [ "$tem_pr" = "yes" ]; then
    titulo="$(q '.acoes.pr_disponivel.titulo // "Remediação disponível"')"
    instrucao="$(q '.acoes.pr_disponivel.instrucao // "—"')"
    printf '   %s%s%s %s\n' "$B" "$DIAG_LOG_PR" "$Z" "$titulo"
    printf '     %s\n' "$instrucao"
    echo
  fi
elif [ "$has_desfecho" = "yes" ]; then
  printf '::warning title=%s::%s (fingerprint %s)\n' "$DIAG_LOG_TITLE" "$DIAG_LOG_NEW" "$fingerprint"
  banner "$Y" "banner-novo.txt"
  printf '   %s%s%s\n\n' "$Y$B" "$DIAG_LOG_NEW" "$Z"
  campos
  echo
  printf '%s' "$DIAG_LOG_NEW_BODY" | fold -s -w 72 | while IFS= read -r ln || [ -n "$ln" ]; do printf '   %s\n' "$ln"; done
  echo
else
  msg="$(q '(.trace.passos[0].rotulo // "Diagnóstico") + ": " + (.trace.passos[0].valor // "indisponível")')"
  printf '::warning title=%s::%s\n' "$DIAG_LOG_TITLE" "$DIAG_LOG_UNAVAIL"
  banner "$R" "banner-erro.txt"
  printf '   %s%s%s\n\n' "$R$B" "$DIAG_LOG_UNAVAIL" "$Z"
  printf '   %s\n' "$msg"
  echo
fi
[ -n "$target" ] && printf '%s   %s %s%s\n' "$D" "$DIAG_LOG_RUN" "$target" "$Z"
exit 0
