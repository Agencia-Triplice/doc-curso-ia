import { AgenteCuradorService } from '../src/agente-curador/agente-curador.service';
import { UpstreamError } from '../src/common/upstream-error';

const cfg = () => ({ defaultSrvUrl: 'http://ms1' } as any);
const fp = { fingerprint: 'fp1', assinatura: 'sig-1', service: 'svc', level: 'ERROR' };

function make(over: { agentixEnabled?: boolean; retrievalEnabled?: boolean; cacheEnabled?: boolean } = {}) {
  const srv = { fingerprint: jest.fn().mockResolvedValue(fp) };
  const retrieval = { enabled: over.retrievalEnabled ?? true, buscarContexto: jest.fn() };
  const agentix = { enabled: over.agentixEnabled ?? true, invocarCurador: jest.fn(), sessao: jest.fn(), logs: jest.fn() };
  const cache = {
    enabled: over.cacheEnabled ?? true,
    // estadoCuradoria lê órfão/rascunho/prompt do writer (MS5), então gateia por writerEnabled
    writerEnabled: over.cacheEnabled ?? true,
    garantirOrfao: jest.fn(),
    salvarRascunho: jest.fn(),
    // por padrão não há órfão legível → iniciar deriva do texto
    obterOrfao: jest.fn().mockRejectedValue(new UpstreamError(404, 'sem órfão')),
    // cura pronta lida do MS5 (source of truth real); mockada por teste
    obterRascunho: jest.fn(),
    // prompt do curador lido do MS5 (fonte da verdade, idêntico ao da curadoria);
    // por padrão 404 = curador ainda não gerou
    obterPrompt: jest.fn().mockRejectedValue(new UpstreamError(404, 'prompt desconhecido')),
  };
  const svc = new AgenteCuradorService(srv as any, retrieval as any, agentix as any, cache as any, cfg());
  return { svc, srv, retrieval, agentix, cache };
}

beforeEach(() => jest.spyOn(process.stdout, 'write').mockReturnValue(true));
afterEach(() => jest.restoreAllMocks());

describe('AgenteCuradorService.iniciar', () => {
  it('normaliza → busca contexto (sem órfão) → monta payload → invoca curador; devolve prompt inline', async () => {
    const { svc, srv, retrieval, agentix } = make();
    retrieval.buscarContexto.mockResolvedValue({ resultados: [{ titulo: 'Doc', conteudo: 'passo', confianca: 0.9 }] });
    agentix.invocarCurador.mockResolvedValue('sess1');
    const r = await svc.iniciar({ message: 'stacktrace...', service: 'svc', level: 'ERROR', template: 'srv-java' });

    expect(srv.fingerprint).toHaveBeenCalledWith('http://ms1', 'stacktrace...', 'svc', 'ERROR');
    expect(retrieval.buscarContexto).toHaveBeenCalledWith('sig-1', 'svc', 'ERROR');
    expect(r.sessao).toBe('sess1');
    expect(r.degradado).toBe(false);
    const pares = Object.fromEntries(r.prompt.map((p) => [p.key, p.value]));
    expect(pares.erro).toBe('sig-1');
    expect(pares.contexto).toBe('1. Doc (confiança 0.90)\npasso');
    expect(pares.persona).toContain('Java');
    // o payload invocado é exatamente o prompt devolvido
    expect(agentix.invocarCurador).toHaveBeenCalledWith(r.prompt);
  });

  it('MS3 vazio/off → contexto placeholder + degradado:true', async () => {
    const { svc, retrieval, agentix } = make({ retrievalEnabled: false });
    agentix.invocarCurador.mockResolvedValue('s');
    const r = await svc.iniciar({ message: 'x' });
    expect(retrieval.buscarContexto).not.toHaveBeenCalled();
    expect(r.degradado).toBe(true);
    const pares = Object.fromEntries(r.prompt.map((p) => [p.key, p.value]));
    expect(pares.contexto).toBe('(nenhum documento encontrado)');
    expect(pares.persona).toBe('SRE sênior');
  });

  it('MS3 lança UpstreamError → degradado:true e segue com placeholder', async () => {
    const { svc, retrieval, agentix } = make();
    retrieval.buscarContexto.mockRejectedValue(new UpstreamError(503, 'ms3 fora'));
    agentix.invocarCurador.mockResolvedValue('s');
    const r = await svc.iniciar({ message: 'x' });
    expect(r.degradado).toBe(true);
    expect(Object.fromEntries(r.prompt.map((p) => [p.key, p.value])).contexto).toBe('(nenhum documento encontrado)');
  });

  it('caminho misto (fingerprint conhecido): lê o órfão do MS5 e monta o prompt a partir dele — paridade com o curador', async () => {
    const { svc, srv, retrieval, agentix, cache } = make();
    cache.obterOrfao.mockResolvedValue({
      fingerprint: 'orfao-real',
      assinatura: 'sig-orfao',
      servico: 'GDD-Core/dvop-srv-demo',
      nivel: 'desconhecido',
      template: 'srv-java',
      workflow: 'ci',
      job: 'build',
      step_cmd: 'mvn package',
      exit_code: 1,
    });
    retrieval.buscarContexto.mockResolvedValue({ resultados: [] });
    agentix.invocarCurador.mockResolvedValue('s');

    // message é o blob enriquecido; deve ser IGNORADO em favor do órfão
    const r = await svc.iniciar({ message: 'Erro (linhas essenciais): blob...', fingerprint: 'orfao-real' });

    expect(cache.obterOrfao).toHaveBeenCalledWith('orfao-real');
    // não re-deriva do texto quando há órfão
    expect(srv.fingerprint).not.toHaveBeenCalled();
    // contexto buscado com os campos LIMPOS do órfão, não do blob
    expect(retrieval.buscarContexto).toHaveBeenCalledWith('sig-orfao', 'GDD-Core/dvop-srv-demo', 'desconhecido');
    const pares = Object.fromEntries(r.prompt.map((p) => [p.key, p.value]));
    expect(pares.erro).toBe('sig-orfao'); // assinatura limpa, sem o prefixo do blob
    expect(pares.servico).toBe('GDD-Core/dvop-srv-demo');
    expect(pares.persona).toContain('Java'); // especializada pelo template do órfão
    expect(pares.workflow).toBe('ci');
    expect(pares.exit_code).toBe('1');
  });

  it('fingerprint presente mas órfão ilegível (404): cai na derivação do texto, entrega ainda keia no fingerprint', async () => {
    const { svc, srv, agentix, cache } = make();
    // obterOrfao já rejeita 404 por padrão
    agentix.invocarCurador.mockResolvedValue('s');
    const r = await svc.iniciar({ message: 'texto cru', fingerprint: 'orfao-real' });
    expect(cache.obterOrfao).toHaveBeenCalledWith('orfao-real');
    expect(srv.fingerprint).toHaveBeenCalledWith('http://ms1', 'texto cru', undefined, undefined);
    // prompt veio do derivado (assinatura da fixture do srv)
    expect(Object.fromEntries(r.prompt.map((p) => [p.key, p.value])).erro).toBe('sig-1');
  });

});

describe('AgenteCuradorService.estadoCuradoria (reexibe prompt + cura da curadoria, do MS5)', () => {
  const PARES = [
    { key: 'erro', value: 'sig-1' },
    { key: 'servico', value: 'GDD-Core/dvop-srv-demo' },
    { key: 'persona', value: 'Java/Spring ☕' },
  ];

  it('prompt presente → pronto:true + prompt (idêntico ao da curadoria) + cura com chips', async () => {
    const { svc, cache } = make();
    cache.obterPrompt.mockResolvedValue({ fingerprint: 'orfao-real', pares: PARES, registrado_em: 't' });
    cache.obterRascunho.mockResolvedValue({
      fingerprint: 'orfao-real',
      solucao: 'Rode `docker login` de novo\n\n---\nConfiança: media — Fontes: runbook-docker, wiki-registry',
      autor: 'IA (Agentix)',
      atualizado_em: '2026-08-23T10:00:00Z',
    });

    const r = await svc.estadoCuradoria('orfao-real');

    expect(cache.obterPrompt).toHaveBeenCalledWith('orfao-real');
    expect(cache.obterRascunho).toHaveBeenCalledWith('orfao-real');
    expect(r).toEqual({
      pronto: true,
      prompt: PARES,
      cura: {
        solucao: 'Rode `docker login` de novo',
        confianca: 'media',
        fontes: ['runbook-docker', 'wiki-registry'],
        autor: 'IA (Agentix)',
        atualizado_em: '2026-08-23T10:00:00Z',
      },
    });
  });

  it('prompt presente mas cura ainda não (404) → pronto:true, cura:null (janela do worker)', async () => {
    const { svc, cache } = make();
    cache.obterPrompt.mockResolvedValue({ pares: PARES, registrado_em: 't' });
    cache.obterRascunho.mockRejectedValue(new UpstreamError(404, 'rascunho desconhecido'));
    expect(await svc.estadoCuradoria('fp')).toEqual({ pronto: true, prompt: PARES, cura: null });
  });

  it('rascunho sem rodapé de fontes → confianca preenchida, fontes vazia', async () => {
    const { svc, cache } = make();
    cache.obterPrompt.mockResolvedValue({ pares: PARES });
    cache.obterRascunho.mockResolvedValue({ solucao: 'faça X\n\n---\nConfiança: alta', autor: 'IA (Agentix)', atualizado_em: 't' });
    const r = await svc.estadoCuradoria('fp');
    expect(r.cura).toEqual({ solucao: 'faça X', confianca: 'alta', fontes: [], autor: 'IA (Agentix)', atualizado_em: 't' });
  });

  it('sem prompt no MS5 (404) e sem cura → pronto:false, motivo sem_cura (aguardando o curador)', async () => {
    const { svc, cache } = make();
    // obterPrompt já mocka 404 por padrão
    cache.obterRascunho.mockRejectedValue(new UpstreamError(404, 'rascunho desconhecido'));
    expect(await svc.estadoCuradoria('fp')).toEqual({ pronto: false, prompt: null, cura: null, motivo: 'sem_cura' });
  });

  it('prompt vazio (pares []) → tratado como ainda não gerado (sem_cura)', async () => {
    const { svc, cache } = make();
    cache.obterPrompt.mockResolvedValue({ pares: [] });
    cache.obterRascunho.mockRejectedValue(new UpstreamError(404, 'rascunho desconhecido'));
    expect(await svc.estadoCuradoria('fp')).toEqual({ pronto: false, prompt: null, cura: null, motivo: 'sem_cura' });
  });

  it('cache desligado → indisponivel (sem chamar o MS5)', async () => {
    const { svc, cache } = make({ cacheEnabled: false });
    expect(await svc.estadoCuradoria('fp')).toEqual({ pronto: false, prompt: null, cura: null, motivo: 'indisponivel' });
    expect(cache.obterPrompt).not.toHaveBeenCalled();
    expect(cache.obterRascunho).not.toHaveBeenCalled();
  });

  it('MS5 fora (erro não-404 no prompt) → pronto:false, motivo indisponivel (best-effort)', async () => {
    const { svc, cache } = make();
    cache.obterPrompt.mockRejectedValue(new UpstreamError(503, 'fora'));
    cache.obterRascunho.mockRejectedValue(new UpstreamError(503, 'fora'));
    expect(await svc.estadoCuradoria('fp')).toEqual({ pronto: false, prompt: null, cura: null, motivo: 'indisponivel' });
  });
});

describe('AgenteCuradorService.resultado', () => {
  it('executando quando a sessão ainda roda', async () => {
    const { svc, agentix } = make();
    agentix.sessao.mockResolvedValue({ state: 'RUNNING' });
    expect(await svc.resultado('s')).toEqual({ sessao: 's', estado: 'executando' });
  });

  it('DONE com cura → {solucao,confianca,fontes}; entrega rascunho após confirmar órfão', async () => {
    const { svc, agentix, cache } = make();
    // iniciar registra o fingerprint da sessão
    agentix.invocarCurador.mockResolvedValue('s');
    await svc.iniciar({ message: 'x' });
    agentix.sessao.mockResolvedValue({ state: 'DONE', result: JSON.stringify({ solucao: 'faça X', confianca: 'alta', fontes: ['runbook'] }) });
    cache.garantirOrfao.mockResolvedValue(true);
    cache.salvarRascunho.mockResolvedValue({});

    const r = await svc.resultado('s');
    expect(r).toEqual({ sessao: 's', estado: 'concluido', diagnostico: { solucao: 'faça X', confianca: 'alta', fontes: ['runbook'] } });
    expect(cache.garantirOrfao).toHaveBeenCalledWith('fp1');
    expect(cache.salvarRascunho).toHaveBeenCalledWith('fp1', 'faça X\n\n---\nConfiança: alta — Fontes: runbook', 'IA (Agentix)');
  });

  it('caminho misto: entrega keia no fingerprint do órfão (lido do MS5), não no derivado da mensagem', async () => {
    const { svc, agentix, cache } = make();
    cache.obterOrfao.mockResolvedValue({ fingerprint: 'orfao-real', assinatura: 'sig-orfao', servico: 'svc', nivel: 'ERROR', template: 'srv-java' });
    agentix.invocarCurador.mockResolvedValue('s');
    // message é o blob enriquecido; fp.fingerprint (derivado, 'fp1') não deve ser usado na entrega
    await svc.iniciar({ message: 'blob enriquecido...', fingerprint: 'orfao-real' });
    agentix.sessao.mockResolvedValue({ state: 'DONE', result: JSON.stringify({ solucao: 'faça X', confianca: 'alta', fontes: ['runbook'] }) });
    cache.garantirOrfao.mockResolvedValue(true);
    cache.salvarRascunho.mockResolvedValue({});

    const r = await svc.resultado('s');
    expect(r.estado).toBe('concluido');
    expect(cache.garantirOrfao).toHaveBeenCalledWith('orfao-real');
    expect(cache.salvarRascunho).toHaveBeenCalledWith('orfao-real', 'faça X\n\n---\nConfiança: alta — Fontes: runbook', 'IA (Agentix)');
    expect(cache.garantirOrfao).not.toHaveBeenCalledWith('fp1');
  });

  it('entrega é best-effort: órfão não confirmado → não grava rascunho, resposta intacta', async () => {
    const { svc, agentix, cache } = make();
    agentix.invocarCurador.mockResolvedValue('s');
    await svc.iniciar({ message: 'x' });
    agentix.sessao.mockResolvedValue({ state: 'DONE', result: JSON.stringify({ solucao: 'y' }) });
    cache.garantirOrfao.mockResolvedValue(false);

    const r = await svc.resultado('s');
    expect(r.estado).toBe('concluido');
    expect(r.diagnostico).toEqual({ solucao: 'y', confianca: undefined, fontes: undefined });
    expect(cache.salvarRascunho).not.toHaveBeenCalled();
  });

  it('entrega é best-effort: PUT do rascunho falha (404) não derruba a resposta', async () => {
    const { svc, agentix, cache } = make();
    agentix.invocarCurador.mockResolvedValue('s');
    await svc.iniciar({ message: 'x' });
    agentix.sessao.mockResolvedValue({ state: 'DONE', result: JSON.stringify({ solucao: 'y' }) });
    cache.garantirOrfao.mockResolvedValue(true);
    cache.salvarRascunho.mockRejectedValue(new UpstreamError(404, 'sumiu'));

    const r = await svc.resultado('s');
    expect(r.estado).toBe('concluido');
    expect(r.diagnostico).toEqual({ solucao: 'y', confianca: undefined, fontes: undefined });
  });

  it('não entrega duas vezes em polls repetidos da mesma sessão', async () => {
    const { svc, agentix, cache } = make();
    agentix.invocarCurador.mockResolvedValue('s');
    await svc.iniciar({ message: 'x' });
    agentix.sessao.mockResolvedValue({ state: 'DONE', result: JSON.stringify({ solucao: 'y' }) });
    cache.garantirOrfao.mockResolvedValue(true);
    cache.salvarRascunho.mockResolvedValue({});

    await svc.resultado('s');
    await svc.resultado('s');
    expect(cache.salvarRascunho).toHaveBeenCalledTimes(1);
  });

  it('DONE sem resultado decodificável → concluido sem diagnostico, com detalhe', async () => {
    const { svc, agentix, cache } = make();
    agentix.sessao.mockResolvedValue({ state: 'DONE', result: 'lixo' });
    const r = await svc.resultado('s');
    expect(r.estado).toBe('concluido');
    expect(r.diagnostico).toBeNull();
    expect(r.detalhe).toBeTruthy();
    expect(cache.garantirOrfao).not.toHaveBeenCalled();
  });

  it('estado não-DONE terminal → falhou com detalhe', async () => {
    const { svc, agentix } = make();
    agentix.sessao.mockResolvedValue({ state: 'FAILED' });
    const r = await svc.resultado('s');
    expect(r.estado).toBe('falhou');
    expect(r.detalhe).toContain('FAILED');
  });
});
