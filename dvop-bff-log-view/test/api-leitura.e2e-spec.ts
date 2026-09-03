import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ConfigController } from '../src/api/config.controller';
import { EstadoController } from '../src/api/estado.controller';
import { LogsController } from '../src/api/logs.controller';
import { DetailExceptionFilter } from '../src/common/exception.filter';
import { APP_CONFIG } from '../src/config/env';
import { AgentixService } from '../src/agentix/agentix.service';
import { RetrievalService } from '../src/upstreams/retrieval.service';
import { CacheService } from '../src/upstreams/cache.service';
import { SrvLogService } from '../src/upstreams/srv-log.service';
import { RequestAuditService } from '../src/audit/request-audit.service';
import { UpstreamError } from '../src/common/upstream-error';

describe('API leitura (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ConfigController, EstadoController, LogsController],
      providers: [
        { provide: APP_CONFIG, useValue: { defaultSrvUrl: 'http://ms1', reviewUrl: 'http://ms7', allowedHosts: '' } },
        { provide: AgentixService, useValue: { enabled: true } },
        { provide: RetrievalService, useValue: { enabled: true, info: async () => ({ documentos: 5 }) } },
        { provide: CacheService, useValue: { writerEnabled: true, infoWriter: async () => ({ orfaos: 3, solucoes: 7 }) } },
        { provide: SrvLogService, useValue: { fetchLogs: async () => ({ items: [] }), fetchStats: async () => ({ total: 0 }) } },
        { provide: RequestAuditService, useValue: { record: () => 'deadbeef' } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('GET /api/config', async () => {
    const r = await request(app.getHttpServer()).get('/api/config');
    expect(r.body).toEqual({ default_src: 'http://ms1', curadoria_disponivel: true, fila_url: 'http://ms7', agente_disponivel: true });
  });
  it('GET /api/estado agrega', async () => {
    const r = await request(app.getHttpServer()).get('/api/estado');
    expect(r.body.base).toBe(5); expect(r.body.fila).toBe(3); expect(r.body.cache).toBe(7);
  });
  it('GET /api/logs devolve X-Srv-Request-Hash', async () => {
    const r = await request(app.getHttpServer()).get('/api/logs?src=http://ms1:8000&limit=10');
    expect(r.status).toBe(200); expect(r.headers['x-srv-request-hash']).toBe('deadbeef');
  });
});

describe('API leitura — /api/config variações', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [
        { provide: APP_CONFIG, useValue: { defaultSrvUrl: 'http://ms1', reviewUrl: '', allowedHosts: '' } },
        { provide: AgentixService, useValue: { enabled: false } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('reviewUrl vazio + agentix desabilitado → curadoria_disponivel:false, fila_url:"", agente_disponivel:false', async () => {
    const r = await request(app.getHttpServer()).get('/api/config');
    expect(r.body).toEqual({ default_src: 'http://ms1', curadoria_disponivel: false, fila_url: '', agente_disponivel: false });
  });
});

describe('API leitura — /api/estado degradação', () => {
  let app: INestApplication;
  let writerInfo: jest.Mock;
  let retrievalInfo: jest.Mock;
  beforeAll(async () => {
    writerInfo = jest.fn();
    retrievalInfo = jest.fn();
    const mod = await Test.createTestingModule({
      controllers: [EstadoController],
      providers: [
        { provide: RetrievalService, useValue: { enabled: true, info: retrievalInfo } },
        { provide: CacheService, useValue: { writerEnabled: true, infoWriter: writerInfo } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { writerInfo.mockReset(); retrievalInfo.mockReset(); });

  it('infoWriter() (MS5) rejeita com UpstreamError → curadoria ok:false, fila/cache continuam null', async () => {
    writerInfo.mockRejectedValueOnce(new UpstreamError(502, 'MS5 indisponível'));
    retrievalInfo.mockResolvedValueOnce({ documentos: 9 });
    const r = await request(app.getHttpServer()).get('/api/estado');
    expect(r.status).toBe(200);
    expect(r.body.fila).toBeNull();
    expect(r.body.cache).toBeNull();
    expect(r.body.base).toBe(9);
    expect(r.body.servicos).toEqual(expect.arrayContaining([
      { nome: 'curadoria', ok: false },
      { nome: 'base', ok: true },
    ]));
  });

  it('retrieval.info() rejeita com UpstreamError → base ok:false, base continua null', async () => {
    writerInfo.mockResolvedValueOnce({ orfaos: 1, solucoes: 2 });
    retrievalInfo.mockRejectedValueOnce(new UpstreamError(502, 'base indisponível'));
    const r = await request(app.getHttpServer()).get('/api/estado');
    expect(r.status).toBe(200);
    expect(r.body.fila).toBe(1);
    expect(r.body.cache).toBe(2);
    expect(r.body.base).toBeNull();
    expect(r.body.servicos).toEqual(expect.arrayContaining([
      { nome: 'curadoria', ok: true },
      { nome: 'base', ok: false },
    ]));
  });

  it('infoWriter() (MS5) rejeita com erro NÃO-UpstreamError → propaga (500 via filtro)', async () => {
    writerInfo.mockRejectedValueOnce(new Error('falha inesperada'));
    retrievalInfo.mockResolvedValueOnce({ documentos: 1 });
    const r = await request(app.getHttpServer()).get('/api/estado');
    expect(r.status).toBe(500);
  });

  it('retrieval.info() rejeita com erro NÃO-UpstreamError → propaga (500 via filtro)', async () => {
    writerInfo.mockResolvedValueOnce({ orfaos: 1, solucoes: 2 });
    retrievalInfo.mockRejectedValueOnce(new Error('falha inesperada'));
    const r = await request(app.getHttpServer()).get('/api/estado');
    expect(r.status).toBe(500);
  });

  it('quando info() traz chaves faltando, campos são coalescidos para null (não undefined) no JSON', async () => {
    writerInfo.mockResolvedValueOnce({});
    retrievalInfo.mockResolvedValueOnce({});
    const r = await request(app.getHttpServer()).get('/api/estado');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('fila', null);
    expect(r.body).toHaveProperty('cache', null);
    expect(r.body).toHaveProperty('base', null);
    expect(Object.prototype.hasOwnProperty.call(r.body, 'fila')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(r.body, 'cache')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(r.body, 'base')).toBe(true);
  });
});

describe('API leitura — /api/estado ambos serviços desabilitados', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [EstadoController],
      providers: [
        { provide: RetrievalService, useValue: { enabled: false, info: async () => ({}) } },
        { provide: CacheService, useValue: { writerEnabled: false, infoWriter: async () => ({}) } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('retorna fila/cache/base null e servicos vazio', async () => {
    const r = await request(app.getHttpServer()).get('/api/estado');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ fila: null, cache: null, base: null, servicos: [] });
  });
});

describe('API leitura — /api/logs e /api/stats', () => {
  let app: INestApplication;
  let fetchLogs: jest.Mock;
  let fetchStats: jest.Mock;
  let record: jest.Mock;
  beforeAll(async () => {
    fetchLogs = jest.fn(async () => ({ items: [] }));
    fetchStats = jest.fn(async () => ({ total: 42 }));
    record = jest.fn(() => 'cafebabe');
    const mod = await Test.createTestingModule({
      controllers: [LogsController],
      providers: [
        { provide: APP_CONFIG, useValue: { defaultSrvUrl: 'http://ms1', reviewUrl: 'http://ms7', allowedHosts: 'ms1' } },
        { provide: SrvLogService, useValue: { fetchLogs, fetchStats } },
        { provide: RequestAuditService, useValue: { record } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { fetchLogs.mockClear(); fetchStats.mockClear(); record.mockClear(); });

  it('GET /api/stats — devolve corpo do upstream e seta X-Srv-Request-Hash', async () => {
    const r = await request(app.getHttpServer()).get('/api/stats?src=http://ms1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ total: 42 });
    expect(r.headers['x-srv-request-hash']).toBe('cafebabe');
    expect(record).toHaveBeenCalledWith('GET', 'http://ms1/v1/stats', null);
    expect(fetchStats).toHaveBeenCalledWith('http://ms1');
  });

  it('GET /api/logs — host fora da allowlist → 403 {detail}', async () => {
    const r = await request(app.getHttpServer()).get('/api/logs?src=http://outrohost:8000');
    expect(r.status).toBe(403);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/stats — host fora da allowlist → 403 {detail}', async () => {
    const r = await request(app.getHttpServer()).get('/api/stats?src=http://outrohost:8000');
    expect(r.status).toBe(403);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/logs — src malformado → 422 {detail}', async () => {
    const r = await request(app.getHttpServer()).get('/api/logs?src=not%20a%20url');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/logs — src ausente → 422', async () => {
    const r = await request(app.getHttpServer()).get('/api/logs');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/stats — src malformado → 422 {detail}', async () => {
    const r = await request(app.getHttpServer()).get('/api/stats?src=nope');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/logs — filtros parciais: params undefined/null são descartados antes de record/fetchLogs', async () => {
    const r = await request(app.getHttpServer()).get('/api/logs?src=http://ms1&level=ERROR');
    expect(r.status).toBe(200);
    const paramsArg = record.mock.calls[0][2];
    expect(paramsArg).toEqual({ level: 'ERROR', limit: 50, offset: 0 });
    expect(paramsArg).not.toHaveProperty('service');
    expect(paramsArg).not.toHaveProperty('q');
    expect(paramsArg).not.toHaveProperty('since');
    expect(paramsArg).not.toHaveProperty('until');
    expect(fetchLogs).toHaveBeenCalledWith('http://ms1', paramsArg);
  });

  it('GET /api/logs — todos os filtros presentes são repassados', async () => {
    const r = await request(app.getHttpServer()).get(
      '/api/logs?src=http://ms1&level=WARN&service=svc&q=texto&since=2024-01-01&until=2024-01-02&limit=5&offset=2',
    );
    expect(r.status).toBe(200);
    const paramsArg = record.mock.calls[0][2];
    expect(paramsArg).toEqual({ level: 'WARN', service: 'svc', q: 'texto', since: '2024-01-01', until: '2024-01-02', limit: 5, offset: 2 });
  });

  it('GET /api/logs — limit inválido (fora do range) → 422', async () => {
    const r = await request(app.getHttpServer()).get('/api/logs?src=http://ms1&limit=9999');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/logs — limit não-numérico → 422', async () => {
    const r = await request(app.getHttpServer()).get('/api/logs?src=http://ms1&limit=abc');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });
});
