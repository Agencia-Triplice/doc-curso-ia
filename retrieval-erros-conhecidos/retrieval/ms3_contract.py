"""Contrato MS3: validacao de DocumentIn e mapeamento do resultado do motor
(store.search) para o SearchResponse do MS3. Puro — sem DB, sem rede."""
MAX_BATCH = 200
_LIM = {"titulo": (1, 300), "conteudo": (1, 20000), "servico": (0, 200),
        "nivel": (0, 20), "origem_fingerprint": (0, 64), "origem_run_url": (0, 500),
        "aprovado_por": (0, 200)}

def validate_document_in(item) -> list:
    err = []
    if not isinstance(item, dict):
        return ["item deve ser objeto"]
    for campo, (lo, hi) in _LIM.items():
        v = item.get(campo)
        if campo in ("titulo", "conteudo"):
            if not isinstance(v, str) or not (lo <= len(v) <= hi):
                err.append(f"{campo}: obrigatorio, {lo}..{hi} chars")
        elif v is not None and (not isinstance(v, str) or len(v) > hi):
            err.append(f"{campo}: <= {hi} chars")
    tags = item.get("tags")
    if tags is not None:
        if not isinstance(tags, list) or len(tags) > 32 or any(
                not isinstance(t, str) or len(t) > 64 for t in tags):
            err.append("tags: <=32 itens, cada <=64 chars")
    return err

def to_search_response(engine) -> dict:
    res = engine.get("resultados", [])
    grounded = bool(engine.get("grounded"))
    doc_id = res[0]["documento_id"] if (grounded and res) else None
    confianca = float(engine.get("top_cos") or 0.0)
    hits = [{"id": h.get("documento_id"), "titulo": h.get("titulo"),
             "conteudo": h.get("snippet"), "servico": h.get("servico"),
             "nivel": h.get("nivel"), "tags": h.get("tags") or [],
             "score_rrf": h.get("rrf"), "score_reranker": h.get("rerank"),
             "confianca": h.get("cos")} for h in res]
    return {"grounded": grounded, "doc_id": doc_id, "confianca": confianca,
            "resultados": hits,
            "componentes": {"bm25": True, "denso": True,
                            "reranker": bool(engine.get("reranker_usado"))},
            "orfao_registrado": False}
