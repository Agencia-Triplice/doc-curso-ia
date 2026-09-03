import { Test } from '@nestjs/testing';
import { INestApplication, Controller, Get } from '@nestjs/common';
import { EventEmitter } from 'events';
import request from 'supertest';
import { AccessLogInterceptor } from '../src/common/access-log.interceptor';
import { MetricsService } from '../src/metrics/metrics.service';

@Controller() class Ping { @Get('api/logs') p() { return { ok: 1 }; } }
@Controller() class Boom { @Get('api/estado') e() { throw new Error('falhou'); } }

describe('AccessLogInterceptor', () => {
  let app: INestApplication; let metrics: MetricsService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [Ping, Boom], providers: [MetricsService] }).compile();
    metrics = mod.get(MetricsService);
    app = mod.createNestApplication();
    app.useGlobalInterceptors(new AccessLogInterceptor(metrics));
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('adiciona X-Request-ID e conta RED', async () => {
    const res = await request(app.getHttpServer()).get('/api/logs');
    expect(res.headers['x-request-id']).toBeTruthy();
    const { body } = await metrics.exportar();
    expect(body).toContain('rota="/api/logs"');
  });
  it('conta o status FINAL de uma requisição que lança (500, não 200)', async () => {
    // /api/estado lança → exception filter default do Nest devolve 500; o RED
    // só registra 500 se lermos res.statusCode no 'finish' (o filtro já rodou).
    await request(app.getHttpServer()).get('/api/estado');
    const { body } = await metrics.exportar();
    expect(body).toContain('rota="/api/estado"');
    expect(body).toContain('status="500"');
  });

  it('método fora do conjunto HTTP conhecido é rotulado como "outro"', () => {
    const metrics2 = new MetricsService();
    const spy = jest.spyOn(metrics2, 'observarHttp');
    const interceptor = new AccessLogInterceptor(metrics2);
    const res: any = new EventEmitter();
    res.statusCode = 200;
    res.setHeader = jest.fn();
    const req: any = { method: 'WEIRD', path: '/api/logs', headers: {} };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
    interceptor.intercept(ctx, { handle: () => ({}) } as any);
    res.emit('finish');
    expect(spy).toHaveBeenCalledWith('outro', expect.any(String), 200, expect.any(Number));
  });

  it('traceparent válido num path não-ruído é extraído e logado', () => {
    const metrics3 = new MetricsService();
    const interceptor = new AccessLogInterceptor(metrics3);
    const res: any = new EventEmitter();
    res.statusCode = 200;
    res.setHeader = jest.fn();
    const req: any = {
      method: 'GET',
      path: '/api/logs',
      headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
    };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      interceptor.intercept(ctx, { handle: () => ({}) } as any);
      res.emit('finish');
      const logged = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(logged).toContain('"trace_id":"4bf92f3577b34da6a3ce929d0e0e4736"');
    } finally {
      writeSpy.mockRestore();
    }
  });
});
