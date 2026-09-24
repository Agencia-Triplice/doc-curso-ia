"""Seed de duvidas de processo (how-to) com aliases + perguntas canonicas, para
exercitar parafrase e sigla ("kv" vs "key vault"). Idempotente por checksum."""
import json
import sys

import store

HOWTOS = [
    dict(titulo="Como criar um KeyVault no projeto",
         conteudo="Solicite o cofre no BEX, provisione via IaC (Terraform), conceda acesso ao "
                  "SPN da aplicacao e referencie os segredos via CSI Secret Store no cluster.",
         produto="keyvault", categoria="provisionamento",
         aliases=["kv", "key vault", "cofre de chaves", "azure key vault"],
         perguntas=["como crio um kv?", "preciso criar um key vault", "provisionar cofre de segredos"]),
    dict(titulo="Como rotacionar um PAT do GitHub",
         conteudo="Gere um novo Personal Access Token com os escopos repo e workflow, atualize o "
                  "secret no cofre/cluster com gh secret set --body (nunca por pipe no PowerShell, "
                  "que injeta BOM/CRLF), e faca rollout dos deployments que o consomem.",
         produto="github", categoria="credenciais",
         aliases=["pat", "token de acesso", "personal access token", "rotacao de token"],
         perguntas=["como troco meu PAT?", "preciso renovar o token do github", "meu pat expirou"]),
    dict(titulo="Como criar um repositorio a partir de um starter kit",
         conteudo="Use o welcome kit oficial (repos starter-*) como ponto de partida. Crie o repo "
                  "novo, aplique o topic template-<kit> e a var REPO_TEMPLATE, e ligue as Actions "
                  "(vem desligado no kit).",
         produto="github", categoria="repositorio",
         aliases=["starter kit", "welcome kit", "novo repo", "scaffold", "template de repo"],
         perguntas=["como comeco um projeto novo?", "criar repositorio do zero", "usar o starter"]),
    dict(titulo="Como abrir um PR de remediacao pelo agente",
         conteudo="No cockpit/chat, descreva a correcao em linguagem natural; o AgentiX gera o diff "
                  "e o PR fica aguardando aprovacao humana. O app nunca fecha PR anterior; cada "
                  "remediacao abre um PR novo com branch unica.",
         produto="agentix", categoria="remediacao",
         aliases=["pr", "pull request", "remediacao", "correcao automatica", "abrir pr"],
         perguntas=["como peco uma correcao?", "quero abrir um pull request de fix", "gerar PR de remediacao"]),
    dict(titulo="Como configurar um secret no cluster (CSI)",
         conteudo="Cadastre o segredo no Key Vault, referencie no SecretProviderClass e monte via "
                  "CSI. O CSI NAO reescreve o Secret do Kubernetes: apague o Secret e faca rollout "
                  "restart para materializar o novo valor.",
         produto="kubernetes", categoria="segredos",
         aliases=["secret", "segredo", "csi", "secret provider", "variavel secreta"],
         perguntas=["como coloco um segredo no cluster?", "adicionar variavel secreta no k8s"]),
    dict(titulo="Como zerar a base da curadoria",
         conteudo="Nao ha endpoint de reset. Os stores sao SQLite em PVC /data: remova "
                  "/data/{cache,corpus,elegibilidade}.db* e faca rollout restart do deployment.",
         produto="curadoria", categoria="operacao",
         aliases=["reset", "limpar curadoria", "zerar base", "apagar datastore"],
         perguntas=["como limpo a curadoria?", "resetar a base de conhecimento"]),
    dict(titulo="Como ligar as VMs do DEV para destravar o deploy",
         conteudo="vm-argo-cd (cluster) e vm-aux (runner do CD) auto-desalocam. Se o cd fica em "
                  "queued, ligue AS DUAS com az vm start; a vm-aux sobe o runner do job cd.",
         produto="azure", categoria="deploy",
         aliases=["vm", "ligar vms", "deploy travado", "cd queued", "runner"],
         perguntas=["por que meu deploy nao anda?", "o cd esta parado", "preciso ligar as vms"]),
    dict(titulo="Como publicar os fronts dvop no DEV",
         conteudo="O front vai embutido na imagem do BFF. Publique via tools/sync-espelhos.ps1 "
                  "-Apps <nome>, que faz push na main do espelho GDD-Core e dispara a esteira + CD "
                  "no ArgoCD. Commit local no bdc nao publica (sem remote).",
         produto="gdd-core", categoria="deploy",
         aliases=["publicar", "deploy do front", "subir front", "sync espelhos"],
         perguntas=["como subo o front?", "publicar dvop no dev", "como faco deploy do frontend"]),
]


def seed(conn, log=print):
    novos = 0
    for h in HOWTOS:
        doc = store.upsert_documento(conn, tipo="duvida_processo", aprovado_por="seed", **h)
        if doc is not None:
            novos += 1
            log(f"  + {h['titulo']}")
    log(f"how-tos novos={novos}")
    return novos


if __name__ == "__main__":
    conn = store.connect()
    store.apply_schema(conn)
    seed(conn)
    if "--no-embed" not in sys.argv:
        store.embed_missing(conn)
    print(json.dumps(store.info(conn), ensure_ascii=False))
    conn.close()
