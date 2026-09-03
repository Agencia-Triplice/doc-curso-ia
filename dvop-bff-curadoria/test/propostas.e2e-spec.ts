import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PropostasController } from '../src/api/propostas.controller';
import { CacheWriterService } from '../src/upstreams/cache-writer.service';
import { RemediationService } from '../src/upstreams/remediation.service';
import { PropostaStore } from '../src/propostas/proposta-store.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { DetailExceptionFilter } from '../src/common/exception.filter';
import { UpstreamError } from '../src/common/upstream-error';
import { APP_CONFIG } from '../src/config/env';
import { AuthGuard } from '../src/auth/auth.guard';
import { SessionService } from '../src/auth/session.service';

describe('PropostasController (e2e)', () => {
  let app: INestApplication;

  const ms5 = {
    obterOrfao: jest.fn(),
    obterSolucao: jest.fn(),
  };
  const ms8 = {
    enabled: true,
    aplicarPr: jest.fn(),
    fecharPr: jest.fn(),
    listarRemediacoes: jest.fn(),
    listarBranchesRepo: jest.fn(),
  };
  const store = {
    criarGerando: jest.fn(),
    get: jest.fn(),
    atualizar: jest.fn(),
    delete: jest.fn(),
    // CAS de estado (trava anti-duplo-PR): default = vencedor (true).
    transicionarEstado: jest.fn().mockReturnValue(true),
  };
  const metrics = { curadoria: jest.fn() };
  // bypass do AuthGuard: dev-user fora de produção (mesmo padrão de
  // eligibility.e2e-spec.ts) — a sessão dev vira req.user.nome = 'test' e
  // alimenta aprovado_por.
  const cfg = {
    sessionSecret: 'test',
    sessionTtl: 3600,
    authDevUser: 'test',
    production: false,
    githubAllowedTeams: [] as string[],
    propostaMaxArquivos: 3,
    propostaMaxLinhasDiff: 80,
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [PropostasController],
      providers: [
        { provide: CacheWriterService, useValue: ms5 },
        { provide: RemediationService, useValue: ms8 },
        { provide: PropostaStore, useValue: store },
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

  // ---------------------------------------------------------------- POST criar
  it('POST /v1/propostas/:fp cria gerando buscando dados do erro', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a' });
    ms5.obterSolucao.mockResolvedValueOnce({ solucao: 's' });
    store.criarGerando.mockReturnValue({ fingerprint: 'fp', estado: 'gerando' });
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp').send({ paths: ['package.json'] });
    expect(r.status).toBe(200);
    expect(store.criarGerando).toHaveBeenCalled();
  });

  it('POST /v1/propostas/:fp → 404 fingerprint desconhecido (órfão e solução ambos 404)', async () => {
    ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(404, 'x'));
    ms5.obterSolucao.mockRejectedValueOnce(new UpstreamError(404, 'y'));
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp').send({});
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('fingerprint desconhecido: não está na fila nem no cache');
    expect(store.criarGerando).not.toHaveBeenCalled();
  });

  it('POST /v1/propostas/:fp → sem solução curada (404) cai no rascunho do órfão', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({
      fingerprint: 'fp',
      servico: 'org/app',
      assinatura: 'erro X em pkg.json',
      rascunho: { solucao: 'solução do rascunho' },
    });
    ms5.obterSolucao.mockRejectedValueOnce(new UpstreamError(404, 'sem solução'));
    store.criarGerando.mockReturnValueOnce({ fingerprint: 'fp', estado: 'gerando' });
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp').send({});
    expect(r.status).toBe(200);
    const [input] = store.criarGerando.mock.calls[0];
    expect(input.solucao).toBe('solução do rascunho');
    // sem paths manuais: seleciona pela assinatura + manifestos comuns
    expect(input.paths).toEqual(expect.arrayContaining(['pkg.json', 'package.json']));
  });

  it('POST /v1/propostas/:fp → body inválido (paths não-array) → 422', async () => {
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp').send({ paths: 'não é array' });
    expect(r.status).toBe(422);
  });

  it('POST /v1/propostas/:fp → instrucao acima de 2000 chars → 422', async () => {
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp').send({ instrucao: 'x'.repeat(2001) });
    expect(r.status).toBe(422);
  });

  // ---------------------------------------------------------------- GET
  it('GET /v1/propostas/:fp → 200 com arquivos desserializados', async () => {
    store.get.mockReturnValueOnce({
      fingerprint: 'fp',
      estado: 'pronta',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_novo: 'x' }]),
    });
    const r = await request(app.getHttpServer()).get('/v1/propostas/fp');
    expect(r.status).toBe(200);
    expect(r.body.arquivos).toEqual([{ path: 'p', conteudo_novo: 'x' }]);
    expect(r.body.arquivos_json).toBeUndefined();
    // teto de escopo exposto ao cockpit (gate real do card de PR)
    expect(r.body.teto).toEqual({ max_arquivos: 3, max_linhas: 80 });
  });

  it('GET /v1/propostas/:fp → 404 quando não existe', async () => {
    store.get.mockReturnValueOnce(null);
    const r = await request(app.getHttpServer()).get('/v1/propostas/fp');
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('proposta não encontrada');
  });

  // ---------------------------------------------------------------- aprovar
  it('POST /v1/propostas/:fp/aprovar exige estado pronta', async () => {
    store.get.mockReturnValue({ fingerprint: 'fp', estado: 'gerando' });
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    expect(r.status).toBe(409);
  });

  it('POST /v1/propostas/:fp/aprovar → 404 quando a proposta não existe', async () => {
    store.get.mockReturnValueOnce(null);
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    expect(r.status).toBe(404);
  });

  it('POST /v1/propostas/:fp/aprovar → 503 quando MS8 off', async () => {
    ms8.enabled = false;
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    expect(r.status).toBe(503);
    expect(store.get).not.toHaveBeenCalled();
  });

  it('POST /v1/propostas/:fp/aprovar → 409 quando o teto gravado excede a config atual', async () => {
    store.get.mockReturnValueOnce({ fingerprint: 'fp', estado: 'pronta', n_arquivos: 10, n_linhas_diff: 5 });
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    expect(r.status).toBe(409);
    expect(ms8.aplicarPr).not.toHaveBeenCalled();
  });

  it('aprovar chama ms8.aplicarPr e grava pr_aberto', async () => {
    store.get.mockReturnValue({
      fingerprint: 'fp',
      estado: 'pronta',
      servico: 'org/app',
      titulo_pr: 't',
      corpo_pr: 'c',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_novo: 'x' }]),
      n_arquivos: 1,
      n_linhas_diff: 1,
    });
    ms8.aplicarPr.mockResolvedValueOnce({ pr_numero: 7, pr_url: 'http://gh/pr/7' });
    store.atualizar.mockReturnValueOnce({ fingerprint: 'fp', estado: 'pr_aberto', pr_numero: 7, pr_url: 'http://gh/pr/7' });
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    expect(r.status).toBe(200);
    expect(ms8.aplicarPr).toHaveBeenCalled();
    expect(store.atualizar).toHaveBeenCalledWith(
      'fp',
      expect.objectContaining({ estado: 'pr_aberto', pr_numero: 7 }),
      expect.any(String),
    );
    // o objeto passado ao MS 8 NUNCA carrega conteudo_atual — só
    // {path, conteudo_novo, operacao} (operacao default 'editar' p/ proposta legada)
    const [pedido] = ms8.aplicarPr.mock.calls[0];
    expect(pedido.arquivos).toEqual([{ path: 'p', conteudo_novo: 'x', operacao: 'editar' }]);
    for (const a of pedido.arquivos) {
      expect(a).not.toHaveProperty('conteudo_atual');
    }
  });

  it('aprovar devolve pr_branch = a branch REAL criada pelo MS 8', async () => {
    store.get.mockReturnValue({
      fingerprint: 'fp',
      estado: 'pronta',
      servico: 'org/app',
      titulo_pr: 't',
      corpo_pr: 'c',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_novo: 'x' }]),
      n_arquivos: 1,
      n_linhas_diff: 1,
    });
    // o PrOut do MS 8 traz branch (agentix-pr-<fp>-<ts>); a curadoria a repassa
    ms8.aplicarPr.mockResolvedValueOnce({ pr_numero: 9, pr_url: 'http://gh/pr/9', branch: 'agentix-pr-fp-123' });
    store.atualizar.mockReturnValueOnce({ fingerprint: 'fp', estado: 'pr_aberto', pr_numero: 9, pr_url: 'http://gh/pr/9' });
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    expect(r.status).toBe(200);
    expect(r.body.pr_branch).toBe('agentix-pr-fp-123');
  });

  it('aprovar concorrente: perdedor do CAS pronta→aprovando recebe 409 e NÃO abre PR', async () => {
    store.get.mockReturnValueOnce({
      fingerprint: 'fp',
      estado: 'pronta',
      servico: 'org/app',
      titulo_pr: 't',
      corpo_pr: 'c',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_novo: 'x' }]),
      n_arquivos: 1,
      n_linhas_diff: 1,
    });
    // outro request já pegou a transição pronta→aprovando: este perde o CAS
    store.transicionarEstado.mockReturnValueOnce(false);
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    expect(r.status).toBe(409);
    expect(ms8.aplicarPr).not.toHaveBeenCalled();
  });

  it('aprovar reverte aprovando→pronta se o MS 8 falhar ao abrir o PR', async () => {
    store.get.mockReturnValue({
      fingerprint: 'fp',
      estado: 'pronta',
      servico: 'org/app',
      titulo_pr: 't',
      corpo_pr: 'c',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_novo: 'x' }]),
      n_arquivos: 1,
      n_linhas_diff: 1,
    });
    ms8.aplicarPr.mockRejectedValueOnce(new Error('MS8 fora'));
    await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    // após tentar (e falhar) abrir o PR, o estado volta para pronta p/ retry
    expect(store.transicionarEstado).toHaveBeenCalledWith('fp', 'aprovando', 'pronta', expect.any(String));
  });

  it('aprovar envia branch_base = a branch da run do órfão do caso', async () => {
    store.get.mockReturnValue({
      fingerprint: 'fp',
      estado: 'pronta',
      servico: 'org/app',
      titulo_pr: 't',
      corpo_pr: 'c',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_novo: 'x' }]),
      n_arquivos: 1,
      n_linhas_diff: 1,
    });
    // órfão do caso traz a branch em que a run de CI rodou → vira a base do PR
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a', branch: 'feature-x' });
    ms8.aplicarPr.mockResolvedValueOnce({ pr_numero: 9, pr_url: 'http://gh/pr/9' });
    store.atualizar.mockReturnValueOnce({ fingerprint: 'fp', estado: 'pr_aberto' });
    await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    const [pedido] = ms8.aplicarPr.mock.calls[0];
    expect(pedido.branch_base).toBe('feature-x');
  });

  it('aprovar envia branch_base null quando o órfão não tem branch (MS 8 cai para a default)', async () => {
    store.get.mockReturnValue({
      fingerprint: 'fp',
      estado: 'pronta',
      servico: 'org/app',
      titulo_pr: 't',
      corpo_pr: 'c',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_novo: 'x' }]),
      n_arquivos: 1,
      n_linhas_diff: 1,
    });
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a' });
    ms8.aplicarPr.mockResolvedValueOnce({ pr_numero: 9, pr_url: 'http://gh/pr/9' });
    store.atualizar.mockReturnValueOnce({ fingerprint: 'fp', estado: 'pr_aberto' });
    await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    const [pedido] = ms8.aplicarPr.mock.calls[0];
    expect(pedido.branch_base).toBeNull();
  });

  it('aprovar usa a base escolhida pelo operador (override) sem consultar o órfão', async () => {
    store.get.mockReturnValue({
      fingerprint: 'fp',
      estado: 'pronta',
      servico: 'org/app',
      titulo_pr: 't',
      corpo_pr: 'c',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_novo: 'x' }]),
      n_arquivos: 1,
      n_linhas_diff: 1,
    });
    ms8.aplicarPr.mockResolvedValueOnce({ pr_numero: 12, pr_url: 'http://gh/pr/12' });
    store.atualizar.mockReturnValueOnce({ fingerprint: 'fp', estado: 'pr_aberto' });
    await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({ base: 'develop' });
    const [pedido] = ms8.aplicarPr.mock.calls[0];
    expect(pedido.branch_base).toBe('develop');
    // base explícita tem precedência: não precisa consultar o órfão do caso
    expect(ms5.obterOrfao).not.toHaveBeenCalled();
  });

  it('aprovar descarta conteudo_atual mesmo quando presente na linha guardada', async () => {
    store.get.mockReturnValueOnce({
      fingerprint: 'fp',
      estado: 'pronta',
      servico: 'org/app',
      titulo_pr: 't',
      corpo_pr: 'c',
      arquivos_json: JSON.stringify([{ path: 'p', conteudo_atual: 'antigo', conteudo_novo: 'novo' }]),
      n_arquivos: 1,
      n_linhas_diff: 1,
    });
    ms8.aplicarPr.mockResolvedValueOnce({ pr_numero: 8, pr_url: 'http://gh/pr/8' });
    store.atualizar.mockReturnValueOnce({ fingerprint: 'fp', estado: 'pr_aberto' });
    await request(app.getHttpServer()).post('/v1/propostas/fp/aprovar').send({});
    const [pedido] = ms8.aplicarPr.mock.calls[0];
    expect(pedido.arquivos).toEqual([{ path: 'p', conteudo_novo: 'novo', operacao: 'editar' }]);
    expect(pedido.arquivos[0]).not.toHaveProperty('conteudo_atual');
  });

  // ---------------------------------------------------------------- regenerar
  it('POST /v1/propostas/:fp/regenerar volta para gerando', async () => {
    ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a' });
    ms5.obterSolucao.mockResolvedValueOnce({ solucao: 's' });
    store.criarGerando.mockReturnValueOnce({ fingerprint: 'fp', estado: 'gerando' });
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/regenerar').send({ instrucao: 'tenta de novo' });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('gerando');
    expect(store.criarGerando).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- DELETE
  it('DELETE /v1/propostas/:fp → 204', async () => {
    store.delete.mockReturnValueOnce(true);
    const r = await request(app.getHttpServer()).delete('/v1/propostas/fp');
    expect(r.status).toBe(204);
    expect(store.delete).toHaveBeenCalledWith('fp');
  });

  it('DELETE /v1/propostas/:fp → 404 quando não existe', async () => {
    store.delete.mockReturnValueOnce(false);
    const r = await request(app.getHttpServer()).delete('/v1/propostas/fp');
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('proposta não encontrada');
  });

  // ---------------------------------------------------------------- fechar-pr
  it('POST /v1/propostas/:fp/fechar-pr → chama ms8.fecharPr e grava pr_rejeitado', async () => {
    store.get.mockReturnValueOnce({ fingerprint: 'fp', estado: 'pr_aberto' });
    ms8.fecharPr.mockResolvedValueOnce(undefined);
    store.atualizar.mockReturnValueOnce({ fingerprint: 'fp', estado: 'pr_rejeitado' });
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/fechar-pr').send({});
    expect(r.status).toBe(200);
    expect(ms8.fecharPr).toHaveBeenCalledWith('fp');
    expect(store.atualizar).toHaveBeenCalledWith('fp', expect.objectContaining({ estado: 'pr_rejeitado' }), expect.any(String));
    expect(r.body.estado).toBe('pr_rejeitado');
  });

  it('POST /v1/propostas/:fp/fechar-pr → 404 quando a proposta não existe', async () => {
    store.get.mockReturnValueOnce(null);
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/fechar-pr').send({});
    expect(r.status).toBe(404);
    expect(ms8.fecharPr).not.toHaveBeenCalled();
  });

  it('POST /v1/propostas/:fp/fechar-pr → 503 quando MS8 off', async () => {
    ms8.enabled = false;
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/fechar-pr').send({});
    expect(r.status).toBe(503);
    expect(store.get).not.toHaveBeenCalled();
  });

  it('POST /v1/propostas/:fp/fechar-pr → propaga 404 do MS8 (PR não encontrado)', async () => {
    store.get.mockReturnValueOnce({ fingerprint: 'fp', estado: 'pr_aberto' });
    ms8.fecharPr.mockRejectedValueOnce(new UpstreamError(404, 'PR não encontrado'));
    const r = await request(app.getHttpServer()).post('/v1/propostas/fp/fechar-pr').send({});
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe('PR não encontrado');
    expect(store.atualizar).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------- remediacoes-aplicaveis
  describe('GET /v1/remediacoes-aplicaveis/:fp', () => {
    const CAT = { remediacoes: [
      { id: 'versao-ja-publicada', versao: '2', aplicabilidade: { assinatura_regex: '(?i)does not allow updating assets' } },
      { id: 'outra', versao: '1', aplicabilidade: { assinatura_regex: 'timeout' } },
    ], total: 2 };

    it('devolve só as remediações que casam com a assinatura do erro', async () => {
      ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: '400 Repository does not allow updating assets', servico: 'owner/repo', template: 'bff-node' });
      ms8.listarRemediacoes.mockResolvedValueOnce(CAT);
      const r = await request(app.getHttpServer()).get('/v1/remediacoes-aplicaveis/fp1');
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(1);
      expect(r.body.aplicaveis.map((x: any) => x.id)).toEqual(['versao-ja-publicada']);
    });

    it('lista vazia quando nada casa', async () => {
      ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'ECONNRESET', servico: 'owner/repo', template: 'bff-node' });
      ms8.listarRemediacoes.mockResolvedValueOnce(CAT);
      const r = await request(app.getHttpServer()).get('/v1/remediacoes-aplicaveis/fp1');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ aplicaveis: [], total: 0, teto: { max_arquivos: 3, max_linhas: 80 } });
    });

    it('404 quando o fingerprint não está na fila nem no cache', async () => {
      ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(404, 'x'));
      ms5.obterSolucao.mockRejectedValueOnce(new UpstreamError(404, 'x'));
      const r = await request(app.getHttpServer()).get('/v1/remediacoes-aplicaveis/fp1');
      expect(r.status).toBe(404);
      expect(ms8.listarRemediacoes).not.toHaveBeenCalled();
    });

    it('502 catalogo_indisponivel quando o MS8 falha ao listar', async () => {
      ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp1', assinatura: 'x', servico: 'owner/repo', template: 'bff-node' });
      ms8.listarRemediacoes.mockRejectedValueOnce(new UpstreamError(503, 'down'));
      const r = await request(app.getHttpServer()).get('/v1/remediacoes-aplicaveis/fp1');
      expect(r.status).toBe(502);
      expect(r.body.detail).toBe('catalogo_indisponivel');
    });

    it('503 quando MS8 off', async () => {
      ms8.enabled = false;
      const r = await request(app.getHttpServer()).get('/v1/remediacoes-aplicaveis/fp1');
      expect(r.status).toBe(503);
    });
  });

  // ---------------------------------------------------------------- branches
  describe('GET /v1/propostas/:fp/branches', () => {
    it('devolve as branches do repo do caso (servico resolvido pelo órfão)', async () => {
      ms5.obterOrfao.mockResolvedValueOnce({ fingerprint: 'fp', servico: 'org/app', assinatura: 'a' });
      ms8.listarBranchesRepo.mockResolvedValueOnce({ branches: ['main', 'develop', 'release-2'] });
      const r = await request(app.getHttpServer()).get('/v1/propostas/fp/branches');
      expect(r.status).toBe(200);
      expect(r.body.branches).toEqual(['main', 'develop', 'release-2']);
      expect(ms8.listarBranchesRepo).toHaveBeenCalledWith('org/app');
    });

    it('404 quando o fingerprint não está na fila nem no cache', async () => {
      ms5.obterOrfao.mockRejectedValueOnce(new UpstreamError(404, 'x'));
      ms5.obterSolucao.mockRejectedValueOnce(new UpstreamError(404, 'x'));
      const r = await request(app.getHttpServer()).get('/v1/propostas/fp/branches');
      expect(r.status).toBe(404);
      expect(ms8.listarBranchesRepo).not.toHaveBeenCalled();
    });

    it('503 quando MS8 off', async () => {
      ms8.enabled = false;
      const r = await request(app.getHttpServer()).get('/v1/propostas/fp/branches');
      expect(r.status).toBe(503);
      expect(ms5.obterOrfao).not.toHaveBeenCalled();
    });
  });
});
