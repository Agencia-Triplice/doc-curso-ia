import { el, detalheConteudo, filtrarLista, montarFiltro, pageHeader } from '../ui.js';
import { irPara } from '../router.js';
import { linkRun } from '../lib/run-link.js';
import { chipElegibilidade } from '../lib/eleg-chip.js';
import { formatarDataHora } from '../lib/data-hora.js';
import * as api from '../api.js';

const ICONE_CACHE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--bex-red-btn)" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';

function cardSolucao(sol) {
  const card = el('div', 'doc');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.appendChild(el('div', 'titulo', sol.assinatura));
  const meta = el('div', 'meta');
  if (sol.servico) meta.appendChild(el('span', 'tag', sol.servico));
  if (sol.nivel) meta.appendChild(el('span', 'tag nivel-' + sol.nivel, sol.nivel));
  meta.appendChild(el('span', 'tag', sol.hits + ' hit(s)'));
  if (sol.autor) meta.appendChild(el('span', 'tag', 'por ' + sol.autor));
  if (sol.aprovado_por) meta.appendChild(el('span', 'tag', 'aprovado por ' + sol.aprovado_por));
  const chip = chipElegibilidade(el, sol);
  if (chip) meta.appendChild(chip);
  const run = linkRun(el, sol.run_url);
  if (run) meta.appendChild(run);
  card.appendChild(meta);
  card.appendChild(detalheConteudo('ver solução', sol.solucao));
  card.appendChild(el('div', 'rodape', 'ID ' + sol.fingerprint
    + (sol.criado_em ? ' · cadastrado ' + formatarDataHora(sol.criado_em) : '')
    + (sol.atualizado_em ? ' · atualizado ' + formatarDataHora(sol.atualizado_em) : '')));
  const ir = () => irPara('#/cache/' + encodeURIComponent(sol.fingerprint));
  card.addEventListener('click', (e) => {
    // o <details> "ver solução" abre sem navegar; o link "ver run ↗" abre o run
    if (e.target.closest('a, button, details')) return;
    ir();
  });
  card.addEventListener('keydown', (e) => {
    // âncora, botão e o <summary> "ver solução" são focáveis e tratam o próprio
    // Enter/Espaço: não navegar por cima deles nem cancelar a ativação
    if (e.target.closest('a, button, details')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); }
  });
  return card;
}

export async function mount(container) {
  container.appendChild(pageHeader(ICONE_CACHE, 'Cache Central de Soluções', 'Resoluções homologadas reaproveitadas instantaneamente pela esteira (MS5)'));

  const painelFiltro = el('div', 'painel');
  painelFiltro.appendChild(montarFiltro('filtrar por assinatura, serviço, autor…', (t) => render(t)));

  const painelLista = el('div', 'painel');
  const cab = el('div', 'painel-cab');
  const contPill = el('span', 'cont-pill', '0');
  cab.append(el('span', null, 'Soluções homologadas'), contPill);
  const area = el('div', 'lista-area');
  painelLista.append(cab, area);
  container.append(painelFiltro, painelLista);

  let itens = [];
  try { itens = (await api.solucoes(100)).solucoes || []; }
  catch (e) { area.appendChild(el('p', 'vazio', 'cache indisponível: ' + e.message)); return; }

  const campos = (s) => [s.assinatura, s.servico, s.nivel, s.autor];
  function render(termo) {
    const filtrados = filtrarLista(termo, itens, campos);
    contPill.textContent = String(filtrados.length);
    const frag = document.createDocumentFragment();
    if (!filtrados.length) frag.appendChild(el('p', 'vazio', itens.length ? 'Nenhuma solução corresponde ao filtro.' : 'Nenhuma solução cadastrada no cache ainda.'));
    for (const sol of filtrados) frag.appendChild(cardSolucao(sol));
    area.replaceChildren(frag);
  }
  render('');
}
