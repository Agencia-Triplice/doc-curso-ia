import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { EligibilityController } from '../src/api/eligibility.controller';
import { EligibilityReadController } from '../src/api/eligibility-read.controller';
import { CacheWriterService } from '../src/upstreams/cache-writer.service';
import { RemediationService } from '../src/upstreams/remediation.service';
import { EligibilityStore } from '../src/eligibility/eligibility-store.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { DetailExceptionFilter } from '../src/common/exception.filter';
import { APP_CONFIG } from '../src/config/env';
import { AuthGuard } from '../src/auth/auth.guard';
import { SessionService } from '../src/auth/session.service';

// AuthGuard REAL ligado (production:true, sem authDevUser): trava a regressão
// que quebrava o PR automático — a leitura interna do MS 8 fica FORA do guard,
// enquanto as ações de curadoria seguem exigindo sessão.
describe('Elegibilidade — leitura interna fora do AuthGuard (e2e)', () => {
  let app: INestApplication;

  const store = { get: jest.fn(), list: jest.fn(), count: jest.fn(), upsert: jest.fn(), delete: jest.fn() };
  const ms5 = { obterOrfao: jest.fn(), obterSolucao: jest.fn() };
  const ms8 = { enabled: true, listarRemediacoes: jest.fn(), obterRemediacao: jest.fn() };
  const metrics = { elegibilidade: jest.fn() };
  const cfg = { sessionSecret: 'test', sessionTtl: 3600, authDevUser: '', production: true, githubAllowedTeams: [] as string[] };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [EligibilityController, EligibilityReadController],
      providers: [
        { provide: CacheWriterService, useValue: ms5 },
        { provide: RemediationService, useValue: ms8 },
        { provide: EligibilityStore, useValue: store },
        { provide: MetricsService, useValue: metrics },
        { provide: APP_CONFIG, useValue: cfg },
        { provide: SessionService, inject: [APP_CONFIG], useFactory: (c: any) => new SessionService(c) },
        AuthGuard,
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.clearAllMocks());

  it('GET /v1/elegibilidade/:fp → 200 SEM cookie (rota consumida pelo MS 8)', async () => {
    const row = { fingerprint: 'fp1', remediacao_id: 'versao-ja-publicada', remediacao_versao: '1', servico: 'GDD-Core/agentix-demo-app' };
    store.get.mockReturnValueOnce(row);
    const r = await request(app.getHttpServer()).get('/v1/elegibilidade/fp1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual(row);
    expect(store.get).toHaveBeenCalledWith('fp1');
  });

  it('GET /v1/elegibilidade/:fp → 404 SEM cookie quando não há vínculo (nunca 401)', async () => {
    store.get.mockReturnValueOnce(null);
    const r = await request(app.getHttpServer()).get('/v1/elegibilidade/naoexiste');
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('sem elegibilidade para este fingerprint');
  });

  it('GET /v1/elegibilidade (lista) → 401 SEM cookie (curadoria segue gated)', async () => {
    const r = await request(app.getHttpServer()).get('/v1/elegibilidade');
    expect(r.status).toBe(401);
    expect(store.list).not.toHaveBeenCalled();
  });

  it('PUT /v1/elegibilidade/:fp → 401 SEM cookie (atrelar segue gated)', async () => {
    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r1', preview_confirmado: true });
    expect(r.status).toBe(401);
    expect(ms8.obterRemediacao).not.toHaveBeenCalled();
  });

  it('DELETE /v1/elegibilidade/:fp → 401 SEM cookie (remover segue gated)', async () => {
    const r = await request(app.getHttpServer()).delete('/v1/elegibilidade/fp1');
    expect(r.status).toBe(401);
    expect(store.delete).not.toHaveBeenCalled();
  });
});
