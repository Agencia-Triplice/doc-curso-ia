import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/main';
import { loadConfig } from '../src/config/env';

// NOTA: createApp(cfg) só usa o parâmetro `cfg` para o limite de corpo — o
// APP_CONFIG real do AppModule vem do seu próprio `useFactory: () =>
// loadConfig()`, que lê process.env diretamente (não o objeto passado aqui).
// Por isso, como em test/app.e2e-spec.ts, a env precisa ser setada em
// process.env ANTES de chamar loadConfig()/createApp() para valer para o app
// inteiro (inclusive AuthGuard/SessionService).
describe('fiação de auth no app real (e2e)', () => {
  let app: INestApplication;
  const prevMs5 = process.env.CURADORIA_BFF_MS5_URL;
  const prevSecret = process.env.CURADORIA_BFF_SESSION_SECRET;
  const prevDevUser = process.env.CURADORIA_BFF_AUTH_DEV_USER;

  afterEach(async () => {
    if (app) await app.close();
    if (prevMs5 === undefined) delete process.env.CURADORIA_BFF_MS5_URL; else process.env.CURADORIA_BFF_MS5_URL = prevMs5;
    if (prevSecret === undefined) delete process.env.CURADORIA_BFF_SESSION_SECRET; else process.env.CURADORIA_BFF_SESSION_SECRET = prevSecret;
    if (prevDevUser === undefined) delete process.env.CURADORIA_BFF_AUTH_DEV_USER; else process.env.CURADORIA_BFF_AUTH_DEV_USER = prevDevUser;
  });

  it('sem dev-user nem cookie: /v1/info → 401, /v1/me → 401, /health/live → 200', async () => {
    process.env.CURADORIA_BFF_MS5_URL = 'http://ms5';
    process.env.CURADORIA_BFF_SESSION_SECRET = 's';
    delete process.env.CURADORIA_BFF_AUTH_DEV_USER;
    app = await createApp(loadConfig());
    await app.init();
    expect((await request(app.getHttpServer()).get('/v1/info')).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/v1/me')).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/health/live')).status).toBe(200);
  });

  it('com dev-user: /v1/me → 200 e /v1/info não é mais 401', async () => {
    process.env.CURADORIA_BFF_MS5_URL = 'http://ms5';
    process.env.CURADORIA_BFF_SESSION_SECRET = 's';
    process.env.CURADORIA_BFF_AUTH_DEV_USER = 'dev1';
    app = await createApp(loadConfig());
    await app.init();
    expect((await request(app.getHttpServer()).get('/v1/me')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/v1/info')).status).not.toBe(401);
  });
});
