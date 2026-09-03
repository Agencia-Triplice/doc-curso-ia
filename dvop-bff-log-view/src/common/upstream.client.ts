import { UpstreamError } from './upstream-error';

type Opts = { params?: Record<string, unknown>; headers?: Record<string, string>; body?: unknown };

export abstract class UpstreamClient {
  abstract label: string;
  constructor(protected readonly timeoutMs: number) {}

  protected async getJson(url: string, o: Opts): Promise<any> {
    return this.request('GET', url, o);
  }
  protected async postJson(url: string, body: unknown, o: Opts = {}): Promise<any> {
    return this.request('POST', url, { ...o, body });
  }
  protected async putJson(url: string, body: unknown, o: Opts = {}): Promise<any> {
    return this.request('PUT', url, { ...o, body });
  }

  protected async send(method: string, url: string, o: Opts = {}): Promise<Response> {
    const full = o.params ? `${url}?${new URLSearchParams(
      Object.entries(o.params).filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)]),
    ).toString()}` : url;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(full, {
        method,
        signal: ctrl.signal,
        headers: { ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.headers ?? {}) },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new UpstreamError(504, `timeout ao consultar ${url}`);
      throw new UpstreamError(502, `não foi possível conectar ao ${this.label} em ${url}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 400) {
      const detail = await this.detailOf(res);
      if (res.status < 500) throw new UpstreamError(res.status, detail);
      throw new UpstreamError(502, `${this.label} respondeu ${res.status}: ${detail}`);
    }
    return res;
  }

  private async request(method: string, url: string, o: Opts): Promise<any> {
    const res = await this.send(method, url, o);
    try {
      return await res.json();
    } catch {
      throw new UpstreamError(502, `resposta inválida (não-JSON) do ${this.label} em ${url}`);
    }
  }

  private async detailOf(res: Response): Promise<string> {
    // corpo lido UMA vez (Response real só permite uma leitura): texto cru e,
    // se for JSON com `detail`, o valor de `detail`
    let texto = '';
    try { texto = await res.text(); } catch { return ''; }
    try {
      const body = JSON.parse(texto);
      if (body && typeof body === 'object' && 'detail' in body) return String((body as any).detail);
    } catch { /* corpo não-JSON: cai no texto cru */ }
    return texto.slice(0, 200);
  }
}
