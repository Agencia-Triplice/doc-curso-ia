# Arquétipo python-sim (Python, HTTP mínimo sem framework)

- Stack: HTTP mínimo com `http.server`, sem dependência externa; lógica pura
  em módulo separado (ex.: `protocolo.py`) coberta por `unittest`. Arquétipo
  voltado a **simuladores e utilitários** (foi assim que o `sim-agentix`
  nasceu) — se o serviço virar produto de verdade, o kit certo passa a ser
  `srv-java` ou `bff-node`.
- Build/esteira: `python -m compileall -q .` e
  `python -m unittest discover -s tests -v`; esteira reusável
  `ci-python-sim.yml`. Imagem via Dockerfile (`python:3.12-slim`,
  `USER 1001`); publica no Nexus (`NEXUS_DOCKER_USER`/`NEXUS_DOCKER_PASS`) e
  faz deploy por GitOps (job `gitops` do `ci.yml` commita o manifesto no repo
  `-config`).
- Pegadinhas conhecidas:
  - **Não há gate de cobertura neste arquétipo** — diferente de srv-java e
    bff-node, nada acusa regressão de testes; se o serviço crescer, migrar de
    kit é a saída recomendada.
  - Porta, probes e variáveis de runtime moram no `values.yaml` do repo
    `-config` (chart `python-sim`), não no repo do serviço.
