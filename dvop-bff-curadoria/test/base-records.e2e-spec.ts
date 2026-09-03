import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { BaseRecordsController } from '../src/api/base-records.controller';
import { RetrievalService } from '../src/upstreams/retrieval.service';
import { EligibilityStore } from '../src/eligibility/eligibility-store.service';
import { APP_CONFIG } from '../src/config/env';
import { DetailExceptionFilter } from '../src/common/exception.filter';
import { UpstreamError } from '../src/common/upstream-error';
import { AuthGuard } from '../src/auth/auth.guard';
import { SessionService } from '../src/auth/session.service';

describe('BaseRecordsController (e2e)', () => {
  let app: INestApplication;
  // AuthGuard REAL ligado (sem dev-user bypass): usado só para provar o 401
  // nas rotas de escrita, no mesmo espírito de test/cache-records.e2e-spec.ts.
  let appSemSessao: INestApplication;
  // MS 3 desligado (equivalente a CURADORIA_BFF_MS3_URL vazio): usado só para
  // provar o 503 honesto, mesmo padrão do teste "GET /v1/documentos → 503"
  // de review.e2e-spec.ts, aqui isolado numa app própria.
  let appSemMs3: INestApplication;

  const ms3 = {
    enabled: true,
    obterDocumento: jest.fn(),
    editarDocumento: jest.fn(),
    excluirDocumento: jest.fn(),
  };
  const ms3Off = {
    enabled: false,
    obterDocumento: jest.fn(),
    editarDocumento: jest.fn(),
    excluirDocumento: jest.fn(),
  };
  // count fica mockável; upsert/mapa/get delegam para uma instância real em
  // memória — recriada a cada teste (beforeEach/afterEach) para que nenhum
  // caso dependa de vínculos deixados por um teste anterior (lição da
  // Tarefa 9, corrigida em c42ceeb no review.e2e-spec.ts).
  let elegibilidadeStore: EligibilityStore;
  const elegibilidade = {
    upsert: (data: Parameters<EligibilityStore['upsert']>[0], now: string) => elegibilidadeStore.upsert(data, now),
    get: (fp: string) => elegibilidadeStore.get(fp),
    mapa: () => elegibilidadeStore.mapa(),
  };
  // authDevUser/production/githubAllowedTeams: bypass do AuthGuard (mesmo
  // padrão de review.e2e-spec.ts) — as rotas deste spec continuam testadas
  // fim-a-fim, só a autenticação é destravada via dev-user (fora de produção).
  const cfg = { ms5Url: 'http://ms5:8002', sessionSecret: 'test', sessionTtl: 3600, authDevUser: 'test', production: false, githubAllowedTeams: [] as string[] };
  const cfgSemSessao = { ...cfg, authDevUser: '', production: true };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [BaseRecordsController],
      providers: [
        { provide: RetrievalService, useValue: ms3 },
        { provide: EligibilityStore, useValue: elegibilidade },
        { provide: APP_CONFIG, useValue: cfg },
        { provide: SessionService, inject: [APP_CONFIG], useFactory: (c: any) => new SessionService(c) },
        AuthGuard,
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();

    const modSemSessao = await Test.createTestingModule({
      controllers: [BaseRecordsController],
      providers: [
        { provide: RetrievalService, useValue: ms3 },
        { provide: EligibilityStore, useValue: elegibilidade },
        { provide: APP_CONFIG, useValue: cfgSemSessao },
        { provide: SessionService, inject: [APP_CONFIG], useFactory: (c: any) => new SessionService(c) },
        AuthGuard,
      ],
    }).compile();
    appSemSessao = modSemSessao.createNestApplication();
    appSemSessao.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    appSemSessao.useGlobalFilters(new DetailExceptionFilter());
    await appSemSessao.init();

    const modSemMs3 = await Test.createTestingModule({
      controllers: [BaseRecordsController],
      providers: [
        { provide: RetrievalService, useValue: ms3Off },
        { provide: EligibilityStore, useValue: elegibilidade },
        { provide: APP_CONFIG, useValue: cfg },
        { provide: SessionService, inject: [APP_CONFIG], useFactory: (c: any) => new SessionService(c) },
        AuthGuard,
      ],
    }).compile();
    appSemMs3 = modSemMs3.createNestApplication();
    appSemMs3.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    appSemMs3.useGlobalFilters(new DetailExceptionFilter());
    await appSemMs3.init();
  });

  afterAll(async () => {
    await app.close();
    await appSemSessao.close();
    await appSemMs3.close();
  });

  beforeEach(() => {
    elegibilidadeStore = new EligibilityStore(':memory:');
  });

  afterEach(() => {
    elegibilidadeStore.close();
    jest.clearAllMocks();
  });

  // requisição sem sessão: o AuthGuard real (sem dev-user bypass) do
  // appSemSessao rejeita antes de chegar no controller.
  function requestSemSessao(_app: INestApplication) {
    return request(appSemSessao.getHttpServer());
  }

  it('GET anota o documento pelo fingerprint de origem', async () => {
    ms3.obterDocumento.mockResolvedValue({ id: 7, titulo: 'erro X', conteudo: 'c', tags: ['curadoria'], origem_fingerprint: 'fp1', origem_run_url: 'https://exemplo/runs/9' });
    elegibilidade.upsert(
      { fingerprint: 'fp1', remediacao_id: 'versao-ja-publicada', remediacao_versao: '1.0.0', assinatura: 'erro X' },
      '2026-08-03T10:00:00+00:00',
    );

    const res = await request(app.getHttpServer()).get('/v1/documentos/7').expect(200);

    expect(res.body).toMatchObject({ id: 7, elegivel: true, remediacao_id: 'versao-ja-publicada' });
  });

  it('documento antigo, sem origem, sai como não elegível', async () => {
    ms3.obterDocumento.mockResolvedValue({ id: 8, titulo: 'antigo', conteudo: 'c', tags: [], origem_fingerprint: null, origem_run_url: null });

    const res = await request(app.getHttpServer()).get('/v1/documentos/8').expect(200);

    expect(res.body).toMatchObject({ elegivel: false, remediacao_id: null });
  });

  it('GET de documento inexistente devolve 404', async () => {
    ms3.obterDocumento.mockRejectedValue(new UpstreamError(404, 'x'));
    const res = await request(app.getHttpServer()).get('/v1/documentos/999').expect(404);
    expect(res.body.detail).toBe('documento não encontrado');
  });

  it('PUT edita o documento no MS 3', async () => {
    ms3.editarDocumento.mockResolvedValue({ id: 7, titulo: 'novo', conteudo: 'c2', tags: [] });

    await request(app.getHttpServer())
      .put('/v1/documentos/7')
      .send({ titulo: 'novo', conteudo: 'c2', servico: null, nivel: null, tags: [] })
      .expect(200);

    expect(ms3.editarDocumento).toHaveBeenCalledWith(7, {
      titulo: 'novo', conteudo: 'c2', servico: null, nivel: null, tags: [],
    });
  });

  it('PUT de documento inexistente devolve 404', async () => {
    ms3.editarDocumento.mockRejectedValue(new UpstreamError(404, 'x'));
    const res = await request(app.getHttpServer())
      .put('/v1/documentos/999')
      .send({ titulo: 'novo', conteudo: 'c2' })
      .expect(404);
    expect(res.body.detail).toBe('documento não encontrado');
  });

  it('PUT com titulo vazio → 422', async () => {
    await request(app.getHttpServer()).put('/v1/documentos/7').send({ titulo: '', conteudo: 'c2' }).expect(422);
  });

  it('DELETE remove só o documento — não mexe na elegibilidade', async () => {
    elegibilidade.upsert(
      { fingerprint: 'fp1', remediacao_id: 'r1', remediacao_versao: '1.0.0', assinatura: 'erro X' },
      '2026-08-03T10:00:00+00:00',
    );
    ms3.excluirDocumento.mockResolvedValue(undefined);

    await request(app.getHttpServer()).delete('/v1/documentos/7').expect(204);

    expect(ms3.excluirDocumento).toHaveBeenCalledWith(7);
    expect(elegibilidade.get('fp1')).not.toBeNull();
  });

  it('DELETE de documento inexistente devolve 404', async () => {
    ms3.excluirDocumento.mockRejectedValue(new UpstreamError(404, 'x'));
    const res = await request(app.getHttpServer()).delete('/v1/documentos/999').expect(404);
    expect(res.body.detail).toBe('documento não encontrado');
  });

  it('devolve 503 honesto quando o MS 3 não está configurado', async () => {
    // app montado com CURADORIA_BFF_MS3_URL vazio (mesmo padrão do teste de GET /v1/documentos)
    await request(appSemMs3.getHttpServer()).get('/v1/documentos/7').expect(503);
  });

  it('exige sessão nas rotas de escrita', async () => {
    await requestSemSessao(app).put('/v1/documentos/7').send({ titulo: 'x', conteudo: 'y' }).expect(401);
    await requestSemSessao(app).delete('/v1/documentos/7').expect(401);
  });
});
