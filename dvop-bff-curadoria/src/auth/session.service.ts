import { createHmac, timingSafeEqual } from 'crypto';
import { CuradoriaConfig } from '../config/env';
import { logJson } from '../common/json-logger';

export type SessaoVia = 'github' | 'name' | 'dev';

export interface Sessao {
  sub: string;
  nome: string;
  avatar: string | null;
  via: SessaoVia;
  teams: string[];
  exp: number; // segundos epoch
}

export const NOME_COOKIE = 'curadoria_sess';

/** Parse mínimo do header Cookie (sem cookie-parser). */
export function parseCookies(cabecalho: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cabecalho) return out;
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim();
    const bruto = parte.slice(i + 1).trim();
    try {
      out[nome] = decodeURIComponent(bruto);
    } catch {
      out[nome] = bruto;
    }
  }
  return out;
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

export class SessionService {
  private readonly secret: string;
  private readonly ttl: number;
  private readonly devUser: string;
  private readonly production: boolean;

  constructor(cfg: CuradoriaConfig) {
    this.secret = cfg.sessionSecret || 'dev-insecure-secret';
    this.ttl = cfg.sessionTtl;
    this.devUser = cfg.authDevUser;
    this.production = cfg.production;
  }

  private assinar(corpo: string): string {
    return createHmac('sha256', this.secret).update(corpo).digest('base64url');
  }

  emitir(dados: { sub: string; nome: string; avatar: string | null; via: SessaoVia; teams: string[] }): string {
    const payload: Sessao = { ...dados, exp: Math.floor(Date.now() / 1000) + this.ttl };
    const corpo = b64url(JSON.stringify(payload));
    return `${corpo}.${this.assinar(corpo)}`;
  }

  verificar(token: string): Sessao | null {
    const ponto = token.indexOf('.');
    if (ponto < 0) return null;
    const corpo = token.slice(0, ponto);
    const sig = token.slice(ponto + 1);
    const esperado = this.assinar(corpo);
    const a = Buffer.from(sig);
    const b = Buffer.from(esperado);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let payload: Sessao;
    try {
      payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  }

  /** dev bypass (fora de prod) tem prioridade; senão lê o cookie. */
  resolver(req: { headers: Record<string, any> }): Sessao | null {
    if (this.devUser) {
      if (this.production) {
        logJson('warning', 'AUTH_DEV_USER ignorado em produção', {});
      } else {
        return { sub: this.devUser, nome: this.devUser, avatar: null, via: 'dev', teams: [], exp: Math.floor(Date.now() / 1000) + this.ttl };
      }
    }
    const tok = parseCookies(req.headers?.cookie)[NOME_COOKIE];
    return tok ? this.verificar(tok) : null;
  }

  opcoesCookie(): { httpOnly: true; sameSite: 'lax'; secure: boolean; path: '/'; maxAge: number } {
    return { httpOnly: true, sameSite: 'lax', secure: this.production, path: '/', maxAge: this.ttl * 1000 };
  }
}
