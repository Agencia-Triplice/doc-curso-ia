#!/usr/bin/env bash
# Testa heuristic-diagnose.sh no modo degradado (sem token -> só o cabeçalho
# com marcador de estado, sem chamar a API). Não exercita a busca de log real.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="${here}/../heuristic-diagnose.sh"
fail=0
assert_contains() { case "$1" in *"$2"*) : ;; *) echo "FALHOU [$3]: não achei '$2'"; fail=1 ;; esac; }

# Sem GH_TOKEN: caminho degradado, marcador indisponivel, admonition CAUTION.
out="$(env -u GH_TOKEN bash "$script" 'https://github.com/o/r/actions/runs/1/job/9#step:2:1' 'esteira / build')"
assert_contains "$out" '<!-- estado:indisponivel -->' 'marker'
assert_contains "$out" '[!CAUTION]'                    'caution'
assert_contains "$out" 'Cockpit indisponível'          'msg'
assert_contains "$out" 'Job: **esteira / build**'      'job-label'
assert_contains "$out" '#step:2:1'                     'deep-link'

if [ "$fail" -eq 0 ]; then echo "OK: heurística passou"; else echo "FALHAS acima"; fi
exit "$fail"
