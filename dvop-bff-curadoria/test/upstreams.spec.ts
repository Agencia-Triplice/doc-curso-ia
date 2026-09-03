import { CacheWriterService } from '../src/upstreams/cache-writer.service';
import { RetrievalService } from '../src/upstreams/retrieval.service';
import { RemediationService } from '../src/upstreams/remediation.service';
import { CuradoriaConfig } from '../src/config/env';

const cfg = (over: Partial<CuradoriaConfig> = {}): CuradoriaConfig =>
  ({ requestTimeout: 10, ms5Url: '', ms3Url: '', ms8Url: '', ...over } as CuradoriaConfig);

const okJson = (b: unknown, status = 200) =>
  ({ status, ok: status < 400, json: async () => b, text: async () => JSON.stringify(b) } as unknown as Response);

describe('upstream clients (bff-curadoria)', () => {
  afterEach(() => (global.fetch as jest.Mock)?.mockReset?.());

  describe('CacheWriterService (MS 5)', () => {
    it('enabled reflete a URL', () => {
      expect(new CacheWriterService(cfg({ ms5Url: '' })).enabled).toBe(false);
      expect(new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).enabled).toBe(true);
    });

    it('listarOrfaos faz GET /v1/orfaos com limit padrão 500', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson([{ fingerprint: 'a' }]));
      const r = await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).listarOrfaos();
      expect(r).toEqual([{ fingerprint: 'a' }]);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms5/v1/orfaos?limit=500');
    });

    it('listarOrfaos aceita limit explícito', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson([]));
      await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).listarOrfaos(10);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms5/v1/orfaos?limit=10');
    });

    it('obterOrfao faz GET /v1/orfaos/{fp}', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ fingerprint: 'fp1' }));
      const r = await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).obterOrfao('fp1');
      expect(r).toEqual({ fingerprint: 'fp1' });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms5/v1/orfaos/fp1');
      expect(init.method).toBe('GET');
    });

    it('obterOrfao propaga 404 como UpstreamError', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ detail: 'não encontrado' }, 404));
      await expect(
        new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).obterOrfao('fpx'),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('excluirOrfao faz DELETE /v1/orfaos/{fp} e retorna void', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({}));
      const r = await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).excluirOrfao('fp1');
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms5/v1/orfaos/fp1');
      expect(init.method).toBe('DELETE');
      expect(r).toBeUndefined();
    });

    it('salvarRascunho faz PUT /v1/rascunhos/{fp} com {solucao, autor}', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ fingerprint: 'fp1', solucao: 'sol' }));
      const r = await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).salvarRascunho('fp1', 'sol', 'autor1');
      expect(r).toEqual({ fingerprint: 'fp1', solucao: 'sol' });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms5/v1/rascunhos/fp1');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ solucao: 'sol', autor: 'autor1' });
    });

    it('obterRascunho faz GET /v1/rascunhos/{fp} e propaga 404', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ detail: 'sem rascunho' }, 404));
      await expect(
        new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).obterRascunho('fp1'),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms5/v1/rascunhos/fp1');
    });

    it('excluirRascunho faz DELETE /v1/rascunhos/{fp} e retorna void', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({}));
      const r = await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).excluirRascunho('fp1');
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms5/v1/rascunhos/fp1');
      expect(init.method).toBe('DELETE');
      expect(r).toBeUndefined();
    });

    it('criarSolucao faz POST /v1/solucoes repassando o payload', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ fingerprint: 'fp1' }));
      const payload = { fingerprint: 'fp1', solucao: 'sol', autor: 'a' };
      await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).criarSolucao(payload);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms5/v1/solucoes');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual(payload);
    });

    it('listarSolucoes faz GET /v1/solucoes com limit', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson([]));
      await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).listarSolucoes(25);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms5/v1/solucoes?limit=25');
    });

    it('obterSolucao faz GET /v1/solucoes/{fp} e propaga 404', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ detail: 'sem solução' }, 404));
      await expect(
        new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).obterSolucao('fp1'),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms5/v1/solucoes/fp1');
    });

    it('editarSolucao faz PUT /v1/solucoes/{fp} com {solucao, autor}', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ fingerprint: 'fp1', solucao: 'nova' }));
      const r = await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).editarSolucao('fp1', 'nova', 'ana');
      expect(r).toEqual({ fingerprint: 'fp1', solucao: 'nova' });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms5/v1/solucoes/fp1');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ solucao: 'nova', autor: 'ana' });
    });

    it('editarSolucao propaga 404 como UpstreamError', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ detail: 'fingerprint desconhecido' }, 404));
      await expect(
        new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).editarSolucao('fpx', 'x', null),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('excluirSolucao faz DELETE /v1/solucoes/{fp} e retorna void', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({}, 204));
      const r = await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).excluirSolucao('fp1');
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms5/v1/solucoes/fp1');
      expect(init.method).toBe('DELETE');
      expect(r).toBeUndefined();
    });

    it('excluirSolucao com devolver=false acrescenta ?devolver=false', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({}, 204));
      await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).excluirSolucao('fp1', false);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms5/v1/solucoes/fp1?devolver=false');
      expect(init.method).toBe('DELETE');
    });

    it('info faz GET /v1/info', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ orfaos: 3 }));
      const r = await new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).info();
      expect(r).toEqual({ orfaos: 3 });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms5/v1/info');
    });

    it('5xx do MS5 vira UpstreamError 502', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ detail: 'boom' }, 500));
      await expect(
        new CacheWriterService(cfg({ ms5Url: 'http://ms5' })).info(),
      ).rejects.toMatchObject({ statusCode: 502 });
    });
  });

  describe('RetrievalService (MS 3)', () => {
    it('enabled reflete a URL', () => {
      expect(new RetrievalService(cfg({ ms3Url: '' })).enabled).toBe(false);
      expect(new RetrievalService(cfg({ ms3Url: 'http://ms3' })).enabled).toBe(true);
    });

    it('buscar faz POST /v1/search com {query, servico, nivel} e SEM fingerprint', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ resultados: [] }));
      const r = await new RetrievalService(cfg({ ms3Url: 'http://ms3' })).buscar('erro x', 'svc', 'ERROR');
      expect(r).toEqual({ resultados: [] });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms3/v1/search');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body).toEqual({ query: 'erro x', servico: 'svc', nivel: 'ERROR' });
      expect('fingerprint' in body).toBe(false);
    });

    it('buscar com timeout (AbortError) vira UpstreamError 504', async () => {
      global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      await expect(
        new RetrievalService(cfg({ ms3Url: 'http://ms3' })).buscar('q', null, null),
      ).rejects.toMatchObject({ statusCode: 504 });
    });

    it('ingerirDocumento envia o array diretamente como body (não embrulhado)', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ ingeridos: 2 }));
      const documentos = [{ titulo: 'a' }, { titulo: 'b' }];
      const r = await new RetrievalService(cfg({ ms3Url: 'http://ms3' })).ingerirDocumento(documentos);
      expect(r).toEqual({ ingeridos: 2 });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms3/v1/documents');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual(documentos);
    });

    it('listarDocumentos faz GET /v1/documents com limit', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ documentos: [], total: 0 }));
      await new RetrievalService(cfg({ ms3Url: 'http://ms3' })).listarDocumentos(15);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms3/v1/documents?limit=15');
    });

    it('obterDocumento faz GET /v1/documents/{id}', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ id: 7, titulo: 'doc' }));
      const r = await new RetrievalService(cfg({ ms3Url: 'http://ms3' })).obterDocumento(7);
      expect(r).toEqual({ id: 7, titulo: 'doc' });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms3/v1/documents/7');
      expect(init.method).toBe('GET');
    });

    it('obterDocumento propaga 404 como UpstreamError', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ detail: 'documento não encontrado' }, 404));
      await expect(
        new RetrievalService(cfg({ ms3Url: 'http://ms3' })).obterDocumento(999),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('editarDocumento faz PUT /v1/documents/{id}', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ id: 7, titulo: 'novo' }));
      const payload = { titulo: 'novo', conteudo: 'c', servico: null, nivel: null, tags: [] };
      const r = await new RetrievalService(cfg({ ms3Url: 'http://ms3' })).editarDocumento(7, payload);
      expect(r).toEqual({ id: 7, titulo: 'novo' });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms3/v1/documents/7');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual(payload);
    });

    it('excluirDocumento faz DELETE /v1/documents/{id} e retorna void', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({}, 204));
      const r = await new RetrievalService(cfg({ ms3Url: 'http://ms3' })).excluirDocumento(7);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms3/v1/documents/7');
      expect(init.method).toBe('DELETE');
      expect(r).toBeUndefined();
    });
  });

  describe('RemediationService (MS 8)', () => {
    it('enabled reflete a URL', () => {
      expect(new RemediationService(cfg({ ms8Url: '' })).enabled).toBe(false);
      expect(new RemediationService(cfg({ ms8Url: 'http://ms8' })).enabled).toBe(true);
    });

    it('listarRemediacoes faz GET /v1/remediacoes', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ items: [] }));
      const r = await new RemediationService(cfg({ ms8Url: 'http://ms8' })).listarRemediacoes();
      expect(r).toEqual({ items: [] });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms8/v1/remediacoes');
    });

    it('obterRemediacao faz GET /v1/remediacoes/{id}', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ id: 'r1' }));
      const r = await new RemediationService(cfg({ ms8Url: 'http://ms8' })).obterRemediacao('r1');
      expect(r).toEqual({ id: 'r1' });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms8/v1/remediacoes/r1');
    });

    it('obterCredencial faz GET /v1/credencial', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ presente: false, origem: 'ausente' }));
      const r = await new RemediationService(cfg({ ms8Url: 'http://ms8' })).obterCredencial();
      expect(r).toEqual({ presente: false, origem: 'ausente' });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://ms8/v1/credencial');
      expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('GET');
    });

    it('armarCredencial faz PUT /v1/credencial com o token no corpo', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ presente: true, origem: 'operador' }));
      const r = await new RemediationService(cfg({ ms8Url: 'http://ms8' })).armarCredencial('ghp_bom');
      expect(r).toEqual({ presente: true, origem: 'operador' });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms8/v1/credencial');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ token: 'ghp_bom' });
    });

    it('desarmarCredencial faz DELETE /v1/credencial', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ presente: false, origem: 'ausente' }));
      const r = await new RemediationService(cfg({ ms8Url: 'http://ms8' })).desarmarCredencial();
      expect(r).toEqual({ presente: false, origem: 'ausente' });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms8/v1/credencial');
      expect(init.method).toBe('DELETE');
    });

    it('obterRemediacao em 404 PROPAGA UpstreamError(404) — não retorna null', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ detail: 'não catalogada' }, 404));
      await expect(
        new RemediationService(cfg({ ms8Url: 'http://ms8' })).obterRemediacao('inexistente'),
      ).rejects.toMatchObject({ statusCode: 404, detail: 'não catalogada' });
    });

    it('aplicarPr faz POST /v1/prs/aplicar', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({ pr_numero: 7 }));
      const svc = new RemediationService(cfg({ ms8Url: 'http://ms8' }));
      const r = await svc.aplicarPr({ fingerprint: 'fp', servico: 'org/app', titulo: 't', corpo: 'c', arquivos: [] });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms8/v1/prs/aplicar');
      expect(init.method).toBe('POST');
      expect(r.pr_numero).toBe(7);
    });

    it('fecharPr faz DELETE /v1/prs/{fingerprint} com fingerprint codificado e retorna void', async () => {
      global.fetch = jest.fn().mockResolvedValue(okJson({}));
      const svc = new RemediationService(cfg({ ms8Url: 'http://ms8' }));
      const r = await svc.fecharPr('fp com espaço');
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe(`http://ms8/v1/prs/${encodeURIComponent('fp com espaço')}`);
      expect(init.method).toBe('DELETE');
      expect(r).toBeUndefined();
    });

    it('lerArquivoRepo faz GET /v1/repo/arquivo com servico e path como query params', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        okJson({ path: 'a.yaml', existe: true, conteudo: 'x', sha: 'abc' }),
      );
      const svc = new RemediationService(cfg({ ms8Url: 'http://ms8' }));
      const r = await svc.lerArquivoRepo('org/app', 'a.yaml');
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://ms8/v1/repo/arquivo?servico=org%2Fapp&path=a.yaml');
      expect(init.method).toBe('GET');
      expect(r).toEqual({ path: 'a.yaml', existe: true, conteudo: 'x', sha: 'abc' });
    });
  });
});
