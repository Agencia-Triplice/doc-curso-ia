import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { CredencialController } from '../src/api/credencial.controller';
import { McpGithubService } from '../src/upstreams/mcp-github.service';
import { APP_CONFIG } from '../src/config/env';
import { DetailExceptionFilter } from '../src/common/exception.filter';
import { UpstreamError } from '../src/common/upstream-error';
import { AuthGuard } from '../src/auth/auth.guard';
import { SessionService } from '../src/auth/session.service';

describe('CredencialController (e2e)', () => {
  let app: INestApplication;
  // segunda app com o AuthGuard REAL (sem dev-user) só para provar os 401
  let appSemSessao: INestApplication;
  // terceira app com o gateway desligado, para o 503 honesto
  let appSemGw: INestApplication;

  const gw = {
    enabled: true,
    obterCredencial: jest.fn(),
    armarCredencial: jest.fn(),
    desarmarCredencial: jest.fn(),
  };
  const gwOff = { ...gw, enabled: false };

  const cfg = { sessionSecret: 'test', sessionTtl: 3600, authDevUser: 'test', production: false, githubAllowedTeams: [] as string[] };
  const cfgSemSessao = { ...cfg, authDevUser: '', production: true };

  async function subir(gateway: unknown, config: unknown): Promise<INestApplication> {
    const mod = await Test.createTestingModule({
      controllers: [CredencialController],
      providers: [
        { provide: McpGithubService, useValue: gateway },
        { provide: APP_CONFIG, useValue: config },
        { provide: SessionService, inject: [APP_CONFIG], useFactory: (c: any) => new SessionService(c) },
        AuthGuard,
      ],
    }).compile();
    const a = mod.createNestApplication();
    a.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    a.useGlobalFilters(new DetailExceptionFilter());
    await a.init();
    return a;
  }

  beforeAll(async () => {
    app = await subir(gw, cfg);
    appSemSessao = await subir(gw, cfgSemSessao);
    appSemGw = await subir(gwOff, cfg);
  });

  afterAll(async () => {
    await app.close();
    await appSemSessao.close();
    await appSemGw.close();
  });

  afterEach(() => jest.clearAllMocks());

  it('GET /v1/credencial → 200 repassa o estado do gateway', async () => {
    gw.obterCredencial.mockResolvedValueOnce({ presente: true, origem: 'operador', login: 'tiago', definido_em: '2026-08-07T18:30:00Z' });
    const r = await request(app.getHttpServer()).get('/v1/credencial');
    expect(r.status).toBe(200);
    expect(r.body.origem).toBe('operador');
    expect(r.body.login).toBe('tiago');
  });

  it('PUT /v1/credencial → 200 e manda o token adiante', async () => {
    gw.armarCredencial.mockResolvedValueOnce({ presente: true, origem: 'operador', login: 'tiago' });
    const r = await request(app.getHttpServer()).put('/v1/credencial').send({ token: 'ghp_bom' });
    expect(r.status).toBe(200);
    expect(gw.armarCredencial).toHaveBeenCalledWith('ghp_bom');
  });

  it('PUT /v1/credencial → a resposta ao operador nunca devolve o token', async () => {
    gw.armarCredencial.mockResolvedValueOnce({ presente: true, origem: 'operador', login: 'tiago' });
    const r = await request(app.getHttpServer()).put('/v1/credencial').send({ token: 'ghp_segredo' });
    expect(JSON.stringify(r.body)).not.toContain('ghp_segredo');
  });

  it('PUT /v1/credencial → 400 quando o GitHub recusa (repassa o status do gateway)', async () => {
    gw.armarCredencial.mockRejectedValueOnce(new UpstreamError(400, 'github recusou a credencial (respondeu 401)'));
    const r = await request(app.getHttpServer()).put('/v1/credencial').send({ token: 'ghp_morto' });
    expect(r.status).toBe(400);
    expect(r.body.detail).toContain('401');
  });

  it('PUT /v1/credencial → 422 sem token, sem chamar o gateway', async () => {
    const r = await request(app.getHttpServer()).put('/v1/credencial').send({});
    expect(r.status).toBe(422);
    expect(gw.armarCredencial).not.toHaveBeenCalled();
  });

  it('PUT /v1/credencial → 422 com token acima de 512 caracteres', async () => {
    const r = await request(app.getHttpServer()).put('/v1/credencial').send({ token: 'x'.repeat(513) });
    expect(r.status).toBe(422);
    expect(gw.armarCredencial).not.toHaveBeenCalled();
  });

  it('DELETE /v1/credencial → 200 e desarma no gateway', async () => {
    gw.desarmarCredencial.mockResolvedValueOnce({ presente: false, origem: 'ausente' });
    const r = await request(app.getHttpServer()).delete('/v1/credencial');
    expect(r.status).toBe(200);
    expect(r.body.origem).toBe('ausente');
    expect(gw.desarmarCredencial).toHaveBeenCalled();
  });

  it('erro upstream não-UpstreamError sobe como 500, sem virar 200 mudo', async () => {
    gw.obterCredencial.mockRejectedValueOnce(new Error('boom'));
    const r = await request(app.getHttpServer()).get('/v1/credencial');
    expect(r.status).toBe(500);
  });

  describe('sem gateway configurado', () => {
    it.each([
      ['get', '/v1/credencial'],
      ['delete', '/v1/credencial'],
    ])('%s → 503 (não confunde "sem credencial" com "sem gateway")', async (metodo, rota) => {
      const r = await (request(appSemGw.getHttpServer()) as any)[metodo](rota);
      expect(r.status).toBe(503);
      expect(r.body.detail).toContain('CURADORIA_BFF_MCP_GITHUB_URL');
    });

    it('PUT → 503', async () => {
      const r = await request(appSemGw.getHttpServer()).put('/v1/credencial').send({ token: 'ghp_bom' });
      expect(r.status).toBe(503);
      expect(gw.armarCredencial).not.toHaveBeenCalled();
    });
  });

  describe('sem sessão', () => {
    it('GET → 401', async () => {
      const r = await request(appSemSessao.getHttpServer()).get('/v1/credencial');
      expect(r.status).toBe(401);
      expect(gw.obterCredencial).not.toHaveBeenCalled();
    });

    it('PUT → 401 (armar credencial de escrita é ação de curador)', async () => {
      const r = await request(appSemSessao.getHttpServer()).put('/v1/credencial').send({ token: 'ghp_bom' });
      expect(r.status).toBe(401);
      expect(gw.armarCredencial).not.toHaveBeenCalled();
    });

    it('DELETE → 401', async () => {
      const r = await request(appSemSessao.getHttpServer()).delete('/v1/credencial');
      expect(r.status).toBe(401);
      expect(gw.desarmarCredencial).not.toHaveBeenCalled();
    });
  });
});
