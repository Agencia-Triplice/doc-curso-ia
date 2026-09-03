/**
 * Escrita do catálogo de remediações (proxy para o MS 8), atrás do AuthGuard.
 * O gate do dialeto vive aqui: a assinatura é compilada com `new RegExp` ANTES
 * de repassar — regex Java-only é barrada com 400, sem tocar o MS 8, para não
 * cadastrar uma regra que depois falharia silenciosamente no match (que roda em JS).
 */
import { Body, Controller, Delete, HttpCode, HttpException, Param, Post, UseGuards } from '@nestjs/common';
import { logJson } from '../common/json-logger';
import { AuthGuard } from '../auth/auth.guard';
import { MetricsService } from '../metrics/metrics.service';
import { RemediationService } from '../upstreams/remediation.service';
import { assinaturaCompativelJs } from '../propostas/remediacao-match';

@UseGuards(AuthGuard)
@Controller('v1')
export class RemediacoesEscritaController {
  constructor(
    private readonly ms8: RemediationService,
    private readonly metrics: MetricsService,
  ) {}

  private exigirMs8(): void {
    if (!this.ms8.enabled) {
      throw new HttpException({ detail: 'remediação indisponível: configure CURADORIA_BFF_MS8_URL' }, 503);
    }
  }

  @Post('remediacoes')
  @HttpCode(201)
  async criar(@Body() body: any) {
    this.exigirMs8();
    const regex = body?.aplicabilidade?.assinatura_regex;
    if (typeof regex !== 'string' || !assinaturaCompativelJs(regex)) {
      throw new HttpException({ detail: 'assinatura_regex incompatível com JS (new RegExp)' }, 400);
    }
    const criada = await this.ms8.criarRemediacao(body);
    logJson('info', 'remediação criada', { id: body?.id });
    this.metrics.curadoria('remediacao_criada');
    return criada;
  }

  @Delete('remediacoes/:id')
  @HttpCode(204)
  async excluir(@Param('id') id: string): Promise<void> {
    this.exigirMs8();
    await this.ms8.excluirRemediacao(id);
    logJson('info', 'remediação excluída', { id });
    this.metrics.curadoria('remediacao_excluida');
  }
}
