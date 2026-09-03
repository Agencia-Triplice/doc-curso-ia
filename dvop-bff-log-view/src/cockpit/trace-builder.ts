export type EstadoPasso = 'ok' | 'erro' | 'info';
export interface PassoTrace { chave: string; rotulo: string; valor: string; estado: EstadoPasso; }
export interface DesfechoTrace {
  resultado: string; fingerprint: string | null; servico: string | null; nivel: string | null;
  assinatura: string | null; degradado?: boolean; similaridade?: number; confianca?: number;
  solucao?: unknown; documentos?: unknown;
}
export interface ItemExtra { tipo?: string; url?: string; papel?: string; resultado?: string; fingerprint?: string; erro?: unknown; }
export interface TraceResult {
  trace: { passos: PassoTrace[]; desfecho: DesfechoTrace | null };
  itens_extras: ItemExtra[];
  principal_fingerprint: string | null;
  principal_resultado: string | null;
}

const ROTULO_RESULTADO: Record<string, string> = {
  cache_exato: 'match exato no cache',
  cache_aproximado: 'match aproximado no cache',
  base_conhecimento: 'resposta pela base de conhecimento',
  escalado: 'escalado para a curadoria',
  sem_solucao: 'sem solução conhecida',
};

function estadoDoResultado(r: string): EstadoPasso {
  return r === 'cache_exato' || r === 'cache_aproximado' || r === 'base_conhecimento' ? 'ok' : 'info';
}

function resumirItem(i: any): ItemExtra {
  const out: ItemExtra = {};
  if (i.tipo != null) out.tipo = i.tipo;
  if (i.url != null) out.url = i.url;
  if (i.papel != null) out.papel = i.papel;
  if (i.diagnostico?.resultado != null) out.resultado = i.diagnostico.resultado;
  if (i.diagnostico?.fingerprint != null) out.fingerprint = i.diagnostico.fingerprint;
  if (i.erro != null) out.erro = i.erro;
  return out;
}

export function montarTrace(misto: Record<string, any>): TraceResult {
  const itens: any[] = Array.isArray(misto?.itens) ? misto.itens : [];
  const principal =
    itens.find((i) => i && i.diagnostico) ??
    itens.find((i) => i && i.erro) ??
    itens.find((i) => i && i.tipo === 'precisa_job') ??
    null;

  const itens_extras = itens.filter((i) => i !== principal).map(resumirItem);

  if (!principal) {
    return { trace: { passos: [], desfecho: null }, itens_extras, principal_fingerprint: null, principal_resultado: null };
  }

  if (principal.diagnostico) {
    const d = principal.diagnostico;
    const passos: PassoTrace[] = [
      { chave: 'fingerprint', rotulo: 'Fingerprint', valor: String(d.fingerprint ?? ''), estado: 'info' },
      { chave: 'assinatura', rotulo: 'Assinatura', valor: String(d.assinatura ?? ''), estado: 'info' },
    ];
    if (principal.importacao) {
      const imp = principal.importacao;
      const valor = [imp.workflow, imp.branch, imp.passo_falho, imp.linhas_coletadas != null ? `${imp.linhas_coletadas} linhas` : null]
        .filter((x) => x != null && x !== '').join(' · ');
      passos.push({ chave: 'importacao', rotulo: 'Run importado', valor, estado: 'ok' });
    }
    if (misto?.triagem?.usada) {
      passos.push({ chave: 'triagem', rotulo: 'Triagem', valor: String(misto.triagem.intencao ?? ''), estado: 'info' });
    }
    passos.push({
      chave: 'resultado', rotulo: 'Resultado',
      valor: ROTULO_RESULTADO[d.resultado] ?? String(d.resultado ?? ''),
      estado: estadoDoResultado(String(d.resultado)),
    });

    const desfecho: DesfechoTrace = {
      resultado: String(d.resultado), fingerprint: d.fingerprint ?? null, servico: d.servico ?? null,
      nivel: d.nivel ?? null, assinatura: d.assinatura ?? null,
    };
    if (d.degradado) desfecho.degradado = true;
    if (d.similaridade != null) desfecho.similaridade = d.similaridade;
    if (d.confianca != null) desfecho.confianca = d.confianca;
    if (d.solucao != null) desfecho.solucao = d.solucao;
    if (d.documentos != null) desfecho.documentos = d.documentos;

    return { trace: { passos, desfecho }, itens_extras, principal_fingerprint: desfecho.fingerprint, principal_resultado: desfecho.resultado };
  }

  if (principal.erro) {
    const e = principal.erro;
    return {
      trace: { passos: [{ chave: 'erro', rotulo: 'Erro na importação', valor: `${e.status}: ${e.detail}`, estado: 'erro' }], desfecho: null },
      itens_extras, principal_fingerprint: null, principal_resultado: null,
    };
  }

  // precisa_job
  return {
    trace: { passos: [{ chave: 'precisa_job', rotulo: 'Ação necessária', valor: String(principal.mensagem ?? ''), estado: 'info' }], desfecho: null },
    itens_extras, principal_fingerprint: null, principal_resultado: null,
  };
}
