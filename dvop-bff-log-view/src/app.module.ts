import { Inject, MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { APP_CONFIG, AppConfig, loadConfig } from './config/env';
import { MetricsService } from './metrics/metrics.service';
import { MetricsController } from './metrics/metrics.controller';
import { AccessLogInterceptor } from './common/access-log.interceptor';
import { DetailExceptionFilter } from './common/exception.filter';
import { BodyLimitMiddleware } from './common/body-limit.middleware';
import { RequestAuditService } from './audit/request-audit.service';
import { SrvLogService } from './upstreams/srv-log.service';
import { CacheService } from './upstreams/cache.service';
import { RetrievalService } from './upstreams/retrieval.service';
import { ReviewService } from './upstreams/review.service';
import { McpGithubService } from './upstreams/mcp-github.service';
import { RemediationPrService } from './upstreams/remediation-pr.service';
import { CuradoriaPropostaService } from './upstreams/curadoria-proposta.service';
import { AgentixService, AGENTIX_TOKEN_PROVIDER } from './agentix/agentix.service';
import { AgentixTokenProvider } from './agentix/agentix-token.provider';
import { AgenteCuradorService } from './agente-curador/agente-curador.service';
import { DiagnosticoService } from './diagnostico/diagnostico.service';
import { TriagemService } from './agentix/triagem.service';
import { DiagnosticoMistoService } from './diagnostico/diagnostico-misto.service';
import { DiagnosticoMistoController } from './api/diagnostico-misto.controller';
import { RemediacaoController } from './api/remediacao.controller';
import { HealthController } from './api/health.controller';
import { ConfigController } from './api/config.controller';
import { EstadoController } from './api/estado.controller';
import { LogsController } from './api/logs.controller';
import { DiagnosticoController } from './api/diagnostico.controller';
import { AgenteController } from './api/agente.controller';
import { RequestsController } from './api/requests.controller';
import { FilaController } from './api/fila.controller';
import { CacheBaseController } from './api/cache-base.controller';
import { ImportarController } from './api/importar.controller';
import { CockpitHeadlessController } from './api/cockpit-headless.controller';

const CONFIG = { provide: APP_CONFIG, useFactory: () => loadConfig() };

@Module({
  imports: [
    // sintaxe de rota do express 5 / path-to-regexp 8 (Nest 11): o curinga tem
    // de ser nomeado — '/api/(.*)' vira '/api/{*path}'.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'static'),
      serveRoot: '/',
      exclude: ['/api/{*path}', '/health/{*path}', '/metrics'],
    }),
  ],
  controllers: [
    HealthController, MetricsController, ConfigController, EstadoController, LogsController,
    DiagnosticoController, DiagnosticoMistoController, AgenteController, RequestsController, FilaController,
    CacheBaseController, ImportarController, RemediacaoController, CockpitHeadlessController,
  ],
  providers: [
    CONFIG, MetricsService, SrvLogService, CacheService, RetrievalService, ReviewService, McpGithubService, RemediationPrService, CuradoriaPropostaService, AgentixService, AgenteCuradorService, DiagnosticoService, TriagemService, DiagnosticoMistoService,
    { provide: AGENTIX_TOKEN_PROVIDER, inject: [APP_CONFIG], useFactory: (c: AppConfig) => new AgentixTokenProvider({ loginUrl: c.agentixUrl + '/auth/login', username: c.agentixUsername, password: c.agentixPassword, timeoutMs: c.requestTimeout * 1000 }) },
    { provide: RequestAuditService, inject: [APP_CONFIG], useFactory: (c: AppConfig) => new RequestAuditService(c.dbPath, c.auditMaxRows) },
    { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
    { provide: APP_FILTER, useClass: DetailExceptionFilter },
    { provide: APP_PIPE, useFactory: () => new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }) },
  ],
})
export class AppModule implements NestModule {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}
  configure(consumer: MiddlewareConsumer): void {
    const max = this.cfg.maxBodyBytes;
    consumer.apply((req: any, res: any, next: any) => new BodyLimitMiddleware(max).use(req, res, next)).forRoutes('{*path}');
  }
}
