# retrieval-bdc — retrieval híbrido em pgvector (projeto a parte)

Implementação de referência do modelo desenhado nos artifacts **ADR "Indexação do
Retrieval BDC"** e **Blueprint** — um retrieval híbrido (BM25/FTS + denso OpenAI, fusão
RRF, gate de grounding) sobre **Postgres 18 + pgvector**, separado do serviço Java
`dvop-srv-retrieval` e do banco do curso de inglês.

## Decisões implementadas
- **Métrica: cosseno** (pgvector `<=>`, vetores normalizados pelo próprio operador).
- **Índice: FLAT/exato** (recall 100%, ideal a 5–10k docs). HNSW é toggle futuro (um
  `CREATE INDEX ... USING hnsw` — comentado no `schema.sql`; ligar ao cruzar ~50k).
- **Modelo de documento tipado**: `tipo` (log_erro | duvida_processo), `embed_text`
  separado do texto exibido, e campos **`aliases`** + **`perguntas`** que entram no vetor
  E no FTS — é o que resolve sigla ("kv" ≈ "key vault") e paráfrase.
- **Híbrido**: denso (pgvector) + léxico (FTS5 português) fundidos por **RRF k=60**.
- **Gate de grounding híbrido**: cosseno ≥ limiar OU match léxico forte (token exato,
  onde o denso é fraco). Quando o reranker for ligado, o score dele substitui o gate.

## Como rodar
```powershell
cd microservices/retrieval-bdc
python -m venv .venv
.venv/Scripts/python -m pip install "psycopg[binary]"
# banco já provisionado (retrieval_bdc no Postgres do WSL); credenciais em ~/.claude/retrieval_pg.txt
.venv/Scripts/python seed_howtos.py          # 8 how-tos (aliases+perguntas)
.venv/Scripts/python ingest_confluence.py    # acervo curado (agt/erros-conhecidos)
.venv/Scripts/python sweep_github.py          # varre runs falhos do GitHub -> curas
.venv/Scripts/python server.py                # http://localhost:8099 (página de teste)
```

## Componentes
| Arquivo | Papel |
|---|---|
| `schema.sql` | modelo pgvector (documentos, chunks, curas) |
| `config.py` | conexão + chave OpenAI (de arquivo) + limiares |
| `encoder.py` | embeddings OpenAI `text-embedding-3-small` (1536-d) via stdlib |
| `store.py` | ingestão incremental (checksum), busca híbrida, grounding, curas |
| `ingest_confluence.py` | parser resiliente do acervo BiaTech |
| `seed_howtos.py` | dúvidas de processo com aliases/perguntas |
| `sweep_github.py` | varredura de runs falhos → assinatura → cura (OpenAI) |
| `server.py` | API HTTP + página de teste |

Porte para o serviço Java: o `schema.sql` e a lógica de busca são portáveis; troca o
backend do índice, preserva o Repository Pattern.
