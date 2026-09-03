import { EventEmitter } from 'events';
import { BodyLimitError, BodyLimitMiddleware } from '../src/common/body-limit.middleware';

function fakeReq(headers: Record<string, string> = {}): any {
  const req: any = new EventEmitter();
  req.headers = headers;
  req.destroy = jest.fn();
  return req;
}

describe('BodyLimitError', () => {
  it('tem statusCode 413 e mensagem em pt-BR', () => {
    const e = new BodyLimitError();
    expect(e.statusCode).toBe(413);
    expect(e.message).toBe('corpo da requisição excede o limite');
    expect(e.name).toBe('BodyLimitError');
  });
});

describe('BodyLimitMiddleware', () => {
  it('content-length acima do limite → next(BodyLimitError) imediatamente', () => {
    const mw = new BodyLimitMiddleware(100);
    const req = fakeReq({ 'content-length': '500' });
    const next = jest.fn();
    mw.use(req, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(BodyLimitError);
  });

  it('content-length não-numérico é ignorado (cai no caminho de streaming, next() chamado)', () => {
    const mw = new BodyLimitMiddleware(100);
    const req = fakeReq({ 'content-length': 'abc' });
    const next = jest.fn();
    mw.use(req, {} as any, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('sem content-length, stream excede o limite → req.destroy(BodyLimitError)', () => {
    const mw = new BodyLimitMiddleware(10);
    const req = fakeReq();
    const next = jest.fn();
    mw.use(req, {} as any, next);
    expect(next).toHaveBeenCalledWith();
    req.emit('data', Buffer.from('012345678901234567890')); // 21 bytes > 10
    expect(req.destroy).toHaveBeenCalledTimes(1);
    expect(req.destroy.mock.calls[0][0]).toBeInstanceOf(BodyLimitError);
  });

  it('corpo dentro do limite (mesmo em vários chunks) → next() sem erro e sem destroy', () => {
    const mw = new BodyLimitMiddleware(100);
    const req = fakeReq();
    const next = jest.fn();
    mw.use(req, {} as any, next);
    req.emit('data', Buffer.from('curto'));
    req.emit('data', Buffer.from('mais um pedaço'));
    expect(next).toHaveBeenCalledWith();
    expect(req.destroy).not.toHaveBeenCalled();
  });
});
