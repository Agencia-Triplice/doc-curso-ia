import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RemediacaoController } from '../src/api/remediacao.controller';
import { RemediationPrService } from '../src/upstreams/remediation-pr.service';
import { CuradoriaPropostaService } from '../src/upstreams/curadoria-proposta.service';
import { UpstreamError } from '../src/common/upstream-error';
import { DetailExceptionFilter } from '../src/common/exception.filter';

const PR = {
  fingerprint: 'fp-1', repo: 'org/app', branch: 'agentix-pr-fp-1',
  pr_numero: 7, pr_url: 'http://gh/pr/7', estado: 'aberto',
  criado_em: '2026-07-16T09:00:00Z', resolvido_em: null,
};

async function montar(prService: any, curadoria: any): Promise<INestApplication> {
  const mod = await Test.createTestingModule({
    controllers: [RemediacaoController],
    providers: [
      { provide: RemediationPrService, useValue: prService },
      { provide: CuradoriaPropostaService, useValue: curadoria },
    ],
  }).compile();
  const app = mod.createNestApplication();
  app.useGlobalFilters(new DetailExceptionFilter());
  await app.init();
  return app;
}

const curadoriaOn = (over: any = {}) => ({ enabled: true, aplicaveis: jest.fn(), gerar: jest.fn(), obter: jest.fn(), aprovar: jest.fn(), ...over });

describe('GET /api/remediacao/pr/:fingerprint (e2e)', () => {
  it('200 {pr} quando o executor já abriu o PR', async () => {
    const app = await montar({ prPorFingerprint: async () => PR }, curadoriaOn());
    const r = await request(app.getHttpServer()).get('/api/remediacao/pr/fp-1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ pr: PR });
    await app.close();
  });

  it('200 {pr:null} quando ainda não há PR / upstream desabilitado', async () => {
    const app = await montar({ prPorFingerprint: async () => null }, curadoriaOn());
    const r = await request(app.getHttpServer()).get('/api/remediacao/pr/fp-x');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ pr: null });
    await app.close();
  });
});

describe('abrir PR de remediação headless (e2e)', () => {
  const prService = { prPorFingerprint: async () => null };

  it('GET /aplicaveis → disponivel:false quando a curadoria está off', async () => {
    const app = await montar(prService, curadoriaOn({ enabled: false }));
    const r = await request(app.getHttpServer()).get('/api/remediacao/aplicaveis/fp-1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ disponivel: false, aplicaveis: [], total: 0 });
    await app.close();
  });

  it('GET /aplicaveis → repassa as remediações que casam', async () => {
    const cur = curadoriaOn();
    cur.aplicaveis.mockResolvedValueOnce({ aplicaveis: [{ id: 'r1', instrucao: 'faça X' }], total: 1 });
    const app = await montar(prService, cur);
    const r = await request(app.getHttpServer()).get('/api/remediacao/aplicaveis/fp-1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ disponivel: true, aplicaveis: [{ id: 'r1', instrucao: 'faça X' }], total: 1 });
    await app.close();
  });

  it('GET /aplicaveis → 404 da curadoria (caso desconhecido) vira lista vazia', async () => {
    const cur = curadoriaOn();
    cur.aplicaveis.mockRejectedValueOnce(new UpstreamError(404, 'desconhecido'));
    const app = await montar(prService, cur);
    const r = await request(app.getHttpServer()).get('/api/remediacao/aplicaveis/fp-1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ disponivel: true, aplicaveis: [], total: 0 });
    await app.close();
  });

  it('POST /proposta → 503 quando a curadoria está off', async () => {
    const app = await montar(prService, curadoriaOn({ enabled: false }));
    const r = await request(app.getHttpServer()).post('/api/remediacao/proposta/fp-1').send({ instrucao: 'x' });
    expect(r.status).toBe(503);
    await app.close();
  });

  it('POST /proposta → dispara a geração com instrucao e paths', async () => {
    const cur = curadoriaOn();
    cur.gerar.mockResolvedValueOnce({ estado: 'gerando' });
    const app = await montar(prService, cur);
    const r = await request(app.getHttpServer()).post('/api/remediacao/proposta/fp-1').send({ instrucao: 'faça X', paths: ['pom.xml'] });
    expect(r.status).toBe(200);
    expect(cur.gerar).toHaveBeenCalledWith('fp-1', { instrucao: 'faça X', paths: ['pom.xml'] });
    await app.close();
  });

  it('GET /proposta → repassa o estado da proposta', async () => {
    const cur = curadoriaOn();
    cur.obter.mockResolvedValueOnce({ estado: 'pronta', n_arquivos: 1 });
    const app = await montar(prService, cur);
    const r = await request(app.getHttpServer()).get('/api/remediacao/proposta/fp-1');
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('pronta');
    await app.close();
  });

  it('POST /proposta/aprovar → abre o PR e devolve pr_url', async () => {
    const cur = curadoriaOn();
    cur.aprovar.mockResolvedValueOnce({ estado: 'pr_aberto', pr_numero: 9, pr_url: 'http://gh/pr/9' });
    const app = await montar(prService, cur);
    const r = await request(app.getHttpServer()).post('/api/remediacao/proposta/fp-1/aprovar').send({});
    expect(r.status).toBe(200);
    expect(cur.aprovar).toHaveBeenCalledWith('fp-1', { base: undefined });
    expect(r.body.pr_url).toBe('http://gh/pr/9');
    await app.close();
  });

  it('POST /proposta/aprovar → propaga 409 do executor (motivo em detail)', async () => {
    const cur = curadoriaOn();
    cur.aprovar.mockRejectedValueOnce(new UpstreamError(409, 'credencial_ausente'));
    const app = await montar(prService, cur);
    const r = await request(app.getHttpServer()).post('/api/remediacao/proposta/fp-1/aprovar').send({});
    expect(r.status).toBe(409);
    expect(r.body.detail).toBe('credencial_ausente');
    await app.close();
  });
});
