import { AgentixService } from '../src/agentix/agentix.service';
import { AgentixTokenProvider } from '../src/agentix/agentix-token.provider';

const cfg = (o: any = {}) => ({
  requestTimeout: 10, agentixUrl: 'http://sim', agentixTenantId: 't',
  agentixBundleName: 'b', agentixBundleVersion: '1',
  agentixEntityName: 'dvop-diagnostico', agentixEntityVersion: '1.0.0', agentixEntityType: 'workflow',
  ...o,
} as any);
// mock leve: AgentixService só usa configurado/token(); a lógica de login tem spec própria
// (agentix-token.spec.ts). Evita que cada teste aqui precise mockar fetch de login.
const tok = () => ({ configurado: true, token: async () => 'S' } as unknown as AgentixTokenProvider);

// helper de teste: injeta postJson/getJson (protected na UpstreamClient) sem precisar
// mockar fetch/Response — testa só o contrato REST v2 do AgentixService.
function novoService(mocks: { postJson?: jest.Mock; getJson?: jest.Mock } = {}, cfgOverrides: any = {}): AgentixService {
  const svc = new AgentixService(cfg(cfgOverrides), tok());
  if (mocks.postJson) (svc as any).postJson = mocks.postJson;
  if (mocks.getJson) (svc as any).getJson = mocks.getJson;
  return svc;
}

describe('AgentixService', () => {
  it('enabled não exige mais entityId (só url/token/tenant/bundleVersion)', () => {
    expect(new AgentixService(cfg(), tok()).enabled).toBe(true);
    expect(new AgentixService(cfg({ agentixUrl: '' }), tok()).enabled).toBe(false);
    expect(new AgentixService(cfg({ agentixTenantId: '' }), tok()).enabled).toBe(false);
    expect(new AgentixService(cfg({ agentixBundleVersion: '' }), tok()).enabled).toBe(false);
  });

  it('invoca via /sessions/invoke e devolve session_id', async () => {
    const post = jest.fn().mockResolvedValue({ session_id: 's1', status: 'CREATED', component: 'diagnostico' });
    const svc = novoService({ postJson: post });
    const id = await svc.invocar('erro X');
    expect(id).toBe('s1');
    const [url, body, opts] = post.mock.calls[0];
    expect(url).toBe('http://sim/sessions/invoke');
    expect(body).toEqual({
      entity_type: 'workflow', entity_name: 'dvop-diagnostico', entity_version: '1.0.0',
      bundle: 'b', payload: { input: 'erro X' }, constants: {},
    });
    expect(opts.headers['x-api-key']).toBe('S');
    expect(opts.headers['x-tenant-id']).toBe('t');
  });

  it('invocar aceita opcoes.entityName sobrepondo o entity_name do config', async () => {
    const post = jest.fn().mockResolvedValue({ session_id: 's2' });
    const svc = novoService({ postJson: post });
    await svc.invocar('erro Y', { entityName: 'triagem-group' });
    expect(post.mock.calls[0][1].entity_name).toBe('triagem-group');
  });

  it('invocar ignora opcoes.payloadKey/entityId (não existem mais no contrato v2)', async () => {
    const post = jest.fn().mockResolvedValue({ session_id: 's3' });
    const svc = novoService({ postJson: post });
    await svc.invocar('erro Z', { payloadKey: 'mensagem', entityId: 'e1' });
    expect(post.mock.calls[0][1].payload).toEqual({ input: 'erro Z' });
  });

  it('invocar sem session_id na resposta → 502', async () => {
    const post = jest.fn().mockResolvedValue({});
    const svc = novoService({ postJson: post });
    await expect(svc.invocar('erro X')).rejects.toMatchObject({ statusCode: 502 });
  });

  it('sessao faz GET /sessions/{id} e mapeia status/output para state/result', async () => {
    const get = jest.fn().mockResolvedValue({ status: 'DONE', output: '{"resultado":"x"}', component: 'diagnostico' });
    const svc = novoService({ getJson: get });
    expect(await svc.sessao('s1')).toEqual({ state: 'DONE', result: '{"resultado":"x"}' });
    const [url, opts] = get.mock.calls[0];
    expect(url).toBe('http://sim/sessions/s1');
    expect(opts.headers['x-api-key']).toBe('S');
    expect(opts.headers['x-tenant-id']).toBe('t');
  });

  it('logs sintetiza [{author,log}] a partir do detalhe da sessão', async () => {
    const get = jest.fn().mockResolvedValue({ status: 'DONE', output: 'saida', component: 'diagnostico' });
    const svc = novoService({ getJson: get });
    expect(await svc.logs('s1')).toEqual([{ author: 'diagnostico', log: 'saida' }]);
  });

  it('logs usa "agente" quando component ausente e "" quando output ausente', async () => {
    const get = jest.fn().mockResolvedValue({ status: 'CREATED' });
    const svc = novoService({ getJson: get });
    expect(await svc.logs('s1')).toEqual([{ author: 'agente', log: '' }]);
  });

  it('decodifica result JSON e base64', () => {
    const s = new AgentixService(cfg(), tok());
    expect(s.decodificarResultado('{"a":1}')).toEqual({ a: 1 });
    expect(s.decodificarResultado(Buffer.from('{"b":2}').toString('base64'))).toEqual({ b: 2 });
    expect(s.decodificarResultado('lixo')).toBeNull();
  });

  it('decodificarResultado com valor vazio/nulo devolve null', () => {
    const s = new AgentixService(cfg(), tok());
    expect(s.decodificarResultado(null)).toBeNull();
    expect(s.decodificarResultado(undefined)).toBeNull();
    expect(s.decodificarResultado('')).toBeNull();
  });
});

describe('AgentixService.invocarCurador', () => {
  it('mapeia os pares para constants, usa o 1º par como input e invoca o entity do curador', async () => {
    const post = jest.fn().mockResolvedValue({ session_id: 'sc1' });
    const svc = novoService({ postJson: post }, { agentixCuradorEntityName: 'curador' });
    const id = await svc.invocarCurador([
      { key: 'erro', value: 'sig-1' },
      { key: 'assinatura', value: 'sig-1' },
      { key: 'contexto', value: 'CTX' },
    ]);
    expect(id).toBe('sc1');
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('http://sim/sessions/invoke');
    expect(body.entity_name).toBe('curador');
    expect(body.entity_type).toBe('workflow');
    expect(body.bundle).toBe('b');
    expect(body.payload).toEqual({ input: 'sig-1' });
    expect(body.constants).toEqual({ erro: 'sig-1', assinatura: 'sig-1', contexto: 'CTX' });
  });
  it('sem session_id na resposta → 502', async () => {
    const post = jest.fn().mockResolvedValue({});
    const svc = novoService({ postJson: post }, { agentixCuradorEntityName: 'curador' });
    await expect(svc.invocarCurador([{ key: 'erro', value: 'x' }])).rejects.toMatchObject({ statusCode: 502 });
  });
});
