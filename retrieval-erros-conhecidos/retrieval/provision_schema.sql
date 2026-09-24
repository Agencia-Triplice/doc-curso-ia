-- Aplicado dentro de cada DB (dvop, dvop_test) como superusuario postgres.
-- Cria o schema de destino (Fase 1 = retrieval) e as extensoes que as tabelas usam.
-- As extensoes vao DENTRO do schema retrieval (nao public): a DSN do servico usa
-- search_path=retrieval isolado (schema-por-servico), entao o tipo `vector` e os
-- operadores do pg_trgm precisam estar visiveis so com esse search_path.
CREATE SCHEMA IF NOT EXISTS retrieval AUTHORIZATION dvop;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
             WHERE e.extname='vector' AND n.nspname<>'retrieval') THEN
    EXECUTE 'DROP EXTENSION vector';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
             WHERE e.extname='pg_trgm' AND n.nspname<>'retrieval') THEN
    EXECUTE 'DROP EXTENSION pg_trgm';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS vector SCHEMA retrieval;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA retrieval;
