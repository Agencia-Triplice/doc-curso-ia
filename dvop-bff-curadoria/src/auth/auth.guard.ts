import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';
import { SessionService } from './session.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly cfg: CuradoriaConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    // caminho S2S: chamada interna (cockpit/log-view) com o token de entrada.
    // Só vale quando o token está configurado; identidade sintética 'cockpit'
    // alimenta `aprovado_por` e pula a checagem de teams.
    const token = this.cfg.s2sToken;
    if (token && req.headers?.['x-internal-token'] === token) {
      req.user = { nome: 'cockpit', login: 'cockpit', teams: [] as string[] };
      return true;
    }
    const sessao = this.sessions.resolver(req);
    if (!sessao) {
      throw new HttpException({ detail: 'não autenticado' }, 401);
    }
    const permitidos = this.cfg.githubAllowedTeams;
    if (permitidos.length > 0 && !sessao.teams.some((t) => permitidos.includes(t))) {
      throw new HttpException({ detail: 'sem acesso — fora dos teams autorizados' }, 403);
    }
    req.user = sessao;
    return true;
  }
}
