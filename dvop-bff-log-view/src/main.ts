import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { AppConfig, loadConfig } from './config/env';
import { logJson } from './common/json-logger';
import { BodyLimitError } from './common/body-limit.middleware';

/**
 * Monta e inicializa o app Nest com toda a fiação necessária para o contrato
 * HTTP (corpo, CORS, 413) ficar idêntico ao original Python. Extraído de
 * `bootstrap()` para que o e2e possa exercitar exatamente este código (em vez
 * de reimplementar a fiação separadamente) — crítico para o caso de 413, cujo
 * comportamento depende de ORDEM de registro de middleware no Express.
 */
export async function createApp(cfg: AppConfig = loadConfig()): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Precisa vir ANTES de app.init(): registerParserMiddleware/registerRouter
  // só rodam dentro de init(), então qualquer app.use() chamado antes deste
  // ponto fica posicionado à frente do router na pilha do Express — condição
  // necessária para que o corpo seja parseado antes de chegar no controller.
  app.use(json({ limit: cfg.maxBodyBytes }));

  // Erro de corpo grande demais chega via `next(err)` a partir do próprio
  // parser `express.json({limit})` (PayloadTooLargeError, type
  // 'entity.too.large') ou do BodyLimitMiddleware PRÉ-router (BodyLimitError).
  // Nenhum dos dois passa pelo pipeline do Nest, então nem o
  // DetailExceptionFilter nem o AccessLogInterceptor rodam para eles — por
  // isso respondemos aqui, direto no adapter Express, com o mesmo contrato
  // {detail} + X-Request-ID do resto da API.
  //
  // ORDEM IMPORTA (verificado empiricamente em test/app.e2e-spec.ts): um
  // error-handler do Express só é alcançado por `next(err)` vindo de um
  // middleware registrado ANTES dele na pilha (Express busca só para frente).
  // Registrar isto DEPOIS de app.init() faz o forward-search a partir do
  // json() parser encontrar primeiro o exception-handler embutido do Nest
  // (registrado dentro de init() -> registerRouterHooks()), que devolve 500
  // genérico porque PayloadTooLargeError não é um dos tipos que o
  // DetailExceptionFilter reconhece. Por isso este `.use()` precisa vir logo
  // após o `json()` e ANTES de app.init().
  const express = app.getHttpAdapter().getInstance();
  express.use((err: any, req: any, res: any, next: any) => {
    const tooLarge = err instanceof BodyLimitError || err?.type === 'entity.too.large' || err?.statusCode === 413 || err?.status === 413;
    if (!tooLarge) return next(err);
    const reqId = (req.headers['x-request-id'] as string) || (req.requestId as string) || randomUUID().replace(/-/g, '');
    if (!res.headersSent) {
      res.setHeader('X-Request-ID', reqId);
      res.status(413).json({ detail: 'corpo da requisição excede o limite' });
    }
  });

  const origins = cfg.corsOrigins.split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length) app.enableCors({ origin: origins, methods: ['GET'], exposedHeaders: ['X-Request-ID', 'X-Srv-Request-Hash'] });

  await app.init();

  if (!cfg.allowedHosts.trim()) logJson('warning', 'LOG_BFF_ALLOWED_HOSTS vazio: qualquer host aceito no src (SSRF em produção)');
  return app;
}

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const app = await createApp(cfg);
  const port = Number(process.env.LOG_BFF_PORT) || 8080;
  await app.listen(port);
  logJson('info', 'service started', { port, default_srv_url: cfg.defaultSrvUrl, db_path: cfg.dbPath });
}

// Só dispara automaticamente quando main.ts é o entry point (node dist/main.js).
// Ao ser importado (ex.: pelo e2e, que reusa createApp()) não deve subir servidor.
if (require.main === module) {
  void bootstrap();
}
