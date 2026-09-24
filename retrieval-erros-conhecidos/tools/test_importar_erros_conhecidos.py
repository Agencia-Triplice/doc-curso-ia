"""Testes do importador de erros conhecidos (stdlib unittest, servidor HTTP fake)."""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from tools.importar_erros_conhecidos import (
    filtrar_chunks, montar_documento, publicar)

URL = "https://conf.biatech/pages/1"
CHUNK_OK = {"chunk_id": "10-0", "page_id": "10", "title": "Erro de build Maven",
            "source_url": URL, "chunk_index": 0,
            "text": "Erro de build Maven. O reator falha com dependency not found quando o "
                    "settings.xml não aponta para o mirror interno; configure o mirror e rode de novo."}
CHUNK_STUB = {"chunk_id": "11-0", "page_id": "11", "title": "Página vazia",
              "source_url": URL, "chunk_index": 0,
              "text": f"Página vazia {URL}"}
CHUNK_SEM_CONTEUDO = dict(CHUNK_OK, page_id="12", chunk_id="12-0")


class Fake(BaseHTTPRequestHandler):
    docs: list = []
    posts: list = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        corpo = json.dumps({"documentos": self.docs, "total": len(self.docs)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_POST(self):
        tamanho = int(self.headers.get("Content-Length") or 0)
        Fake.posts.append(json.loads(self.rfile.read(tamanho)))
        corpo = json.dumps({"ingested": 1, "total": 1}).encode()
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)


class TestFiltro(unittest.TestCase):
    def test_stub_e_pagina_sem_conteudo_ficam_de_fora(self):
        uteis = filtrar_chunks([CHUNK_OK, CHUNK_STUB, CHUNK_SEM_CONTEUDO], {"12"})
        self.assertEqual([c["chunk_id"] for c in uteis], ["10-0"])

    def test_montar_documento(self):
        doc = montar_documento(CHUNK_OK)
        self.assertEqual(doc["titulo"], "Erro de build Maven #0")
        self.assertIn("mirror interno", doc["conteudo"])
        self.assertIn(f"Fonte: {URL}", doc["conteudo"])
        self.assertEqual(doc["tags"], ["origem:confluence-biatech", "page:10", "chunk:10-0"])


class TestPublicar(unittest.TestCase):
    def setUp(self):
        Fake.docs, Fake.posts = [], []
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"

    def tearDown(self):
        self.srv.shutdown()

    def test_publica_e_e_idempotente(self):
        resumo = publicar([CHUNK_OK], self.url, dry_run=False, limit=None)
        self.assertEqual(resumo["publicados"], 1)
        self.assertEqual(Fake.posts[0][0]["titulo"], "Erro de build Maven #0")
        # segunda rodada: o doc já existe no GET (mesma tag chunk:10-0) → pulado
        Fake.docs = [{"id": 1, "titulo": "Erro de build Maven #0", "conteudo": "x",
                      "tags": ["origem:confluence-biatech", "page:10", "chunk:10-0"]}]
        resumo2 = publicar([CHUNK_OK], self.url, dry_run=False, limit=None)
        self.assertEqual(resumo2["publicados"], 0)
        self.assertEqual(resumo2["pulados"], 1)

    def test_titulo_repetido_em_pagina_diferente_nao_colide(self):
        # spec §4.5: dedupe é por page_id#chunk_index (tag chunk:<chunk_id>), não por
        # título — duas páginas Confluence com o mesmo título não podem colidir
        outra_pagina = dict(CHUNK_OK, page_id="20", chunk_id="20-0")
        Fake.docs = [{"id": 1, "titulo": "Erro de build Maven #0", "conteudo": "x",
                      "tags": ["origem:confluence-biatech", "page:10", "chunk:10-0"]}]
        resumo = publicar([outra_pagina], self.url, dry_run=False, limit=None)
        self.assertEqual(resumo["publicados"], 1)
        self.assertEqual(resumo["pulados"], 0)

    def test_dry_run_nao_faz_post(self):
        resumo = publicar([CHUNK_OK], self.url, dry_run=True, limit=None)
        self.assertEqual(resumo["publicados"], 0)
        self.assertEqual(resumo["publicaria"], 1)
        self.assertEqual(Fake.posts, [])

    def test_limit_corta_a_lista(self):
        outro = dict(CHUNK_OK, chunk_id="10-1", chunk_index=1)
        resumo = publicar([CHUNK_OK, outro], self.url, dry_run=False, limit=1)
        self.assertEqual(resumo["publicados"], 1)


if __name__ == "__main__":
    unittest.main()
