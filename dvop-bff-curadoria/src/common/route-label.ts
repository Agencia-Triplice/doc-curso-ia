const ROTAS: Array<[RegExp, string]> = [
  [/^\/api\/base\/[^/]+$/, '/api/base/{doc_id}'],
  [/^\/api\/fila\/[^/]+\/aprovar$/, '/api/fila/{fingerprint}/aprovar'],
  [/^\/api\/fila\/[^/]+\/descartar$/, '/api/fila/{fingerprint}/descartar'],
  [/^\/api\/agente\/sessao\/[^/]+\/logs$/, '/api/agente/sessao/{sessao_id}/logs'],
  [/^\/api\/agente\/sessao\/[^/]+$/, '/api/agente/sessao/{sessao_id}'],
  [/^\/api\/requests\/[^/]+$/, '/api/requests/{digest}'],
];
const ESTATICAS = new Set([
  '/health/live', '/health/ready', '/metrics',
  '/api/config', '/api/estado', '/api/logs', '/api/stats', '/api/diagnostico',
  '/api/agente/diagnostico', '/api/requests', '/api/fila', '/api/solucoes',
  '/api/base', '/api/cenarios', '/api/simular', '/api/importar',
]);

export function rotaLabel(_method: string, path: string): string {
  if (ESTATICAS.has(path)) return path;
  for (const [re, tpl] of ROTAS) if (re.test(path)) return tpl;
  return 'nao_mapeada';
}

const HEX = /^[0-9a-f]+$/;
export function traceIdDoTraceparent(header?: string): string | null {
  if (!header) return null;
  const p = header.trim().split('-');
  if (p.length !== 4) return null;
  const [v, t, par, f] = p;
  if (v.length !== 2 || t.length !== 32 || par.length !== 16 || f.length !== 2) return null;
  if (![v, t, par, f].every((x) => HEX.test(x))) return null;
  if (t === '0'.repeat(32)) return null;
  return t;
}
