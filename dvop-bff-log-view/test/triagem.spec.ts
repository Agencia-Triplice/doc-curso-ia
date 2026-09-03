import { TriagemService, validarTriagem, TETO_LINKS_ERRO } from '../src/agentix/triagem.service';
import { AgentixService } from '../src/agentix/agentix.service';
import { AppConfig } from '../src/config/env';

const RUN = 'https://github.com/o/r/actions/runs/1';
const RUN2 = 'https://github.com/o/r/actions/runs/2';
const RUN3 = 'https://github.com/o/r/actions/runs/3';
const RUN4 = 'https://github.com/o/r/actions/runs/4';
const PR = 'https://github.com/o/r/pull/9';
const MSG = `erros ${RUN} ${RUN2} ${RUN3} ${RUN4} e o ${PR}`;

const bruto = (extra: Partial<Record<string, unknown>> = {}) => ({
  intencao: 'diagnosticar',
  links: [{ url: RUN, papel: 'erro' }],
  erro_texto: '', contexto: 'ctx', ...extra,
});

describe('validarTriagem', () => {
  it('resposta válida passa', () => {
    expect(validarTriagem(bruto(), MSG)).toEqual({
      intencao: 'diagnosticar', links: [{ url: RUN, papel: 'erro' }], erro_texto: '', contexto: 'ctx',
    });
  });
  it.each([null, 'texto', [], { intencao: 'hackear', links: [] }, { intencao: 'diagnosticar' },
    { intencao: 'diagnosticar', links: 'x' }])('fora do schema → null (%#)', (b) => {
    expect(validarTriagem(b, MSG)).toBeNull();
  });
  it('link com papel inválido → null', () => {
    expect(validarTriagem(bruto({ links: [{ url: RUN, papel: 'outro' }] }), MSG)).toBeNull();
  });
  it('anti-injection: URL que não está na mensagem é descartada', () => {
    const t = validarTriagem(bruto({ links: [
      { url: 'https://mal.example/actions/runs/6/../..', papel: 'erro' },
      { url: RUN, papel: 'erro' },
    ] }), MSG)!;
    expect(t.links).toEqual([{ url: RUN, papel: 'erro' }]);
  });
  it('anti-injection: URL que é prefixo estrito de outra URL da mensagem é descartada (token match, não substring)', () => {
    const t = validarTriagem(bruto({ links: [{ url: RUN, papel: 'erro' }] }), `${RUN}extra`)!;
    expect(t.links).toEqual([]);
  });
  it('links duplicados (mesma URL) são deduplicados antes do teto', () => {
    const t = validarTriagem(bruto({ links: [RUN, RUN, RUN].map((url) => ({ url, papel: 'erro' })) }), MSG)!;
    expect(t.links).toEqual([{ url: RUN, papel: 'erro' }]);
  });
  it('papel erro em link que não é de Actions vira referencia', () => {
    const t = validarTriagem(bruto({ links: [{ url: PR, papel: 'erro' }] }), MSG)!;
    expect(t.links).toEqual([{ url: PR, papel: 'referencia' }]);
  });
  it(`teto de ${TETO_LINKS_ERRO} erros: excedente vira referencia`, () => {
    const t = validarTriagem(bruto({ links: [RUN, RUN2, RUN3, RUN4].map((url) => ({ url, papel: 'erro' })) }), MSG)!;
    expect(t.links.filter((l) => l.papel === 'erro').map((l) => l.url)).toEqual([RUN, RUN2, RUN3]);
    expect(t.links[3]).toEqual({ url: RUN4, papel: 'referencia' });
  });
  it('erro_texto/contexto não-string viram vazio', () => {
    const t = validarTriagem(bruto({ erro_texto: 7, contexto: null }), MSG)!;
    expect(t.erro_texto).toBe(''); expect(t.contexto).toBe('');
  });
});

describe('TriagemService', () => {
  const cfg = { agentixTriagemEntityId: 't1', agentixTriagemEntityName: 'triagem-group' } as AppConfig;
  const agentixMock = () => ({
    enabled: true,
    invocar: jest.fn().mockResolvedValue('s1'),
    sessao: jest.fn(),
    decodificarResultado: AgentixService.prototype.decodificarResultado,
  });

  function servico(agentix: any, c: AppConfig = cfg): TriagemService {
    const s = new TriagemService(agentix, c);
    s.pollMs = 1; s.timeoutMs = 200;
    return s;
  }

  it('enabled=false sem LOG_BFF_AGENTIX_TRIAGEM_ENTITY_NAME', () => {
    expect(servico(agentixMock(), { ...cfg, agentixTriagemEntityName: '' } as AppConfig).enabled).toBe(false);
  });
  it('enabled independe de LOG_BFF_AGENTIX_TRIAGEM_ENTITY_ID (dead em v2): entityId vazio não desliga', () => {
    expect(servico(agentixMock(), { ...cfg, agentixTriagemEntityId: '' } as AppConfig).enabled).toBe(true);
  });
  it('enabled=false quando o Agentix base está desligado', () => {
    expect(servico({ ...agentixMock(), enabled: false }).enabled).toBe(false);
  });
  it('triar: Invoke com key mensagem + entity da triagem; RUNNING→DONE devolve validado', async () => {
    const ax = agentixMock();
    ax.sessao
      .mockResolvedValueOnce({ state: 'RUNNING' })
      .mockResolvedValueOnce({ state: 'DONE', result: JSON.stringify(bruto()) });
    const t = await servico(ax).triar(MSG);
    expect(ax.invocar).toHaveBeenCalledWith(MSG, { payloadKey: 'mensagem', entityId: 't1', entityName: 'triagem-group' });
    expect(t!.intencao).toBe('diagnosticar');
  });
  it('triar: FAILED → null', async () => {
    const ax = agentixMock();
    ax.sessao.mockResolvedValue({ state: 'FAILED' });
    expect(await servico(ax).triar(MSG)).toBeNull();
  });
  it('triar: timeout sempre RUNNING → null', async () => {
    const ax = agentixMock();
    ax.sessao.mockResolvedValue({ state: 'RUNNING' });
    expect(await servico(ax).triar(MSG)).toBeNull();
  });
  it('triar: invocar lança → null (fallback, nunca propaga)', async () => {
    const ax = agentixMock();
    ax.invocar.mockRejectedValue(new Error('rede'));
    expect(await servico(ax).triar(MSG)).toBeNull();
  });
  it('triar: DONE com texto não-JSON → null', async () => {
    const ax = agentixMock();
    ax.sessao.mockResolvedValue({ state: 'DONE', result: 'Problema: blá' });
    expect(await servico(ax).triar(MSG)).toBeNull();
  });
  it('triar: desligado → null sem chamar o Agentix', async () => {
    const ax = agentixMock();
    const s = servico(ax, { ...cfg, agentixTriagemEntityName: '' } as AppConfig);
    expect(await s.triar(MSG)).toBeNull();
    expect(ax.invocar).not.toHaveBeenCalled();
  });
});
