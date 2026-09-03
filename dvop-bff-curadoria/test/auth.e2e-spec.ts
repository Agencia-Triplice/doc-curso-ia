import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { APP_CONFIG, CuradoriaConfig, loadConfig } from '../src/config/env';
import { DetailExceptionFilter } from '../src/common/exception.filter';
import { SessionService } from '../src/auth/session.service';
import { GithubOAuthService } from '../src/auth/github-oauth.service';
import { RemediationService } from '../src/upstreams/remediation.service';
import { AuthController } from '../src/auth/auth.controller';

async function criar(over: Record<string, string> = {}): Promise<{ app: INestApplication; cfg: CuradoriaConfig }> {
  const cfg = loadConfig({
    CURADORIA_BFF_MS5_URL: 'http://ms5',
    CURADORIA_BFF_SESSION_SECRET: 's3gr3d0',
    CURADORIA_BFF_GITHUB_CLIENT_ID: 'cid',
    CURADORIA_BFF_GITHUB_CLIENT_SECRET: 'sec',
    CURADORIA_BFF_GITHUB_CALLBACK_URL: 'https://curadoria.example/auth/callback',
    ...over,
  } as any);
  const mod = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: APP_CONFIG, useValue: cfg },
      { provide: SessionService, useValue: new SessionService(cfg) },
      { provide: GithubOAuthService, useValue: new GithubOAuthService(cfg) },
      { provide: RemediationService, useValue: new RemediationService(cfg) },
      { provide: APP_FILTER, useClass: DetailExceptionFilter },
    ],
  }).compile();
  const app = mod.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
  await app.init();
  return { app, cfg };
}

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  afterEach(async () => { (global as any).fetch = undefined; if (app) await app.close(); });

  it('GET /v1/me sem sessão → 401 {detail}', async () => {
    ({ app } = await criar());
    const r = await request(app.getHttpServer()).get('/v1/me');
    expect(r.status).toBe(401);
    expect(r.body.detail).toBe('não autenticado');
  });

  it('GET /auth/config expõe github/pat', async () => {
    ({ app } = await criar());
    const r = await request(app.getHttpServer()).get('/auth/config');
    expect(r.body).toEqual({ github: true, pat: true });
  });

  it('GET /auth/config: pat sempre true mesmo sem OAuth configurado', async () => {
    ({ app } = await criar({ CURADORIA_BFF_GITHUB_CLIENT_ID: '' }));
    const r = await request(app.getHttpServer()).get('/auth/config');
    expect(r.body).toEqual({ github: false, pat: true });
  });

  it('POST /auth/pat valida no github, cria sessão via github e /v1/me responde', async () => {
    ({ app } = await criar());
    (global as any).fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ login: 'tiago', name: 'Tiago', avatar_url: 'http://a' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ slug: 'curadoria', organization: { login: 'GDD-Core' } }]) });
    const r1 = await request(app.getHttpServer()).post('/auth/pat').send({ token: 'ghp_valido' });
    expect(r1.status).toBe(204);
    const cookie = r1.headers['set-cookie'][0];
    const r2 = await request(app.getHttpServer()).get('/v1/me').set('Cookie', cookie);
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ nome: 'Tiago', via: 'github', teams: ['curadoria'] });
  });

  it('POST /auth/pat com token inválido no github → 401 sem criar sessão', async () => {
    ({ app } = await criar());
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const r = await request(app.getHttpServer()).post('/auth/pat').send({ token: 'ghp_ruim' });
    expect(r.status).toBe(401);
    expect(r.body.detail).toBe('token inválido');
    const setCookie = r.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie || '');
    expect(cookies).not.toContain('curadoria_sess=');
  });

  it('POST /auth/pat com token vazio → 422 (falha no @Length)', async () => {
    ({ app } = await criar());
    const r = await request(app.getHttpServer()).post('/auth/pat').send({ token: '' });
    expect(r.status).toBe(422);
  });

  it('POST /auth/pat com token só-de-espaços → 422 (guard do vazio-após-trim)', async () => {
    ({ app } = await criar());
    const r = await request(app.getHttpServer()).post('/auth/pat').send({ token: '   ' });
    expect(r.status).toBe(422);
    expect(r.body.detail).toBe('informe um token');
  });

  it('POST /auth/pat com MS8 ligado e credencial AUSENTE → arma a credencial com o PAT', async () => {
    ({ app } = await criar({ CURADORIA_BFF_MS8_URL: 'http://ms8' }));
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ login: 'tiago', name: 'Tiago', avatar_url: 'http://a' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ slug: 'curadoria', organization: { login: 'GDD-Core' } }]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ presente: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ presente: true, origem: 'runtime' }) });
    (global as any).fetch = fetchMock;
    const r = await request(app.getHttpServer()).post('/auth/pat').send({ token: 'ghp_escrita' });
    expect(r.status).toBe(204);
    const put = fetchMock.mock.calls.find((c: any[]) => c[0] === 'http://ms8/v1/credencial' && c[1]?.method === 'PUT');
    expect(put).toBeDefined();
    expect(JSON.parse(put![1].body)).toEqual({ token: 'ghp_escrita' });
  });

  it('POST /auth/pat com MS8 ligado e credencial PRESENTE → NÃO sobrescreve', async () => {
    ({ app } = await criar({ CURADORIA_BFF_MS8_URL: 'http://ms8' }));
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ login: 'tiago', name: 'Tiago', avatar_url: 'http://a' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ slug: 'curadoria', organization: { login: 'GDD-Core' } }]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ presente: true, origem: 'runtime' }) });
    (global as any).fetch = fetchMock;
    const r = await request(app.getHttpServer()).post('/auth/pat').send({ token: 'ghp_escrita' });
    expect(r.status).toBe(204);
    const put = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'PUT');
    expect(put).toBeUndefined();
  });

  it('POST /auth/pat: falha ao armar a credencial NÃO derruba o login (204)', async () => {
    ({ app } = await criar({ CURADORIA_BFF_MS8_URL: 'http://ms8' }));
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ login: 'tiago', name: 'Tiago', avatar_url: 'http://a' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockRejectedValueOnce(new Error('ms8 fora do ar'));
    (global as any).fetch = fetchMock;
    const r = await request(app.getHttpServer()).post('/auth/pat').send({ token: 'ghp_escrita' });
    expect(r.status).toBe(204);
  });

  it('GET /auth/github redireciona ao github com state em cookie', async () => {
    ({ app } = await criar());
    const r = await request(app.getHttpServer()).get('/auth/github');
    expect(r.status).toBe(302);
    expect(r.headers.location).toContain('github.com/login/oauth/authorize');
    expect(r.headers['set-cookie'][0]).toContain('curadoria_oauth_state=');
  });

  it('GET /auth/callback: troca code, monta sessão com teams e redireciona /', async () => {
    ({ app } = await criar());
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'gho' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ login: 'tiago', name: 'Tiago', avatar_url: 'http://a' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ slug: 'curadoria', organization: { login: 'GDD-Core' } }]) });
    (global as any).fetch = fetchMock;
    const agent = request.agent(app.getHttpServer());
    const start = await agent.get('/auth/github');
    const state = /curadoria_oauth_state=([^;]+)/.exec(start.headers['set-cookie'][0])![1];
    const cb = await agent.get(`/auth/callback?code=c1&state=${state}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/');
    const sess = /curadoria_sess=([^;]+)/.exec((cb.headers['set-cookie'] as unknown as string[]).join(';'));
    expect(sess).not.toBeNull();
  });

  it('GET /auth/github sem client id configurado → redireciona /?erro=github_indisponivel', async () => {
    ({ app } = await criar({ CURADORIA_BFF_GITHUB_CLIENT_ID: '' }));
    const r = await request(app.getHttpServer()).get('/auth/github');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/?erro=github_indisponivel');
  });

  it('GET /auth/callback: falha na troca com o github → redireciona /?erro=login_falhou sem criar sessão', async () => {
    ({ app } = await criar());
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('github fora do ar'));
    const agent = request.agent(app.getHttpServer());
    const start = await agent.get('/auth/github');
    const state = /curadoria_oauth_state=([^;]+)/.exec(start.headers['set-cookie'][0])![1];
    const cb = await agent.get(`/auth/callback?code=c1&state=${state}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/?erro=login_falhou');
    const setCookie = cb.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie || '');
    expect(cookies).not.toContain('curadoria_sess=');
  });

  it('GET /auth/callback com state divergente → redireciona /?erro sem criar sessão', async () => {
    ({ app } = await criar());
    const r = await request(app.getHttpServer())
      .get('/auth/callback?code=c1&state=falso')
      .set('Cookie', 'curadoria_oauth_state=verdadeiro');
    expect(r.status).toBe(302);
    expect(r.headers.location).toContain('erro=');
    const setCookie = r.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie || '');
    expect(cookies).not.toContain('curadoria_sess=');
  });

  it('POST /auth/logout limpa o cookie', async () => {
    ({ app } = await criar());
    const r = await request(app.getHttpServer()).post('/auth/logout');
    expect(r.status).toBe(204);
    expect((r.headers['set-cookie'] as unknown as string[]).join(';')).toContain('curadoria_sess=;');
  });
});
