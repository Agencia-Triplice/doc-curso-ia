import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export class BodyLimitError extends Error {
  readonly statusCode = 413;
  constructor() { super('corpo da requisição excede o limite'); this.name = 'BodyLimitError'; }
}

@Injectable()
export class BodyLimitMiddleware implements NestMiddleware {
  constructor(private readonly maxBytes: number) {}
  use(req: Request, _res: Response, next: NextFunction): void {
    const cl = req.headers['content-length'];
    if (cl && /^\d+$/.test(cl) && Number(cl) > this.maxBytes) { next(new BodyLimitError()); return; }
    let recebido = 0;
    req.on('data', (chunk: Buffer) => {
      recebido += chunk.length;
      if (recebido > this.maxBytes) req.destroy(new BodyLimitError());
    });
    next();
  }
}
