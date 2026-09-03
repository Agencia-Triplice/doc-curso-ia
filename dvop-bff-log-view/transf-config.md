# transf-config — dvop-bff-log-view (cockpit)

- **Tipo:** BFF Node 22 + NestJS
- **Porta:** `8080` (fixa em `src/main.ts`)
- **Fonte:** `src/config/env.ts` — **prefixo de env `LOG_BFF_`** (toda chave abaixo é lida como `LOG_BFF_<CHAVE>`)
- **Papel:** BFF + frontend do cockpit (`/api/diagnostico` = a cola do pipeline)
- **Segredos de runtime:** `LOG_BFF_AGENTIX_CLIENT_SECRET`/`_PASSWORD` 🔑, `LOG_BFF_AGENTIX_TOKEN` 🔑, `LOG_BFF_AGENTIX_PAYLOAD_KEY` 🔑, `LOG_BFF_MCPGH_TOKEN` 🔑, `LOG_BFF_CURADORIA_S2S_TOKEN` 🔑

## Upstreams / rede

| Chave (`LOG_BFF_*`) | Default |
|---|---|
| `DEFAULT_SRV_URL` | `http://localhost:8000` |
| `CACHE_URL` | _(vazio)_ |
| `CACHE_WRITER_URL` | _(vazio)_ |
| `RETRIEVAL_URL` | _(vazio)_ |
| `REVIEW_URL` | _(vazio)_ |
| `MCPGH_URL` | _(vazio)_ |
| `MCPGH_TOKEN` 🔑 | _(vazio)_ |
| `REMEDIATION_URL` | _(vazio)_ |
| `CURADORIA_URL` | _(vazio)_ |
| `CURADORIA_S2S_TOKEN` 🔑 | _(vazio)_ |
| `ALLOWED_HOSTS` | _(vazio)_ |
| `CORS_ORIGINS` | _(vazio)_ |
| `REQUEST_TIMEOUT` | `10` |

## AgentiX

| Chave (`LOG_BFF_*`) | Default |
|---|---|
| `AGENTIX_URL` / `AGENTIX_USERNAME` | _(vazio)_ |
| `AGENTIX_PASSWORD` 🔑 | _(vazio)_ |
| `AGENTIX_TENANT_ID` | _(vazio)_ |
| `AGENTIX_BUNDLE_NAME` | `dvop-agx-ssol-consulta-erro` |
| `AGENTIX_BUNDLE_VERSION` | _(vazio)_ |
| `AGENTIX_ENTITY_ID` | _(vazio)_ |
| `AGENTIX_ENTITY_NAME` | `diagnostico` |
| `AGENTIX_ENTITY_VERSION` | `1.0.0` |
| `AGENTIX_ENTITY_TYPE` | `agent` (confirmar `=agent` no real; era `workflow`) |
| `AGENTIX_CURADOR_ENTITY_NAME` | `curador` |
| `AGENTIX_PAYLOAD_KEY` 🔑 | `erro` |
| `AGENTIX_TRIAGEM_ENTITY_ID` | _(vazio)_ |
| `AGENTIX_TRIAGEM_ENTITY_NAME` | `triagem-group` |

## App

| Chave (`LOG_BFF_*`) | Default |
|---|---|
| `LOG_LEVEL` | `INFO` |
| `DB_PATH` | `./data/requests.db` |
| `AUDIT_MAX_ROWS` | `10000` |
| `MAX_BODY_BYTES` | `2097152` |
