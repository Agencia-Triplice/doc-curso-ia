"""Reranker cross-encoder (OPT-IN) sobre o top-N do RRF — a maior alavanca de precisao
do retrieval. Provider default: Jina AI (jina-reranker-v2-base-multilingual, forte em PT).
stdlib urllib, sem dependencias.

Contrato:
    rerank(query, documentos) -> list[float] | None
        score de relevancia por documento, na MESMA ordem da entrada; None quando o
        reranker esta desligado OU a chamada falha (o `store` cai de volta na ordem do
        RRF — degrada, nao quebra).

Trocar de provider (ex.: cross-encoder BGE self-hosted) = implementar outro `_post_*`
e rotear em `rerank`. O `store` nao conhece o provider."""
import json
import time
import urllib.error
import urllib.request

import config

_MAX_CHARS = 8000  # cross-encoder tem janela curta; trunca passagens gigantes


def enabled() -> bool:
    return config.RERANKER_ENABLED


def rerank(query: str, documentos: list[str]) -> list[float] | None:
    """Score por documento, alinhado a `documentos`. None se off/erro (fail-open)."""
    if not config.RERANKER_ENABLED or not documentos:
        return None
    docs = [(d or " ")[:_MAX_CHARS] for d in documentos]
    try:
        if config.RERANKER_PROVIDER == "jina":
            return _post_jina(query, docs)
        raise RuntimeError(f"provider desconhecido: {config.RERANKER_PROVIDER}")
    except Exception as e:  # resiliente: falhou -> chamador usa a ordem do RRF
        print(f"[reranker] desativado nesta chamada (falha: {e})")
        return None


def _post_jina(query: str, docs: list[str]) -> list[float]:
    body = json.dumps({
        "model": config.RERANKER_MODEL,
        "query": query,
        "documents": docs,
        "top_n": len(docs),  # queremos o score de TODOS, para reordenar na origem
    }).encode("utf-8")
    req = urllib.request.Request(
        config.RERANKER_ENDPOINT, data=body, method="POST",
        headers={"Authorization": f"Bearer {config.reranker_key()}",
                 "Content-Type": "application/json", "Accept": "application/json"},
    )
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return _align_scores(data.get("results", []), len(docs))
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read()[:200]!r}"
            if e.code in (429, 500, 502, 503):
                time.sleep(1.5 * (attempt + 1))
                continue
            raise RuntimeError(last) from e
        except (urllib.error.URLError, TimeoutError) as e:
            last = str(e)
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"apos retries: {last}")


def _align_scores(results: list, n: int) -> list[float]:
    """Mapeia [{index, relevance_score}, ...] de volta para a ordem de entrada."""
    scores = [0.0] * n
    for r in results or []:
        i = r.get("index")
        if isinstance(i, int) and 0 <= i < n:
            scores[i] = float(r.get("relevance_score") or 0.0)
    return scores
