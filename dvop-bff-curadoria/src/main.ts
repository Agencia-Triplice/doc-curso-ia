import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { CuradoriaConfig, loadConfig } from './config/env';
import { logJson } from './common/json-logger';
import { BodyLimitError } from './common/body-limit.middleware';
import { CuradorWorker } from './curador/curador.worker';

/**
 * Monta e inicializa o app Nest com toda a fiação necessária para o contrato
 * HTTP (corpo, 413) ficar idêntico ao original Python. Extraído de `bootstrap()`
 * para que o e2e possa exercitar exatamente este código (em vez de reimplementar
 * a fiação separadamente) — crítico para o caso de 413, cujo comportamento
 * depende de ORDEM de registro de middleware no Express.
 *
 * SEM CORS de propósito (main.py): o front é servido same-origin pelo próprio
 * serviço.
 */
export async function createApp(cfg: CuradoriaConfig = loadConfig()): Promise<INestApplication> {
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

  await app.init();
  return app;
}

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const app = await createApp(cfg);
  // habilita o OnApplicationShutdown do CuradorWorker em SIGTERM/SIGINT (para o
  // loop de curadoria de forma limpa); o e2e para o worker via app.close().
  app.enableShutdownHooks();
  const worker = app.get(CuradorWorker);
  await app.listen(8004);
  logJson('info', 'service started', {
    ms5_url: cfg.ms5Url,
    ms3_url: cfg.ms3Url || null,
    ms8_url: cfg.ms8Url || null,
    curador_habilitado: worker.enabled,
  });
}

// Só dispara automaticamente quando main.ts é o entry point (node dist/main.js).
// Ao ser importado (ex.: pelo e2e, que reusa createApp()) não deve subir servidor.
if (require.main === module) {
  void bootstrap();
}
