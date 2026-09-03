import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { MetricsService } from '../metrics/metrics.service';
import { rotaLabel, traceIdDoTraceparent } from './route-label';
import { logJson } from './json-logger';

const RUIDO = new Set(['/metrics', '/health/live', '/health/ready']);
const METODOS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'CONNECT', 'OPTIONS', 'TRACE', 'PATCH']);

@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const reqId = (req.headers['x-request-id'] as string) || randomUUID().replace(/-/g, '');
    (req as any).requestId = reqId;
    res.setHeader('X-Request-ID', reqId);
    const start = process.hrtime.bigint();
    this.metrics.emAndamentoInc();
    // registra RED/log na conclusão da RESPOSTA (após o exception filter
    // definir o status final): ler res.statusCode num tap de erro do RxJS
    // pegaria o status ANTES do filtro (200 default), divergindo do Python.
    let registrado = false;
    const registrar = (): void => {
      if (registrado) return;
      registrado = true;
      this.metrics.emAndamentoDec();
      const durSeg = Number(process.hrtime.bigint() - start) / 1e9;
      const metodo = METODOS.has(req.method) ? req.method : 'outro';
      this.metrics.observarHttp(metodo, rotaLabel(req.method, req.path), res.statusCode, durSeg);
      if (!RUIDO.has(req.path)) {
        const traceId = traceIdDoTraceparent(req.headers['traceparent'] as string);
        logJson('info', 'request', {
          request_id: reqId, method: req.method, path: req.path,
          status: res.statusCode, duration_ms: Math.round(durSeg * 1000 * 100) / 100,
          ...(traceId ? { trace_id: traceId } : {}),
        });
      }
    };
    res.on('finish', registrar);
    res.on('close', registrar);
    return next.handle();
  }
}
