# Notificações ricas no Teams — guia de aplicação

Como sair de uma notificação só-texto para Adaptive Cards com cor, ícone, gráfico, imagem e botões de ação. Escrito para ser testado num tenant corporativo.

Última revisão: 24/09/2026

---

## 0. Antes de tudo: o que mudou

Os **Office 365 Connectors** (aquele webhook `https://outlook.office.com/webhook/...` que recebia `MessageCard`) foram **desligados em 22/05/2026**. Não existe mais como criar um, e os antigos pararam de entregar.

O substituto é um **Workflow do Power Automate** dentro do canal. Muda a URL e muda o formato do corpo — o card em si fica melhor, não pior.

---

## 1. Checagem no tenant corporativo (faça isso primeiro)

Três coisas podem estar bloqueadas por política. Descobrir agora economiza meio dia:

| O que checar | Como | Se estiver bloqueado |
|---|---|---|
| Power Automate liberado | Abrir `make.powerautomate.com` com a conta corporativa | Sem Workflow. Peça liberação ou use um canal já existente com webhook ativo |
| Criar Workflow no canal | No canal: `⋯` → **Workflows** | Admin pode restringir a owners do time. Peça ao owner do canal |
| Registrar app no Entra ID | `portal.azure.com` → App registrations → New registration | Rota bot/Graph fica fora. Só com abertura de demanda na área de identidade |

Em banco, o cenário mais comum é: **Workflow liberado, app registration não**. Isso te deixa com Adaptive Card completo, mas sem atualização de mensagem e sem `Action.Execute`.

> Política de uso: teste com payload sintético antes de plugar dado real. Webhook de canal não tem autenticação por padrão — quem tiver a URL posta no canal.

---

## 2. Criar o webhook (rota Workflow)

1. No canal desejado: **`⋯` → Workflows**
2. Escolha o template **"Post to a channel when a webhook request is received"**
3. Confirme a conta, o time e o canal
4. Copie a **URL HTTP POST** gerada — ela contém a chave de acesso, trate como segredo
5. Guarde em variável de ambiente / secret, nunca no repositório

### Removendo o rodapé do template

O fluxo criado pelo template carimba *"used a Workflow template to send this card"* embaixo de toda mensagem. Para tirar:

1. Abra `make.powerautomate.com` → **Meus fluxos**
2. Localize o fluxo criado, **Salvar como** (cria uma cópia própria)
3. Na cópia, edite a ação de postagem e remova o bloco de rodapé
4. Ative a cópia, desative o original, use a nova URL

### Variante sem canal (útil quando você não pode criar equipe)

No portal do Power Automate:

- **Gatilho:** `When a Teams webhook request is received`
- **Ação:** `Post card in a chat or channel` → *Post as*: **Flow bot** → *Post in*: **Chat with Flow bot**

O card chega na sua DM com o mesmo renderizador do canal. Serve perfeitamente para validar visual. O conector do Teams é **Standard**, não premium.

Limitação conhecida: **canal privado não aceita** postagem de card por fluxo.

---

## 3. Anatomia do payload

O Workflow espera uma **mensagem**, não um Adaptive Card cru. O envelope é obrigatório:

```json
{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "contentUrl": null,
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "msteams": { "width": "Full" },
        "fallbackText": "Texto que aparece na notificação do celular e em clientes antigos",
        "body": [],
        "actions": []
      }
    }
  ]
}
```

Pontos que sempre esquecem:

- `version` em `"1.5"` — abaixo disso não renderiza `Table`, `Chart.*` nem `CodeBlock`
- `msteams.width = "Full"` faz o card ocupar a largura do canal em vez de uma coluna estreita
- `fallbackText` é o que aparece no push do celular. Sem ele, a notificação diz só "Card"
- `contentUrl: null` é exigido pelo schema mesmo sendo nulo

### Elementos e o que cada um desenha

| Elemento | Para quê |
|---|---|
| `Container` com `style` | Faixa colorida de status: `good`, `warning`, `attention`, `accent`, `emphasis` |
| `ColumnSet` / `Column` | Layout em grade; `width: "auto"` ou `"stretch"` |
| `FactSet` | Pares chave/valor alinhados |
| `Table` | Tabela real com cabeçalho e bordas (1.5+) |
| `TextBlock` | Texto; `fontType: "Monospace"`, `color`, `weight`, `size`, `isSubtle` |
| `CodeBlock` | Bloco de código com numeração — **extensão Teams**, não é schema oficial |
| `Image` | Imagem ou **GIF animado**; precisa de URL pública HTTPS |
| `Media` | Vídeo inline do YouTube, Vimeo, Dailymotion |
| `Chart.Donut`, `Chart.Gauge`, `Chart.Line`, `Chart.Pie`, `Chart.VerticalBar`, `Chart.HorizontalBar` | Gráfico nativo renderizado pelo Teams |
| `Icon` | Ícone da biblioteca Fluent |
| `Badge` | Pílula de status |
| `Rating` / `Input.Rating` | Estrelas, leitura ou entrada |
| `CompoundButton` | Botão grande com título + descrição |
| `ActionSet` | Botões dentro do corpo, não só no rodapé |

---

## 4. Card 1 — Ticket atendido

Cabeçalho verde, badge, dados do chamado, rosca de SLA e avaliação.

```json
{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "contentUrl": null,
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "msteams": { "width": "Full" },
        "fallbackText": "Chamado INC-4821 atendido — resolvido em 1h42",
        "body": [
          {
            "type": "Container",
            "style": "good",
            "bleed": true,
            "roundedCorners": true,
            "items": [
              {
                "type": "ColumnSet",
                "columns": [
                  {
                    "type": "Column",
                    "width": "auto",
                    "verticalContentAlignment": "Center",
                    "items": [
                      {
                        "type": "Icon",
                        "name": "CheckmarkCircle",
                        "size": "Large",
                        "style": "Filled",
                        "color": "Good",
                        "fallback": {
                          "type": "TextBlock",
                          "text": "OK",
                          "weight": "Bolder",
                          "color": "Good"
                        }
                      }
                    ]
                  },
                  {
                    "type": "Column",
                    "width": "stretch",
                    "items": [
                      {
                        "type": "TextBlock",
                        "text": "Chamado INC-4821 atendido",
                        "weight": "Bolder",
                        "size": "Large",
                        "wrap": true
                      },
                      {
                        "type": "TextBlock",
                        "text": "Squad Pagamentos · encerrado em 1h42",
                        "isSubtle": true,
                        "spacing": "None",
                        "wrap": true
                      }
                    ]
                  },
                  {
                    "type": "Column",
                    "width": "auto",
                    "verticalContentAlignment": "Center",
                    "items": [
                      {
                        "type": "Badge",
                        "text": "RESOLVIDO",
                        "style": "Good",
                        "shape": "Rounded",
                        "fallback": {
                          "type": "TextBlock",
                          "text": "**RESOLVIDO**",
                          "color": "Good"
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            "type": "FactSet",
            "facts": [
              { "title": "Solicitante", "value": "Camila Duarte · Operações" },
              { "title": "Categoria", "value": "Falha de conciliação" },
              { "title": "Primeira resposta", "value": "4 min" },
              { "title": "Atendente", "value": "Rafael Nunes" }
            ]
          },
          {
            "type": "ColumnSet",
            "separator": true,
            "columns": [
              {
                "type": "Column",
                "width": "auto",
                "items": [
                  {
                    "type": "Chart.Donut",
                    "title": "SLA consumido",
                    "data": [
                      { "legend": "Consumido", "value": 38, "color": "good" },
                      { "legend": "Restante", "value": 62, "color": "neutral" }
                    ],
                    "fallback": {
                      "type": "TextBlock",
                      "text": "SLA consumido: **38%**",
                      "wrap": true
                    }
                  }
                ]
              },
              {
                "type": "Column",
                "width": "stretch",
                "verticalContentAlignment": "Center",
                "items": [
                  {
                    "type": "TextBlock",
                    "text": "1h42 de 4h30",
                    "size": "ExtraLarge",
                    "weight": "Bolder",
                    "wrap": true
                  },
                  {
                    "type": "TextBlock",
                    "text": "Dentro do acordo. Meta da squad: abaixo de 60%.",
                    "isSubtle": true,
                    "wrap": true,
                    "spacing": "None"
                  }
                ]
              }
            ]
          },
          {
            "type": "TextBlock",
            "text": "Como foi o atendimento?",
            "weight": "Bolder",
            "separator": true,
            "wrap": true
          },
          {
            "type": "Input.Rating",
            "id": "csat",
            "max": 5,
            "allowHalfSteps": false,
            "fallback": "drop"
          }
        ],
        "actions": [
          {
            "type": "Action.OpenUrl",
            "title": "Ver chamado",
            "url": "https://seu-itsm.exemplo/tickets/INC-4821",
            "style": "positive"
          },
          {
            "type": "Action.OpenUrl",
            "title": "Reabrir",
            "url": "https://seu-itsm.exemplo/tickets/INC-4821/reopen"
          },
          {
            "type": "Action.ShowCard",
            "title": "Histórico",
            "card": {
              "type": "AdaptiveCard",
              "body": [
                {
                  "type": "Table",
                  "columns": [{ "width": 1 }, { "width": 2 }],
                  "rows": [
                    {
                      "type": "TableRow",
                      "style": "emphasis",
                      "cells": [
                        { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "Hora", "weight": "Bolder", "wrap": true }] },
                        { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "Evento", "weight": "Bolder", "wrap": true }] }
                      ]
                    },
                    {
                      "type": "TableRow",
                      "cells": [
                        { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "12:30", "wrap": true }] },
                        { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "Chamado aberto", "wrap": true }] }
                      ]
                    },
                    {
                      "type": "TableRow",
                      "cells": [
                        { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "12:34", "wrap": true }] },
                        { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "Primeira resposta", "wrap": true }] }
                      ]
                    },
                    {
                      "type": "TableRow",
                      "cells": [
                        { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "14:12", "wrap": true }] },
                        { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "Encerrado", "wrap": true }] }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        ]
      }
    }
  ]
}
```

**Detalhe importante:** `Input.Rating` só serve para alguma coisa se houver um `Action.Submit`/`Action.Execute` para receber o valor. Pela rota Workflow, o retorno cai no fluxo do Power Automate, não na sua API. Se você não vai tratar a resposta, troque por `Rating` (somente leitura) ou remova.

---

## 5. Card 2 — Pull request aberto

Cabeçalho `accent`, repositório em monoespaçada, estatística do diff, status dos checks e botões.

```json
{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "contentUrl": null,
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "msteams": { "width": "Full" },
        "fallbackText": "PR #482 aberto: Corrige timeout no D1 do checkout",
        "body": [
          {
            "type": "Container",
            "style": "accent",
            "bleed": true,
            "roundedCorners": true,
            "items": [
              {
                "type": "ColumnSet",
                "columns": [
                  {
                    "type": "Column",
                    "width": "stretch",
                    "items": [
                      {
                        "type": "TextBlock",
                        "text": "PR #482 · Corrige timeout no D1 do checkout",
                        "weight": "Bolder",
                        "size": "Large",
                        "wrap": true
                      },
                      {
                        "type": "TextBlock",
                        "text": "aberto por Agente de Pipeline · há 3 min",
                        "isSubtle": true,
                        "spacing": "None",
                        "wrap": true
                      }
                    ]
                  },
                  {
                    "type": "Column",
                    "width": "auto",
                    "verticalContentAlignment": "Center",
                    "items": [
                      {
                        "type": "Badge",
                        "text": "REVISÃO",
                        "style": "Warning",
                        "shape": "Rounded",
                        "fallback": { "type": "TextBlock", "text": "**REVISÃO**" }
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            "type": "TextBlock",
            "text": "triplice/checkout-worker · fix/d1-timeout → main",
            "fontType": "Monospace",
            "size": "Small",
            "wrap": true
          },
          {
            "type": "ColumnSet",
            "columns": [
              { "type": "Column", "width": "auto", "items": [{ "type": "TextBlock", "text": "3 arquivos", "wrap": true }] },
              { "type": "Column", "width": "auto", "items": [{ "type": "TextBlock", "text": "+47", "color": "Good", "weight": "Bolder", "wrap": true }] },
              { "type": "Column", "width": "auto", "items": [{ "type": "TextBlock", "text": "−12", "color": "Attention", "weight": "Bolder", "wrap": true }] }
            ]
          },
          {
            "type": "Table",
            "separator": true,
            "firstRowAsHeaders": false,
            "showGridLines": false,
            "columns": [{ "width": "auto" }, { "width": 3 }, { "width": "auto" }],
            "rows": [
              {
                "type": "TableRow",
                "cells": [
                  { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "✔", "color": "Good", "weight": "Bolder", "wrap": true }] },
                  { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "build", "fontType": "Monospace", "wrap": true }] },
                  { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "42s", "isSubtle": true, "wrap": true }] }
                ]
              },
              {
                "type": "TableRow",
                "cells": [
                  { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "✔", "color": "Good", "weight": "Bolder", "wrap": true }] },
                  { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "vitest (218 testes)", "fontType": "Monospace", "wrap": true }] },
                  { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "1m 06s", "isSubtle": true, "wrap": true }] }
                ]
              },
              {
                "type": "TableRow",
                "cells": [
                  { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "◷", "color": "Warning", "weight": "Bolder", "wrap": true }] },
                  { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "lint", "fontType": "Monospace", "wrap": true }] },
                  { "type": "TableCell", "items": [{ "type": "TextBlock", "text": "em execução", "isSubtle": true, "wrap": true }] }
                ]
              }
            ]
          },
          {
            "type": "TextBlock",
            "text": "3 revisores atribuídos · nenhuma aprovação ainda",
            "isSubtle": true,
            "separator": true,
            "wrap": true
          }
        ],
        "actions": [
          {
            "type": "Action.OpenUrl",
            "title": "Abrir no GitHub",
            "url": "https://github.com/triplice/checkout-worker/pull/482",
            "style": "positive"
          },
          {
            "type": "Action.ShowCard",
            "title": "Ver diff",
            "card": {
              "type": "AdaptiveCard",
              "body": [
                {
                  "type": "CodeBlock",
                  "codeSnippet": "- const stmt = db.prepare(sql);\n+ const stmt = db.prepare(sql);\n+ // timeout explícito, D1 corta em 30s\n+ ctx.waitUntil(stmt.run());",
                  "language": "TypeScript",
                  "startLineNumber": 118,
                  "fallback": {
                    "type": "TextBlock",
                    "text": "- const stmt = db.prepare(sql);\n+ ctx.waitUntil(stmt.run());",
                    "fontType": "Monospace",
                    "wrap": true
                  }
                }
              ]
            }
          }
        ]
      }
    }
  ]
}
```

---

## 6. Card 3 — Diagnóstico do agente com ação de correção

Cenário: o usuário cola um link de run do GitHub no chat; o agente responde com causa provável, log, correção sugerida, recorrência e um botão para abrir o PR.

```json
{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "contentUrl": null,
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "msteams": { "width": "Full" },
        "fallbackText": "Run #9182734 falhou — D1_ERROR de timeout na migration 0007",
        "body": [
          {
            "type": "Container",
            "style": "attention",
            "bleed": true,
            "roundedCorners": true,
            "items": [
              {
                "type": "TextBlock",
                "text": "Diagnóstico do run #9182734",
                "weight": "Bolder",
                "size": "Large",
                "wrap": true
              },
              {
                "type": "TextBlock",
                "text": "job deploy-prod · etapa wrangler deploy",
                "fontType": "Monospace",
                "size": "Small",
                "spacing": "None",
                "wrap": true
              }
            ]
          },
          {
            "type": "TextBlock",
            "text": "Causa provável · confiança 92%",
            "weight": "Bolder",
            "size": "Small",
            "color": "Accent",
            "wrap": true
          },
          {
            "type": "TextBlock",
            "text": "A migration **0007_add_idx_orders** roda sem índice em `orders.tenant_id` e o D1 estoura o limite de 30s em produção. Homologação passa porque tem menos de 50 mil linhas.",
            "wrap": true
          },
          {
            "type": "CodeBlock",
            "codeSnippet": "✘ [ERROR] D1_ERROR: Statement execution timed out after 30000ms\n  at migrations/0007_add_idx_orders.sql:12",
            "language": "PlainText",
            "fallback": {
              "type": "TextBlock",
              "text": "D1_ERROR: Statement execution timed out after 30000ms",
              "fontType": "Monospace",
              "wrap": true
            }
          },
          {
            "type": "TextBlock",
            "text": "Correção sugerida",
            "weight": "Bolder",
            "separator": true,
            "wrap": true
          },
          {
            "type": "CodeBlock",
            "codeSnippet": "- CREATE INDEX idx_orders ON orders(tenant_id, created_at);\n+ CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);\n+ -- índice composto migrado em lote separado",
            "language": "SQL",
            "fallback": {
              "type": "TextBlock",
              "text": "CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);",
              "fontType": "Monospace",
              "wrap": true
            }
          },
          {
            "type": "Chart.VerticalBar",
            "title": "Ocorrências deste erro (30 dias)",
            "colorSet": "categoricalReds",
            "separator": true,
            "data": [
              { "x": "sem 1", "y": 2 },
              { "x": "sem 2", "y": 3 },
              { "x": "sem 3", "y": 7 },
              { "x": "sem 4", "y": 9 }
            ],
            "fallback": {
              "type": "TextBlock",
              "text": "Ocorrências nas últimas 4 semanas: 2 → 3 → 7 → 9",
              "wrap": true
            }
          },
          {
            "type": "Image",
            "url": "https://cdn.seudominio.com.br/alerts/pipeline-fail.gif",
            "altText": "Alerta de pipeline",
            "width": "320px",
            "horizontalAlignment": "Center"
          }
        ],
        "actions": [
          {
            "type": "Action.Execute",
            "title": "Abrir PR de correção",
            "verb": "createFixPr",
            "style": "positive",
            "data": {
              "runId": "9182734",
              "repo": "triplice/checkout-worker",
              "suggestionId": "sug_7c21"
            },
            "fallback": {
              "type": "Action.OpenUrl",
              "title": "Abrir PR de correção",
              "url": "https://api.seudominio.com.br/fix/sug_7c21"
            }
          },
          {
            "type": "Action.OpenUrl",
            "title": "Ver log completo",
            "url": "https://github.com/triplice/checkout-worker/actions/runs/9182734"
          },
          {
            "type": "Action.Execute",
            "title": "Não é isso",
            "verb": "rejectDiagnosis",
            "data": { "suggestionId": "sug_7c21" }
          }
        ]
      }
    }
  ]
}
```

### Sobre a imagem / GIF

- URL **pública e HTTPS**. O Teams busca a imagem pelo servidor dele, não pelo navegador do usuário — se estiver atrás de autenticação ou só na rede interna, aparece quebrada
- GIF animado anima normalmente
- Sem `width` explícito o Teams encolhe a imagem
- `data:` URI em base64 é inconsistente entre clientes; hospede o arquivo
- Se a política do banco não permitir CDN externa, essa parte cai — valide cedo

### O `Action.Execute` só funciona com bot

Botão que chama a sua API de volta exige um bot registrado. Pela rota Workflow, ele não tem para onde mandar a resposta. O `fallback` no exemplo acima resolve: vira um `Action.OpenUrl` apontando para um endpoint seu que faz a mesma coisa.

---

## 7. Atualizar a mensagem em vez de postar outra

O ganho maior de percepção de qualidade: o mesmo card muda de "FALHOU" para "PR #483 aberto" sem poluir o canal.

Isso exige **bot** (Bot Framework). O fluxo:

1. Ao postar, guarde o `activityId` retornado
2. Na mudança de estado, chame `updateActivity` com o mesmo `activityId` e o card novo

```ts
// Bot Framework SDK
const sent = await context.sendActivity({ attachments: [cardAttachment] });
await db.put(`msg:${runId}`, sent.id);

// depois, quando o PR for criado
const activityId = await db.get(`msg:${runId}`);
await context.updateActivity({
  id: activityId,
  type: "message",
  attachments: [buildCard({ estado: "pr_criado", pr: 483 })]
});
```

Pelo Graph existe `PATCH /teams/{id}/channels/{id}/messages/{id}`, mas com escopo bem limitado — na prática, para editar corpo de mensagem, o caminho é bot.

---

## 8. Enviando do seu código

### curl (teste rápido)

```bash
curl -X POST "$TEAMS_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d @card.json
```

Resposta esperada: `202 Accepted`. O corpo vem vazio — o Workflow processa de forma assíncrona, então `202` significa "aceitei", não "postei".

### Cloudflare Worker (TypeScript)

```ts
type TeamsCard = Record<string, unknown>;

export async function notificarTeams(
  webhookUrl: string,
  card: TeamsCard,
  fallbackText: string
): Promise<void> {
  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.5",
          msteams: { width: "Full" },
          fallbackText,
          ...card
        }
      }
    ]
  };

  const body = JSON.stringify(payload);

  if (body.length > 28 * 1024) {
    throw new Error(`Card com ${body.length} bytes; limite prático é ~28 KB`);
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });

  if (!res.ok) {
    throw new Error(`Teams respondeu ${res.status}: ${await res.text()}`);
  }
}
```

Com retry e backoff, já que `429` acontece em rajada:

```ts
export async function notificarComRetry(
  url: string,
  card: TeamsCard,
  fallbackText: string,
  tentativas = 3
): Promise<void> {
  for (let i = 0; i < tentativas; i++) {
    try {
      await notificarTeams(url, card, fallbackText);
      return;
    } catch (e) {
      const ultima = i === tentativas - 1;
      if (ultima) throw e;
      await new Promise(r => setTimeout(r, 2 ** i * 1000));
    }
  }
}
```

---

## 9. Separar dados do layout (templating)

Não monte o JSON com concatenação de string. Use **Adaptive Card Templating**: o layout fica num arquivo, os dados em outro.

Template (`ticket.template.json`):

```json
{
  "type": "TextBlock",
  "text": "Chamado ${ticketId} atendido",
  "weight": "Bolder",
  "size": "Large",
  "wrap": true
}
```

Dados:

```json
{ "ticketId": "INC-4821", "sla": 38, "atendente": "Rafael Nunes" }
```

Aplicando:

```ts
import * as ACData from "adaptivecards-templating";

const template = new ACData.Template(templateJson);
const card = template.expand({ $root: dados });
```

Sintaxe útil dentro do template:

- `${propriedade}` — interpolação
- `${if(sla > 80, 'attention', 'good')}` — condicional, ótimo para a cor do container
- `$data` + `$when` — repetir um bloco por item de lista

Sem isso, a primeira mudança de layout vira um `replace` em três lugares diferentes do seu Worker.

---

## 10. Limites e erros comuns

| Sintoma | Causa | Correção |
|---|---|---|
| `400 Bad Request` | Faltou o envelope `type: "message"` | Envie o wrapper, não o card cru |
| Card chega como texto em branco | JSON inválido ou `version` ausente | Valide no designer antes |
| Imagem quebrada | URL não pública, HTTP, ou bloqueada por rede | Hospede em CDN pública com HTTPS |
| `Chart.*` não aparece | `version` abaixo de 1.5, ou cliente desatualizado | Suba a versão e adicione `fallback` |
| `CodeBlock` some no mobile | É extensão Teams, suporte irregular | Sempre acompanhe de `fallback` monoespaçado |
| Push do celular diz só "Card" | Sem `fallbackText` | Preencha com uma frase útil |
| `429 Too Many Requests` | Rajada de notificações | Backoff exponencial e agrupamento |
| Rodapé "used a Workflow template" | Fluxo veio do template pronto | Salve como cópia própria e edite |
| Botão não faz nada | `Action.Execute` sem bot | Use `Action.OpenUrl` ou registre o bot |

**Tamanho:** mantenha o payload abaixo de ~28 KB. Um card grande demais é rejeitado sem mensagem clara.

**Emoji em vez de ícone:** funciona, mas `Icon` da biblioteca Fluent renderiza melhor e acompanha o tema.

---

## 11. Onde validar antes de disparar

| Ferramenta | Serve para | Não serve para |
|---|---|---|
| **Adaptive Card Previewer** (extensão VS Code) | Mesmo renderizador do Teams; tema claro, escuro e alto contraste; hot reload | Menção, people picker, stageview, full width |
| **Designer** em `adaptivecards.microsoft.com` | Prototipar, copiar JSON, ver os componentes novos | Confirmar `Chart.*` — valide no Teams real |
| **Canal de sandbox** | Verdade final: charts, GIF, mobile | — |

Ordem prática: desenha no previewer → valida o JSON no designer → dispara no canal de sandbox → só então aponta para o canal de produção.

---

## 12. Checklist antes de ligar em produção

- [ ] URL do webhook guardada como secret, fora do repositório
- [ ] Canal de sandbox separado do canal real
- [ ] `fallbackText` em todos os cards
- [ ] `fallback` em `Icon`, `Badge`, `Chart.*`, `CodeBlock`, `Rating`
- [ ] Payload abaixo de 28 KB, com guarda no código
- [ ] Retry com backoff e tratamento de `429`
- [ ] Testado em tema claro **e** escuro
- [ ] Testado no Teams mobile, não só no desktop
- [ ] Imagens hospedadas em URL pública HTTPS que o Teams consegue buscar
- [ ] Nenhum dado sensível no corpo do card (quem entra no canal lê o histórico todo)
- [ ] Deduplicação: o mesmo alerta repetido não vira cinco mensagens
- [ ] Revisão com a área de segurança antes de plugar dado real

---

## 13. Referências

- [Retirement of Office 365 connectors within Microsoft Teams](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)
- [Create incoming webhooks with Workflows for Microsoft Teams](https://support.microsoft.com/en-us/teams/apps-service/create-incoming-webhooks-with-workflows-for-microsoft-teams)
- [Microsoft Teams connector (Power Automate) — ações, classe e limitações](https://learn.microsoft.com/en-us/connectors/teams/)
- [Charts in Adaptive Cards](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/charts-in-adaptive-cards)
- [Format text in cards](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-format)
- [Adaptive Card Previewer (VS Code)](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/adaptive-card-previewer)
- [Send chatMessage in a channel — Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0)
