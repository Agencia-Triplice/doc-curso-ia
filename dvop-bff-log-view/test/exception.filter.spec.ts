import { Test } from '@nestjs/testing';
import { INestApplication, Controller, Get, ValidationPipe, Body, Post, HttpException } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { DetailExceptionFilter } from '../src/common/exception.filter';
import { UpstreamError } from '../src/common/upstream-error';
import { BodyLimitError } from '../src/common/body-limit.middleware';

class Dto { @IsString() @MinLength(1) message!: string; }
@Controller('t')
class T {
  @Get('up') up() { throw new UpstreamError(504, 'timeout ao consultar x'); }
  @Get('boom') boom() { throw new Error('surpresa'); }
  @Get('detail') det() { throw new HttpException({ detail: 'coisa específica' }, 422); }
  @Get('limite') limite() { throw new BodyLimitError(); }
  @Post('v') v(@Body() _d: Dto) { return { ok: 1 }; }
}

describe('DetailExceptionFilter', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [T] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new DetailExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('UpstreamError → status + {detail}', async () => {
    const r = await request(app.getHttpServer()).get('/t/up');
    expect(r.status).toBe(504); expect(r.body).toEqual({ detail: 'timeout ao consultar x' });
  });
  it('erro não tratado → 500 {detail}', async () => {
    const r = await request(app.getHttpServer()).get('/t/boom');
    expect(r.status).toBe(500); expect(r.body).toEqual({ detail: 'internal server error' });
  });
  it('HttpException com corpo {detail} → o filtro honra o detail (não "Http Exception")', async () => {
    const r = await request(app.getHttpServer()).get('/t/detail');
    expect(r.status).toBe(422); expect(r.body).toEqual({ detail: 'coisa específica' });
  });
  it('validação → 422 {detail}', async () => {
    const r = await request(app.getHttpServer()).post('/t/v').send({ message: '' });
    expect(r.status).toBe(422); expect(typeof r.body.detail).toBe('string');
  });
  it('BodyLimitError lançado dentro do pipeline do Nest → 413 {detail}', async () => {
    const r = await request(app.getHttpServer()).get('/t/limite');
    expect(r.status).toBe(413); expect(r.body).toEqual({ detail: 'corpo da requisição excede o limite' });
  });
});
