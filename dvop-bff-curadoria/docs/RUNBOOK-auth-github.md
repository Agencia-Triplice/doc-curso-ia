# Runbook — autenticação (login GitHub) do curadoria

## 1. Criar a OAuth App (org GDD-Core)
GitHub → org GDD-Core → Settings → Developer settings → OAuth Apps → New:
- **Application name:** dvop-bff-curadoria
- **Homepage URL:** https://curadoria.meucardapioqrcode.com.br
- **Authorization callback URL:** https://curadoria.meucardapioqrcode.com.br/auth/callback

Anote **Client ID** e gere um **Client secret**.

## 2. Segredos no Key Vault + injeção via CSI (padrão da stack)
Os 3 segredos ficam no Azure Key Vault `kv-agentix-dvop` e são injetados como env
no container pelo Secrets Store CSI Driver — **mesmo padrão do `mcp-github-token`**,
não um Secret criado à mão. A fiação já está no
`tools/values-corporativo/dvop-bff-curadoria.yaml` (bloco `global.azurekv`):

| Segredo no KV | Env no container |
|---|---|
| `curadoria-github-client-id` | `CURADORIA_BFF_GITHUB_CLIENT_ID` |
| `curadoria-github-client-secret` | `CURADORIA_BFF_GITHUB_CLIENT_SECRET` |
| `curadoria-session-secret` | `CURADORIA_BFF_SESSION_SECRET` |

Gravar/rotacionar um segredo (Bash/WSL — **NUNCA** pipe do PowerShell, CRLF/BOM corrompe).
Use `--file` (o valor não aparece na linha de comando):

    printf '%s' "$(tr -d '\r\n' < ~/.agentix/git-curadoria-client.txt)" > /tmp/cid
    az keyvault secret set --vault-name kv-agentix-dvop \
      --name curadoria-github-client-id --file /tmp/cid --output none
    # idem curadoria-github-client-secret; para o session:
    printf '%s' "$(openssl rand -hex 32)" > /tmp/ssec
    az keyvault secret set --vault-name kv-agentix-dvop \
      --name curadoria-session-secret --file /tmp/ssec --output none
    rm -f /tmp/cid /tmp/ssec

Após rotacionar, o CSI recarrega no próximo ciclo; forçar com `kubectl rollout restart
deploy/dvop-bff-curadoria` (o rollout re-monta o volume CSI e re-emite o env).

> A identidade do cluster já lê outros segredos deste mesmo KV (mcp-github-token,
> remediation-github-token, pg-*). Se o acesso for por-segredo (e não no escopo do
> vault), garantir `get` nos 3 novos para a identidade do Secrets Store.

## 3. Ligar o gate por teams (quando quiser)
No ConfigMap (values-corporativo): preencher
`CURADORIA_BFF_GITHUB_ALLOWED_TEAMS` com os slugs (ex.: `curadoria,plataforma`).
Redeploy pela esteira. O gate vale igual para as duas formas de login (OAuth e
PAT), pois ambas carregam os teams do usuário na sessão.

## 4. Login por PAT (sempre disponível)
Além do botão OAuth, a tela de login aceita um **Personal Access Token**. O PAT é
validado uma vez contra a API do GitHub (mesmos `read:user`/`read:org` do OAuth) e
**descartado** — nunca é persistido nem logado; a sessão emitida é idêntica à do
OAuth (`via: github`). Útil quando o OAuth App ainda não existe (ex.: antes de
criar o app no GitHub Enterprise do Bradesco).

## 5. Portar para GitHub Enterprise Server (Bradesco)
O host do GitHub é configurável — o código não muda. No ConfigMap:
`CURADORIA_BFF_GITHUB_BASE_URL=https://<host-ghe>` e
`CURADORIA_BFF_GITHUB_API_URL=https://<host-ghe>/api/v3`. Depois crie a OAuth App
no GHES (mesmos passos da seção 1, mas no host corporativo) e atualize os 3
segredos do KV. Enquanto o app não existir, o login por PAT já funciona.

## 6. Deploy
`tools/sync-espelhos.ps1 -Apps dvop-bff-curadoria` → push → esteira CI+CD (ArgoCD sync).
