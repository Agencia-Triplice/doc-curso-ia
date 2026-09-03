import { CacheService } from '../src/upstreams/cache.service';
import { ReviewService } from '../src/upstreams/review.service';
import { McpGithubService } from '../src/upstreams/mcp-github.service';
import { SrvLogService } from '../src/upstreams/srv-log.service';
import { RetrievalService } from '../src/upstreams/retrieval.service';
import { UpstreamError } from '../src/common/upstream-error';

const cfg = (over: any = {}) => ({ requestTimeout: 10, cacheUrl: '', reviewUrl: '', mcpghUrl: '', mcpghToken: '', ...over } as any);
const okJson = (b: unknown) => ({ status: 200, ok: true, json: async () => b, text: async () => JSON.stringify(b) } as unknown as Response);

describe('upstream providers', () => {
  afterEach(() => (global.fetch as jest.Mock)?.mockReset?.());
  it('CacheService.enabled reflete a URL de leitura (cache-query)', () => {
    expect(new CacheService(cfg()).enabled).toBe(false);
    expect(new CacheService(cfg({ cacheUrl: 'http://ms2' })).enabled).toBe(true);
  });
  it('CacheService.writerEnabled reflete a URL de escrita (cache-writer), com fallback p/ cacheUrl', () => {
    expect(new CacheService(cfg()).writerEnabled).toBe(false);
    // sem writer explícito cai na base de leitura (comportamento atual, sem quebrar)
    expect(new CacheService(cfg({ cacheUrl: 'http://ms2' })).writerEnabled).toBe(true);
    expect(new CacheService(cfg({ cacheWriterUrl: 'http://ms5' })).writerEnabled).toBe(true);
  });
  it('leitura (lookup/soluções) vai ao cache-query; órfão/rascunho/prompt vão ao cache-writer', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({}));
    const svc = new CacheService(cfg({ cacheUrl: 'http://ms2', cacheWriterUrl: 'http://ms5' }));
    const urlDa = () => (global.fetch as jest.Mock).mock.calls.at(-1)[0];
    await svc.lookup('fp', 'a'); expect(urlDa()).toBe('http://ms2/v1/lookup');
    await svc.listarSolucoes(3); expect(urlDa()).toBe('http://ms2/v1/solucoes?limit=3');
    await svc.infoWriter(); expect(urlDa()).toBe('http://ms5/v1/info');
    await svc.obterOrfao('fp'); expect(urlDa()).toBe('http://ms5/v1/orfaos/fp');
    await svc.obterRascunho('fp'); expect(urlDa()).toBe('http://ms5/v1/rascunhos/fp');
    await svc.obterPrompt('fp'); expect(urlDa()).toBe('http://ms5/v1/prompts/fp');
    await svc.salvarRascunho('fp', 'c', 'a'); expect(urlDa()).toBe('http://ms5/v1/rascunhos/fp');
  });
  it('CacheService.lookup faz POST /v1/lookup', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ hit: true, match: 'exact' }));
    const r = await new CacheService(cfg({ cacheUrl: 'http://ms2' })).lookup('fp', 'assin');
    expect(r).toEqual({ hit: true, match: 'exact' });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms2/v1/lookup');
  });
  it('CacheService.listarSolucoes faz GET /v1/solucoes com limit', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ items: [] }));
    await new CacheService(cfg({ cacheUrl: 'http://ms2' })).listarSolucoes(7);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms2/v1/solucoes?limit=7');
  });
  it('McpGithubService.enabled reflete a URL', () => {
    expect(new McpGithubService(cfg({ mcpghUrl: '' })).enabled).toBe(false);
    expect(new McpGithubService(cfg({ mcpghUrl: 'http://gh' })).enabled).toBe(true);
  });
  it('McpGithubService.importar manda X-GitHub-Token e Authorization', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ ok: 1 }));
    await new McpGithubService(cfg({ mcpghUrl: 'http://gh', mcpghToken: 'svc' })).importar('http://repo', 'pat123');
    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(init.headers['Authorization']).toBe('Bearer svc');
    expect(init.headers['X-GitHub-Token']).toBe('pat123');
  });
  it('McpGithubService.importar sem token de serviço nem PAT não manda headers de auth', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ ok: 1 }));
    await new McpGithubService(cfg({ mcpghUrl: 'http://gh', mcpghToken: '' })).importar('http://repo');
    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(init.headers['Authorization']).toBeUndefined();
    expect(init.headers['X-GitHub-Token']).toBeUndefined();
  });
  it('McpGithubService.importar com token de serviço mas sem PAT manda só Authorization', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ ok: 1 }));
    await new McpGithubService(cfg({ mcpghUrl: 'http://gh', mcpghToken: 'svc' })).importar('http://repo');
    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(init.headers['Authorization']).toBe('Bearer svc');
    expect(init.headers['X-GitHub-Token']).toBeUndefined();
  });

  describe('SrvLogService', () => {
    it('fetchLogs faz GET /v1/logs com params', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ items: [] }));
      await new SrvLogService(cfg()).fetchLogs('http://ms1', { limit: 50 });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms1/v1/logs?limit=50');
    });
    it('fetchStats faz GET /v1/stats', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ total: 1 }));
      await new SrvLogService(cfg()).fetchStats('http://ms1');
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms1/v1/stats');
    });
    it('fingerprint faz POST /v1/fingerprint com service e level', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ fp: 'x' }));
      await new SrvLogService(cfg()).fingerprint('http://ms1', 'msg', 'svc', 'ERROR');
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms1/v1/fingerprint');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ message: 'msg', service: 'svc', level: 'ERROR' });
    });
    it('fingerprint omite service/level quando ausentes', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ fp: 'x' }));
      await new SrvLogService(cfg()).fingerprint('http://ms1', 'msg');
      const init = (global.fetch as jest.Mock).mock.calls[0][1];
      const body = JSON.parse(init.body);
      expect(body).toEqual({ message: 'msg' });
      expect('service' in body).toBe(false);
      expect('level' in body).toBe(false);
    });
  });

  describe('RetrievalService', () => {
    it('enabled reflete a URL', () => {
      expect(new RetrievalService(cfg({ retrievalUrl: '' })).enabled).toBe(false);
      expect(new RetrievalService(cfg({ retrievalUrl: 'http://ms3' })).enabled).toBe(true);
    });
    it('search faz POST /v1/search', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ results: [] }));
      await new RetrievalService(cfg({ retrievalUrl: 'http://ms3' })).search('q', null, null, 'fp');
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms3/v1/search');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ query: 'q', servico: null, nivel: null, fingerprint: 'fp' });
    });
    it('search inclui template quando informado e omite quando null', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ results: [] }));
      const svc = new RetrievalService(cfg({ retrievalUrl: 'http://ms3' }));
      await svc.search('q', null, null, 'fp', 'srv-java');
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body))
        .toEqual({ query: 'q', servico: null, nivel: null, fingerprint: 'fp', template: 'srv-java' });
      (global.fetch as jest.Mock).mockClear();
      await svc.search('q', null, null, 'fp', null);
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body))
        .toEqual({ query: 'q', servico: null, nivel: null, fingerprint: 'fp' });
    });
    it('search inclui run_url quando informado e omite quando null', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ results: [] }));
      const svc = new RetrievalService(cfg({ retrievalUrl: 'http://ms3' }));
      await svc.search('q', null, null, 'fp', null, 'https://run/42');
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body))
        .toEqual({ query: 'q', servico: null, nivel: null, fingerprint: 'fp', run_url: 'https://run/42' });
      (global.fetch as jest.Mock).mockClear();
      await svc.search('q', null, null, 'fp', 'srv-java', 'https://run/9');
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body))
        .toEqual({ query: 'q', servico: null, nivel: null, fingerprint: 'fp', template: 'srv-java', run_url: 'https://run/9' });
    });
    it('search inclui branch quando informado e omite quando null', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ results: [] }));
      const svc = new RetrievalService(cfg({ retrievalUrl: 'http://ms3' }));
      await svc.search('q', null, null, 'fp', null, null, 'main');
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body))
        .toEqual({ query: 'q', servico: null, nivel: null, fingerprint: 'fp', branch: 'main' });
      (global.fetch as jest.Mock).mockClear();
      await svc.search('q', null, null, 'fp', 'srv-java', 'https://run/9', 'main');
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body))
        .toEqual({ query: 'q', servico: null, nivel: null, fingerprint: 'fp', template: 'srv-java', run_url: 'https://run/9', branch: 'main' });
      (global.fetch as jest.Mock).mockClear();
      await svc.search('q', null, null, 'fp', null, null, null);
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body))
        .toEqual({ query: 'q', servico: null, nivel: null, fingerprint: 'fp' });
    });
    it('info faz GET /v1/info', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ ok: true }));
      await new RetrievalService(cfg({ retrievalUrl: 'http://ms3' })).info();
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms3/v1/info');
    });
    it('listarBase com q inclui ?q= e sem q omite', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ items: [] }));
      const svc = new RetrievalService(cfg({ retrievalUrl: 'http://ms3' }));
      await svc.listarBase(10, 0, 'termo');
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms3/v1/documents?limit=10&offset=0&q=termo');
      (global.fetch as jest.Mock).mockClear();
      await svc.listarBase(10, 0);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms3/v1/documents?limit=10&offset=0');
    });
    it('excluirBase faz DELETE /v1/documents/:id e retorna void', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({}));
      const r = await new RetrievalService(cfg({ retrievalUrl: 'http://ms3' })).excluirBase(5);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms3/v1/documents/5');
      expect(init.method).toBe('DELETE');
      expect(r).toBeUndefined();
    });
  });

  describe('RetrievalService.buscarContexto', () => {
    it('faz POST /v1/search só com query/servico/nivel (sem fingerprint → não registra órfão)', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ resultados: [] }));
      await new RetrievalService(cfg({ retrievalUrl: 'http://ms3' })).buscarContexto('sig-1', 'svc', 'ERROR');
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms3/v1/search');
      expect(JSON.parse(init.body)).toEqual({ query: 'sig-1', servico: 'svc', nivel: 'ERROR' });
      expect(JSON.parse(init.body)).not.toHaveProperty('fingerprint');
    });
    it('aceita servico/nivel null', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ resultados: [] }));
      await new RetrievalService(cfg({ retrievalUrl: 'http://ms3' })).buscarContexto('sig', null, null);
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ query: 'sig', servico: null, nivel: null });
    });
  });

  describe('CacheService rascunho/órfão (entrega da cura à curadoria)', () => {
    const nofail = { sleep: async () => {} };
    it('salvarRascunho faz PUT /v1/rascunhos/{fp} com {solucao, autor}', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ ok: true }));
      await new CacheService(cfg({ cacheUrl: 'http://ms2' })).salvarRascunho('fp1', 'corpo', 'IA (Agentix)');
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms2/v1/rascunhos/fp1');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ solucao: 'corpo', autor: 'IA (Agentix)' });
    });
    it('garantirOrfao → true quando obterOrfao responde de primeira', async () => {
      const svc = new CacheService(cfg({ cacheUrl: 'http://ms2' }));
      (svc as any).getJson = jest.fn().mockResolvedValue({ fingerprint: 'fp1' });
      expect(await svc.garantirOrfao('fp1', nofail)).toBe(true);
      expect((svc as any).getJson).toHaveBeenCalledTimes(1);
    });
    it('garantirOrfao → true após alguns 404 (poll), respeitando o limite', async () => {
      const svc = new CacheService(cfg({ cacheUrl: 'http://ms2' }));
      (svc as any).getJson = jest.fn()
        .mockRejectedValueOnce(new UpstreamError(404, 'ainda não'))
        .mockRejectedValueOnce(new UpstreamError(404, 'ainda não'))
        .mockResolvedValueOnce({ fingerprint: 'fp1' });
      expect(await svc.garantirOrfao('fp1', { ...nofail, tentativas: 5 })).toBe(true);
      expect((svc as any).getJson).toHaveBeenCalledTimes(3);
    });
    it('garantirOrfao → false quando o órfão nunca aparece dentro do limite', async () => {
      const svc = new CacheService(cfg({ cacheUrl: 'http://ms2' }));
      (svc as any).getJson = jest.fn().mockRejectedValue(new UpstreamError(404, 'sem órfão'));
      expect(await svc.garantirOrfao('fp1', { ...nofail, tentativas: 3 })).toBe(false);
      expect((svc as any).getJson).toHaveBeenCalledTimes(3);
    });
  });

  describe('ReviewService', () => {
    it('enabled reflete a URL', () => {
      expect(new ReviewService(cfg({ reviewUrl: '' })).enabled).toBe(false);
      expect(new ReviewService(cfg({ reviewUrl: 'http://ms7' })).enabled).toBe(true);
    });
    it('info faz GET /v1/info', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ ok: true }));
      await new ReviewService(cfg({ reviewUrl: 'http://ms7' })).info();
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms7/v1/info');
    });
    it('listarFila faz GET /v1/fila', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ items: [] }));
      await new ReviewService(cfg({ reviewUrl: 'http://ms7' })).listarFila();
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms7/v1/fila');
    });
    it('aprovar faz POST /v1/fila/:fp/aprovar com publicar_base em snake_case', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ ok: true }));
      await new ReviewService(cfg({ reviewUrl: 'http://ms7' })).aprovar('fp', 'sol', 'aut', true);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms7/v1/fila/fp/aprovar');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ solucao: 'sol', autor: 'aut', publicar_base: true });
    });
    it('descartar faz POST /v1/fila/:fp/descartar com body vazio e retorna void', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({}));
      const r = await new ReviewService(cfg({ reviewUrl: 'http://ms7' })).descartar('fp');
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms7/v1/fila/fp/descartar');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({});
      expect(r).toBeUndefined();
    });
  });

});
