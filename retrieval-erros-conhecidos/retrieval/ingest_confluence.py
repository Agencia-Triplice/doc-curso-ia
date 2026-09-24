"""Ingestao do acervo curado (exports Confluence BiaTech) em agt/erros-conhecidos.

Estrategia resiliente (nao super-ajusta a marcacao): limpa tags -> texto -> fatia por
"Resposta da BIA TECH" -> cada entrada = sintoma (cauda anterior, com o ERROR: literal)
+ remediacao (cabeca seguinte). Um documento por PAGINA (tipo=log_erro), varios chunks
(um por entrada). Descarta stubs e entradas curtas. Idempotente por checksum."""
import html
import json
import os
import re
import sys

import store

# Acervo-fonte: por padrao aponta para data/source-html deste pacote (autossuficiente).
# Sobrescreva com RETRIEVAL_ACERVO para outro diretorio de exports Confluence.
ACERVO = os.environ.get(
    "RETRIEVAL_ACERVO",
    os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data", "source-html")),
)
MARCADOR = re.compile(r"resposta da bia\s*tech", re.I)
ERRO_LITERAL = re.compile(r"(ERROR:|ERRO:|FAILED|Exception|BUILD FAILURE)[^\n]{0,120}")


def limpar(htmltxt: str) -> str:
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", htmltxt)
    t = re.sub(r"(?is)<br\s*/?>", "\n", t)
    t = re.sub(r"(?is)</(p|div|h[1-6]|tr|li|td)>", "\n", t)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    t = html.unescape(t)
    t = re.sub(r"[ \t\u00a0]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t)
    # remove emoji comuns dos exports
    t = re.sub(r"[\U0001F000-\U0001FAFF\u2190-\u27BF\u2B00-\u2BFF]", "", t)
    return t.strip()


def entradas_da_pagina(texto: str):
    """Gera (titulo_curto, corpo) por entrada, via marcador de resposta."""
    segs = MARCADOR.split(texto)
    if len(segs) < 2:
        # pagina sem marcador: uma unica entrada se tiver conteudo
        corpo = texto.strip()
        if len(corpo) >= 200:
            yield None, corpo[:1600]
        return
    for i in range(1, len(segs)):
        sintoma = segs[i - 1][-600:].strip()
        remediacao = segs[i][:1000].strip()
        corpo = f"SINTOMA: {sintoma}\nRESPOSTA DA BIA TECH: {remediacao}"
        if len(corpo) < 120:
            continue
        m = ERRO_LITERAL.search(sintoma)
        titulo_curto = m.group(0).strip()[:110] if m else None
        yield titulo_curto, corpo


def carregar_indice():
    idx = {}
    p = os.path.join(ACERVO, "index.json")
    if os.path.isfile(p):
        for e in json.load(open(p, encoding="utf-8")):
            idx[e.get("file", "")] = e
    return idx


def ingerir(conn, log=print):
    idx = carregar_indice()
    docs = chunks = 0
    for fn in sorted(os.listdir(ACERVO)):
        if not fn.endswith(".html"):
            continue
        caminho = os.path.join(ACERVO, fn)
        if os.path.getsize(caminho) < 1200:  # stub
            continue
        raw = open(caminho, encoding="utf-8", errors="replace").read()
        texto = limpar(raw)
        if len(texto) < 400:
            continue
        meta = idx.get(fn, {})
        page_title = meta.get("title") or re.sub(r"^\d+-|\.html$|-", " ", fn).strip().title()
        page_title = re.sub(r"[\U0001F000-\U0001FAFF←-➿⬀-⯿]", "", page_title).strip()
        url = meta.get("url")
        entradas = list(entradas_da_pagina(texto))
        if not entradas:
            continue
        ja = conn.execute(
            "SELECT 1 FROM documentos WHERE tipo='log_erro' AND titulo=%s LIMIT 1",
            (page_title,),
        ).fetchone()
        if ja:
            log(f"  (ja existe) {page_title}")
            continue
        doc_id = conn.execute(
            """INSERT INTO documentos (tipo,titulo,categoria,tags,source_url,aprovado_por)
               VALUES ('log_erro',%s,%s,%s,%s,'confluence-biatech') RETURNING id""",
            (page_title, "erro-conhecido",
             json.dumps(["origem:confluence-biatech", f"page:{meta.get('id','?')}"]), url),
        ).fetchone()[0]
        docs += 1
        for ordinal, (titulo_curto, corpo) in enumerate(entradas):
            embed_text = store.build_embed_text(f"{page_title} — {titulo_curto or ''}".strip(" —"), corpo)
            if store.add_chunk(conn, doc_id, ordinal, corpo, embed_text,
                               metadata={"titulo_curto": titulo_curto}):
                chunks += 1
        log(f"  {page_title}: {len(entradas)} entradas")
    log(f"paginas={docs} chunks_novos={chunks}")
    return docs, chunks


if __name__ == "__main__":
    conn = store.connect()
    store.apply_schema(conn)
    ingerir(conn)
    if "--no-embed" not in sys.argv:
        print("embedando...")
        store.embed_missing(conn)
    print(json.dumps(store.info(conn), ensure_ascii=False))
    conn.close()
