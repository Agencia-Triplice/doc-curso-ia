# FUSÃO — Cockpit BEX (template idêntico) sobre o cérebro de produção

**Microsserviços afetados (pastas a alterar):**

- `dvop-bff-log-view` — **único serviço com mudança de código** (1 arquivo):
  `static/cockpit.html` (reescrita completa da página estática).

> Serviços apenas **envolvidos no fluxo** (consumidos pela página via HTTP), mas que
> **NÃO precisam de alteração** nesta entrega: `dvop-srv-log-process` (diagnóstico
> misto), `dvop-bff-curadoria` (agente/cura + propostas de remediação),
> `dvop-srv-remediation` (MS8, abre o PR) e `mcp-github` (gateway do GitHub). São
> listados só para contexto do impacto — nenhum contrato de API mudou.

---

> **Manifesto de mudança portável.** Este arquivo descreve UMA alteração de front-end.
> Diferente do `FIX-PROPOSTA-APROVAR-LOCK.md` (edições cirúrgicas "achar/substituir"),
> aqui a alteração é uma **reescrita completa** de um único arquivo estático, então o
> manifesto documenta o **mapa funcional** do que mudou (blocos, endpoints, marcadores),
> não trechos linha-a-linha. Uma IA em outro servidor deve: (1) ler este MD, (2) abrir a
> pasta `dvop-bff-log-view`, (3) substituir `static/cockpit.html` pela versão da fusão,
> (4) validar os caminhos da seção 6.

---

## 1. Resumo

| Campo | Valor |
|---|---|
| **Microserviço alvo (pasta)** | `dvop-bff-log-view` |
| **Arquivos alterados** | `static/cockpit.html` (reescrita: ~+1118 / −778 linhas vs. o reskin `2532f5c`) |
| **Tipo** | Reescrita de front-end — telas/fluxo do template BEX sobre os endpoints reais |
| **Risco** | Baixo — só front; nenhum endpoint novo; consome os mesmos contratos já usados |
| **Requer migração de banco?** | Não — nenhuma mudança de backend, contrato ou schema |

## 2. O que está sendo entregue

O `static/cockpit.html` que estava no ar era o **reskin BEX** (commit `2532f5c`): o
design system BEX aplicado **só ao CSS**, preservando o DOM/JS de produção — layout
antigo, visual novo. O usuário pediu que **todo o fluxo ficasse idêntico** ao template
`microservices/backup/cockpit-bex.html` ("precisa esta identico todo fluxo"), mas
**alimentado pelo backend real** — decisão escolhida: *"Template idêntico + dados REAIS
(fusão)"*.

Esta entrega troca o reskin pela **fusão**: as telas, a esteira animada, os cards de
parecer e de PR, o accordion de diff e o stepper vêm **do template**; os dados vêm dos
**endpoints reais**. Onde o backend ainda não devolve um campo do template, a UI mostra
o valor como **"exemplo"** (placeholder), em vez de inventar dado.

## 3. Telas e blocos do template incorporados

| Bloco do template | Origem visual | Fonte de dados |
|---|---|---|
| Header "Bex" + subtítulo, pílula "ao vivo · dados reais", contadores fila/base/cache, saúde dos serviços | `cockpit-bex.html` | `GET /api/estado` (real) |
| Entrada "Entrada do Diagnóstico" / "Analisar Pipeline" | template | input do usuário |
| "Linha de Diagnóstico em Tempo Real" — esteira (belt + máquinas/estações com ícones SVG) | template | dirigida pelo diagnóstico real (`runCascade`) |
| "Parecer do Diagnóstico & Solução" (cache exato/aproximado, base, cura, aguardando) | template | `POST /api/diagnostico/misto` + `GET /api/agente/cura/:fp` |
| "GitHub Enterprise" — card de disparo de PR | template | `POST /api/remediacao/proposta/:fp` + `/aprovar` |
| Accordion de diff multi-arquivo ("Arquivos da proposta") | template | `GET /api/remediacao/proposta/:fp` (arquivos reais) |
| Stepper do PR (etapas) | template | estados reais da proposta (`gerando/pronta/aprovar`) |

## 4. Endpoints reais consumidos (inalterados)

Nenhum é novo — são os mesmos que o cockpit de produção já usa:

- `POST /api/diagnostico/misto` `{message, github_token?}` → itens + diagnóstico + triagem
- `GET  /api/estado` → `{fila, base, cache, servicos[]}`
- `GET  /api/agente/cura/:fp` → `{pronto, prompt?, cura?}`
- `GET  /api/remediacao/aplicaveis/:fp` → `{disponivel, aplicaveis[]}`
- `POST /api/remediacao/proposta/:fp` `{instrucao, paths}` → dispara geração
- `GET  /api/remediacao/proposta/:fp` → `{estado, arquivos[], n_arquivos, n_linhas_diff}`
- `POST /api/remediacao/proposta/:fp/aprovar` `{}` → `{pr_url, pr_numero?}`

## 5. Campos "exemplo" — RESOLVIDOS (2026-09-03, fidelidade total)

Os 6 campos do template que apareciam como placeholder **foram preenchidos com dados
reais** (ver `FIX-COCKPIT-DADOS-REAIS.md`). Situação final:

1. **Branch do patch** — ✅ REAL. O MS8 já devolvia a branch no `PrOut`; a curadoria
   passou a repassá-la (`aprovar → pr_branch`) e o cockpit mostra a branch de fato criada.
2. **Quality gate** — ✅ REAL. Virou o **teto de escopo** (gate que `aprovar`/worker já
   aplicam): a curadoria expõe `teto {max_arquivos, max_linhas}` e o card mostra
   `N/max arquivos · M/max linhas ✓`.
3. **Revisores** — ✅ substituído por **"Escopo permitido"** = `paths_permitidos` reais
   (o guardrail que limita o PR). Não há conceito de revisor no backend; este é o dado
   real mais próximo e significativo.
4. **Diff linha-a-linha antes/depois** — ✅ REAL. A proposta já persistia
   `conteudo_atual` (além de `conteudo_novo`); o cockpit computa o diff LCS
   (vermelho/verde/contexto) no frontend.
5. **Contador de reúso "7×"** — ✅ já era real onde há dado (`sol.hits` → "Reuso: N hit(s)").
6. **Stepper fixo de ~10s** — ✅ já era real (dirigido pelas fases reais, com tempo decorrido).

MS8 (Java) **não foi tocado** — só a curadoria (passthrough) e o cockpit.

## 6. Verificação (QA feito no browser)

Servido localmente e validado os três caminhos, com **console limpo**:

1. **Cache-hit** → esteira → card de parecer → card "GitHub Enterprise" (com marcadores
   "exemplo") → fluxo de PR real (PR #142) → accordion "Arquivos da proposta" com o diff real.
2. **Escalado → cura** → a esteira anima `ms7 (curado) → ms5 (gravado ✓)`, badge
   "Solução Gravada no Cache Central", parecer com origem "Curadoria Especializada AgentiX".
3. **base_conhecimento** → `ms3 grounded ✓`, parecer com `Documentos: 2/2`, causa-raiz e tags.
4. **precisa_job** → dois chips de job para o usuário escolher.

Para reproduzir: servir a pasta `static/` (ou subir o BFF) e exercitar os três casos;
verificar que nenhum valor dinâmico quebra o layout e que o console não acusa erro.

## 7. Segurança (XSS)

Todo valor dinâmico é escapado com `esc()` (escapa `& < > " '`) e toda URL passa por
`safeHttpUrl()` (aceita **apenas** `http`/`https` — `javascript:`/`data:` são descartados),
o mesmo padrão já usado no support-chat. `pr_url` e demais URLs vindas do backend passam
pelo filtro antes de virarem `href`.

## 8. Deploy

- **Mirror** `GDD-Core/dvop-bff-log-view` branch `main` (o repo `bdc` local é single-branch
  `master`, **sem remote**). Push em `main` dispara CI (`ci-bff-node.yml@main`) → `cd.yml`.
- O waiver **`acs: false`** já está presente no `.github/workflows/ci.yml` do log-view
  (2 HIGH de OpenSSL herdadas da base Alpine — rearmar ao bumpar a base).
- CD exige as VMs Azure `vm-argo-cd` + `vm-aux` ligadas e os segredos
  `ESTEIRA_CONFIG_PAT` + `ARGOCD_AUTH_TOKEN`.

## 9. Rollback

`git revert` do commit da fusão devolve o `static/cockpit.html` ao **reskin BEX**
(`2532f5c`) — visual BEX sobre o DOM/JS antigo, sem o fluxo do template. Nenhuma migração
de banco foi feita; nada a desfazer no backend.

## 10. Limitação conhecida (não é regressão)

Os 6 campos da seção 5 ficam como **"exemplo"** até o backend os fornecer. Não são dados
falsos apresentados como reais — estão rotulados na UI — mas o card só ficará 100% fiel ao
template quando cada lacuna for preenchida por um contrato de backend correspondente.
