import { UpstreamClient } from '../src/common/upstream.client';
import { UpstreamError } from '../src/common/upstream-error';

class Probe extends UpstreamClient { label = 'probe'; call(u: string) { return this.getJson(u, {}); } }
class ProbeParams extends UpstreamClient {
  label = 'probe';
  call(u: string, params: Record<string, unknown>) { return this.getJson(u, { params }); }
}

function resp(status: number, body: unknown, json = true): Response {
  return { status, ok: status < 400,
    json: async () => (json ? body : (() => { throw new Error('x'); })()),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('UpstreamClient', () => {
  const p = new Probe(10000);
  afterEach(() => { (global.fetch as jest.Mock)?.mockReset?.(); });

  it('200 → devolve JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue(resp(200, { ok: 1 }));
    expect(await p.call('http://x/y')).toEqual({ ok: 1 });
  });
  it('sucesso com corpo não-JSON → 502', async () => {
    global.fetch = jest.fn().mockResolvedValue(resp(200, 'nao e json', false));
    await expect(p.call('http://x/y')).rejects.toMatchObject({ statusCode: 502 });
  });
  it('404 → propaga status com detail do corpo', async () => {
    global.fetch = jest.fn().mockResolvedValue(resp(404, { detail: 'nao achou' }));
    await expect(p.call('http://x/y')).rejects.toMatchObject({ statusCode: 404, detail: 'nao achou' });
  });
  it('500 → 502', async () => {
    global.fetch = jest.fn().mockResolvedValue(resp(500, { detail: 'boom' }));
    await expect(p.call('http://x/y')).rejects.toMatchObject({ statusCode: 502 });
  });
  it('timeout (AbortError) → 504', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(p.call('http://x/y')).rejects.toMatchObject({ statusCode: 504 });
  });
  it('erro de rede → 502', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(p.call('http://x/y')).rejects.toMatchObject({ statusCode: 502 });
  });
  it('erro sem chave "detail" no corpo → cai no texto cru (slice)', async () => {
    global.fetch = jest.fn().mockResolvedValue(resp(404, { outraChave: 1 }));
    await expect(p.call('http://x/y')).rejects.toMatchObject({ statusCode: 404, detail: JSON.stringify({ outraChave: 1 }) });
  });
  it('res.text() falha ao ler o corpo do erro → detail vazio', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 404, ok: false,
      json: async () => ({}),
      text: async () => { throw new Error('leitura falhou'); },
    } as unknown as Response);
    await expect(p.call('http://x/y')).rejects.toMatchObject({ statusCode: 404, detail: '' });
  });
  it('parâmetros de query são serializados e undefined/null são filtrados', async () => {
    const pp = new ProbeParams(10000);
    let capturedUrl = '';
    global.fetch = jest.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(resp(200, { ok: 1 }));
    });
    await pp.call('http://x/y', { a: 1, b: undefined, c: null, d: 'texto' });
    expect(capturedUrl).toBe('http://x/y?a=1&d=texto');
  });
});
