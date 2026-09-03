import { el, aviso, abrirModal, confirmavel, detalheConteudo, filtrarLista, montarFiltro, pageHeader } from '../ui.js';
import * as api from '../api.js';

const ICONE_MODELOS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--bex-red-btn)" stroke-width="2.5"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>';

/** Linha rótulo→valor do modal de detalhe (valor vazio some). */
function linhaDetalhe(rotulo, valor) {
  if (valor == null || valor === '') return null;
  const linha = el('div', 'modelo-linha');
  linha.appendChild(el('span', 'modelo-rot', rotulo));
  linha.appendChild(el('span', 'modelo-val', String(valor)));
  return linha;
}

/** Abre um modal com TODAS as informações do modelo de PR (o card mostra só um
 * resumo). Inclui a aplicabilidade (assinatura/arquétipos/serviços), a instrução
 * do agente, o escopo completo, pré-condições/parâmetros e o exemplo de diff. */
function abrirDetalheModelo(rem, usados, idsCustom) {
  const { corpo } = abrirModal('Modelo de PR · ' + rem.id);
  const esc = rem.escopo || {};
  const ap = rem.aplicabilidade || {};
  const n = usados[rem.id] || 0;
  const linhas = [
    linhaDetalhe('id', rem.id),
    linhaDetalhe('versão', rem.versao),
    linhaDetalhe('tipo', rem.tipo_pr),
    linhaDetalhe('origem', idsCustom.has(rem.id) ? 'criada na tela' : 'embarcada (só leitura)'),
    linhaDetalhe('em uso por', n + ' erro' + (n === 1 ? '' : 's')),
    linhaDetalhe('título do PR', rem.titulo_pr_template),
    linhaDetalhe('descrição', rem.descricao_acao),
    linhaDetalhe('instrução ao agente', rem.instrucao),
    linhaDetalhe('escopo — paths', (esc.paths_permitidos || []).join(', ')),
    linhaDetalhe('escopo — máx. arquivos', esc.max_arquivos),
    linhaDetalhe('escopo — máx. linhas de diff', esc.max_linhas_diff),
    linhaDetalhe('pré-condições', (rem.pre_condicoes || []).join('; ')),
    linhaDetalhe('parâmetros', (rem.parametros_requeridos || []).join(', ')),
    linhaDetalhe('aplica em — arquétipos', (ap.arquetipos || []).join(', ')),
    linhaDetalhe('aplica em — serviços', (ap.servicos || []).join(', ')),
  ].filter(Boolean);
  for (const l of linhas) corpo.appendChild(l);
  if (ap.assinatura_regex) {
    corpo.appendChild(el('div', 'modelo-rot modelo-rot-bloco', 'assinatura (regex)'));
    corpo.appendChild(Object.assign(el('pre', 'conteudo-completo'), { textContent: ap.assinatura_regex }));
  }
  if (rem.exemplo_diff) {
    corpo.appendChild(el('div', 'modelo-rot modelo-rot-bloco', 'exemplo de diff'));
    corpo.appendChild(Object.assign(el('pre', 'conteudo-completo'), { textContent: rem.exemplo_diff }));
  }
}

// Catálogo de modelos de PR (remediações do MS 8). Embarcadas (YAML na imagem)
// são só leitura; as criadas pela tela "Cadastrar remediação" (id ∈ ids_custom,
// devolvido por GET /v1/remediacoes) ganham botão "excluir" — confirmação em
// dois cliques via confirmavel() (sem confirm() nativo). O mesmo modelo pode
// ser reaproveitado por vários erros — por isso o chip "em uso por N erro(s)",
// contado a partir dos vínculos de elegibilidade (/v1/elegibilidade).

function cardModelo(rem, usados, idsCustom, aoExcluir) {
  const card = el('div', 'doc doc-clicavel');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.title = 'clique para ver todas as informações';
  card.appendChild(el('div', 'titulo', rem.id));

  const meta = el('div', 'meta');
  meta.appendChild(el('span', 'tag', 'v' + rem.versao));
  if (rem.tipo_pr) meta.appendChild(el('span', 'tag', rem.tipo_pr));
  const n = usados[rem.id] || 0;
  meta.appendChild(el('span', 'tag uso', 'em uso por ' + n + ' erro' + (n === 1 ? '' : 's')));
  if (idsCustom.has(rem.id)) meta.appendChild(el('span', 'tag', 'criada na tela'));
  card.appendChild(meta);

  if (rem.titulo_pr_template) card.appendChild(el('p', 'titulo-pr', rem.titulo_pr_template));
  if (rem.descricao_acao) card.appendChild(el('p', null, rem.descricao_acao));

  const esc = rem.escopo || {};
  card.appendChild(el('p', 'escopo',
    'escopo: ' + (esc.paths_permitidos || []).join(', ') +
    ' · máx ' + esc.max_arquivos + ' arquivo(s) · máx ' +
    esc.max_linhas_diff + ' linha(s) de diff'));

  if ((rem.pre_condicoes || []).length) card.appendChild(el('p', null, 'pré-condições: ' + rem.pre_condicoes.join('; ')));
  if ((rem.parametros_requeridos || []).length) card.appendChild(el('p', null, 'parâmetros: ' + rem.parametros_requeridos.join(', ')));
  if (rem.exemplo_diff) card.appendChild(detalheConteudo('ver exemplo de diff', rem.exemplo_diff));

  if (idsCustom.has(rem.id)) {
    const btnExcluir = el('button', 'botao perigo', 'excluir');
    confirmavel(btnExcluir, 'confirmar exclusão?', () => aoExcluir(rem.id));
    card.appendChild(btnExcluir);
  }

  // card clicável → modal com todas as informações. O botão "excluir" e o
  // <details> "ver exemplo de diff" tratam o próprio clique e não navegam.
  const abrir = () => abrirDetalheModelo(rem, usados, idsCustom);
  card.addEventListener('click', (e) => {
    if (e.target.closest('a, button, details, summary')) return;
    abrir();
  });
  card.addEventListener('keydown', (e) => {
    if (e.target.closest('a, button, details, summary')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
  });
  return card;
}

export async function mount(container) {
  container.appendChild(pageHeader(ICONE_MODELOS, 'Modelos de PR', 'Catálogo de remediações do executor — embarcadas (só leitura) e criadas na tela (MS8)'));

  const painelFiltro = el('div', 'painel');
  const painelLista = el('div', 'painel');
  const cab = el('div', 'painel-cab');
  const contPill = el('span', 'cont-pill', '0');
  cab.append(el('span', null, 'Modelos disponíveis'), contPill);
  const area = el('div', 'lista-area');
  painelLista.append(cab, area);
  container.append(painelFiltro, painelLista);

  let modelos = [];
  let idsCustom = new Set();
  try {
    const resp = await api.remediacoes();
    modelos = resp.remediacoes || [];
    idsCustom = new Set(resp.ids_custom || []);
  } catch (e) {
    // 503 honesto quando o MS8 não está configurado
    area.appendChild(el('p', 'vazio', 'catálogo de modelos indisponível: ' + e.message));
    return;
  }

  // "em uso por N erros": conta os vínculos de elegibilidade por remediação.
  // Degrada em silêncio (mostra 0) se a lista falhar — o catálogo ainda vale.
  const usados = {};
  try {
    const eleg = await api.elegibilidadeLista(500);
    for (const v of eleg.itens || []) usados[v.remediacao_id] = (usados[v.remediacao_id] || 0) + 1;
  } catch { /* sem contagem */ }

  let filtroAtual = '';
  async function excluir(id) {
    try {
      await api.excluirRemediacao(id);
    } catch (e) {
      aviso(e.message);
      return;
    }
    modelos = modelos.filter((m) => m.id !== id);
    idsCustom.delete(id);
    aviso('modelo excluído', true);
    render(filtroAtual);
  }

  const campos = (m) => [m.id, m.tipo_pr, m.titulo_pr_template, m.descricao_acao];
  function render(termo) {
    filtroAtual = termo;
    const filtrados = filtrarLista(termo, modelos, campos);
    contPill.textContent = String(filtrados.length);
    const frag = document.createDocumentFragment();
    if (!filtrados.length) frag.appendChild(el('p', 'vazio', modelos.length ? 'Nenhum modelo corresponde ao filtro.' : 'Nenhum modelo cadastrado.'));
    for (const m of filtrados) frag.appendChild(cardModelo(m, usados, idsCustom, excluir));
    area.replaceChildren(frag);
  }
  painelFiltro.appendChild(montarFiltro('filtrar por id, tipo, título…', render));
  render('');
}
