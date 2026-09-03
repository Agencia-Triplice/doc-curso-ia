# FIX — Curadoria: escopo "qualquer" por padrão + barra de status do PR (estilo cockpit)

**Microsserviços afetados (pastas a alterar):**

- `dvop-bff-curadoria` — **único serviço com mudança de código** (2 arquivos, só front):
  `static/js/views/caso.js` e `static/css/app.css`.

> Serviços apenas **envolvidos no fluxo** (consumidos pelo front via HTTP), mas que
> **NÃO precisam de alteração** nesta entrega: `dvop-srv-remediation` (MS8, gera a
> proposta/abre o PR) e `mcp-github` (gateway do GitHub). Nenhum contrato de API mudou —
> a mudança é 100% de apresentação sobre os mesmos endpoints (`/v1/propostas/*`,
> `/v1/remediacoes*`).

---

> **Manifesto de mudança portável.** Este arquivo descreve DUAS alterações de front-end no
> mesmo serviço. Uma IA em outro servidor deve: (1) ler este MD, (2) abrir a pasta
> `dvop-bff-curadoria`, (3) aplicar os blocos "ANTES → DEPOIS" **exatamente** como
> descrito, na ordem dada, (4) validar pela seção 6. O front é uma SPA sem build servida
> same-origin pelo BFF (`ServeStaticModule`, `rootPath: ../static`) — está **embutido na
> imagem Docker**, então a mudança só chega ao cluster com rebuild + rollout (ver seção 7).

---

## 1. Resumo

| Campo | Valor |
|---|---|
| **Microserviço alvo (pasta)** | `dvop-bff-curadoria` |
| **Arquivos alterados** | `static/js/views/caso.js` · `static/css/app.css` |
| **Tipo** | UX de front-end (sem backend, sem contrato, sem schema) |
| **Risco** | Baixo — só apresentação; mesmos endpoints e mesmo fluxo lógico |
| **Requer migração de banco?** | Não |
| **Commit de referência (bdc)** | `165b0a4` (pai: fusão BEX `3835da7`) |

## 2. O que está sendo entregue

Duas melhorias na tela de caso (cockpit da curadoria, `#/caso/<fingerprint>`), dentro do
modal **"Remediação com PR automático"**:

1. **Seção "② Quando aplicar" — escopo padrão enxuto.** Antes, o seletor de escopo
   mostrava as três opções (Só este serviço · Este arquétipo · Qualquer serviço) de uma
   vez, com o default variando conforme o erro. Agora **"Qualquer serviço" nasce marcado**
   e é a **única opção visível**; as duas mais restritivas ficam atrás de um toggle
   **"▾ ver mais opções de escopo"**. Ao **editar** uma remediação cujo escopo salvo é
   restritivo, o bloco já abre para o curador ver o escopo atual.

2. **Bloco "Corrigir com PR (AgentiX)" — barra de status no estado "gerando".** Antes, o
   estado `gerando` mostrava só um texto (`⏳ Gerando a proposta de PR…`). Agora mostra uma
   **barra de status igual à do cockpit do log-view**: spinner em órbita + ícone de PR,
   **barra indeterminada** (não finge uma % de progresso que não existe), stepper das
   **3 etapas reais** do fluxo (Gerando → Proposta → PR aberto) e um **tempo decorrido
   REAL** (conta pra cima). O ticker se auto-encerra ao trocar de estado ou fechar o modal.

> **Honestidade deliberada:** a barra do cockpit do log-view finge uma contagem de ~10s até
> 100%. Aqui a barra é **indeterminada** e o tempo é o decorrido de verdade — consistente
> com a decisão anterior de não apresentar dado falso como real.

---

## 3. Edições em `static/js/views/caso.js`

### 3.1 — `seletorEscopo` (reescrita da função)

**ANTES:**

```js
/** Seletor de escopo (radios). marcadoInicial (opcional) força a opção marcada
 * ao editar. Devolve { servicos(), arquetipos() }. */
function seletorEscopo(area, erro, marcadoInicial) {
  const grupo = el('div', 'form-escopo');
  const temServico = Boolean(erro.servico);
  const temTemplate = Boolean(erro.template);
  const opcoes = [
    ['este', 'Só este serviço' + (temServico ? ' (' + erro.servico + ')' : ''), temServico, temServico],
    ['arquetipo', 'Este arquétipo' + (erro.template ? ' (' + erro.template + ')' : ''), false, temTemplate],
    ['qualquer', 'Qualquer serviço', !temServico, true],
  ];
  for (const [val, txt, marcado, disponivel] of opcoes) {
    const lab = el('label', 'form-radio');
    const r = document.createElement('input');
    r.type = 'radio'; r.name = 'escopo-rem'; r.value = val;
    r.disabled = !disponivel;
    // ao editar, marca a opção do escopo salvo (se disponível); senão usa o
    // default. Nunca deixa um radio desabilitado marcado.
    const querMarcar = marcadoInicial ? (val === marcadoInicial) : marcado;
    r.checked = disponivel && querMarcar;
    lab.append(r, el('span', null, txt + (disponivel ? '' : ' (indisponível)')));
    grupo.appendChild(lab);
  }
  // se o escopo salvo caiu num radio indisponível, garante um fallback marcado
  if (!grupo.querySelector('input[name="escopo-rem"]:checked')) {
    const q = grupo.querySelector('input[value="qualquer"]');
    if (q) q.checked = true;
  }
  area.appendChild(grupo);
  const escolhido = () => (grupo.querySelector('input[name="escopo-rem"]:checked') || {}).value;
  return {
    servicos: () => (escolhido() === 'este' && erro.servico ? [erro.servico] : null),
    arquetipos: () => (escolhido() === 'arquetipo' && erro.template ? [erro.template] : null),
  };
}
```

**DEPOIS:**

```js
/** Seletor de escopo (radios). "Qualquer serviço" vem marcado por padrão e é a
 * única opção visível de início; as duas mais restritivas (este serviço / este
 * arquétipo) só aparecem ao clicar "ver mais". marcadoInicial (opcional) força a
 * opção marcada ao editar — se for uma das restritivas, o bloco já nasce aberto.
 * Devolve { servicos(), arquetipos() }. */
function seletorEscopo(area, erro, marcadoInicial) {
  const grupo = el('div', 'form-escopo');
  const temServico = Boolean(erro.servico);
  const temTemplate = Boolean(erro.template);
  // "qualquer" primeiro (visível); as restritivas ficam ocultas até "ver mais".
  const opcoes = [
    ['qualquer', 'Qualquer serviço', true],
    ['este', 'Só este serviço' + (temServico ? ' (' + erro.servico + ')' : ''), temServico],
    ['arquetipo', 'Este arquétipo' + (erro.template ? ' (' + erro.template + ')' : ''), temTemplate],
  ];
  const radios = {};
  for (const [val, txt, disponivel] of opcoes) {
    const lab = el('label', 'form-radio');
    const r = document.createElement('input');
    r.type = 'radio'; r.name = 'escopo-rem'; r.value = val;
    r.disabled = !disponivel;
    lab.append(r, el('span', null, txt + (disponivel ? '' : ' (indisponível)')));
    if (val !== 'qualquer') { lab.classList.add('escopo-extra'); lab.hidden = true; } // revelado no "ver mais"
    grupo.appendChild(lab);
    radios[val] = r;
  }
  // seleção inicial: default = "qualquer"; ao editar, respeita o escopo salvo se
  // disponível (nunca marca um radio desabilitado).
  const inicial = (marcadoInicial && radios[marcadoInicial] && !radios[marcadoInicial].disabled)
    ? marcadoInicial : 'qualquer';
  radios[inicial].checked = true;

  // toggle "ver mais": revela/oculta as opções restritivas. Nasce aberto quando a
  // seleção inicial (edição) é uma delas — senão o usuário não veria o escopo atual.
  const verMais = el('button', 'form-vermais');
  verMais.type = 'button';
  let aberto = false;
  const setAberto = (on) => {
    aberto = on;
    grupo.querySelectorAll('.escopo-extra').forEach((n) => { n.hidden = !on; });
    verMais.textContent = on ? '▴ ver menos' : '▾ ver mais opções de escopo';
  };
  verMais.addEventListener('click', () => setAberto(!aberto));
  setAberto(inicial !== 'qualquer');

  area.append(grupo, verMais);
  const escolhido = () => (grupo.querySelector('input[name="escopo-rem"]:checked') || {}).value;
  return {
    servicos: () => (escolhido() === 'este' && erro.servico ? [erro.servico] : null),
    arquetipos: () => (escolhido() === 'arquetipo' && erro.template ? [erro.template] : null),
  };
}
```

### 3.2 — `renderEstadoProposta`: encerrar o ticker ao sair de "gerando"

Logo após `corpo.classList.remove('vazio');`, **inserir** o bloco abaixo (antes do comentário
`// mantém o gating do modal em dia`):

```js
  // ao sair do estado "gerando", encerra o ticker do tempo decorrido e zera o
  // marco de início (o próximo "gerando" recomeça a contagem do zero).
  if (!proposta || proposta.estado !== 'gerando') {
    if (corpo._prTimer) { clearInterval(corpo._prTimer); corpo._prTimer = null; }
    delete corpo._prGerandoStart;
  }
```

### 3.3 — `renderPropostaGerando`: barra de status + helpers

**ANTES** (a função inteira era um one-liner):

```js
function renderPropostaGerando(corpo) {
  corpo.replaceChildren(el('div', 'ia-status', '⏳ Gerando a proposta de PR — isso pode levar alguns minutos.'));
}
```

**DEPOIS** — substituir por os helpers + a função (o `el(tag, classe, texto?)` é o helper
de `ui.js` já usado no arquivo):

```js
// ícone central do spinner (git-branch/PR — o mesmo do cockpit do log-view)
const ICONE_PR_ORBIT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>';

/** Tempo decorrido honesto (conta pra cima): "12.3s" até 1min, depois "m:ss". */
function formatarDecorrido(ms) {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

/** Cartão de etapa do stepper de PR (estado: 'active' | 'done' | ''). */
function stepCard(num, nome, estado) {
  const card = el('div', 'pr-step-card' + (estado ? ' ' + estado : ''));
  const ind = el('div', 'step-card-indicator');
  if (estado === 'active') ind.appendChild(el('span', 'spin-dot'));
  else if (estado === 'done') ind.textContent = '✓';
  else ind.textContent = String(num);
  const meta = el('div', 'step-card-meta');
  meta.append(el('span', 'step-card-num', 'ETAPA ' + num), el('span', 'step-card-name', nome));
  card.append(ind, meta);
  return card;
}

/** Estado "gerando": barra de status do PR no estilo do cockpit (spinner + barra
 * indeterminada + stepper das etapas reais do fluxo: Gerando → Proposta → PR
 * aberto). O tempo decorrido é REAL (conta pra cima); a barra é indeterminada —
 * não finge uma % de progresso que não existe. O ticker se auto-encerra quando o
 * badge sai do DOM (troca de estado / modal fecha), e renderEstadoProposta zera
 * o marco de início ao deixar o "gerando". */
function renderPropostaGerando(corpo) {
  if (corpo._prTimer) { clearInterval(corpo._prTimer); corpo._prTimer = null; }
  if (!corpo._prGerandoStart) corpo._prGerandoStart = Date.now();

  const box = el('div', 'pr-dispatch-loading-box');

  const hero = el('div', 'pr-load-hero');
  const orbit = el('div', 'pr-load-orbit');
  orbit.appendChild(el('div', 'pr-orbit-spinner'));
  const center = el('div', 'pr-orbit-center');
  center.innerHTML = ICONE_PR_ORBIT; // SVG estático
  orbit.appendChild(center);
  const info = el('div', 'pr-load-hero-info');
  const mainTitle = el('div', 'pr-load-main-title');
  const badge = el('span', 'pr-load-timer-badge', '0.0s');
  mainTitle.append(el('span', null, 'Gerando proposta de PR (AgentiX)'), badge);
  info.append(mainTitle, el('div', 'pr-load-stage-msg',
    'O agente está montando o diff no repositório — isso pode levar alguns minutos.'));
  hero.append(orbit, info);

  const wrap = el('div', 'pr-progress-wrapper');
  const labels = el('div', 'pr-progress-labels');
  const andamento = el('span', 'pr-andamento');
  andamento.append(el('span', 'spin-dot'), document.createTextNode('em andamento'));
  labels.append(el('span', 'pr-progress-state-text', 'Etapa 1 de 3 — síntese do patch pelo agente'), andamento);
  const track = el('div', 'pr-progress-bar-track indeterminada');
  const fill = el('div', 'pr-progress-bar-fill');
  fill.appendChild(el('div', 'pr-bar-shimmer-sweep'));
  track.appendChild(fill);
  wrap.append(labels, track);

  const stepper = el('div', 'pr-stepper-grid');
  stepper.append(
    stepCard(1, 'Gerando', 'active'),
    stepCard(2, 'Proposta', ''),
    stepCard(3, 'PR aberto', ''),
  );

  box.append(hero, wrap, stepper);
  corpo.replaceChildren(box);

  const tick = () => {
    if (!document.body.contains(badge)) { clearInterval(corpo._prTimer); corpo._prTimer = null; return; }
    badge.textContent = formatarDecorrido(Date.now() - corpo._prGerandoStart);
  };
  tick();
  corpo._prTimer = setInterval(tick, 100);
}
```

> `renderPropostaGerando` é chamada de dois lugares (ambos já existentes): pela rota de
> estado em `renderEstadoProposta` (proposta carregada já em `gerando`) e por
> `renderPropostaAusente` logo após `api.propostaGerar(...)` disparar a geração. Nenhuma
> das chamadas muda.

---

## 4. Edições em `static/css/app.css`

**Anexar ao final do arquivo** (depois da regra `textarea.solucao-textarea:focus`) o bloco:

```css
/* "② Quando aplicar": opções restritivas ocultas até "ver mais" (.form-radio tem
   display:flex, então o atributo hidden precisa deste override explícito). */
.form-radio[hidden] { display: none; }
.form-vermais { background: none; border: none; padding: 4px 0; margin-top: 2px; cursor: pointer; color: var(--bex-red-btn); font-size: 12px; font-weight: 700; text-align: left; }
.form-vermais:hover { color: var(--bex-red-dark); text-decoration: underline; }

/* Barra de status do PR no estado "gerando" (mesma pele do cockpit do log-view):
   spinner em órbita + barra INDETERMINADA (não finge %) + stepper das 3 etapas
   reais do fluxo. Tempo decorrido é real, atualizado por ticker no caso.js. */
.pr-dispatch-loading-box { width: 100%; background: #FFFFFF; border: 1.5px solid var(--bex-border); border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 13px; box-shadow: 0 4px 16px rgba(15,23,42,0.04); animation: prFadeIn .3s ease; }
.pr-load-hero { display: flex; align-items: center; gap: 13px; }
.pr-load-orbit { position: relative; width: 42px; height: 42px; display: grid; place-items: center; flex-shrink: 0; }
.pr-orbit-spinner { position: absolute; inset: 0; border-radius: 50%; border: 2.5px solid #E2E8F0; border-top-color: var(--bex-red-btn); animation: prSpinOrbit 1s linear infinite; }
.pr-orbit-center { width: 30px; height: 30px; border-radius: 50%; background: var(--bex-panel-sub); border: 1px solid var(--bex-border); display: grid; place-items: center; color: var(--bex-red-btn); }
.pr-load-hero-info { display: flex; flex-direction: column; gap: 3px; flex: 1 1 auto; min-width: 0; }
.pr-load-main-title { font-size: 13.5px; font-weight: 800; color: var(--bex-text); display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.pr-load-timer-badge { font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--bex-red-btn); background: var(--bex-red-light); padding: 2px 7px; border-radius: 6px; }
.pr-load-stage-msg { font-size: 12px; color: var(--bex-muted); font-weight: 600; min-height: 18px; line-height: 1.4; }
.pr-progress-wrapper { display: flex; flex-direction: column; gap: 6px; }
.pr-progress-labels { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; font-weight: 700; }
.pr-progress-state-text { color: var(--bex-muted); }
.pr-andamento { display: inline-flex; align-items: center; gap: 5px; color: var(--bex-red-btn); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
.pr-progress-bar-track { width: 100%; height: 7px; background: #EBF0F5; border: 1px solid #E2E8F0; border-radius: 999px; overflow: hidden; position: relative; box-shadow: inset 0 1px 2px rgba(0,0,0,0.04); }
.pr-progress-bar-fill { position: absolute; top: 0; left: 0; height: 100%; width: 0%; background: linear-gradient(90deg, #9E0020 0%, #C7002B 55%, #E11D48 100%); border-radius: 999px; box-shadow: 0 1px 6px rgba(199,0,43,0.3); overflow: hidden; }
.pr-progress-bar-track.indeterminada .pr-progress-bar-fill { width: 38%; animation: prIndeterminada 1.4s ease-in-out infinite; }
.pr-bar-shimmer-sweep { position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%); animation: prSweep 1.5s infinite; }
.pr-stepper-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; border-top: 1px solid var(--bex-border); padding-top: 10px; }
.pr-step-card { background: var(--bex-panel-sub); border: 1px solid var(--bex-border); border-radius: 8px; padding: 6px 7px; display: flex; align-items: center; gap: 6px; transition: all .25s ease; min-width: 0; }
.step-card-indicator { width: 18px; height: 18px; border-radius: 50%; background: #E2E8F0; display: grid; place-items: center; font-size: 9.5px; font-weight: 800; color: #64748B; flex-shrink: 0; transition: all .25s ease; }
.step-card-meta { display: flex; flex-direction: column; overflow: hidden; }
.step-card-num { font-size: 9px; font-weight: 800; text-transform: uppercase; color: var(--bex-faint); letter-spacing: .02em; line-height: 1.2; }
.step-card-name { font-size: 11px; font-weight: 700; color: var(--bex-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
.pr-step-card.active { border-color: var(--bex-red-btn); background: #FFF5F7; box-shadow: 0 1px 4px rgba(176,27,51,0.12); }
.pr-step-card.active .step-card-indicator { background: var(--bex-red-btn); color: #FFFFFF; }
.pr-step-card.active .step-card-name { color: var(--bex-red-dark); font-weight: 800; }
.pr-step-card.done { border-color: var(--bex-good-border); background: var(--bex-good-bg); }
.pr-step-card.done .step-card-indicator { background: var(--bex-good); color: #FFFFFF; }
.pr-step-card.done .step-card-name { color: var(--bex-good); font-weight: 700; }
.spin-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; flex-shrink: 0; animation: prPulseDot 1s ease-in-out infinite; }
@keyframes prSpinOrbit { to { transform: rotate(360deg); } }
@keyframes prSweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
@keyframes prPulseDot { 0%,100% { transform: scale(0.8); opacity: .6; } 50% { transform: scale(1.2); opacity: 1; } }
@keyframes prFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes prIndeterminada { 0% { left: -40%; } 100% { left: 100%; } }
```

> **Cuidado com colisão de keyframes:** os nomes têm prefixo `pr*` de propósito (`prSpinOrbit`,
> `prSweep`, `prPulseDot`, `prFadeIn`, `prIndeterminada`) para não colidir com animações
> genéricas (`spin`, `fadeIn`) que possam existir no restante do `app.css`. Preserve os prefixos.

---

## 5. Marcadores para validar (grep no arquivo servido)

| Marcador | Arquivo | Recurso |
|---|---|---|
| `escopo-extra` | `caso.js` | opções restritivas ocultas |
| `form-vermais` | `caso.js` / `app.css` | toggle "ver mais opções de escopo" |
| `pr-dispatch-loading-box` | `caso.js` / `app.css` | caixa da barra de status |
| `pr-stepper-grid` | `caso.js` / `app.css` | stepper das 3 etapas |
| `pr-progress-bar-track.indeterminada` | `app.css` | barra indeterminada (sem % falsa) |

## 6. Verificação (QA feito no browser)

Servido localmente (SPA sem build), modal "Remediação com PR automático" aberto pelo botão
🛠 na coluna **Agir** de um caso:

1. **② Quando aplicar** — abre com **só** "Qualquer serviço" (marcado) + o toggle
   "▾ ver mais opções de escopo". Clicar revela "Só este serviço (…)" e "Este arquétipo
   (…)"; o rótulo vira "▴ ver menos". Editar remediação com escopo restritivo → já abre
   expandido com a opção salva marcada.
2. **Corrigir com PR (AgentiX)** no estado `gerando` — renderiza a `.pr-dispatch-loading-box`:
   spinner orbital + ícone de PR, "● EM ANDAMENTO", barra vermelha indeterminada, stepper
   `Gerando (ativo) → Proposta → PR aberto` e badge de tempo **contando pra cima** (validado
   subir 1.0s → 4.9s). Ao sair do estado / fechar o modal, o ticker para (sem interval órfão).

## 7. Deploy

- O front está **embutido na imagem** do BFF (`ServeStaticModule`), então editar `static/`
  só chega ao cluster com **rebuild + rollout**. Não há "upload de arquivo estático".
- **Mirror** `GDD-Core/dvop-bff-curadoria` branch `main` (o repo `bdc` local é single-branch
  `master`, **sem remote**). No monorepo: `git commit` → `tools/sync-espelhos.ps1 -Apps
  dvop-bff-curadoria` (push em `main` do espelho) → CI (`ci-bff-node.yml`) → `cd.yml` (ArgoCD).
- O waiver **`acs: false`** já está no `.github/workflows/ci.yml` do curadoria (2 HIGH de
  OpenSSL herdadas da base Alpine — rearmar ao bumpar a base).
- CD exige as VMs Azure `vm-argo-cd` + `vm-aux` ligadas e os segredos `ESTEIRA_CONFIG_PAT`
  + `ARGOCD_AUTH_TOKEN`.
- **Publicado e verificado em DEV** (2026-09-03): run `33787777016` verde de ponta a ponta;
  `curadoria.meucardapioqrcode.com.br` servindo os marcadores da seção 5.

## 8. Rollback

`git revert 165b0a4` restaura o seletor de escopo com as 3 opções à mostra e o texto seco de
"gerando". Só front — nenhuma migração de banco, nada a desfazer no backend.

## 9. Segurança (XSS)

Nenhum dado dinâmico do backend entra por `innerHTML`. Os únicos `innerHTML` usados
(`ICONE_PR_ORBIT` e demais ícones do arquivo) são **constantes SVG estáticas** definidas no
código — não recebem entrada do usuário nem resposta de API. Todo texto dinâmico (tempo,
rótulos) entra por `textContent`/`el(...)`.
