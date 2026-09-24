# Relatório — Fase 1: curadoria local (WSL) apontada ao MS3-Postgres

**Data:** 2026-09-10
**Objetivo:** rodar o serviço substituto do MS3 (`retrieval-bdc/server.py`, Postgres/`dvop`)
e a curadoria-BFF (NestJS) lado a lado em WSL, provar que as 110 curas aparecem
na BASE da curadoria, e provar que editar/excluir pela curadoria reflete no
Postgres.

## O que roda

Três peças, todas em WSL (Ubuntu), usuário `tiago`:

1. **MS3-replacement** (`microservices/retrieval-bdc/server.py`) — porta **8003**,
   DSN default apontando para o Postgres `dvop` (schema `retrieval`).
2. **curadoria-BFF** (`microservices/dvop-bff-curadoria`, NestJS) — porta **8004**.
3. **MS5 NÃO está rodando** — e não foi necessário nenhum stub. O boot da curadoria
   não depende do MS5 (só as rotas de fila/`/v1/info` falham em runtime, 502).

## Como subir os 3 processos

```bash
# 1) Node 22 via nvm (já estava instalado em ~/.nvm — v22.23.1)
node -v   # v22.23.1

# 2) MS3-replacement (dvop, porta 8003) — NÃO sobrescrever RETRIEVAL_PG_DSN
cd microservices/retrieval-bdc
RETRIEVAL_PORT=8003 .venv-wsl/bin/python server.py &

# 3) curadoria-BFF (build + subir, porta 8004)
cd ../dvop-bff-curadoria
npm ci            # native build (better-sqlite3) em Linux — sem ERR_DLOPEN
npm run build      # nest build -> dist/
CURADORIA_BFF_MS3_URL=http://localhost:8003 \
CURADORIA_BFF_MS5_URL=http://localhost:8002 \
CURADORIA_BFF_AUTH_DEV_USER=tiago \
CURADORIA_BFF_SESSION_SECRET=dev-secret \
NODE_ENV=development \
node dist/main.js &
```

Com `NODE_ENV=development` e `CURADORIA_BFF_AUTH_DEV_USER=tiago`, o `AuthGuard`
autentica automaticamente (sem cookie) como o usuário dev — dá para curlar as
rotas `/v1/*` direto, sem sessão.

## Validado

- **`npm ci` / `npm run build`**: sem `ERR_DLOPEN` — `better-sqlite3` compilou
  nativo para Linux (`node_modules/better-sqlite3/build/Release/better_sqlite3.node`
  presente). Nenhum toolchain extra precisou ser instalado (`build-essential`/`python3`
  já estavam disponíveis na imagem WSL).
- **Boot sem MS5**: a curadoria sobe e escuta 8004 mesmo com o MS5 (8002) fora do ar.
  O único efeito é a rota `GET /v1/info` (e a fila) responderem 502:
  `{"detail":"não foi possível conectar ao cache-writer (MS 5) em http://localhost:8002/v1/info"}`.
  Isso é esperado (comentário no próprio `ReviewController`: fila/info dependem do MS5;
  base/busca/aprovação dependem só do MS3). **Nenhum `ms5_stub.py` foi necessário.**
- **As 110 curas na BASE, via rota real da curadoria** (não direto no MS3):

  ```
  curl -sw '\nHTTP:%{http_code}\n' 'http://127.0.0.1:8004/v1/documentos?limit=200'
  ```
  → `HTTP 200`, envelope `{"documentos":[...131 itens...], "total":131}`.
  Contagem por `origem_fingerprint` (marca das curas publicadas pela curadoria):
  **110 documentos com `origem_fingerprint` preenchido** (os outros 21 são
  how-tos/Confluence, sem fingerprint). Amostra do doc `id=131`:
  `titulo: "GDD-Core/dvop-bff-log-view: ERRO no Scan de imagem [ACS]..."`, com
  `origem_fingerprint` presente.

  Confirmação adicional direto no MS3 (mesma fonte, sem passar pela curadoria):
  `curl http://localhost:8003/v1/documents?limit=3` → mesmo `id=131` no topo,
  prova que a curadoria está de fato fazendo pass-through do MS3 e não de outra
  base.

- **Editar e excluir pela curadoria refletem no Postgres** — verificado com um
  documento descartável e autolimpo (`__temp_crud_test__`, id 132), sem tocar os
  110 curas reais nem o total de 131:
  1. Criado direto no MS3 (`POST http://localhost:8003/v1/documents`) → `201`,
     `total_corpus: 132`.
  2. **Editado através da curadoria** (`PUT http://localhost:8004/v1/documentos/132`,
     `titulo`/`conteudo` novos) → `200`; confirmado persistido no Postgres via
     MS3-direto (`GET http://localhost:8003/v1/documents/132`) com os novos
     valores.
  3. **Excluído através da curadoria** (`DELETE http://localhost:8004/v1/documentos/132`)
     → `204`; confirmado sumido do Postgres (`GET .../documents/132` → `404`) e o
     total de volta a **131** por três rotas independentes (`MS3 /v1/info`,
     `curadoria /v1/documentos`, `select count(*)` no Postgres) — `110` curas
     reais intocadas o tempo todo.

  Rotas confirmadas em `base-records.controller.ts`: `PUT /v1/documentos/:id` e
  `DELETE /v1/documentos/:id`, ambas dependentes só do MS3, sem MS5. Evidência
  completa (todas as respostas curl) em `task-6-report.md`.

- **Bancos protegidos intactos** (`psql -U dvop -d dvop -c "\l"`):

  | banco | owner | status |
  |---|---|---|
  | `dvop` | dvop | ativo — 131 documentos / 283 chunks / 110 curas (`retrieval.documentos`) |
  | `dvop_test` | dvop | presente, intocado (throwaway de teste) |
  | `retrieval_bdc` | retrieval | **intacto — 131 documentos** (fonte original, cópia confirmada) |
  | `english_learning` | english | presente, intocado |
  | `english_learning_test` | english | presente, intocado |

## Próximo passo (Fase 2)

Subir o **cache-writer/query (MS5-replacement)** real (não o stub — que nem chegou
a ser necessário aqui) para destravar a fila de curadoria (`GET /v1/fila`,
`/v1/info`, aprovação → grava em `cache_solucoes` + publica na base) e testar o
fluxo completo órfão → rascunho → aprovação → publicação no MS3, com o Postgres
`dvop` como fonte única de verdade tanto para o cache quanto para a base de
conhecimento.
