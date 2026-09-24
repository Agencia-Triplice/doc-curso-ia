-- Provisiona o Postgres local do programa de migracao (schema por sereco; Fase 1 = retrieval).
-- Rodar como superusuario postgres. Idempotente.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dvop') THEN
    CREATE ROLE dvop LOGIN PASSWORD 'dvop_dev';
  END IF;
END $$;

SELECT 'CREATE DATABASE dvop OWNER dvop'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='dvop')\gexec
SELECT 'CREATE DATABASE dvop_test OWNER dvop'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='dvop_test')\gexec
