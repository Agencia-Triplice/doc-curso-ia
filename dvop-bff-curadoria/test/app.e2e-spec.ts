import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/main';
import { loadConfig } from '../src/config/env';
import { CuradorWorker } from '../src/curador/curador.worker';

// Sobe o AppModule inteiro via createApp() — mesma fiação do runtime. Com o env
// limpo (só o DB forçado em memória), loadConfig() dá ms3Url='', ms8Url='' e
// Agentix vazio: MS3/MS8 desligados e worker desabilitado (sem timers em
// background), então nenhuma chamada de rede sai daqui.
describe('App completo (e2e, upstreams off)', () => {
  let app: INestApplication;
  const prevDb = process.env.CURADORIA_BFF_ELEGIBILIDADE_DB_PATH;
  const prevDevUser = process.env.CURADORIA_BFF_AUTH_DEV_USER;

  beforeAll(async () => {
    process.env.CURADORIA_BFF_ELEGIBILIDADE_DB_PATH = ':memory:';
    // /v1/documentos e /v1/remediacoes agora exigem auth (AuthGuard nas
    // rotas de dados) — dev-user destrava sem precisar de cookie de sessão.
    process.env.CURADORIA_BFF_AUTH_DEV_USER = 'test';
    app = await createApp(loadConfig());
  });

  afterAll(async () => {
    await app.close();
    if (prevDb === undefined) delete process.env.CURADORIA_BFF_ELEGIBILIDADE_DB_PATH;
    else process.env.CURADORIA_BFF_ELEGIBILIDADE_DB_PATH = prevDb;
    if (prevDevUser === undefined) delete process.env.CURADORIA_BFF_AUTH_DEV_USER;
    else process.env.CURADORIA_BFF_AUTH_DEV_USER = prevDevUser;
  });

  it('GET /v1/documentos → 503 (MS3 off, mensagem verbatim)', async () => {
    const r = await request(app.getHttpServer()).get('/v1/documentos');
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe('base de conhecimento indisponível: configure CURADORIA_BFF_MS3_URL');
  });

  it('GET /v1/remediacoes → 503 (MS8 off, mensagem verbatim)', async () => {
    const r = await request(app.getHttpServer()).get('/v1/remediacoes');
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe('remediação indisponível: configure CURADORIA_BFF_MS8_URL');
  });

  it('GET / serve o front estático da fila', async () => {
    const r = await request(app.getHttpServer()).get('/');
    expect(r.status).toBe(200);
    const html = r.text.toLowerCase();
    expect(html.includes('<!doctype html') || html.includes('<html')).toBe(true);
  });

  it('GET /health/live → 200 {status:ok}', async () => {
    const r = await request(app.getHttpServer()).get('/health/live');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready → 200 {status:ok} (store :memory: responde)', async () => {
    const r = await request(app.getHttpServer()).get('/health/ready');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('X-Request-ID presente numa resposta normal', async () => {
    const r = await request(app.getHttpServer()).get('/health/live');
    expect(r.status).toBe(200);
    expect(r.headers['x-request-id']).toBeDefined();
    expect(String(r.headers['x-request-id']).length).toBeGreaterThan(0);
  });

  it('GET /metrics → 200 com as famílias RED e de negócio', async () => {
    // garante ao menos um request passando pelo pipeline antes de consultar
    await request(app.getHttpServer()).get('/health/live');
    const r = await request(app.getHttpServer()).get('/metrics');
    expect(r.status).toBe(200);
    expect(r.text).toContain('http_requests_total');
    expect(r.text).toContain('curadoria_total');
    expect(r.text).toContain('curador_ciclos_total');
    expect(r.text).toContain('curador_rascunhos_total');
    expect(r.text).toContain('elegibilidade_total');
  });

  it('worker NÃO subiu loop: Agentix off → CuradorWorker.enabled === false', () => {
    expect(app.get(CuradorWorker).enabled).toBe(false);
  });
});

// App dedicado com limite de corpo pequeno: evita ter que mandar um payload de
// megabytes para estourar o default (2 MiB). O 413 dispara no parser/
// BodyLimitMiddleware ANTES do controller, então nenhum upstream (MS5) é
// chamado — não precisa mockar nada além do DB em memória.
describe('App completo — corpo acima do limite (413)', () => {
  let app: INestApplication;
  const prevDb = process.env.CURADORIA_BFF_ELEGIBILIDADE_DB_PATH;
  const prevMaxBody = process.env.CURADORIA_BFF_MAX_BODY_BYTES;

  beforeAll(async () => {
    process.env.CURADORIA_BFF_ELEGIBILIDADE_DB_PATH = ':memory:';
    process.env.CURADORIA_BFF_MAX_BODY_BYTES = '1024';
    app = await createApp(loadConfig());
  });

  afterAll(async () => {
    await app.close();
    if (prevDb === undefined) delete process.env.CURADORIA_BFF_ELEGIBILIDADE_DB_PATH;
    else process.env.CURADORIA_BFF_ELEGIBILIDADE_DB_PATH = prevDb;
    if (prevMaxBody === undefined) delete process.env.CURADORIA_BFF_MAX_BODY_BYTES;
    else process.env.CURADORIA_BFF_MAX_BODY_BYTES = prevMaxBody;
  });

  it('PUT /v1/fila/:fingerprint/rascunho com corpo > limite → 413 {detail} + X-Request-ID', async () => {
    const corpoGrande = { solucao: 'x'.repeat(2000) };
    const r = await request(app.getHttpServer()).put('/v1/fila/abc123/rascunho').send(corpoGrande);
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ detail: 'corpo da requisição excede o limite' });
    expect(r.headers['x-request-id']).toBeDefined();
  });
});
