import { el, aviso } from '../ui.js';
import * as api from '../api.js';

// faixa de título BEX
const ICONE_HOME = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--bex-red-btn)" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';

// Topologia da frota (referência de arquitetura — nomes/portas reais). NÃO é um
// health check ao vivo: por isso não exibimos "status operacional" aqui.
const UPSTREAMS = [
  ['dvop-srv-log-process', 'Normalização & Fingerprint', ':8000'],
  ['dvop-srv-cache-query', 'Lookup de Cache Central', ':8001'],
  ['dvop-srv-cache-writer', 'Gravação de Soluções & Órfãos', ':8002'],
  ['dvop-srv-retrieval', 'Recuperação Híbrida RAG', ':8003'],
  ['dvop-bff-curadoria', 'BFF Fila & Elegibilidade', ':8004'],
  ['dvop-srv-mcp-github', 'Conector GitHub Actions', ':8006'],
  ['dvop-srv-remediation', 'Remediação & PR Executor', ':8007'],
  ['dvop-bff-log-view', 'Cockpit de Diagnóstico', ':8080'],
];

function metricCard(hash, destaque, numero, label, desc, icone, iconeGood) {
  const a = el('a', 'metric-card' + (destaque ? ' destaque' : ''));
  a.href = hash;
  const info = el('div', 'metric-info');
  info.append(
    el('span', 'metric-num', String(numero ?? '–')),
    el('span', 'metric-label', label),
    el('span', 'metric-desc', desc),
  );
  const iconeWrap = el('div', 'metric-icon-wrap' + (iconeGood ? ' good' : ''));
  iconeWrap.innerHTML = icone;
  a.append(info, iconeWrap);
  return a;
}

export async function mount(container) {
  // título
  const header = el('div', 'page-header');
  const tituloWrap = el('div', 'page-title-wrap');
  const h1 = el('h1', 'page-title');
  const icone = el('span', 'tab-icon');
  icone.innerHTML = ICONE_HOME;
  h1.append(icone, el('span', null, 'Painel de Curadoria & Automação SRE'));
  tituloWrap.append(h1, el('span', 'page-sub', 'Central de governança de conhecimento e homologação de remediações de esteira'));
  header.appendChild(tituloWrap);
  container.appendChild(header);

  // dados reais: fila/soluções de /v1/info; base do total de /v1/documentos
  let info = { fila: null, solucoes: null };
  let base = null;
  try { info = await api.info(); } catch (e) { aviso(e.message); }
  try { base = (await api.documentos(1)).total; } catch { /* MS3 fora: card Base fica '–' */ }

  const ICO_FILA = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  const ICO_CACHE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
  const ICO_BASE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

  const grid = el('div', 'cards-inicio-grid');
  grid.append(
    metricCard('#/fila', true, info.fila, 'Casos Aguardando Curadoria', 'Erros órfãos identificados nas esteiras', ICO_FILA, false),
    metricCard('#/cache', false, info.solucoes, 'Soluções Ativas no Cache', 'Resoluções instantâneas (MS2 / MS5)', ICO_CACHE, true),
    metricCard('#/base', false, base, 'Documentos na Base RAG', 'Base vetorial de conhecimento (MS3)', ICO_BASE, false),
  );
  container.appendChild(grid);

  // card de topologia (referência de arquitetura, sem status ao vivo)
  const monitor = el('div', 'upstream-monitor-card');
  const cab = el('div', 'monitor-head');
  const titulo = el('span', 'monitor-title');
  const svg = el('span', 'tab-icon');
  svg.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--bex-muted)" stroke-width="2.2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
  titulo.append(svg, el('span', null, 'Topologia de microsserviços conectados'));
  cab.appendChild(titulo);
  const grade = el('div', 'upstream-grid');
  for (const [nome, papel, porta] of UPSTREAMS) {
    const node = el('div', 'up-node');
    const wrap = el('div', 'up-name-wrap');
    wrap.append(el('span', 'up-real-name', nome), el('span', 'up-role-label', papel));
    node.append(wrap, el('span', 'up-port-badge', porta));
    grade.appendChild(node);
  }
  monitor.append(cab, grade);
  container.appendChild(monitor);
}
