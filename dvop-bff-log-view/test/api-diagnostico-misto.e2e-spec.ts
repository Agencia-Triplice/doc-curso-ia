import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DiagnosticoMistoController } from '../src/api/diagnostico-misto.controller';
import { DiagnosticoMistoService } from '../src/diagnostico/diagnostico-misto.service';
import { DetailExceptionFilter } from '../src/common/exception.filter';

describe('POST /api/diagnostico/misto (e2e)', () => {
  let app: INestApplication; let diagnosticar: jest.Mock;
  beforeAll(async () => {
    diagnosticar = jest.fn().mockResolvedValue({ origem: 'misto', itens: [] });
    const mod = await Test.createTestingModule({
      controllers: [DiagnosticoMistoController],
      providers: [{ provide: DiagnosticoMistoService, useValue: { diagnosticar } }],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { diagnosticar.mockClear(); });

  it('200 com o corpo do service; whitelist limpa campos extras', async () => {
    const r = await request(app.getHttpServer()).post('/api/diagnostico/misto')
      .send({ message: 'erro x', github_token: 'ghp_1', intruso: true });
    expect(r.status).toBe(200);
    expect(r.body.origem).toBe('misto');
    expect(diagnosticar).toHaveBeenCalledWith({ message: 'erro x', github_token: 'ghp_1' });
  });
  it.each([
    [{}, 'message ausente'],
    [{ message: '' }, 'message vazia'],
    [{ message: 'a'.repeat(16385) }, 'message acima de 16384'],
    [{ message: 'ok', github_token: 'a'.repeat(513) }, 'github_token acima de 512'],
  ])('422 shape {detail} para %s', async (body, desc) => {
    const r = await request(app.getHttpServer()).post('/api/diagnostico/misto').send(body);
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });
});
