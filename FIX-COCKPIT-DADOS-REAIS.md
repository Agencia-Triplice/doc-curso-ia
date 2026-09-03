# FIDELIDADE — preenche os campos "exemplo" do cockpit com dados reais

**Microsserviços afetados (pastas a alterar):**

- `dvop-bff-curadoria` — backend (1 arquivo de código + 1 de teste):
  `src/api/propostas.controller.ts`, `test/propostas.e2e-spec.ts`.
- `dvop-bff-log-view` — passthrough + front (2 arquivos):
  `src/api/remediacao.controller.ts`, `static/cockpit.html`.

> Serviços **envolvidos no fluxo** mas **NÃO alterados**: `dvop-srv-remediation`
> (MS8 — já devolvia a branch no `PrOut`, nada a mudar) e `mcp-github` (gateway).

---

> **Manifesto de mudança portável.** Uma IA em outro servidor deve: (1) ler este MD,
> (2) aplicar as edições de backend na curadoria, (3) aplicar o passthrough + a
> reescrita de front no log-view, (4) validar pela seção 6. Complementa
> `FIX-COCKPIT-FUSAO-BEX.md` (que entregou a fusão; aqui os campos "exemplo" viram reais).

---

## 1. Resumo

| Campo | Valor |
|---|---|
| **Tipo** | Fidelidade de dados — troca placeholders "exemplo" por dados reais |
| **Backend** | `dvop-bff-curadoria` expõe `teto` (gate) e repassa `pr_branch` (branch real do MS8) |
| **Front** | `dvop-bff-log-view/static/cockpit.html`: diff real antes/depois + card de PR sem placeholders |
| **MS8 (Java)** | **Intocado** — `PrOut` já traz `branch`; a curadoria só passou a repassá-la |
| **Migração de banco?** | Não — `pr_branch` é anexado à resposta (não é coluna); `teto` vem da config |
| **Risco** | Baixo — adição de campos na resposta (compatível) + render de dados já existentes |

## 2. O que estava "exemplo" e virou real

O `FIX-COCKPIT-FUSAO-BEX.md` entregou a fusão com 6 campos do template marcados
"exemplo" (o backend não os devolvia). A investigação mostrou que **quase todos já
tinham fonte real** — só não estavam ligados:

| Campo | Antes | Depois |
|---|---|---|
| Diff antes/depois | "conteúdo novo" (sem par) | LCS de `conteudo_atual`×`conteudo_novo` (já persistidos) |
| Branch do patch | nome fabricado + "exemplo" | `pr_branch` real do MS8 (via `aprovar`) |
| Quality gate | "JaCoCo·Sonar" fixo | teto de escopo real: `N/max arquivos · M/max linhas` |
| Revisores | "Squad Core" fixo | **Escopo permitido** = `paths_permitidos` reais |
| Reúso "7×" | — | já real onde há dado (`sol.hits`) |
| Stepper 10s | — | já real (fases reais + tempo decorrido) |

## 3. Curadoria — `src/api/propostas.controller.ts`

### 3a. Helper do teto + `obter` expõe `teto`

Adiciona `tetoEscopo()` e inclui `teto` na resposta do GET proposta:

```ts
private tetoEscopo(): { max_arquivos: number; max_linhas: number } {
  return { max_arquivos: this.cfg.propostaMaxArquivos, max_linhas: this.cfg.propostaMaxLinhasDiff };
}

@Get('propostas/:fingerprint')
obter(@Param('fingerprint', FingerprintPipe) fingerprint: string) {
  return { ...this.toOut(this.obterOu404(fingerprint)), teto: this.tetoEscopo() };
}
```

### 3b. `remediacoes-aplicaveis` também expõe `teto`

```ts
return { aplicaveis, total: aplicaveis.length, teto: this.tetoEscopo() };
```

### 3c. `aprovar` repassa a branch REAL do MS8

O tipo da resposta do MS8 ganha `branch?`; a resposta do endpoint ganha `pr_branch`:

```ts
let pr: { pr_numero?: number | null; pr_url?: string | null; branch?: string | null };
// ... (aplicarPr / atualizar inalterados) ...
return { ...this.toOut(atualizado), pr_branch: pr.branch ?? null };
```

## 4. Log-view — `src/api/remediacao.controller.ts`

O wrapper de `aplicaveis` (o resto já é passthrough) passa `teto` adiante:

```ts
return { disponivel: true, aplicaveis: r?.aplicaveis ?? [], total: r?.total ?? 0, teto: r?.teto };
```

## 5. Log-view — `static/cockpit.html`

- **`renderDiffReal`**: reescrito para diff real linha-a-linha. Novos helpers
  `lcsDiff(a,b)` (LCS clássico, guarda de custo em 2000 linhas → cai no "novo conteúdo"),
  `comContexto(rows, 3)` (colapsa trechos sem alteração), `diffRowHtml(r)`. Por arquivo:
  excluir → tudo removido; novo (sem `conteudo_atual`) → tudo adicionado; editar → diff LCS.
- **Card de PR** (`renderPrDispatchCard` + `oferecerAbrirPr`): `patchBranch` deixa de ser
  fabricado (pré-despacho: "criada no despacho"; sucesso: branch real); `qualityGate` = teto
  real; linha "Revisores" → **"Escopo permitido"** (`paths_permitidos`). Remove os selos
  `.pr-meta-ex` "exemplo" (e o CSS órfão).
- **`dispararPrReal`**: pós-geração atualiza o gate com o escopo REAL medido
  (`n_arquivos/n_linhas` vs `teto`); `prSucesso` recebe `aberto.pr_branch` (branch real).

## 6. Verificação

- `dvop-bff-curadoria`: `npm run build` + `npm test` → **508/508** (35 suites).
- `dvop-bff-log-view`: `npm run build` OK; testes verdes exceto 3 suites SQLite-nativo
  (`better-sqlite3` build local/WSL — passam no CI Linux). Área alterada
  (`api-remediacao-pr.e2e-spec`) verde.
- Cockpit: syntax-check do JS inline OK; lógica LCS validada (add/del/contexto e
  reconstrução do "novo" a partir de ctx+add).
- Manual: analisar erro elegível → card de PR mostra base/patch/gate/escopo reais →
  despachar → diff real antes/depois (vermelho×verde) → sucesso com a branch real.

## 7. Rollback

`git revert` dos dois commits (curadoria + log-view). As respostas voltam a não trazer
`teto`/`pr_branch` (campos extras, compatíveis) e o cockpit volta aos placeholders
"exemplo". Nenhuma migração de banco a desfazer.

---

## 8. Layout — card do PR sob o diagnóstico + solução colapsada

Ajuste **só de front** (`dvop-bff-log-view/static/cockpit.html`, mesmo arquivo da
seção 5) para casos **com remediação de PR**: o card do GitHub sobe para logo abaixo
do "Diagnóstico da Falha & Causa Raiz", e a solução do cache/curadoria desce para
baixo do card, colapsada como o "Ver assinatura de log e evidência bruta". Sem PR
aplicável, a solução segue como card principal (não-regressão). Nada de backend.

| | Ordem no `review-container` |
|---|---|
| **Antes** | Diagnóstico · **solução (card grande)** · `#pr-slot` (PR ia pro fim) |
| **Depois (com PR)** | Diagnóstico · **card do PR (`#pr-slot`)** · **solução colapsada** (`#sol-slot`) |
| **Depois (sem PR)** | Diagnóstico · `#pr-slot` vazio · **solução (card grande)** — inalterado |

### 8a. `renderParecerCache` / `renderParecerCura`

- `#pr-slot` movido para **logo após** `causaRaizHtml(...)`/`contextoCuraHtml(...)`.
- A solução (`.resp-sol`) foi encapsulada num `<div id="sol-slot">` que a segue —
  por padrão, o card verde grande de sempre.
- O texto da solução é guardado numa var de módulo `SOL_PENDENTE = {titulo, texto}`
  para poder descer colapsado se houver PR.

### 8b. `oferecerAbrirPr`

Ao renderizar o card do PR (`slot.innerHTML = renderPrDispatchCard(...)`), colapsa
o `#sol-slot`:

```js
var solSlot = $("sol-slot");
if(solSlot && SOL_PENDENTE) solSlot.innerHTML = logboxHtml(SOL_PENDENTE.titulo, SOL_PENDENTE.texto);
```

`logboxHtml` produz o mesmo `<details class="logbox">` (fechado) do log bruto.

### 8c. Não-regressão

- **Sem PR aplicável**: `oferecerAbrirPr` retorna cedo (antes do render do card),
  o `#sol-slot` nunca é tocado e a solução fica como card principal.
- **`base_conhecimento`**: não tem `#sol-slot`; o guard `if(solSlot && ...)` no-op.
- O diff real do PR (`renderDiffReal`, seção 5) continua sendo injetado **dentro**
  do `#pr-slot`, portanto acima da solução colapsada.

### 8d. Verificação e deploy

- Syntax-check do JS inline: **OK** (1 bloco `<script>`, sem erro).
- Commit `9294792` (bdc) → espelho `GDD-Core/dvop-bff-log-view` (`sync: bdc 3cb05c1`)
  → CI/CD **verde** (Sonar ✓, Mend ✓, ACS waived, **`cd/cd` ✓** com `argocd sync` OK).
- Rollback: `git revert 9294792` — volta ao layout com a solução acima do `#pr-slot`.
