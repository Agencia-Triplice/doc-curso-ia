import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ReviewController } from '../src/api/review.controller';
import { CacheWriterService } from '../src/upstreams/cache-writer.service';
import { RetrievalService } from '../src/upstreams/retrieval.service';
import { RemediationService } from '../src/upstreams/remediation.service';
import { EligibilityStore } from '../src/eligibility/eligibility-store.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { CuradorWorker } from '../src/curador/curador.worker';
import { PromptStore } from '../src/curador/prompt-store.service';
import { APP_CONFIG } from '../src/config/env';
import { DetailExceptionFilter } from '../src/common/exception.filter';
import { UpstreamError } from '../src/common/upstream-error';
import { AuthGuard } from '../src/auth/auth.guard';
import { SessionService } from '../src/auth/session.service';

describe('ReviewController (e2e)', () => {
  let app: INestApplication;

  const ms5 = {
    listarOrfaos: jest.fn(),
    obterOrfao: jest.fn(),
    excluirOrfao: jest.fn(),
    salvarRascunho: jest.fn(),
    obterRascunho: jest.fn(),
    excluirRascunho: jest.fn(),
    criarSolucao: jest.fn(),
    listarSolucoes: jest.fn(),
    obterSolucao: jest.fn(),
    info: jest.fn(),
  };
  const ms3 = {
    enabled: true,
    buscar: jest.fn(),
    ingerirDocumento: jest.fn(),
    listarDocumentos: jest.fn(),
  };
  const ms8 = { enabled: true };
  // count fica mockável (testado isoladamente); upsert/mapa delegam para uma
  // instância real em memória — os testes de anotação de elegibilidade
  // (solucoes/documentos) precisam de um mapa de vínculos de verdade.
  // Recriada a cada teste (beforeEach/afterEach) para que nenhum caso dependa
  // de vínculos deixados por um teste anterior — a suíte não pode depender
  // da ordem de declaração dos `it()`.
  let elegibilidadeStore: EligibilityStore;
  const elegibilidade = {
    count: jest.fn(() => 3),
    upsert: (data: Parameters<EligibilityStore['upsert']>[0], now: string) => elegibilidadeStore.upsert(data, now),
    mapa: () => elegibilidadeStore.mapa(),
  };
  const metrics = { curadoria: jest.fn() };
  const curador = {
    iaEstado: jest.fn((_fp: string): string | null => null),
    contexto: jest.fn(async (_o: any): Promise<string> => '(nenhum documento encontrado)'),
  };
  // PromptStore real em memória, recriado por teste (como o de elegibilidade),
  // para os casos de "prompt registrado" x "reconstruído".
  let promptStore: PromptStore;
  const prompts = {
    get: (fp: string) => promptStore.get(fp),
    delete: (fp: string) => promptStore.delete(fp),
    registrar: (fp: string, pares: Parameters<PromptStore['registrar']>[1], now: string) =>
      promptStore.registrar(fp, pares, now),
  };
  // authDevUser/production/githubAllowedTeams: bypass do AuthGuard (agora
  // aplicado na classe) sem precisar montar cookie/sessão — as rotas de
  // dados deste spec continuam testadas fim-a-fim, só a autenticação é
  // destravada via dev-user (fora de produção).
  const cfg = { ms5Url: 'http://ms5:8002', sessionSecret: 'test', sessionTtl: 3600, authDevUser: 'test', production: false, githubAllowedTeams: [] as string[], agentixEntityType: 'workflow', agentixEntityName: 'curador', agentixEntityVersion: '1.0.0', agentixBundleName: 'dvop-agx-ssol-consulta-erro' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ReviewController],
      providers: [
        { provide: CacheWriterService, useValue: ms5 },
        { provide: RetrievalService, useValue: ms3 },
        { provide: RemediationService, useValue: ms8 },
        { provide: EligibilityStore, useValue: elegibilidade },
        { provide: PromptStore, useValue: prompts },
        { provide: MetricsService, useValue: metrics },
        { provide: CuradorWorker, useValue: curador },
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

  beforeEach(() => {
    elegibilidadeStore = new EligibilityStore(':memory:');
    promptStore = new PromptStore(':memory:');
  });

  afterEach(() => {
    elegibilidadeStore.close();
    promptStore.close();
    jest.clearAllMocks();
    ms3.enabled = true;
    curador.iaEstado.mockImplementation(() => null);
    curador.contexto.mockImplementation(async () => '(nenhum documento encontrado)');
  });

  // ---------------------------------------------------------------- fila
  it('GET /v1/fila → 200, itens shaped (campos extras podados) e truncado quando total > itens', async () => {
    ms5.listarOrfaos.mockResolvedValueOnce([
      {
        fingerprint: 'fp1',
        assinatura: 'erro 1',
        servico: 'svcA',
        nivel: 'ERROR',
        primeiro_visto: '2024-01-01',
        ocorrencias: 5,
        tem_rascunho: true,
        template: 'srv-java',
        run_url: 'https://run/1',
        branch: 'main',
        workflow: 'CI',
        job: 'build',
        step_cmd: 'mvn verify',
        exit_code: 1,
        log_tail: 'tail',
        campo_extra_do_ms5: 'deveria ser podado',
      },
      { fingerprint: 'fp2', assinatura: 'erro 2', ocorrencias: 1, tem_rascunho: false },
    ]);
    ms5.info.mockResolvedValueOnce({ orfaos: 5, solucoes: 2, rascunhos: 1 });
    curador.iaEstado.mockImplementation((fp: string) => (fp === 'fp1' ? 'falhou' : null));

    const r = await request(app.getHttpServer()).get('/v1/fila');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      itens: [
        {
          fingerprint: 'fp1', assinatura: 'erro 1', servico: 'svcA', nivel: 'ERROR',
          primeiro_visto: '2024-01-01', ocorrencias: 5, tem_rascunho: true,
          template: 'srv-java', run_url: 'https://run/1', branch: 'main',
          workflow: 'CI', job: 'build', step_cmd: 'mvn verify', exit_code: 1, log_tail: 'tail',
          ia_estado: 'falhou',
        },
        {
          fingerprint: 'fp2', assinatura: 'erro 2', servico: null, nivel: null,
          primeiro_visto: null, ocorrencias: 1, tem_rascunho: false,
          template: null, run_url: null, branch: null,
          workflow: null, job: null, step_cmd: null, exit_code: null, log_tail: null,
          ia_estado: null,
        },
      ],
      total: 5,
      truncado: true,
    });
    // item da fila carrega o contexto de esteira (Task 8)
    expect(r.body.itens[0]).toMatchObject({
      workflow: 'CI', job: 'build', step_cmd: 'mvn verify',
      exit_code: 1, log_tail: 'tail',
    });
    // omissão: órfão sem os campos de esteira → item cai para null
    expect(r.body.itens[1].workflow).toBeNull();
    expect(r.body.itens[1].exit_code).toBeNull();
  });

  it('GET /v1/fila → total igual aos itens → truncado false', async () => {
    ms5.listarOrfaos.mockResolvedValueOnce([{ fingerprint: 'fp1', assinatura: 'e', ocorrencias: 1, tem_rascunho: false }]);
    ms5.info.mockResolvedValueOnce({ orfaos: 1 });
    const r = await request(app.getHttpServer()).get('/v1/fila');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.truncado).toBe(false);
  });

  it('GET /v1/fila → counts sem a chave orfaos → total cai para itens.length', async () => {
    ms5.listarOrfaos.mockResolvedValueOnce([{ fingerprint: 'fp1', assinatura: 'e', ocorrencias: 1, tem_rascunho: false }]);
    ms5.info.mockResolvedValueOnce({});
    const r = await request(app.getHttpServer()).get('/v1/fila');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.truncado).toBe(false);
  });

  // ---------------------------------------------------------------- fila/:fp
  it('GET /v1/fila/:fp → 200 com rascunho', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro 1', ocorrencias: 2, tem_rascunho: true });
    ms5.obterRascunho.mockResolvedValueOnce({ fingerprint: 'fp1', solucao: 'faça X', autor: 'joao', atualizado_em: '2024-01-02' });

    const r = await request(app.getHttpServer()).get('/v1/fila/fp1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      fingerprint: 'fp1', assinatura: 'erro 1', servico: null, nivel: null, primeiro_visto: null,
      ocorrencias: 2, tem_rascunho: true, template: null, run_url: null, branch: null,
      workflow: null, job: null, step_cmd: null, exit_code: null, log_tail: null,
      ia_estado: null,
      rascunho: { fingerprint: 'fp1', solucao: 'faça X', autor: 'joao', atualizado_em: '2024-01-02' },
    });
    expect(ms5.obterRascunho).toHaveBeenCalledWith('fp1');
  });

  it('GET /v1/fila/:fp → órfão com contexto de esteira → workflow/job/step_cmd/exit_code/log_tail no corpo do caso', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({
      fingerprint: 'fp1', assinatura: 'erro 1', ocorrencias: 2, tem_rascunho: false,
      workflow: 'CI', job: 'build', step_cmd: 'mvn verify', exit_code: 1, log_tail: 'tail',
    });
    const r = await request(app.getHttpServer()).get('/v1/fila/fp1');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      workflow: 'CI', job: 'build', step_cmd: 'mvn verify',
      exit_code: 1, log_tail: 'tail',
    });
  });

  it('GET /v1/fila/:fp → órfão com branch → branch no corpo', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro 1', ocorrencias: 2, tem_rascunho: false, branch: 'main' });

    const r = await request(app.getHttpServer()).get('/v1/fila/fp1');
    expect(r.status).toBe(200);
    expect(r.body.branch).toBe('main');
  });

  it('GET /v1/fila/:fp → 200 sem rascunho (tem_rascunho false → não chama obterRascunho)', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp2', assinatura: 'erro 2', ocorrencias: 1, tem_rascunho: false });
    const r = await request(app.getHttpServer()).get('/v1/fila/fp2');
    expect(r.status).toBe(200);
    expect(r.body.tem_rascunho).toBe(false);
    expect(r.body.rascunho).toBeNull();
    expect(ms5.obterRascunho).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------- prompt-agente
  it('GET /v1/fila/:fp/prompt-agente → prompt REGISTRADO tem precedência (origem=registrado, constants do store)', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro 1', ocorrencias: 1, tem_rascunho: true });
    const pares = [
      { key: 'erro', value: 'erro 1' },
      { key: 'contexto', value: 'passo a passo' },
    ];
    promptStore.registrar('fp1', pares, '2026-08-22T10:00:00Z');

    const r = await request(app.getHttpServer()).get('/v1/fila/fp1/prompt-agente');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      origem: 'registrado',
      registrado_em: '2026-08-22T10:00:00Z',
      entidade: { tipo: 'workflow', nome: 'curador', versao: '1.0.0', bundle: 'dvop-agx-ssol-consulta-erro' },
      input: 'erro 1',
      constants: pares,
      nota: expect.stringContaining('system prompt'),
    });
    // não reconstrói quando há registro
    expect(curador.contexto).not.toHaveBeenCalled();
  });

  it('GET /v1/fila/:fp/prompt-agente → sem registro → RECONSTRÓI pelo builder do worker (origem=reconstruido)', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({
      fingerprint: 'fp9', assinatura: 'blob upload invalid', servico: 'svc-a', nivel: 'ERROR',
      ocorrencias: 1, tem_rascunho: true, template: 'srv-java', workflow: 'CI', job: 'push', step_cmd: 'docker push', exit_code: 1,
    });
    curador.contexto.mockResolvedValueOnce('doc relevante');

    const r = await request(app.getHttpServer()).get('/v1/fila/fp9/prompt-agente');
    expect(r.status).toBe(200);
    expect(r.body.origem).toBe('reconstruido');
    expect(r.body.registrado_em).toBeUndefined();
    expect(r.body.input).toBe('blob upload invalid');
    const constants = Object.fromEntries(r.body.constants.map((c: any) => [c.key, c.value]));
    expect(constants).toMatchObject({
      erro: 'blob upload invalid', assinatura: 'blob upload invalid', servico: 'svc-a',
      nivel: 'ERROR', contexto: 'doc relevante', workflow: 'CI', job: 'push', step_cmd: 'docker push', exit_code: '1',
    });
    expect(curador.contexto).toHaveBeenCalledTimes(1);
  });

  it('GET /v1/fila/:fp/prompt-agente → reconstrução resiste a MS 3 fora (contexto degrada, 200)', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro 1', ocorrencias: 1, tem_rascunho: true });
    curador.contexto.mockRejectedValueOnce(new Error('MS3 fora'));

    const r = await request(app.getHttpServer()).get('/v1/fila/fp1/prompt-agente');
    expect(r.status).toBe(200);
    expect(r.body.origem).toBe('reconstruido');
    const contexto = r.body.constants.find((c: any) => c.key === 'contexto').value;
    expect(contexto).toContain('indisponível');
  });

  it('GET /v1/fila/:fp/prompt-agente → 404 quando o órfão saiu da fila', async () => {
    ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(404, 'não encontrado'));
    const r = await request(app.getHttpServer()).get('/v1/fila/fp1/prompt-agente');
    expect(r.status).toBe(404);
  });

  it('GET /v1/fila/:fp → órfão com tem_rascunho true, mas rascunho 404 na corrida → tem_rascunho:false, rascunho:null', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp3', assinatura: 'erro 3', ocorrencias: 1, tem_rascunho: true });
    ms5.obterRascunho.mockRejectedValueOnce(new UpstreamError(404, 'rascunho sumiu'));
    const r = await request(app.getHttpServer()).get('/v1/fila/fp3');
    expect(r.status).toBe(200);
    expect(r.body.tem_rascunho).toBe(false);
    expect(r.body.rascunho).toBeNull();
  });

  it('GET /v1/fila/:fp → órfão inexistente → 404 verbatim', async () => {
    ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(404, 'x'));
    const r = await request(app.getHttpServer()).get('/v1/fila/naoexiste');
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('órfão não encontrado na fila');
  });

  it('GET /v1/fila/:fp → 5xx do MS5 propaga (502)', async () => {
    ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(502, 'ms5 fora'));
    const r = await request(app.getHttpServer()).get('/v1/fila/fp1');
    expect(r.status).toBe(502);
  });

  it('GET /v1/fila/:fp → fingerprint > 64 chars → 422 verbatim', async () => {
    const r = await request(app.getHttpServer()).get(`/v1/fila/${'a'.repeat(65)}`);
    expect(r.status).toBe(422);
    expect(r.body.detail).toBe('fingerprint inválido (1..64)');
  });

  it('GET /v1/fila/:fp → fingerprint com 64 chars (borda válida) → segue ao service', async () => {
    const fp = 'a'.repeat(64);
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: fp, assinatura: 'x', ocorrencias: 1, tem_rascunho: false });
    const r = await request(app.getHttpServer()).get(`/v1/fila/${fp}`);
    expect(r.status).toBe(200);
  });

  // ---------------------------------------------------------------- rascunho PUT
  it('PUT /v1/fila/:fp/rascunho → 200', async () => {
    ms5.salvarRascunho.mockResolvedValueOnce({ fingerprint: 'fp1', solucao: 'faça X', autor: 'joao', atualizado_em: '2024-01-01' });
    const r = await request(app.getHttpServer()).put('/v1/fila/fp1/rascunho').send({ solucao: 'faça X', autor: 'joao' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ fingerprint: 'fp1', solucao: 'faça X', autor: 'joao', atualizado_em: '2024-01-01' });
    expect(ms5.salvarRascunho).toHaveBeenCalledWith('fp1', 'faça X', 'joao');
  });

  it('PUT /v1/fila/:fp/rascunho → autor ausente vira null', async () => {
    ms5.salvarRascunho.mockResolvedValueOnce({ fingerprint: 'fp1', solucao: 'x', autor: null, atualizado_em: '2024-01-01' });
    const r = await request(app.getHttpServer()).put('/v1/fila/fp1/rascunho').send({ solucao: 'x' });
    expect(r.status).toBe(200);
    expect(ms5.salvarRascunho).toHaveBeenCalledWith('fp1', 'x', null);
  });

  it('PUT /v1/fila/:fp/rascunho → órfão inexistente → 404 verbatim', async () => {
    ms5.salvarRascunho.mockRejectedValueOnce(new UpstreamError(404, 'x'));
    const r = await request(app.getHttpServer()).put('/v1/fila/naoexiste/rascunho').send({ solucao: 'x' });
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('órfão não encontrado na fila');
  });

  it('PUT /v1/fila/:fp/rascunho → solucao vazia → 422', async () => {
    const r = await request(app.getHttpServer()).put('/v1/fila/fp1/rascunho').send({ solucao: '' });
    expect(r.status).toBe(422);
  });

  it('PUT /v1/fila/:fp/rascunho → solucao ausente → 422', async () => {
    const r = await request(app.getHttpServer()).put('/v1/fila/fp1/rascunho').send({});
    expect(r.status).toBe(422);
  });

  it('PUT /v1/fila/:fp/rascunho → solucao > 20000 chars → 422', async () => {
    const r = await request(app.getHttpServer()).put('/v1/fila/fp1/rascunho').send({ solucao: 'a'.repeat(20001) });
    expect(r.status).toBe(422);
  });

  it('PUT /v1/fila/:fp/rascunho → 5xx do MS5 (não-404) propaga', async () => {
    ms5.salvarRascunho.mockRejectedValueOnce(new UpstreamError(502, 'ms5 fora'));
    const r = await request(app.getHttpServer()).put('/v1/fila/fp1/rascunho').send({ solucao: 'x' });
    expect(r.status).toBe(502);
  });

  // ---------------------------------------------------------------- rascunho DELETE
  it('DELETE /v1/fila/:fp/rascunho → 204', async () => {
    ms5.excluirRascunho.mockResolvedValueOnce(undefined);
    const r = await request(app.getHttpServer()).delete('/v1/fila/fp1/rascunho');
    expect(r.status).toBe(204);
    expect(ms5.excluirRascunho).toHaveBeenCalledWith('fp1');
  });

  it('DELETE /v1/fila/:fp/rascunho → 404 verbatim "rascunho não encontrado"', async () => {
    ms5.excluirRascunho.mockRejectedValueOnce(new UpstreamError(404, 'x'));
    const r = await request(app.getHttpServer()).delete('/v1/fila/fp1/rascunho');
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('rascunho não encontrado');
  });

  it('DELETE /v1/fila/:fp/rascunho → 5xx do MS5 (não-404) propaga', async () => {
    ms5.excluirRascunho.mockRejectedValueOnce(new UpstreamError(502, 'ms5 fora'));
    const r = await request(app.getHttpServer()).delete('/v1/fila/fp1/rascunho');
    expect(r.status).toBe(502);
  });

  // ---------------------------------------------------------------- aprovar
  it('POST /v1/fila/:fp/aprovar → 201 com solucao no corpo (prioridade sobre rascunho) + métrica aprovado', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro X', servico: 'svcA', nivel: 'ERROR', ocorrencias: 1, tem_rascunho: true });
    ms5.obterRascunho.mockResolvedValueOnce({ fingerprint: 'fp1', solucao: 'rascunho antigo', autor: 'rascunho-autor', atualizado_em: '2024-01-01' });
    ms5.criarSolucao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro X', servico: 'svcA', nivel: 'ERROR', solucao: 'solucao do corpo', autor: 'maria', criado_em: '2024-01-03' });
    ms3.ingerirDocumento.mockResolvedValueOnce(undefined);

    const r = await request(app.getHttpServer()).post('/v1/fila/fp1/aprovar').send({ solucao: 'solucao do corpo', autor: 'maria' });
    expect(r.status).toBe(201);
    expect(ms5.criarSolucao).toHaveBeenCalledWith({
      fingerprint: 'fp1', assinatura: 'erro X', servico: 'svcA', nivel: 'ERROR', solucao: 'solucao do corpo', autor: 'maria',
      aprovado_por: 'test',
      run_url: null, template: null,
      workflow: null, job: null, step_cmd: null, exit_code: null, log_tail: null,
    });
    expect(r.body).toEqual({
      fingerprint: 'fp1', assinatura: 'erro X', servico: 'svcA', nivel: 'ERROR',
      solucao: 'solucao do corpo', autor: 'maria', criado_em: '2024-01-03', publicado_base: true,
    });
    expect(metrics.curadoria).toHaveBeenCalledWith('aprovado');
    expect(ms3.ingerirDocumento).toHaveBeenCalledWith([
      {
        titulo: 'erro X', conteudo: 'Erro: erro X\n\nSolução:\nsolucao do corpo', servico: 'svcA', nivel: 'ERROR', tags: ['curadoria'],
        origem_fingerprint: 'fp1', origem_run_url: null, aprovado_por: 'test',
      },
    ]);
  });

  it('leva run_url, template e o contexto de esteira do órfão para a solução e para a base', async () => {
    ms5.obterOrfao.mockResolvedValue({
      fingerprint: 'fp1', assinatura: 'erro X', servico: 'dvop-srv-demo', nivel: 'ERROR',
      tem_rascunho: false, template: 'srv-java', run_url: 'https://run/9',
      workflow: 'CI', job: 'build', step_cmd: 'mvn verify', exit_code: 1, log_tail: 'tail',
    });
    ms5.criarSolucao.mockResolvedValue({ fingerprint: 'fp1', solucao: 'sol' });
    ms3.ingerirDocumento.mockResolvedValue({ ingeridos: 1 });

    await request(app.getHttpServer())
      .post('/v1/fila/fp1/aprovar')
      .send({ solucao: 'sol', autor: 'tiago', publicar_base: true })
      .expect(201);

    expect(ms5.criarSolucao).toHaveBeenCalledWith(expect.objectContaining({
      fingerprint: 'fp1',
      assinatura: 'erro X',
      servico: 'dvop-srv-demo',
      nivel: 'ERROR',
      solucao: 'sol',
      autor: 'tiago',
      run_url: 'https://run/9', template: 'srv-java',
      workflow: 'CI', job: 'build', step_cmd: 'mvn verify', exit_code: 1, log_tail: 'tail',
    }));
    expect(ms3.ingerirDocumento).toHaveBeenCalledWith([
      expect.objectContaining({
        origem_fingerprint: 'fp1',
        origem_run_url: 'https://run/9',
      }),
    ]);
  });

  it('POST /v1/fila/:fp/aprovar → 201 usando a solução do rascunho salvo quando o corpo vem vazio', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro X', ocorrencias: 1, tem_rascunho: true });
    ms5.obterRascunho.mockResolvedValueOnce({ fingerprint: 'fp1', solucao: 'solucao do rascunho', autor: 'joao', atualizado_em: '2024-01-01' });
    ms5.criarSolucao.mockResolvedValueOnce({ fingerprint: 'fp1', solucao: 'solucao do rascunho', autor: 'joao' });
    ms3.ingerirDocumento.mockResolvedValueOnce(undefined);

    const r = await request(app.getHttpServer()).post('/v1/fila/fp1/aprovar').send({});
    expect(r.status).toBe(201);
    expect(ms5.criarSolucao).toHaveBeenCalledWith(expect.objectContaining({ solucao: 'solucao do rascunho', autor: 'joao' }));
  });

  it('POST /v1/fila/:fp/aprovar → sem solução (corpo vazio + sem rascunho) → 400 verbatim', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro X', ocorrencias: 1, tem_rascunho: false });
    const r = await request(app.getHttpServer()).post('/v1/fila/fp1/aprovar').send({});
    expect(r.status).toBe(400);
    expect(r.body.detail).toBe('sem solução: envie no corpo ou salve um rascunho antes');
    expect(ms5.criarSolucao).not.toHaveBeenCalled();
  });

  it('POST /v1/fila/:fp/aprovar → publicar_base=false não publica na base', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro X', ocorrencias: 1, tem_rascunho: false });
    ms5.criarSolucao.mockResolvedValueOnce({ fingerprint: 'fp1', solucao: 'x' });
    const r = await request(app.getHttpServer()).post('/v1/fila/fp1/aprovar').send({ solucao: 'x', publicar_base: false });
    expect(r.status).toBe(201);
    expect(r.body.publicado_base).toBe(false);
    expect(ms3.ingerirDocumento).not.toHaveBeenCalled();
  });

  it('POST /v1/fila/:fp/aprovar → publicação best-effort: MS3 lança UpstreamError → aprovação ainda 201 com publicado_base:false', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro X', ocorrencias: 1, tem_rascunho: false });
    ms5.criarSolucao.mockResolvedValueOnce({ fingerprint: 'fp1', solucao: 'x' });
    ms3.ingerirDocumento.mockRejectedValueOnce(new UpstreamError(502, 'ms3 fora'));

    const r = await request(app.getHttpServer()).post('/v1/fila/fp1/aprovar').send({ solucao: 'x' });
    expect(r.status).toBe(201);
    expect(r.body.publicado_base).toBe(false);
    expect(metrics.curadoria).toHaveBeenCalledWith('aprovado');
  });

  it('POST /v1/fila/:fp/aprovar → publicar_base default true, mas MS3 desabilitado → publicado_base:false sem chamar ingerirDocumento', async () => {
    ms3.enabled = false;
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro X', ocorrencias: 1, tem_rascunho: false });
    ms5.criarSolucao.mockResolvedValueOnce({ fingerprint: 'fp1', solucao: 'x' });
    const r = await request(app.getHttpServer()).post('/v1/fila/fp1/aprovar').send({ solucao: 'x' });
    expect(r.status).toBe(201);
    expect(r.body.publicado_base).toBe(false);
    expect(ms3.ingerirDocumento).not.toHaveBeenCalled();
  });

  it('POST /v1/fila/:fp/aprovar → órfão inexistente → 404 verbatim', async () => {
    ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(404, 'x'));
    const r = await request(app.getHttpServer()).post('/v1/fila/naoexiste/aprovar').send({ solucao: 'x' });
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('órfão não encontrado na fila');
  });

  it('POST /v1/fila/:fp/aprovar → 5xx do MS5 ao buscar o rascunho (não-404) propaga', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro X', ocorrencias: 1, tem_rascunho: true });
    ms5.obterRascunho.mockRejectedValueOnce(new UpstreamError(502, 'ms5 fora'));
    const r = await request(app.getHttpServer()).post('/v1/fila/fp1/aprovar').send({ solucao: 'x' });
    expect(r.status).toBe(502);
    expect(ms5.criarSolucao).not.toHaveBeenCalled();
  });

  it('POST /v1/fila/:fp/aprovar → erro não-UpstreamError ao publicar na base propaga (não é best-effort)', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'erro X', ocorrencias: 1, tem_rascunho: false });
    ms5.criarSolucao.mockResolvedValueOnce({ fingerprint: 'fp1', solucao: 'x' });
    ms3.ingerirDocumento.mockRejectedValueOnce(new Error('bug inesperado'));
    const r = await request(app.getHttpServer()).post('/v1/fila/fp1/aprovar').send({ solucao: 'x' });
    expect(r.status).toBe(500);
  });

  it('POST /v1/fila/:fp/aprovar → solucao > 20000 chars → 422', async () => {
    const r = await request(app.getHttpServer()).post('/v1/fila/fp1/aprovar').send({ solucao: 'a'.repeat(20001) });
    expect(r.status).toBe(422);
  });

  // ---------------------------------------------------------------- descartar
  it('POST /v1/fila/:fp/descartar → 204 + métrica descartado', async () => {
    ms5.excluirOrfao.mockResolvedValueOnce(undefined);
    const r = await request(app.getHttpServer()).post('/v1/fila/fp1/descartar');
    expect(r.status).toBe(204);
    expect(ms5.excluirOrfao).toHaveBeenCalledWith('fp1');
    expect(metrics.curadoria).toHaveBeenCalledWith('descartado');
  });

  it('POST /v1/fila/:fp/descartar → 404 do MS5 propaga verbatim (sem tradução de mensagem) e não conta métrica', async () => {
    ms5.excluirOrfao.mockRejectedValueOnce(new UpstreamError(404, 'órfão inexistente no MS5'));
    const r = await request(app.getHttpServer()).post('/v1/fila/naoexiste/descartar');
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('órfão inexistente no MS5');
    expect(metrics.curadoria).not.toHaveBeenCalledWith('descartado');
  });

  // ---------------------------------------------------------------- solucoes
  it('GET /v1/solucoes → 200, default limit 100', async () => {
    ms5.listarSolucoes.mockResolvedValueOnce([{ fingerprint: 'fp1' }]);
    const r = await request(app.getHttpServer()).get('/v1/solucoes');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      solucoes: [{ fingerprint: 'fp1', elegivel: false, remediacao_id: null, remediacao_versao: null }],
    });
    expect(ms5.listarSolucoes).toHaveBeenCalledWith(100);
  });

  it('GET /v1/solucoes?limit=500 → 200 (borda superior válida)', async () => {
    ms5.listarSolucoes.mockResolvedValueOnce([]);
    const r = await request(app.getHttpServer()).get('/v1/solucoes?limit=500');
    expect(r.status).toBe(200);
    expect(ms5.listarSolucoes).toHaveBeenCalledWith(500);
  });

  it('GET /v1/solucoes?limit=0 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/v1/solucoes?limit=0');
    expect(r.status).toBe(422);
  });

  it('GET /v1/solucoes?limit=501 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/v1/solucoes?limit=501');
    expect(r.status).toBe(422);
  });

  it('anota as soluções do cache com o vínculo de elegibilidade', async () => {
    ms5.listarSolucoes.mockResolvedValue([
      { fingerprint: 'fp1', assinatura: 'erro X', solucao: 'sol' },
      { fingerprint: 'fp2', assinatura: 'erro Y', solucao: 'sol' },
    ]);
    elegibilidade.upsert(
      { fingerprint: 'fp1', remediacao_id: 'versao-ja-publicada', remediacao_versao: '1.0.0', assinatura: 'erro X' },
      '2026-08-03T10:00:00+00:00',
    );

    const res = await request(app.getHttpServer()).get('/v1/solucoes').expect(200);

    expect(res.body.solucoes[0]).toMatchObject({ elegivel: true, remediacao_id: 'versao-ja-publicada' });
    expect(res.body.solucoes[1]).toMatchObject({ elegivel: false, remediacao_id: null });
  });

  // ---------------------------------------------------------------- documentos
  it('GET /v1/documentos → 503 quando MS3 off, mensagem verbatim (env CURADORIA_BFF_MS3_URL)', async () => {
    ms3.enabled = false;
    const r = await request(app.getHttpServer()).get('/v1/documentos');
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe('base de conhecimento indisponível: configure CURADORIA_BFF_MS3_URL');
  });

  it('GET /v1/documentos → 200 quando MS3 on, default limit 50', async () => {
    ms3.listarDocumentos.mockResolvedValueOnce({ documentos: [], total: 0 });
    const r = await request(app.getHttpServer()).get('/v1/documentos');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ documentos: [], total: 0 });
    expect(ms3.listarDocumentos).toHaveBeenCalledWith(50);
  });

  it('anota os documentos da base com o vínculo de elegibilidade e preserva o total do MS3', async () => {
    ms3.listarDocumentos.mockResolvedValueOnce({
      documentos: [
        { id: 1, origem_fingerprint: 'fp1' },
        { id: 2, origem_fingerprint: null },
      ],
      total: 42,
    });
    elegibilidade.upsert(
      { fingerprint: 'fp1', remediacao_id: 'versao-ja-publicada', remediacao_versao: '1.0.0', assinatura: 'erro X' },
      '2026-08-03T10:00:00+00:00',
    );

    const res = await request(app.getHttpServer()).get('/v1/documentos').expect(200);

    expect(res.body.total).toBe(42);
    expect(res.body.documentos[0]).toMatchObject({ elegivel: true, remediacao_id: 'versao-ja-publicada' });
    expect(res.body.documentos[1]).toMatchObject({ elegivel: false, remediacao_id: null });
  });

  it('GET /v1/documentos?limit=0 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/v1/documentos?limit=0');
    expect(r.status).toBe(422);
  });

  it('GET /v1/documentos?limit=201 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/v1/documentos?limit=201');
    expect(r.status).toBe(422);
  });

  // ---------------------------------------------------------------- info
  it('GET /v1/info → 200 shape completo', async () => {
    ms5.info.mockResolvedValueOnce({ orfaos: 5, solucoes: 9, rascunhos: 2 });
    elegibilidade.count.mockReturnValueOnce(7);
    const r = await request(app.getHttpServer()).get('/v1/info');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      fila: 5, solucoes: 9, rascunhos: 2, elegibilidade: 7,
      ms5_url: 'http://ms5:8002', retrieval_disponivel: true, remediacao_disponivel: true,
    });
  });

  it('GET /v1/info → chaves ausentes no counts caem para null', async () => {
    ms5.info.mockResolvedValueOnce({});
    const r = await request(app.getHttpServer()).get('/v1/info');
    expect(r.status).toBe(200);
    expect(r.body.fila).toBeNull();
    expect(r.body.solucoes).toBeNull();
    expect(r.body.rascunhos).toBeNull();
  });

  it('GET /v1/info → retrieval_disponivel/remediacao_disponivel refletem enabled dos upstreams', async () => {
    ms3.enabled = false;
    ms8.enabled = false;
    ms5.info.mockResolvedValueOnce({});
    const r = await request(app.getHttpServer()).get('/v1/info');
    expect(r.body.retrieval_disponivel).toBe(false);
    expect(r.body.remediacao_disponivel).toBe(false);
    ms8.enabled = true;
  });
});
