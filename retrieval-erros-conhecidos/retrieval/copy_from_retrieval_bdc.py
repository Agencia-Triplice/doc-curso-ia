"""Copia documentos/chunks/curas de retrieval_bdc -> dvop (exato, sem re-embedar).
retrieval_bdc e read-only aqui. Idempotente: TRUNCATE no destino antes de copiar.

Tipos especiais (vector, jsonb) sao lidos com ::text na origem e reinseridos com
o cast certo no destino -- mesma tecnica que store.py ja usa (embed_missing() faz
UPDATE chunks SET embedding=%s::vector com uma string "[...]"; upsert_documento()
grava tags/aliases/perguntas como json.dumps(...) -- uma string -- em coluna jsonb).
Isso evita depender de o psycopg ter (ou nao) um adapter registrado pros OIDs
vector/jsonb: tudo trafega como texto e o Postgres faz o cast implicito na
coluna de destino (vector explicito via ::vector; jsonb aceita string direto).
"""
import psycopg

import config

SRC = "host=127.0.0.1 port=5432 dbname=retrieval_bdc user=retrieval password=retrieval_dev"

# cada entrada: (nome_da_coluna, cast_na_leitura, cast_na_escrita)
DOCUMENTOS_COLS = [
    ("id", "", ""),
    ("tipo", "", ""),
    ("titulo", "", ""),
    ("servico", "", ""),
    ("nivel", "", ""),
    ("produto", "", ""),
    ("categoria", "", ""),
    ("tags", "::text", ""),
    ("aliases", "::text", ""),
    ("perguntas", "::text", ""),
    ("origem_fingerprint", "", ""),
    ("origem_run_url", "", ""),
    ("source_url", "", ""),
    ("aprovado_por", "", ""),
    ("criado_em", "", ""),
    ("atualizado_em", "", ""),
]

CHUNKS_COLS = [
    ("id", "", ""),
    ("documento_id", "", ""),
    ("ordinal", "", ""),
    ("conteudo", "", ""),
    ("embed_text", "", ""),
    ("checksum", "", ""),
    ("embedding", "::text", "::vector"),
    ("metadata", "::text", ""),
    ("criado_em", "", ""),
]

CURAS_COLS = [
    ("fingerprint", "", ""),
    ("titulo", "", ""),
    ("assinatura", "", ""),
    ("servico", "", ""),
    ("nivel", "", ""),
    ("cura", "", ""),
    ("origem_run_url", "", ""),
    ("origem_repo", "", ""),
    ("documento_id", "", ""),
    ("criado_em", "", ""),
]


def copy_table(src, dst, table, cols):
    select_cols = ",".join(f"{name}{rcast}" for name, rcast, _ in cols)
    rows = src.execute(f"SELECT {select_cols} FROM {table} ORDER BY 1").fetchall()
    if not rows:
        return 0
    names = ",".join(name for name, _, _ in cols)
    placeholders = ",".join(f"%s{wcast}" for _, _, wcast in cols)
    with dst.cursor() as cur:
        cur.executemany(f"INSERT INTO {table} ({names}) VALUES ({placeholders})", rows)
    return len(rows)


def main():
    src = psycopg.connect(SRC, autocommit=True)
    dst = psycopg.connect(config.PG_DSN, autocommit=True)
    dst.execute("TRUNCATE curas, chunks, documentos RESTART IDENTITY CASCADE")

    d = copy_table(src, dst, "documentos", DOCUMENTOS_COLS)
    dst.execute(
        "SELECT setval(pg_get_serial_sequence('documentos','id'), (SELECT max(id) FROM documentos))"
    )

    c = copy_table(src, dst, "chunks", CHUNKS_COLS)
    dst.execute(
        "SELECT setval(pg_get_serial_sequence('chunks','id'), (SELECT max(id) FROM chunks))"
    )

    cu = copy_table(src, dst, "curas", CURAS_COLS)

    print(f"documentos={d} chunks={c} curas={cu}")


if __name__ == "__main__":
    main()
