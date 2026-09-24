"""Importa a base de erros conhecidos (Confluence biatech) para o MS 3 (retrieval).

Lê agt/curso/curso/erros-conhecidos/rag-ready/chunks.jsonl + index.json, filtra
chunks sem conteúdo real (páginas hasContent:false e chunks que são só
título+URL — texto útil após remover título/URLs < 80 chars) e publica em
POST /v1/documents. Idempotente (spec §4.5, dedupe por page_id#chunk_index):
consulta GET /v1/documents e pula chunks cuja tag `chunk:<chunk_id>` já foi
publicada (re-execução segura; título sozinho não é chave — duas páginas
podem compartilhar título). MS 3 fora do ar → aborta com o resumo do que já
publicou.

Uso: python tools/importar_erros_conhecidos.py [--retrieval-url http://localhost:8003]
                                               [--dry-run] [--limit N]
Stdlib-only (urllib, json, argparse) — sem venv.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib import error as urlerror
from urllib import request as urlrequest

RAIZ = Path(__file__).resolve().parent.parent
ERROS = RAIZ / "agt" / "curso" / "curso" / "erros-conhecidos"
CHUNKS = ERROS / "rag-ready" / "chunks.jsonl"
INDEX = ERROS / "index.json"

URL_RE = re.compile(r"https?://\S+", re.I)
MIN_TEXTO_UTIL = 80
LOTE = 50
PAGINA_LISTAGEM = 200
MAX_TITULO = 300
MAX_CONTEUDO = 20000


def texto_util(chunk: dict) -> str:
    """O que sobra do texto sem o título e sem URLs — mede conteúdo real."""
    resto = str(chunk.get("text", "")).replace(str(chunk.get("title", "")), " ")
    resto = URL_RE.sub(" ", resto)
    return re.sub(r"\s+", " ", resto).strip()


def filtrar_chunks(chunks: list[dict], paginas_sem_conteudo: set[str]) -> list[dict]:
    return [c for c in chunks
            if str(c.get("page_id")) not in paginas_sem_conteudo
            and len(texto_util(c)) >= MIN_TEXTO_UTIL]


def montar_documento(chunk: dict) -> dict:
    titulo = f"{chunk.get('title', 'sem título')} #{chunk.get('chunk_index', 0)}"[:MAX_TITULO]
    conteudo = str(chunk.get("text", ""))
    fonte = str(chunk.get("source_url", ""))
    if fonte:
        conteudo = f"{conteudo}\n\nFonte: {fonte}"
    return {"titulo": titulo, "conteudo": conteudo[:MAX_CONTEUDO],
            # tag ≤64 chars no MS 3: a URL longa vai no conteúdo, não na tag
            "tags": ["origem:confluence-biatech",
                     f"page:{chunk.get('page_id', '')}"[:64],
                     f"chunk:{chunk.get('chunk_id', '')}"[:64]]}


def _json_http(url: str, corpo: dict | list | None = None) -> dict:
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    req = urlrequest.Request(url, data=dados,
                             headers={"Content-Type": "application/json"} if dados else {})
    with urlrequest.urlopen(req, timeout=30) as resp:  # noqa: S310 — URL local do operador
        return json.load(resp)


def chunk_tags_existentes(retrieval_url: str) -> set[str]:
    """Tags `chunk:<chunk_id>` (== page_id#chunk_index, ver montar_documento) dos
    documentos já publicados — chave de idempotência da spec §4.5. Título não
    serve de chave: páginas diferentes podem ter o mesmo título."""
    tags: set[str] = set()
    offset = 0
    while True:
        pagina = _json_http(f"{retrieval_url}/v1/documents?limit={PAGINA_LISTAGEM}&offset={offset}")
        docs = pagina.get("documentos", [])
        for d in docs:
            tags.update(str(t) for t in d.get("tags", []) if str(t).startswith("chunk:"))
        offset += len(docs)
        if len(docs) < PAGINA_LISTAGEM or offset >= int(pagina.get("total", 0)):
            return tags


def publicar(chunks: list[dict], retrieval_url: str, dry_run: bool, limit: int | None) -> dict:
    retrieval_url = retrieval_url.rstrip("/")
    resumo = {"publicados": 0, "pulados": 0, "publicaria": 0}
    try:
        existentes = chunk_tags_existentes(retrieval_url)
    except (urlerror.URLError, OSError) as e:
        print(f"MS 3 indisponível em {retrieval_url}: {e}", file=sys.stderr)
        raise SystemExit(2) from e
    novos: list[dict] = []
    for chunk in chunks:
        doc = montar_documento(chunk)
        chunk_tag = next(t for t in doc["tags"] if t.startswith("chunk:"))
        if chunk_tag in existentes:
            resumo["pulados"] += 1
            continue
        novos.append(doc)
        if limit is not None and len(novos) >= limit:
            break
    if dry_run:
        for doc in novos:
            print(f"[dry-run] publicaria: {doc['titulo']}")
        resumo["publicaria"] = len(novos)
        return resumo
    for i in range(0, len(novos), LOTE):
        lote = novos[i:i + LOTE]
        try:
            _json_http(f"{retrieval_url}/v1/documents", lote)
        except (urlerror.URLError, OSError) as e:
            print(f"MS 3 falhou no lote {i // LOTE + 1}: {e} — "
                  f"publicados até aqui: {resumo['publicados']}", file=sys.stderr)
            raise SystemExit(2) from e
        resumo["publicados"] += len(lote)
        print(f"publicados {resumo['publicados']}/{len(novos)}")
    return resumo


def main() -> None:
    # console Windows (cp1252) não imprime emojis dos títulos do Confluence
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--retrieval-url", default="http://localhost:8003")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    paginas_sem_conteudo = {str(p["id"]) for p in json.loads(INDEX.read_text(encoding="utf-8"))
                            if not p.get("hasContent")}
    chunks = [json.loads(l) for l in CHUNKS.read_text(encoding="utf-8").splitlines() if l.strip()]
    uteis = filtrar_chunks(chunks, paginas_sem_conteudo)
    print(f"{len(chunks)} chunks lidos; {len(uteis)} com conteúdo real")
    resumo = publicar(uteis, args.retrieval_url, args.dry_run, args.limit)
    print(json.dumps(resumo, ensure_ascii=False))


if __name__ == "__main__":
    main()
