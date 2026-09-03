# ⚠ Instruções de migração — o que NÃO tocar no destino

> **REGRA CRÍTICA.** A migração substitui **apenas o código-fonte da aplicação** dos
> microsserviços entregues aqui. Ela **NÃO PODE alterar nada da configuração de
> infraestrutura / ambiente do DESTINO.** Se qualquer passo da migração for mexer em
> proxy, certificado ou config de ambiente do destino, **PARE** — isso é erro de
> migração, não faz parte da entrega.

## 1. NÃO alterar no destino (preservar intacto)

Estes itens são **específicos do ambiente de destino** e devem ficar **exatamente como
estão** — não sobrescrever, não normalizar, não recriar:

- **Proxy (corporativo):** variáveis `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`,
  configuração de proxy do npm/pnpm (`.npmrc`, `proxy`/`https-proxy`), `ARG`/`ENV` de
  proxy no `Dockerfile`, e qualquer proxy no `containerd`/runtime.
- **Certificados do Bradesco / CA corporativa:** cadeias de CA internas,
  `NODE_EXTRA_CA_CERTS`, arquivos de certificado (`.pem`/`.crt`/`.cer`), truststores /
  keystores, e a configuração de TLS/mTLS do destino.
- **Variáveis de ambiente e segredos do destino:** tokens, credenciais, `x-api-key`,
  URLs de registry, endpoints internos — vêm do ambiente/cofre do destino, **não** deste
  pacote.
- **Config de plataforma:** `values.yaml`/Helm, manifests do cluster (ArgoCD), DNS/hosts,
  Ingress/rotas — são do destino.

> O `.env.example` incluído nos projetos é **só um template de referência**. **Não** copie
> por cima do `.env` real do destino, e **não** use os valores dele em produção.

## 2. O que a migração PODE alterar

Apenas os **arquivos de código-fonte da aplicação** entregues neste pacote
(`src/`, `static/`, `test/`), aplicando as mudanças descritas nos manifestos `FIX-*.md`.
Nada de infraestrutura/ambiente.

## 2.1 ⚠ O FRONT MORA 100% EM `static/` — SUBSTITUIR É OBRIGATÓRIO

Os fronts do `dvop-bff-curadoria` e do `dvop-bff-log-view` são **SPA sem build**: todo o
HTML/CSS/JS vive em **`static/`** e é servido direto pelo Nest
(`ServeStaticModule`, `rootPath: join(__dirname, '..', 'static')`). Com `start =
node dist/main.js`, isso resolve para `dist/../static`, ou seja **a pasta `static/` na raiz
do projeto** — e o `static/` **NÃO entra no `nest build`/`dist`**.

**Consequência:** se você atualizar só `src/` (e refizer o `dist/`) mas **deixar o `static/`
antigo**, o front continua o antigo — mesmo com o backend novo. Sintoma típico: a aba do
navegador mostra o título/telas antigos.

**Portanto, na migração, SUBSTITUA a pasta `static/` inteira** (`index.html`, `css/`, `js/`)
pela deste pacote, para cada serviço:
- `dvop-bff-curadoria/static/` → por cima do `static/` do destino
- `dvop-bff-log-view/static/` → por cima do `static/` do destino (inclui `cockpit.html`)

Depois **reinicie** o processo e faça **hard refresh** no navegador (`Ctrl+Shift+R`).

**Verificação (no destino):**
```bash
curl -s localhost:8004/index.html | grep -i "<title>"   # curadoria: "Bex · Curadoria & Elegibilidade DVOP"
curl -s localhost:8004/css/app.css | grep -c "bex-red"  # > 0
```
Se o `<title>` vier o antigo ("dvop - curadoria"), o `static/` servido ainda é o velho:
confirme que o `static/` do destino é **irmão do `dist/`** que o `node dist/main.js` executa.

## 3. Procedimento seguro

1. Copie o **código** (`src/`, `static/`, `test/`) sobre o destino **sem** tocar nos
   arquivos de config de ambiente (item 1). Se a ferramenta de cópia for sobrescrever um
   arquivo de proxy/cert/env do destino, **exclua-o da cópia**.
2. **Não** recrie nem "conserte" `.env`, `.npmrc`, `Dockerfile` (linhas de proxy) ou
   certificados do destino.
3. Após copiar, **valide antes de buildar** que o destino continua com:
   - proxy configurado como estava (teste um `npm ping`/pull do registry interno);
   - os certificados/CA do Bradesco no lugar (o TLS para os endpoints internos ainda
     confia na cadeia corporativa).
4. Só então rode build/deploy conforme a seção "Deploy" de cada manifesto `FIX-*.md`.

## 4. Se a migração já quebrou algo de proxy/cert no destino

Reverta **apenas** os arquivos de infraestrutura do destino ao estado anterior (proxy,
`.npmrc`, `Dockerfile`, certificados/CA) — o código da aplicação pode ficar. O sintoma
típico é falha de rede/registry ou erro de TLS (`unable to get local issuer certificate`,
`self signed certificate in certificate chain`) ao buildar/subir no destino.
