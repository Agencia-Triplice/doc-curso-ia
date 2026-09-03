import { HttpException } from '@nestjs/common';
import { loadConfig } from '../src/config/env';
import { SessionService } from '../src/auth/session.service';
import { AuthGuard } from '../src/auth/auth.guard';

const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;
const cfg = (over: Record<string, string> = {}) =>
  loadConfig({ CURADORIA_BFF_MS5_URL: 'http://ms5', CURADORIA_BFF_SESSION_SECRET: 's', ...over } as any);

describe('AuthGuard', () => {
  it('sem sessão → 401', () => {
    const c = cfg();
    const g = new AuthGuard(new SessionService(c), c);
    try { g.canActivate(ctx({ headers: {} })); fail('deveria lançar'); }
    catch (e) { expect((e as HttpException).getStatus()).toBe(401); }
  });

  it('com sessão e sem gate → passa e anexa req.user', () => {
    const c = cfg({ CURADORIA_BFF_AUTH_DEV_USER: 'dev1' });
    const g = new AuthGuard(new SessionService(c), c);
    const req: any = { headers: {} };
    expect(g.canActivate(ctx(req))).toBe(true);
    expect(req.user.sub).toBe('dev1');
  });

  it('gate ligado + usuário fora dos teams → 403', () => {
    const c = cfg({ CURADORIA_BFF_GITHUB_ALLOWED_TEAMS: 'curadoria' });
    const s = new SessionService(c);
    const tok = s.emitir({ sub: 'u', nome: 'U', avatar: null, via: 'github', teams: ['outra'] });
    const g = new AuthGuard(s, c);
    try { g.canActivate(ctx({ headers: { cookie: `curadoria_sess=${tok}` } })); fail('deveria lançar'); }
    catch (e) { expect((e as HttpException).getStatus()).toBe(403); }
  });

  it('gate ligado + usuário no team → passa', () => {
    const c = cfg({ CURADORIA_BFF_GITHUB_ALLOWED_TEAMS: 'curadoria,plataforma' });
    const s = new SessionService(c);
    const tok = s.emitir({ sub: 'u', nome: 'U', avatar: null, via: 'github', teams: ['plataforma'] });
    const g = new AuthGuard(s, c);
    expect(g.canActivate(ctx({ headers: { cookie: `curadoria_sess=${tok}` } }))).toBe(true);
  });

  it('S2S: token de entrada correto → passa como cockpit, pulando o gate de teams', () => {
    const c = cfg({ CURADORIA_BFF_S2S_TOKEN: 'seg-s2s', CURADORIA_BFF_GITHUB_ALLOWED_TEAMS: 'curadoria' });
    const g = new AuthGuard(new SessionService(c), c);
    const req: any = { headers: { 'x-internal-token': 'seg-s2s' } };
    expect(g.canActivate(ctx(req))).toBe(true);
    expect(req.user.nome).toBe('cockpit');
  });

  it('S2S: token errado e sem sessão → 401', () => {
    const c = cfg({ CURADORIA_BFF_S2S_TOKEN: 'seg-s2s' });
    const g = new AuthGuard(new SessionService(c), c);
    try { g.canActivate(ctx({ headers: { 'x-internal-token': 'errado' } })); fail('deveria lançar'); }
    catch (e) { expect((e as HttpException).getStatus()).toBe(401); }
  });

  it('S2S desligado (token vazio) → header não autentica', () => {
    const c = cfg(); // sem CURADORIA_BFF_S2S_TOKEN
    const g = new AuthGuard(new SessionService(c), c);
    try { g.canActivate(ctx({ headers: { 'x-internal-token': '' } })); fail('deveria lançar'); }
    catch (e) { expect((e as HttpException).getStatus()).toBe(401); }
  });
});
