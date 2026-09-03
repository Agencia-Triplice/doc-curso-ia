import { el, detalheConteudo, filtrarLista, montarFiltro, pageHeader } from '../ui.js';
import { irPara } from '../router.js';
import { linkRun } from '../lib/run-link.js';
import { chipElegibilidade } from '../lib/eleg-chip.js';
import { formatarDataHora } from '../lib/data-hora.js';
import * as api from '../api.js';

const ICONE_BASE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--bex-red-btn)" stroke-width="2.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

function cardDoc(doc) {
  const card = el('div', 'doc');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.appendChild(el('div', 'titulo', doc.titulo));
  const meta = el('div', 'meta');
  if (doc.servico) meta.appendChild(el('span', 'tag', doc.servico));
  if (doc.nivel) meta.appendChild(el('span', 'tag nivel-' + doc.nivel, doc.nivel));
  for (const tag of doc.tags || []) meta.appendChild(el('span', 'tag', tag));
  const chip = chipElegibilidade(el, doc);
  if (chip) meta.appendChild(chip);
  const run = linkRun(el, doc.origem_run_url);
  if (run) meta.appendChild(run);
  if (doc.aprovado_por) meta.appendChild(el('span', 'tag', 'aprovado por ' + doc.aprovado_por));
  card.appendChild(meta);
  card.appendChild(detalheConteudo('ver conteúdo', doc.conteudo));
  card.appendChild(el('div', 'rodape', 'ID doc-' + doc.id
    + (doc.criado_em ? ' · cadastrado ' + formatarDataHora(doc.criado_em) : '')));
  const ir = () => irPara('#/base/' + doc.id);
  card.addEventListener('click', (e) => {
    // o <details> "ver conteúdo" abre sem navegar; o link "ver run ↗" abre o run
    if (e.target.closest('a, button, details')) return;
    ir();
  });
  card.addEventListener('keydown', (e) => {
    // âncora, botão e o <summary> "ver conteúdo" são focáveis e tratam o próprio
    // Enter/Espaço: não navegar por cima deles nem cancelar a ativação
    if (e.target.closest('a, button, details')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); }
  });
  return card;
}

export async function mount(container) {
  container.appendChild(pageHeader(ICONE_BASE, 'Base de Conhecimento RAG', 'Base vetorial de documentos usada na recuperação híbrida (MS3)'));

  const painelFiltro = el('div', 'painel');
  painelFiltro.appendChild(montarFiltro('filtrar por título, serviço, tag…', (t) => render(t)));

  const painelLista = el('div', 'painel');
  const cab = el('div', 'painel-cab');
  const contPill = el('span', 'cont-pill', '0');
  cab.append(el('span', null, 'Documentos indexados'), contPill);
  const area = el('div', 'lista-area');
  painelLista.append(cab, area);
  container.append(painelFiltro, painelLista);

  let itens = [];
  try { itens = (await api.documentos(50)).documentos || []; }
  catch (e) {
    // 503 honesto quando o MS3 não está configurado
    area.appendChild(el('p', 'vazio', 'base de conhecimento indisponível: ' + e.message));
    return;
  }

  const campos = (d) => [d.titulo, d.servico, d.nivel, ...(d.tags || [])];
  function render(termo) {
    const filtrados = filtrarLista(termo, itens, campos);
    contPill.textContent = String(filtrados.length);
    const frag = document.createDocumentFragment();
    if (!filtrados.length) frag.appendChild(el('p', 'vazio', itens.length ? 'Nenhum documento corresponde ao filtro.' : 'Base de conhecimento vazia.'));
    for (const doc of filtrados) frag.appendChild(cardDoc(doc));
    area.replaceChildren(frag);
  }
  render('');
}
