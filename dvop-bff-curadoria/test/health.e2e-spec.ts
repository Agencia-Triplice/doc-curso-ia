import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from '../src/api/health.controller';
import { EligibilityStore } from '../src/eligibility/eligibility-store.service';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let store: EligibilityStore;

  beforeAll(async () => {
    // único estado local do serviço é o SQLite de elegibilidade; em memória
    // para não tocar o disco (fiel a routes_health.py: ready pinga o store)
    store = new EligibilityStore(':memory:');
    const mod = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: EligibilityStore, useValue: store }],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    store.close();
  });

  it('GET /health/live → 200 {status:ok}', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready → 200 {status:ok} (pinga o store)', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
