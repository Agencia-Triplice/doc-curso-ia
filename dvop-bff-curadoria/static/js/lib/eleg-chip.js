import * as api from '../api.js';

/**
 * Chip "elegível a PR" no Cache e na Base.
 *
 * Segue a regra do link do run (lib/run-link.js): OMITIDO quando o erro não está
 * marcado — nada de chip vazio poluindo a lista. O chip de template é o caso
 * oposto e mostra "—" por já ter esse contrato firmado.
 *
 * @param {(tag: string, className?: string, text?: string) => HTMLElement} el
 * @param {{elegivel?: boolean, remediacao_id?: string|null}} item
 * @returns {HTMLElement|null}
 */
export function chipElegibilidade(el, item) {
  if (!item || !item.elegivel) return null;
  const rotulo = item.remediacao_id ? 'elegível a PR · ' + item.remediacao_id : 'elegível a PR';
  return el('span', 'tag elegivel', rotulo);
}

function linkModelos(el) {
  const a = el('a', 'link-modelo', 'ver modelos de PR ↗');
  a.href = '#/modelos';
  return a;
}

/**
 * Preenche o corpo do painel "Elegível a PR" nos detalhes de Cache/Base.
 *
 * Dois conceitos distintos convivem: a MARCAÇÃO manual (`item.elegivel`, chip
 * verde) e o MATCH determinístico da C.5 (`/v1/remediacoes-aplicaveis`, chip
 * âmbar) — um erro pode casar com uma remediação sem ter sido marcado na mão.
 * Quando não há marcação, consultamos o match e, havendo, mostramos "casa com
 * remediação de PR" deixando claro que é automático (não foi marcado).
 *
 * @param {(tag: string, className?: string, text?: string) => HTMLElement} el
 * @param {HTMLElement} corpo      contêiner (já no DOM) a ser preenchido
 * @param {object} item           registro do cache/base (tem elegivel, remediacao_*)
 * @param {string|null} fingerprint erro a consultar no match (null = não consulta)
 * @param {() => boolean} [estaVivo] guarda contra resposta fora de ordem
 * @param {boolean} [semOrigem]    base sem erro de origem: sem vínculo possível
 */
export async function preencherElegibilidade(el, corpo, item, fingerprint, estaVivo, semOrigem) {
  corpo.replaceChildren();

  // 1) marcação manual tem prioridade (chip verde)
  const manual = chipElegibilidade(el, item);
  if (manual) {
    const linha = el('div', 'meta');
    linha.appendChild(manual);
    if (item.remediacao_versao) linha.appendChild(el('span', 'tag', 'v' + item.remediacao_versao));
    linha.appendChild(linkModelos(el));
    corpo.appendChild(linha);
    return;
  }

  if (semOrigem) {
    corpo.appendChild(el('p', 'vazio', 'documento sem erro de origem — sem vínculo a modelo de PR'));
    return;
  }
  if (!fingerprint) {
    corpo.appendChild(el('p', 'vazio', 'não marcado como elegível a PR'));
    return;
  }

  // 2) não marcado: consulta o match determinístico
  corpo.appendChild(el('p', 'vazio', 'verificando remediação de PR…'));
  let match = null;
  try {
    const resp = await api.remediacoesAplicaveis(fingerprint);
    match = resp && resp.aplicaveis && resp.aplicaveis[0];
  } catch { /* silencioso: sem match ou consulta falhou → cai no "nenhuma" */ }
  if (estaVivo && !estaVivo()) return;

  corpo.replaceChildren();
  if (!match) {
    corpo.appendChild(el('p', 'vazio', 'nenhuma remediação de PR casa com este erro'));
    return;
  }
  const linha = el('div', 'meta');
  linha.appendChild(el('span', 'tag casa', '🛠 casa com remediação de PR · ' + match.id));
  if (match.versao) linha.appendChild(el('span', 'tag', 'v' + match.versao));
  linha.appendChild(linkModelos(el));
  corpo.appendChild(linha);
  corpo.appendChild(el('p', 'eleg-nota',
    'match automático pela assinatura do erro — não foi marcado manualmente.'));
}
