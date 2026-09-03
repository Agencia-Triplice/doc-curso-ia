import {
  CuradorWorker,
  ResumoCiclo,
  formatarContexto,
  decodificarRascunho,
  montarRascunho,
  b64OuNull,
  AUTOR_IA,
  MAX_SOLUCAO_CHARS,
} from '../src/curador/curador.worker';
import { UpstreamError } from '../src/common/upstream-error';
import { CuradoriaConfig, loadConfig } from '../src/config/env';
import { CacheWriterService } from '../src/upstreams/cache-writer.service';
import { RetrievalService } from '../src/upstreams/retrieval.service';
import { AgentixService } from '../src/agentix/agentix.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { PromptStore } from '../src/curador/prompt-store.service';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const baseCfg = (o: Partial<CuradoriaConfig> = {}): CuradoriaConfig => ({
  ...loadConfig({}),
  curadorIntervalo: 60,
  curadorLote: 2,
  curadorMaxTentativas: 3,
  ...o,
});

interface MockMs5 {
  listarOrfaos: jest.Mock;
  salvarRascunho: jest.Mock;
  salvarPrompt: jest.Mock;
}
interface MockMs3 {
  enabled: boolean;
  buscar: jest.Mock;
}
interface MockAgentix {
  enabled: boolean;
  invocar: jest.Mock;
  sessao: jest.Mock;
}
interface MockMetrics {
  curadorRascunho: jest.Mock;
  curadorCiclo: jest.Mock;
}

function makeWorker(
  opts: { ms3Enabled?: boolean; agentixEnabled?: boolean; cfg?: Partial<CuradoriaConfig> } = {},
): {
  worker: CuradorWorker;
  ms5: MockMs5;
  ms3: MockMs3;
  agentix: MockAgentix;
  metrics: MockMetrics;
  prompts: PromptStore;
} {
  const ms5: MockMs5 = {
    listarOrfaos: jest.fn(),
    salvarRascunho: jest.fn(),
    salvarPrompt: jest.fn().mockResolvedValue({}),
  };
  const ms3: MockMs3 = { enabled: opts.ms3Enabled ?? false, buscar: jest.fn() };
  const agentix: MockAgentix = {
    enabled: opts.agentixEnabled ?? true,
    invocar: jest.fn(),
    sessao: jest.fn(),
  };
  const metrics: MockMetrics = { curadorRascunho: jest.fn(), curadorCiclo: jest.fn() };
  const prompts = new PromptStore(':memory:');
  const worker = new CuradorWorker(
    ms5 as unknown as CacheWriterService,
    ms3 as unknown as RetrievalService,
    agentix as unknown as AgentixService,
    metrics as unknown as MetricsService,
    prompts,
    baseCfg(opts.cfg),
  );
  // o polling da sessão não deve esperar de verdade nos testes
  jest.spyOn(worker as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue(undefined);
  return { worker, ms5, ms3, agentix, metrics, prompts };
}

const orfao = (o: Record<string, unknown> = {}): Record<string, any> => ({
  fingerprint: 'fp1',
  assinatura: 'sig-1',
  servico: 'svc',
  nivel: 'ERROR',
  tem_rascunho: false,
  primeiro_visto: '2024-01-01T00:00:00Z',
  ...o,
});

const sessaoDone = (dados: unknown) => ({ state: 'DONE', result: JSON.stringify(dados) });

// silencia o logJson (escreve JSON no stdout) para não poluir a saída de teste
beforeEach(() => {
  jest.spyOn(process.stdout, 'write').mockReturnValue(true);
});
afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// funções puras
// ---------------------------------------------------------------------------

describe('funções puras', () => {
  describe('formatarContexto', () => {
    it('lista vazia/ausente → placeholder', () => {
      expect(formatarContexto([])).toBe('(nenhum documento encontrado)');
      expect(formatarContexto(undefined as unknown as [])).toBe('(nenhum documento encontrado)');
    });

    it('doc sem título/conteúdo/confiança usa defaults (sem título, vazio, 0.00)', () => {
      expect(formatarContexto([{}])).toBe('1. sem título (confiança 0.00)\n');
    });

    it('trunca conteúdo acima de 1200 chars com sufixo " [...]"', () => {
      const conteudo = 'a'.repeat(1300);
      const out = formatarContexto([{ titulo: 'T', conteudo, confianca: 0.5 }]);
      expect(out).toBe(`1. T (confiança 0.50)\n${'a'.repeat(1200)} [...]`);
    });

    it('formata até 3 docs (1-indexado) e ignora o 4º, junção "\\n\\n"', () => {
      const docs = [
        { titulo: 'A', conteudo: 'ca', confianca: 0.9 },
        { titulo: 'B', conteudo: 'cb', confianca: 0.8 },
        { titulo: 'C', conteudo: 'cc', confianca: 0.7 },
        { titulo: 'D', conteudo: 'cd', confianca: 0.6 },
      ];
      expect(formatarContexto(docs)).toBe(
        '1. A (confiança 0.90)\nca\n\n2. B (confiança 0.80)\ncb\n\n3. C (confiança 0.70)\ncc',
      );
    });

    it('confianca 0/null vira 0.00 (via `|| 0`)', () => {
      expect(formatarContexto([{ titulo: 'X', conteudo: 'y', confianca: null }])).toBe(
        '1. X (confiança 0.00)\ny',
      );
    });
  });

  describe('b64OuNull', () => {
    it('base64 canônico de utf-8 → texto decodificado', () => {
      const b64 = Buffer.from('olá mundo', 'utf-8').toString('base64');
      expect(b64OuNull(b64)).toBe('olá mundo');
    });

    it('base64 não-canônico (chars fora do alfabeto) → null', () => {
      expect(b64OuNull('{"solucao":"x"}')).toBeNull();
    });
  });

  describe('decodificarRascunho', () => {
    it('não-string → null', () => {
      expect(decodificarRascunho(123)).toBeNull();
      expect(decodificarRascunho(null)).toBeNull();
      expect(decodificarRascunho(undefined)).toBeNull();
    });

    it('string vazia/espaços → null', () => {
      expect(decodificarRascunho('   ')).toBeNull();
    });

    it('JSON direto com solucao não-vazia → objeto', () => {
      expect(decodificarRascunho('{"solucao":"faça X","confianca":"alta"}')).toEqual({
        solucao: 'faça X',
        confianca: 'alta',
      });
    });

    it('JSON em base64 → objeto (segunda convenção)', () => {
      const b64 = Buffer.from('{"solucao":"passo a passo"}', 'utf-8').toString('base64');
      expect(decodificarRascunho(b64)).toEqual({ solucao: 'passo a passo' });
    });

    it('dict sem solucao → null', () => {
      expect(decodificarRascunho('{"confianca":"alta"}')).toBeNull();
    });

    it('dict com solucao vazia/espaços → null', () => {
      expect(decodificarRascunho('{"solucao":"   "}')).toBeNull();
    });

    it('array (não-dict) → null', () => {
      expect(decodificarRascunho('[{"solucao":"x"}]')).toBeNull();
    });

    it('texto que não é JSON nem base64→JSON válido → null', () => {
      expect(decodificarRascunho('isto não é json')).toBeNull();
    });

    it('JSON embrulhado em cerca markdown ```json → objeto', () => {
      // o gpt-4o-mini responde o JSON dentro de uma cerca de código, mesmo o
      // prompt pedindo "SOMENTE o JSON"; a cerca não pode invalidar o rascunho
      const bruto = '```json\n{"solucao":"1. faça X\\n2. faça Y","confianca":"media","fontes":["Doc A"]}\n```';
      expect(decodificarRascunho(bruto)).toEqual({
        solucao: '1. faça X\n2. faça Y',
        confianca: 'media',
        fontes: ['Doc A'],
      });
    });

    it('cerca ``` sem linguagem também é aceita', () => {
      const bruto = '```\n{"solucao":"passo único"}\n```';
      expect(decodificarRascunho(bruto)).toEqual({ solucao: 'passo único' });
    });

    it('array dentro de cerca → null (cerca não afrouxa o contrato de dict)', () => {
      expect(decodificarRascunho('```json\n[{"solucao":"x"}]\n```')).toBeNull();
    });
  });

  describe('montarRascunho', () => {
    it('sem fontes → solução + rodapé de confiança', () => {
      expect(montarRascunho({ solucao: '  faça X  ', confianca: 'alta' })).toBe(
        'faça X\n\n---\nConfiança: alta',
      );
    });

    it('com fontes → rodapé inclui as fontes (filtra vazias, aplica String)', () => {
      expect(
        montarRascunho({ solucao: 'X', confianca: 'média', fontes: ['a', '  ', 'b', 42] }),
      ).toBe('X\n\n---\nConfiança: média — Fontes: a, b, 42');
    });

    it('confianca ausente/falsy → "desconhecida"', () => {
      expect(montarRascunho({ solucao: 'X' })).toBe('X\n\n---\nConfiança: desconhecida');
    });

    it('trunca ao teto de 20000 chars', () => {
      const out = montarRascunho({ solucao: 'a'.repeat(25000), confianca: 'alta' });
      expect(out.length).toBe(MAX_SOLUCAO_CHARS);
      expect(out).toBe('a'.repeat(25000).slice(0, MAX_SOLUCAO_CHARS));
    });
  });
});

// ---------------------------------------------------------------------------
// rodarCiclo / processar (casos a-i)
// ---------------------------------------------------------------------------

describe('CuradorWorker.rodarCiclo', () => {
  it('(a) ciclo ok → salvarRascunho com autor IA + métricas gerado/ok + payload correto', async () => {
    const { worker, ms5, agentix, metrics, prompts } = makeWorker();
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockResolvedValue('sess1');
    agentix.sessao.mockResolvedValue(
      sessaoDone({ solucao: 'faça X', confianca: 'alta', fontes: ['runbook'] }),
    );
    ms5.salvarRascunho.mockResolvedValue({});

    const r: ResumoCiclo = await worker.rodarCiclo();

    expect(r).toEqual({ selecionados: 1, gerados: 1, falhas: 0, descartados: 0 });
    expect(ms5.salvarRascunho).toHaveBeenCalledWith(
      'fp1',
      montarRascunho({ solucao: 'faça X', confianca: 'alta', fontes: ['runbook'] }),
      AUTOR_IA,
    );
    expect(ms5.salvarRascunho).toHaveBeenCalledWith('fp1', expect.any(String), 'IA (Agentix)');
    expect(metrics.curadorRascunho).toHaveBeenCalledWith('gerado');
    expect(metrics.curadorCiclo).toHaveBeenCalledWith('ok');
    // payload: erro E assinatura usam a assinatura; contexto = placeholder (MS3 off);
    // sem template no órfão → persona cai no fallback SRE e dossiê fica vazio
    expect(agentix.invocar).toHaveBeenCalledWith([
      { key: 'erro', value: 'sig-1' },
      { key: 'assinatura', value: 'sig-1' },
      { key: 'servico', value: 'svc' },
      { key: 'nivel', value: 'ERROR' },
      { key: 'contexto', value: '(nenhum documento encontrado)' },
      { key: 'persona', value: 'SRE sênior' },
      { key: 'dossie_template', value: '' },
      { key: 'workflow', value: '' },
      { key: 'job', value: '' },
      { key: 'step_cmd', value: '' },
      { key: 'exit_code', value: '' },
    ]);
    // o prompt REALMENTE enviado fica registrado (mesmos pares) para a tela ler
    const registrado = prompts.get('fp1');
    expect(registrado?.pares).toEqual(agentix.invocar.mock.calls[0][0]);
    expect(registrado?.registrado_em).toEqual(expect.any(String));
    // e é publicado no MS 5 (store compartilhada) com os MESMOS pares → o cockpit
    // reexibe o prompt idêntico ao da curadoria
    expect(ms5.salvarPrompt).toHaveBeenCalledWith('fp1', agentix.invocar.mock.calls[0][0]);
  });

  it('(a2) MS3 habilitado → contexto formatado entra no payload e buscar SEM fingerprint', async () => {
    const { worker, ms5, ms3, agentix } = makeWorker({ ms3Enabled: true });
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    ms3.buscar.mockResolvedValue({
      resultados: [{ titulo: 'Doc', conteudo: 'passo a passo', confianca: 0.9 }],
    });
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue(sessaoDone({ solucao: 'x' }));
    ms5.salvarRascunho.mockResolvedValue({});

    await worker.rodarCiclo();

    expect(ms3.buscar).toHaveBeenCalledWith('sig-1', 'svc', 'ERROR');
    const payload = agentix.invocar.mock.calls[0][0] as Array<{ key: string; value: string }>;
    const contexto = payload.find((p) => p.key === 'contexto')!.value;
    expect(contexto).toBe('1. Doc (confiança 0.90)\npasso a passo');
  });

  it('(b) MS5 lança UpstreamError → curadorCiclo(erro_infra), nada processado', async () => {
    const { worker, ms5, agentix, metrics } = makeWorker();
    ms5.listarOrfaos.mockRejectedValue(new UpstreamError(503, 'fila fora'));

    const r = await worker.rodarCiclo();

    expect(r).toEqual({ selecionados: 0, gerados: 0, falhas: 0, descartados: 0 });
    expect(metrics.curadorCiclo).toHaveBeenCalledWith('erro_infra');
    expect(metrics.curadorCiclo).not.toHaveBeenCalledWith('ok');
    expect(agentix.invocar).not.toHaveBeenCalled();
  });

  it('(c) pula órfão com tem_rascunho e órfão com tentativas esgotadas', async () => {
    const { worker, ms5, agentix, metrics } = makeWorker();
    ms5.listarOrfaos.mockResolvedValue([
      orfao({ fingerprint: 'fp1', tem_rascunho: true }),
      orfao({ fingerprint: 'fp2', tem_rascunho: false }),
    ]);
    // fp2 já esgotou as tentativas (presente na fila → não é podado)
    (worker as unknown as { tentativas: Map<string, number> }).tentativas = new Map([['fp2', 3]]);

    const r = await worker.rodarCiclo();

    expect(r).toEqual({ selecionados: 0, gerados: 0, falhas: 0, descartados: 0 });
    expect(agentix.invocar).not.toHaveBeenCalled();
    expect(metrics.curadorCiclo).toHaveBeenCalledWith('ok');
  });

  it('respeita o lote: com lote=1 processa só 1 dos 2 órfãos', async () => {
    const { worker, ms5, agentix } = makeWorker({ cfg: { curadorLote: 1 } });
    ms5.listarOrfaos.mockResolvedValue([
      orfao({ fingerprint: 'fpA', primeiro_visto: '2024-01-01' }),
      orfao({ fingerprint: 'fpB', primeiro_visto: '2024-01-02' }),
    ]);
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue(sessaoDone({ solucao: 'x' }));
    ms5.salvarRascunho.mockResolvedValue({});

    const r = await worker.rodarCiclo();

    expect(r.selecionados).toBe(1);
    expect(agentix.invocar).toHaveBeenCalledTimes(1);
  });

  it('ordena por primeiro_visto asc, com null/ausente ao fim (estável)', async () => {
    const { worker, ms5, agentix } = makeWorker({ cfg: { curadorLote: 5 } });
    ms5.listarOrfaos.mockResolvedValue([
      orfao({ fingerprint: 'semData', primeiro_visto: null }),
      orfao({ fingerprint: 'novo', primeiro_visto: '2024-03-01' }),
      orfao({ fingerprint: 'antigo', primeiro_visto: '2024-01-01' }),
    ]);
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue(sessaoDone({ solucao: 'x' }));
    ms5.salvarRascunho.mockResolvedValue({});

    await worker.rodarCiclo();

    // o payload não carrega o fingerprint; a ordem de processamento é observável
    // pela ordem das chamadas de salvarRascunho
    const fps = ms5.salvarRascunho.mock.calls.map((c) => c[0]);
    expect(fps).toEqual(['antigo', 'novo', 'semData']);
  });

  it('órfão sem servico/nivel e sessão/busca sem campos → usa defaults (desconhecido, [], estado vazio)', async () => {
    const { worker, ms5, ms3, agentix, metrics } = makeWorker({ ms3Enabled: true });
    ms5.listarOrfaos.mockResolvedValue([
      { fingerprint: 'sn', assinatura: 'sig', tem_rascunho: false, primeiro_visto: '2024-01-01' },
    ]);
    ms3.buscar.mockResolvedValue({}); // sem `resultados` → ?? []
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue({}); // sem `state` → estado vazio, não-DONE

    const r = await worker.rodarCiclo();

    // buscar recebe null quando servico/nivel ausentes (SEM fingerprint)
    expect(ms3.buscar).toHaveBeenCalledWith('sig', null, null);
    // payload usa 'desconhecido' para servico/nivel e placeholder de contexto;
    // sem template → persona cai no fallback SRE e dossiê fica vazio
    expect(agentix.invocar).toHaveBeenCalledWith([
      { key: 'erro', value: 'sig' },
      { key: 'assinatura', value: 'sig' },
      { key: 'servico', value: 'desconhecido' },
      { key: 'nivel', value: 'desconhecido' },
      { key: 'contexto', value: '(nenhum documento encontrado)' },
      { key: 'persona', value: 'SRE sênior' },
      { key: 'dossie_template', value: '' },
      { key: 'workflow', value: '' },
      { key: 'job', value: '' },
      { key: 'step_cmd', value: '' },
      { key: 'exit_code', value: '' },
    ]);
    // sessão sem state → não-DONE → falha
    expect(r.falhas).toBe(1);
    expect(metrics.curadorRascunho).toHaveBeenCalledWith('falhou');
  });

  it('MS3 lança erro inesperado (não-Upstream) em buscar → propaga', async () => {
    const { worker, ms5, ms3 } = makeWorker({ ms3Enabled: true });
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    ms3.buscar.mockRejectedValue(new Error('retrieval bug'));
    await expect(worker.rodarCiclo()).rejects.toThrow('retrieval bug');
  });

  it('ordenação com múltiplos primeiro_visto null (compara nulls entre si)', async () => {
    const { worker, ms5 } = makeWorker({ cfg: { curadorLote: 5 } });
    // todos com rascunho → só exercita o comparador (2 nulls + 1 presente)
    ms5.listarOrfaos.mockResolvedValue([
      orfao({ fingerprint: 'n1', primeiro_visto: null, tem_rascunho: true }),
      orfao({ fingerprint: 'n2', primeiro_visto: null, tem_rascunho: true }),
      orfao({ fingerprint: 'p1', primeiro_visto: '2024-01-01', tem_rascunho: true }),
    ]);
    const r = await worker.rodarCiclo();
    expect(r.selecionados).toBe(0); // todos pulados
  });

  it('(d) backoff: dobra após falha do Agentix e reseta após ciclo sem falha', async () => {
    const { worker, ms5, agentix, metrics } = makeWorker();
    // ciclo 1: Agentix falha
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockRejectedValueOnce(new UpstreamError(502, 'agentix fora'));

    const r1 = await worker.rodarCiclo();
    expect(r1.falhas).toBe(1);
    expect(worker.intervaloAtual).toBe(120); // 60*2
    expect(metrics.curadorRascunho).toHaveBeenCalledWith('falhou');

    // ciclo 2: sucesso → reseta para o intervalo base
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue(sessaoDone({ solucao: 'ok' }));
    ms5.salvarRascunho.mockResolvedValue({});

    const r2 = await worker.rodarCiclo();
    expect(r2.gerados).toBe(1);
    expect(worker.intervaloAtual).toBe(60);
  });

  it('(d2) backoff satura no teto de 600s', async () => {
    const { worker, ms5, agentix } = makeWorker({ cfg: { curadorIntervalo: 400 } });
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockRejectedValue(new UpstreamError(502, 'x'));

    await worker.rodarCiclo();
    expect(worker.intervaloAtual).toBe(600); // min(400*2, 600)
  });

  it('(e) resultado da sessão em base64 é decodificado e gera rascunho', async () => {
    const { worker, ms5, agentix } = makeWorker();
    const b64 = Buffer.from('{"solucao":"reinicie o pod"}', 'utf-8').toString('base64');
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue({ state: 'DONE', result: b64 });
    ms5.salvarRascunho.mockResolvedValue({});

    const r = await worker.rodarCiclo();

    expect(r.gerados).toBe(1);
    expect(ms5.salvarRascunho).toHaveBeenCalledWith(
      'fp1',
      montarRascunho({ solucao: 'reinicie o pod' }),
      AUTOR_IA,
    );
  });

  it('(f) polling: 60 estados RUNNING → sessão null → falha, sessao chamada 60x', async () => {
    const { worker, ms5, agentix, metrics } = makeWorker();
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue({ state: 'RUNNING' });

    const r = await worker.rodarCiclo();

    expect(agentix.sessao).toHaveBeenCalledTimes(60);
    expect(r.falhas).toBe(1);
    expect(metrics.curadorRascunho).toHaveBeenCalledWith('falhou');
  });

  it('sessão em estado não-DONE (ex.: FAILED) → falha com motivo do estado', async () => {
    const { worker, ms5, agentix, metrics } = makeWorker();
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue({ state: 'FAILED' });

    const r = await worker.rodarCiclo();

    expect(r.falhas).toBe(1);
    expect(metrics.curadorRascunho).toHaveBeenCalledWith('falhou');
  });

  it('sessão DONE mas result inválido (não decodifica) → falha', async () => {
    const { worker, ms5, agentix, metrics } = makeWorker();
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue({ state: 'DONE', result: 'lixo' });

    const r = await worker.rodarCiclo();

    expect(r.falhas).toBe(1);
    expect(metrics.curadorRascunho).toHaveBeenCalledWith('falhou');
    expect(ms5.salvarRascunho).not.toHaveBeenCalled();
  });

  it('polling retorna DONE após alguns RUNNING (sleep entre polls)', async () => {
    const { worker, ms5, agentix } = makeWorker();
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao
      .mockResolvedValueOnce({ state: 'CREATED' })
      .mockResolvedValueOnce({ state: 'PENDING' })
      .mockResolvedValueOnce(sessaoDone({ solucao: 'ok' }));
    ms5.salvarRascunho.mockResolvedValue({});

    const r = await worker.rodarCiclo();

    expect(agentix.sessao).toHaveBeenCalledTimes(3);
    expect(r.gerados).toBe(1);
  });

  it('(g) reconciliação: órfão ausente da fila é podado do Map de tentativas', async () => {
    const { worker, ms5 } = makeWorker();
    (worker as unknown as { tentativas: Map<string, number> }).tentativas = new Map([
      ['gone', 1],
      ['fp1', 1],
    ]);
    // fila só tem fp1 (com rascunho → não processa); 'gone' saiu por outra via
    ms5.listarOrfaos.mockResolvedValue([orfao({ fingerprint: 'fp1', tem_rascunho: true })]);

    await worker.rodarCiclo();

    const t = (worker as unknown as { tentativas: Map<string, number> }).tentativas;
    expect(t.has('gone')).toBe(false);
    expect(t.has('fp1')).toBe(true);
  });

  it('(h) 404 no salvarRascunho → descartado', async () => {
    const { worker, ms5, agentix, metrics } = makeWorker();
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue(sessaoDone({ solucao: 'x' }));
    ms5.salvarRascunho.mockRejectedValue(new UpstreamError(404, 'sumiu'));

    const r = await worker.rodarCiclo();

    expect(r).toEqual({ selecionados: 1, gerados: 0, falhas: 0, descartados: 1 });
    expect(metrics.curadorRascunho).toHaveBeenCalledWith('descartado');
  });

  it('salvarRascunho com UpstreamError não-404 (ex.: 500) → conta como falha (backoff)', async () => {
    const { worker, ms5, agentix, metrics } = makeWorker();
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockResolvedValue('s');
    agentix.sessao.mockResolvedValue(sessaoDone({ solucao: 'x' }));
    ms5.salvarRascunho.mockRejectedValue(new UpstreamError(500, 'erro interno'));

    const r = await worker.rodarCiclo();

    expect(r.falhas).toBe(1);
    expect(metrics.curadorRascunho).toHaveBeenCalledWith('falhou');
    expect(worker.intervaloAtual).toBe(120); // falha de infra do PUT também aciona backoff
  });

  it('MS3 fora (UpstreamError em buscar) → órfão adiado sem contar tentativa', async () => {
    const { worker, ms5, ms3, agentix, metrics } = makeWorker({ ms3Enabled: true });
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    ms3.buscar.mockRejectedValue(new UpstreamError(503, 'retrieval fora'));

    const r = await worker.rodarCiclo();

    expect(r).toEqual({ selecionados: 1, gerados: 0, falhas: 0, descartados: 0 });
    expect(agentix.invocar).not.toHaveBeenCalled();
    expect(metrics.curadorRascunho).not.toHaveBeenCalled();
    expect(worker.intervaloAtual).toBe(60); // MS3 fora NÃO aciona o backoff do Agentix
    // não contou tentativa
    expect((worker as unknown as { tentativas: Map<string, number> }).tentativas.size).toBe(0);
  });

  it('propaga erro inesperado (não-Upstream) de listarOrfaos', async () => {
    const { worker, ms5 } = makeWorker();
    ms5.listarOrfaos.mockRejectedValue(new Error('boom'));
    await expect(worker.rodarCiclo()).rejects.toThrow('boom');
  });

  it('propaga erro inesperado (não-Upstream) vindo do processamento', async () => {
    const { worker, ms5, agentix } = makeWorker();
    ms5.listarOrfaos.mockResolvedValue([orfao()]);
    agentix.invocar.mockRejectedValue(new Error('erro estranho'));
    await expect(worker.rodarCiclo()).rejects.toThrow('erro estranho');
  });
});

// ---------------------------------------------------------------------------
// iaEstado (caso i)
// ---------------------------------------------------------------------------

describe('CuradorWorker.iaEstado', () => {
  it('(i) vira "falhou" só ao atingir maxTentativas', () => {
    const { worker } = makeWorker();
    expect(worker.iaEstado('fp1')).toBeNull(); // sem registro
    worker.registrarFalha('fp1', 'motivo');
    expect(worker.iaEstado('fp1')).toBeNull(); // 1 < 3
    worker.registrarFalha('fp1', 'motivo');
    expect(worker.iaEstado('fp1')).toBeNull(); // 2 < 3
    worker.registrarFalha('fp1', 'motivo');
    expect(worker.iaEstado('fp1')).toBe('falhou'); // 3 >= 3
  });
});

// ---------------------------------------------------------------------------
// ciclo de vida do loop / sleep cancelável
// ---------------------------------------------------------------------------

describe('CuradorWorker loop e ciclo de vida', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('bootstrap agenda o loop (1º delay = intervalo base) e reagenda a cada ciclo', async () => {
    jest.useFakeTimers();
    const { worker } = makeWorker({ agentixEnabled: true });
    const rodar = jest
      .spyOn(worker, 'rodarCiclo')
      .mockResolvedValue({ selecionados: 0, gerados: 0, falhas: 0, descartados: 0 });

    worker.onApplicationBootstrap();
    expect(rodar).not.toHaveBeenCalled(); // dorme antes do 1º ciclo

    await jest.advanceTimersByTimeAsync(60_000);
    expect(rodar).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(rodar).toHaveBeenCalledTimes(2);

    worker.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(rodar).toHaveBeenCalledTimes(2); // parou
  });

  it('não agenda quando o Agentix está desabilitado', async () => {
    jest.useFakeTimers();
    const { worker } = makeWorker({ agentixEnabled: false });
    const rodar = jest
      .spyOn(worker, 'rodarCiclo')
      .mockResolvedValue({ selecionados: 0, gerados: 0, falhas: 0, descartados: 0 });

    expect(worker.enabled).toBe(false);
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(rodar).not.toHaveBeenCalled();
  });

  it('erro inesperado no ciclo é logado e não derruba o loop (reagenda)', async () => {
    jest.useFakeTimers();
    const { worker } = makeWorker({ agentixEnabled: true });
    const rodar = jest.spyOn(worker, 'rodarCiclo').mockRejectedValue(new Error('inesperado'));

    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(rodar).toHaveBeenCalledTimes(1);
    // continua o loop mesmo após a exceção
    await jest.advanceTimersByTimeAsync(60_000);
    expect(rodar).toHaveBeenCalledTimes(2);

    worker.onApplicationShutdown();
  });

  it('tick não roda o ciclo se já parado', async () => {
    const { worker } = makeWorker({ agentixEnabled: true });
    const rodar = jest
      .spyOn(worker, 'rodarCiclo')
      .mockResolvedValue({ selecionados: 0, gerados: 0, falhas: 0, descartados: 0 });
    (worker as unknown as { parado: boolean }).parado = true;

    await (worker as unknown as { tick: () => Promise<void> }).tick();
    expect(rodar).not.toHaveBeenCalled();
  });

  it('tick não reagenda se ficou parado durante o ciclo', async () => {
    const { worker } = makeWorker({ agentixEnabled: true });
    jest.spyOn(worker, 'rodarCiclo').mockImplementation(async () => {
      (worker as unknown as { parado: boolean }).parado = true;
      return { selecionados: 0, gerados: 0, falhas: 0, descartados: 0 };
    });

    await (worker as unknown as { tick: () => Promise<void> }).tick();
    expect((worker as unknown as { timer: unknown }).timer).toBeNull();
  });

  it('agendarProximo é no-op quando parado (guarda defensiva)', () => {
    const { worker } = makeWorker({ agentixEnabled: true });
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
function makeWorkerRealSleep(): CuradorWorker {
  const ms5 = { listarOrfaos: jest.fn(), salvarRascunho: jest.fn(), salvarPrompt: jest.fn() };
  const ms3 = { enabled: false, buscar: jest.fn() };
  const agentix = { enabled: true, invocar: jest.fn(), sessao: jest.fn() };
  const metrics = { curadorRascunho: jest.fn(), curadorCiclo: jest.fn() };
  return new CuradorWorker(
    ms5 as unknown as CacheWriterService,
    ms3 as unknown as RetrievalService,
    agentix as unknown as AgentixService,
    metrics as unknown as MetricsService,
    new PromptStore(':memory:'),
    baseCfg(),
  );
}
