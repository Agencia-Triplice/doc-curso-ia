// Roteamento por hash. parseHash é puro (testável sob Node); o resto toca window
// só dentro das funções, então o módulo importa sem DOM.
const ROTAS_VALIDAS = new Set(['inicio', 'fila', 'caso', 'cache', 'base', 'modelos', 'credencial']);

/** '#/fila/abc' -> {name:'caso'} ; '#/cache/abc' -> {name:'cache-detalhe'} ;
 * '#/base/7' -> {name:'base-detalhe'} ; desconhecida -> inicio. */
export function parseHash(hash) {
  const limpo = String(hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');
  const partes = limpo.split('/').filter(Boolean);
  if (partes.length === 0) return { name: 'inicio', params: {} };
  if (partes[0] === 'fila' && partes[1]) return { name: 'caso', params: { fp: decodeURIComponent(partes[1]) } };
  if (partes[0] === 'cache' && partes[1]) return { name: 'cache-detalhe', params: { fp: decodeURIComponent(partes[1]) } };
  if (partes[0] === 'base' && partes[1]) return { name: 'base-detalhe', params: { id: decodeURIComponent(partes[1]) } };
  const nome = partes[0];
  return ROTAS_VALIDAS.has(nome) && nome !== 'caso' ? { name: nome, params: {} } : { name: 'inicio', params: {} };
}

let _container = null;
let _rotas = null;
let _atual = { name: 'inicio', params: {} };

export function iniciarRouter(container, rotas) {
  _container = container;
  _rotas = rotas;
  window.addEventListener('hashchange', montar);
  montar();
}

function montar() {
  _atual = parseHash(location.hash);
  destacarMenu(_atual.name);
  _container.replaceChildren();
  const mount = _rotas[_atual.name] || _rotas.inicio;
  mount(_container, _atual.params);
}

/** Re-monta a rota atual (usado pelo refresh periódico). */
export function recarregarAtual() {
  // não re-montar telas de edição: apagaria rascunho/edição não salva
  if (_atual.name === 'caso' || _atual.name === 'cache-detalhe' || _atual.name === 'base-detalhe') return;
  // a fila tem refresh próprio in-view (preserva o filtro digitado) — re-montar
  // aqui apagaria o filtro a cada ciclo
  if (_atual.name === 'fila') return;
  if (_container && _rotas) montar();
}

export function irPara(hash) { location.hash = hash; }

function destacarMenu(nome) {
  const alvo = nome === 'caso' ? 'fila'
    : nome === 'cache-detalhe' ? 'cache'
    : nome === 'base-detalhe' ? 'base'
    : nome;
  document.querySelectorAll('#menu nav a[data-rota]').forEach((a) => {
    a.classList.toggle('ativo', a.dataset.rota === alvo);
  });
}
