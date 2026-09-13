# Diagnóstico automático de falha de CI (piloto on-failure → cockpit)

Documentação completa e **guia de porte** do recurso "quando a esteira falha, o run se
auto-diagnostica": um job dispara **só na falha**, manda o job falho ao **cockpit**,
recebe o diagnóstico + a cura conhecida e escreve tudo no **log**, no **resumo do job**,
num **Check Run** e (em PR) num **comentário sticky**.

- **Repo de referência:** `GDD-Core/dvop-srv-demo` (test bed).
- **Cockpit consumido:** `dvop-bff-log-view` (NestJS), endpoint `POST /api/cockpit/analisar`.
- **Status:** validado ponta a ponta AO VIVO em 2026-09-10/11 (log + resumo + Check Run +
  4 estados do mascote). Comentário/label de PR implementados; não exercitados ao vivo
  (o test bed publica por `push`, não por PR).
- **Autonomia:** só **diagnóstico + sugestão**. **Nunca abre PR**, nunca reexecuta jobs,
  nunca altera o `conclusion` do run. *(Auto-abrir PR é a Fase 2, desenhada e pausada — §12.)*

---

## 0. ⭐ Porte para OUTRO servidor onde o cockpit JÁ funciona — leia primeiro

> Cenário: você vai levar isso para outro cluster/servidor que **já tem o cockpit
> (`dvop-bff-log-view`) no ar**. Sua intuição foi "só preciso mexer no reusable caller".
> **Quase** — o job de diagnóstico é **inline no _caller_** (o `ci.yml` do repo), então
> mexer no caller é o principal. Mas há **4 peças** que precisam existir no destino, e
> uma delas é do lado do cockpit (apesar de ele "já funcionar"): **os mascotes**.

### O que existe onde (mapa mental antes de portar)

| Peça | Onde vive | Chama reusable? |
|------|-----------|-----------------|
| `esteira` (build/test) | reusable `GDD-Core/esteiras-workflows/.github/workflows/ci-srv-java.yml` | ✅ o caller só faz `uses:` |
| `cd` (deploy) | reusable `esteiras-workflows/.github/workflows/cd.yml` | ✅ idem |
| **`diagnostico-falha`** | **inline no caller** (`.github/workflows/ci.yml` do repo) | ❌ **é o caller** |
| Scripts `.github/diagnostico/*.sh` | **no repo** (checkout do caller) | — |
| **Mascotes `mascote-*.webp`** | **`static/` do cockpit** (`dvop-bff-log-view`) | — |

### Checklist mínimo do porte (cockpit já no ar)

1. **No repo alvo (o "caller"):**
   - Copie o job **`diagnostico-falha`** para o `.github/workflows/ci.yml` (bloco completo
     — `needs:`, `if: ${{ failure() }}`, `continue-on-error: true`, `permissions:` e o
     `run:` inteiro; ver §5).
   - Copie a pasta **`.github/diagnostico/`** inteira (scripts + `test/` + `golden/` +
     `banner-*.txt`). O job roda `bash .github/diagnostico/*.sh` do **checkout**, então
     os scripts têm de estar no repo.
2. **Repo variables** (Settings → Secrets and variables → Actions → *Variables*):
   - `COCKPIT_ANALISAR_URL` — endpoint interno do cockpit no cluster alvo
     (ex.: `http://dvop-bff-log-view.<ns>.svc.cluster.local:8080/api/cockpit/analisar`).
   - `COCKPIT_WEB_URL` — **host público** do cockpit no destino
     (ex.: `https://cockpit.<seu-dominio>/#/`). Dele o ci.yml **deriva** a URL dos mascotes.
   - `MASCOTE_URL` / `MASCOTE_BASE_URL` — **opcionais** (só se não quiser derivar do
     `COCKPIT_WEB_URL`).
3. **Runner com acesso ao cockpit.** O job usa `runs-on: [self-hosted, cockpit-diag]`
   porque o endpoint `analisar` é **interno** (`*.svc.cluster.local`). Se o cluster alvo
   já tem um runner in-cluster com esse label, nada a fazer. Senão, provisione-o (§4.1).
4. **Mascotes no cockpit alvo (⚠️ é do lado do cockpit, não do caller).** Mesmo com o
   cockpit "funcionando", os **arquivos `mascote-*.webp` só aparecem se estiverem no
   `static/` daquela build**. Coloque os 5 assets em `dvop-bff-log-view/static/` e
   **republish o cockpit** no destino — ou aponte `MASCOTE_URL` para outro host público.
   Detalhe completo em §6.

> **Resumo honesto:** mexer no caller = maior parte. Mas confirme também (a) os scripts no
> repo, (b) as repo variables, (c) um runner `cockpit-diag`, e (d) **os mascotes servidos
> pelo cockpit alvo**. Só o (d) exige tocar o lado do cockpit.

### Alternativa: extrair o job para um reusable (deixa o caller magro)

Se você mantém **vários repos**, em vez de copiar o job + scripts em cada um, dá para mover
o `diagnostico-falha` (e a pasta `.github/diagnostico/`) para dentro de
`GDD-Core/esteiras-workflows` como um **reusable workflow** (`on: workflow_call`); aí cada
caller só adiciona um job `uses: GDD-Core/esteiras-workflows/.github/workflows/diagnostico-falha.yml@main`
com `if: ${{ failure() }}` e passa as vars por `with:`. É a "extração para a frota" (Fase
2 de empacotamento). **Não foi feito ainda** — hoje é inline no caller.

---

## 1. Objetivo

Fechar o laço de ingestão de falhas de CI **por push** (a esteira reporta sozinha) em vez
de **por pull** (um humano colar o link do run no cockpit). Quando a pipeline falha, um job
dedicado:

1. descobre **quais jobs falharam**;
2. manda cada job falho ao **cockpit**, que classifica o erro por _fingerprint_ e devolve,
   quando existe, a **cura** cadastrada pela curadoria;
3. escreve o diagnóstico em **múltiplas superfícies** (log, resumo, PR, Check Run).

O resultado: em vez de um ❌ seco, o desenvolvedor recebe "esse erro já é conhecido, a
solução é X" ou "erro novo, encaminhado à curadoria".

---

## 2. Arquitetura / fluxo

```
push/PR ─▶ job "esteira" (CI real) ──(falhou)──▶ job "diagnostico-falha"
                                                        │
                                    ┌───────────────────┼─────────────────────┐
                                    ▼                    ▼                     ▼
                          GET /actions/runs/     POST cockpit           (por job falho)
                          {id}/jobs  (quais       /api/cockpit/analisar
                          jobs falharam)          {message:<job_url>,
                                    │              github_token}
                                    │                    │
                                    │           resposta JSON (desfecho/solucao)
                                    ▼                    ▼
                        render-log.sh          render-summary.sh
                        (LOG, texto ANSI)      (markdown)   ▲
                                │                    │      └─(cockpit fora do ar)
                                │                    │         heuristic-diagnose.sh
                                ▼          ┌─────────┼──────────┬─────────────┐
                          (LOG do job)     ▼         ▼          ▼             ▼
                               $GITHUB_STEP_SUMMARY  post-    label no PR   post-check-run.sh
                                (resumo do job)      pr-comment (issues API) (Check Run)
```

Por que runner **in-cluster** (label `cockpit-diag`): o cockpit só é acessível pela rede
interna do cluster (`*.svc.cluster.local`). Um runner GitHub-hosted (`ubuntu-latest`) **não
alcança** o ClusterIP. Sem exposição pública e **sem segredo no caminho da requisição** — o
PAT é credencial de **registro** do runner, não da chamada ao cockpit.

---

## 3. Componentes (arquivos)

| Arquivo | Papel |
|---|---|
| `.github/workflows/ci.yml` (job `diagnostico-falha`) | Orquestra: resolve jobs falhos, chama o cockpit, dispara os renderizadores, comentário/label no PR e o Check Run. |
| `.github/diagnostico/render-log.sh` | Escreve no **LOG** (stdout): `::notice/::warning::` + **banner de texto** figlet + campos + solução formatada. Só texto/ANSI. |
| `.github/diagnostico/render-summary.sh` | Escreve o **markdown** do resumo/PR: mascote (imagem), badges shields.io, admonitions, solução em lista, `<details>` do erro cru, comando copiável. |
| `.github/diagnostico/post-pr-comment.sh` | Publica/atualiza um comentário **sticky** no PR (idempotente por marcador). |
| `.github/diagnostico/post-check-run.sh` | Cria um **Check Run** (`POST /repos/{repo}/check-runs`, `conclusion=neutral`) com o markdown, visível na aba de checks. |
| `.github/diagnostico/heuristic-diagnose.sh` | **Modo degradado:** quando o cockpit não responde, baixa o log do job (`/actions/jobs/{id}/logs`) e faz um palpite por `grep`. |
| `.github/diagnostico/banner-{conhecido,novo,erro}.txt` | Banners de texto pré-renderizados (figlet **ansi_shadow**), um por estado. |
| `.github/diagnostico/test/*.test.sh` + `fixtures/*.json` + `golden/*.md` | Testes por substring, sem rede. Inclui golden/snapshot e o teste do modo degradado. |
| **`dvop-bff-log-view/static/mascote-*.webp` + `agentix.png`** | **(lado do cockpit)** a arte animada do resumo, servida pelo host público do cockpit. |

Todos os `.sh` são **best-effort**: `set -uo pipefail` e sempre `exit 0` — o diagnóstico
nunca pode derrubar o run.

---

## 4. Pré-requisitos

### 4.1 Runner in-cluster (frente de infra — GitOps)

Só necessário se o cluster alvo **ainda não** tem um runner com o label do job.

| Item | Valor de referência (test bed) |
|------|-------------------------------|
| Deployment | `gh-runner` (ns `dev`), imagem `myoung34/github-runner` (Docker Hub, pull anônimo) |
| Modo | `EPHEMERAL=true`, escopo **repo**, **label `cockpit-diag`** |
| Root/SCC | `runAsUser:0` + `RUN_AS_ROOT=true` + RoleBinding `anyuid` (MicroShift) |
| Credencial | PAT `github-runner-pat` no Key Vault, via **CSI** (padrão `secretEnv` do chart `bff-node`). Escopo `repo` (registration-token nível-repo). É credencial de **registro**, não da requisição. |
| GitOps | ArgoCD app `gh-runner` → `gitops-cluster` path `apps/gh-runner` (autosync); `Application` em `apps/children/gh-runner.yaml` |
| Egress | O pod precisa alcançar `api.github.com` (registro + resolver job falho). |

### 4.2 Cockpit (backend consumido — **inalterado**)

- `dvop-bff-log-view`, porta 8080, DNS interno + host público que serve `static/`
  (`ServeStaticModule`, rootPath `join(__dirname,'..','static')`).
- Endpoint: `POST /api/cockpit/analisar` (não tem `AuthGuard` — aceitável porque o acesso é
  só por DNS interno do cluster; nenhuma rota pública nova).

### 4.3 Ferramentas / permissões / token

- **Runner:** `curl` e `jq` (há _guard_ que pula a etapa se faltarem).
- **`permissions:` do job:** `actions: read` (listar jobs + baixar log no modo degradado),
  `contents: read` (checkout), `pull-requests: write` (comentar), `checks: write` (Check
  Run), `issues: write` (label — a API de labels é a de _issues_).
- **Token:** `${{ github.token }}` (`GITHUB_TOKEN`). O Check Run precisa do **SHA do commit**
  em `CHECK_SHA` (`github.event.pull_request.head.sha || github.sha`).
- **Labels pré-criadas** (opcional): `ci:erro-conhecido`, `ci:erro-novo`,
  `ci:diagnostico-indisponivel`. Se não existirem, a API responde 422 e o passo **ignora**.

---

## 5. O job `diagnostico-falha` (ci.yml — verbatim)

O `esteira`/`cd` são reusables; **`diagnostico-falha` é inline** no caller:

```yaml
diagnostico-falha:
  needs: [esteira]
  if: ${{ failure() }}
  runs-on: [self-hosted, cockpit-diag]
  timeout-minutes: 3
  continue-on-error: true       # nunca derruba o run
  permissions:
    actions: read
    contents: read
    pull-requests: write        # comentar o diagnóstico no PR
    checks: write               # criar Check Run
    issues: write               # rotular o PR conforme o estado
  steps:
    - name: Checkout
      uses: actions/checkout@v4
    - name: Diagnosticar falha no cockpit
      env:
        GH_TOKEN: ${{ github.token }}
        COCKPIT_ANALISAR_URL: ${{ vars.COCKPIT_ANALISAR_URL }}
        COCKPIT_WEB_URL: ${{ vars.COCKPIT_WEB_URL }}       # host público → deriva a base do mascote
        MASCOTE_URL: ${{ vars.MASCOTE_URL }}                # opcional; imagem única fixa (vence tudo)
        MASCOTE_BASE_URL: ${{ vars.MASCOTE_BASE_URL }}      # opcional; base p/ mascote-<estado>.webp
        PR_NUMBER: ${{ github.event.pull_request.number }}
        CHECK_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
      run: |
        # (corpo completo no arquivo real; ver .github/workflows/ci.yml)
```

Lógica do passo (o `run:` real, resumido):

1. **Guards** de dependência (`curl`/`jq`) e de config (`COCKPIT_ANALISAR_URL`).
2. **Deriva `MASCOTE_BASE_URL`** do `COCKPIT_WEB_URL` (tira `#/…` e a barra final) quando a
   var não veio explícita — assim o mascote sai do host público do próprio cockpit.
3. `GET /repos/{repo}/actions/runs/{run_id}/jobs` → filtra `conclusion=="failure"`, exclui o
   próprio `diagnostico-falha`, monta `"<html_url>\t<nome>\t<passo>"` (passo = nº do 1º passo
   falho, p/ deep-link `#step:N:1`). Sem jobs, cai no URL do run inteiro.
4. Se **>1 job** falhou, escreve um **índice** ("N jobs falharam") no topo do resumo.
5. Para **cada** job: monta `display_url` (URL limpa + `#step:N:1`), faz `POST` ao cockpit
   com `{message:<url_limpa>, github_token}` (o anchor **não** vai ao cockpit), renderiza
   `render-log.sh` (LOG) e `render-summary.sh` (markdown acumulado num `mktemp`). **Se o
   cockpit não devolver JSON válido**, chama `heuristic-diagnose.sh` (modo degradado).
6. `cat` do markdown em `$GITHUB_STEP_SUMMARY`.
7. Se `PR_NUMBER` existe: `post-pr-comment.sh` (sticky) **e** aplica a label conforme o
   marcador `<!-- estado:X -->`.
8. Cria o **Check Run** (`post-check-run.sh "neutral"`).

> Passar a URL **com `/job/<id>`** faz o cockpit importar o job exato em vez de responder
> `precisa_job`. O anchor `#step:N:1` é só para exibição.

---

## 6. ⚠️ Mascotes — onde precisam estar (crítico para o porte)

A imagem do resumo/PR é o mascote da SARA/AgentiX, **servido pelo próprio cockpit**.

### Arquivos e estados

| Estado | Arquivo | Pose |
|---|---|---|
| `conhecido` (com solução, sem PR) | `mascote-conhecido.webp` | joinha 👍 |
| `conhecido` + PR disponível | `mascote-pr.webp` | chave-inglesa + `</>` |
| `novo` (não catalogado) | `mascote-novo.webp` | pata no queixo + `?` |
| `indisponivel` | `mascote-indisponivel.webp` | ombros / palmas |
| fallback estático | `agentix.png` | — |

*(Neste pacote, os 5 arquivos já estão no lugar certo: `dvop-bff-log-view/static/`.)*

### Onde colocá-los no destino

Os arquivos vão em **`dvop-bff-log-view/static/`** do cockpit alvo e viajam com a
aplicação — ficam acessíveis em `https://<host-público-do-cockpit>/mascote-<estado>.webp`.
**Mesmo que o cockpit já esteja no ar, os `.webp` só aparecem se estiverem naquela build.**
Então, no servidor novo:

1. Copie os 5 arquivos para `dvop-bff-log-view/static/`.
2. **Republish o cockpit** (no ecossistema GDD, via `tools/sync-espelhos.ps1 -Apps
   dvop-bff-log-view` → CI/CD → ArgoCD; o front é embutido na imagem). *(GOTCHA conhecido:
   a esteira do log-view pode reprovar no gate Mend/Trivy por `multer` transitivo — fixe com
   `overrides:{"multer":"2.3.0"}` no `package.json`.)*
3. Confirme `curl -I https://<host>/mascote-conhecido.webp` → `200 image/webp`.

### Como a URL é resolvida (não precisa editar script)

`MASCOTE_URL` (imagem única fixa, **vence**) > `MASCOTE_BASE_URL` > **derivar do
`COCKPIT_WEB_URL`** (tira `#/…`) > **omitir** o `<img>`. Ou seja: basta ter
`COCKPIT_WEB_URL` público correto e os arquivos no `static/`.

### Por que servir pelo cockpit (e não por github-raw)

- **base64/data-URI é removido** pelo GitHub markdown (github/markup#270) → precisa **URL
  pública**.
- O proxy **camo** do GitHub **não autentica** raw de repo privado **nem** alcança um host
  interno (`*.svc.cluster.local`). O cockpit **já tem host público** → é o lugar natural.
- **Cache camo:** o cockpit devolve `cache-control: max-age=0` + ETag por tamanho+mtime →
  **substituir o arquivo com o MESMO nome já busta o cache** (não precisa `?v=` nem versionar
  o nome).

### Formato / geração (contexto)

WebP **animado transparente** (alpha 8-bit, loop boomerang), **320 px, quality 84, method 6
≈ 3 MB** cada. GIF (alpha 1-bit) dá chuvisco no pelo; APNG pesa 3–6 MB — ambos descartados.
Não encolher demais: o summary exibe em HiDPI e faz upscale → <320 px pixeliza. Geração
(Magnific): still `images_generate` ~75 cr + vídeo `kling-25` 720p 5s ~140 cr por pose;
matte custom por dominância de canal (o `chromakey` do ffmpeg come o ciano da raposa).

---

## 7. O que renderiza onde — e por quê

### LOG do job (`render-log.sh`) — só texto/ANSI
- O log renderiza **ANSI 24-bit** mas **não renderiza imagens**. Toda arte é texto.
- **Banner:** figlet **ansi_shadow** pré-renderizado em `banner-*.txt` (gerado offline por
  `pyfiglet`), impresso colorido/indentado. Nítido porque usa a grade do terminal.
- **LIÇÃO cara:** arte de caractere de imagem (half-block, quadrantes, chafa, badge
  PNG→ANSI) **sempre fica pixelada** no log — tudo testado e descartado. No log ficou **só
  texto**; o mascote (imagem) fica **fora** do log.

### Resumo do job e comentário no PR (`render-summary.sh`) — markdown rico
- **Mascote animado por estado** via `<img src=URL_pública width=120 align=right>` (§6).
- **Badges shields.io:** status (`erro CONHECIDO/NOVO`), **confiança** (alta=verde /
  média=âmbar / baixa=vermelho), `servico`, `fingerprint`. Encoding `enc()`: `-`→`--`,
  `_`→`__`, espaço→`%20`; rótulos **sem acento**.
- **Admonitions nativas:** `[!TIP]` (conhecido) / `[!WARNING]` (novo) / `[!CAUTION]`
  (indisponível). Renderizam nativamente no resumo e em comentários (validado ao vivo).
- **Assinatura enxuta** (120 chars) + erro cru completo em `<details>Ver erro completo</details>`.
- **Solução como lista ordenada** + **comando copiável** em ```` ```bash ```` quando detecta
  um comando (`mvn|git|npm|docker|kubectl|...`).

### Comentário no PR (`post-pr-comment.sh`)
- **Sticky** por marcador `<!-- cockpit-diag -->` — atualiza o mesmo comentário em vez de
  empilhar. Best-effort.

### Check Run e label
- **Check Run** `neutral` (não reprova o PR — é informativo). `summary` cortado a ~60k.
- **Label:** o `render-summary.sh` emite `<!-- estado:conhecido|novo|indisponivel -->`; o
  ci.yml faz `grep` e aplica a label correspondente.

### i18n por env (sem editar script)
- `render-summary.sh`: `DIAG_TITLE`, `DIAG_TIP_KNOWN`, `DIAG_WARN_NEW`, `DIAG_CAUTION`,
  `DIAG_SOLUCAO_TITLE`, `DIAG_PR_TITLE`, `DIAG_CMD_TITLE`, `DIAG_DETAILS_SUMMARY`,
  `DIAG_NEW_BODY` (+ `MASCOTE_URL`/`MASCOTE_BASE_URL`).
- `render-log.sh`: `DIAG_LOG_TITLE`, `DIAG_LOG_KNOWN`, `DIAG_LOG_NEW`, `DIAG_LOG_UNAVAIL`,
  `DIAG_LOG_SERVICO`, `DIAG_LOG_FINGERPRINT`, `DIAG_LOG_ASSINATURA`, `DIAG_LOG_SOLUCAO`,
  `DIAG_LOG_PR`, `DIAG_LOG_CONF`, `DIAG_LOG_FONTES`, `DIAG_LOG_RUN`, `DIAG_LOG_NEW_BODY`.
- Banners são arte fixa → regere os `.txt` para outro idioma (§9).

---

## 8. Contrato do JSON do cockpit

`POST {COCKPIT_ANALISAR_URL}` com `{"message":"<job_url>","github_token":"<token>"}` (DTO:
`message` obrigatório 1..16384; `github_token` opcional max 512) devolve
`{ trace, itens_extras, acoes }`:

| Caminho jq | Uso |
|---|---|
| `.trace.desfecho` | `null` ⇒ **diagnóstico indisponível**. |
| `.trace.desfecho.servico` | Badge `servico`, campo no log. |
| `.trace.desfecho.fingerprint` | Badge `fingerprint`, campo no log. |
| `.trace.desfecho.assinatura` | Assinatura (curta no resumo, completa no `<details>`). |
| `.trace.desfecho.solucao.solucao` | Texto da cura (lista + `Confiança:`/`Fontes:`). |
| `.trace.desfecho.solucao.autor` | "_por &lt;autor&gt;_". |
| `.acoes.pr_disponivel` | Bloco "🛠️ Remediação sugerida" (`.titulo`, `.instrucao`). Só quando `resultado ∈ {cache_exato, cache_aproximado, base_conhecimento}` **E** casa um modelo. |
| `.trace.passos[0].{rotulo,valor}` | Mensagem quando não há `desfecho`. |

**Taxonomia de `resultado`** (do `trace-builder.ts` do cockpit):
`cache_exato`/`cache_aproximado`/`base_conhecimento` → **conhecido**; `escalado` → **novo**;
`erro`/desfecho `null` → **indisponível**.

**Estados derivados:** **CONHECIDO** = há `desfecho` E (`solucao.solucao` não vazio OU
`pr_disponivel`); **NOVO** = há `desfecho` sem solução e sem PR; **INDISPONÍVEL** =
`desfecho == null`.

> Os endpoints `pr/:fingerprint/{aprovar,estado,rejeitar}` do mesmo controller existem (a
> máquina de auto-PR já está pronta) mas **não são chamados pelo piloto** — reserva da Fase 2.

---

## 9. Testes

Sem rede — asserções de substring sobre as fixtures + golden/snapshot:

```bash
bash .github/diagnostico/test/render-log.test.sh
bash .github/diagnostico/test/render-summary.test.sh
bash .github/diagnostico/test/golden.test.sh      # compara com golden/*.md (byte-a-byte)
bash .github/diagnostico/test/mascote.test.sh     # escolha do mascote por estado
bash .github/diagnostico/test/heuristic.test.sh   # modo degradado
```

Fixtures cobrem: cura em texto, cura+PR, match sem PR (novo), erro de importação
(indisponível) e assinatura longa+comando. Golden com `MASCOTE_URL=""` (não depende de host
externo); `UPDATE=1 bash …/golden.test.sh` regrava (revise o diff no git; LF).

### Regenerar os banners de texto (se mudar os rótulos)
```python
# requer: pip install pyfiglet ; PYTHONIOENCODING=utf-8
import pyfiglet
def gen(words, out):
    art = "".join(pyfiglet.figlet_format(w, font="ansi_shadow") for w in words)
    lines = [l.rstrip() for l in art.split("\n")]
    while lines and lines[-1] == "": lines.pop()
    open(out, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
gen(["ERRO", "CONHECIDO"], "banner-conhecido.txt")
gen(["ERRO", "NOVO"],      "banner-novo.txt")
gen(["ERRO"],              "banner-erro.txt")
```
Grave sempre em LF. Marque `banner-*.txt -text` no `.gitattributes` (contêm box-drawing
`╗╝║═`) para o git não converter para CRLF.

---

## 10. Como re-disparar o e2e (test bed)

O `ci.yml` do demo está armado com `publicar:true` + `tag-mode:version`. **Qualquer
push/re-run na `main`** colide a versão no Nexus (`maven-hosted 400 "does not allow updating
assets"`) → **esteira falha** → `diagnostico-falha` aciona. Pré-requisito: a VM do cluster
(runner `cockpit-diag`) ligada.

Forçar cada estado (validado ao vivo 2026-09-11):

| Estado | Como forçar |
|--------|-------------|
| `conhecido` | baseline (fingerprint `e21cda41…` já curado) |
| `novo` | quebrar `HealthController.java` → compile fail |
| `indisponivel` | mandar token inválido → cockpit 401 → `desfecho=null` |
| `pr` | injetar `acoes.pr_disponivel` no `resp` via `jq` (o test bed não tem modelo casado) |

Convenção: reverter **por commit para frente** ("REVERTER apos a demo"), sem reescrever
histórico.

---

## 11. Decisões e armadilhas registradas

- **Imagem no LOG é impossível** — só ANSI/texto; PNG→arte de terminal fica pixelado.
- **base64/data-URI é removido** do markdown do GitHub → imagem só por **URL pública**.
- **camo não autentica** raw de repo privado nem alcança host interno → hospede a arte no
  **host público do cockpit** (`static/`); o ci.yml deriva a base do `COCKPIT_WEB_URL`.
- **Não encolher o WebP** abaixo de 320 px (summary exibe em HiDPI → upscale/pixel).
- **Admonitions e shields.io funcionam** no resumo e em comentários (validado).
- **LF obrigatório** nos `.sh`, `.txt` e `golden/*.md` (runner Linux; CRLF quebra `bash`).
  Para checar CR use `python .count(b'\r')` ou `od -c` — `grep -c $'\r'` dá falso-positivo
  no Git Bash.
- **Encoding shields.io:** dobre `-` e `_`, espaço→`%20`, sem acento no path.
- **Comentário sticky** por marcador → não spamma o PR.
- **Label 422** se a label não existe → o passo ignora (crie as labels antes).
- **Check Run `neutral`**, não `failure` — informativo, não reprova o PR.
- **Deep-link `#step:N:1`** só na URL de exibição; ao cockpit vai a URL limpa.
- **`read` perde a última linha** sem `\n` → `while IFS= read -r ln || [ -n "$ln" ]`.
- **VM do cluster auto-desaloca** (loop greenboot) → runner offline → job na fila até voltar.

---

## 12. Fase 2 — auto-abrir PR (DESENHADA, PAUSADA)

Registro em `docs/superpowers/specs/2026-09-11-onfailure-cockpit-auto-open-pr-design.md`
(pausado a pedido do usuário; nada implementado). Resumo:
- Auto-PR **automático, sem gate humano** (reverte a trava do piloto). A máquina já existe:
  `POST /api/cockpit/pr/<fp>/aprovar` (202) → poll `GET /api/cockpit/pr/<fp>/estado`; quem
  escreve o PR é o MS8 com o PAT dele.
- **Política de auto-PR por origem** (`run-github=automatico`, `chat`/`cockpit`=`aprovacao`).
- **Ledger + dashboard** de eval unificada (cockpit/chat/curadoria) via microsserviço
  dedicado (`dvop-bff-eval`, NestJS) — blueprint do Langfuse **sem** o peso (SQLite/PG, sem
  ClickHouse/Kafka).

> Enquanto a Fase 2 não sobe, a autonomia permanece **só diagnóstico** — o piloto **nunca
> abre PR**.

---

## 13. Próximos passos / ideias em aberto

- **Extrair o job para um reusable** em `esteiras-workflows` (deixa o caller magro; §0).
- **Notificação em canal** (Slack / WhatsApp via Evolution API) em "erro novo → curadoria".
  *(Fora de escopo por decisão do usuário.)*
- **Badge dinâmico "último erro conhecido"** no README (exige endpoint badge + hosting de JSON).
- **Tendência/contagem** ("fingerprint apareceu N vezes em X dias") — depende do cockpit
  devolver histórico.
- **Heurística mais rica**: mapear padrão → dica (ex.: colisão de versão no Nexus → suba a
  versão).
