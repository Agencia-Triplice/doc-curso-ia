import { el, aviso, filtrarLista, montarFiltro } from '../ui.js';
import { irPara } from '../router.js';
import { rotuloTemplate } from '../lib/template-label.js';
import { linkRun } from '../lib/run-link.js';
import { chipBranch } from '../lib/branch-label.js';
import { trilhaContexto } from '../lib/ctx-label.js';
import { formatarDataHora } from '../lib/data-hora.js';
import * as api from '../api.js';

// intervalo do refresh automático da lista (novos casos aparecem sem F5)
const FILA_REFRESH_MS = 8000;

// ícone de "fila" da faixa de título (estático)
const ICONE_FILA = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--bex-red-btn)" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

function cardOrfao(item, ordinal) {
  const card = el('div', 'item-card');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  // ordinal: numera o caso na fila para diferenciar cards "soltos"
  card.appendChild(el('div', 'item-ord', String(ordinal)));
  const corpo = el('div', 'item-corpo');
  corpo.appendChild(el('div', 'item-sig', item.assinatura));
  const meta = el('div', 'item-meta');
  meta.appendChild(el('span', 'tag template', rotuloTemplate(item.template)));
  if (item.servico) meta.appendChild(el('span', 'tag', item.servico));
  if (item.nivel) meta.appendChild(el('span', 'tag nivel-' + item.nivel, item.nivel));
  meta.appendChild(el('span', 'tag ocorrencias', item.ocorrencias + '× '));
  const run = linkRun(el, item.run_url);
  if (run) meta.appendChild(run);
  const branch = chipBranch(el, item.branch);
  if (branch) meta.appendChild(branch);
  if (item.tem_rascunho) meta.appendChild(el('span', 'tag rascunho', 'rascunho'));
  if (item.ia_estado === 'pronto') meta.appendChild(el('span', 'tag ia-pronto', 'AgentiX pronto'));
  if (item.ia_estado === 'falhou') meta.appendChild(el('span', 'tag ia-falhou', 'AgentiX falhou'));
  if (item.primeiro_visto) meta.appendChild(el('span', 'tag', 'cadastrado ' + formatarDataHora(item.primeiro_visto)));
  const ctx = trilhaContexto(el, item);
  if (ctx) meta.appendChild(ctx);
  corpo.appendChild(meta);
  card.appendChild(corpo);
  const ir = () => irPara('#/fila/' + encodeURIComponent(item.fingerprint));
  card.addEventListener('click', ir);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } });
  return card;
}

/** Cabeçalho de grupo BEX (rótulo + contagem). */
function grupoHeader(texto, n) {
  const h = el('div', 'grupo-header');
  h.append(el('span', null, texto), el('span', 'grupo-cont', String(n)));
  return h;
}

export async function mount(container) {
  // faixa de título BEX
  const header = el('div', 'page-header');
  const tituloWrap = el('div', 'page-title-wrap');
  const h1 = el('h1', 'page-title');
  const icone = el('span', 'tab-icon');
  icone.innerHTML = ICONE_FILA;
  h1.append(icone, el('span', null, 'Fila de Casos Órfãos'));
  tituloWrap.append(h1, el('span', 'page-sub', 'Erros sem solução homologada que aguardam curadoria humana ou proposta do AgentiX'));
  header.appendChild(tituloWrap);

  // bloco 1: filtro
  const painelFiltro = el('div', 'painel painel-filtro');
  const filtroBox = montarFiltro('filtrar por assinatura, serviço, template…', (t) => render(t));
  painelFiltro.appendChild(filtroBox);
  const input = filtroBox.querySelector('input');

  // bloco 2: a fila
  const painelFila = el('div', 'painel painel-fila');
  const cab = el('div', 'painel-cab');
  const contPill = el('span', 'cont-pill', '0');
  cab.append(el('span', null, 'Casos na fila'), contPill);
  const truncadoBox = el('div');
  const area = el('div', 'lista-area');
  painelFila.append(cab, truncadoBox, area);

  container.append(header, painelFiltro, painelFila);

  let itens = [];
  const campos = (i) => [i.assinatura, i.servico, i.nivel];

  function render(termo) {
    const filtrados = filtrarLista(termo, itens, campos);
    contPill.textContent = String(filtrados.length);
    const frag = document.createDocumentFragment();
    if (!filtrados.length) {
      frag.appendChild(el('p', 'vazio', itens.length ? 'Nenhum caso corresponde ao filtro.' : 'Fila vazia — nenhum caso escalado. 🎉'));
    } else {
      const comRascunho = filtrados.filter((i) => i.tem_rascunho);
      const semRascunho = filtrados.filter((i) => !i.tem_rascunho);
      let n = 0;
      if (comRascunho.length) {
        frag.appendChild(grupoHeader('Com rascunho do especialista', comRascunho.length));
        for (const item of comRascunho) frag.appendChild(cardOrfao(item, ++n));
      }
      if (semRascunho.length) {
        frag.appendChild(grupoHeader('Aguardando você', semRascunho.length));
        for (const item of semRascunho) frag.appendChild(cardOrfao(item, ++n));
      }
    }
    area.replaceChildren(frag);
  }

  function aplicarResposta(resp) {
    itens = resp.itens || [];
    if (resp.truncado) {
      truncadoBox.replaceChildren(
        el('p', 'truncado', resp.total + ' na fila — mostrando as ' + itens.length + ' de maior prioridade'),
      );
    } else {
      truncadoBox.replaceChildren();
    }
  }

  try {
    aplicarResposta(await api.fila());
  } catch (e) { aviso(e.message); return; }
  render('');

  // refresh automático: enquanto a tela da fila está montada, repergunta a fila
  // e re-renderiza a lista SEM apagar o filtro digitado nem o foco no input.
  // O loop se encerra sozinho ao navegar para outra tela (area desconectada).
  async function tick() {
    if (!area.isConnected) return;
    try { aplicarResposta(await api.fila()); } catch { /* transitório: mantém a lista atual */ }
    if (!area.isConnected) return;
    render(input.value);
    setTimeout(tick, FILA_REFRESH_MS);
  }
  setTimeout(tick, FILA_REFRESH_MS);
}
