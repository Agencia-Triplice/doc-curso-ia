"""Nucleo do retrieval: schema, ingestao incremental, busca hibrida (denso+FTS+RRF),
gate de grounding por cosseno, e a camada de curas (reuso exato por fingerprint)."""
import hashlib
import json
import os

import psycopg

import config
import encoder

HERE = os.path.dirname(os.path.abspath(__file__))


def connect():
    return psycopg.connect(config.PG_DSN, autocommit=True)


def apply_schema(conn):
    with open(os.path.join(HERE, "schema.sql"), encoding="utf-8") as f:
        conn.execute(f.read())


def _vec(embedding) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in embedding) + "]"


def build_embed_text(titulo, conteudo, aliases=None, perguntas=None) -> str:
    partes = [titulo or ""]
    if aliases:
        partes.append("Também conhecido como: " + ", ".join(aliases))
    if perguntas:
        partes.append("Perguntas: " + " ".join(perguntas))
    partes.append(conteudo or "")
    return "\n".join(p for p in partes if p.strip())


def upsert_documento(conn, *, tipo="log_erro", titulo, conteudo, servico=None, nivel=None,
                     produto=None, categoria=None, tags=None, aliases=None,
                     perguntas=None, origem_fingerprint=None, origem_run_url=None,
                     source_url=None, aprovado_por=None, metadata=None) -> int | None:
    """Cria o documento + seu chunk unico (how-to/erro curto). Idempotente por checksum:
    se o embed_text ja existe, nao duplica. Retorna documento_id (ou None se ja existia)."""
    aliases = aliases or []
    perguntas = perguntas or []
    embed_text = build_embed_text(titulo, conteudo, aliases, perguntas)
    checksum = hashlib.sha256(embed_text.encode("utf-8")).hexdigest()
    dup = conn.execute("SELECT 1 FROM chunks WHERE checksum=%s", (checksum,)).fetchone()
    if dup:
        return None
    doc_id = conn.execute(
        """INSERT INTO documentos
           (tipo,titulo,servico,nivel,produto,categoria,tags,aliases,perguntas,
            origem_fingerprint,origem_run_url,source_url,aprovado_por)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (tipo, titulo, servico, nivel, produto, categoria,
         json.dumps(tags or []), json.dumps(aliases), json.dumps(perguntas),
         origem_fingerprint, origem_run_url, source_url, aprovado_por),
    ).fetchone()[0]
    conn.execute(
        """INSERT INTO chunks (documento_id,ordinal,conteudo,embed_text,checksum,metadata)
           VALUES (%s,0,%s,%s,%s,%s)""",
        (doc_id, conteudo, embed_text, checksum, json.dumps(metadata or {})),
    )
    return doc_id


def add_chunk(conn, doc_id, ordinal, conteudo, embed_text, metadata=None) -> bool:
    checksum = hashlib.sha256(embed_text.encode("utf-8")).hexdigest()
    cur = conn.execute(
        """INSERT INTO chunks (documento_id,ordinal,conteudo,embed_text,checksum,metadata)
           VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (checksum) DO NOTHING""",
        (doc_id, ordinal, conteudo, embed_text, checksum, json.dumps(metadata or {})),
    )
    return cur.rowcount > 0


def embed_missing(conn, batch=128, log=print) -> int:
    """Embeda todo chunk com embedding NULL (ingestao incremental). Retorna quantos."""
    total = 0
    while True:
        rows = conn.execute(
            "SELECT id, embed_text FROM chunks WHERE embedding IS NULL ORDER BY id LIMIT %s",
            (batch,),
        ).fetchall()
        if not rows:
            break
        vectors = encoder.encode([r[1] for r in rows])
        with conn.cursor() as cur:
            for (cid, _), vec in zip(rows, vectors):
                cur.execute("UPDATE chunks SET embedding=%s::vector WHERE id=%s", (_vec(vec), cid))
        total += len(rows)
        log(f"  embedados {total}...")
    return total


def search(conn, query, tipo=None, servico=None, top_n=None):
    top_n = top_n or config.TOP_N
    qvec = _vec(encoder.encode_one(query))

    dense = conn.execute(
        """SELECT c.id, c.documento_id, 1 - (c.embedding <=> %s::vector) AS cos
           FROM chunks c JOIN documentos d ON d.id=c.documento_id
           WHERE c.embedding IS NOT NULL
             AND (%s::text IS NULL OR d.tipo=%s)
             AND (%s::text IS NULL OR d.servico IS NULL OR d.servico=%s)
           ORDER BY c.embedding <=> %s::vector LIMIT %s""",
        (qvec, tipo, tipo, servico, servico, qvec, config.K_DENSE),
    ).fetchall()

    lexical = conn.execute(
        """SELECT c.id, c.documento_id, ts_rank_cd(c.fts, q) AS rank
           FROM chunks c JOIN documentos d ON d.id=c.documento_id,
                websearch_to_tsquery('portuguese', %s) q
           WHERE c.fts @@ q
             AND (%s::text IS NULL OR d.tipo=%s)
             AND (%s::text IS NULL OR d.servico IS NULL OR d.servico=%s)
           ORDER BY rank DESC LIMIT %s""",
        (query, tipo, tipo, servico, servico, config.K_LEXICAL),
    ).fetchall()

    cos_by_chunk = {r[0]: float(r[2]) for r in dense}
    rrf: dict[int, float] = {}
    doc_of: dict[int, int] = {}
    for rank, (cid, did, _cos) in enumerate(dense, 1):
        rrf[cid] = rrf.get(cid, 0.0) + 1.0 / (config.RRF_K + rank)
        doc_of[cid] = did
    for rank, (cid, did, _rk) in enumerate(lexical, 1):
        rrf[cid] = rrf.get(cid, 0.0) + 1.0 / (config.RRF_K + rank)
        doc_of[cid] = did

    fused = sorted(rrf.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
    top_cos = max((cos_by_chunk.get(cid, 0.0) for cid, _ in fused), default=0.0)
    # Gate HIBRIDO: cosseno (confianca semantica) OU o #1 fundido e um match lexico
    # forte (token exato — codigo de erro/sigla, onde o denso e fraco). Sem reranker
    # ainda; quando ligado, o score do reranker substitui este gate.
    lex_top3 = {r[0] for r in lexical[:3]}
    lex_forte = bool(fused) and fused[0][0] in lex_top3
    if top_cos >= config.GROUNDING_THRESHOLD:
        motivo = "cosseno"
    elif lex_forte:
        motivo = "lexico"
    else:
        motivo = "orfao"
    grounded = motivo != "orfao"

    resultados = []
    for cid, score in fused:
        row = conn.execute(
            """SELECT d.id,d.tipo,d.titulo,d.produto,d.servico,d.source_url,
                      d.origem_run_url,c.conteudo
               FROM chunks c JOIN documentos d ON d.id=c.documento_id WHERE c.id=%s""",
            (cid,),
        ).fetchone()
        if not row:
            continue
        conteudo = row[7] or ""
        resultados.append({
            "documento_id": row[0], "tipo": row[1], "titulo": row[2],
            "produto": row[3], "servico": row[4], "source_url": row[5],
            "origem_run_url": row[6],
            "cos": round(cos_by_chunk.get(cid, 0.0), 4), "rrf": round(score, 5),
            "snippet": conteudo[:400] + ("..." if len(conteudo) > 400 else ""),
        })
    return {
        "query": query, "tipo": tipo, "servico": servico,
        "grounded": grounded, "motivo": motivo, "top_cos": round(top_cos, 4),
        "threshold": config.GROUNDING_THRESHOLD,
        "n_dense": len(dense), "n_lexical": len(lexical),
        "resultados": resultados,
    }


# ---- camada de curas (reuso exato por fingerprint) ----

def register_cura(conn, *, fingerprint, titulo, assinatura, cura, servico=None,
                  nivel=None, origem_run_url=None, origem_repo=None, documento_id=None):
    conn.execute(
        """INSERT INTO curas
           (fingerprint,titulo,assinatura,servico,nivel,cura,origem_run_url,origem_repo,documento_id)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (fingerprint) DO UPDATE SET
             cura=EXCLUDED.cura, titulo=EXCLUDED.titulo, assinatura=EXCLUDED.assinatura""",
        (fingerprint, titulo, assinatura, servico, nivel, cura, origem_run_url,
         origem_repo, documento_id),
    )


def lookup_cura(conn, fingerprint):
    row = conn.execute(
        "SELECT fingerprint,titulo,cura,origem_run_url,origem_repo FROM curas WHERE fingerprint=%s",
        (fingerprint,),
    ).fetchone()
    if not row:
        return None
    return {"fingerprint": row[0], "titulo": row[1], "cura": row[2],
            "origem_run_url": row[3], "origem_repo": row[4]}


def info(conn):
    docs = conn.execute("SELECT count(*) FROM documentos").fetchone()[0]
    chunks = conn.execute("SELECT count(*) FROM chunks").fetchone()[0]
    emb = conn.execute("SELECT count(*) FROM chunks WHERE embedding IS NOT NULL").fetchone()[0]
    curas = conn.execute("SELECT count(*) FROM curas").fetchone()[0]
    por_tipo = dict(conn.execute("SELECT tipo,count(*) FROM documentos GROUP BY tipo").fetchall())
    return {"documentos": docs, "chunks": chunks, "com_embedding": emb,
            "curas": curas, "por_tipo": por_tipo,
            "modelo": config.EMBED_MODEL, "dim": config.EMBED_DIM,
            "grounding_threshold": config.GROUNDING_THRESHOLD}


# ---- modelo de documento MS3 (contrato HTTP list/get/update/delete/ingest) ----

def assemble_conteudo(conn, doc_id) -> str:
    rows = conn.execute(
        "SELECT conteudo FROM chunks WHERE documento_id=%s ORDER BY ordinal", (doc_id,)
    ).fetchall()
    return "\n".join(r[0] for r in rows)


_DOC_COLS = ("id,titulo,servico,nivel,tags,criado_em,origem_fingerprint,"
             "origem_run_url,aprovado_por")


def _doc_row_to_out(conn, row) -> dict:
    (did, titulo, servico, nivel, tags, criado, fp, run_url, aprov) = row
    return {"id": did, "titulo": titulo, "conteudo": assemble_conteudo(conn, did),
            "servico": servico, "nivel": nivel,
            "tags": tags if isinstance(tags, list) else json.loads(tags or "[]"),
            "criado_em": criado.isoformat() if hasattr(criado, "isoformat") else criado,
            "origem_fingerprint": fp, "origem_run_url": run_url, "aprovado_por": aprov}


def documento_out(conn, doc_id):
    row = conn.execute(f"SELECT {_DOC_COLS} FROM documentos WHERE id=%s", (doc_id,)).fetchone()
    return _doc_row_to_out(conn, row) if row else None


get_documento = documento_out


def list_documentos(conn, limit=50, offset=0, q=None):
    where, args = "", []
    if q:
        where = ("WHERE d.id IN (SELECT documento_id FROM chunks WHERE conteudo ILIKE %s) "
                 "OR d.titulo ILIKE %s")
        args = [f"%{q}%", f"%{q}%"]
    total = conn.execute(f"SELECT count(*) FROM documentos d {where}", args).fetchone()[0]
    rows = conn.execute(
        f"SELECT {_DOC_COLS} FROM documentos d {where} ORDER BY d.id DESC LIMIT %s OFFSET %s",
        args + [limit, offset]).fetchall()
    return [_doc_row_to_out(conn, r) for r in rows], total


def _embed_missing_best_effort(conn):
    """embed_missing() chama a OpenAI; uma falha transitoria (rede, outage) NAO pode
    derrubar a ingestao/atualizacao do documento. O chunk fica com embedding NULL e
    uma reindexacao/embed_missing posterior completa."""
    try:
        embed_missing(conn, log=lambda *_: None)
    except Exception as exc:
        print(f"  [warn] embed_missing falhou (documento persistido, embedding pendente): {exc}")


def update_documento_ms3(conn, doc_id, titulo, conteudo, servico, nivel, tags):
    embed_text = build_embed_text(titulo, conteudo)
    checksum = hashlib.sha256(embed_text.encode()).hexdigest()
    with conn.transaction():
        n = conn.execute(
            "UPDATE documentos SET titulo=%s, servico=%s, nivel=%s, tags=%s, atualizado_em=now() "
            "WHERE id=%s", (titulo, servico, nivel, json.dumps(tags or []), doc_id)).rowcount
        if not n:
            return None            # rolls back the (no-op) tx, returns None -> 404
        conn.execute(
            "UPDATE chunks SET conteudo=%s, embed_text=%s, checksum=%s, embedding=NULL "
            "WHERE documento_id=%s AND ordinal=0", (conteudo, embed_text, checksum, doc_id))
    _embed_missing_best_effort(conn)
    return documento_out(conn, doc_id)


def delete_documento(conn, doc_id) -> bool:
    return conn.execute("DELETE FROM documentos WHERE id=%s", (doc_id,)).rowcount > 0


def ingest_documents(conn, items) -> tuple[int, int]:
    ing = 0
    for it in items:
        doc_id = upsert_documento(
            conn, tipo=it.get("tipo") or "log_erro",
            titulo=it["titulo"], conteudo=it["conteudo"],
            servico=it.get("servico"), nivel=it.get("nivel"),
            tags=it.get("tags") or [],
            origem_fingerprint=it.get("origem_fingerprint"),
            origem_run_url=it.get("origem_run_url"),
            source_url=it.get("origem_run_url"), aprovado_por=it.get("aprovado_por"))
        if doc_id is not None:
            ing += 1
    _embed_missing_best_effort(conn)
    total = conn.execute("SELECT count(*) FROM documentos").fetchone()[0]
    return ing, total


def info_ms3(conn) -> dict:
    docs = conn.execute("SELECT count(*) FROM documentos").fetchone()[0]
    return {"documentos": docs,
            "componentes": {"bm25": True, "denso": True, "reranker": False},
            "grounding_threshold": config.GROUNDING_THRESHOLD,
            "top_fusion": config.K_DENSE, "top_final": config.TOP_N,
            "orfaos_notification": False}
