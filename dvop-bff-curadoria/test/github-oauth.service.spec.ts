import { loadConfig } from '../src/config/env';
import { GithubOAuthService } from '../src/auth/github-oauth.service';

const cfg = (over: Record<string, string> = {}) =>
  loadConfig({
    CURADORIA_BFF_MS5_URL: 'http://ms5',
    CURADORIA_BFF_SESSION_SECRET: 's',
    CURADORIA_BFF_GITHUB_CLIENT_ID: 'cid',
    CURADORIA_BFF_GITHUB_CLIENT_SECRET: 'sec',
    CURADORIA_BFF_GITHUB_CALLBACK_URL: 'https://curadoria.example/auth/callback',
    ...over,
  } as any);

const okJson = (data: any) => ({ ok: true, status: 200, json: async () => data });

afterEach(() => { (global as any).fetch = undefined; });

describe('GithubOAuthService', () => {
  it('configurado reflete client id+secret', () => {
    expect(new GithubOAuthService(cfg()).configurado()).toBe(true);
    expect(new GithubOAuthService(cfg({ CURADORIA_BFF_GITHUB_CLIENT_ID: '' })).configurado()).toBe(false);
  });

  it('urlAutorizacao inclui client_id, redirect, escopo e state', () => {
    const u = new GithubOAuthService(cfg()).urlAutorizacao('st4te');
    const parsed = new URL(u);
    expect(parsed.searchParams.get('client_id')).toBe('cid');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://curadoria.example/auth/callback');
    expect(parsed.searchParams.get('scope')).toBe('read:user read:org');
    expect(parsed.searchParams.get('state')).toBe('st4te');
  });

  it('trocarCode devolve o access_token', async () => {
    (global as any).fetch = jest.fn(async () => okJson({ access_token: 'gho_x' }));
    await expect(new GithubOAuthService(cfg()).trocarCode('code1')).resolves.toBe('gho_x');
  });

  it('trocarCode sem token → erro', async () => {
    (global as any).fetch = jest.fn(async () => okJson({ error: 'bad_verification_code' }));
    await expect(new GithubOAuthService(cfg()).trocarCode('x')).rejects.toThrow();
  });

  it('obterUsuario mapeia login/nome/avatar', async () => {
    (global as any).fetch = jest.fn(async () => okJson({ login: 'tiago', name: 'Tiago L', avatar_url: 'http://a' }));
    await expect(new GithubOAuthService(cfg()).obterUsuario('t')).resolves.toEqual({ login: 'tiago', nome: 'Tiago L', avatar: 'http://a' });
  });

  it('obterTeams filtra pela org e devolve slugs', async () => {
    (global as any).fetch = jest.fn(async () => okJson([
      { slug: 'curadoria', organization: { login: 'GDD-Core' } },
      { slug: 'outra', organization: { login: 'OutraOrg' } },
    ]));
    await expect(new GithubOAuthService(cfg()).obterTeams('t')).resolves.toEqual(['curadoria']);
  });

  it('obterUsuario sem name/avatar_url → cai para login e string vazia', async () => {
    (global as any).fetch = jest.fn(async () => okJson({ login: 'tiago', name: null, avatar_url: null }));
    await expect(new GithubOAuthService(cfg()).obterUsuario('t')).resolves.toEqual({ login: 'tiago', nome: 'tiago', avatar: '' });
  });

  it('obterTeams com payload não-array → []', async () => {
    (global as any).fetch = jest.fn(async () => okJson({ nao: 'é array' }));
    await expect(new GithubOAuthService(cfg()).obterTeams('t')).resolves.toEqual([]);
  });

  it('resposta não-ok do GitHub → erro', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(new GithubOAuthService(cfg()).obterUsuario('t')).rejects.toThrow();
  });

  it('obterTeams tolera resposta não-ok do GitHub → []', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    await expect(new GithubOAuthService(cfg()).obterTeams('t')).resolves.toEqual([]);
  });

  it('obterTeams tolera falha de rede → []', async () => {
    (global as any).fetch = jest.fn(async () => { throw new Error('network error'); });
    await expect(new GithubOAuthService(cfg()).obterTeams('t')).resolves.toEqual([]);
  });

  it('URLs derivam do host configurável (GitHub Enterprise Server)', () => {
    const svc = new GithubOAuthService(cfg({
      CURADORIA_BFF_GITHUB_BASE_URL: 'https://ghe.bradesco.com/',
      CURADORIA_BFF_GITHUB_API_URL: 'https://ghe.bradesco.com/api/v3/',
    }));
    const u = new URL(svc.urlAutorizacao('st'));
    expect(u.origin + u.pathname).toBe('https://ghe.bradesco.com/login/oauth/authorize');
  });

  it('obterUsuario usa o api host configurável (sem barra dupla)', async () => {
    const fetchMock = jest.fn(async () => okJson({ login: 'tiago', name: 'Tiago', avatar_url: '' }));
    (global as any).fetch = fetchMock;
    const svc = new GithubOAuthService(cfg({ CURADORIA_BFF_GITHUB_API_URL: 'https://ghe.bradesco.com/api/v3' }));
    await svc.obterUsuario('t');
    expect(fetchMock).toHaveBeenCalledWith('https://ghe.bradesco.com/api/v3/user', expect.anything());
  });

  it('autenticarComPat valida token e devolve usuário + teams', async () => {
    (global as any).fetch = jest.fn()
      .mockResolvedValueOnce(okJson({ login: 'tiago', name: 'Tiago', avatar_url: 'http://a' }))
      .mockResolvedValueOnce(okJson([{ slug: 'curadoria', organization: { login: 'GDD-Core' } }]));
    await expect(new GithubOAuthService(cfg()).autenticarComPat('ghp_x')).resolves.toEqual({
      login: 'tiago', nome: 'Tiago', avatar: 'http://a', teams: ['curadoria'],
    });
  });

  it('autenticarComPat propaga erro quando o token é inválido (401 no /user)', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(new GithubOAuthService(cfg()).autenticarComPat('ghp_ruim')).rejects.toThrow();
  });
});
