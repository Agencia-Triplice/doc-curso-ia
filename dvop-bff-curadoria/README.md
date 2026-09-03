# dvop-bff-curadoria

**BFF + frontend** para a fila de curadoria (revisão humana + worker de IA) do
[`dvop-srv-cache-writer` (MS 5)](../dvop-srv-cache-writer/README.md).

Serviço implementado em **Node 22 / NestJS** (porte fiel do BFF originalmente
em Python/FastAPI — mesmo contrato HTTP, mesmos endpoints, mesmo
comportamento de erros). Imagem de runtime `ubi10_custom/nodejs-22-minimal`.

> Até 2026-07-11 o serviço de origem se chamava `dvop-srv-review-queue` (MS 4),
> depois `dvop-srv-curadoria` (`ms7/`, Python — removido no cutover de
> 2026-07-15; histórico no git). Esta é a migração para Node/NestJS — mesmas
> rotas, mesma porta (8004).

Mostra os **casos escalados para humano sem solução conhecida** (os órfãos que
o MS 3 registra no MS 5 quando a busca não é grounded) e fecha o ciclo de
aprendizado do pipeline: o revisor analisa o caso (com o **contexto da
esteira** — workflow/job/step/exit + log redigido), revisa/edita a solução e
**aprova** — a solução é gravada no MS 5, que remove o órfão da fila e avisa o
MS 2 para recarregar o cache. Um **worker Agentix in-process** (grupo
`dvop-curador`) gera rascunhos de solução automaticamente antes da revisão
humana, já preenchendo o campo de solução; a aprovação humana continua sempre
obrigatória. Um cadastro de **elegibilidade a PR automático**
(vínculo fingerprint → remediação do MS 8, com preview obrigatório) fica
persistido em **SQLite** próprio do serviço (`data/elegibilidade.db`) — o
único estado local do bff-curadoria.

O frontend (`static/index.html`, vanilla JS) é servido pelo próprio BFF na
raiz (`/`), o que elimina CORS e um deploy extra. CORS não é habilitado de
propósito (o front é same-origin).

## API do BFF

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/` | Frontend (fila de curadoria) |
| `GET` | `/v1/fila` | Órfãos aguardando revisão (do MS 5) + flag de rascunho |
| `GET` | `/v1/fila/{fingerprint}` | Detalhe de um caso, incluindo o rascunho salvo |
| `PUT` | `/v1/fila/{fingerprint}/rascunho` | Salva/atualiza rascunho de solução (`{solucao, autor?}`) |
| `DELETE` | `/v1/fila/{fingerprint}/rascunho` | Remove o rascunho |
| `POST` | `/v1/fila/{fingerprint}/aprovar` | Grava a solução no MS 5 (corpo `{solucao?, autor?, publicar_base?}`; sem corpo usa o rascunho) |
| `POST` | `/v1/fila/{fingerprint}/descartar` | Remove o órfão da fila do MS 5 (falso positivo) |
| `GET` | `/v1/solucoes` | O que já está cadastrado no cache (MS 5), pass-through |
| `GET` | `/v1/documentos` | O que já está na base de conhecimento (MS 3), pass-through; 503 se MS 3 não configurado |
| `GET` | `/v1/remediacoes` | Catálogo do MS 8 (pass-through) para o preview de elegibilidade |
| `PUT` | `/v1/elegibilidade/{fingerprint}` | Marca elegível a PR (`{remediacao_id, autor?, preview_confirmado}`); 400 sem preview confirmado ou remediação não catalogada |
| `GET` | `/v1/elegibilidade/{fingerprint}` | Consulta o vínculo (404 sem vínculo) |
| `DELETE` | `/v1/elegibilidade/{fingerprint}` | Remove o vínculo |
| `GET` | `/v1/elegibilidade` | Lista os vínculos (`{itens, total}`) |
| `GET` | `/v1/credencial` | Estado da credencial de escrita do MS 8 (`presente`, `origem`, `login`); 503 sem MS 8 |
| `PUT` | `/v1/credencial` | Arma o PAT no MS 8 (`{token}`); 400 se o GitHub recusar. A resposta nunca devolve o token |
| `DELETE` | `/v1/credencial` | Desarma o PAT |
| `GET` | `/v1/info` | Contadores (fila, rascunhos, soluções, elegibilidade) e upstreams configurados |
| `GET` | `/health/live` · `/health/ready` | Probes (o estado da curadoria continua no MS 5; o único estado local é o SQLite de elegibilidade — `ready` pinga esse arquivo) |
| `GET` | `/metrics` | Métricas Prometheus (RED de HTTP + métricas de domínio) |

Notas de contrato herdadas do `ms7/` Python original: a busca de contexto no MS 3 **não envia o fingerprint** de
propósito (consulta de revisão não é nova ocorrência do erro); rascunhos
vivem no MS 5, não no bff-curadoria; a fila busca no máximo **500 órfãos** do
MS 5; a elegibilidade exige remediação catalogada no MS 8 **e** preview
confirmado (400 caso contrário).

## Curadoria automática (worker Agentix — MVP-2)

Com as envs `CURADORIA_BFF_AGENTIX_*` configuradas, um worker em background
(`CuradorWorker`) gera rascunho de solução para todo órfão sem rascunho: fila
do MS 5 → contexto do MS 3 (sem fingerprint) → `mutation Invoke` do group
`dvop-curador` → polling `GetSession` (3 s × 60) → rascunho no MS 5 (autor
"IA (Agentix)"). A aprovação humana continua obrigatória. Sem as envs, o
worker fica desligado (zero custo de LLM) — ver `agentixConfigurado()` em
`src/config/env.ts`.

## Rodando localmente

Pré-requisito: **Node 22** e o `dvop-srv-cache-writer` (MS 5) rodando (ex.:
porta 8002).

```bash
npm ci
npm run build          # nest build → dist/
npm start              # node dist/main.js
# desenvolvimento com watch: npm run start:dev
```

Abra `http://localhost:8004`.

### Testes

Suíte em **Jest** (unit + e2e, cobertura mínima 90% configurada no
`package.json`):

```bash
npm test
npm run test:cov
```

## Docker

```bash
docker build -f docker/Dockerfile -t dvop-bff-curadoria:0.1.0 .
docker compose up --build
# frontend em http://localhost:8004
```

O serviço usa um Dockerfile **multi-stage** (`docker/Dockerfile`): stage de
build na imagem `ubi10_custom/nodejs-22:daily-update` (`npm ci` → `npm run
build` → `npm prune --omit=dev`) e runtime na imagem mínima
`ubi10_custom/nodejs-22-minimal:daily-update` — só `node_modules`, `dist` e
`static` são copiados para o runtime, sem toolchain de build. Bases fixas do
Nexus interno (`nexusrepository.bradesco.com.br:8500`). O `docker-compose.yml`
deste diretório sobe só o `bff-curadoria` (aponte `CURADORIA_BFF_MS5_URL` e
demais envs comentadas para os containers do MS 5/MS 3/MS 8 quando subir a
stack completa). O volume nomeado `bff-curadoria-data` (montado em
`/opt/app-root/src/data`) preserva o `elegibilidade.db` entre recriações do
container. HEALTHCHECK Docker chama `GET /health/live` a cada 30s (timeout
3s, 3 tentativas).

## Deploy

> Deploy: os manifests k8s são geridos pela plataforma do Bradesco (fora
> deste repositório).

## Configuração (variáveis de ambiente)

Todas as chaves têm prefixo `CURADORIA_BFF_` e são lidas em
`src/config/env.ts` (`loadConfig()`); nenhuma é obrigatória em termos de
inicialização — todas têm default (vazio ou não) — mas `MS5_URL` é
necessária para a fila funcionar de fato.

| Variável | Default | Descrição |
|---|---|---|
| `CURADORIA_BFF_MS5_URL` | `http://localhost:8002` | Base URL do cache-writer (MS 5): fila de órfãos + gravação de soluções — obrigatório para a curadoria funcionar |
| `CURADORIA_BFF_MS3_URL` | *(vazio)* | Base URL do retrieval (MS 3); vazio desabilita o contexto do prompt e `/v1/documentos` |
| `CURADORIA_BFF_MS8_URL` | *(vazio)* | Base URL do catálogo de remediações (MS 8); vazio desabilita `/v1/remediacoes` e o cadastro de elegibilidade |
| `CURADORIA_BFF_ELEGIBILIDADE_DB_PATH` | `data/elegibilidade.db` | SQLite do vínculo erro→remediação (único estado local do bff-curadoria; no Docker/k8s, caminho no volume/PVC — ex. `/opt/app-root/src/data/elegibilidade.db`) |
| `CURADORIA_BFF_REQUEST_TIMEOUT` | `10` | Timeout (s) das chamadas aos upstreams |
| `CURADORIA_BFF_LOG_LEVEL` | `INFO` | Nível de log do serviço (JSON estruturado) |
| `CURADORIA_BFF_MAX_BODY_BYTES` | `2097152` | Teto do corpo cru da requisição em bytes; acima disso → `413` (2 MiB) |
| `CURADORIA_BFF_AGENTIX_URL` | *(vazio)* | URL completa do `/graphql/` da plataforma Agentix; vazio = worker curador desligado |
| `CURADORIA_BFF_AGENTIX_TOKEN` | *(vazio)* | Bearer estático (só para teste rápido — o access_token corporativo vive ~5 min; **nunca logado/commitado**) |
| `CURADORIA_BFF_AGENTIX_TOKEN_URL` | *(vazio)* | Endpoint de token do Keycloak; configurado, tem precedência sobre o token estático (grant `client_credentials`, renovação automática) |
| `CURADORIA_BFF_AGENTIX_CLIENT_ID` | *(vazio)* | Client id OIDC de integrador |
| `CURADORIA_BFF_AGENTIX_CLIENT_SECRET` | *(vazio)* | Client secret OIDC (**nunca logado/commitado**) |
| `CURADORIA_BFF_AGENTIX_TENANT_ID` | *(vazio)* | Header `x-lx-tenant` (credencial de serviço — **nunca chega ao navegador nem aos logs**) |
| `CURADORIA_BFF_AGENTIX_BUNDLE_NAME` | `dvop-agx-ssol-propor-solucao` | Bundle que contém o agente curador |
| `CURADORIA_BFF_AGENTIX_BUNDLE_VERSION` | *(vazio)* | Versão do bundle gerada pela esteira (ex.: `0.0.15`) |
| `CURADORIA_BFF_AGENTIX_ENTITY_ID` | *(vazio)* | Id do group `dvop-curador` no ambiente (confirmar na validação DEV) |
| `CURADORIA_BFF_AGENTIX_ENTITY_NAME` | `dvop-curador` | Nome da entidade invocada |
| `CURADORIA_BFF_AGENTIX_ENTITY_VERSION` | `1.0.0` | Versão da entidade invocada |
| `CURADORIA_BFF_AGENTIX_ENTITY_TYPE` | `GROUP` | Tipo da entidade invocada |
| `CURADORIA_BFF_CURADOR_INTERVALO` | `60` | Segundos entre ciclos do worker (backoff dobra até 600 quando o Agentix falha) |
| `CURADORIA_BFF_CURADOR_LOTE` | `2` | Máx. de órfãos processados por ciclo (protege cota do LiteLLM) |
| `CURADORIA_BFF_CURADOR_MAX_TENTATIVAS` | `3` | Teto de tentativas de LLM por órfão (contadas em memória; badge "IA falhou" na fila) |

Demo local do worker sem rede corporativa: `python tools/sim_agentix.py`
(raiz do repo) emula o `/graphql/` (Invoke, GetSession) e o endpoint de token
do Keycloak.

## Estrutura

```
src/
  main.ts               # createApp()/bootstrap(): body limit (413), static mount, listen(8004)
  app.module.ts          # wiring dos controllers/providers, ServeStaticModule
  config/env.ts           # loadConfig() — todas as chaves CURADORIA_BFF_*
  api/                    # controllers (health, fila/review, elegibilidade) + DTOs
  upstreams/              # clients HTTP dos MS 5/MS 3/MS 8
  agentix/                # AgentixService + AgentixTokenProvider (client_credentials)
  curador/                # CuradorWorker (loop in-process) — rascunho via AgentiX + persona/dossiês
  eligibility/            # EligibilityStore (SQLite via better-sqlite3)
  metrics/                # MetricsService/Controller (Prometheus)
  common/                 # interceptors, exception filter, body-limit middleware, json-logger
static/index.html        # frontend (vanilla JS), servido pelo próprio Nest
test/                     # Jest (unit + *.e2e-spec.ts), cobertura mínima 90%
docker/Dockerfile         # multi-stage: build (nodejs-22) → runtime (nodejs-22-minimal)
```

## Observabilidade

Métricas Prometheus em `GET /metrics` (RED de HTTP + métricas de domínio);
targets, queries de partida e a receita para ligar OpenTelemetry depois
estão em [docs/observabilidade.md](../docs/observabilidade.md).
