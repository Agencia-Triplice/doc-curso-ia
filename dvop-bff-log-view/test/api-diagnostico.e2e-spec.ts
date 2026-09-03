import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DiagnosticoController } from '../src/api/diagnostico.controller';
import { DiagnosticoService } from '../src/diagnostico/diagnostico.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { DetailExceptionFilter } from '../src/common/exception.filter';

describe('API diagnostico (e2e)', () => {
  let app: INestApplication; let metrics: MetricsService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [DiagnosticoController],
      providers: [
        MetricsService,
        { provide: DiagnosticoService, useValue: { diagnosticar: async () => ({ resultado: 'cache_exato' }) } },
      ],
    }).compile();
    metrics = mod.get(MetricsService);
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('POST /api/diagnostico conta métrica', async () => {
    const r = await request(app.getHttpServer()).post('/api/diagnostico').send({ message: 'erro' });
    expect(r.status).toBe(200);
    expect(r.body.resultado).toBe('cache_exato');
    expect((await metrics.exportar()).body).toContain('diagnostico_total');
  });
});

describe('POST /api/diagnostico — desfechos e métricas', () => {
  let app: INestApplication; let metrics: MetricsService; let diagnosticar: jest.Mock;
  beforeAll(async () => {
    diagnosticar = jest.fn();
    const mod = await Test.createTestingModule({
      controllers: [DiagnosticoController],
      providers: [
        MetricsService,
        { provide: DiagnosticoService, useValue: { diagnosticar } },
      ],
    }).compile();
    metrics = mod.get(MetricsService);
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { diagnosticar.mockReset(); });

  it('erro antes do desfecho → propaga E conta resultado="erro" na métrica', async () => {
    diagnosticar.mockRejectedValueOnce(new Error('falha upstream'));
    const r = await request(app.getHttpServer()).post('/api/diagnostico').send({ message: 'erro grave' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const body = (await metrics.exportar()).body;
    expect(body).toMatch(/diagnostico_total\{resultado="erro"[^}]*\}\s+1/);
  });

  it('degradado:true → Boolean(resp.degradado) true e label degradado="true" na métrica', async () => {
    diagnosticar.mockResolvedValueOnce({ resultado: 'sem_solucao', degradado: true });
    const r = await request(app.getHttpServer()).post('/api/diagnostico').send({ message: 'erro' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ resultado: 'sem_solucao', degradado: true });
    const body = (await metrics.exportar()).body;
    expect(body).toMatch(/diagnostico_total\{resultado="sem_solucao",degradado="true"\}\s+1/);
  });

  it('desfecho normal sem degradado → label degradado="false"', async () => {
    diagnosticar.mockResolvedValueOnce({ resultado: 'cache_exato' });
    const r = await request(app.getHttpServer()).post('/api/diagnostico').send({ message: 'erro', service: 'svc', level: 'ERROR' });
    expect(r.status).toBe(200);
    const body = (await metrics.exportar()).body;
    expect(body).toMatch(/diagnostico_total\{resultado="cache_exato",degradado="false"\}\s+1/);
  });
});

describe('Validação de DTOs', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [DiagnosticoController],
      providers: [
        MetricsService,
        { provide: DiagnosticoService, useValue: { diagnosticar: async () => ({ resultado: 'cache_exato' }) } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('POST /api/diagnostico sem message → 422', async () => {
    const r = await request(app.getHttpServer()).post('/api/diagnostico').send({});
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('POST /api/diagnostico com message vazia → 422', async () => {
    const r = await request(app.getHttpServer()).post('/api/diagnostico').send({ message: '' });
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('POST /api/diagnostico com origem_run.html_url de esquema inválido → 422', async () => {
    const r = await request(app.getHttpServer()).post('/api/diagnostico')
      .send({ message: 'erro', origem_run: { run_id: 1, html_url: 'javascript:alert(1)' } });
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('POST /api/diagnostico com origem_run.html_url http:// segue aceito (200)', async () => {
    const r = await request(app.getHttpServer()).post('/api/diagnostico')
      .send({ message: 'erro', origem_run: { run_id: 1, html_url: 'http://gh/runs/1' } });
    expect(r.status).toBe(200);
  });
});
