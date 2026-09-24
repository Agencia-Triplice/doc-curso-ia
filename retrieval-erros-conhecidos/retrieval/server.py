"""Servidor HTTP stdlib do retrieval BDC — contrato MS3 (o curadoria fala com este
servico como se fosse o MS3 Java) + pagina de teste + extensao /v1/diagnose.
Rodar:  .venv/Scripts/python server.py   (porta 8003, env RETRIEVAL_PORT)
Endpoints (contrato MS3):
  GET    /health/live, /health/ready       -> 200
  GET    /                                 -> pagina de teste
  GET    /v1/info                          -> store.info_ms3()
  GET    /v1/documents?limit&offset&q      -> {documentos:[...], total}
  GET    /v1/documents/{id}                -> DocumentOut ou 404
  POST   /v1/documents  [DocumentIn,...]   -> 201 {ingeridos,total_corpus} | 422 | 413
  PUT    /v1/documents/{id}                -> DocumentOut ou 404
  DELETE /v1/documents/{id}                -> 204 ou 404
  POST   /v1/search     {query,servico?}   -> SearchResponse (ms3_contract.to_search_response)
  POST   /v1/reindex                       -> {documentos, componentes}
Extensao (fora do contrato MS3, mantida):
  POST   /v1/diagnose   {fingerprint?, query, servico?}  (checa cura exata, senao RAG)
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import ms3_contract
import store

PORT = int(os.environ.get("RETRIEVAL_PORT", "8003"))

PAGE = """<!doctype html><html lang=pt-br><head><meta charset=utf8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Retrieval BDC</title>
<style>
:root{color-scheme:light dark;--bg:#0f1416;--card:#161d20;--ink:#e7edeb;--mut:#7f8f8c;
--acc:#3fb3ba;--good:#5cc07f;--bad:#e0776d;--line:#28322f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.5 system-ui,sans-serif;padding:24px;max-width:900px;margin:auto}
h1{font-size:1.4rem}.mut{color:var(--mut)}code{background:#0c1315;padding:1px 5px;border-radius:4px}
input,select,button{font:inherit;padding:9px 11px;border-radius:8px;border:1px solid var(--line);
background:var(--card);color:var(--ink)}input{width:100%}
.row{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap}.row>*{flex:0 0 auto}.row>input{flex:1 1 240px}
button{background:var(--acc);color:#03282a;border:none;font-weight:600;cursor:pointer}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}
.badge{font:600 12px monospace;padding:2px 8px;border-radius:999px}
.g{background:#12291c;color:var(--good)}.b{background:#2e1613;color:var(--bad)}
.hit{border-left:3px solid var(--acc);padding:8px 12px;margin:8px 0;background:#0c1315;border-radius:8px}
.hit h3{margin:.1rem 0;font-size:1rem}.hit .m{font:12px monospace;color:var(--mut)}
</style></head><body>
<h1>🔎 Retrieval BDC <span class=mut style=font-size:.8rem id=info></span></h1>
<p class=mut>Híbrido BM25+denso(OpenAI 1536) · RRF · gate cosseno. Teste dúvida de processo ou erro.</p>
<div class=row>
  <input id=q placeholder="ex.: como cria um kv  ·  preciso criar um key vault  ·  ImagePullBackOff" autofocus>
  <button onclick=go()>Buscar</button>
</div>
<div id=out></div>
<script>
async function info(){let r=await fetch('/v1/info').then(r=>r.json());
 document.getElementById('info').textContent=
 `· ${r.documentos} docs · denso=${r.componentes.denso} · thr=${r.grounding_threshold} · top=${r.top_fusion}/${r.top_final}`}
async function go(){
 let q=document.getElementById('q').value.trim(); if(!q)return;
 let out=document.getElementById('out'); out.innerHTML='<p class=mut>buscando…</p>';
 let r=await fetch('/v1/search',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({query:q})}).then(r=>r.json());
 let head=`<div class=card><span class="badge ${r.grounded?'g':'b'}">${r.grounded?'GROUNDED':'ÓRFÃO'}</span>
   <span class=mut style=margin-left:8px>confianca=${r.confianca}</span></div>`;
 let hits=r.resultados.map(h=>`<div class=hit><h3>${esc(h.titulo)}</h3>
   <div class=m>${esc(h.servico||'')} · rrf=${h.score_rrf} · confianca=${h.confianca}</div>
   <div>${esc(h.conteudo)}</div></div>`).join('');
 out.innerHTML=head+(hits||'<p class=mut>nenhum resultado</p>');
}
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function escAttr(s){return (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function safeHref(u){u=(u||'').trim();
 if(!/^https?:\\/\\//i.test(u))return ''; // so http/https, evita javascript:/data:
 return '· <a href="'+escAttr(u)+'" target=_blank rel=noopener>run ↗</a>';}
document.getElementById('q').addEventListener('keydown',e=>{if(e.key==='Enter')go()});
info();
</script></body></html>"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        if b:
            self.wfile.write(b)

    def _json_body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def _documents_get(self):
        p = urlparse(self.path)
        parts = p.path.strip("/").split("/")
        conn = store.connect()
        try:
            if len(parts) == 3:  # /v1/documents/{id}
                try:
                    doc_id = int(parts[2])
                except ValueError:
                    return self._send(404, json.dumps({"erro": "not found"}))
                d = store.get_documento(conn, doc_id)
                return self._send(200 if d else 404,
                                   json.dumps(d or {"erro": "not found"}, ensure_ascii=False))
            q = parse_qs(p.query)
            try:
                limit = max(1, min(200, int(q.get("limit", ["50"])[0])))
            except ValueError:
                limit = 50
            try:
                offset = max(0, int(q.get("offset", ["0"])[0]))
            except ValueError:
                offset = 0
            term = q.get("q", [None])[0]
            docs, total = store.list_documentos(conn, limit, offset, term)
            return self._send(200, json.dumps({"documentos": docs, "total": total}, ensure_ascii=False))
        finally:
            conn.close()

    def do_GET(self):
        if self.path in ("/health/live", "/health/ready"):
            return self._send(200, json.dumps({"status": "ok"}))
        if self.path == "/" or self.path.startswith("/index"):
            return self._send(200, PAGE, "text/html")
        if self.path == "/v1/info":
            conn = store.connect()
            try:
                return self._send(200, json.dumps(store.info_ms3(conn)))
            finally:
                conn.close()
        if self.path.startswith("/v1/documents"):
            return self._documents_get()
        self._send(404, json.dumps({"erro": "not found"}))

    def do_POST(self):
        try:
            body = self._json_body()
        except Exception as e:
            return self._send(400, json.dumps({"erro": f"json invalido: {e}"}))
        conn = store.connect()
        try:
            if self.path == "/v1/documents":
                if not isinstance(body, list):
                    return self._send(422, json.dumps({"erro": "esperado array de documentos"}))
                if len(body) > ms3_contract.MAX_BATCH:
                    return self._send(413, json.dumps({"erro": "lote > 200"}))
                for it in body:
                    errs = ms3_contract.validate_document_in(it)
                    if errs:
                        return self._send(422, json.dumps({"erro": errs}, ensure_ascii=False))
                ing, total = store.ingest_documents(conn, body)
                return self._send(201, json.dumps({"ingeridos": ing, "total_corpus": total}))
            if self.path == "/v1/search":
                eng = store.search(conn, body["query"], servico=body.get("servico"))
                return self._send(200, json.dumps(ms3_contract.to_search_response(eng), ensure_ascii=False))
            if self.path == "/v1/reindex":
                n = store.embed_missing(conn, log=lambda *_: None)
                docs = store.info_ms3(conn)["documentos"]
                return self._send(200, json.dumps({"documentos": docs,
                    "componentes": {"bm25": True, "denso": True, "reranker": False}}))
            if self.path == "/v1/diagnose":
                fp = body.get("fingerprint")
                if fp:
                    cura = store.lookup_cura(conn, fp)
                    if cura:
                        return self._send(200, json.dumps(
                            {"fonte": "cura_exata", **cura}, ensure_ascii=False))
                r = store.search(conn, body["query"], tipo=body.get("tipo", "log_erro"),
                                 servico=body.get("servico"))
                return self._send(200, json.dumps({"fonte": "rag", **r}, ensure_ascii=False))
            self._send(404, json.dumps({"erro": "not found"}))
        except Exception as e:
            self._send(500, json.dumps({"erro": str(e)}))
        finally:
            conn.close()

    def do_PUT(self):
        parts = self.path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["v1", "documents"]:
            try:
                doc_id = int(parts[2])
            except ValueError:
                return self._send(404, json.dumps({"erro": "not found"}))
            try:
                body = self._json_body()
            except Exception as e:
                return self._send(400, json.dumps({"erro": f"json invalido: {e}"}))
            try:
                titulo = body["titulo"]
                conteudo = body["conteudo"]
            except (KeyError, TypeError):
                return self._send(422, json.dumps({"erro": "titulo e conteudo sao obrigatorios"}))
            conn = store.connect()
            try:
                d = store.update_documento_ms3(conn, doc_id, titulo,
                    conteudo, body.get("servico"), body.get("nivel"), body.get("tags"))
                return self._send(200 if d else 404, json.dumps(d or {"erro": "not found"}, ensure_ascii=False))
            except Exception as e:
                self._send(500, json.dumps({"erro": str(e)}))
            finally:
                conn.close()
            return
        self._send(404, json.dumps({"erro": "not found"}))

    def do_DELETE(self):
        parts = self.path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["v1", "documents"]:
            try:
                doc_id = int(parts[2])
            except ValueError:
                return self._send(404, json.dumps({"erro": "not found"}))
            conn = store.connect()
            try:
                ok = store.delete_documento(conn, doc_id)
                return self._send(204 if ok else 404, b"" if ok else json.dumps({"erro": "not found"}))
            except Exception as e:
                self._send(500, json.dumps({"erro": str(e)}))
            finally:
                conn.close()
            return
        self._send(404, json.dumps({"erro": "not found"}))


if __name__ == "__main__":
    conn = store.connect()
    store.apply_schema(conn)
    print("info:", json.dumps(store.info_ms3(conn), ensure_ascii=False))
    conn.close()
    print(f"Retrieval BDC em http://localhost:{PORT}  (Ctrl+C para sair)")
    # so localhost: /v1/documents escreve no corpus sem auth (ferramenta de dev).
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
