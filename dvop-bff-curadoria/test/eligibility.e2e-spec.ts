import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { EligibilityController } from '../src/api/eligibility.controller';
import { CacheWriterService } from '../src/upstreams/cache-writer.service';
import { RemediationService } from '../src/upstreams/remediation.service';
import { EligibilityStore } from '../src/eligibility/eligibility-store.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { DetailExceptionFilter } from '../src/common/exception.filter';
import { UpstreamError } from '../src/common/upstream-error';
import { APP_CONFIG } from '../src/config/env';
import { AuthGuard } from '../src/auth/auth.guard';
import { SessionService } from '../src/auth/session.service';

describe('EligibilityController (e2e)', () => {
  let app: INestApplication;

  const ms5 = {
    obterOrfao: jest.fn(),
    obterSolucao: jest.fn(),
  };
  const ms8 = {
    enabled: true,
    listarRemediacoes: jest.fn(),
    obterRemediacao: jest.fn(),
  };
  const store = {
    upsert: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
    count: jest.fn(),
  };
  const metrics = { elegibilidade: jest.fn() };
  // bypass do AuthGuard (agora aplicado na classe): dev-user fora de produção
  // destrava as rotas sem precisar montar cookie/sessão neste spec.
  const cfg = { sessionSecret: 'test', sessionTtl: 3600, authDevUser: 'test', production: false, githubAllowedTeams: [] as string[] };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [EligibilityController],
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

  afterEach(() => {
    jest.clearAllMocks();
    ms8.enabled = true;
  });

  // ---------------------------------------------------------------- remediacoes
  it('GET /v1/remediacoes → 200 pass-through do catálogo do MS 8', async () => {
    ms8.listarRemediacoes.mockResolvedValueOnce({ itens: [{ id: 'r1', versao: '1' }], total: 1 });
    const r = await request(app.getHttpServer()).get('/v1/remediacoes');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ itens: [{ id: 'r1', versao: '1' }], total: 1 });
  });

  it('GET /v1/remediacoes → 503 quando MS8 off, mensagem verbatim (env CURADORIA_BFF_MS8_URL)', async () => {
    ms8.enabled = false;
    const r = await request(app.getHttpServer()).get('/v1/remediacoes');
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe('remediação indisponível: configure CURADORIA_BFF_MS8_URL');
    expect(ms8.listarRemediacoes).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- PUT elegibilidade
  it('PUT /v1/elegibilidade/:fp → 503 quando MS8 off', async () => {
    ms8.enabled = false;
    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r1', preview_confirmado: true });
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe('remediação indisponível: configure CURADORIA_BFF_MS8_URL');
  });

  it('PUT /v1/elegibilidade/:fp → 400 sem preview confirmado (ausente), mensagem verbatim', async () => {
    const r = await request(app.getHttpServer()).put('/v1/elegibilidade/fp1').send({ remediacao_id: 'r1' });
    expect(r.status).toBe(400);
    expect(r.body.detail).toBe('sem preview confirmado: renderize o preview da remediação antes');
    expect(ms8.obterRemediacao).not.toHaveBeenCalled();
  });

  it('PUT /v1/elegibilidade/:fp → 400 sem preview confirmado (false explícito)', async () => {
    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r1', preview_confirmado: false });
    expect(r.status).toBe(400);
    expect(r.body.detail).toBe('sem preview confirmado: renderize o preview da remediação antes');
  });

  it("PUT /v1/elegibilidade/:fp → 400 remediação não catalogada, mensagem com aspas simples ao redor do id", async () => {
    ms8.obterRemediacao.mockRejectedValueOnce(new UpstreamError(404, 'não encontrada'));
    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r-inexistente', preview_confirmado: true });
    expect(r.status).toBe(400);
    expect(r.body.detail).toBe("remediação não catalogada: 'r-inexistente'");
    expect(ms5.obterOrfao).not.toHaveBeenCalled();
  });

  it('PUT /v1/elegibilidade/:fp → 404 fingerprint desconhecido (obterOrfao 404 + obterSolucao 404)', async () => {
    ms8.obterRemediacao.mockResolvedValueOnce({ id: 'r1', versao: '2' });
    ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(404, 'x'));
    ms5.obterSolucao.mockRejectedValueOnce(new UpstreamError(404, 'y'));
    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r1', preview_confirmado: true });
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('fingerprint desconhecido: não está na fila nem no cache');
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('PUT /v1/elegibilidade/:fp → 400 quando a remediação não casa com o erro', async () => {
    ms8.obterRemediacao.mockResolvedValueOnce({ id: 'r1', versao: '1', aplicabilidade: { assinatura_regex: 'timeout' } });
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'ECONNRESET', servico: 'owner/repo', template: 'bff-node' });
    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r1', preview_confirmado: true });
    expect(r.status).toBe(400);
    expect(r.body.detail).toBe('remediação não se aplica a este erro');
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('PUT /v1/elegibilidade/:fp → grava quando a remediação casa', async () => {
    ms8.obterRemediacao.mockResolvedValueOnce({ id: 'r1', versao: '1', aplicabilidade: { assinatura_regex: '(?i)does not allow updating assets' } });
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: '400 Repository does not allow updating assets', servico: 'owner/repo', template: 'bff-node' });
    store.upsert.mockReturnValueOnce({ fingerprint: 'fp1', remediacao_id: 'r1' });
    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r1', preview_confirmado: true });
    expect(r.status).toBe(200);
    expect(store.upsert).toHaveBeenCalled();
  });

  it('PUT /v1/elegibilidade/:fp → 200 feliz via órfão: versao/id vêm do catálogo, autor/servico do órfão, now em ISO +00:00, métrica registrada', async () => {
    ms8.obterRemediacao.mockResolvedValueOnce({ id: 'r1', versao: '3', aplicabilidade: { assinatura_regex: 'erro X' } });
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro X', servico: 'svcA' });
    const rowEsperada = {
      fingerprint: 'fp1',
      remediacao_id: 'r1',
      remediacao_versao: '3',
      assinatura: 'erro X',
      servico: 'svcA',
      autor: 'maria',
      criado_em: '2024-01-01T00:00:00+00:00',
      atualizado_em: '2024-01-01T00:00:00+00:00',
    };
    store.upsert.mockReturnValueOnce(rowEsperada);

    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      // remediacao_versao no payload deve ser IGNORADA — não existe esse campo no DTO, mas
      // confirmamos que o id enviado é usado apenas para buscar o catálogo, não como fonte de versao
      .send({ remediacao_id: 'r1', preview_confirmado: true, autor: 'maria' });

    expect(r.status).toBe(200);
    expect(r.body).toEqual(rowEsperada);
    expect(ms5.obterSolucao).not.toHaveBeenCalled();
    expect(store.upsert).toHaveBeenCalledTimes(1);
    const [dataArg, nowArg] = store.upsert.mock.calls[0];
    expect(dataArg).toEqual({
      fingerprint: 'fp1',
      remediacao_id: 'r1',
      remediacao_versao: '3',
      assinatura: 'erro X',
      servico: 'svcA',
      autor: 'maria',
    });
    expect(nowArg).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
    expect(metrics.elegibilidade).toHaveBeenCalledWith('registrada');
  });

  it('PUT /v1/elegibilidade/:fp → 200 feliz via solução (órfão 404 → fallback obterSolucao), servico null quando ausente', async () => {
    ms8.obterRemediacao.mockResolvedValueOnce({ id: 'r2', versao: '9', aplicabilidade: { assinatura_regex: 'erro cache' } });
    ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(404, 'x'));
    ms5.obterSolucao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro cache' });
    store.upsert.mockReturnValueOnce({
      fingerprint: 'fp1',
      remediacao_id: 'r2',
      remediacao_versao: '9',
      assinatura: 'erro cache',
      servico: null,
      autor: null,
      criado_em: '2024-01-01T00:00:00+00:00',
      atualizado_em: '2024-01-01T00:00:00+00:00',
    });

    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r2', preview_confirmado: true });

    expect(r.status).toBe(200);
    expect(ms5.obterSolucao).toHaveBeenCalledWith('fp1');
    const [dataArg] = store.upsert.mock.calls[0];
    expect(dataArg).toEqual({
      fingerprint: 'fp1',
      remediacao_id: 'r2',
      remediacao_versao: '9',
      assinatura: 'erro cache',
      servico: null,
      autor: null,
    });
    expect(metrics.elegibilidade).toHaveBeenCalledWith('registrada');
  });

  it('PUT /v1/elegibilidade/:fp → propaga não-404 do MS8 (obterRemediacao 502) sem virar 400', async () => {
    ms8.obterRemediacao.mockRejectedValueOnce(new UpstreamError(502, 'ms8 fora'));
    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r1', preview_confirmado: true });
    expect(r.status).toBe(502);
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('PUT /v1/elegibilidade/:fp → propaga não-404 do MS5 no órfão (502) sem cair no fallback de solução', async () => {
    ms8.obterRemediacao.mockResolvedValueOnce({ id: 'r1', versao: '1' });
    ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(502, 'ms5 fora'));
    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r1', preview_confirmado: true });
    expect(r.status).toBe(502);
    expect(ms5.obterSolucao).not.toHaveBeenCalled();
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('PUT /v1/elegibilidade/:fp → propaga não-404 do MS5 na solução (504) após órfão 404', async () => {
    ms8.obterRemediacao.mockResolvedValueOnce({ id: 'r1', versao: '1' });
    ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(404, 'x'));
    ms5.obterSolucao.mockRejectedValueOnce(new UpstreamError(504, 'timeout'));
    const r = await request(app.getHttpServer())
      .put('/v1/elegibilidade/fp1')
      .send({ remediacao_id: 'r1', preview_confirmado: true });
    expect(r.status).toBe(504);
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('PUT /v1/elegibilidade/:fp → remediacao_id ausente → 422', async () => {
    const r = await request(app.getHttpServer()).put('/v1/elegibilidade/fp1').send({ preview_confirmado: true });
    expect(r.status).toBe(422);
    expect(ms8.obterRemediacao).not.toHaveBeenCalled();
  });

  it('PUT /v1/elegibilidade/:fp → fingerprint > 64 chars → 422 verbatim', async () => {
    const r = await request(app.getHttpServer())
      .put(`/v1/elegibilidade/${'a'.repeat(65)}`)
      .send({ remediacao_id: 'r1', preview_confirmado: true });
    expect(r.status).toBe(422);
    expect(r.body.detail).toBe('fingerprint inválido (1..64)');
  });

  // GET /v1/elegibilidade/:fp (leitura single) migrou para a
  // EligibilityReadController (fora do guard) — coberto em
  // eligibility-read.e2e-spec.ts.

  // ---------------------------------------------------------------- DELETE elegibilidade/:fp
  it('DELETE /v1/elegibilidade/:fp → 204 + métrica removida', async () => {
    store.delete.mockReturnValueOnce(true);
    const r = await request(app.getHttpServer()).delete('/v1/elegibilidade/fp1');
    expect(r.status).toBe(204);
    expect(store.delete).toHaveBeenCalledWith('fp1');
    expect(metrics.elegibilidade).toHaveBeenCalledWith('removida');
  });

  it('DELETE /v1/elegibilidade/:fp → 404 quando não existe, mensagem verbatim, sem métrica', async () => {
    store.delete.mockReturnValueOnce(false);
    const r = await request(app.getHttpServer()).delete('/v1/elegibilidade/naoexiste');
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('sem elegibilidade para este fingerprint');
    expect(metrics.elegibilidade).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- GET elegibilidade (lista)
  it('GET /v1/elegibilidade → 200 {itens,total}, default limit 100', async () => {
    store.list.mockReturnValueOnce([{ fingerprint: 'fp1' }]);
    store.count.mockReturnValueOnce(1);
    const r = await request(app.getHttpServer()).get('/v1/elegibilidade');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ itens: [{ fingerprint: 'fp1' }], total: 1 });
    expect(store.list).toHaveBeenCalledWith(100);
  });

  it('GET /v1/elegibilidade?limit=500 → 200 (borda superior válida)', async () => {
    store.list.mockReturnValueOnce([]);
    store.count.mockReturnValueOnce(0);
    const r = await request(app.getHttpServer()).get('/v1/elegibilidade?limit=500');
    expect(r.status).toBe(200);
    expect(store.list).toHaveBeenCalledWith(500);
  });

  it('GET /v1/elegibilidade?limit=0 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/v1/elegibilidade?limit=0');
    expect(r.status).toBe(422);
  });

  it('GET /v1/elegibilidade?limit=501 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/v1/elegibilidade?limit=501');
    expect(r.status).toBe(422);
  });
});
