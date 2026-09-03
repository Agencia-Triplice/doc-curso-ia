import { montarTrace } from '../src/cockpit/trace-builder';

const diag = (over: any = {}) => ({
  fingerprint: 'fp1', assinatura: 'erro X', servico: 'srv-java', nivel: 'ERROR', ...over,
});

describe('montarTrace', () => {
  it('cache_exato: passos base + desfecho com similaridade/solucao', () => {
    const misto = {
      triagem: { usada: false, intencao: 'diagnosticar' },
      itens: [{ tipo: 'texto', papel: 'erro', diagnostico: diag({ resultado: 'cache_exato', similaridade: 0.99, solucao: { solucao: 'faça Y' } }) }],
    };
    const r = montarTrace(misto);
    expect(r.principal_resultado).toBe('cache_exato');
    expect(r.principal_fingerprint).toBe('fp1');
    expect(r.trace.desfecho).toMatchObject({ resultado: 'cache_exato', fingerprint: 'fp1', servico: 'srv-java', similaridade: 0.99 });
    expect(r.trace.desfecho!.solucao).toEqual({ solucao: 'faça Y' });
    expect(r.trace.passos.map((p) => p.chave)).toEqual(['fingerprint', 'assinatura', 'resultado']);
    expect(r.trace.passos.find((p) => p.chave === 'resultado')!.estado).toBe('ok');
    expect(r.itens_extras).toEqual([]);
  });

  it('base_conhecimento: desfecho com confianca/documentos', () => {
    const misto = { triagem: { usada: false }, itens: [{ tipo: 'texto', diagnostico: diag({ resultado: 'base_conhecimento', confianca: 0.8, documentos: [{ id: 'd1' }] }) }] };
    const r = montarTrace(misto);
    expect(r.trace.desfecho).toMatchObject({ resultado: 'base_conhecimento', confianca: 0.8 });
    expect(r.trace.desfecho!.documentos).toEqual([{ id: 'd1' }]);
  });

  it('escalado: estado do passo resultado = info; sem_solucao idem', () => {
    const esc = montarTrace({ itens: [{ diagnostico: diag({ resultado: 'escalado', confianca: 0.2, documentos: [] }) }] });
    expect(esc.trace.passos.find((p) => p.chave === 'resultado')!.estado).toBe('info');
    const sem = montarTrace({ itens: [{ diagnostico: diag({ resultado: 'sem_solucao', detalhe: 'cache miss' }) }] });
    expect(sem.principal_resultado).toBe('sem_solucao');
    expect(sem.trace.desfecho!.resultado).toBe('sem_solucao');
  });

  it('degradado:true chega ao desfecho', () => {
    const r = montarTrace({ itens: [{ diagnostico: diag({ resultado: 'cache_exato', degradado: true }) }] });
    expect(r.trace.desfecho!.degradado).toBe(true);
  });

  it('link com importacao e triagem usada: passos importacao + triagem entram', () => {
    const misto = {
      triagem: { usada: true, intencao: 'diagnosticar erro de build' },
      itens: [{
        tipo: 'link', url: 'http://gh/run/1', papel: 'erro',
        importacao: { jobs_falhos: 1, workflow: 'ci', branch: 'main', passo_falho: 'build', linhas_coletadas: 42 },
        diagnostico: diag({ resultado: 'cache_aproximado', similaridade: 0.7 }),
      }],
    };
    const r = montarTrace(misto);
    const chaves = r.trace.passos.map((p) => p.chave);
    expect(chaves).toEqual(['fingerprint', 'assinatura', 'importacao', 'triagem', 'resultado']);
    expect(r.trace.passos.find((p) => p.chave === 'importacao')!.valor).toContain('ci');
    expect(r.trace.passos.find((p) => p.chave === 'importacao')!.valor).toContain('42 linhas');
  });

  it('multi-item: principal = 1º com diagnostico; demais viram itens_extras', () => {
    const misto = { itens: [
      { tipo: 'link', url: 'http://gh/ref', papel: 'referencia' },
      { tipo: 'texto', papel: 'erro', diagnostico: diag({ resultado: 'cache_exato' }) },
      { tipo: 'link', url: 'http://gh/2', papel: 'erro', erro: { status: 401, detail: 'PAT recusado' } },
    ] };
    const r = montarTrace(misto);
    expect(r.principal_resultado).toBe('cache_exato');
    expect(r.itens_extras).toHaveLength(2);
    expect(r.itens_extras.map((i) => i.url)).toEqual(['http://gh/ref', 'http://gh/2']);
    expect(r.itens_extras.find((i) => i.url === 'http://gh/2')!.erro).toEqual({ status: 401, detail: 'PAT recusado' });
  });

  it('principal só com erro (nenhum diagnostico): passo de erro, desfecho null', () => {
    const r = montarTrace({ itens: [{ tipo: 'link', url: 'http://gh/x', papel: 'erro', erro: { status: 503, detail: 'importação indisponível' } }] });
    expect(r.trace.desfecho).toBeNull();
    expect(r.principal_fingerprint).toBeNull();
    expect(r.trace.passos).toEqual([{ chave: 'erro', rotulo: 'Erro na importação', valor: '503: importação indisponível', estado: 'erro' }]);
  });

  it('precisa_job: passo informativo com a mensagem, desfecho null', () => {
    const r = montarTrace({ itens: [{ tipo: 'precisa_job', mensagem: 'cole o link do job', jobs_falhos: [] }] });
    expect(r.trace.desfecho).toBeNull();
    expect(r.trace.passos[0]).toMatchObject({ chave: 'precisa_job', estado: 'info', valor: 'cole o link do job' });
  });

  it('sem itens: trace vazio', () => {
    const r = montarTrace({ itens: [] });
    expect(r).toEqual({ trace: { passos: [], desfecho: null }, itens_extras: [], principal_fingerprint: null, principal_resultado: null });
  });

  it('itens ausente (não-array): tratado como vazio', () => {
    const r = montarTrace({});
    expect(r).toEqual({ trace: { passos: [], desfecho: null }, itens_extras: [], principal_fingerprint: null, principal_resultado: null });
  });

  it('campos nulos + resultado fora do mapa + importação sem linhas + triagem sem intenção', () => {
    const misto = {
      triagem: { usada: true }, // intenção undefined → valor ''
      itens: [{
        importacao: { workflow: 'ci' }, // sem linhas_coletadas nem branch/passo
        diagnostico: { resultado: 'desconhecido', fingerprint: null, assinatura: null, servico: null, nivel: null },
      }],
    };
    const r = montarTrace(misto);
    const passo = (c: string) => r.trace.passos.find((p) => p.chave === c)!;
    expect(passo('resultado').valor).toBe('desconhecido'); // fora do ROTULO → String(resultado)
    expect(passo('fingerprint').valor).toBe(''); // fingerprint null → ''
    expect(passo('assinatura').valor).toBe(''); // assinatura null → ''
    expect(passo('triagem').valor).toBe(''); // intenção undefined → ''
    expect(passo('importacao').valor).toBe('ci'); // sem "· 42 linhas"
    expect(r.trace.desfecho).toMatchObject({ fingerprint: null, servico: null, nivel: null, assinatura: null });
  });

  it('resultado nulo: rótulo vira string vazia', () => {
    const r = montarTrace({ itens: [{ diagnostico: { resultado: null } }] });
    expect(r.trace.passos.find((p) => p.chave === 'resultado')!.valor).toBe('');
  });

  it('item-extra que também tem diagnostico: resumo carrega resultado e fingerprint', () => {
    const misto = { itens: [
      { diagnostico: diag({ resultado: 'cache_exato' }) }, // principal (1º com diagnostico)
      { tipo: 'texto', diagnostico: { resultado: 'escalado', fingerprint: 'fp9' } }, // extra
    ] };
    const r = montarTrace(misto);
    expect(r.principal_resultado).toBe('cache_exato');
    expect(r.itens_extras).toHaveLength(1);
    expect(r.itens_extras[0]).toMatchObject({ resultado: 'escalado', fingerprint: 'fp9' });
  });

  it('precisa_job sem mensagem: valor vazio', () => {
    const r = montarTrace({ itens: [{ tipo: 'precisa_job' }] });
    expect(r.trace.passos[0]).toMatchObject({ chave: 'precisa_job', valor: '' });
  });
});
