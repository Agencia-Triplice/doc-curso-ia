import { createHmac } from 'crypto';
import { loadConfig } from '../src/config/env';
import { SessionService, parseCookies, NOME_COOKIE } from '../src/auth/session.service';

const cfg = (over: Record<string, string> = {}) =>
  loadConfig({ CURADORIA_BFF_MS5_URL: 'http://ms5', CURADORIA_BFF_SESSION_SECRET: 's3gr3d0', ...over } as any);

describe('parseCookies', () => {
  it('quebra o header em pares', () => {
    expect(parseCookies('a=1; curadoria_sess=xyz; b=2')[NOME_COOKIE]).toBe('xyz');
  });
  it('header ausente → objeto vazio', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
  it('malformed percent-encoding não lança erro', () => {
    const result = parseCookies('curadoria_sess=%');
    expect(result).toBeDefined();
    expect(result[NOME_COOKIE]).toBe('%');
  });
});

describe('SessionService', () => {
  it('emitir → verificar faz round-trip e carrega os campos', () => {
    const s = new SessionService(cfg());
    const tok = s.emitir({ sub: 'tiago', nome: 'Tiago', avatar: null, via: 'name', teams: [] });
    const sess = s.verificar(tok)!;
    expect(sess.sub).toBe('tiago');
    expect(sess.via).toBe('name');
    expect(sess.exp * 1000).toBeGreaterThan(Date.now());
  });

  it('assinatura adulterada → null', () => {
    const s = new SessionService(cfg());
    const tok = s.emitir({ sub: 'x', nome: 'x', avatar: null, via: 'name', teams: [] });
    expect(s.verificar(tok.slice(0, -2) + 'zz')).toBeNull();
  });

  it('segredo diferente → null (não aceita cookie de outra instância)', () => {
    const tok = new SessionService(cfg()).emitir({ sub: 'x', nome: 'x', avatar: null, via: 'name', teams: [] });
    expect(new SessionService(cfg({ CURADORIA_BFF_SESSION_SECRET: 'outro' })).verificar(tok)).toBeNull();
  });

  it('expirado → null', () => {
    const s = new SessionService(cfg({ CURADORIA_BFF_SESSION_TTL_SECONDS: '-1' }));
    const tok = s.emitir({ sub: 'x', nome: 'x', avatar: null, via: 'name', teams: [] });
    expect(s.verificar(tok)).toBeNull();
  });

  it('resolver: dev bypass fora de produção sem cookie', () => {
    const s = new SessionService(cfg({ CURADORIA_BFF_AUTH_DEV_USER: 'dev1' }));
    const sess = s.resolver({ headers: {} })!;
    expect(sess.via).toBe('dev');
    expect(sess.sub).toBe('dev1');
  });

  it('resolver: dev bypass IGNORADO em produção', () => {
    const s = new SessionService(cfg({ NODE_ENV: 'production', CURADORIA_BFF_AUTH_DEV_USER: 'dev1' }));
    expect(s.resolver({ headers: {} })).toBeNull();
  });

  it('resolver: lê a sessão do cookie', () => {
    const s = new SessionService(cfg());
    const tok = s.emitir({ sub: 'u', nome: 'U', avatar: null, via: 'github', teams: ['curadoria'] });
    const sess = s.resolver({ headers: { cookie: `${NOME_COOKIE}=${tok}` } })!;
    expect(sess.teams).toEqual(['curadoria']);
  });

  it('opcoesCookie: secure só em produção', () => {
    expect(new SessionService(cfg()).opcoesCookie().secure).toBe(false);
    expect(new SessionService(cfg({ NODE_ENV: 'production' })).opcoesCookie().secure).toBe(true);
  });

  it('token sem separador → null', () => {
    const s = new SessionService(cfg());
    expect(s.verificar('no-separator-here')).toBeNull();
  });

  it('token com corpo inválido (JSON.parse falha) → null', () => {
    const s = new SessionService(cfg());
    const secret = 's3gr3d0';
    const corpo = Buffer.from('not-json-at-all').toString('base64url');
    const sig = createHmac('sha256', secret).update(corpo).digest('base64url');
    expect(s.verificar(`${corpo}.${sig}`)).toBeNull();
  });
});
