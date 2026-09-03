// Wrapper de fetch fiel ao comportamento do front atual: 204 -> null; corpo
// JSON; !ok -> Error(body.detail || 'erro <status>'); 401 aciona o handler
// registrado via onNaoAutenticado (ir para login) antes de lançar.
let handler401 = null;
/** Registra o que fazer quando qualquer chamada devolver 401 (ir para login). */
export function onNaoAutenticado(fn) { handler401 = fn; }

export async function api(path, options) {
  const response = await fetch(path, options);
  if (response.status === 401) {
    if (handler401) handler401();
    throw new Error('não autenticado');
  }
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || ('erro ' + response.status));
  return body;
}

const jsonPut = (body) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const jsonPost = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fp = (v) => encodeURIComponent(v);

export const info = () => api('/v1/info');
export const fila = () => api('/v1/fila');
export const caso = (f) => api('/v1/fila/' + fp(f));
export const promptAgente = (f) => api('/v1/fila/' + fp(f) + '/prompt-agente');
export const salvarRascunho = (f, corpo) => api('/v1/fila/' + fp(f) + '/rascunho', jsonPut(corpo));
export const aprovar = (f, corpo) => api('/v1/fila/' + fp(f) + '/aprovar', jsonPost(corpo));
export const descartar = (f) => api('/v1/fila/' + fp(f) + '/descartar', { method: 'POST' });
export const solucoes = (limit = 100) => api('/v1/solucoes?limit=' + limit);
export const documentos = (limit = 50) => api('/v1/documentos?limit=' + limit);
export const remediacoes = () => api('/v1/remediacoes');
export const remediacoesAplicaveis = (f) => api('/v1/remediacoes-aplicaveis/' + fp(f));
export const criarRemediacao = (corpo) => api('/v1/remediacoes', jsonPost(corpo));
export const excluirRemediacao = (id) => api('/v1/remediacoes/' + fp(id), { method: 'DELETE' });
export const elegibilidadeGet = (f) => api('/v1/elegibilidade/' + fp(f));
export const elegibilidadeLista = (limit = 500) => api('/v1/elegibilidade?limit=' + limit);
export const elegibilidadePut = (f, corpo) => api('/v1/elegibilidade/' + fp(f), jsonPut(corpo));
export const elegibilidadeDelete = (f) => api('/v1/elegibilidade/' + fp(f), { method: 'DELETE' });

export const solucao = (f) => api('/v1/solucoes/' + fp(f));
export const editarSolucao = (f, corpo) => api('/v1/solucoes/' + fp(f), jsonPut(corpo));
export const excluirSolucao = (f, devolver = true) =>
  api('/v1/solucoes/' + fp(f) + (devolver ? '' : '?devolver=false'), { method: 'DELETE' });
export const documento = (id) => api('/v1/documentos/' + fp(id));
export const editarDocumento = (id, corpo) => api('/v1/documentos/' + fp(id), jsonPut(corpo));
export const excluirDocumento = (id) => api('/v1/documentos/' + fp(id), { method: 'DELETE' });

// credencial do executor de PR: o PAT só sobe (PUT); nenhuma rota devolve token
export const credencial = () => api('/v1/credencial');
export const armarCredencial = (token) => api('/v1/credencial', jsonPut({ token }));
export const desarmarCredencial = () => api('/v1/credencial', { method: 'DELETE' });

// proposta de PR (AgentiX): gerar/ver/aprovar/regenerar/descartar/fechar-pr
export const propostaGet = (f) => api('/v1/propostas/' + fp(f));
export const propostaGerar = (f, corpo) => api('/v1/propostas/' + fp(f), jsonPost(corpo || {}));
export const propostaAprovar = (f, base) => api('/v1/propostas/' + fp(f) + '/aprovar', jsonPost(base ? { base } : {}));
export const propostaBranches = (f) => api('/v1/propostas/' + fp(f) + '/branches');
export const propostaRegenerar = (f, corpo) => api('/v1/propostas/' + fp(f) + '/regenerar', jsonPost(corpo || {}));
export const propostaExcluir = (f) => api('/v1/propostas/' + fp(f), { method: 'DELETE' });
export const propostaFecharPr = (f) => api('/v1/propostas/' + fp(f) + '/fechar-pr', jsonPost({}));

export const me = () => api('/v1/me');
export const authConfig = () => api('/auth/config');
export const entrarComPat = (token) => api('/auth/pat', jsonPost({ token }));
export const logout = () => api('/auth/logout', { method: 'POST' });
