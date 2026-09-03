/**
 * Rotas da fila de revisão humana (curadoria).
 *
 * A fila E os rascunhos vivem no MS 5 (`fingerprints_orfaos` / `rascunhos`);
 * o bff-curadoria é stateless: orquestra a revisão — lista a fila, grava
 * rascunhos no MS 5 e aprova (grava no MS 5) ou descarta. O rascunho de
 * solução é gerado automaticamente pelo CuradorWorker (AgentiX).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { logJson } from '../common/json-logger';
import { UpstreamError } from '../common/upstream-error';
import { AuthGuard } from '../auth/auth.guard';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';
import { CuradorWorker } from '../curador/curador.worker';
import { montarPayloadCurador } from '../curador/payload';
import { resolverPersona } from '../curador/persona';
import { PromptStore } from '../curador/prompt-store.service';
import { anotarElegibilidade } from '../eligibility/eligibility-annotate';
import { EligibilityStore } from '../eligibility/eligibility-store.service';
import { MetricsService } from '../metrics/metrics.service';
import { CacheWriterService } from '../upstreams/cache-writer.service';
import { RemediationService } from '../upstreams/remediation.service';
import { RetrievalService } from '../upstreams/retrieval.service';
import { ApproveIn } from './dto/approve.dto';
import { DocumentosQueryDto } from './dto/documentos-query.dto';
import { DraftIn } from './dto/draft.dto';
import { SolucoesQueryDto } from './dto/solucoes-query.dto';
import { FingerprintPipe } from './fingerprint.pipe';

const ORFAO_NAO_ENCONTRADO = 'órfão não encontrado na fila';

// teto do browse da fila (GET /v1/fila); 500 é o limite máximo aceito pelo
// MS 5. Itens individuais são buscados por fingerprint (obterOrfao), sem
// varrer a lista.
const QUEUE_FETCH_LIMIT = 500;

type Orfao = Record<string, any>;
type Rascunho = Record<string, any>;

/** Órfão do MS 5 (podado às formas do schema QueueItem) anotado com o
 * estado local de revisão (ia_estado). */
function toQueueItem(o: Orfao, iaEstado: string | null) {
  return {
    fingerprint: o.fingerprint,
    assinatura: o.assinatura,
    servico: o.servico ?? null,
    nivel: o.nivel ?? null,
    primeiro_visto: o.primeiro_visto ?? null,
    ocorrencias: o.ocorrencias,
    tem_rascunho: Boolean(o.tem_rascunho),
    template: o.template ?? null,
    run_url: o.run_url ?? null,
    branch: o.branch ?? null,
    workflow: o.workflow ?? null,
    job: o.job ?? null,
    step_cmd: o.step_cmd ?? null,
    exit_code: o.exit_code ?? null,
    log_tail: o.log_tail ?? null,
    ia_estado: iaEstado,
  };
}

/** Rascunho do MS 5 podado à forma do schema DraftOut. */
function toDraftOut(r: Rascunho) {
  return {
    fingerprint: r.fingerprint,
    solucao: r.solucao,
    autor: r.autor ?? null,
    atualizado_em: r.atualizado_em,
  };
}

@UseGuards(AuthGuard)
@Controller('v1')
export class ReviewController {
  constructor(
    private readonly ms5: CacheWriterService,
    private readonly ms3: RetrievalService,
    private readonly ms8: RemediationService,
    private readonly elegibilidade: EligibilityStore,
    private readonly metrics: MetricsService,
    private readonly curador: CuradorWorker,
    private readonly prompts: PromptStore,
    @Inject(APP_CONFIG) private readonly cfg: CuradoriaConfig,
  ) {}

  private async findOrphan(fingerprint: string): Promise<Orfao> {
    try {
      return await this.ms5.obterOrfao(fingerprint);
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) {
        throw new HttpException({ detail: ORFAO_NAO_ENCONTRADO }, 404);
      }
      // 5xx/timeout do MS 5 seguem para o filtro (502/504)
      throw e;
    }
  }

  /** Rascunho do órfão, guiado pelo tem_rascunho anotado (JOIN do MS 5).
   *
   * 404 na janela de corrida (rascunho consumido por outra réplica entre a
   * anotação e o GET) degrada para null; 5xx/timeout re-levantam (502/504). */
  private async getDraftSeExistir(orphan: Orfao): Promise<Rascunho | null> {
    if (!orphan.tem_rascunho) {
      return null;
    }
    try {
      return await this.ms5.obterRascunho(orphan.fingerprint);
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) {
        return null;
      }
      throw e;
    }
  }

  /** Fecha o loop: publica a curadoria como 1 documento no MS 3 (tag
   * 'curadoria', que marca a origem). Best-effort — falha NÃO desfaz a
   * aprovação (o cache já foi gravado e o órfão removido). */
  private async publicarNaBase(
    orphan: Orfao,
    solucao: string,
    fingerprint: string,
    aprovadoPor: string | null,
  ): Promise<boolean> {
    if (!this.ms3.enabled) {
      return false;
    }
    try {
      await this.ms3.ingerirDocumento([
        {
          titulo: String(orphan.assinatura).slice(0, 300),
          conteudo: `Erro: ${orphan.assinatura}\n\nSolução:\n${solucao}`,
          servico: orphan.servico ?? null,
          nivel: orphan.nivel ?? null,
          tags: ['curadoria'],
          origem_fingerprint: fingerprint,
          origem_run_url: orphan.run_url ?? null,
          // quem clicou "aprovar" (usuário logado) — auditoria da ação
          aprovado_por: aprovadoPor,
        },
      ]);
      return true;
    } catch (e) {
      if (e instanceof UpstreamError) {
        logJson('warning', 'falha ao publicar na base de conhecimento', {
          fingerprint,
          status: e.statusCode,
        });
        return false;
      }
      throw e;
    }
  }

  @Get('fila')
  async listarFila() {
    // listarOrfaos PRIMEIRO: se o MS 5 estiver fora, o erro sobe daqui
    // (502/504) antes de counts — preserva o contrato de falha das rotas de
    // fila. tem_rascunho já vem anotado pelo MS 5 (JOIN com a tabela de
    // rascunhos).
    const orfaos: Orfao[] = await this.ms5.listarOrfaos(QUEUE_FETCH_LIMIT);
    const counts = await this.ms5.info();
    const itens = orfaos.map((o) => toQueueItem(o, this.curador.iaEstado(o.fingerprint)));
    const total = counts.orfaos ?? itens.length;
    return { itens, total, truncado: total > itens.length };
  }

  @Get('fila/:fingerprint')
  async obterItemFila(@Param('fingerprint', FingerprintPipe) fingerprint: string) {
    const orphan = await this.findOrphan(fingerprint);
    const draft = await this.getDraftSeExistir(orphan);
    // tem_rascunho derivado do rascunho efetivamente obtido: nunca
    // tem_rascunho=true com rascunho=null (consistência sob corrida)
    return {
      ...toQueueItem(orphan, this.curador.iaEstado(fingerprint)),
      tem_rascunho: draft != null,
      rascunho: draft ? toDraftOut(draft) : null,
    };
  }

  /** O prompt que o curador (AgentiX) recebeu para gerar o rascunho — só
   * leitura, para transparência. `origem: 'registrado'` é o que foi REALMENTE
   * enviado quando o rascunho foi gerado (registrado em disco pelo worker);
   * `origem: 'reconstruido'` cobre rascunhos anteriores a este registro,
   * remontados pelo MESMO builder do worker. A instrução fixa (system prompt)
   * vive no bundle do AgentiX e não é enviada pela curadoria (ver `nota`). */
  @Get('fila/:fingerprint/prompt-agente')
  async promptAgente(@Param('fingerprint', FingerprintPipe) fingerprint: string) {
    const orphan = await this.findOrphan(fingerprint);
    const entidade = {
      tipo: this.cfg.agentixEntityType,
      nome: this.cfg.agentixEntityName,
      versao: this.cfg.agentixEntityVersion,
      bundle: this.cfg.agentixBundleName,
    };
    const nota =
      'O agente também tem uma instrução fixa (system prompt) definida no bundle ' +
      'do AgentiX (bundle/curador/AGENTS.md), que não é enviada pela curadoria. ' +
      'A frente 2 vai trazê-la para esta tela.';

    const registro = this.prompts.get(fingerprint);
    if (registro) {
      return {
        origem: 'registrado',
        registrado_em: registro.registrado_em,
        entidade,
        input: registro.pares[0]?.value ?? '',
        constants: registro.pares,
        nota,
      };
    }

    // rascunho anterior ao registro (ou órfão ainda sem rascunho): reconstrói
    // pelo MESMO builder do worker; contexto do MS 3 é best-effort.
    let contexto: string;
    try {
      contexto = await this.curador.contexto(orphan);
    } catch {
      contexto = '(contexto do MS 3 indisponível para reconstrução)';
    }
    const { persona, dossieTemplate } = resolverPersona(orphan.template);
    const pares = montarPayloadCurador(orphan, contexto, persona, dossieTemplate);
    return {
      origem: 'reconstruido',
      entidade,
      input: pares[0]?.value ?? '',
      constants: pares,
      nota,
    };
  }

  @Put('fila/:fingerprint/rascunho')
  @HttpCode(200)
  async salvarRascunho(@Param('fingerprint', FingerprintPipe) fingerprint: string, @Body() body: DraftIn) {
    let row: Rascunho;
    try {
      // o MS 5 valida o órfão e grava na mesma transação (sem TOCTOU)
      row = await this.ms5.salvarRascunho(fingerprint, body.solucao, body.autor ?? null);
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) {
        throw new HttpException({ detail: ORFAO_NAO_ENCONTRADO }, 404);
      }
      throw e;
    }
    return toDraftOut(row);
  }

  @Delete('fila/:fingerprint/rascunho')
  @HttpCode(204)
  async excluirRascunho(@Param('fingerprint', FingerprintPipe) fingerprint: string): Promise<void> {
    try {
      await this.ms5.excluirRascunho(fingerprint);
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) {
        throw new HttpException({ detail: 'rascunho não encontrado' }, 404);
      }
      throw e;
    }
  }

  @Post('fila/:fingerprint/aprovar')
  @HttpCode(201)
  async aprovar(
    @Param('fingerprint', FingerprintPipe) fingerprint: string,
    @Req() req: Request,
    @Body() body: ApproveIn,
  ) {
    const orphan = await this.findOrphan(fingerprint);
    const draft = await this.getDraftSeExistir(orphan);
    const solucao: string | null = body.solucao || (draft ? draft.solucao : null);
    if (!solucao) {
      throw new HttpException({ detail: 'sem solução: envie no corpo ou salve um rascunho antes' }, 400);
    }
    const autor: string | null = body.autor || (draft ? draft.autor : null);
    // quem clicou "aprovar": identidade da sessão (server-side, nunca do corpo) —
    // auditoria da ação, distinta do `autor` editável. Grava no cache e (se publicar) na base.
    const aprovadoPor: string | null =
      (req as unknown as { user?: { nome?: string } }).user?.nome ?? null;
    // o MS 5 grava a solução e, na MESMA transação, remove o órfão da fila e
    // o rascunho (limpeza atômica entre réplicas); depois avisa o MS 2 (reload)
    const solution = await this.ms5.criarSolucao({
      fingerprint,
      assinatura: orphan.assinatura,
      servico: orphan.servico ?? null,
      nivel: orphan.nivel ?? null,
      solucao,
      autor,
      aprovado_por: aprovadoPor,
      // origem do erro: o run de CI e o arquétipo do repo vêm do órfão e passam a
      // viver com a curadoria (sem isso o link morre na aprovação)
      run_url: orphan.run_url ?? null,
      template: orphan.template ?? null,
      // contexto de esteira: costura MS8 — o executor de PR (Fase 2) consome
      // este shape em cache_solucoes; vem do órfão, nunca do corpo da requisição
      workflow: orphan.workflow ?? null,
      job: orphan.job ?? null,
      step_cmd: orphan.step_cmd ?? null,
      exit_code: orphan.exit_code ?? null,
      log_tail: orphan.log_tail ?? null,
    });
    this.prompts.delete(fingerprint); // órfão saiu da fila: registro do prompt não serve mais
    let publicadoBase = false;
    if (body.publicar_base) {
      publicadoBase = await this.publicarNaBase(orphan, solucao, fingerprint, aprovadoPor);
    }
    logJson('info', 'solução aprovada', {
      fingerprint,
      autor,
      aprovado_por: aprovadoPor,
      publicado_base: publicadoBase,
    });
    this.metrics.curadoria('aprovado');
    return { ...solution, publicado_base: publicadoBase };
  }

  @Post('fila/:fingerprint/descartar')
  @HttpCode(204)
  async descartar(@Param('fingerprint', FingerprintPipe) fingerprint: string): Promise<void> {
    // 404 do MS 5 (órfão inexistente) propaga via UpstreamError; a cascata
    // do MS 5 remove o rascunho na mesma transação
    await this.ms5.excluirOrfao(fingerprint);
    this.prompts.delete(fingerprint); // órfão saiu da fila: registro do prompt não serve mais
    logJson('info', 'órfão descartado', { fingerprint });
    this.metrics.curadoria('descartado');
  }

  /** O que já está cadastrado no cache (MS 5) — painel do front da fila.
   *
   * Leitura pass-through: o MS 5 devolve as mais recentes primeiro; os
   * limites do DTO espelham o contrato dele (1..500). */
  @Get('solucoes')
  async solucoes(@Query() q: SolucoesQueryDto) {
    const solucoes = await this.ms5.listarSolucoes(q.limit);
    return {
      solucoes: anotarElegibilidade(solucoes, (s: any) => s.fingerprint, this.elegibilidade.mapa()),
    };
  }

  /** O que já está na base de conhecimento (MS 3) — painel do front da fila.
   *
   * Pass-through do {documentos, total} do MS 3 (limites 1..200 espelhados);
   * 503 honesto quando o retrieval não está configurado. A lista é anotada com
   * o vínculo de elegibilidade via `origem_fingerprint`; o resto do envelope
   * (incl. `total`) do MS 3 é preservado intacto. */
  @Get('documentos')
  async documentos(@Query() q: DocumentosQueryDto) {
    if (!this.ms3.enabled) {
      throw new HttpException(
        { detail: 'base de conhecimento indisponível: configure CURADORIA_BFF_MS3_URL' },
        503,
      );
    }
    const resposta = await this.ms3.listarDocumentos(q.limit);
    return {
      ...resposta,
      documentos: anotarElegibilidade(
        resposta.documentos ?? [],
        (d: any) => d.origem_fingerprint ?? null,
        this.elegibilidade.mapa(),
      ),
    };
  }

  @Get('info')
  async info() {
    const counts = await this.ms5.info();
    return {
      fila: counts.orfaos ?? null,
      solucoes: counts.solucoes ?? null,
      rascunhos: counts.rascunhos ?? null,
      elegibilidade: this.elegibilidade.count(),
      ms5_url: this.cfg.ms5Url,
      retrieval_disponivel: this.ms3.enabled,
      remediacao_disponivel: this.ms8.enabled,
    };
  }
}
