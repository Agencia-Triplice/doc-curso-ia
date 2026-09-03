# doc-curso-ia — pacote portável de migração

**Projeto completo** dos microsserviços alterados + os manifestos `FIX-*.md` (o que mudou e
como implementar), para reimplementar/migrar as mudanças em **outro ambiente**.

> 📦 **Download em zip:** [`doc-curso-ia.zip`](doc-curso-ia.zip) traz este pacote inteiro
> (raiz `doc-curso-ia/`, caminhos com `/` — extrai certo em Windows, Linux e Mac). Baixe o
> arquivo, extraia e siga este README.

> ## ⚠ ANTES DE MIGRAR — leia `MIGRACAO-INSTRUCOES.md`
> A migração substitui **apenas o código-fonte da aplicação**. Ela **NÃO pode alterar nada
> no destino** relativo a **proxy**, **certificados do Bradesco / CA corporativa**,
> variáveis de ambiente, segredos ou config de plataforma — esses itens são do ambiente de
> destino e ficam intactos. Detalhes e procedimento seguro em
> **[`MIGRACAO-INSTRUCOES.md`](MIGRACAO-INSTRUCOES.md)**.

---

## O que tem aqui

Cada pasta de microsserviço é o **projeto completo** (código versionado: `src/`, `static/`,
`test/`, configs de build), **sem** `node_modules`, `dist`, `data` nem `.env` real — só o
`.env.example` de referência. Assim a migração tem todo o contexto (a versão anterior, que
só trazia os arquivos alterados, falhava por falta de dependências/contexto).

```
doc-curso-ia/
├── README.md                            ← este guia
├── MIGRACAO-INSTRUCOES.md               ← ⚠ o que NÃO tocar no destino (proxy, certs…)
├── FIX-CURADORIA-ESCOPO-E-PR-STATUS.md  ← manifesto 1
├── FIX-PROPOSTA-APROVAR-LOCK.md         ← manifesto 2
├── FIX-COCKPIT-FUSAO-BEX.md             ← manifesto 3
├── FIX-COCKPIT-DADOS-REAIS.md           ← manifesto 4
│
├── dvop-bff-curadoria/                  ← PROJETO COMPLETO (BFF NestJS)
└── dvop-bff-log-view/                   ← PROJETO COMPLETO (BFF NestJS)
```

---

## Mapa: manifesto → arquivos alterados → microsserviço

Os manifestos descrevem **só o que muda**; o projeto completo está nas pastas para dar
contexto. Arquivos efetivamente alterados por cada manifesto:

| # | Manifesto | Microsserviço | Arquivos alterados | O que faz |
|---|---|---|---|---|
| 1 | `FIX-CURADORIA-ESCOPO-E-PR-STATUS.md` | `dvop-bff-curadoria` | `static/js/views/caso.js` · `static/css/app.css` | Escopo "Qualquer serviço" por padrão (extras no "ver mais") + barra de status do PR estilo cockpit (só front) |
| 2 | `FIX-PROPOSTA-APROVAR-LOCK.md` | `dvop-bff-curadoria` | `src/propostas/proposta-store.service.ts` · `src/api/propostas.controller.ts` · `test/propostas.e2e-spec.ts` | Trava anti-duplo-PR no `aprovar` (transição atômica `pronta → aprovando`) |
| 3 | `FIX-COCKPIT-FUSAO-BEX.md` | `dvop-bff-log-view` | `static/cockpit.html` | Fusão: telas/fluxo do template BEX sobre os endpoints reais do cockpit (só front) |
| 4 | `FIX-COCKPIT-DADOS-REAIS.md` | `dvop-bff-curadoria` **+** `dvop-bff-log-view` | curadoria: `src/api/propostas.controller.ts` · `test/propostas.e2e-spec.ts` — log-view: `src/api/remediacao.controller.ts` · `static/cockpit.html` | Campos "exemplo" do cockpit viram dados REAIS (diff, teto/gate, branch, escopo) |

> **Arquivos tocados por dois manifestos** (o projeto aqui já contém as mudanças de AMBOS):
> `dvop-bff-curadoria/src/api/propostas.controller.ts` e `.../test/propostas.e2e-spec.ts`
> (2 e 4) e `dvop-bff-log-view/static/cockpit.html` (3 e 4).

---

## Ordem de implementação sugerida

1. **`FIX-PROPOSTA-APROVAR-LOCK.md`** — backend da curadoria (trava de concorrência).
2. **`FIX-COCKPIT-FUSAO-BEX.md`** — reescrita do `cockpit.html` do log-view (a fusão).
3. **`FIX-COCKPIT-DADOS-REAIS.md`** — liga os dados reais no cockpit. **Complementa o 2.**
4. **`FIX-CURADORIA-ESCOPO-E-PR-STATUS.md`** — melhorias de front na tela de caso (independente).

> Como agora há o **projeto completo**, dá para comparar direto (diff da pasta contra o
> destino) e aplicar. Sempre respeitando o `MIGRACAO-INSTRUCOES.md` — não sobrescrever
> config de proxy/cert/ambiente do destino.

---

## Notas de ambiente (comuns a todos)

- **Fronts são SPA/estáticos embutidos na imagem** do BFF (`ServeStaticModule`,
  `rootPath: ../static`) — editar `static/` só chega ao cluster com **rebuild + rollout**.
- **MS8 (`dvop-srv-remediation`, Java) e `mcp-github` NÃO são alterados** por nenhum destes
  manifestos — só entram no fluxo como dependências HTTP.
- **Nenhuma migração de banco** é necessária em nenhum dos quatro.
- Deploy/CI-CD, verificação (QA), rollback e segurança (XSS) estão em cada manifesto, nas
  seções finais.
- **Segurança:** o pacote contém só arquivos versionados — **sem segredos, sem
  `node_modules`, sem `.env` real**. Os únicos "segredos" no código são **placeholders de
  teste** (ex.: senhas fake em `test/agentix-token.spec.ts`).
