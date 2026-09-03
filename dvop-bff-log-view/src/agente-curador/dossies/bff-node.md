# Arquétipo bff-node (NestJS 11 / Node 22, TypeScript)

- Stack: NestJS 11 sobre Node 22 (Express); lógica pura extraída de
  controllers/services para módulos testáveis sem subir o Nest (ex.:
  `protocolo.ts`).
- Build/esteira: `npm ci`, `npm run build` (`nest build`), `npm test`
  (`jest --coverage` → `coverage/lcov.info`); esteira reusável
  `ci-bff-node.yml`, gate de cobertura ≥90% sobre o `lcov.info` publicado.
  Imagem via Dockerfile (`node:22-alpine` multi-stage, `USER 1001`); publica
  no Nexus (`VS_KEY=npm-hosted`) e faz deploy por GitOps (job `gitops` do
  `ci.yml` commita o manifesto no repo `-config`; `cd.yml` é o roteiro
  corporativo).
- Pegadinhas conhecidas:
  - `main.ts` precisa escutar em `0.0.0.0` — o default do Nest é `localhost`,
    e dentro do container isso faz a probe do kubelet (que vem de fora)
    receber `connection refused`, com o pod nunca ficando `ready`.
  - `main.ts` e os `*.module.ts` ficam fora do `collectCoverageFrom`: são
    fiação sem lógica e só derrubariam o percentual abaixo dos 90% do gate.
  - Credenciais do Nexus vêm de `NEXUS_NPM_TOKEN` (publish) e
    `NEXUS_DOCKER_USER`/`NEXUS_DOCKER_PASS` (imagem); Nest 11 (Express 5) é o
    caminho que zera os CVEs de `multer`/`path-to-regexp` do Nest 10 — não dá
    para resolver via `overrides` do npm (o override vaza para o `express` e
    exige majors incompatíveis).
