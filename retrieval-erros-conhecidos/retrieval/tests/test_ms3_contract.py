import ms3_contract as mc

def test_validate_ok():
    assert mc.validate_document_in({"titulo":"t","conteudo":"c"}) == []

def test_validate_missing_and_limits():
    assert "titulo" in " ".join(mc.validate_document_in({"conteudo":"c"}))
    assert mc.validate_document_in({"titulo":"x"*301, "conteudo":"c"})  # >300
    assert mc.validate_document_in({"titulo":"t", "conteudo":""})       # vazio

def test_to_search_response_shape():
    engine = {"grounded": True, "top_cos": 0.62,
              "resultados": [{"documento_id": 5, "titulo": "T", "servico": "s",
                              "cos": 0.62, "rrf": 0.03, "snippet": "sn"}]}
    r = mc.to_search_response(engine)
    assert set(r) == {"grounded","doc_id","confianca","resultados","componentes","orfao_registrado"}
    assert r["grounded"] is True and r["doc_id"] == 5
    assert r["componentes"] == {"bm25":True,"denso":True,"reranker":False}
    h = r["resultados"][0]
    assert h["id"] == 5 and h["score_rrf"] == 0.03 and h["score_reranker"] is None

def test_to_search_response_orfao():
    r = mc.to_search_response({"grounded": False, "top_cos": 0.1, "resultados": []})
    assert r["grounded"] is False and r["doc_id"] is None
