import { Controller, Get, Param } from '@nestjs/common';
import { AgenteCuradorService } from '../agente-curador/agente-curador.service';

@Controller('api')
export class AgenteController {
  constructor(private readonly agente: AgenteCuradorService) {}

  /** Estado da curadoria para este órfão (prompt + cura), lido do MS5 — o cockpit
   * REEXIBE o prompt e a cura em polling, sem depender do AgentiX (só da store). */
  @Get('agente/cura/:fingerprint')
  async cura(@Param('fingerprint') fingerprint: string) {
    return this.agente.estadoCuradoria(fingerprint);
  }
}
