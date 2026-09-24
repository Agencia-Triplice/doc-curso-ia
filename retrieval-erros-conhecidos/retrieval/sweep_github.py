"""Varredura do GitHub: acha runs de CI com falha nas orgs do usuario (e repos
proprios), extrai a assinatura do erro dos logs, gera uma CURA em pt-BR (OpenAI
gpt-4o-mini) e registra no retrieval como `cura` (reuso exato por fingerprint) +
`log_erro` (entra no corpus RAG).

Resiliente e RESUMIVEL: estado em sweep_state.json (runs ja processadas + fingerprints
ja curados). Rodar de novo continua de onde parou. Cada run e salva no estado assim que
processada, entao um desligamento no meio nao perde o trabalho ja feito.

Uso:
    python sweep_github.py                # varre ate atingir a meta
    python sweep_github.py --alvo 100     # meta de curas distintas (default 100)
    python sweep_github.py --max-runs 300 # teto de runs examinadas
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

import config
import store

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(HERE, "sweep_state.json")

USER = "TIAGOLINHARES"
ORGS = ["tiago-linhares-learning", "Agencia-Triplice", "GDD-Core",
        "GDD-Actions", "GDD-Automation"]

CURA_MODEL = os.environ.get("RETRIEVAL_CURA_MODEL", "gpt-4o-mini")
CURA_ENDPOINT = "https://api.openai.com/v1/chat/completions"

# ---- gh helpers -------------------------------------------------------------

def gh_json(path, jq=None, paginate=False):
    cmd = ["gh", "api", path]
    if paginate:
        cmd.append("--paginate")
    if jq:
        cmd += ["--jq", jq]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        return None
    return r.stdout


def listar_repos():
    """full_name de todos os repos acessiveis (user + orgs)."""
    repos = []
    out = gh_json(f"users/{USER}/repos?per_page=100&type=owner", jq=".[].full_name", paginate=True)
    if out:
        repos += [l for l in out.splitlines() if l.strip()]
    for org in ORGS:
        out = gh_json(f"orgs/{org}/repos?per_page=100&type=all", jq=".[].full_name", paginate=True)
        if out:
            repos += [l for l in out.splitlines() if l.strip()]
    # de-dup preservando ordem
    seen, uniq = set(), []
    for r in repos:
        if r not in seen:
            seen.add(r)
            uniq.append(r)
    return uniq


def runs_falhos(full_name, limite=60):
    """Lista runs com conclusion=failure de um repo: (run_id, titulo, url, branch, workflow)."""
    out = gh_json(
        f"repos/{full_name}/actions/runs?status=failure&per_page={limite}",
        jq=".workflow_runs[] | [.id, .display_title, .html_url, .head_branch, .name] | @tsv",
    )
    if not out:
        return []
    runs = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 3:
            runs.append({
                "id": parts[0], "titulo": parts[1] if len(parts) > 1 else "",
                "url": parts[2], "branch": parts[3] if len(parts) > 3 else "",
                "workflow": parts[4] if len(parts) > 4 else "",
            })
    return runs


def log_falho(full_name, run_id):
    r = subprocess.run(
        ["gh", "run", "view", str(run_id), "--repo", full_name, "--log-failed"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if r.returncode != 0 or not r.stdout.strip():
        return ""
    return r.stdout

# ---- extracao / normalizacao da assinatura ----------------------------------

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
# prefixo do gh --log-failed: "job\tstep\t2024-..Z <msg>"  (ou so o timestamp ISO)
_PREFIXO_TS = re.compile(r"^.*?\t.*?\t[﻿\s]*\d{4}-\d\d-\d\dT[\d:.]+Z?\s?")
_TS_ISO = re.compile(r"\d{4}-\d\d-\d\dT[\d:.]+Z?")
_HORA = re.compile(r"\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b")
_UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
_HEX = re.compile(r"\b[0-9a-f]{7,}\b", re.I)
_PATH_U = re.compile(r"(?:/[\w.\-]+){2,}/?")
_PATH_W = re.compile(r"[A-Za-z]:\\[\w.\\\-]+")
_URL = re.compile(r"https?://\S+")
_NUM = re.compile(r"\b\d{2,}\b")

MARCADOR_ERRO = re.compile(
    r"(?i)(\berror\b|\berro\b|\bfail(?:ed|ure)?\b|\bexception\b|traceback|\bfatal\b|"
    r"npm err!|\bdenied\b|not found|\bcannot\b|\bunable\b|refused|timed? out|\bpanic\b|"
    r"unauthorized|forbidden|\binvalid\b|\bmissing\b|imagepullbackoff|crashloopbackoff|"
    r"build failure|\bassert|exit code [1-9]|##\[error\])"
)
# ruido puro que so serve de ancora, nunca como assinatura sozinha
RUIDO = re.compile(r"(?i)^(##\[error\]\s*)?process completed with exit code \d+\.?$")
# linhas de ruido conhecido: casam MARCADOR mas nao descrevem a falha (descartar)
LIXO = re.compile(
    r"(?i)(a complete log of this run can be found in|"
    r"see (?:above|the logs? )?for (?:more )?details|"
    r"for a full report|npm err! a complete log|"
    r"error: process completed|##\[group\]|##\[endgroup\])"
)


def normalizar(linha):
    t = _URL.sub("<URL>", linha)
    t = _PATH_W.sub("<PATH>", t)
    t = _PATH_U.sub("<PATH>", t)
    t = _UUID.sub("<UUID>", t)
    t = _TS_ISO.sub("<TS>", t)
    t = _HORA.sub("<TS>", t)
    t = _HEX.sub("<HASH>", t)
    t = _NUM.sub("<N>", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def extrair_assinatura(log_texto):
    """Retorna (assinatura_legivel, assinatura_normalizada, linhas_cruas)."""
    cruas, norm = [], []
    vistos = set()
    ancora = None
    for raw in log_texto.splitlines():
        linha = _ANSI.sub("", raw)
        linha = _PREFIXO_TS.sub("", linha)
        linha = linha.rstrip()
        if not linha or len(linha) < 6:
            continue
        if not MARCADOR_ERRO.search(linha):
            continue
        if LIXO.search(linha):
            continue
        linha = linha[:300]
        n = normalizar(linha)
        if RUIDO.match(linha):
            ancora = ancora or n
            continue
        if not n or n in vistos:
            continue
        vistos.add(n)
        cruas.append(linha)
        norm.append(n)
        if len(norm) >= 8:
            break
    if not norm and ancora:
        norm = [ancora]
        cruas = ["Process completed with exit code (sem linha de erro especifica)"]
    if not norm:
        return None, None, []
    assinatura = "\n".join(cruas)
    assinatura_norm = "\n".join(norm)
    return assinatura, assinatura_norm, cruas


def fingerprint(assinatura_norm, repo=None):
    base = (repo + "\n" if repo else "") + assinatura_norm
    return hashlib.sha256(base.encode("utf-8")).hexdigest()[:16]

# ---- geracao da cura (OpenAI) ----------------------------------------------

SYS_CURA = (
    "Voce e um engenheiro DevSecOps senior. Recebe a assinatura de erro de um run de "
    "CI/CD do GitHub Actions que falhou. Escreva uma CURA objetiva em portugues do Brasil: "
    "(1) causa provavel em 1 frase; (2) passos de correcao numerados e acionaveis. "
    "Seja conciso (maximo ~7 linhas). Baseie-se SO no que o erro mostra; nao invente "
    "nomes de arquivo, versoes ou comandos que nao aparecem. Se o erro for generico, "
    "de os primeiros passos de diagnostico. Nao use markdown de titulo, apenas texto e "
    "uma lista numerada."
)


def gerar_cura(repo, workflow, assinatura, titulo_run):
    key = config.openai_key()
    user = (
        f"Repositorio: {repo}\nWorkflow: {workflow or '?'}\n"
        f"Titulo do run: {titulo_run or '?'}\n\nAssinatura do erro (linhas do log):\n{assinatura[:2000]}"
    )
    body = json.dumps({
        "model": CURA_MODEL,
        "messages": [{"role": "system", "content": SYS_CURA},
                     {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_completion_tokens": 400,
    }).encode("utf-8")
    req = urllib.request.Request(
        CURA_ENDPOINT, data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                d = json.loads(resp.read().decode("utf-8"))
            return (d["choices"][0]["message"]["content"] or "").strip()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503):
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"OpenAI chat falhou: HTTP {e.code} {e.read()[:200]!r}") from e
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 * (attempt + 1))
    return ""

# ---- estado -----------------------------------------------------------------

def carregar_estado():
    if os.path.isfile(STATE_PATH):
        try:
            return json.load(open(STATE_PATH, encoding="utf-8"))
        except Exception:
            pass
    return {"runs_processadas": [], "fingerprints": [], "curas_registradas": 0}


def salvar_estado(st):
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_PATH)

# ---- orquestracao -----------------------------------------------------------

_TITULO_FORTE = re.compile(
    r"(?i)(error|exception|erro|failed|failure|denied|invalid|not found|cannot|"
    r"unable|refused|fatal|blob upload|imagepull|crashloop|build failure)")
_TITULO_FRACO = re.compile(r"(?i)^(fail-on-cache-miss|##\[|\{\"|continue-on-error)")


def _limpa_titulo(s):
    s = _ANSI.sub("", s)
    s = re.sub(r"[│┌┐└┘├┤┬┴┼─╭╮╯╰|]+", " ", s)          # moldura de tabela (Trivy)
    s = re.sub(r"^[\s#>\-*.:]+", "", s)                   # prefixos de ruido
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _titulo_util(s):
    return len(re.sub(r"[^0-9A-Za-zÀ-ÿ]", "", s)) >= 8   # tem conteudo real


def titulo_curto(cruas, repo):
    """Escolhe a 1a linha 'forte' (que descreve o erro) para o titulo; pula ecos de
    config, JSON e molduras de tabela; cai numa linha util qualquer, senao generico."""
    forte = fraca = None
    for c in cruas:
        c = _limpa_titulo(c)
        if not _titulo_util(c) or _TITULO_FRACO.search(c):
            continue
        if _TITULO_FORTE.search(c):
            forte = forte or c
        else:
            fraca = fraca or c
    escolha = forte or fraca
    if not escolha:
        return f"{repo}: falha de CI"
    base = re.sub(r"^##\[error\]\s*", "", escolha).strip()
    return f"{repo}: {base[:90]}"


def sweep(alvo=100, max_runs=300, log=print):
    st = carregar_estado()
    processadas = set(st.get("runs_processadas", []))
    fps = set(st.get("fingerprints", []))
    conn = store.connect()
    store.apply_schema(conn)

    log(f"Estado inicial: {len(processadas)} runs ja vistas, {len(fps)} curas.")
    repos = listar_repos()
    log(f"Repos acessiveis: {len(repos)}")

    examinadas = 0
    novas_curas = 0
    sem_assinatura = 0

    for repo in repos:
        if len(fps) >= alvo or examinadas >= max_runs:
            break
        runs = runs_falhos(repo)
        if not runs:
            continue
        log(f"[{repo}] {len(runs)} runs com falha")
        for run in runs:
            if len(fps) >= alvo or examinadas >= max_runs:
                break
            if run["url"] in processadas:
                continue
            examinadas += 1
            processadas.add(run["url"])
            try:
                texto = log_falho(repo, run["id"])
                assinatura, norm, cruas = extrair_assinatura(texto) if texto else (None, None, [])
                if not norm:
                    sem_assinatura += 1
                    salvar_estado({"runs_processadas": sorted(processadas),
                                   "fingerprints": sorted(fps),
                                   "curas_registradas": st.get("curas_registradas", 0) + novas_curas})
                    continue
                fp = fingerprint(norm, repo)
                if fp in fps:
                    salvar_estado({"runs_processadas": sorted(processadas),
                                   "fingerprints": sorted(fps),
                                   "curas_registradas": st.get("curas_registradas", 0) + novas_curas})
                    continue  # erro identico ja curado
                cura = gerar_cura(repo, run["workflow"], assinatura, run["titulo"])
                if not cura:
                    cura = ("Nao foi possivel gerar a cura automaticamente. Analise a "
                            "assinatura do erro abaixo e trate a causa raiz manualmente.")
                titulo = titulo_curto(cruas, repo)
                conteudo = (f"SINTOMA (assinatura do erro):\n{assinatura}\n\n"
                            f"CURA:\n{cura}")
                doc_id = store.upsert_documento(
                    conn, tipo="log_erro", titulo=titulo, conteudo=conteudo,
                    servico=repo.split("/")[-1], nivel=run["branch"] or None,
                    tags=["origem:github-sweep", f"repo:{repo}", f"workflow:{run['workflow']}"],
                    origem_fingerprint=fp, origem_run_url=run["url"], source_url=run["url"],
                    aprovado_por="github-sweep",
                    metadata={"repo": repo, "workflow": run["workflow"], "branch": run["branch"]},
                )
                store.register_cura(
                    conn, fingerprint=fp, titulo=titulo, assinatura=norm, cura=cura,
                    servico=repo.split("/")[-1], nivel=run["branch"] or None,
                    origem_run_url=run["url"], origem_repo=repo, documento_id=doc_id,
                )
                fps.add(fp)
                novas_curas += 1
                log(f"  + cura {len(fps):>3}/{alvo}  {titulo[:70]}")
            except Exception as e:
                log(f"  ! erro em {run['url']}: {e}")
            finally:
                salvar_estado({"runs_processadas": sorted(processadas),
                               "fingerprints": sorted(fps),
                               "curas_registradas": st.get("curas_registradas", 0) + novas_curas})

    log(f"\nEmbedando chunks novos...")
    store.embed_missing(conn, log=log)
    info = store.info(conn)
    log(f"\n== FIM ==  examinadas={examinadas} novas_curas={novas_curas} "
        f"sem_assinatura={sem_assinatura}")
    log(json.dumps(info, ensure_ascii=False))
    conn.close()
    return info


if __name__ == "__main__":
    alvo = 100
    max_runs = 300
    if "--alvo" in sys.argv:
        alvo = int(sys.argv[sys.argv.index("--alvo") + 1])
    if "--max-runs" in sys.argv:
        max_runs = int(sys.argv[sys.argv.index("--max-runs") + 1])
    sweep(alvo=alvo, max_runs=max_runs)
