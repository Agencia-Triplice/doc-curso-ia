# dvop-srv-demo

[![CI](https://github.com/GDD-Core/dvop-srv-demo/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/GDD-Core/dvop-srv-demo/actions/workflows/ci.yml)
![Diagnóstico automático](https://img.shields.io/badge/falha_de_CI-diagnóstico_automático-8957e5?style=flat-square&logo=githubactions&logoColor=white)

SRV Spring Boot mínimo do test bed. CI/CD = callers da esteira srv-java
simulada (repo `esteiras`). `mvn -B verify` gera o jacoco.xml (gate 90%).
Publica no maven-hosted do Nexus da VPS (distributionManagement id nexus).

Quando a esteira falha, o job `diagnostico-falha` consulta o cockpit e escreve
um diagnóstico no **log** e no **resumo** do run (e comenta no PR, quando houver).
Ver [`.github/diagnostico/`](.github/diagnostico/) e
[`DIAGNOSTICO-AUTOMATICO.md`](DIAGNOSTICO-AUTOMATICO.md).

