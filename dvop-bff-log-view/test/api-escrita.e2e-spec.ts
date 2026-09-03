import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { FilaController } from '../src/api/fila.controller';
import { CacheBaseController } from '../src/api/cache-base.controller';
import { ImportarController } from '../src/api/importar.controller';
import { RequestsController } from '../src/api/requests.controller';
import { ReviewService } from '../src/upstreams/review.service';
import { CacheService } from '../src/upstreams/cache.service';
import { RetrievalService } from '../src/upstreams/retrieval.service';
import { McpGithubService } from '../src/upstreams/mcp-github.service';
import { RequestAuditService } from '../src/audit/request-audit.service';
import { DetailExceptionFilter } from '../src/common/exception.filter';

describe('API escrita (e2e) — recursos habilitados', () => {
  let app: INestApplication;

  const review = {
    enabled: true,
    listarFila: jest.fn(async () => ({ itens: [{ fp: 'fp1' }] })),
    aprovar: jest.fn(async (fp: string, solucao: string | null, autor: string | null, publicarBase: boolean) => ({ ok: true, fp, solucao, autor, publicarBase })),
    descartar: jest.fn(async () => undefined),
  };
  const cache = {
    enabled: true,
    listarSolucoes: jest.fn(async (limit: number) => [{ id: 1, limit }]),
  };
  const retrieval = {
    enabled: true,
    listarBase: jest.fn(async (limit: number, offset: number, q?: string) => ({ documentos: [], limit, offset, q: q ?? null })),
    excluirBase: jest.fn(async () => undefined),
  };
  const mcpgh = {
    enabled: true,
    importar: jest.fn(async (url: string, githubToken?: string | null) => ({ importado: true, url, githubToken: githubToken ?? null })),
  };
  const audit = {
    summary: jest.fn(() => ({ total_requests: 3, unique_requests: 2 })),
    listEntries: jest.fn((limit: number) => [{ hash: 'ok', limit }]),
    get: jest.fn((d: string) => (d === 'ok' ? { hash: 'ok' } : null)),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [FilaController, CacheBaseController, ImportarController, RequestsController],
      providers: [
        { provide: ReviewService, useValue: review },
        { provide: CacheService, useValue: cache },
        { provide: RetrievalService, useValue: retrieval },
        { provide: McpGithubService, useValue: mcpgh },
        { provide: RequestAuditService, useValue: audit },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  afterEach(() => { jest.clearAllMocks(); });

  // ---- fila ----
  it('GET /api/fila → 200', async () => {
    const r = await request(app.getHttpServer()).get('/api/fila');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ itens: [{ fp: 'fp1' }] });
  });

  it('POST /api/fila/:fp/aprovar → 201 com solucao/autor definidos', async () => {
    const r = await request(app.getHttpServer()).post('/api/fila/fp1/aprovar').send({ solucao: 'S', autor: 'A', publicar_base: false });
    expect(r.status).toBe(201);
    expect(review.aprovar).toHaveBeenCalledWith('fp1', 'S', 'A', false);
  });

  it('POST /api/fila/:fp/aprovar → 201 sem solucao/autor (defaults null/true)', async () => {
    const r = await request(app.getHttpServer()).post('/api/fila/fp1/aprovar').send({});
    expect(r.status).toBe(201);
    expect(review.aprovar).toHaveBeenCalledWith('fp1', null, null, true);
  });

  it('POST /api/fila/:fp/descartar → 204', async () => {
    const r = await request(app.getHttpServer()).post('/api/fila/fp1/descartar').send();
    expect(r.status).toBe(204);
    expect(review.descartar).toHaveBeenCalledWith('fp1');
  });

  // ---- cache/base ----
  it('GET /api/solucoes → 200', async () => {
    const r = await request(app.getHttpServer()).get('/api/solucoes');
    expect(r.status).toBe(200);
    expect(r.body.solucoes).toEqual([{ id: 1, limit: 100 }]);
  });

  it('GET /api/base → 200, com q', async () => {
    const r = await request(app.getHttpServer()).get('/api/base?q=texto');
    expect(r.status).toBe(200);
    expect(retrieval.listarBase).toHaveBeenCalledWith(50, 0, 'texto');
  });

  it('GET /api/base → 200, sem q', async () => {
    const r = await request(app.getHttpServer()).get('/api/base');
    expect(r.status).toBe(200);
    expect(retrieval.listarBase).toHaveBeenCalledWith(50, 0, undefined);
  });

  it('DELETE /api/base/:id → 204', async () => {
    const r = await request(app.getHttpServer()).delete('/api/base/5');
    expect(r.status).toBe(204);
    expect(retrieval.excluirBase).toHaveBeenCalledWith(5);
  });

  // ---- importar ----
  it('POST /api/importar → 200 (não 201) e repassa o header X-GitHub-Token', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/importar')
      .set('X-GitHub-Token', 'tok-secreto-123')
      .send({ url: 'https://github.com/org/repo' });
    expect(r.status).toBe(200);
    expect(mcpgh.importar).toHaveBeenCalledWith('https://github.com/org/repo', 'tok-secreto-123');
  });

  it('POST /api/importar → sem header X-GitHub-Token → githubToken undefined', async () => {
    const r = await request(app.getHttpServer()).post('/api/importar').send({ url: 'https://github.com/org/repo' });
    expect(r.status).toBe(200);
    expect(mcpgh.importar).toHaveBeenCalledWith('https://github.com/org/repo', undefined);
  });

  // ---- requests ----
  it('GET /api/requests → 200 com summary + items', async () => {
    const r = await request(app.getHttpServer()).get('/api/requests');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ total_requests: 3, unique_requests: 2, items: [{ hash: 'ok', limit: 50 }] });
  });

  it('GET /api/requests/:digest → encontrado retorna a linha', async () => {
    const r = await request(app.getHttpServer()).get('/api/requests/ok');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ hash: 'ok' });
  });

  it('GET /api/requests/:digest → não encontrado → 404 com aspas simples', async () => {
    const r = await request(app.getHttpServer()).get('/api/requests/naoexiste');
    expect(r.status).toBe(404);
    expect(r.body.detail).toBe("hash 'naoexiste' não encontrado");
  });

  // ---- validação DTO (422) ----
  it('POST /api/fila/:fp/aprovar → solucao vazia → 422', async () => {
    const r = await request(app.getHttpServer()).post('/api/fila/fp1/aprovar').send({ solucao: '' });
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('POST /api/fila/:fp/aprovar → solucao > 20000 chars → 422', async () => {
    const r = await request(app.getHttpServer()).post('/api/fila/fp1/aprovar').send({ solucao: 'a'.repeat(20001) });
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('POST /api/importar → url ausente → 422', async () => {
    const r = await request(app.getHttpServer()).post('/api/importar').send({});
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('POST /api/importar → url vazia → 422', async () => {
    const r = await request(app.getHttpServer()).post('/api/importar').send({ url: '' });
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  // ---- bounds de query (paridade FastAPI) ----
  it('GET /api/solucoes?limit=0 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/api/solucoes?limit=0');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/solucoes?limit=501 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/api/solucoes?limit=501');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/solucoes?limit=500 → 200 (borda superior válida)', async () => {
    const r = await request(app.getHttpServer()).get('/api/solucoes?limit=500');
    expect(r.status).toBe(200);
    expect(cache.listarSolucoes).toHaveBeenCalledWith(500);
  });

  it('GET /api/base?limit=0 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/api/base?limit=0');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/base?limit=201 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/api/base?limit=201');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/base?offset=-1 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/api/base?offset=-1');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/base?q=<513 chars> → 422', async () => {
    const r = await request(app.getHttpServer()).get(`/api/base?q=${'a'.repeat(513)}`);
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/base?limit=200&offset=0 → 200 (borda superior válida)', async () => {
    const r = await request(app.getHttpServer()).get('/api/base?limit=200&offset=0');
    expect(r.status).toBe(200);
    expect(retrieval.listarBase).toHaveBeenCalledWith(200, 0, undefined);
  });

  it('GET /api/requests?limit=0 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/api/requests?limit=0');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });

  it('GET /api/requests?limit=501 → 422', async () => {
    const r = await request(app.getHttpServer()).get('/api/requests?limit=501');
    expect(r.status).toBe(422);
    expect(r.body).toHaveProperty('detail');
  });
});

describe('API escrita (e2e) — recursos desabilitados (503)', () => {
  let app: INestApplication;

  const OFF_FILA = 'fila indisponível: configure LOG_BFF_REVIEW_URL';
  const OFF_CACHE = 'cache indisponível: configure LOG_BFF_CACHE_URL';
  const OFF_BASE = 'base indisponível: configure LOG_BFF_RETRIEVAL_URL';
  const OFF_IMPORTAR = 'importação indisponível: configure LOG_BFF_MCPGH_URL';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [FilaController, CacheBaseController, ImportarController, RequestsController],
      providers: [
        { provide: ReviewService, useValue: { enabled: false, listarFila: jest.fn(), aprovar: jest.fn(), descartar: jest.fn() } },
        { provide: CacheService, useValue: { enabled: false, listarSolucoes: jest.fn() } },
        { provide: RetrievalService, useValue: { enabled: false, listarBase: jest.fn(), excluirBase: jest.fn() } },
        { provide: McpGithubService, useValue: { enabled: false, importar: jest.fn() } },
        { provide: RequestAuditService, useValue: { summary: () => ({ total_requests: 0, unique_requests: 0 }), listEntries: () => [], get: () => null } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('GET /api/fila → 503', async () => {
    const r = await request(app.getHttpServer()).get('/api/fila');
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe(OFF_FILA);
  });

  it('POST /api/fila/:fp/aprovar → 503', async () => {
    const r = await request(app.getHttpServer()).post('/api/fila/fp1/aprovar').send({ solucao: 'S' });
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe(OFF_FILA);
  });

  it('POST /api/fila/:fp/descartar → 503', async () => {
    const r = await request(app.getHttpServer()).post('/api/fila/fp1/descartar').send();
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe(OFF_FILA);
  });

  it('GET /api/solucoes → 503', async () => {
    const r = await request(app.getHttpServer()).get('/api/solucoes');
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe(OFF_CACHE);
  });

  it('GET /api/base → 503', async () => {
    const r = await request(app.getHttpServer()).get('/api/base');
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe(OFF_BASE);
  });

  it('DELETE /api/base/:id → 503', async () => {
    const r = await request(app.getHttpServer()).delete('/api/base/5');
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe(OFF_BASE);
  });

  it('POST /api/importar → 503', async () => {
    const r = await request(app.getHttpServer()).post('/api/importar').send({ url: 'https://github.com/org/repo' });
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe(OFF_IMPORTAR);
  });
});
