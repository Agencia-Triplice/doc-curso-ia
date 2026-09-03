import { Body, Controller, Get, HttpCode, HttpException, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';
import { logJson } from '../common/json-logger';
import { NOME_COOKIE, parseCookies, SessionService } from './session.service';
import { GithubOAuthService } from './github-oauth.service';
import { PatIn } from './dto/pat.dto';
import { RemediationService } from '../upstreams/remediation.service';

const COOKIE_STATE = 'curadoria_oauth_state';

@Controller()
export class AuthController {
  constructor(
    private readonly sessions: SessionService,
    private readonly oauth: GithubOAuthService,
    private readonly ms8: RemediationService,
    @Inject(APP_CONFIG) private readonly cfg: CuradoriaConfig,
  ) {}

  @Get('auth/config')
  config(): { github: boolean; pat: boolean } {
    // PAT está sempre disponível; OAuth só quando o app está configurado.
    return { github: this.oauth.configurado(), pat: true };
  }

  @Get('v1/me')
  me(@Req() req: Request) {
    const s = this.sessions.resolver(req);
    if (!s) throw new HttpException({ detail: 'não autenticado' }, 401);
    return { nome: s.nome, via: s.via, avatar: s.avatar, teams: s.teams };
  }

  @Post('auth/pat')
  @HttpCode(204)
  async entrarComPat(@Body() body: PatIn, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = body.token.trim();
    if (!token) {
      // @Length(1,255) passa em string só-de-espaços; barra o vazio-após-trim.
      throw new HttpException({ detail: 'informe um token' }, 422);
    }
    let dados: { login: string; nome: string; avatar: string; teams: string[] };
    try {
      // O PAT é validado contra o GitHub e descartado — nunca é persistido nem logado.
      dados = await this.oauth.autenticarComPat(token);
    } catch (e) {
      logJson('warning', 'falha ao validar PAT', { erro: String((e as Error).message) });
      throw new HttpException({ detail: 'token inválido' }, 401);
    }
    // Conveniência: quem entra por PAT já pode abrir PR sem re-digitar o token na
    // tela "Credencial". Best-effort e SÓ quando o executor está ligado e SEM
    // credencial armada (não sobrescreve uma armada pela tela). Nunca derruba o
    // login: MS8 off, PAT só-leitura (sem escopo de escrita → 400 do MS8) ou
    // qualquer falha apenas registram warning; o token nunca é logado.
    if (this.ms8.enabled) {
      try {
        const estado: any = await this.ms8.obterCredencial();
        if (!estado?.presente) await this.ms8.armarCredencial(token);
      } catch (e) {
        logJson('warning', 'não foi possível armar a credencial do executor a partir do PAT de login', { erro: String((e as Error).message) });
      }
    }
    const tok = this.sessions.emitir({
      sub: `github:${dados.login}`,
      nome: dados.nome,
      avatar: dados.avatar || null,
      via: 'github',
      teams: dados.teams,
    });
    res.cookie(NOME_COOKIE, tok, this.sessions.opcoesCookie());
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(NOME_COOKIE, { path: '/' });
  }

  @Get('auth/github')
  github(@Res() res: Response): void {
    if (!this.oauth.configurado()) {
      res.redirect('/?erro=github_indisponivel');
      return;
    }
    const state = randomBytes(16).toString('hex');
    res.cookie(COOKIE_STATE, state, { httpOnly: true, sameSite: 'lax', secure: this.cfg.production, path: '/', maxAge: 600000 });
    res.redirect(this.oauth.urlAutorizacao(state));
  }

  @Get('auth/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const esperado = parseCookies(req.headers.cookie)[COOKIE_STATE];
    res.clearCookie(COOKIE_STATE, { path: '/' });
    if (!code || !state || !esperado || state !== esperado) {
      res.redirect('/?erro=state_invalido');
      return;
    }
    try {
      const token = await this.oauth.trocarCode(code);
      const [u, teams] = await Promise.all([this.oauth.obterUsuario(token), this.oauth.obterTeams(token)]);
      const tok = this.sessions.emitir({ sub: `github:${u.login}`, nome: u.nome, avatar: u.avatar || null, via: 'github', teams });
      res.cookie(NOME_COOKIE, tok, this.sessions.opcoesCookie());
      res.redirect('/');
    } catch (e) {
      logJson('warning', 'falha no callback do github', { erro: String((e as Error).message) });
      res.redirect('/?erro=login_falhou');
    }
  }
}
