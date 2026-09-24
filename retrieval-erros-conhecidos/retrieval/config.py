"""Config central do retrieval BDC. Le a chave OpenAI de arquivo (nunca de pipe/env
frageis no PS5.1) e a conexao do Postgres do WSL (default dev)."""
import os
import pathlib
import sys

# Console Windows (cp1252) quebra ao imprimir emoji/acento dos exports Confluence.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Conexao Postgres (WSL2, porta encaminhada pro Windows como localhost).
# dvop = banco local do programa de migracao MS3 (schema retrieval); retrieval_bdc
# (usuario/db antigos) fica intocado e so read-only.
PG_DSN = os.environ.get(
    "RETRIEVAL_PG_DSN",
    "host=127.0.0.1 port=5432 dbname=dvop user=dvop password=dvop_dev "
    "options=-csearch_path=retrieval",
)

# Modelo de embedding — text-embedding-3-large (3072-d) para MAXIMA precisao.
# Trocar de modelo exige RE-EMBEDAR tudo e casar a dimensao da coluna em schema.sql.
# ESCALA: pgvector nao indexa vector()>2000d com HNSW; a 3072d o HNSW vai num
# cast halfvec (ver schema.sql). O modelo aceita 'dimensions' p/ reduzir se um dia
# quiser HNSW em vector() puro (<=2000d) — hoje mantemos os 3072 cheios.
EMBED_MODEL = os.environ.get("RETRIEVAL_EMBED_MODEL", "text-embedding-3-large")
EMBED_DIM = int(os.environ.get("RETRIEVAL_EMBED_DIM", "3072"))

# Gate de grounding por cosseno (recalibravel). No 3-large a distribuicao de cosseno
# MUDA em relacao ao 3-small — RECALIBRE com dados reais (partida ~0.30-0.55).
GROUNDING_THRESHOLD = float(os.environ.get("RETRIEVAL_GROUNDING_THRESHOLD", "0.35"))

# RRF e funil de candidatos.
RRF_K = 60
K_DENSE = 50
K_LEXICAL = 50
TOP_N = 12

_KEY_PATHS = [
    os.environ.get("RETRIEVAL_OPENAI_KEY_PATH", ""),
    "/mnt/c/Users/Tiago/.claude/openai.txt",  # WSL
    str(pathlib.Path.home() / ".claude" / "openai.txt"),
    r"C:\Users\Tiago\.claude\openai.txt",
]


def openai_key() -> str:
    env = os.environ.get("OPENAI_API_KEY")
    if env:
        return env.strip()
    for p in _KEY_PATHS:
        if p and os.path.isfile(p):
            return pathlib.Path(p).read_text(encoding="utf-8").strip()
    raise RuntimeError("chave OpenAI nao encontrada (arquivo ~/.claude/openai.txt)")
