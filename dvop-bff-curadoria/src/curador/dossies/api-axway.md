# Arquétipo api-axway (Axway API Manager / Gateway)

- Stack: a "aplicação" é a própria especificação — `openapi.yaml` (OpenAPI
  3.0.3; o Gateway recusa outro formato) + `config.yaml` com os blocos
  `api`/`proxy`/`backend`/`securityProfile`/`quota`. Sem código, imagem, chart
  ou repositório `-config` — o destino não é Kubernetes.
- Build/esteira: CI valida a spec e exporta a definição (`.DAT`) + gitleaks,
  fortify (esteira reusável `ci-api-axway.yml`, input `api-spec: openapi.yaml`).
  CD (`workflow_dispatch`) publica no **API Manager** e confere a integração
  com o **Gateway** (Setting subscription → Validando especificação →
  Publicando → Checando integração).
- Pegadinhas conhecidas:
  - Os blocos de `config.yaml` são exatamente os que a KB culpa nos erros
    `CANT_CREATE_API_PROXY`, `CANT_CREATE_BE_API`, `INVALID_QUOTA_CONFIG` e
    `ERR_SECURITY_PROFILE_IS_INVALID` — comece a investigação por eles.
  - `API_NAME` é a variável que o `apim` usa para identificar a API; se não
    bater com a instância do ambiente, o erro é `UNKNOWN_API`.
  - São ~20 valores de `SIM_FALHA` só para este arquétipo (tabela no README do
    `esteiras-workflows`).
