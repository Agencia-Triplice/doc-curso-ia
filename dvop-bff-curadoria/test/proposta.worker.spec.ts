import { PropostaWorker, POLL_MAX, BACKOFF_TETO, MAX_RESOLUCOES_HITL } from '../src/propostas/proposta.worker';
import { PropostaStore } from '../src/propostas/proposta-store.service';
import { CuradoriaConfig, loadConfig } from '../src/config/env';
import { RemediationService } from '../src/upstreams/remediation.service';
import { AgentixService } from '../src/agentix/agentix.service';

const cfg: CuradoriaConfig = {
  ...loadConfig({}),
  agentixPrEntityName: 'propor-pr',
  propostaMaxArquivos: 3,
  propostaMaxLinhasDiff: 80,
  propostaIntervalo: 20,
};

interface MockMs8 {
  lerArquivoRepo: jest.Mock;
}
interface MockAgentix {
  enabled: boolean;
  invocarComEntidade: jest.Mock;
  sessao: jest.Mock;
  listarHitl: jest.Mock;
  resolverHitl: jest.Mock;
}

function makeWorker(overrides: { cfg?: Partial<CuradoriaConfig> } = {}): {
  worker: PropostaWorker;
  store: PropostaStore;
  ms8: MockMs8;
  agentix: MockAgentix;
} {
  const store = new PropostaStore(':memory:');
  const ms8: MockMs8 = { lerArquivoRepo: jest.fn() };
  const agentix: MockAgentix = {
    enabled: true,
    invocarComEntidade: jest.fn(),
    sessao: jest.fn(),
    listarHitl: jest.fn(),
    resolverHitl: jest.fn(),
  };
  const worker = new PropostaWorker(
    store,
    ms8 as unknown as RemediationService,
    agentix as unknown as AgentixService,
    { ...cfg, ...overrides.cfg },
  );
  jest.spyOn(worker as any, 'sleep').mockResolvedValue(undefined);
  return { worker, store, ms8, agentix };
}

beforeEach(() => {
  jest.spyOn(process.stdout, 'write').mockReturnValue(true);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('PropostaWorker.processarUma', () => {
  it('gera proposta pronta a partir da sessão DONE', async () => {
    const store = new PropostaStore(':memory:');
    store.criarGerando(
      { fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: ['package.json'] },
      'now',
    );
    const ms8 = { lerArquivoRepo: jest.fn().mockResolvedValue({ path: 'package.json', existe: true, conteudo: 'v1', sha: 'x' }) };
    const agentix = {
      enabled: true,
      invocarComEntidade: jest.fn().mockResolvedValue('sess-1'),
      sessao: jest.fn().mockResolvedValue({
        state: 'DONE',
        result: JSON.stringify({ resumo: 'r', titulo: 't', corpo: 'c', arquivos: [{ path: 'package.json', conteudo_novo: 'v1\nv2' }] }),
      }),
    };
    const worker = new PropostaWorker(store as any, ms8 as any, agentix as any, cfg as any /*, metrics*/);
    jest.spyOn(worker as any, 'sleep').mockResolvedValue(undefined);
    await (worker as any).processarUma(store.get('fp'));
    const row = store.get('fp')!;
    expect(row.estado).toBe('pronta');
    expect(row.n_arquivos).toBe(1);
    expect(JSON.parse(row.arquivos_json!)[0].conteudo_atual).toBe('v1');
    expect(agentix.invocarComEntidade).toHaveBeenCalledWith(cfg.agentixPrEntityName, expect.any(Array));
    expect(row.session_id).toBe('sess-1');
    store.close();
  });

  it('marca erro_geracao quando estoura o teto', async () => {
    const { worker, store, ms8, agentix } = makeWorker({ cfg: { propostaMaxLinhasDiff: 1 } });
    store.criarGerando(
      { fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: ['package.json'] },
      'now',
    );
    ms8.lerArquivoRepo.mockResolvedValue({ path: 'package.json', existe: true, conteudo: 'a', sha: 'x' });
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({
      state: 'DONE',
      result: JSON.stringify({
        resumo: 'r',
        titulo: 't',
        corpo: 'c',
        arquivos: [{ path: 'package.json', conteudo_novo: 'x\ny\nz' }],
      }),
    });

    await worker.processarUma(store.get('fp')!);

    const row = store.get('fp')!;
    expect(row.estado).toBe('erro_geracao');
    expect(row.motivo).toMatch(/teto/);
    store.close();
  });

  it('marca erro_geracao quando a sessão não termina DONE (timeout)', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    ms8.lerArquivoRepo.mockResolvedValue({ path: 'x', existe: false, conteudo: '' });
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({ state: 'RUNNING' });

    await worker.processarUma(store.get('fp')!);

    const row = store.get('fp')!;
    expect(row.estado).toBe('erro_geracao');
    expect(row.motivo).toBe('sessão timeout');
    expect(agentix.sessao).toHaveBeenCalledTimes(POLL_MAX);
    store.close();
  });

  it('marca erro_geracao com motivo "desconhecido" quando a sessão termina sem state', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    ms8.lerArquivoRepo.mockResolvedValue({ path: 'x', existe: false, conteudo: '' });
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({});

    await worker.processarUma(store.get('fp')!);

    const row = store.get('fp')!;
    expect(row.estado).toBe('erro_geracao');
    expect(row.motivo).toBe('sessão desconhecido');
    store.close();
  });

  it('paths_json nulo (sem valor) é tratado como lista vazia', async () => {
    const { worker, store, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    store.atualizar('fp', { paths_json: null }, 'now2');
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({
      state: 'DONE',
      result: JSON.stringify({
        resumo: 'r',
        titulo: 't',
        corpo: 'c',
        arquivos: [{ path: 'novo.txt', conteudo_novo: 'x' }],
      }),
    });

    await worker.processarUma(store.get('fp')!);

    expect(store.get('fp')!.estado).toBe('pronta');
    store.close();
  });

  it('marca erro_geracao quando a sessão termina em estado diferente de DONE', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    ms8.lerArquivoRepo.mockResolvedValue({ path: 'x', existe: false, conteudo: '' });
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({ state: 'FAILED' });

    await worker.processarUma(store.get('fp')!);

    const row = store.get('fp')!;
    expect(row.estado).toBe('erro_geracao');
    expect(row.motivo).toBe('sessão FAILED');
    store.close();
  });

  it('marca erro_geracao quando a resposta não decodifica', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    ms8.lerArquivoRepo.mockResolvedValue({ path: 'x', existe: false, conteudo: '' });
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({ state: 'DONE', result: 'não é json válido' });

    await worker.processarUma(store.get('fp')!);

    const row = store.get('fp')!;
    expect(row.estado).toBe('erro_geracao');
    expect(row.motivo).toBe('resposta inválida');
    store.close();
  });

  it('sem paths candidatos: não chama o MS8 e ainda gera proposta pronta', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({
      state: 'DONE',
      result: JSON.stringify({ resumo: 'r', titulo: 't', corpo: 'c', arquivos: [{ path: 'novo.txt', conteudo_novo: 'x' }] }),
    });

    await worker.processarUma(store.get('fp')!);

    expect(ms8.lerArquivoRepo).not.toHaveBeenCalled();
    const row = store.get('fp')!;
    expect(row.estado).toBe('pronta');
    expect(JSON.parse(row.arquivos_json!)[0].conteudo_atual).toBe('');
    store.close();
  });

  it('campos nulos (assinatura/solucao) e resposta do MS8 sem conteudo caem nos defaults vazios', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: null, solucao: null, instrucao: null, paths: ['a.ts'] }, 'now');
    ms8.lerArquivoRepo.mockResolvedValue({ path: 'a.ts', existe: false });
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({
      state: 'DONE',
      result: JSON.stringify({ resumo: 'r', titulo: 't', corpo: 'c', arquivos: [{ path: 'a.ts', conteudo_novo: 'x' }] }),
    });

    await worker.processarUma(store.get('fp')!);

    expect(ms8.lerArquivoRepo).toHaveBeenCalledWith('org/app', 'a.ts');
    const row = store.get('fp')!;
    expect(row.estado).toBe('pronta');
    expect(JSON.parse(row.arquivos_json!)[0].conteudo_atual).toBe('');
    store.close();
  });

  it('servico ausente (null): marca erro_geracao SEM chamar MS8 nem invocar o Agentix', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: null, assinatura: 'a', solucao: 's', instrucao: null, paths: ['a.ts'] }, 'now');

    await worker.processarUma(store.get('fp')!);

    const row = store.get('fp')!;
    expect(row.estado).toBe('erro_geracao');
    expect(row.motivo).toMatch(/serviço inválido/);
    expect(ms8.lerArquivoRepo).not.toHaveBeenCalled();
    expect(agentix.invocarComEntidade).not.toHaveBeenCalled();
    store.close();
  });

  it('servico malformado (sem "owner/repo"): marca erro_geracao SEM chamar MS8 nem invocar o Agentix', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'naoehslug', assinatura: 'a', solucao: 's', instrucao: null, paths: ['a.ts'] }, 'now');

    await worker.processarUma(store.get('fp')!);

    const row = store.get('fp')!;
    expect(row.estado).toBe('erro_geracao');
    expect(row.motivo).toMatch(/serviço inválido/);
    expect(ms8.lerArquivoRepo).not.toHaveBeenCalled();
    expect(agentix.invocarComEntidade).not.toHaveBeenCalled();
    store.close();
  });

  it('paths_json inválido é tratado como lista vazia (não lança)', async () => {
    const { worker, store, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    // corrompe paths_json diretamente na row para simular dado inválido
    (store as any).db.prepare("UPDATE proposta_pr SET paths_json = '{not json' WHERE fingerprint = 'fp'").run();
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({
      state: 'DONE',
      result: JSON.stringify({
        resumo: 'r',
        titulo: 't',
        corpo: 'c',
        arquivos: [{ path: 'novo.txt', conteudo_novo: 'x' }],
      }),
    });

    await expect(worker.processarUma(store.get('fp')!)).resolves.toBeUndefined();
    expect(store.get('fp')!.estado).toBe('pronta');
    store.close();
  });

  it('modo agente: envia instrucao e só candidatos existentes ao AgentiX', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando(
      {
        fingerprint: 'fp-ag',
        servico: 'GDD-Core/dvop-srv-demo',
        assinatura: 'blob upload invalid',
        solucao: null,
        instrucao: 'incremente o patch do <version>',
        paths: ['pom.xml', 'package.json'],
      },
      'now',
    );
    ms8.lerArquivoRepo.mockImplementation((_servico: string, path: string) =>
      path === 'pom.xml'
        ? Promise.resolve({ conteudo: '<version>1.1.0</version>', existe: true, sha: 'a' })
        : Promise.resolve({ conteudo: '', existe: false }),
    );
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({
      state: 'DONE',
      result: JSON.stringify({
        aplica: true,
        resumo: 'bump',
        titulo: 't',
        corpo: 'c',
        arquivos: [{ path: 'pom.xml', conteudo_novo: '<version>1.1.1</version>' }],
      }),
    });

    await worker.processarUma(store.get('fp-ag')!);

    const payload = agentix.invocarComEntidade.mock.calls[0][1];
    const arquivos = JSON.parse(payload.find((p: { key: string }) => p.key === 'arquivos').value);
    expect(arquivos.map((a: { path: string }) => a.path)).toEqual(['pom.xml']); // package.json (existe:false) filtrado
    expect(payload.find((p: { key: string }) => p.key === 'instrucao').value).toBe(
      'incremente o patch do <version>',
    );
    expect(store.get('fp-ag')!.estado).toBe('pronta');
    store.close();
  });

  it('modo agente: aplica:false (arquivos:[] — shape real do agente) vira nao_aplicavel sem PR', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando(
      {
        fingerprint: 'fp-na',
        servico: 'GDD-Core/dvop-srv-demo',
        assinatura: 'x',
        solucao: null,
        instrucao: 'bump',
        paths: ['pom.xml'],
      },
      'now',
    );
    ms8.lerArquivoRepo.mockResolvedValue({ conteudo: '<parent>...</parent>', existe: true, sha: 'a' });
    agentix.invocarComEntidade.mockResolvedValue('sess-2');
    agentix.sessao.mockResolvedValue({
      state: 'DONE',
      result: JSON.stringify({
        aplica: false,
        resumo: 'sem <version> próprio (herdado do parent)',
        titulo: 'n/a',
        corpo: 'n/a',
        arquivos: [],
      }),
    });

    await worker.processarUma(store.get('fp-na')!);

    const row = store.get('fp-na')!;
    expect(row.estado).toBe('nao_aplicavel');
    expect(row.motivo).toContain('parent');
    expect(row.arquivos_json).toBeNull();
    store.close();
  });
});

describe('PropostaWorker: pausa HITL na geração da proposta', () => {
  const DONE_OK = {
    state: 'DONE',
    result: JSON.stringify({ resumo: 'r', titulo: 't', corpo: 'c', arquivos: [{ path: 'novo.txt', conteudo_novo: 'x' }] }),
  };

  it('sessão pausa em BLOCKED (sim): conduz o HITL (confirm) e segue até pronta', async () => {
    const { worker, store, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    // 1ª consulta pausa; após resolver, 2ª consulta conclui.
    agentix.sessao
      .mockResolvedValueOnce({ state: 'BLOCKED' })
      .mockResolvedValue(DONE_OK);
    agentix.listarHitl.mockResolvedValue([
      { requirement_id: 'sess-1', session_id: 'sess-1', requirement_type: 'confirmation', status: 'pending' },
    ]);
    agentix.resolverHitl.mockResolvedValue({ state: 'RUNNING', output: null });

    await worker.processarUma(store.get('fp')!);

    expect(agentix.listarHitl).toHaveBeenCalledWith('sess-1');
    expect(agentix.resolverHitl).toHaveBeenCalledWith('sess-1', expect.objectContaining({ action: 'confirm' }));
    expect(store.get('fp')!.estado).toBe('pronta');
    store.close();
  });

  it('sessão pausa em WAITING_HITL (plataforma real): conduz e segue até pronta', async () => {
    const { worker, store, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao
      .mockResolvedValueOnce({ state: 'WAITING_HITL' })
      .mockResolvedValue(DONE_OK);
    agentix.listarHitl.mockResolvedValue([
      { requirement_id: 'req-9', session_id: 'sess-1', requirement_type: 'confirmation', status: 'pending' },
    ]);
    agentix.resolverHitl.mockResolvedValue({ state: 'RUNNING', output: null });

    await worker.processarUma(store.get('fp')!);

    expect(agentix.resolverHitl).toHaveBeenCalledWith('req-9', expect.objectContaining({ action: 'confirm' }));
    expect(store.get('fp')!.estado).toBe('pronta');
    store.close();
  });

  it('tipo não-confirmation (external_execution) NÃO é auto-resolvido: marca erro_geracao', async () => {
    // O contrato real resolve external_execution com action=complete + `result` obrigatório
    // (400 sem ele) — e a geração de proposta não produz result. Só `confirmation` é
    // auto-resolvível; os demais tipos deixam a sessão pausada → erro honesto.
    const { worker, store, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({ state: 'BLOCKED' });
    agentix.listarHitl.mockResolvedValue([
      { requirement_id: 'req-x', session_id: 'sess-1', requirement_type: 'external_execution', status: 'pending' },
    ]);

    await worker.processarUma(store.get('fp')!);

    expect(agentix.resolverHitl).not.toHaveBeenCalled();
    const row = store.get('fp')!;
    expect(row.estado).toBe('erro_geracao');
    expect(row.motivo).toBe('sessão BLOCKED');
    store.close();
  });

  it('BLOCKED sem requerimento pendente: não insiste, marca erro_geracao', async () => {
    const { worker, store, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({ state: 'BLOCKED' });
    agentix.listarHitl.mockResolvedValue([]);

    await worker.processarUma(store.get('fp')!);

    expect(agentix.resolverHitl).not.toHaveBeenCalled();
    const row = store.get('fp')!;
    expect(row.estado).toBe('erro_geracao');
    expect(row.motivo).toBe('sessão BLOCKED');
    store.close();
  });

  it('pausa que nunca avança: resolve até o teto e então marca erro (anti-loop)', async () => {
    const { worker, store, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({ state: 'BLOCKED' }); // nunca sai da pausa
    agentix.listarHitl.mockResolvedValue([
      { requirement_id: 'sess-1', session_id: 'sess-1', requirement_type: 'confirmation', status: 'pending' },
    ]);
    agentix.resolverHitl.mockResolvedValue({ state: 'BLOCKED', output: null });

    await worker.processarUma(store.get('fp')!);

    expect(agentix.resolverHitl).toHaveBeenCalledTimes(MAX_RESOLUCOES_HITL);
    expect(store.get('fp')!.estado).toBe('erro_geracao');
    expect(store.get('fp')!.motivo).toBe('sessão BLOCKED');
    store.close();
  });
});

describe('PropostaWorker.rodarCiclo', () => {
  it('processa o lote e segue mesmo quando uma linha lança (resiliência)', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp-ok', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    store.criarGerando({ fingerprint: 'fp-bad', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    ms8.lerArquivoRepo.mockResolvedValue({ path: 'x', existe: false, conteudo: '' });
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    // força a 2ª linha (fp-bad) a lançar: sessao rejeita na 2ª chamada
    let chamada = 0;
    agentix.sessao.mockImplementation(() => {
      chamada += 1;
      if (chamada === 2) {
        return Promise.reject(new Error('agentix indisponível'));
      }
      return Promise.resolve({
        state: 'DONE',
        result: JSON.stringify({
          resumo: 'r',
          titulo: 't',
          corpo: 'c',
          arquivos: [{ path: 'novo.txt', conteudo_novo: 'x' }],
        }),
      });
    });

    await expect(worker.rodarCiclo()).resolves.toBeUndefined();

    // a linha que lançou permanece em 'gerando' (não foi atualizada); a outra concluiu
    const estados = [store.get('fp-ok')!.estado, store.get('fp-bad')!.estado].sort();
    expect(estados).toEqual(['gerando', 'pronta']);
    expect(worker.intervaloAtual).toBe(Math.min(cfg.propostaIntervalo * 2, BACKOFF_TETO));
    store.close();
  });

  it('ciclo sem falhas restaura o intervalo base', async () => {
    const { worker, store, ms8, agentix } = makeWorker();
    store.criarGerando({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    ms8.lerArquivoRepo.mockResolvedValue({ path: 'x', existe: false, conteudo: '' });
    agentix.invocarComEntidade.mockResolvedValue('sess-1');
    agentix.sessao.mockResolvedValue({
      state: 'DONE',
      result: JSON.stringify({ resumo: 'r', titulo: 't', corpo: 'c', arquivos: [{ path: 'novo.txt', conteudo_novo: 'x' }] }),
    });
    worker.intervaloAtual = 999;

    await worker.rodarCiclo();

    expect(worker.intervaloAtual).toBe(cfg.propostaIntervalo);
    store.close();
  });

  it('listagem indisponível (store lança) aciona backoff e não derruba o ciclo', async () => {
    const { worker, store } = makeWorker();
    jest.spyOn(store, 'listByEstado').mockImplementation(() => {
      throw new Error('db indisponível');
    });

    await expect(worker.rodarCiclo()).resolves.toBeUndefined();
    expect(worker.intervaloAtual).toBe(Math.min(cfg.propostaIntervalo * 2, BACKOFF_TETO));
    store.close();
  });

  it('lote vazio: não chama nada e mantém o intervalo base', async () => {
    const { worker, store } = makeWorker();
    await worker.rodarCiclo();
    expect(worker.intervaloAtual).toBe(cfg.propostaIntervalo);
    store.close();
  });
});

describe('PropostaWorker loop e ciclo de vida', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('bootstrap agenda o loop (1º delay = intervalo base) e reagenda a cada ciclo', async () => {
    jest.useFakeTimers();
    const { worker } = makeWorker();
    const rodar = jest.spyOn(worker, 'rodarCiclo').mockResolvedValue(undefined);

    worker.onApplicationBootstrap();
    expect(rodar).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(cfg.propostaIntervalo * 1000);
    expect(rodar).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(cfg.propostaIntervalo * 1000);
    expect(rodar).toHaveBeenCalledTimes(2);

    worker.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(cfg.propostaIntervalo * 2000);
    expect(rodar).toHaveBeenCalledTimes(2);
  });

  it('não agenda quando o Agentix está desabilitado', async () => {
    jest.useFakeTimers();
    const store = new PropostaStore(':memory:');
    const ms8 = { lerArquivoRepo: jest.fn() };
    const agentix = { enabled: false, invocarComEntidade: jest.fn(), sessao: jest.fn() };
    const worker = new PropostaWorker(store, ms8 as any, agentix as any, cfg);
    const rodar = jest.spyOn(worker, 'rodarCiclo').mockResolvedValue(undefined);

    expect(worker.enabled).toBe(false);
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(cfg.propostaIntervalo * 2000);
    expect(rodar).not.toHaveBeenCalled();
    store.close();
  });

  it('erro inesperado no ciclo é logado e não derruba o loop (reagenda)', async () => {
    jest.useFakeTimers();
    const { worker } = makeWorker();
    const rodar = jest.spyOn(worker, 'rodarCiclo').mockRejectedValue(new Error('inesperado'));

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(cfg.propostaIntervalo * 1000);
    expect(rodar).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(cfg.propostaIntervalo * 1000);
    expect(rodar).toHaveBeenCalledTimes(2);

    worker.onApplicationShutdown();
  });

  it('tick não roda o ciclo se já parado', async () => {
    const { worker } = makeWorker();
    const rodar = jest.spyOn(worker, 'rodarCiclo').mockResolvedValue(undefined);
    (worker as unknown as { parado: boolean }).parado = true;

    await (worker as unknown as { tick: () => Promise<void> }).tick();
    expect(rodar).not.toHaveBeenCalled();
  });

  it('tick não reagenda se ficou parado durante o ciclo', async () => {
    const { worker } = makeWorker();
    jest.spyOn(worker, 'rodarCiclo').mockImplementation(async () => {
      (worker as unknown as { parado: boolean }).parado = true;
    });

    await (worker as unknown as { tick: () => Promise<void> }).tick();
    expect((worker as unknown as { timer: unknown }).timer).toBeNull();
  });

  it('agendarProximo é no-op quando parado (guarda defensiva)', () => {
    const { worker } = makeWorker();
    (worker as unknown as { parado: boolean }).parado = true;
    (worker as unknown as { agendarProximo: () => void }).agendarProximo();
    expect((worker as unknown as { timer: unknown }).timer).toBeNull();
  });

  it('sleep resolve normalmente quando o timer dispara', async () => {
    jest.useFakeTimers();
    const worker = makeWorkerRealSleep();
    const p = worker.sleep(3);
    await jest.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toBeUndefined();
  });

  it('shutdown cancela e resolve os sleeps pendentes (polling)', async () => {
    jest.useFakeTimers();
    const worker = makeWorkerRealSleep();
    const p = worker.sleep(3);
    worker.onApplicationShutdown();
    await expect(p).resolves.toBeUndefined();
  });

  it('sleep resolve de imediato se já parado', async () => {
    const worker = makeWorkerRealSleep();
    (worker as unknown as { parado: boolean }).parado = true;
    await expect(worker.sleep(3)).resolves.toBeUndefined();
  });
});

// worker com sleep REAL (sem spy) para exercitar o método sleep e o shutdown
function makeWorkerRealSleep(): PropostaWorker {
  const store = new PropostaStore(':memory:');
  const ms8 = { lerArquivoRepo: jest.fn() };
  const agentix = { enabled: true, invocarComEntidade: jest.fn(), sessao: jest.fn() };
  return new PropostaWorker(store, ms8 as any, agentix as any, cfg);
}
