# FIX — Trava anti-duplo-PR no `aprovar` da curadoria

**Microsserviços afetados (pastas a alterar):**

- `dvop-bff-curadoria` — **único serviço com mudança de código** (3 arquivos):
  `src/propostas/proposta-store.service.ts`, `src/api/propostas.controller.ts`,
  `test/propostas.e2e-spec.ts`.

> Serviços apenas **envolvidos no fluxo** (chamadores/consumidores do `aprovar`), mas
> que **NÃO precisam de alteração** nesta correção: `dvop-bff-log-view` (cockpit que
> chama `aprovar`), `dvop-srv-remediation` (MS8, abre o PR) e `mcp-github` (gateway do
> GitHub). São listados só para contexto do impacto.

---

> **Manifesto de mudança portável.** Este arquivo descreve UMA alteração de código,
> arquivo por arquivo, com blocos "achar / substituir" exatos. Uma IA em outro
> servidor deve: (1) ler este MD, (2) abrir a pasta do microserviço alvo indicado
> abaixo, (3) localizar cada trecho "ANTES" **exatamente** como está e trocá-lo pelo
> "DEPOIS". Não reformatar o resto do arquivo. Aplicar as 3 edições na ordem dada.

---

## 1. Resumo

| Campo | Valor |
|---|---|
| **Microserviço alvo (pasta)** | `dvop-bff-curadoria` |
| **Arquivos alterados** | `src/propostas/proposta-store.service.ts` · `src/api/propostas.controller.ts` |
| **Tipo** | Correção de concorrência (race condition / TOCTOU) |
| **Risco** | Baixo — adiciona uma trava; não muda o caminho feliz de aprovação única |
| **Requer migração de banco?** | Não (só um novo valor de estado transitório: `aprovando`) |

## 2. O bug que está sendo corrigido

No endpoint `POST /v1/propostas/:fingerprint/aprovar`, a aprovação faz um
**check-then-act não atômico**:

1. lê a linha e verifica `estado === 'pronta'`;
2. `await ms8.aplicarPr(...)` (abre o PR no MS8 — cede o event loop);
3. só então grava `estado = 'pr_aberto'`.

Dois `aprovar` concorrentes para o **mesmo fingerprint** (ex.: o poll do cockpit
chamando `aprovar` + um clique na UI da curadoria, ou um duplo-clique) passam os
**dois** pelo check do passo 1 antes de qualquer um chegar ao passo 3. Resultado:
**o MS8 abre DOIS Pull Requests** (ele gera uma branch nova e única
`agentix-pr-{fingerprint}-{timestamp}` a cada chamada, então nada colide e os dois
PRs vingam).

> A store é `better-sqlite3` (síncrona) e o serviço roda em **réplica única**, então
> não há corrida no nível do banco — a corrida é **lógica**, na janela do `await`.

**A correção:** transição atômica de estado `pronta → aprovando` **antes** do
`await ms8.aplicarPr`. Como o `UPDATE ... WHERE estado='pronta'` do better-sqlite3 é
síncrono e atômico, apenas UM dos chamadores concorrentes obtém `changes === 1` e
prossegue; o outro recebe `409`. Se abrir o PR falhar, reverte `aprovando → pronta`
para permitir nova tentativa.

---

## 3. Edição 1 — `src/propostas/proposta-store.service.ts`

**Adicionar um novo método** `transicionarEstado` na classe `PropostaStore`.
Inserir **imediatamente antes** do método `listByEstado`.

### Achar (âncora — trecho existente, NÃO alterar):

```ts
  listByEstado(estado: string, limit: number): PropostaRow[] {
```

### Substituir por (novo método + a mesma âncora logo abaixo):

```ts
  /**
   * Transição atômica de estado (compare-and-swap): move a proposta de `de`
   * para `para` SOMENTE se ela ainda estiver em `de`. Como better-sqlite3 é
   * síncrono, o UPDATE condicional é atômico — dois `aprovar` concorrentes para
   * o mesmo fingerprint disputam aqui e só um vê `changes === 1`. Devolve `true`
   * para o vencedor, `false` se a proposta já não estava em `de`.
   */
  transicionarEstado(fingerprint: string, de: string, para: string, now: string): boolean {
    const result = this.db
      .prepare('UPDATE proposta_pr SET estado = ?, atualizado_em = ? WHERE fingerprint = ? AND estado = ?')
      .run(para, now, fingerprint, de);
    return result.changes === 1;
  }

  listByEstado(estado: string, limit: number): PropostaRow[] {
```

---

## 4. Edição 2 — `src/api/propostas.controller.ts` (bloco do check de estado)

Dentro do método `aprovar`, **logo após** o check do teto de escopo, inserir o
compare-and-swap `pronta → aprovando`.

### Achar (trecho existente):

```ts
    const nArquivos = row.n_arquivos ?? 0;
    const nLinhas = row.n_linhas_diff ?? 0;
    if (nArquivos > this.cfg.propostaMaxArquivos || nLinhas > this.cfg.propostaMaxLinhasDiff) {
      throw new HttpException({ detail: `teto de escopo excedido (arquivos=${nArquivos}, linhas=${nLinhas})` }, 409);
    }
```

### Substituir por:

```ts
    const nArquivos = row.n_arquivos ?? 0;
    const nLinhas = row.n_linhas_diff ?? 0;
    if (nArquivos > this.cfg.propostaMaxArquivos || nLinhas > this.cfg.propostaMaxLinhasDiff) {
      throw new HttpException({ detail: `teto de escopo excedido (arquivos=${nArquivos}, linhas=${nLinhas})` }, 409);
    }
    // TRAVA anti-duplo-PR: transição atômica `pronta` -> `aprovando` ANTES da
    // chamada ao MS 8. Dois `aprovar` concorrentes para o mesmo fingerprint
    // (poll do cockpit + clique na UI, ou duplo-clique) passariam os dois pelo
    // check `estado === 'pronta'` acima e abririam DOIS PRs, porque o estado só
    // virava `pr_aberto` depois do `await ms8.aplicarPr`. O CAS resolve isso no
    // SQLite (better-sqlite3 é síncrono): só um vê changes===1.
    if (!this.store.transicionarEstado(fingerprint, 'pronta', 'aprovando', this.nowIso())) {
      throw new HttpException(
        { detail: 'proposta já está sendo aprovada ou já foi aprovada' },
        409,
      );
    }
```

---

## 5. Edição 3 — `src/api/propostas.controller.ts` (chamada ao MS8)

Ainda no método `aprovar`, envolver a chamada `ms8.aplicarPr` em try/catch que
reverte `aprovando → pronta` se abrir o PR falhar (senão a proposta ficaria presa
em `aprovando`).

### Achar (trecho existente):

```ts
    const pedido = {
      fingerprint,
      servico: row.servico,
      assinatura: row.assinatura ?? '',
      titulo: row.titulo_pr,
      corpo: row.corpo_pr,
      arquivos: arquivosPr,
      branch_base: branchBase,
    };
    const pr = await this.ms8.aplicarPr(pedido);
```

### Substituir por:

```ts
    const pedido = {
      fingerprint,
      servico: row.servico,
      assinatura: row.assinatura ?? '',
      titulo: row.titulo_pr,
      corpo: row.corpo_pr,
      arquivos: arquivosPr,
      branch_base: branchBase,
    };
    let pr: { pr_numero?: number | null; pr_url?: string | null };
    try {
      pr = await this.ms8.aplicarPr(pedido);
    } catch (e) {
      // falhou ao abrir o PR: devolve a proposta a `pronta` para permitir nova
      // tentativa (o CAS da etapa anterior a havia movido para `aprovando`).
      this.store.transicionarEstado(fingerprint, 'aprovando', 'pronta', this.nowIso());
      throw e;
    }
```

> O restante do método (`this.store.atualizar(fingerprint, { estado: 'pr_aberto', ... })`)
> permanece inalterado — só o vencedor do CAS chega até ali, partindo de `aprovando`.

---

## 5.1 Edição 4 — `test/propostas.e2e-spec.ts` (mock da store + testes novos)

O mock da store usado nos testes precisa expor o novo método, senão os testes de
`aprovar` quebram com `500 (unhandled exception)`.

### 4a — achar:

```ts
  const store = {
    criarGerando: jest.fn(),
    get: jest.fn(),
    atualizar: jest.fn(),
    delete: jest.fn(),
  };
```

### 4a — substituir por:

```ts
  const store = {
    criarGerando: jest.fn(),
    get: jest.fn(),
    atualizar: jest.fn(),
    delete: jest.fn(),
    // CAS de estado (trava anti-duplo-PR): default = vencedor (true).
    transicionarEstado: jest.fn().mockReturnValue(true),
  };
```

### 4b — adicionar dois testes (achar a âncora abaixo e inserir ANTES dela):

Âncora:

```ts
  it('aprovar envia branch_base = a branch da run do órfão do caso', async () => {
```

Inserir antes:

```ts
  it('aprovar concorrente: perdedor do CAS pronta→aprovando recebe 409 e NÃO abre PR', async () => {
    store.get.mockReturnValueOnce({
      fingerprint: 'fp',
      estado: 'pronta',
      servico: 'org/app',
      titulo_pr: 't',
      corpo_pr: 'c',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_novo: 'x' }]),
      n_arquivos: 1,
      n_linhas_diff: 1,
    });
    // outro request já pegou a transição pronta→aprovando: este perde o CAS
    store.transicionarEstado.mockReturnValueOnce(false);
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    expect(r.status).toBe(409);
    expect(ms8.aplicarPr).not.toHaveBeenCalled();
  });

  it('aprovar reverte aprovando→pronta se o MS 8 falhar ao abrir o PR', async () => {
    store.get.mockReturnValue({
      fingerprint: 'fp',
      estado: 'pronta',
      servico: 'org/app',
      titulo_pr: 't',
      corpo_pr: 'c',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_novo: 'x' }]),
      n_arquivos: 1,
      n_linhas_diff: 1,
    });
    ms8.aplicarPr.mockRejectedValueOnce(new Error('MS8 fora'));
    await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    // após tentar (e falhar) abrir o PR, o estado volta para pronta p/ retry
    expect(store.transicionarEstado).toHaveBeenCalledWith('fp', 'aprovando', 'pronta', expect.any(String));
  });

```

> **Validado nesta base:** após as 4 edições, `npm run build` compila e `npm test`
> passa **507/507** (35 suites). Sem as edições, 10 testes falham.

## 6. Verificação (rodar na pasta `dvop-bff-curadoria`)

```bash
npm ci
npm run build      # o TypeScript deve compilar sem erros
npm test           # a suíte existente deve continuar verde
```

Teste manual do comportamento corrigido (dois `aprovar` concorrentes → 1 PR):

1. Deixar uma proposta em estado `pronta`.
2. Disparar dois `POST /v1/propostas/{fp}/aprovar` praticamente ao mesmo tempo.
3. **Esperado:** exatamente um responde `200` com `estado: pr_aberto`; o outro responde
   `409` (`proposta já está sendo aprovada ou já foi aprovada`). Apenas **um** PR no GitHub.

Sugestão de teste automatizado (adicionar ao `*.e2e-spec.ts` ou spec do controller):
com um `ms8.aplicarPr` mockado que demora, chamar `aprovar` duas vezes em paralelo
(`Promise.allSettled`) e afirmar que `aplicarPr` foi chamado **uma única vez**.

## 7. Rollback

Reverter as 3 edições (remover o método `transicionarEstado` e desfazer os dois
trechos do `aprovar`). Nenhuma migração de banco foi feita; linhas eventualmente
deixadas em `aprovando` por um crash podem ser devolvidas a `pronta` via
`regenerar` (que faz upsert e volta o estado) ou por um `UPDATE` manual.

## 8. Limitação conhecida (não é regressão)

Se o pod cair **entre** o CAS (`aprovando`) e o `aplicarPr`, a linha fica presa em
`aprovando` sem PR e sem retry automático. É uma janela rara. Mitigações possíveis
(fora do escopo desta correção): um "sweep" que devolve `aprovando` antigo a `pronta`
após N minutos, ou permitir `regenerar` a partir de `aprovando`.
