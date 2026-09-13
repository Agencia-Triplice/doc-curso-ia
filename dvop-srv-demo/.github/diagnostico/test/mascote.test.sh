#!/usr/bin/env bash
# Testa a escolha do mascote ANIMADO por estado no render-summary.sh.
# Com MASCOTE_BASE_URL setado, cada estado deve apontar para o .webp correto;
# uma MASCOTE_URL fixa vence a seleção por estado.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="${here}/../render-summary.sh"
fx="${here}/fixtures"
base="https://cockpit.example.test"
fail=0

assert_contains() { case "$1" in *"$2"*) : ;; *) echo "FALHOU [$3]: não achei '$2'"; fail=1 ;; esac; }
assert_absent()   { case "$1" in *"$2"*) echo "FALHOU [$3]: '$2' não deveria aparecer"; fail=1 ;; *) : ;; esac; }

run() { MASCOTE_URL="" MASCOTE_BASE_URL="$base" bash "$script" "$1" "" < "${fx}/$2"; }

# conhecido com solução, sem PR -> mascote-conhecido.webp
out="$(run 'https://github.com/o/r/actions/runs/4' cache-with-solucao.json)"
assert_contains "$out" "${base}/mascote-conhecido.webp" 'conhecido'
assert_absent   "$out" 'mascote-pr.webp'                'conhecido-nao-pr'

# conhecido + PR disponível -> mascote-pr.webp
out="$(run 'https://github.com/o/r/actions/runs/1/job/9' match-with-pr.json)"
assert_contains "$out" "${base}/mascote-pr.webp"        'pr'

# erro novo -> mascote-novo.webp
out="$(run 'https://github.com/o/r/actions/runs/2' match-no-pr.json)"
assert_contains "$out" "${base}/mascote-novo.webp"      'novo'

# diagnóstico indisponível -> mascote-indisponivel.webp
out="$(run 'https://github.com/o/r/actions/runs/3' import-error.json)"
assert_contains "$out" "${base}/mascote-indisponivel.webp" 'indisponivel'

# MASCOTE_URL fixa vence a seleção por estado
out="$(MASCOTE_URL='https://x/fixa.png' MASCOTE_BASE_URL="$base" bash "$script" 'https://github.com/o/r/actions/runs/2' "" < "${fx}/match-no-pr.json")"
assert_contains "$out" 'https://x/fixa.png' 'url-fixa-vence'
assert_absent   "$out" 'mascote-novo.webp'  'url-fixa-sem-webp'

# base ausente -> sem imagem
out="$(MASCOTE_URL="" MASCOTE_BASE_URL="" bash "$script" 'https://github.com/o/r/actions/runs/2' "" < "${fx}/match-no-pr.json")"
assert_absent   "$out" '<img'          'sem-base-sem-img'
assert_absent   "$out" 'mascote-'      'sem-base-sem-webp'

if [ "$fail" -eq 0 ]; then echo "OK: mascote por estado passou"; else echo "FALHAS acima"; fi
exit "$fail"
