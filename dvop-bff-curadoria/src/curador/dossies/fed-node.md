# Arquétipo fed-node (front-end federado, build Node — sabor Angular no kit atual)

- Stack: front-end federado; o kit `starter-fed-angular` usa Angular 22
  (standalone, zoneless, testes em Vitest via `@angular/build:unit-test`).
  Compartilha o BUILD com srv-java/bff-node (mesma família de gates), mas
  troca o destino do deploy: em vez de Kubernetes, o bundle vai para o
  container `$web` de um Storage Account — por isso não há job `gitops`, nem
  chart, nem repositório `-config`.
- Build/esteira: `npm ci`, `npm run build` (`ng build` → `dist/`, `index.html`
  na raiz), `npm test` (`ng test` → `coverage/lcov.info`); esteira reusável
  `ci-fed-node.yml` (`docker: false`, não publica pacote nem imagem). CD
  (`workflow_dispatch`) faz Clear Storage Account → Upload.
- Pegadinhas conhecidas:
  - `outputPath` não é o default do `ng new` (`dist/<projeto>/browser`): aqui
    precisa ser `{ "base": "dist", "browser": "" }` para o `index.html` cair
    na raiz de `dist/`, que é o que o CD sincroniza no `$web`.
  - O builder de teste do Angular grava cobertura em
    `coverage/<projeto>/lcov.info`; sem um `vitest-base.config.ts` apontando
    para o caminho que a esteira publica (`coverage/lcov.info`), o Sonar lê o
    caminho errado e o Quality Gate fecha com 0% de cobertura mesmo com todos
    os testes verdes.
  - Sem a variável `STORAGE_ACCOUNT` provisionada, o erro do deploy é
    `Name or service not known`.
