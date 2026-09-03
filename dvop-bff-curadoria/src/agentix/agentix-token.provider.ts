import { UpstreamError } from '../common/upstream-error';

const MARGEM = 30; const VALIDADE_PADRAO = 60;

export class AgentixTokenProvider {
  label = 'token do Agentix';
  private readonly loginUrl: string; private readonly username: string;
  private readonly password: string;
  private readonly timeoutMs: number; private readonly now: () => number;
  private cache: string | null = null; private expiraEm = 0;
  private emVoo: Promise<string> | null = null;

  constructor(o: { loginUrl: string; username: string; password: string; timeoutMs: number; now?: () => number }) {
    this.loginUrl = o.loginUrl; this.username = o.username; this.password = o.password;
    this.timeoutMs = o.timeoutMs; this.now = o.now ?? (() => Date.now() / 1000);
  }
  get configurado(): boolean { return Boolean(this.username && this.password); }

  async token(): Promise<string> {
    if (this.cache && this.now() < this.expiraEm) return this.cache;
    if (this.emVoo) return this.emVoo;
    this.emVoo = this.renovar().finally(() => { this.emVoo = null; });
    return this.emVoo;
  }

  private async renovar(): Promise<string> {
    if (this.cache && this.now() < this.expiraEm) return this.cache;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(this.loginUrl, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new UpstreamError(504, `timeout ao renovar o ${this.label}`);
      throw new UpstreamError(502, `não foi possível conectar ao emissor do ${this.label}`);
    } finally { clearTimeout(timer); }
    if (resp.status >= 400) throw new UpstreamError(502, `emissor do ${this.label} recusou (HTTP ${resp.status})`);
    let corpo: any;
    try { corpo = await resp.json(); } catch { throw new UpstreamError(502, `resposta inválida do emissor do ${this.label}`); }
    const token = corpo.api_key;
    if (!token) throw new UpstreamError(502, `resposta sem api_key do emissor do ${this.label}`);
    const validade = Number(corpo.expires_in || VALIDADE_PADRAO);
    this.cache = String(token);
    this.expiraEm = this.now() + Math.max(validade - MARGEM, 1);
    return this.cache;
  }
}
