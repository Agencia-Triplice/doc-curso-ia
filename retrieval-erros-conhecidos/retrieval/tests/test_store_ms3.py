import os, pytest, psycopg
os.environ["RETRIEVAL_PG_DSN"] = ("host=127.0.0.1 port=5432 dbname=dvop_test user=dvop "
    "password=dvop_dev options=-csearch_path=retrieval")
import store

@pytest.fixture
def conn():
    c = store.connect(); store.apply_schema(c)
    c.execute("TRUNCATE curas, chunks, documentos RESTART IDENTITY CASCADE")
    yield c
    c.execute("TRUNCATE curas, chunks, documentos RESTART IDENTITY CASCADE"); c.close()

def test_ingest_array_and_out(conn):
    ing, total = store.ingest_documents(conn, [
        {"titulo":"Erro X","conteudo":"passo a passo","servico":"svc-a","tags":["t1"]},
        {"titulo":"Erro Y","conteudo":"corpo Y","origem_fingerprint":"fp123"},
    ])
    assert ing == 2 and total == 2
    docs, tot = store.list_documentos(conn, limit=10)
    assert tot == 2 and len(docs) == 2
    d = docs[0]
    assert set(d) == {"id","titulo","conteudo","servico","nivel","tags",
                      "criado_em","origem_fingerprint","origem_run_url","aprovado_por"}
    assert isinstance(d["tags"], list)

def test_get_update_delete(conn):
    store.ingest_documents(conn, [{"titulo":"A","conteudo":"c"}])
    d = store.list_documentos(conn)[0][0]; did = d["id"]
    assert store.get_documento(conn, did)["titulo"] == "A"
    up = store.update_documento_ms3(conn, did, "A2", "c2", "svc", "warn", ["x"])
    assert up["titulo"] == "A2" and up["conteudo"] == "c2" and up["tags"] == ["x"]
    assert store.delete_documento(conn, did) is True
    assert store.get_documento(conn, did) is None
    assert store.delete_documento(conn, 999999) is False

def test_list_query_filter(conn):
    store.ingest_documents(conn, [{"titulo":"maven cache","conteudo":"x"},
                                  {"titulo":"npm erro","conteudo":"y"}])
    docs, tot = store.list_documentos(conn, q="maven")
    assert tot == 1 and docs[0]["titulo"] == "maven cache"
