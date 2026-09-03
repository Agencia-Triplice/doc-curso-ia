# Arquétipo srv-java (Java 21 / Spring Boot 3.5)

- Stack: serviço standalone (um `pom.xml`, um jar), parent
  `spring-boot-starter-parent`; transversais (erro, access-log, métricas,
  health) vêm da lib golden `dvop-lib-common`, resolvida do Nexus.
- Build/esteira: `mvn test` (testes + JaCoCo) e `mvn package` (gera
  `target/app.jar`); esteira reusável `ci-srv-java.yml`, gate JaCoCo ≥90% —
  o `jacoco.xml` nasce em `target/site/jacoco/jacoco.xml`. Imagem via
  Dockerfile (multi-stage maven → temurin-jre, `USER 1001`, HEALTHCHECK);
  publica no Nexus (`VS_KEY=maven-hosted`) e faz deploy por GitOps (job
  `gitops` do `ci.yml` renderiza o manifesto e commita no repo `-config`; o
  `cd.yml` é só o roteiro corporativo).
- Pegadinhas conhecidas:
  - Classe `Application` (só tem `main()`) fica **excluída do JaCoCo** — sem a
    exclusão, sozinha derrubaria o total para ~86% e reprovaria o gate.
  - Credenciais do Nexus vêm de env `NEXUS_MAVEN_USER`/`NEXUS_MAVEN_PASS` (e
    `NEXUS_DOCKER_USER`/`NEXUS_DOCKER_PASS` para a imagem) — sem elas o
    `mvn deploy`/`docker push` falha por autenticação, não por bug de código.
  - Porta, probes e variáveis de runtime não moram no repo do serviço: ficam
    no `values.yaml` do repo `-config` (chart `srv-java`); erro de probe/porta
    normalmente é lá, não no `application.yaml` do serviço.
