# Arquétipo mon-ant (Java 8 / Apache Ant / WebSphere)

- Stack: monolito legado — build Ant (`build.xml` + `pacote.properties` +
  `dependencias.xml`) gerando WAR/EAR, publicação no Nexus, deploy em
  **WebSphere**. Sem imagem, chart ou repositório `-config` — o destino não é
  Kubernetes.
- Build/esteira: CI roda Verifica Pendência de migração → Download dependency
  → Run Ant Build → Run Ant Build (ear) → Publish artifact nexus + gitleaks,
  fortify (esteira reusável `ci-mon-ant.yml`, `java-version: "8"`, `ear: true`).
  CD (`workflow_dispatch`) roda Deployment config → Deployment application →
  Deployment on Server.
- Pegadinhas conhecidas:
  - A estrutura de diretórios **é** o ponto do arquétipo: metade dos erros da
    KB nasce quando `JavaSource/`, `WebContent/WEB-INF/` ou a pasta `lib/`
    (que **precisa existir**, mesmo vazia) não batem com o declarado em
    `build.xml`/`pacote.properties` — sintomas típicos: `JavaSource does not
    exist`, `WebContent/WEB-INF/lib does not exist`, `PATH_DIST não está
    definido`.
  - Erros de deploy no WebSphere têm assinatura própria (`WASX7070E`,
    `ADMU3011E`) e podem ser de PDC ou permissionamento, não só do artefato.
  - São ~25 valores de `SIM_FALHA` entre CI e CD (tabela no README do
    `esteiras-workflows`).
