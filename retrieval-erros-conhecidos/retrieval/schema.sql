-- Modelo pgvector do retrieval BDC (projeto a parte).
-- Métrica: cosseno.  Índice denso: FLAT/exato agora (recall 100%); HNSW é toggle futuro.
-- embed_text = o que vira vetor E alimenta o FTS (titulo + aliases + perguntas + conteudo).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fonte: uma pagina de Confluence, um how-to, ou um erro real curado.
CREATE TABLE IF NOT EXISTS documentos (
  id                 BIGSERIAL PRIMARY KEY,
  tipo               TEXT NOT NULL CHECK (tipo IN ('log_erro','duvida_processo')),
  titulo             TEXT NOT NULL,
  servico            TEXT,                        -- vazio = generico (casa qualquer servico)
  nivel              TEXT,
  produto            TEXT,
  categoria          TEXT,
  tags               JSONB NOT NULL DEFAULT '[]',
  aliases            JSONB NOT NULL DEFAULT '[]', -- ["kv","key vault","cofre de chaves"] -> resolve sigla
  perguntas          JSONB NOT NULL DEFAULT '[]', -- perguntas canonicas (duvida_processo)
  origem_fingerprint TEXT,                        -- vinculo com o erro real curado
  origem_run_url     TEXT,
  source_url         TEXT,                        -- pagina do Confluence de origem
  aprovado_por       TEXT,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unidade indexada.
CREATE TABLE IF NOT EXISTS chunks (
  id            BIGSERIAL PRIMARY KEY,
  documento_id  BIGINT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  ordinal       INT NOT NULL DEFAULT 0,
  conteudo      TEXT NOT NULL,                    -- texto EXIBIDO
  embed_text    TEXT NOT NULL,                    -- o que VIRA vetor + alimenta o FTS
  checksum      TEXT NOT NULL UNIQUE,             -- sha256(embed_text) -> ingestao incremental
  embedding     vector(1536),                     -- NULL ate embedar; distancia = cosseno (<=>)
  metadata      JSONB NOT NULL DEFAULT '{}',
  fts           tsvector GENERATED ALWAYS AS
                  (to_tsvector('portuguese', coalesce(embed_text,''))) STORED,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (documento_id, ordinal)
);

CREATE INDEX IF NOT EXISTS chunks_fts_gin ON chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS chunks_doc     ON chunks (documento_id);

-- DENSO: exato agora (seq scan = recall 100%, perfeito a 5-10k).
-- Ao cruzar ~50k, ligue o HNSW com UM comando (sem re-embedar, sem migrar):
-- CREATE INDEX chunks_emb_hnsw ON chunks
--   USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Camada de reuso exato (fingerprint -> cura), FORA do vetor. Alimentada pela
-- varredura do GitHub e por erros curados. O log_erro tambem entra no corpus (RAG).
CREATE TABLE IF NOT EXISTS curas (
  fingerprint    TEXT PRIMARY KEY,
  titulo         TEXT NOT NULL,
  assinatura     TEXT NOT NULL,          -- assinatura normalizada do erro
  servico        TEXT,
  nivel          TEXT,
  cura           TEXT NOT NULL,          -- remediacao (texto)
  origem_run_url TEXT,
  origem_repo    TEXT,
  documento_id   BIGINT REFERENCES documentos(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS curas_assinatura_trgm ON curas USING gin (assinatura gin_trgm_ops);
