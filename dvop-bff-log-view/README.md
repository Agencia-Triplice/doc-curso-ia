# dvop-bff-log-view

**BFF + frontend** para consulta de logs do [`dvop-srv-log-process`](../dvop-srv-log-process/README.md).

Serviço implementado em **Node 22 / NestJS** (porta corporativa fiel do BFF
originalmente em Python/FastAPI — mesmo contrato HTTP, mesmos endpoints,
mesmo comportamento de erros). Imagem de runtime `ubi10_custom/nodejs-22-minimal`.

Fluxo: no frontend você informa o **link** do serviço de logs → o frontend chama o
BFF (`GET /api/logs?src=<link>&...`) → o BFF valida o link, chama `<link>/v1/logs`
no srv e devolve o resultado → o frontend exibe os logs no campo de resultado
(com destaque por nível e a resposta JSON bruta disponível).

```
[ browser ]  →  GET /api/logs?src=<link>  →  [ dvop-bff-log-view :8080 ]  →  GET <link>/v1/logs  →  [ dvop-srv-log-process :8000 ]
```

O frontend (`static/index.html`, vanilla JS) é servido pelo próprio BFF na raiz (`/`),
o que elimina CORS e um deploy extra. CORS fica **desabilitado por padrão**; se o
frontend for extraído para hosting próprio, habilite listando as origins em
`LOG_BFF_CORS_ORIGINS` (nunca `*`).

## API do BFF

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/` | Frontend (Visualizador de Logs) |
| `GET` | `/api/logs` | Proxy para `<src>/v1/logs`; params: `src` (obrigatório), `level`, `service`, `q`, `since`, `until`, `limit`, `offset` |
| `GET` | `/api/stats` | Proxy para `<src>/v1/stats`; param: `src` |
| `GET` | `/api/requests` | Contadores de requisições ao srv: `total_requests`, `unique_requests` e `items` (por hash, ordenado por `count`); param: `limit` |
| `GET` | `/api/requests/{hash}` | Contador de uma requisição específica (404 se o hash não existir) |
| `GET` | `/api/config` | Link default sugerido ao frontend (`LOG_BFF_DEFAULT_SRV_URL`) |
| `POST` | `/api/diagnostico` | Cola do pipeline: `{message, service?, level?}` → fingerprint no MS 1 → cache MS 2 → miss vira busca no MS 3 (não-grounded registra órfão no MS 5 e o caso entra na fila do MS 7). Resultados: `cache_exato`, `cache_aproximado`, `base_conhecimento`, `escalado`, `sem_solucao` |
| `GET` | `/api/agente/cura/{fingerprint}` | Estado da curadoria para o órfão (prompt + cura), lido do MS5 — polling do cockpit, sem depender do AgentiX |
| `GET` | `/health/live` / `/health/ready` | Probes |

Órfãos que entram na fila de revisão ganham rascunho de solução
automaticamente: o worker curador do bff-curadoria (MS 7) invoca o agente
Agentix `dvop-curador` e grava o rascunho para aprovação humana (ver
`../bff-curadoria/README.md`). O fluxo manual de copiar/colar no Copilot foi
aposentado.

### Diagnóstico misto (texto + links)

`POST /api/diagnostico/misto` — body `{"message": "<texto e/ou links>", "github_token": "<PAT opcional>"}`.
Extrai as URLs da mensagem; caso simples (0 links ou 1 link de Actions) segue direto,
caso ambíguo (2+ links ou link que não é de Actions) passa pela triagem do Agentix com
fallback determinístico. Cada link `papel=erro` (teto 3) vira uma importação via
mcp-github; texto de erro vai ao fluxo do `/api/diagnostico`. Falha de um item não
derruba a resposta (erro por item, 200 parcial).

Envs novos: `LOG_BFF_AGENTIX_PAYLOAD_KEY` (key do payload do Invoke; default `erro`,
bundle oficial usa `descricao`), `LOG_BFF_AGENTIX_TRIAGEM_ENTITY_ID` e
`LOG_BFF_AGENTIX_TRIAGEM_ENTITY_NAME` (default `triagem-group`) — sem o entity id da
triagem, a escada usa só o fallback determinístico.

### API headless do cockpit (`/api/cockpit/*`)

Superfície **aberta** (mesma política de auth do resto das rotas `/api`) para acionar
o cockpit programaticamente — sem o front do navegador. Não altera o fluxo visual do
`static/cockpit.html`, que continua montando o próprio trace no cliente.

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/cockpit/analisar` | Body `{message, github_token?}` → reusa `DiagnosticoMistoService.diagnosticar`, monta o trace estruturado e, quando o caso casa com uma remediação de PR, popula `acoes.pr_disponivel`. Resposta: `{trace: {passos, desfecho}, itens_extras, acoes}` |
| `POST` | `/api/cockpit/pr/{fingerprint}/aprovar` | Dispara a abertura do PR (assíncrono): gera a proposta na curadoria e orquestra poll→aprovar em background. Retorna de imediato `{estado: "gerando"}`; o estado final é consultado por poll em `.../estado`. `503` se a curadoria (`LOG_BFF_CURADORIA_URL`/token S2S) não estiver configurada; `409` se nenhuma remediação casar com o caso |
| `GET` | `/api/cockpit/pr/{fingerprint}/estado` | Consulta o estado da proposta: `{estado, pr_numero?, pr_url?, motivo?}`. `motivo` é o **código cru** devolvido pelo upstream (ex.: `credencial_ausente`, `erro_branch_orfa`) — a tradução para exibição é responsabilidade do consumidor. Proposta ausente (404 da curadoria, ex.: após rejeitar) → `{estado: "ausente"}` |
| `POST` | `/api/cockpit/pr/{fingerprint}/rejeitar` | Descarta a proposta (recusa) — nenhuma ação no GitHub. Retorna `{estado: "rejeitado"}` |

`acoes` em `analisar` é `{}` quando não há PR aplicável, quando a curadoria está
desligada, ou quando a consulta de remediações aplicáveis falha (a falha não derruba
a análise). Detalhe de desenho e contrato completo em
[docs/superpowers/specs/2026-08-27-cockpit-api-headless-design.md](../../docs/superpowers/specs/2026-08-27-cockpit-api-headless-design.md).

## Contabilização de requisições ao srv

Toda requisição enviada ao srv (via `/api/logs` ou `/api/stats`) gera um **hash**
SHA-256 determinístico de método + URL + parâmetros normalizados — requisições
idênticas compartilham o mesmo hash — e incrementa um contador persistido em
**SQLite** (`LOG_BFF_DB_PATH`, default `./data/requests.db`). O registro acontece
**antes** da chamada, então falhas de upstream também contam. O hash volta no
header `X-Srv-Request-Hash` e aparece na linha de status do frontend, que também
tem o card "Contador de requisições ao srv" (tabela de `/api/requests`).

Como as requisições ao srv passam pelo BFF, a contagem é feita aqui; chamadas
feitas direto ao srv (sem passar pelo BFF) não são contabilizadas.

Tratamento de erros do upstream: srv inacessível ⇒ `502`; timeout ⇒ `504`;
erro de uso no srv (4xx, ex.: filtro inválido) ⇒ propagado com o mesmo status;
5xx do srv ⇒ `502`. Link fora de `http(s)` ⇒ `422`; host fora da lista
`LOG_BFF_ALLOWED_HOSTS` (quando configurada) ⇒ `403`. A URL usada no srv é
**reconstruída** só com scheme/host/porta validados — path, query e userinfo
do `src` são descartados (anti-SSRF).

## Rodando localmente

Pré-requisito: **Node 22** e o `dvop-srv-log-process` rodando (ex.: porta 8000 —
ver `../dvop-srv-log-process/README.md`).

```bash
npm ci
npm run build          # nest build → dist/
npm run start           # node dist/main.js
# desenvolvimento com watch: npm run start:dev
```

Abra `http://localhost:8080`, informe `http://localhost:8000` no campo de link e
clique em **Buscar logs**.

### Testes

Suíte em **Jest** (unit + e2e, cobertura mínima 90% configurada no `package.json`):

```bash
npx jest
npx jest --coverage      # npm run test:cov
```

## Docker

O `docker-compose.yml` deste diretório sobe a **stack completa** (srv + bff):

```bash
docker compose up --build
# frontend em http://localhost:8080 — use http://log-process:8000 como link (já vem sugerido)
```

O `bff` usa um Dockerfile **multi-stage** (`docker/Dockerfile`): stage de build
na imagem `ubi10_custom/nodejs-22:daily-update` (`npm ci` → `npm run build` →
`npm prune --omit=dev`) e runtime na imagem mínima
`ubi10_custom/nodejs-22-minimal:daily-update` — só `node_modules`, `dist` e
`static` são copiados para o runtime, sem toolchain de build. Bases fixas do
Nexus interno (sem `BASE_IMAGE` parametrizável, diferente do ms1 em Python).
O volume `bff-data` (montado em `/opt/app-root/src/data`) preserva o
`requests.db` entre recriações do container. HEALTHCHECK Docker chama
`GET /health/live` a cada 30s (timeout 3s, 3 tentativas).

## Deploy

> Deploy: os manifests k8s foram removidos — o deploy é feito pela plataforma do Bradesco.

## Configuração (variáveis de ambiente)

Todas as chaves têm prefixo `LOG_BFF_` e são lidas em `src/config/env.ts`
(`loadConfig()`); nenhuma é obrigatória — todas têm default (vazio ou não).

| Variável | Default | Descrição |
|---|---|---|
| `LOG_BFF_DEFAULT_SRV_URL` | `http://localhost:8000` | Link sugerido no frontend + srv usado pelo `/api/diagnostico` |
| `LOG_BFF_CACHE_URL` | *(vazio)* | Cache de soluções (MS 2) do `/api/diagnostico`; vazio desabilita o hop |
| `LOG_BFF_RETRIEVAL_URL` | *(vazio)* | Base de conhecimento (MS 3); vazio = diagnóstico cache-only, sem escalada |
| `LOG_BFF_REVIEW_URL` | *(vazio)* | Fila de revisão (MS 7) da curadoria; vazio = painel de curadoria desligado |
| `LOG_BFF_MCPGH_URL` | *(vazio)* | mcp-github; vazio = `/api/importar` desligado |
| `LOG_BFF_MCPGH_TOKEN` | *(vazio)* | Token default do mcp-github (header `X-GitHub-Token` sobrepõe; **nunca logado/commitado**) |
| `LOG_BFF_REMEDIATION_URL` | *(vazio)* | Base do executor de remediação (MS 8) para notificação fire-and-forget de match; vazio = notificação desligada |
| `LOG_BFF_AGENTIX_URL` | *(vazio)* | URL completa do `/graphql/` da plataforma Agentix; vazio = botão do agente não aparece no cockpit |
| `LOG_BFF_AGENTIX_TOKEN` | *(vazio)* | Bearer estático (só para teste rápido — o access_token corporativo vive ~5 min; **nunca logado/commitado**) |
| `LOG_BFF_AGENTIX_TOKEN_URL` | *(vazio)* | Endpoint de token do Keycloak; configurado, tem precedência sobre o token estático (grant `client_credentials`, renovação automática com margem de 30 s) |
| `LOG_BFF_AGENTIX_CLIENT_ID` | *(vazio)* | Client id OIDC de integrador |
| `LOG_BFF_AGENTIX_CLIENT_SECRET` | *(vazio)* | Client secret OIDC (**nunca logado/commitado**) |
| `LOG_BFF_AGENTIX_TENANT_ID` | *(vazio)* | Header `x-lx-tenant` (credencial de serviço — **nunca chega ao navegador nem aos logs**) |
| `LOG_BFF_AGENTIX_BUNDLE_NAME` | `dvop-agx-ssol-propor-solucao` | Bundle que contém o agente |
| `LOG_BFF_AGENTIX_BUNDLE_VERSION` | *(vazio)* | Versão do bundle gerada pela esteira (ex.: `0.0.15`) |
| `LOG_BFF_AGENTIX_ENTITY_ID` | *(vazio)* | Id do group `dvop-diagnostico` no ambiente (confirmar na validação DEV) |
| `LOG_BFF_AGENTIX_ENTITY_NAME` | `dvop-diagnostico` | Nome da entidade invocada |
| `LOG_BFF_AGENTIX_ENTITY_VERSION` | `1.0.0` | Versão da entidade invocada |
| `LOG_BFF_AGENTIX_ENTITY_TYPE` | `GROUP` | Tipo da entidade invocada |
| `LOG_BFF_AGENTIX_PAYLOAD_KEY` | `erro` | Key do payload do Invoke (bundle oficial usa `descricao`) |
| `LOG_BFF_AGENTIX_TRIAGEM_ENTITY_ID` | *(vazio)* | Id da entidade da triagem (diagnóstico misto); vazio = triagem desligada (só fallback determinístico) |
| `LOG_BFF_AGENTIX_TRIAGEM_ENTITY_NAME` | `triagem-group` | Nome da entidade da triagem |
| `LOG_BFF_ALLOWED_HOSTS` | *(vazio)* | CSV de hosts permitidos no `src`, entradas `host` (qualquer porta) ou `host:porta` (porta fixa); vazio = qualquer host (**restrinja em produção — mitiga SSRF**; vazio gera warning no startup) |
| `LOG_BFF_CORS_ORIGINS` | *(vazio)* | CSV de origins para CORS; vazio = desabilitado (frontend é same-origin) |
| `LOG_BFF_REQUEST_TIMEOUT` | `10` | Timeout (s) das chamadas upstream |
| `LOG_BFF_LOG_LEVEL` | `INFO` | Nível de log do serviço |
| `LOG_BFF_DB_PATH` | `./data/requests.db` | SQLite do contador de requisições ao srv (no k8s/Docker, caminho no volume/PVC — ex. `/opt/app-root/src/data/requests.db`) |
| `LOG_BFF_AUDIT_MAX_ROWS` | `10000` | Retenção do audit de requisições: mantém as N entradas mais recentes |
| `LOG_BFF_MAX_BODY_BYTES` | `2097152` | Teto do corpo cru da requisição em bytes; acima disso → `413` (2 MiB) |

**Demo local do agente sem rede corporativa**: `python tools/sim_agentix.py`
(raiz do repo) emula o `/graphql/` (Invoke, GetSession, conversationLogs) e o
endpoint de token do Keycloak; o cenário é escolhido pelo texto do erro
(`falha`, `vazio`, `base64`, `sem_solucao`, `base`, ou qualquer outro →
solução curada). Instruções de subida no docstring do próprio arquivo.

## Estrutura

```
src/
  main.ts             # createApp()/bootstrap(): CORS, body limit (413), static mount
  app.module.ts        # wiring dos controllers/providers, ServeStaticModule
  config/env.ts         # loadConfig() — todas as chaves LOG_BFF_*
  api/                  # controllers (health, config, logs, diagnóstico, agente, requests, fila, cache/base, sim, importar)
  upstreams/            # clients HTTP dos MS 1/2/3/6/7 e mcp-github
  agentix/               # AgentixService + AgentixTokenProvider (client_credentials)
  diagnostico/           # orquestração do pipeline de diagnóstico
  audit/                 # RequestAuditService (hash + SQLite via better-sqlite3)
  metrics/               # MetricsService/Controller (Prometheus)
  common/                # interceptors, exception filter, body-limit middleware, json-logger
static/index.html      # frontend (vanilla JS), servido pelo próprio Nest
test/                   # Jest (unit + *.e2e-spec.ts), cobertura mínima 90%
docker/Dockerfile       # multi-stage: build (nodejs-22) → runtime (nodejs-22-minimal)
```

## Observabilidade

Métricas Prometheus em `GET /metrics` (RED de HTTP + métricas de domínio);
targets, queries de partida e a receita para ligar OpenTelemetry depois
estão em [docs/observabilidade.md](../docs/observabilidade.md).

## Visibilidade do PR de remediação no cockpit

Quando um item de link resolve em `cache_exato` e o executor (MS 8) abre o PR, o
cockpit mostra "PR de remediação aberto · #N · <url>". Para isso o BFF precisa
alcançar o MS 8:

- `LOG_BFF_REMEDIATION_URL` — base do `dvop-srv-remediation` (ex.:
  `http://localhost:8007`). Vazio = o cockpit mostra "PR em processamento —
  confira no GitHub" (recurso soft-desabilitado).

Endpoint exposto: `GET /api/remediacao/pr/:fingerprint` → `{ "pr": { ... } }` com
o PR (ou `{ "pr": null }` enquanto ainda não há PR para o fingerprint, ou se
`LOG_BFF_REMEDIATION_URL` estiver vazio). O PR nasce do caminho **agente aprovado**
(curadoria aprova → `dvop-bff-curadoria` chama `POST /v1/prs/aplicar` no MS 8); este
BFF apenas lê o resultado via `remediation-pr.service.ts` (`GET /v1/prs/{fingerprint}`)
— o cockpit faz um poll curto por alguns segundos.

Pré-requisitos do lado do MS 8 para o PR realmente abrir: `REMEDIATION_ENABLED=true`,
`REMEDIATION_DRY_RUN=false`, `REMEDIATION_GITHUB_API_URL`/`REMEDIATION_GITHUB_TOKEN`
válidos, `REMEDIATION_CURADORIA_URL` configurada, e o fingerprint com solução
curada + vínculo de elegibilidade a uma remediação `agente` catalogada.
