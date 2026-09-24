# Relatório noturno — Retrieval BDC em pgvector + varredura do GitHub

Feito de ponta a ponta enquanto você dormia. Está tudo pronto para testar de manhã.
**Nada do curso de inglês foi tocado** (bancos `english_learning*` e role `english`
intactos): criei um **banco e projeto separados**.

## TL;DR (o que testar primeiro)

```powershell
cd E:\sites\IA\bdc\.claude\worktrees\retrieval-bdc-pgvector\microservices\retrieval-bdc
.venv\Scripts\python server.py
# abre http://localhost:8099  -> página de teste (tema escuro)
```

Digite na página:
- `como cria um kv` e depois `preciso criar um key vault` → **mesma** resposta (KeyVault). Resolve a sigla.
- `ImagePullBackOff` → grounded pelo léxico (token exato onde o denso é fraco).
- `maven cache is not found` → cai numa **cura real** varrida do GitHub.
- `como fazer bolo de cenoura` → **ÓRFÃO** (rejeitado, fora do domínio).

---

## 1. O que foi construído

Um retrieval **híbrido** (BM25/FTS português + denso OpenAI, fusão RRF, gate de
grounding) sobre **PostgreSQL 18 + pgvector 0.8.1**, implementando o modelo desenhado
nos artifacts **ADR "Indexação do Retrieval BDC"** e **Blueprint**. É um projeto a
parte — não mexe no serviço Java `dvop-srv-retrieval` (que segue SQLite/BM25).

**Decisões implementadas (conforme decidimos):**

| Decisão | Escolha | Porquê |
|---|---|---|
| Métrica | **cosseno** (`<=>`) | padrão para embeddings de texto |
| Índice denso | **FLAT/exato** | recall 100%; ideal a 5–10k docs. HNSW é toggle futuro (1 comando comentado no `schema.sql`, ligar ao cruzar ~50k) |
| Modelo de doc | tipado + `embed_text` separado + **`aliases`** + **`perguntas`** | é o que resolve sigla ("kv" ≈ "key vault") e paráfrase — nenhum dos 3 projetos irmãos tinha isso |
| Fusão | **RRF k=60** (denso + léxico) | robusto, sem calibrar pesos |
| Gate | cosseno ≥ 0.35 **OU** léxico forte | pega tanto semântica quanto token exato (código de erro/sigla) |
| BM25 | **mantido** | complementa o denso em token exato; o cache/fingerprint fica na frente, o híbrido é o miolo do RAG |

## 2. Corpus atual

```
131 documentos  ·  283 chunks  ·  283 embedados (100%)  ·  110 curas
por tipo: 122 log_erro  +  9 duvida_processo (how-tos)
modelo: text-embedding-3-small (1536-d)  ·  grounding_threshold: 0.35
```

- **9 how-tos** (dúvidas de processo) com aliases+perguntas: KeyVault/kv, rotação de
  PAT, starter kit, PR de remediação, secret CSI, reset de curadoria, ligar VMs,
  publicar fronts dvop.
- **12 páginas** do acervo Confluence BiaTech (`agt/erros-conhecidos`), ~142 entradas curadas.
- **110 curas** vindas da varredura do GitHub (abaixo).

## 3. Varredura do GitHub — 110 curas

Varri **status=failure** nas suas orgs + repos próprios. Encontrei **371 runs falhas
em 41 repos**; examinei **194 runs** e registrei **110 curas distintas** (dedup por
fingerprint determinístico da assinatura do erro). Para cada uma: assinatura extraída
do log → normalizada → **cura em pt-BR gerada pela OpenAI (gpt-4o-mini)** → gravada como
`cura` (reuso exato por fingerprint) **e** como `log_erro` (entra no corpus RAG).

**Por org:** GDD-Core 96 · Agencia-Triplice 14
**Top repos:**

| curas | repo |
|---|---|
| 24 | GDD-Core/dvop-srv-demo |
| 14 | GDD-Core/dvop-bff-demo |
| 12 | GDD-Core/dvop-srv-mcp-github |
| 11 | GDD-Core/dvop-bff-curadoria |
| 9  | GDD-Core/dvop-srv-log-process |
| 8  | Agencia-Triplice/agen-mnl-agendamento-core |
| 6  | GDD-Core/dvop-srv-remediation · agentix-demo-app |
| 4  | dvop-srv-cache-writer · dvop-srv-retrieval · dvop-srv-cache-query |
| …  | +6 repos com 1–3 |

Os erros varridos batem com os erros conhecidos do dvop (Gitleaks/segredo exposto, ACS
imagem base, `blob upload invalid`, `maven cache is not found`, npm E400/E401 "versão já
existe", download de artifact, etc.) — ou seja, curas úteis de verdade.

**Nota:** as orgs `tiago-linhares-learning` e `GDD-Automation` não retornaram repos
acessíveis (vazias/sem acesso). "Externa" ficou coberta pela Agencia-Triplice + seus
repos pessoais; se quiser incluir repos de terceiros específicos, é só me passar os nomes.

## 4. Como testar a camada de cura (reuso exato)

O endpoint `/v1/diagnose` checa a cura por **fingerprint** e, se não achar, cai no RAG:

```powershell
# reuso exato por fingerprint (resposta instantânea, sem embeddar)
curl.exe -s -X POST http://localhost:8099/v1/diagnose -H "content-type: application/json" -d "{\"fingerprint\":\"dae7e7caf4f9356a\"}"
```

Fingerprints de exemplo (há 110 na tabela `curas`):

| fingerprint | erro |
|---|---|
| `dae7e7caf4f9356a` | dvop-srv-demo: maven cache is not found |
| `d4f6d1a1dc8b4921` | agentix-demo-app: npm error code E400 |
| `5340ec98d69fd3e7` | dvop-bff-demo: npm error code E401 |
| `b6e1a8319b942589` | dvop-bff-curadoria: Unable to download artifact(s) |
| `93e08f292ae26408` | dvop-bff-curadoria: Cache not found (trivy-db) |

Para listar todas: `SELECT fingerprint, titulo FROM curas;` no banco.

## 5. Validação E2E (rodei tudo — passou)

- `curas >= 100` (110) ✅ · `log_erro >= 100 docs` (122) ✅ · todos os chunks embedados ✅
- **Reuso exato**: `lookup(fingerprint) → cura` retorna a remediação ✅
- **RAG semântico** em erros reais (`Unable to download artifact`, `maven cache is not
  found`): grounded, cos 0.53–0.63 ✅
- **How-tos**: `como cria um kv` (0.53), `preciso criar um key vault` (0.71),
  `meu pat expirou` (0.38) → todos grounded ✅
- **Órfão**: `bolo de cenoura` → rejeitado ✅

## 6. Banco e credenciais (dev)

```
host=127.0.0.1  port=5432  dbname=retrieval_bdc
user=retrieval  password=retrieval_dev      (role/DB separados do inglês)
```
Roda no Postgres do WSL2. Extensões: `vector`, `pg_trgm`. Chave OpenAI lida de
`C:\Users\Tiago\.claude\openai.txt` (nunca via pipe do PS5.1).

## 7. Arquivos (branch `worktree-retrieval-bdc-pgvector`, commitados)

`microservices/retrieval-bdc/`: `schema.sql`, `config.py`, `encoder.py`, `store.py`,
`server.py`, `ingest_confluence.py`, `seed_howtos.py`, `sweep_github.py`, `README.md`.
Estado da varredura em `sweep_state.json` (gitignored, resumível).

## 8. Limitações conhecidas / próximos passos

- **Títulos** de ~2 curas ficaram genéricos (log sem linha de erro clara) e alguns
  carregam ruído da ferramenta (resumo do Trivy/KICS). O **conteúdo da cura** é bom; o
  título é cosmético. `sweep_github.py --alvo N` é resumível e re-varre mais se quiser.
- **Curas geradas por LLM** são um bom rascunho de remediação, não verdade absoluta —
  revise antes de promover ao acervo oficial (campo `aprovado_por='github-sweep'`).
- **Porte para o Java** (`dvop-srv-retrieval`): `schema.sql` e a lógica de busca são
  portáveis; troca o backend do índice, preserva o Repository Pattern. O denso (D6) pode
  ligar quando quiser — o modelo já nasce pgvector.
- **HNSW**: um `CREATE INDEX ... USING hnsw` (comentado no schema) quando cruzar ~50k docs.
- Importar o resto do Confluence: `ingest_confluence.py` é idempotente por título.
