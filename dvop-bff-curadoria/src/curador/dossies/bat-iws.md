# Arquétipo bat-iws (Python / IBM Workload Scheduler)

- Stack: job empacotado como artefato PIP (`pyproject.toml`, setuptools) e
  agendado no **IWS**. Sem imagem, chart ou repositório `-config` — o destino
  é o agendador, não Kubernetes.
- Build/esteira: `python -m build --wheel` e `python -m pytest tests -q`; CI
  roda Build artefato → convert files to tar + gitleaks, fortify (esteira
  reusável `ci-bat-iws.yml`, fixa `python-version: "3.9"` de propósito). CD
  (`workflow_dispatch`) roda Setting subscription → convert files to tar →
  Deploy script IWS.
- Pegadinhas conhecidas:
  - A versão do Python **importa**: no 3.10+ o publish do PIP gera o artefato
    com `_` (underscore) no nome e o step "convert files to tar" quebra — é o
    erro `spark-tar-underscore` da KB. Subir a versão no caller reproduz a
    falha de propósito; nunca mude sem entender o porquê do pin em 3.9.
