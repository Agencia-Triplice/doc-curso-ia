# Checklist de paridade DEV — `bff-curadoria` (Node) vs `ms7` (Python)

> **Gate do Task 13** (plano `docs/superpowers/plans/2026-07-13-bff-curadoria-node-nestjs-migration.md`, Step 2).
> A remoção do Python (`git rm -r ms7`) e o rename dos scripts **só** ocorrem depois deste
> checklist **verde em DEV** + aprovação humana explícita. Branch: `feat/bff-curadoria-node` @ `5e74597`.
>
> Método: subir a stack e **comparar cada rota do Node (porta 8004) com o ms7 Python atual**.
> Onde o item diz "= ms7", o corpo/mensagem/headers devem ser **idênticos** ao Python (porte fiel).

## 0. Pré-requisitos

- [ ] MS5 (cache-writer :8002), MS3 (retrieval :8003), MS8 (remediation :8007) de pé.
- [ ] `bff-curadoria` rodando em **:8004** (`cd dvop-bff-curadoria && npm ci && npm run build && node dist/main.js`,
      ou via `start-local.ps1` após o cutover). Envs `CURADORIA_BFF_*` apontando para os MS.
- [ ] Para o caminho feliz do worker: `CURADORIA_BFF_AGENTIX_*` configurados (url, token/client, tenant, bundleVersion, entityId).

## 1. Suíte + cobertura  ✅ (já verde — registrar o valor observado)

- [x] `cd dvop-bff-curadoria && npx jest --coverage` → **258 PASS**, cobertura **99.75 / 98.4 / 99.32 / 100** (≥90). *(rodado em 2026-07-13)*

## 2. Rotas de review (`@Controller('v1')` — status exatos)

- [ ] `GET /v1/fila` → 200 `{itens[], total, truncado}` = ms7.
- [ ] `GET /v1/fila/{fp}` → 200 (item + `rascunho`) ; `{fp}` inexistente → **404** `{"detail":"órfão não encontrado na fila"}`.
- [ ] `PUT /v1/fila/{fp}/rascunho` (corpo `{solucao, autor?}`) → **200** (DraftOut) ; órfão fora da fila → **404** `"órfão não encontrado na fila"`.
- [ ] `DELETE /v1/fila/{fp}/rascunho` → **204** ; sem rascunho → **404** `"rascunho não encontrado"`.
- [ ] `POST /v1/fila/{fp}/aprovar` → **201** `{...solucao, publicado_base}` ; sem corpo e sem rascunho → **400** `"sem solução: envie no corpo ou salve um rascunho antes"`.
- [ ] `POST /v1/fila/{fp}/descartar` → **204**.
- [ ] `GET /v1/solucoes?limit=` (1..500, default 100) — fora da faixa → **422**.
- [ ] `GET /v1/info` → 200 (contagens + urls + `retrieval_disponivel`/`remediacao_disponivel`) = ms7.
- [ ] Fingerprint inválido (len 0 ou >64) em qualquer rota `{fp}` → **422** `{"detail":"fingerprint inválido (1..64)"}`.

## 3. Rotas de elegibilidade (`@Controller('v1')`)

- [ ] `GET /v1/remediacoes` com MS8 **off** → **503** `"remediação indisponível: configure CURADORIA_BFF_MS8_URL"`.
- [ ] `PUT /v1/elegibilidade/{fp}` caminho feliz → **200**, linha com **`remediacao_versao` vinda do catálogo** (MS8), não do payload.
- [ ] `PUT` sem `preview_confirmado=true` → **400** (mensagem de preview) *antes* de tocar o catálogo.
- [ ] `PUT` com `remediacao_id` não catalogado → **400** `"remediação não catalogada: '<id>'"` (aspas simples).
- [ ] `PUT` com `fp` que não está na fila nem no cache → **404** `"fingerprint desconhecido: não está na fila nem no cache"`.
- [ ] `GET /v1/elegibilidade/{fp}` sem vínculo → **404** ; com vínculo → **200** (ElegibilidadeOut).
- [ ] `DELETE /v1/elegibilidade/{fp}` → **204** ; inexistente → **404**.
- [ ] `GET /v1/elegibilidade?limit=` (1..500, default 100) — fora da faixa → **422**.

## 4. Degradação / limites transversais

- [ ] `GET /v1/documentos` com MS3 **off** → **503** `"base de conhecimento indisponível: configure CURADORIA_BFF_MS3_URL"`.
- [ ] `GET /v1/documentos?limit=` (1..200, default 50) com MS3 on → 200 pass-through ; fora da faixa → **422**.
- [ ] Upstream 5xx/timeout → **502 / 504** (campo `detail`); upstream 4xx propaga como-is.
- [ ] **`X-Request-ID`** presente em toda resposta.
- [ ] Corpo **> 2 MiB** → **413** `{"detail":"corpo da requisição excede o limite"}` + `X-Request-ID`.

## 5. Métricas (`GET /metrics`)

- [ ] Famílias presentes: `curador_ciclos_total{resultado}`, `curador_rascunhos_total{resultado}`, `curadoria_total{acao}`, `elegibilidade_total{acao}`.
- [ ] `http_requests_total{method,rota,status}` + `http_request_duration_seconds` com bucket **`le="0.075"`** + gauge `http_requests_em_andamento`.
- [ ] Label **`rota` templatizada** (ex.: `/v1/fila/:fingerprint`, sem explodir por fingerprint).

## 6. Front (`GET /`) — mesmo HTML do ms7, opera fim-a-fim

- [ ] `GET /` serve o front (same-origin, **sem CORS**). *(sha256 já confirmado idêntico a `ms7/static/index.html`.)*
- [ ] Fluxo no navegador: **fila → contexto → salvar rascunho → aprovar → descartar**, e **elegibilidade/preview**.

## 7. Worker do curador (caminho feliz Agentix)

- [ ] Com Agentix configurado, um órfão sem rascunho recebe rascunho automático (**autor `"IA (Agentix)"`**) dentro de ~1 ciclo.
- [ ] `curador_rascunhos_total{resultado="gerado"}` incrementa; badge `ia_estado` some ao gerar.
- [ ] Agentix indisponível → ciclo entra em backoff (dobra até 600s), sem derrubar o serviço; `curador_ciclos_total{resultado="ok"}` continua.

## 8. Build da imagem (base corporativa)

- [ ] `cd dvop-bff-curadoria && docker build -f docker/Dockerfile -t dvop-bff-curadoria:val .` conclui nas bases UBI10 nodejs-22 do Nexus interno. *(não executável fora da rede corporativa.)*
- [ ] Container sobe, `HEALTHCHECK /health/live` em :8004 fica **healthy**, front e `/metrics` respondem.

---

## Sign-off

| Campo | Valor |
|---|---|
| Ambiente DEV | |
| Data / responsável | |
| Itens 2–8 verdes? | ☐ Sim  ☐ Não (anexar divergências) |
| **Aprovação para cutover (Task 13 Step 3/4)** | ☐ Aprovado  — assinatura: |

Com o sign-off **Aprovado**, o cutover executa: `git rm -r ms7`, ajuste de `start-local.ps1` /
`tools/sync_common.py` / compose raiz, nota em `ARQUITETURA.md` (curadoria = Node/Nest
`dvop-bff-curadoria`, imagem ubi10 nodejs-22-minimal, fora do sync `dvop-common`).
