import { AgentixService } from '../src/agentix/agentix.service';
import { AgentixTokenProvider } from '../src/agentix/agentix-token.provider';
import { CuradoriaConfig, loadConfig } from '../src/config/env';

const cfg = (o: Partial<CuradoriaConfig> = {}): CuradoriaConfig => ({
  ...loadConfig({}),
  requestTimeout: 10,
  agentixUrl: 'http://sim',
  agentixTenantId: 't',
  agentixBundleName: 'dvop-agx-ssol-propor-solucao',
  agentixEntityName: 'dvop-curador',
  agentixEntityVersion: '1.0.0',
  agentixEntityType: 'workflow',
  ...o,
});

// fake que satisfaz a interface pública do provider sem bater rede: os testes
// daqui exercitam o AgentixService (invocar/sessao/headers), não a renovação de
// token — essa fica coberta em agentix-token.spec.ts.
const tok = () => ({ configurado: true, token: jest.fn().mockResolvedValue('S') } as unknown as AgentixTokenProvider);

// helper de teste: injeta postJson/getJson (protected na UpstreamClient) sem
// precisar mockar fetch/Response — testa só o contrato REST v2 do AgentixService.
function novoService(
  mocks: { postJson?: jest.Mock; getJson?: jest.Mock } = {},
  cfgOverrides: Partial<CuradoriaConfig> = {},
  provider: AgentixTokenProvider = tok(),
): AgentixService {
  const svc = new AgentixService(cfg(cfgOverrides), provider);
  if (mocks.postJson) (svc as any).postJson = mocks.postJson;
  if (mocks.getJson) (svc as any).getJson = mocks.getJson;
  return svc;
}

describe('AgentixService', () => {
  describe('enabled', () => {
    it('true com url + token provider configurado + tenant (sem exigir bundleVersion/entityId)', () => {
      expect(new AgentixService(cfg(), tok()).enabled).toBe(true);
    });
    it('false sem agentixUrl', () => {
      expect(new AgentixService(cfg({ agentixUrl: '' }), tok()).enabled).toBe(false);
    });
    it('false sem agentixTenantId', () => {
      expect(new AgentixService(cfg({ agentixTenantId: '' }), tok()).enabled).toBe(false);
    });
    it('false quando o token provider não está configurado', () => {
      const semToken = { configurado: false, token: jest.fn().mockResolvedValue('') } as unknown as AgentixTokenProvider;
      expect(new AgentixService(cfg(), semToken).enabled).toBe(false);
    });
  });

  describe('invocar', () => {
    it('invoca com os pares do curador como constants', async () => {
      const post = jest.fn().mockResolvedValue({ session_id: 's1', status: 'CREATED' });
      const svc = novoService({ postJson: post });
      await svc.invocar([{ key: 'erro', value: 'E' }, { key: 'servico', value: 'gw' }]);
      const body = post.mock.calls[0][1];
      expect(body.constants).toEqual({ erro: 'E', servico: 'gw' });
      expect(body.payload).toEqual({ input: 'E' });
    });

    it('monta a URL, entity_type/name/version e bundle a partir da config, e devolve o session_id', async () => {
      const post = jest.fn().mockResolvedValue({ session_id: 'sess1' });
      const svc = novoService({ postJson: post });
      const id = await svc.invocar([{ key: 'erro', value: 'Falha X' }]);
      expect(id).toBe('sess1');
      const [url, body, opts] = post.mock.calls[0];
      expect(url).toBe('http://sim/sessions/invoke');
      expect(body).toEqual({
        entity_type: 'workflow',
        entity_name: 'dvop-curador',
        entity_version: '1.0.0',
        bundle: 'dvop-agx-ssol-propor-solucao',
        payload: { input: 'Falha X' },
        constants: { erro: 'Falha X' },
      });
      expect(opts.headers['x-api-key']).toBe('S');
      expect(opts.headers['x-tenant-id']).toBe('t');
    });

    it('payload vazio → constants {} e input ""', async () => {
      const post = jest.fn().mockResolvedValue({ session_id: 's1' });
      const svc = novoService({ postJson: post });
      await svc.invocar([]);
      const body = post.mock.calls[0][1];
      expect(body.constants).toEqual({});
      expect(body.payload).toEqual({ input: '' });
    });

    it('sem session_id na resposta → 502 (não vaza token nem password na mensagem)', async () => {
      const post = jest.fn().mockResolvedValue({});
      const svc = novoService({ postJson: post });
      await expect(svc.invocar([{ key: 'erro', value: 'x' }])).rejects.toMatchObject({
        statusCode: 502,
        detail: 'agente Agentix não devolveu session_id',
      });
    });
  });

  describe('invocarComEntidade', () => {
    it('invocarComEntidade usa o entity_name passado', async () => {
      const svc = novoService({ postJson: jest.fn().mockResolvedValue({ session_id: 's1' }) });
      await svc.invocarComEntidade('propor-pr', [{ key: 'assinatura', value: 'x' }]);
      const body = (svc as any).postJson.mock.calls[0][1];
      expect(body.entity_name).toBe('propor-pr');
      expect(body.constants.assinatura).toBe('x');
    });
  });

  describe('sessao', () => {
    it('faz GET /sessions/{id} e mapeia session_id/status/output para sessionId/state/result', async () => {
      const get = jest.fn().mockResolvedValue({ session_id: 's1', status: 'DONE', output: '{"a":1}' });
      const svc = novoService({ getJson: get });
      expect(await svc.sessao('s1')).toEqual({ sessionId: 's1', state: 'DONE', result: '{"a":1}' });
      const [url, opts] = get.mock.calls[0];
      expect(url).toBe('http://sim/sessions/s1');
      expect(opts.headers['x-api-key']).toBe('S');
      expect(opts.headers['x-tenant-id']).toBe('t');
    });

    it('resposta sem session_id/status/output → campos undefined (sem lançar)', async () => {
      const get = jest.fn().mockResolvedValue({});
      const svc = novoService({ getJson: get });
      expect(await svc.sessao('s1')).toEqual({ sessionId: undefined, state: undefined, result: undefined });
    });
  });

  describe('headers', () => {
    it('usa o token do provider como x-api-key e o tenant da config como x-tenant-id (v2 — não Authorization/x-lx-tenant)', async () => {
      const post = jest.fn().mockResolvedValue({ session_id: 's1' });
      const provider = { configurado: true, token: jest.fn().mockResolvedValue('token-abc') } as unknown as AgentixTokenProvider;
      const svc = novoService({ postJson: post }, {}, provider);
      await svc.invocar([{ key: 'erro', value: 'x' }]);
      const opts = post.mock.calls[0][2];
      expect(opts.headers).toEqual({ 'x-api-key': 'token-abc', 'x-tenant-id': 't' });
    });
  });
});
