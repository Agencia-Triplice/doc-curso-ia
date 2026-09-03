import { Inject, MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { APP_CONFIG, CuradoriaConfig, loadConfig } from './config/env';
import { MetricsService } from './metrics/metrics.service';
import { MetricsController } from './metrics/metrics.controller';
import { AccessLogInterceptor } from './common/access-log.interceptor';
import { DetailExceptionFilter } from './common/exception.filter';
import { BodyLimitMiddleware } from './common/body-limit.middleware';
import { CacheWriterService } from './upstreams/cache-writer.service';
import { RetrievalService } from './upstreams/retrieval.service';
import { RemediationService } from './upstreams/remediation.service';
import { McpGithubService } from './upstreams/mcp-github.service';
import { AgentixService, AGENTIX_TOKEN_PROVIDER } from './agentix/agentix.service';
import { AgentixTokenProvider } from './agentix/agentix-token.provider';
import { CuradorWorker } from './curador/curador.worker';
import { PromptStore } from './curador/prompt-store.service';
import { PropostaWorker } from './propostas/proposta.worker';
import { PropostaStore } from './propostas/proposta-store.service';
import { EligibilityStore } from './eligibility/eligibility-store.service';
import { HealthController } from './api/health.controller';
import { ReviewController } from './api/review.controller';
import { CacheRecordsController } from './api/cache-records.controller';
import { BaseRecordsController } from './api/base-records.controller';
import { EligibilityController } from './api/eligibility.controller';
import { EligibilityReadController } from './api/eligibility-read.controller';
import { PropostasController } from './api/propostas.controller';
import { RemediacoesEscritaController } from './api/remediacoes-escrita.controller';
import { CredencialController } from './api/credencial.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { SessionService } from './auth/session.service';
import { GithubOAuthService } from './auth/github-oauth.service';

const CONFIG = { provide: APP_CONFIG, useFactory: () => loadConfig() };

@Module({
  imports: [
    // frontend estático da fila, servido same-origin pelo próprio serviço.
    // exclude usa /v1/ (não /api/): as rotas de API têm precedência.
    // Curinga na sintaxe do express 5 / path-to-regexp 8 (Nest 11): nomeado.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'static'),
      serveRoot: '/',
      exclude: ['/v1/{*path}', '/health/{*path}', '/metrics', '/auth/{*path}'],
    }),
  ],
  controllers: [HealthController, MetricsController, ReviewController, CacheRecordsController, BaseRecordsController, EligibilityController, EligibilityReadController, PropostasController, RemediacoesEscritaController, CredencialController, AuthController],
  providers: [
    CONFIG,
    MetricsService,
    CacheWriterService,
    RetrievalService,
    RemediationService,
    McpGithubService,
    AgentixService,
    CuradorWorker,
    PropostaWorker,
    { provide: AGENTIX_TOKEN_PROVIDER, inject: [APP_CONFIG], useFactory: (c: CuradoriaConfig) => new AgentixTokenProvider({ loginUrl: c.agentixUrl + '/auth/login', username: c.agentixUsername, password: c.agentixPassword, timeoutMs: c.requestTimeout * 1000 }) },
    { provide: EligibilityStore, inject: [APP_CONFIG], useFactory: (c: CuradoriaConfig) => new EligibilityStore(c.dbPath) },
    { provide: PromptStore, inject: [APP_CONFIG], useFactory: (c: CuradoriaConfig) => new PromptStore(c.promptDbPath) },
    { provide: PropostaStore, inject: [APP_CONFIG], useFactory: (c: CuradoriaConfig) => new PropostaStore(c.propostaDbPath) },
    { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
    { provide: APP_FILTER, useClass: DetailExceptionFilter },
    { provide: APP_PIPE, useFactory: () => new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }) },
    AuthGuard,
    { provide: SessionService, inject: [APP_CONFIG], useFactory: (c: CuradoriaConfig) => new SessionService(c) },
    { provide: GithubOAuthService, inject: [APP_CONFIG], useFactory: (c: CuradoriaConfig) => new GithubOAuthService(c) },
  ],
})
export class AppModule implements NestModule {
  constructor(@Inject(APP_CONFIG) private readonly cfg: CuradoriaConfig) {}
  configure(consumer: MiddlewareConsumer): void {
    // limite por dentro, access-log por fora (via interceptor): o 413 do limite
    // aparece no RED e ganha X-Request-ID.
    const max = this.cfg.maxBodyBytes;
    consumer.apply((req: any, res: any, next: any) => new BodyLimitMiddleware(max).use(req, res, next)).forRoutes('{*path}');
  }
}
