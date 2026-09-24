"""Encoder OpenAI (text-embedding-3-small, 1536-d) via stdlib urllib — sem dependencias.
Batcha, tem retry com backoff e trunca entradas absurdas para caber na janela."""
import json
import time
import urllib.request
import urllib.error

import config

_ENDPOINT = "https://api.openai.com/v1/embeddings"
_MAX_BATCH = 128
_MAX_CHARS = 24000  # ~8k tokens de folga; entradas maiores sao truncadas


def _post(texts: list[str], key: str) -> list[list[float]]:
    body = json.dumps({"model": config.EMBED_MODEL, "input": texts}).encode("utf-8")
    req = urllib.request.Request(
        _ENDPOINT,
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            rows = sorted(data["data"], key=lambda d: d["index"])
            return [r["embedding"] for r in rows]
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read()[:300]!r}"
            if e.code in (429, 500, 502, 503):
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"OpenAI embeddings falhou: {last}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            last = str(e)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"OpenAI embeddings falhou apos retries: {last}")


def encode(texts: list[str]) -> list[list[float]]:
    """Retorna 1 vetor por texto, na ordem. Batcha internamente."""
    if not texts:
        return []
    key = config.openai_key()
    out: list[list[float]] = []
    clean = [(t or " ")[:_MAX_CHARS] for t in texts]
    for i in range(0, len(clean), _MAX_BATCH):
        out.extend(_post(clean[i : i + _MAX_BATCH], key))
    return out


def encode_one(text: str) -> list[float]:
    return encode([text])[0]
