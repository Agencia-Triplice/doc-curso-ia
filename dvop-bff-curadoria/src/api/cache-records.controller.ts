/**
 * CRUD de um registro do cache de soluções (MS 5) — o que a tela de detalhe do
 * Cache consome. A listagem continua na ReviewController (painel da fila).
 *
 * Excluir aqui significa "essa curadoria está errada, refaz": o MS 5 devolve o
 * erro à fila na mesma transação, e o vínculo de elegibilidade sai antes, para
 * o executor do MS 8 nunca ver um erro elegível sem solução — e volta quando o
 * MS 5 responde 404, prova de que não havia solução para excluir.
 */
import {
  Body, Controller, Delete, Get, HttpCode, HttpException, Param, Put, Query, UseGuards,
} from '@nestjs/common';
import { logJson } from '../common/json-logger';
import { UpstreamError } from '../common/upstream-error';
import { AuthGuard } from '../auth/auth.guard';
import { EligibilityStore } from '../eligibility/eligibility-store.service';
import { anotarElegibilidade } from '../eligibility/eligibility-annotate';
import { MetricsService } from '../metrics/metrics.service';
import { CacheWriterService } from '../upstreams/cache-writer.service';
import { SolucaoEditIn } from './dto/solucao-edit.dto';
import { FingerprintPipe } from './fingerprint.pipe';

const NAO_ENCONTRADA = 'solução não encontrada no cache';

@UseGuards(AuthGuard)
@Controller('v1')
export class CacheRecordsController {
  constructor(
    private readonly ms5: CacheWriterService,
    private readonly elegibilidade: EligibilityStore,
    private readonly metrics: MetricsService,
  ) {}

  private anotar(solucao: Record<string, any>) {
    return anotarElegibilidade([solucao], (s: any) => s.fingerprint, this.elegibilidade.mapa())[0];
  }

  private traduzir404(e: unknown): never {
    if (e instanceof UpstreamError && e.statusCode === 404) {
      throw new HttpException({ detail: NAO_ENCONTRADA }, 404);
    }
    throw e;
  }

  @Get('solucoes/:fingerprint')
  async obter(@Param('fingerprint', FingerprintPipe) fingerprint: string) {
    try {
      return this.anotar(await this.ms5.obterSolucao(fingerprint));
    } catch (e) {
      this.traduzir404(e);
    }
  }

  @Put('solucoes/:fingerprint')
  @HttpCode(200)
  async editar(
    @Param('fingerprint', FingerprintPipe) fingerprint: string,
    @Body() body: SolucaoEditIn,
  ) {
    try {
      const row = await this.ms5.editarSolucao(fingerprint, body.solucao, body.autor ?? null);
      logJson('info', 'solução editada', { fingerprint, autor: body.autor ?? null });
      this.metrics.curadoria('editado');
      return this.anotar(row);
    } catch (e) {
      this.traduzir404(e);
    }
  }

  @Delete('solucoes/:fingerprint')
  @HttpCode(204)
  async excluir(
    @Param('fingerprint', FingerprintPipe) fingerprint: string,
    // devolver=false: exclusão permanente (o erro não volta para a fila). Default:
    // devolve à fila, o contrato histórico. Só 'false' desliga; qualquer outro valor
    // (ou ausência) mantém o padrão.
    @Query('devolver') devolverRaw?: string,
  ): Promise<void> {
    const devolver = devolverRaw !== 'false';
    // ORDEM IMPORTA: elegibilidade primeiro. Se o MS 5 falhar, sobra um erro sem
    // vínculo (seguro); a ordem inversa deixaria um erro de volta na fila ainda
    // marcado como elegível a PR. Vale para os dois modos: na exclusão permanente o
    // erro deixa de existir, então a marcação de elegível também tem de sair.
    const vinculo = this.elegibilidade.get(fingerprint);
    const tinhaVinculo = this.elegibilidade.delete(fingerprint);
    try {
      await this.ms5.excluirSolucao(fingerprint, devolver);
    } catch (e) {
      // COMPENSAÇÃO: 404 do MS 5 prova que não havia nada a excluir, logo apagar o
      // vínculo era desnecessário — e o vínculo pode existir sem solução no cache
      // (o EligibilityController aceita órfão OU solução), então a marcação era de
      // alguém. Restaura. Em erro que NÃO seja 404 o estado do MS 5 é desconhecido,
      // e a ausência de vínculo continua sendo o lado seguro.
      // O upsert exige um "agora" e reinsere a linha: criado_em é preservado, mas
      // atualizado_em é reescrito com ele na restauração (a API não permite mais).
      if (vinculo && e instanceof UpstreamError && e.statusCode === 404) {
        this.elegibilidade.upsert(vinculo, vinculo.criado_em);
      }
      this.traduzir404(e);
    }
    logJson('info',
      devolver ? 'solução excluída — erro devolvido à fila'
               : 'solução excluída definitivamente — erro não devolvido à fila',
      { fingerprint, tinha_vinculo: tinhaVinculo, devolver });
    this.metrics.curadoria('excluido');
  }
}
