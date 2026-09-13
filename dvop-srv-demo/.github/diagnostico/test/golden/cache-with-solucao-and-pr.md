<!-- estado:conhecido -->
## 🔎 Diagnóstico automático da falha

<sub>Job: **esteira / build**</sub>

![erro](https://img.shields.io/badge/erro-CONHECIDO-2ea44f?style=flat-square) ![servico](https://img.shields.io/badge/servico-dvop--srv--demo-1f6feb?style=flat-square) ![fingerprint](https://img.shields.io/badge/fingerprint-abc123-6e7681?style=flat-square)

> [!TIP]
> **Erro já conhecido** — solução disponível na base de curadoria.
> Assinatura: `blob upload invalid`

### 💡 Solução da curadoria

1. Ajuste a versão do projeto para uma nova ainda não publicada. 
2. Reexecute a pipeline.


_por IA (Agentix)_

### 🛠️ Remediação sugerida

**Subir a versão do artefato**

Incremente a versão no pom.xml para evitar colisão no Nexus.

<sub>Run analisado: https://github.com/o/r/actions/runs/1#step:3:1</sub>
