import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/main';

describe('App completo (e2e, upstreams off)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.LOG_BFF_DB_PATH = './data/test-app.db';
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    delete process.env.LOG_BFF_DB_PATH;
  });

  it('config reflete tudo desligado', async () => {
    const r = await request(app.getHttpServer()).get('/api/config');
    expect(r.body.agente_disponivel).toBe(false);
    expect(r.body.curadoria_disponivel).toBe(false);
  });

  it('diagnostico sem cache → 503 {detail}', async () => {
    const r = await request(app.getHttpServer()).post('/api/diagnostico').send({ message: 'x' });
    expect(r.status).toBe(503);
    expect(typeof r.body.detail).toBe('string');
  });

  it('serve o cockpit em /', async () => {
    const r = await request(app.getHttpServer()).get('/');
    expect(r.status).toBe(200);
    expect(r.text.toLowerCase()).toContain('<!doctype html');
  });

  it('health/live ok', async () => {
    expect((await request(app.getHttpServer()).get('/health/live')).body).toEqual({ status: 'ok' });
  });

  it('X-Request-ID presente numa resposta normal', async () => {
    const r = await request(app.getHttpServer()).get('/health/live');
    expect(r.status).toBe(200);
    expect(r.headers['x-request-id']).toBeDefined();
    expect(String(r.headers['x-request-id']).length).toBeGreaterThan(0);
  });

  it('GET /metrics expõe as métricas RED e os contadores de negócio', async () => {
    // garante ao menos um request passando pelo pipeline antes de consultar
    await request(app.getHttpServer()).get('/api/config');
    const r = await request(app.getHttpServer()).get('/metrics');
    expect(r.status).toBe(200);
    expect(r.text).toContain('http_requests_total');
    expect(r.text).toContain('http_request_duration_seconds_bucket');
    expect(r.text).toContain('http_requests_em_andamento');
    expect(r.text).toContain('diagnostico_total');
    expect(r.text).toContain('agente_diagnostico_total');
    expect(r.text).toContain('le="0.075"');
  });
});

describe('App completo — corpo acima do limite (413)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.LOG_BFF_DB_PATH = './data/test-app-413.db';
    process.env.LOG_BFF_MAX_BODY_BYTES = '100';
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    delete process.env.LOG_BFF_DB_PATH;
    delete process.env.LOG_BFF_MAX_BODY_BYTES;
  });

  it('POST com corpo > limite → 413 {detail} + X-Request-ID', async () => {
    const corpoGrande = { message: 'x'.repeat(500) };
    const r = await request(app.getHttpServer()).post('/api/diagnostico').send(corpoGrande);
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ detail: 'corpo da requisição excede o limite' });
    expect(r.headers['x-request-id']).toBeDefined();
  });
});
