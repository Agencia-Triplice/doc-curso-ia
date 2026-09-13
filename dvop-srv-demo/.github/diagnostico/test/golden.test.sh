#!/usr/bin/env bash
# Testes golden/snapshot: renderiza cada fixture com render-summary.sh e compara
# byte-a-byte com o .md congelado em test/golden/. Pega regressões cosméticas
# que asserções de substring não pegam.
#
#   bash golden.test.sh          # compara (falha se divergir)
#   UPDATE=1 bash golden.test.sh # regrava os goldens (revise o diff no git!)
#
# MASCOTE_URL="" para o snapshot não depender de host externo.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="${here}/../render-summary.sh"
fx="${here}/fixtures"
gold="${here}/golden"
mkdir -p "$gold"
export MASCOTE_URL=""
export MASCOTE_BASE_URL=""
fail=0

# fixture  ->  (target, job_label) usados na renderização
render() { bash "$script" "https://github.com/o/r/actions/runs/1#step:3:1" "esteira / build" < "${fx}/$1"; }

for fxfile in cache-with-solucao cache-with-solucao-and-pr match-no-pr import-error cache-long-with-cmd; do
  golden="${gold}/${fxfile}.md"
  got="$(render "${fxfile}.json")"
  if [ "${UPDATE:-}" = "1" ]; then
    printf '%s\n' "$got" > "$golden"
    echo "atualizado: ${fxfile}.md"
    continue
  fi
  if [ ! -f "$golden" ]; then
    echo "FALTA golden [$fxfile]: rode 'UPDATE=1 bash golden.test.sh'"; fail=1; continue
  fi
  if ! diff -u "$golden" <(printf '%s\n' "$got") >/dev/null 2>&1; then
    echo "DIVERGIU [$fxfile]:"
    diff -u "$golden" <(printf '%s\n' "$got") | sed 's/^/    /'
    fail=1
  fi
done

if [ "${UPDATE:-}" = "1" ]; then echo "goldens regravados."; exit 0; fi
if [ "$fail" -eq 0 ]; then echo "OK: goldens conferem"; else echo "FALHAS acima (revise; se intencional, UPDATE=1)"; fi
exit "$fail"
