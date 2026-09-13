#!/usr/bin/env bash
# Testa render-summary.sh contra as fixtures por asserções de substring.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="${here}/../render-summary.sh"
fx="${here}/fixtures"
web="https://cockpit.example/#/caso/"
fail=0

assert_contains() { case "$1" in *"$2"*) : ;; *) echo "FALHOU [$3]: não achei '$2'"; fail=1 ;; esac; }
assert_absent()   { case "$1" in *"$2"*) echo "FALHOU [$3]: '$2' não deveria aparecer"; fail=1 ;; *) : ;; esac; }

out="$(bash "$script" 'https://github.com/o/r/actions/runs/1/job/9' "" < "${fx}/match-with-pr.json")"
assert_contains "$out" 'Diagnóstico automático da falha' 'header'
assert_contains "$out" 'blob upload invalid'             'assinatura'
assert_contains "$out" 'Remediação sugerida'             'bloco-pr'
assert_contains "$out" 'Subir a versão do artefato'      'titulo'
assert_contains "$out" 'img.shields.io/badge'            'badge-shields'
assert_contains "$out" '[!TIP]'                          'admonition-tip'
assert_contains "$out" 'Erro já conhecido'               'estado-conhecido'
assert_absent   "$out" 'cockpit.example'                 'sem-link-cockpit'
assert_absent   "$out" 'meucardapioqrcode'               'sem-link-cockpit-prod'

out="$(bash "$script" 'https://github.com/o/r/actions/runs/2' "" < "${fx}/match-no-pr.json")"
assert_contains "$out" 'erro-NOVO'                  'badge-novo'
assert_contains "$out" '[!WARNING]'                 'admonition-warning'
assert_contains "$out" 'Erro ainda não catalogado' 'estado-novo'
assert_contains "$out" 'ainda não está na base'    'texto-novo'
assert_absent   "$out" 'Remediação sugerida'        'sem-bloco-pr'

out="$(bash "$script" 'https://github.com/o/r/actions/runs/4' "" < "${fx}/cache-with-solucao.json")"
assert_contains "$out" 'Solução da curadoria'         'bloco-solucao'
assert_contains "$out" 'Ajuste a versão do projeto'   'texto-solucao'
assert_contains "$out" 'IA (Agentix)'                 'autor-solucao'
assert_contains "$out" 'badge/confianca-'             'badge-confianca'
assert_absent   "$out" 'cockpit.example'              'sem-link-caso'
assert_absent   "$out" 'Sem remediação conhecida'     'com-solucao-nao-sem'
assert_absent   "$out" 'Remediação sugerida'          'solucao-sem-bloco-pr'

out="$(bash "$script" 'https://github.com/o/r/actions/runs/5' "" < "${fx}/cache-with-solucao-and-pr.json")"
assert_contains "$out" 'Solução da curadoria'   'combo-solucao'
assert_contains "$out" 'Remediação sugerida'    'combo-pr'
assert_contains "$out" 'Subir a versão do artefato' 'combo-pr-titulo'
assert_absent   "$out" 'cockpit.example'        'combo-sem-link'
assert_absent   "$out" 'Sem remediação conhecida' 'combo-nao-sem'

out="$(bash "$script" 'https://github.com/o/r/actions/runs/3' "" < "${fx}/import-error.json")"
assert_contains "$out" 'Erro na importação'      'erro-rotulo'
assert_contains "$out" '404: run não encontrado' 'erro-valor'
assert_contains "$out" '[!CAUTION]'              'admonition-caution'
assert_contains "$out" 'INDISPONIVEL'            'badge-indisponivel'

out="$(bash "$script" 'https://github.com/o/r/actions/runs/6' "" < "${fx}/cache-long-with-cmd.json")"
assert_contains "$out" 'Ver erro completo'                  'details-assinatura'
assert_contains "$out" '…'                                  'assinatura-truncada'
assert_contains "$out" 'mvn versions:set -DnewVersion=1.0.1' 'comando-copiavel'
assert_contains "$out" '```bash'                            'bloco-bash'
assert_contains "$out" 'badge/confianca-alta-2ea44f'        'confianca-alta-verde'

if [ "$fail" -eq 0 ]; then echo "OK: todos os casos passaram"; else echo "FALHAS acima"; fi
exit "$fail"
