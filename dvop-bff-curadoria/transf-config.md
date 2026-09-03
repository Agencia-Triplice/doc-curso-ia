# transf-config — dvop-bff-curadoria

- **Tipo:** BFF Node 22 + NestJS
- **Porta:** `8004` (fixa em `src/main.ts`)
- **Fonte:** `src/config/env.ts` — **prefixo de env `CURADORIA_BFF_`** (toda chave abaixo é lida como `CURADORIA_BFF_<CHAVE>`)
- **Papel:** BFF da curadoria (fila→caso, PR por caso via AgentiX, auth GitHub OAuth/PAT)
- **Segredos de runtime:** `CURADORIA_BFF_SESSION_SECRET` 🔑 (obrigatório em prod), `CURADORIA_BFF_GITHUB_CLIENT_SECRET` 🔑, `CURADORIA_BFF_AGENTIX_PASSWORD` 🔑, `CURADORIA_BFF_INTERNAL_TOKEN`/`_S2S_TOKEN` 🔑

## Upstreams / rede

| Chave (`CURADORIA_BFF_*`) | Default |
|---|---|
| `MS5_URL` | `http://localhost:8002` |
| `MS3_URL` / `MS8_URL` / `MCP_GITHUB_URL` | _(vazio)_ |
| `INTERNAL_TOKEN` 🔑 | _(vazio)_ |
| `S2S_TOKEN` 🔑 | _(vazio)_ · aceita `X-Internal-Token` de entrada (cockpit → PR headless) |
| `REQUEST_TIMEOUT` | `10` |
| `LOG_LEVEL` | `INFO` |
| `MAX_BODY_BYTES` | `2097152` |

## Persistência (SQLite em PVC)

| Chave (`CURADORIA_BFF_*`) | Default |
|---|---|
| `ELEGIBILIDADE_DB_PATH` | `data/elegibilidade.db` |
| `PROMPT_DB_PATH` | `data/prompts.db` |
| `PROPOSTA_DB_PATH` | `data/proposta_pr.db` |

## AgentiX

| Chave (`CURADORIA_BFF_*`) | Default |
|---|---|
| `AGENTIX_URL` / `AGENTIX_USERNAME` | _(vazio)_ |
| `AGENTIX_PASSWORD` 🔑 | _(vazio)_ |
| `AGENTIX_TENANT_ID` | _(vazio)_ |
| `AGENTIX_BUNDLE_NAME` | `dvop-agx-ssol-consulta-erro` |
| `AGENTIX_BUNDLE_VERSION` | _(vazio)_ |
| `AGENTIX_ENTITY_ID` | _(vazio)_ |
| `AGENTIX_ENTITY_NAME` | `curador` |
| `AGENTIX_ENTITY_VERSION` | `1.0.0` |
| `AGENTIX_ENTITY_TYPE` | `agent` (confirmar `=agent` no real) |
| `AGENTIX_PR_ENTITY_NAME` | `propor-pr` |

## Curador (worker) e proposta de PR

| Chave (`CURADORIA_BFF_*`) | Default |
|---|---|
| `CURADOR_INTERVALO` | `60` |
| `CURADOR_LOTE` | `2` |
| `CURADOR_MAX_TENTATIVAS` | `3` |
| `PROPOSTA_MAX_ARQUIVOS` | `3` |
| `PROPOSTA_MAX_LINHAS_DIFF` | `80` |
| `PROPOSTA_INTERVALO` | `20` |

## Auth / GitHub

| Chave (`CURADORIA_BFF_*`) | Default |
|---|---|
| `SESSION_SECRET` 🔑 | _(vazio)_ · **obrigatório se `NODE_ENV=production`** |
| `SESSION_TTL_SECONDS` | `43200` (12 h) |
| `GITHUB_CLIENT_ID` | _(vazio)_ |
| `GITHUB_CLIENT_SECRET` 🔑 | _(vazio)_ |
| `GITHUB_CALLBACK_URL` | _(vazio)_ |
| `GITHUB_BASE_URL` | `https://github.com` (GHES: `https://<host>`) |
| `GITHUB_API_URL` | `https://api.github.com` (GHES: `https://<host>/api/v3`) |
| `GITHUB_ORG` | `GDD-Core` |
| `GITHUB_ALLOWED_TEAMS` | _(vazio, CSV)_ |
| `AUTH_DEV_USER` | _(vazio)_ |
