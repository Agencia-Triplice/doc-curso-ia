import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { CockpitHeadlessController } from '../src/api/cockpit-headless.controller';
import { DiagnosticoMistoService } from '../src/diagnostico/diagnostico-misto.service';
import { CuradoriaPropostaService } from '../src/upstreams/curadoria-proposta.service';
import { DetailExceptionFilter } from '../src/common/exception.filter';

const curadoriaOn = (over: any = {}) => ({
  enabled: true, aplicaveis: jest.fn(), gerar: jest.fn(), obter: jest.fn(), aprovar: jest.fn(), rejeitar: jest.fn(), ...over,
});

// NOTA (nuance conhecida): os global pipes precisam ser registrados ANTES de
// app.init() para valerem nas requisições — registrar depois não tem efeito.
// `comPipeValidacao` deixa esse caso opt-in sem mexer nos testes que não precisam dele.
async function montar(misto: any, curadoria: any, comPipeValidacao = false): Promise<INestApplication> {
  const mod = await Test.createTestingModule({
    controllers: [CockpitHeadlessController],
    providers: [
      { provide: DiagnosticoMistoService, useValue: misto },
      { provide: CuradoriaPropostaService, useValue: curadoria },
    ],
  }).compile();
  const app = mod.createNestApplication();
  app.useGlobalFilters(new DetailExceptionFilter());
  if (comPipeValidacao) {
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
  }
  await app.init();
  return app;
}

const mistoCacheExato = {
  triagem: { usada: false, intencao: 'diagnosticar' },
  itens: [{ tipo: 'texto', papel: 'erro', diagnostico: { fingerprint: 'fp1', assinatura: 'erro X', servico: 'srv-java', nivel: 'ERROR', resultado: 'cache_exato', similaridade: 0.99, solucao: { solucao: 'y' } } }],
};

describe('POST /api/cockpit/analisar (e2e)', () => {
  it('cache_exato com remediação aplicável → trace + acoes.pr_disponivel', async () => {
    const cur = curadoriaOn();
    cur.aplicaveis.mockResolvedValueOnce({ aplicaveis: [{ id: 'pdf', versao: '1', titulo_pr_template: 'chore: pdf', instrucao: 'faça X', escopo: { paths_permitidos: ['pom.xml'] } }], total: 1 });
    const app = await montar({ diagnosticar: async () => mistoCacheExato }, cur);
    const r = await request(app.getHttpServer()).post('/api/cockpit/analisar').send({ message: 'erro X' });
    expect(r.status).toBe(200);
    expect(r.body.trace.desfecho.resultado).toBe('cache_exato');
    expect(r.body.acoes.pr_disponivel).toEqual({ fingerprint: 'fp1', remediacao_id: 'pdf', remediacao_versao: '1', titulo: 'chore: pdf', instrucao: 'faça X' });
    expect(cur.aplicaveis).toHaveBeenCalledWith('fp1');
    await app.close();
  });

  it('cache_exato sem remediação aplicável → acoes vazio', async () => {
    const cur = curadoriaOn();
    cur.aplicaveis.mockResolvedValueOnce({ aplicaveis: [], total: 0 });
    const app = await montar({ diagnosticar: async () => mistoCacheExato }, cur);
    const r = await request(app.getHttpServer()).post('/api/cockpit/analisar').send({ message: 'erro X' });
    expect(r.status).toBe(200);
    expect(r.body.acoes).toEqual({});
    await app.close();
  });

  it('escalado → não consulta aplicáveis, acoes vazio', async () => {
    const cur = curadoriaOn();
    const misto = { triagem: { usada: false }, itens: [{ tipo: 'texto', diagnostico: { fingerprint: 'fp9', assinatura: 'z', servico: null, nivel: null, resultado: 'escalado', confianca: 0.1, documentos: [] } }] };
    const app = await montar({ diagnosticar: async () => misto }, cur);
    const r = await request(app.getHttpServer()).post('/api/cockpit/analisar').send({ message: 'z' });
    expect(r.status).toBe(200);
    expect(r.body.acoes).toEqual({});
    expect(cur.aplicaveis).not.toHaveBeenCalled();
    await app.close();
  });

  it('curadoria off → analisa e responde, acoes vazio', async () => {
    const app = await montar({ diagnosticar: async () => mistoCacheExato }, curadoriaOn({ enabled: false }));
    const r = await request(app.getHttpServer()).post('/api/cockpit/analisar').send({ message: 'erro X' });
    expect(r.status).toBe(200);
    expect(r.body.trace.desfecho.resultado).toBe('cache_exato');
    expect(r.body.acoes).toEqual({});
    await app.close();
  });

  it('falha na consulta de remediações aplicáveis (503) → 200 com acoes vazio (não derruba a análise)', async () => {
    const { UpstreamError } = await import('../src/common/upstream-error');
    const cur = curadoriaOn();
    cur.aplicaveis.mockRejectedValueOnce(new UpstreamError(503, 'curadoria fora'));
    const app = await montar({ diagnosticar: async () => mistoCacheExato }, cur);
    const r = await request(app.getHttpServer()).post('/api/cockpit/analisar').send({ message: 'erro X' });
    expect(r.status).toBe(200);
    expect(r.body.acoes).toEqual({});
    await app.close();
  });

  it('message vazia → 422 (DTO)', async () => {
    const app = await montar({ diagnosticar: async () => mistoCacheExato }, curadoriaOn(), true);
    const r = await request(app.getHttpServer()).post('/api/cockpit/analisar').send({ message: '' });
    expect(r.status).toBe(422);
    await app.close();
  });
});

describe('comandos de PR (e2e)', () => {
  it('POST aprovar → 202 gerando; gera com instrucao/paths da remediação', async () => {
    const cur = curadoriaOn();
    cur.aplicaveis.mockResolvedValueOnce({ aplicaveis: [{ id: 'pdf', versao: '1', instrucao: 'faça X', escopo: { paths_permitidos: ['pom.xml'] } }], total: 1 });
    cur.gerar.mockResolvedValueOnce({ estado: 'gerando' });
    // orquestrarAbertura roda fire-and-forget após o request; sem este mock, `obter`
    // resolveria undefined e o loop entraria no setTimeout(3000) real (vaza timer,
    // Jest não sai limpo). Estado terminal ('pr_...') faz retornar na 1ª volta.
    cur.obter.mockResolvedValue({ estado: 'pr_aberto' });
    const app = await montar({ diagnosticar: async () => ({}) }, cur);
    const r = await request(app.getHttpServer()).post('/api/cockpit/pr/fp1/aprovar').send({});
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ estado: 'gerando' });
    expect(cur.gerar).toHaveBeenCalledWith('fp1', { instrucao: 'faça X', paths: ['pom.xml'] });
    await app.close();
  });

  it('POST aprovar sem remediação que casa → 409', async () => {
    const cur = curadoriaOn();
    cur.aplicaveis.mockResolvedValueOnce({ aplicaveis: [], total: 0 });
    const app = await montar({ diagnosticar: async () => ({}) }, cur);
    const r = await request(app.getHttpServer()).post('/api/cockpit/pr/fp1/aprovar').send({});
    expect(r.status).toBe(409);
    await app.close();
  });

  it('POST aprovar com curadoria off → 503', async () => {
    const app = await montar({ diagnosticar: async () => ({}) }, curadoriaOn({ enabled: false }));
    const r = await request(app.getHttpServer()).post('/api/cockpit/pr/fp1/aprovar').send({});
    expect(r.status).toBe(503);
    await app.close();
  });

  it('GET estado → repassa estado/pr_url da proposta', async () => {
    const cur = curadoriaOn();
    cur.obter.mockResolvedValueOnce({ estado: 'pr_aberto', pr_numero: 9, pr_url: 'http://gh/pr/9' });
    const app = await montar({ diagnosticar: async () => ({}) }, cur);
    const r = await request(app.getHttpServer()).get('/api/cockpit/pr/fp1/estado');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ estado: 'pr_aberto', pr_numero: 9, pr_url: 'http://gh/pr/9', motivo: null });
    await app.close();
  });

  it('GET estado com proposta ausente (404) → {estado:"ausente"}', async () => {
    const { UpstreamError } = await import('../src/common/upstream-error');
    const cur = curadoriaOn();
    cur.obter.mockRejectedValueOnce(new UpstreamError(404, 'proposta não encontrada'));
    const app = await montar({ diagnosticar: async () => ({}) }, cur);
    const r = await request(app.getHttpServer()).get('/api/cockpit/pr/fp1/estado');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ estado: 'ausente' });
    await app.close();
  });

  it('POST rejeitar → {estado:"rejeitado"} e chama rejeitar', async () => {
    const cur = curadoriaOn();
    cur.rejeitar.mockResolvedValueOnce(undefined);
    const app = await montar({ diagnosticar: async () => ({}) }, cur);
    const r = await request(app.getHttpServer()).post('/api/cockpit/pr/fp1/rejeitar').send({});
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ estado: 'rejeitado' });
    expect(cur.rejeitar).toHaveBeenCalledWith('fp1');
    await app.close();
  });
});

describe('orquestrarAbertura', () => {
  it('proposta pronta → chama aprovar uma vez', async () => {
    const cur = curadoriaOn();
    cur.obter.mockResolvedValueOnce({ estado: 'pronta' });
    cur.aprovar.mockResolvedValueOnce({ estado: 'pr_aberto', pr_url: 'http://gh/pr/1' });
    const ctrl = new (await import('../src/api/cockpit-headless.controller')).CockpitHeadlessController({} as any, cur as any);
    await ctrl.orquestrarAbertura('fp1', 0);
    expect(cur.aprovar).toHaveBeenCalledWith('fp1', {});
  });

  it('gerando depois pronta → aprova na 2ª volta', async () => {
    const cur = curadoriaOn();
    cur.obter.mockResolvedValueOnce({ estado: 'gerando' }).mockResolvedValueOnce({ estado: 'pronta' });
    cur.aprovar.mockResolvedValueOnce({ estado: 'pr_aberto' });
    const ctrl = new (await import('../src/api/cockpit-headless.controller')).CockpitHeadlessController({} as any, cur as any);
    await ctrl.orquestrarAbertura('fp1', 0);
    expect(cur.obter).toHaveBeenCalledTimes(2);
    expect(cur.aprovar).toHaveBeenCalledTimes(1);
  });

  it('nao_aplicavel → não aprova', async () => {
    const cur = curadoriaOn();
    cur.obter.mockResolvedValueOnce({ estado: 'nao_aplicavel' });
    const ctrl = new (await import('../src/api/cockpit-headless.controller')).CockpitHeadlessController({} as any, cur as any);
    await ctrl.orquestrarAbertura('fp1', 0);
    expect(cur.aprovar).not.toHaveBeenCalled();
  });

  it('erro_geracao → não aprova (branch terminal de erro)', async () => {
    const cur = curadoriaOn();
    cur.obter.mockResolvedValueOnce({ estado: 'erro_geracao' });
    const ctrl = new (await import('../src/api/cockpit-headless.controller')).CockpitHeadlessController({} as any, cur as any);
    await ctrl.orquestrarAbertura('fp1', 0);
    expect(cur.aprovar).not.toHaveBeenCalled();
  });
});
