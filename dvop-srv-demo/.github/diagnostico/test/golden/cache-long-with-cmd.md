<!-- estado:conhecido -->
## 🔎 Diagnóstico automático da falha

<sub>Job: **esteira / build**</sub>

![erro](https://img.shields.io/badge/erro-CONHECIDO-2ea44f?style=flat-square) ![confianca](https://img.shields.io/badge/confianca-alta-2ea44f?style=flat-square) ![servico](https://img.shields.io/badge/servico-dvop--srv--demo-1f6feb?style=flat-square) ![fingerprint](https://img.shields.io/badge/fingerprint-e21cda41aa83b59e-6e7681?style=flat-square)

> [!TIP]
> **Erro já conhecido** — solução disponível na base de curadoria.
> Assinatura: `[ERROR] Failed to execute goal org.apache.maven.plugins:maven-deploy-plugin:deploy on project dvop-srv-demo: status 400 …`

<details><summary>Ver erro completo</summary>

```text
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-deploy-plugin:deploy on project dvop-srv-demo: status 400 Repository does not allow updating assets maven-hosted and here is a very long tail of the maven error output that keeps going and going and going past a hundred and twenty characters easily
```

</details>

### 💡 Solução da curadoria

1. Ajuste a versão do projeto. Rode `mvn versions:set -DnewVersion=1.0.1`. 
2. Reexecute a pipeline. 


**Comando sugerido:**

```bash
mvn versions:set -DnewVersion=1.0.1
```

_por IA (Agentix)_

<sub>Run analisado: https://github.com/o/r/actions/runs/1#step:3:1</sub>
