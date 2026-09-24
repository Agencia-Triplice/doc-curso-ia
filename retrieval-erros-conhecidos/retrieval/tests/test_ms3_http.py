import json, urllib.request as u
BASE = "http://localhost:8003"
def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = u.Request(BASE+path, data=data, method=method,
                    headers={"content-type":"application/json"})
    try:
        with u.urlopen(req) as r: return r.status, json.loads(r.read() or b"null")
    except u.HTTPError as e: return e.code, json.loads(e.read() or b"null")

def test_health():
    assert call("GET","/health/live")[0] == 200

def test_documents_batch_and_list():
    code, body = call("POST","/v1/documents",
        [{"titulo":"HTTP A","conteudo":"c1"},{"titulo":"HTTP B","conteudo":"c2","origem_fingerprint":"fpz"}])
    assert code == 201 and body["ingeridos"] == 2 and "total_corpus" in body
    code, body = call("GET","/v1/documents?limit=3")
    assert code == 200 and "documentos" in body and "total" in body
    assert set(body["documentos"][0]) >= {"id","titulo","conteudo","origem_fingerprint"}

def test_document_422_and_413():
    assert call("POST","/v1/documents",[{"conteudo":"sem titulo"}])[0] == 422
    assert call("POST","/v1/documents",[{"titulo":"t","conteudo":"c"}]*201)[0] == 413

def test_get_put_delete_404():
    assert call("GET","/v1/documents/999999")[0] == 404
    code, body = call("POST","/v1/documents",[{"titulo":"Z","conteudo":"z"}])
    did = call("GET","/v1/documents?q=Z")[1]["documentos"][0]["id"]
    assert call("PUT",f"/v1/documents/{did}",{"titulo":"Z2","conteudo":"z2","tags":["k"]})[1]["titulo"]=="Z2"
    assert call("DELETE",f"/v1/documents/{did}")[0] == 204

def test_search_envelope():
    code, body = call("POST","/v1/search",{"query":"maven cache is not found","servico":None,"nivel":None})
    assert code == 200
    assert set(body) == {"grounded","doc_id","confianca","resultados","componentes","orfao_registrado"}
    assert body["componentes"]["denso"] is True

def test_info():
    code, body = call("GET","/v1/info")
    assert code==200 and body["componentes"]["denso"] is True and "top_fusion" in body

def test_nonnumeric_id_returns_404_not_crash():
    assert call("GET","/v1/documents/abc")[0] == 404
    assert call("PUT","/v1/documents/abc",{"titulo":"t","conteudo":"c"})[0] == 404
    assert call("DELETE","/v1/documents/abc")[0] == 404

def test_garbage_limit_is_tolerated():
    code, body = call("GET","/v1/documents?limit=abc")
    assert code == 200 and "documentos" in body

def test_put_malformed_body_400():
    code, body = call("POST","/v1/documents",[{"titulo":"PutBad","conteudo":"c"}])
    did = call("GET","/v1/documents?q=PutBad")[1]["documentos"][0]["id"]
    req = u.Request(BASE+f"/v1/documents/{did}", data=b"{not json",
                    method="PUT", headers={"content-type":"application/json"})
    try:
        with u.urlopen(req) as r: code = r.status
    except u.HTTPError as e: code = e.code
    assert code == 400

def test_put_checksum_collision_is_atomic_not_torn():
    # Doc A anchors a checksum (embed_text = titulo+"\n"+conteudo, sha256'd, UNIQUE on chunks).
    call("POST","/v1/documents",[{"titulo":"ChkCollideA","conteudo":"bodyA-unico"}])
    aid = call("GET","/v1/documents?q=ChkCollideA")[1]["documentos"][0]["id"]
    # Doc B is the one we edit; the edit reproduces A's embed_text -> checksum UniqueViolation.
    call("POST","/v1/documents",[{"titulo":"ChkCollideB-orig","conteudo":"bodyB-unico"}])
    bid = call("GET","/v1/documents?q=ChkCollideB-orig")[1]["documentos"][0]["id"]
    try:
        # Must NOT tear the connection: call() only handles HTTPError, so a torn
        # connection would raise (ConnectionResetError/RemoteDisconnected) and fail
        # this test outright instead of returning a status code.
        code, body = call("PUT", f"/v1/documents/{bid}",
                           {"titulo": "ChkCollideA", "conteudo": "bodyA-unico"})
        assert code in (409, 422, 500), f"expected a clean error status, got {code} {body}"
        # Atomicity invariant: B's documentos row must be UNCHANGED (no partial write)
        # even though the chunk UPDATE failed after the documentos UPDATE ran.
        after = call("GET", f"/v1/documents/{bid}")[1]
        assert after["titulo"] == "ChkCollideB-orig"
        assert after["conteudo"] == "bodyB-unico"
    finally:
        call("DELETE", f"/v1/documents/{aid}")
        call("DELETE", f"/v1/documents/{bid}")
