import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { CacheRecordsController } from '../src/api/cache-records.controller';
import { CacheWriterService } from '../src/upstreams/cache-writer.service';
import { EligibilityStore } from '../src/eligibility/eligibility-store.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { APP_CONFIG } from '../src/config/env';
import { DetailExceptionFilter } from '../src/common/exception.filter';
import { UpstreamError } from '../src/common/upstream-error';
import { AuthGuard } from '../src/auth/auth.guard';
import { SessionService } from '../src/auth/session.service';

describe('CacheRecordsController (e2e)', () => {
  let app: INestApplication;
  // AuthGuard REAL ligado (sem dev-user bypass): usado só para provar o 401
  // nas rotas de escrita, no mesmo espírito de test/eligibility-read.e2e-spec.ts.
  let appSemSessao: INestApplication;

  const ms5 = {
    obterSolucao: jest.fn(),
    editarSolucao: jest.fn(),
    excluirSolucao: jest.fn(),
  };
  // count fica mockável; upsert/mapa/delete delegam para uma instância real em
  // memória — recriada a cada teste (beforeEach/afterEach) para que nenhum
  // caso dependa de vínculos deixados por um teste anterior (lição da
  // Tarefa 9, corrigida em c42ceeb no review.e2e-spec.ts).
  let elegibilidadeStore: EligibilityStore;
  const elegibilidade = {
    delete: (fp: string) => elegibilidadeStore.delete(fp),
    get: (fp: string) => elegibilidadeStore.get(fp),
    upsert: (data: Parameters<EligibilityStore['upsert']>[0], now: string) => elegibilidadeStore.upsert(data, now),
    mapa: () => elegibilidadeStore.mapa(),
  };
  const metrics = { curadoria: jest.fn() };
  // authDevUser/production/githubAllowedTeams: bypass do AuthGuard (mesmo
  // padrão de review.e2e-spec.ts) — as rotas deste spec continuam testadas
  // fim-a-fim, só a autenticação é destravada via dev-user (fora de produção).
  const cfg = { ms5Url: 'http://ms5:8002', sessionSecret: 'test', sessionTtl: 3600, authDevUser: 'test', production: false, githubAllowedTeams: [] as string[] };
  const cfgSemSessao = { ...cfg, authDevUser: '', production: true };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [CacheRecordsController],
      providers: [
        { provide: CacheWriterService, useValue: ms5 },
        { provide: EligibilityStore, useValue: elegibilidade },
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

    const modSemSessao = await Test.createTestingModule({
      controllers: [CacheRecordsController],
      providers: [
        { provide: CacheWriterService, useValue: ms5 },
        { provide: EligibilityStore, useValue: elegibilidade },
        { provide: MetricsService, useValue: metrics },
        { provide: APP_CONFIG, useValue: cfgSemSessao },
        { provide: SessionService, inject: [APP_CONFIG], useFactory: (c: any) => new SessionService(c) },
        AuthGuard,
      ],
    }).compile();
    appSemSessao = modSemSessao.createNestApplication();
    appSemSessao.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    appSemSessao.useGlobalFilters(new DetailExceptionFilter());
    await appSemSessao.init();
  });

  afterAll(async () => {
    await app.close();
    await appSemSessao.close();
  });

  beforeEach(() => {
    elegibilidadeStore = new EligibilityStore(':memory:');
  });

  afterEach(() => {
    elegibilidadeStore.close();
    jest.clearAllMocks();
    // clearAllMocks zera chamadas, NÃO implementações: sem restore, o spy de
    // `elegibilidade.delete` sobreviveria para os casos seguintes (mesma
    // dependência de ordem corrigida em c42ceeb).
    jest.restoreAllMocks();
  });

  // requisição sem sessão: o AuthGuard real (sem dev-user bypass) do
  // appSemSessao rejeita antes de chegar no controller.
  function requestSemSessao() {
    return request(appSemSessao.getHttpServer());
  }

  it('GET devolve a solução anotada com o vínculo', async () => {
    ms5.obterSolucao.mockResolvedValue({ fingerprint: 'fp1', assinatura: 'erro X', solucao: 'sol', run_url: 'https://exemplo/runs/9' });
    elegibilidade.upsert(
      { fingerprint: 'fp1', remediacao_id: 'versao-ja-publicada', remediacao_versao: '1.0.0', assinatura: 'erro X' },
      '2026-08-03T10:00:00+00:00',
    );

    const res = await request(app.getHttpServer()).get('/v1/solucoes/fp1').expect(200);

    expect(res.body).toMatchObject({
      fingerprint: 'fp1',
      run_url: 'https://exemplo/runs/9',
      elegivel: true,
      remediacao_id: 'versao-ja-publicada',
    });
  });

  it('GET de solução inexistente devolve 404', async () => {
    ms5.obterSolucao.mockRejectedValue(new UpstreamError(404, 'x'));
    const res = await request(app.getHttpServer()).get('/v1/solucoes/naoexiste').expect(404);
    expect(res.body.detail).toBe('solução não encontrada no cache');
  });

  it('PUT edita a solução no MS 5', async () => {
    ms5.editarSolucao.mockResolvedValue({ fingerprint: 'fp1', solucao: 'nova', autor: 'ana' });

    await request(app.getHttpServer()).put('/v1/solucoes/fp1').send({ solucao: 'nova', autor: 'ana' }).expect(200);

    expect(ms5.editarSolucao).toHaveBeenCalledWith('fp1', 'nova', 'ana');
  });

  it('PUT sem autor repassa null ao MS 5 (que preserva o autor anterior)', async () => {
    ms5.editarSolucao.mockResolvedValue({ fingerprint: 'fp1', solucao: 'nova', autor: 'time-sre' });

    const res = await request(app.getHttpServer()).put('/v1/solucoes/fp1').send({ solucao: 'nova' }).expect(200);

    expect(ms5.editarSolucao).toHaveBeenCalledWith('fp1', 'nova', null);
    expect(res.body.autor).toBe('time-sre');
  });

  it('PUT de solução inexistente devolve 404', async () => {
    ms5.editarSolucao.mockRejectedValue(new UpstreamError(404, 'x'));
    const res = await request(app.getHttpServer()).put('/v1/solucoes/naoexiste').send({ solucao: 'x' }).expect(404);
    expect(res.body.detail).toBe('solução não encontrada no cache');
  });

  it('PUT com solucao vazia → 422', async () => {
    await request(app.getHttpServer()).put('/v1/solucoes/fp1').send({ solucao: '' }).expect(422);
  });

  it('DELETE remove a elegibilidade ANTES de chamar o MS 5', async () => {
    elegibilidade.upsert(
      { fingerprint: 'fp1', remediacao_id: 'r1', remediacao_versao: '1.0.0', assinatura: 'erro X' },
      '2026-08-03T10:00:00+00:00',
    );
    const ordem: string[] = [];
    jest.spyOn(elegibilidade, 'delete').mockImplementation(((fp: string) => { ordem.push('elegibilidade'); return true; }) as any);
    ms5.excluirSolucao.mockImplementation(async () => { ordem.push('ms5'); });

    await request(app.getHttpServer()).delete('/v1/solucoes/fp1').expect(204);

    expect(ordem).toEqual(['elegibilidade', 'ms5']);
    expect(ms5.excluirSolucao).toHaveBeenCalledWith('fp1', true); // padrão: devolve à fila
  });

  it('DELETE com ?devolver=false repassa false ao MS 5 (exclusão permanente)', async () => {
    ms5.excluirSolucao.mockResolvedValue(undefined);

    await request(app.getHttpServer()).delete('/v1/solucoes/fp1?devolver=false').expect(204);

    expect(ms5.excluirSolucao).toHaveBeenCalledWith('fp1', false);
  });

  it('DELETE permanente também remove a elegibilidade', async () => {
    elegibilidade.upsert(
      { fingerprint: 'fp1', remediacao_id: 'r1', remediacao_versao: '1.0.0', assinatura: 'erro X' },
      '2026-08-03T10:00:00+00:00',
    );
    ms5.excluirSolucao.mockResolvedValue(undefined);

    await request(app.getHttpServer()).delete('/v1/solucoes/fp1?devolver=false').expect(204);

    // o erro deixou de existir: nenhuma marcação de elegível a PR pode sobrar
    expect(elegibilidadeStore.get('fp1')).toBeNull();
  });

  it('DELETE sem ?devolver mantém o padrão de devolver à fila', async () => {
    ms5.excluirSolucao.mockResolvedValue(undefined);

    await request(app.getHttpServer()).delete('/v1/solucoes/fp1?devolver=talvez').expect(204);

    expect(ms5.excluirSolucao).toHaveBeenCalledWith('fp1', true);
  });

  it('DELETE de solução inexistente devolve 404', async () => {
    ms5.excluirSolucao.mockRejectedValue(new UpstreamError(404, 'fingerprint desconhecido'));

    const res = await request(app.getHttpServer()).delete('/v1/solucoes/naoexiste').expect(404);

    expect(res.body.detail).toBe('solução não encontrada no cache');
  });

  it('DELETE que dá 404 no MS 5 restaura o vínculo de elegibilidade', async () => {
    elegibilidade.upsert(
      { fingerprint: 'fp1', remediacao_id: 'r1', remediacao_versao: '1.0.0', assinatura: 'erro X', servico: 'svc', autor: 'ana' },
      '2026-08-03T10:00:00+00:00',
    );
    ms5.excluirSolucao.mockRejectedValue(new UpstreamError(404, 'fingerprint desconhecido'));

    await request(app.getHttpServer()).delete('/v1/solucoes/fp1').expect(404);

    // 404 prova que não havia solução a excluir: a marcação de outra pessoa continua lá
    expect(elegibilidadeStore.get('fp1')).toMatchObject({
      fingerprint: 'fp1',
      remediacao_id: 'r1',
      remediacao_versao: '1.0.0',
      assinatura: 'erro X',
      servico: 'svc',
      autor: 'ana',
      criado_em: '2026-08-03T10:00:00+00:00',
    });
  });

  it('DELETE que falha por erro NÃO-404 não restaura o vínculo', async () => {
    elegibilidade.upsert(
      { fingerprint: 'fp1', remediacao_id: 'r1', remediacao_versao: '1.0.0', assinatura: 'erro X' },
      '2026-08-03T10:00:00+00:00',
    );
    ms5.excluirSolucao.mockRejectedValue(new UpstreamError(503, 'indisponível'));

    await request(app.getHttpServer()).delete('/v1/solucoes/fp1').expect(503);

    // estado do MS 5 desconhecido: erro sem vínculo é o lado seguro
    expect(elegibilidadeStore.get('fp1')).toBeNull();
  });

  it('exige sessão nas rotas de escrita', async () => {
    await requestSemSessao().put('/v1/solucoes/fp1').send({ solucao: 'x' }).expect(401);
    await requestSemSessao().delete('/v1/solucoes/fp1').expect(401);
  });
});
