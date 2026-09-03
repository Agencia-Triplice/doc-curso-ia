/**
 * Elegibilidade a PR automático (Plano 2 do caminho A).
 *
 * O vínculo fingerprint→remediação vive no SQLite próprio do bff-curadoria; o
 * catálogo (e o preview) vem do MS 8. Regra inegociável do design: NÃO
 * existe elegibilidade sem remediação catalogada E sem preview confirmado
 * (400). O disparo do PR em si é fase futura — aqui só o cadastro.
 *
 * Porta fiel de ms7/app/api/routes_eligibility.py — mensagens de erro,
 * status codes e formas de resposta reproduzidos passo a passo.
 */
import { Body, Controller, Delete, Get, HttpCode, HttpException, Param, Put, Query, UseGuards } from '@nestjs/common';
import { logJson } from '../common/json-logger';
import { UpstreamError } from '../common/upstream-error';
import { AuthGuard } from '../auth/auth.guard';
import { EligibilityStore } from '../eligibility/eligibility-store.service';
import { MetricsService } from '../metrics/metrics.service';
import { CacheWriterService } from '../upstreams/cache-writer.service';
import { RemediationService } from '../upstreams/remediation.service';
import { casaRemediacao } from '../propostas/remediacao-match';
import { ElegibilidadeIn } from './dto/eligibility.dto';
import { EligibilityQueryDto } from './dto/eligibility-query.dto';
import { FingerprintPipe } from './fingerprint.pipe';

type ErroDados = Record<string, any>;

@UseGuards(AuthGuard)
@Controller('v1')
export class EligibilityController {
  constructor(
    private readonly ms5: CacheWriterService,
    private readonly ms8: RemediationService,
    private readonly store: EligibilityStore,
    private readonly metrics: MetricsService,
  ) {}

  // espelha datetime.now(timezone.utc).isoformat(timespec="seconds") do Python
  private nowIso(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
  }

  private exigirMs8(): void {
    if (!this.ms8.enabled) {
      throw new HttpException({ detail: 'remediação indisponível: configure CURADORIA_BFF_MS8_URL' }, 503);
    }
  }

  /** Erro conhecido = está na fila (órfão) OU já curado (cache) — as duas
   * origens do design. Qualquer outro fingerprint é 404: elegibilidade não
   * nasce de erro fantasma. */
  private async _dadosDoErro(fingerprint: string): Promise<ErroDados> {
    try {
      return await this.ms5.obterOrfao(fingerprint);
    } catch (e) {
      if (!(e instanceof UpstreamError) || e.statusCode !== 404) {
        throw e;
      }
    }
    try {
      return await this.ms5.obterSolucao(fingerprint);
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) {
        throw new HttpException({ detail: 'fingerprint desconhecido: não está na fila nem no cache' }, 404);
      }
      throw e;
    }
  }

  /** Pass-through do catálogo do MS 8 — o front escolhe a remediação aqui. */
  @Get('remediacoes')
  async listarRemediacoes() {
    this.exigirMs8();
    return await this.ms8.listarRemediacoes();
  }

  @Put('elegibilidade/:fingerprint')
  @HttpCode(200)
  async upsertElegibilidade(
    @Param('fingerprint', FingerprintPipe) fingerprint: string,
    @Body() body: ElegibilidadeIn,
  ) {
    this.exigirMs8();
    if (!body.preview_confirmado) {
      throw new HttpException({ detail: 'sem preview confirmado: renderize o preview da remediação antes' }, 400);
    }
    let remediacao: ErroDados;
    try {
      remediacao = await this.ms8.obterRemediacao(body.remediacao_id);
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) {
        throw new HttpException({ detail: `remediação não catalogada: '${body.remediacao_id}'` }, 400);
      }
      throw e;
    }
    const erro = await this._dadosDoErro(fingerprint);
    if (!casaRemediacao(
      { assinatura: erro.assinatura, servico: erro.servico, template: erro.template },
      { aplicabilidade: (remediacao as any).aplicabilidade },
    )) {
      throw new HttpException({ detail: 'remediação não se aplica a este erro' }, 400);
    }
    const row = this.store.upsert(
      {
        fingerprint,
        remediacao_id: remediacao.id,
        // versão vem do catálogo (server-side), nunca do cliente:
        // rastreabilidade do que foi visto no preview
        remediacao_versao: remediacao.versao,
        assinatura: erro.assinatura,
        servico: erro.servico ?? null,
        autor: body.autor ?? null,
      },
      this.nowIso(),
    );
    logJson('info', 'elegibilidade registrada', {
      fingerprint,
      remediacao_id: remediacao.id,
      autor: body.autor ?? null,
    });
    this.metrics.elegibilidade('registrada');
    return row;
  }

  // GET /v1/elegibilidade/:fingerprint (leitura single) vive na
  // EligibilityReadController, FORA do AuthGuard: é a rota que o MS 8 consome
  // serviço-a-serviço, sem sessão. Ver eligibility-read.controller.ts.

  @Delete('elegibilidade/:fingerprint')
  @HttpCode(204)
  deleteElegibilidade(@Param('fingerprint', FingerprintPipe) fingerprint: string): void {
    if (!this.store.delete(fingerprint)) {
      throw new HttpException({ detail: 'sem elegibilidade para este fingerprint' }, 404);
    }
    logJson('info', 'elegibilidade removida', { fingerprint });
    this.metrics.elegibilidade('removida');
  }

  @Get('elegibilidade')
  listElegibilidade(@Query() q: EligibilityQueryDto) {
    return { itens: this.store.list(q.limit), total: this.store.count() };
  }
}
