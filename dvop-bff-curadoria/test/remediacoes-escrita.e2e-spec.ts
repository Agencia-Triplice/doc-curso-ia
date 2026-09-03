import { INestApplication, HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RemediacoesEscritaController } from '../src/api/remediacoes-escrita.controller';
import { RemediationService } from '../src/upstreams/remediation.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { AuthGuard } from '../src/auth/auth.guard';
import { APP_CONFIG } from '../src/config/env';

describe('RemediacoesEscritaController', () => {
  let app: INestApplication;
  const ms8 = {
    enabled: true,
    criarRemediacao: jest.fn(),
    excluirRemediacao: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [RemediacoesEscritaController],
      providers: [
        { provide: RemediationService, useValue: ms8 },
        { provide: MetricsService, useValue: { curadoria: jest.fn() } },
        { provide: APP_CONFIG, useValue: { ms8Url: 'http://ms8' } },
      ],
    })
      .overrideGuard(AuthGuard).useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { ms8.criarRemediacao.mockReset(); ms8.excluirRemediacao.mockReset(); ms8.enabled = true; });

  it('barra regex incompatível com JS sem tocar o MS8 (400)', async () => {
    await request(app.getHttpServer())
      .post('/v1/remediacoes')
      .send({ id: 'x', aplicabilidade: { assinatura_regex: '(?s)nope' } })
      .expect(400);
    expect(ms8.criarRemediacao).not.toHaveBeenCalled();
  });

  it('repassa payload válido e devolve 201', async () => {
    ms8.criarRemediacao.mockResolvedValue({ id: 'blob-upload-invalid' });
    await request(app.getHttpServer())
      .post('/v1/remediacoes')
      .send({ id: 'blob-upload-invalid', aplicabilidade: { assinatura_regex: '(?i)blob upload invalid' } })
      .expect(201)
      .expect((r) => expect(r.body.id).toBe('blob-upload-invalid'));
    expect(ms8.criarRemediacao).toHaveBeenCalledTimes(1);
  });

  it('DELETE repassa ao MS8 e devolve 204', async () => {
    ms8.excluirRemediacao.mockResolvedValue(undefined);
    await request(app.getHttpServer()).delete('/v1/remediacoes/blob-upload-invalid').expect(204);
    expect(ms8.excluirRemediacao).toHaveBeenCalledWith('blob-upload-invalid');
  });

  it('503 quando o MS8 não está configurado', async () => {
    ms8.enabled = false;
    await request(app.getHttpServer())
      .post('/v1/remediacoes')
      .send({ id: 'x', aplicabilidade: { assinatura_regex: 'ok' } })
      .expect(503);
  });
});
