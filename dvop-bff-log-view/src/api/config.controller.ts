import { Controller, Get, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AgentixService } from '../agentix/agentix.service';

@Controller('api')
export class ConfigController {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, private readonly agente: AgentixService) {}
  @Get('config')
  config() {
    return { default_src: this.cfg.defaultSrvUrl, curadoria_disponivel: Boolean(this.cfg.reviewUrl), fila_url: this.cfg.reviewUrl, agente_disponivel: this.agente.enabled };
  }
}
