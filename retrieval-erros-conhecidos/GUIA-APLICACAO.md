# Guia de aplicação — Retrieval da base de erros conhecidos (embeddings + chunks + busca)

Pacote portável para levar **os embeddings, os chunks e a busca atual** para o
**MS de erros conhecidos da base de conhecimento**. É a implementação de
referência do retrieval híbrido em **Postgres + pgvector** (o MS3 do programa
DVOP), com os dados-fonte para **regerar chunks e embeddings no ambiente de
destino**.

> Decisão do time: **os chunks e os embeddings são regerados no ambiente de
> destino** (nada de vetor pré-computado viaja no pacote). O `chunks.jsonl`
> incluído é referência do formato — os vetores nascem no ingest, via OpenAI.

---

## 1. O que tem no pacote

```
retrieval-erros-conhecidos/
├─ GUIA-APLICACAO.md          ← este arquivo
├─ retrieval/                 ← implementação de referência (Python, stdlib + psycopg)
│  ├─ schema.sql              ← modelo pgvector (documentos, chunks, curas)
│  ├─ config.py               ← DSN, modelo/dim de embedding, limiares, RRF
│  ├─ encoder.py              ← embeddings OpenAI text-embedding-3-small (1536-d)
│  ├─ store.py                ← ingestão incremental + busca híbrida + grounding + curas
│  ├─ ingest_confluence.py    ← parser do acervo → documentos/chunks (chunking semântico)
│  ├─ seed_howtos.py          ← dúvidas de processo (aliases/perguntas)
│  ├─ sweep_github.py         ← varre runs falhos do GitHub → curas
│  ├─ server.py               ← API HTTP MS3 + página de teste (porta 8003)
│  ├─ ms3_contract.py         ← validação DocumentIn + mapeamento SearchResponse
│  ├─ provision_schema.sql    ← cria role/schema retrieval
│  ├─ provision_dvop.sql      ← cria banco/role dvop (dev local)
│  ├─ README.md               ← notas da impl. de referência
│  └─ tests/                  ← testes de store, contrato e HTTP
├─ tools/
│  ├─ importar_erros_conhecidos.py   ← publica rag-ready/chunks.jsonl via POST /v1/documents
│  └─ test_importar_erros_conhecidos.py
└─ data/
   ├─ source-html/            ← ACERVO-FONTE: 19 páginas Confluence (.html) + index.json
   └─ rag-ready/              ← saída de um pipeline de chunking anterior (referência)
      ├─ chunks.jsonl         ← 127 chunks (sem vetores) — modelo do formato
      ├─ corpus.jsonl         ← 1 linha por página (metadados)
      ├─ docs/*.md            ← markdown por página (19)
      ├─ chunks_content_only*.jsonl / chunks_split.jsonl  ← variantes
      └─ manifest.json        ← parâmetros do chunking (1400/220/350)
```

---

## 2. Modelo de dados (schema pgvector) — `retrieval/schema.sql`

- **`documentos`** — uma página do Confluence, um how-to ou um erro real curado
  (`tipo` = `log_erro` | `duvida_processo`).
- **`chunks`** — trechos do documento:
  - `embed_text TEXT` — o texto **que vai para o vetor E para o FTS** (separado do
    conteúdo exibido). É onde entram **`aliases`** e **`perguntas_exemplo`**, o que
    resolve sigla ("kv" ≈ "key vault") e paráfrase.
  - `embedding vector(1536)` — NULL até embedar; distância = **cosseno** (`<=>`).
  - `fts tsvector` — `to_tsvector('portuguese', embed_text)`, **GENERATED STORED**,
    índice **GIN**.
- **`curas`** — reuso exato por `fingerprint`, com `assinatura` indexada por
  **GIN trigram** (`gin_trgm_ops`).

**Índice denso: FLAT/exato hoje** (recall 100%, ideal a 5–10k chunks). HNSW é um
toggle comentado em `schema.sql` — só liga ao cruzar ~50k chunks:

```sql
CREATE INDEX chunks_emb_hnsw ON chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
-- e recupere recall: SET hnsw.ef_search = 40;
```

> Na escala atual (~119 chunks úteis) **não use HNSW** — aproximado abriria mão do
> recall perfeito sem ganho de latência. Fica no FLAT.

---

## 3. Chunking e embeddings

**Parâmetros do pipeline `rag-ready`** (em `data/rag-ready/manifest.json`):

| Parâmetro | Valor | ~tokens (PT) |
|---|---|---|
| `chunk_size_chars` | 1400 | ~350 |
| `chunk_overlap_chars` | 220 | ~55 (~15,7%) |
| `min_content_chars` | 350 | ~90 (piso p/ página valer chunk) |

**Embeddings**: `text-embedding-3-small`, **1536 dimensões**, métrica cosseno
(vetores normalizados pelo próprio operador `<=>`). Gerados por `encoder.py`.
Chave OpenAI: via `OPENAI_API_KEY` **ou** arquivo `~/.claude/openai.txt`
(`config.py:openai_key()`). **A chave não viaja no pacote** — configure a do destino.

> Duas estratégias de chunk convivem: (A) `ingest_confluence.py` faz **chunking
> semântico** por entrada (erro + remediação), casando com `embed_text`/curas —
> **recomendado**; (B) os chunks fixos 1400/220 do `rag-ready` podem ser
> publicados direto pelo importador. Ambas convergem no mesmo `store`/busca.

---

## 4. Método de busca (o que roda hoje) — `retrieval/store.py:search`

Busca **híbrida em 3 camadas fundidas por RRF**, mais uma camada de curas:

1. **Denso (semântico)** — pgvector, cosseno, índice **FLAT/exato**:
   `1 - (embedding <=> q) AS cos`, top `K_DENSE=50`.
2. **Léxico (BM25-like)** — FTS português nativo:
   `ts_rank_cd(fts, websearch_to_tsquery('portuguese', q))`, índice **GIN**, top `K_LEXICAL=50`.
3. **Fusão RRF** — `score += 1/(RRF_K + rank)` com **`RRF_K=60`**, corta em `TOP_N=12`.
4. **Gate de grounding** — `top_cos >= GROUNDING_THRESHOLD` (**0.35**) marca a resposta
   como *grounded* (ver `to_search_response`). Quando um reranker for ligado, o score
   dele substitui o gate.
5. **Curas** — antes da busca, reuso exato por `fingerprint` (`lookup_cura`), assinatura
   por GIN trigram.

Parâmetros recalibráveis por env (todos em `config.py`): `RETRIEVAL_GROUNDING_THRESHOLD`,
`RETRIEVAL_EMBED_MODEL`, `RETRIEVAL_EMBED_DIM`, `RETRIEVAL_PG_DSN`.

---

## 5. Passo a passo — aplicar no MS de destino

Pré-requisitos: **Postgres 16+ com extensão `vector` (pgvector)** e `pg_trgm`; Python
3.11+ com `psycopg[binary]`; chave OpenAI do destino.

```bash
# 0) dependências
python -m venv .venv && . .venv/Scripts/activate   # (WSL/Linux: source .venv/bin/activate)
pip install "psycopg[binary]"

# 1) provisionar banco/schema (ajuste ao seu Postgres; provision_*.sql são o modelo dev)
psql "$ADMIN_DSN" -f retrieval/provision_schema.sql

# 2) configurar conexão + chave (NÃO use pipe do PowerShell p/ segredo)
export RETRIEVAL_PG_DSN="host=... port=5432 dbname=... user=... password=... options=-csearch_path=retrieval"
export OPENAI_API_KEY="sk-..."         # ou grave em ~/.claude/openai.txt

# 3) aplicar schema (idempotente) — o ingest também chama apply_schema
psql "$RETRIEVAL_PG_DSN" -f retrieval/schema.sql

# 4) REGERAR chunks + embeddings a partir do acervo-fonte  ← passo principal
cd retrieval
python ingest_confluence.py            # parseia ../data/source-html, cria docs/chunks e EMBEDA
#   (use --no-embed para só ingerir e embedar depois com store.embed_missing)
python seed_howtos.py                  # opcional: dúvidas de processo (aliases/perguntas)

# 5) subir a API e validar
python server.py                       # http://localhost:8003  (env RETRIEVAL_PORT)
```

> `ingest_confluence.py` já aponta por padrão para **`data/source-html/`** deste
> pacote (autossuficiente). Para outro acervo, defina `RETRIEVAL_ACERVO`.

**Alternativa de carga (path B)** — publicar os chunks fixos do `rag-ready` sem re-chunkar:
```bash
python tools/importar_erros_conhecidos.py --retrieval-url http://localhost:8003 --dry-run
# tire o --dry-run para publicar de verdade (idempotente, dedupe por page_id#chunk_index)
```
Depois os vetores nascem no `POST /v1/documents` → `store.embed_missing`.

---

## 6. Contrato HTTP (MS3) — `retrieval/server.py` + `ms3_contract.py`

| Método | Rota | Efeito |
|---|---|---|
| GET | `/health/live`, `/health/ready` | 200 |
| GET | `/` | página de teste |
| GET | `/v1/info` | `store.info_ms3()` |
| GET | `/v1/documents?limit&offset&q` | `{documentos:[...], total}` |
| GET | `/v1/documents/{id}` | DocumentOut ou 404 |
| POST | `/v1/documents` `[DocumentIn,...]` | 201 `{ingeridos, total_corpus}` (embeda) |
| PUT | `/v1/documents/{id}` | DocumentOut ou 404 |
| DELETE | `/v1/documents/{id}` | 204 ou 404 |
| POST | `/v1/search` `{query, servico?}` | SearchResponse (grounded, doc_id, resultados) |
| POST | `/v1/reindex` | `{documentos, componentes}` |
| POST | `/v1/diagnose` `{fingerprint?, query, servico?}` | cura exata → senão busca |

**DocumentIn** (validação em `ms3_contract.validate_document_in`, `MAX_BATCH=200`):
`titulo` (1..300) e `conteudo` (1..20000) obrigatórios; opcionais `servico` (≤200),
`nivel` (≤20), `tags` (≤32 itens, cada ≤64), `origem_fingerprint` (≤64),
`origem_run_url` (≤500), `aprovado_por` (≤200).

**SearchResponse**: `{grounded, doc_id, confianca, resultados:[{id,titulo,conteudo,
servico,nivel,tags,score_rrf,score_reranker,confianca}], componentes:{bm25,denso,
reranker}, orfao_registrado}`.

---

## 7. Portar para outra stack (ex.: Java `dvop-srv-retrieval`)

O modelo é **portável**: `schema.sql` e a lógica de busca não dependem de Python.

- **DB idêntico**: mesmo `schema.sql` (pgvector `<=>`, `tsvector` PT GIN, trigram nas curas).
- **Embeddings**: troque `encoder.py` por um client OpenAI da sua linguagem —
  mantenha `text-embedding-3-small`/1536 e normalização por cosseno.
- **Busca**: replique as duas queries (denso + FTS) e a **fusão RRF k=60** em app-code,
  preservando o **Repository Pattern**; o gate de grounding é um `if top_cos >= 0.35`.
- **Contrato**: `ms3_contract.py` é a especificação dos payloads `/v1/documents` e
  `/v1/search` — reproduza os mesmos campos/limites.

---

## 8. Notas e pegadinhas

- **7 páginas são stub** (`has_content:false` no `corpus.jsonl`/`index.json`): só título
  + URL. O importador já as filtra (`texto_util < 80` e `hasContent:false`). Ganho de
  qualidade real = recuperar o conteúdo dessas páginas, **não** mexer no chunking.
- **`aliases`/`perguntas_exemplo`** em `embed_text` são o que resolve sigla e paráfrase —
  priorize preenchê-los (`store.build_embed_text`).
- **Segredos**: nunca passe a chave OpenAI por pipe do PowerShell (injeta BOM/CRLF).
  Use `OPENAI_API_KEY` no ambiente ou arquivo `~/.claude/openai.txt`.
- **`config.py`** traz um DSN default de dev (`password=dvop_dev`) — **sobrescreva** via
  `RETRIEVAL_PG_DSN` no destino.

---

## 9. Checklist de validação

- [ ] `psql -c "\dx"` mostra `vector` e `pg_trgm` instalados.
- [ ] `schema.sql` aplicado (tabelas `documentos`, `chunks`, `curas` + índices GIN).
- [ ] `ingest_confluence.py` rodou: `paginas=` e `chunks_novos=` > 0; embed sem erro.
- [ ] `GET /v1/info` retorna contagem de documentos/chunks e `chunks` com `embedding` não-nulo.
- [ ] `POST /v1/search {"query":"erro de build dependência"}` retorna `grounded:true`
      com um `doc_id` plausível.
- [ ] `tests/` passam (`python -m pytest` no `retrieval/`).
