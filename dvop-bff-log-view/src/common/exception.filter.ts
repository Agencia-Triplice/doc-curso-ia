import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { UpstreamError } from './upstream-error';
import { BodyLimitError } from './body-limit.middleware';
import { logJson } from './json-logger';

@Catch()
export class DetailExceptionFilter implements ExceptionFilter {
  catch(exc: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();

    if (exc instanceof UpstreamError) {
      logJson('warning', 'upstream error', { status: exc.statusCode, detail: exc.detail });
      res.status(exc.statusCode).json({ detail: exc.detail });
      return;
    }
    if (exc instanceof BodyLimitError) {
      res.status(413).json({ detail: exc.message });
      return;
    }
    if (exc instanceof HttpException) {
      const body = exc.getResponse();
      const detail = typeof body === 'string' ? body
        : typeof (body as any).detail === 'string' ? (body as any).detail
        : Array.isArray((body as any).message) ? (body as any).message.join('; ')
        : String((body as any).message ?? exc.message);
      res.status(exc.getStatus()).json({ detail });
      return;
    }
    logJson('error', 'unhandled exception', { path: req.path });
    const reqId = (req as any).requestId as string | undefined;
    if (reqId) res.setHeader('X-Request-ID', reqId);
    res.status(500).json({ detail: 'internal server error' });
  }
}
