#!/usr/bin/env bash
# Testa render-log.sh (saída para o LOG da action) por asserções de substring.
# NO_COLOR desliga ANSI para o texto casar limpo.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="${here}/../render-log.sh"
fx="${here}/fixtures"
export NO_COLOR=1
fail=0

assert_contains() { case "$1" in *"$2"*) : ;; *) echo "FALHOU [$3]: não achei '$2'"; fail=1 ;; esac; }
assert_absent()   { case "$1" in *"$2"*) echo "FALHOU [$3]: '$2' não deveria aparecer"; fail=1 ;; *) : ;; esac; }

# Só solução de texto -> "ERRO JÁ CONHECIDO"
out="$(bash "$script" 'https://github.com/o/r/actions/runs/1' < "${fx}/cache-with-solucao.json")"
assert_contains "$out" '::notice title=Diagnóstico'  'known-notice'
assert_contains "$out" 'ERRO JÁ CONHECIDO'           'known-banner'
assert_contains "$out" 'Ajuste a versão do projeto'  'known-solucao-texto'
assert_contains "$out" 'IA (Agentix)'                'known-autor'
assert_absent   "$out" 'NÃO CONHECIDO'               'known-nao-desconhecido'

# Solução + PR -> os dois blocos
out="$(bash "$script" 'https://github.com/o/r/actions/runs/5' < "${fx}/cache-with-solucao-and-pr.json")"
assert_contains "$out" 'ERRO JÁ CONHECIDO'           'combo-banner'
assert_contains "$out" 'Remediação de PR sugerida'   'combo-pr'
assert_contains "$out" 'Subir a versão do artefato'  'combo-pr-titulo'

# Só PR (sem solução de texto) -> conhecido
out="$(bash "$script" 'https://github.com/o/r/actions/runs/9' < "${fx}/match-with-pr.json")"
assert_contains "$out" 'ERRO JÁ CONHECIDO'           'pr-known-banner'
assert_contains "$out" 'Remediação de PR sugerida'   'pr-known-pr'

# Escalado (sem cura) -> "ERRO AINDA NÃO CONHECIDO" + mensagem padrão
out="$(bash "$script" 'https://github.com/o/r/actions/runs/2' < "${fx}/match-no-pr.json")"
assert_contains "$out" '::warning title=Diagnóstico'      'unknown-warning'
assert_contains "$out" 'ERRO AINDA NÃO CONHECIDO'         'unknown-banner'
assert_contains "$out" 'ainda não está na nossa base'     'unknown-msg'
assert_contains "$out" 'trabalhar para catalogá-lo'       'unknown-msg2'
assert_absent   "$out" 'ERRO JÁ CONHECIDO'                'unknown-nao-conhecido'

# Sem desfecho (erro de importação) -> "DIAGNÓSTICO INDISPONÍVEL"
out="$(bash "$script" 'https://github.com/o/r/actions/runs/3' < "${fx}/import-error.json")"
assert_contains "$out" 'DIAGNÓSTICO INDISPONÍVEL'    'nulo-banner'
assert_contains "$out" 'Erro na importação'          'nulo-passo'

if [ "$fail" -eq 0 ]; then echo "OK: todos os casos passaram"; else echo "FALHAS acima"; fi
exit "$fail"
