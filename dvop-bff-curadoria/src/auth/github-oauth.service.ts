import { CuradoriaConfig } from '../config/env';

const ESCOPO = 'read:user read:org';

export class GithubOAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callbackUrl: string;
  private readonly org: string;
  private readonly timeoutMs: number;
  // Endpoints derivados do host configurável (github.com ou GitHub Enterprise
  // Server). Trocar CURADORIA_BFF_GITHUB_BASE_URL/API_URL basta p/ portar.
  private readonly autoriza: string;
  private readonly token: string;
  private readonly api: string;

  constructor(cfg: CuradoriaConfig) {
    this.clientId = cfg.githubClientId;
    this.clientSecret = cfg.githubClientSecret;
    this.callbackUrl = cfg.githubCallbackUrl;
    this.org = cfg.githubOrg;
    this.timeoutMs = cfg.requestTimeout * 1000;
    const base = cfg.githubBaseUrl.replace(/\/+$/, '');
    this.api = cfg.githubApiUrl.replace(/\/+$/, '');
    this.autoriza = `${base}/login/oauth/authorize`;
    this.token = `${base}/login/oauth/access_token`;
  }

  configurado(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  urlAutorizacao(state: string): string {
    const q = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      scope: ESCOPO,
      state,
      allow_signup: 'false',
    });
    return `${this.autoriza}?${q.toString()}`;
  }

  private async fetchJson(url: string, init: RequestInit): Promise<any> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const r = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { 'User-Agent': 'dvop-bff-curadoria', Accept: 'application/json', ...(init.headers || {}) },
      });
      if (!r.ok) throw new Error(`github respondeu ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  async trocarCode(code: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.callbackUrl,
    });
    const data = await this.fetchJson(this.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!data.access_token) throw new Error('github não devolveu access_token');
    return data.access_token as string;
  }

  private auth(token: string): RequestInit {
    return { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } };
  }

  async obterUsuario(token: string): Promise<{ login: string; nome: string; avatar: string }> {
    const u = await this.fetchJson(`${this.api}/user`, this.auth(token));
    return { login: u.login, nome: u.name || u.login, avatar: u.avatar_url || '' };
  }

  async obterTeams(token: string): Promise<string[]> {
    let teams: any;
    try {
      teams = await this.fetchJson(`${this.api}/user/teams?per_page=100`, this.auth(token));
    } catch {
      // teams não são obrigatórios enquanto o gate (GITHUB_ALLOWED_TEAMS) está vazio;
      // falha aqui não pode derrubar o login. Ver AuthGuard: teams:[] nega quando o gate liga.
      return [];
    }
    if (!Array.isArray(teams)) return [];
    return teams
      .filter((t: any) => t?.organization?.login === this.org && t?.slug)
      .map((t: any) => t.slug as string);
  }

  /**
   * Valida um Personal Access Token direto contra a API do GitHub. Um PAT age
   * como Bearer idêntico ao access_token do OAuth, então reusa obterUsuario +
   * obterTeams. Lança se o token for inválido (obterUsuario propaga o erro do
   * fetchJson quando o GitHub responde 401). O PAT é usado só aqui e descartado.
   */
  async autenticarComPat(token: string): Promise<{ login: string; nome: string; avatar: string; teams: string[] }> {
    const u = await this.obterUsuario(token);
    const teams = await this.obterTeams(token);
    return { ...u, teams };
  }
}
