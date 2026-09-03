/**
 * Proposta de PR por caso — geração assistida (AgentiX), aprovação humana
 * (abre o PR via MS 8) e rejeição (fecha o PR via MS 8). A IA NUNCA mergeia:
 * `aprovar` só ABRE o PR, `fechar-pr` só FECHA — o merge é sempre manual, fora
 * desta API.
 *
 * `_dadosDoErro` é a MESMA lógica de `eligibility.controller.ts` (erro
 * conhecido = órfão na fila OU já curado no cache; qualquer outro fingerprint
 * é 404) — duplicada aqui de propósito, mesmo padrão de `findOrphan` em
 * `review.controller.ts`: cada controller replica o helper, não existe módulo
 * compartilhado para isso.
 */
import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { logJson } from '../common/json-logger';
import { UpstreamError } from '../common/upstream-error';
import { AuthGuard } from '../auth/auth.guard';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';
import { MetricsService } from '../metrics/metrics.service';
import { CacheWriterService } from '../upstreams/cache-writer.service';
import { RemediationService } from '../upstreams/remediation.service';
import { PropostaStore, PropostaRow } from '../propostas/proposta-store.service';
import { selecionarCandidatos } from '../propostas/proposta-decode';
import { remediacoesQueCasam } from '../propostas/remediacao-match';
import { ProporIn } from './dto/proposta.dto';
import { FingerprintPipe } from './fingerprint.pipe';

type ErroDados = Record<string, any>;
type ArquivoGuardado = {
  path: string;
  conteudo_novo: string;
  conteudo_atual?: string;
  operacao?: 'editar' | 'excluir';
};

const PROPOSTA_NAO_ENCONTRADA = 'proposta não encontrada';

@UseGuards(AuthGuard)
@Controller('v1')
export class PropostasController {
  constructor(
    private readonly ms5: CacheWriterService,
    private readonly ms8: RemediationService,
    private readonly store: PropostaStore,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly cfg: CuradoriaConfig,
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
   * origens do design (ver `eligibility.controller._dadosDoErro`). Qualquer
   * outro fingerprint é 404. */
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

  /** Solução curada: `ms5.obterSolucao` primeiro (fonte de verdade pós-cura);
   * 404 cai no rascunho do órfão já obtido em `_dadosDoErro` (curadoria ainda
   * em andamento). Não-404 propaga (502/504), igual `_dadosDoErro`. */
  private async _solucaoCurada(fingerprint: string, erro: ErroDados): Promise<string | null> {
    try {
      const sol = await this.ms5.obterSolucao(fingerprint);
      return sol.solucao ?? null;
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) {
        return erro.rascunho?.solucao ?? null;
      }
      throw e;
    }
  }

  private toOut(row: PropostaRow): Record<string, unknown> {
    const { arquivos_json, ...resto } = row;
    let arquivos: unknown[] = [];
    if (arquivos_json) {
      try {
        arquivos = JSON.parse(arquivos_json);
      } catch {
        arquivos = [];
      }
    }
    return { ...resto, arquivos };
  }

  private obterOu404(fingerprint: string): PropostaRow {
    const row = this.store.get(fingerprint);
    if (!row) {
      throw new HttpException({ detail: PROPOSTA_NAO_ENCONTRADA }, 404);
    }
    return row;
  }

  /** Comum a `criar` e `regenerar` — `criarGerando` faz upsert (ON CONFLICT)
   * e sempre volta a linha para `gerando`, seja ela nova ou já existente. */
  private async gerar(fingerprint: string, body: ProporIn): Promise<PropostaRow> {
    const erro = await this._dadosDoErro(fingerprint);
    const servico = erro.servico ?? null;
    const assinatura = erro.assinatura ?? '';
    const solucao = await this._solucaoCurada(fingerprint, erro);
    const candidatos = selecionarCandidatos(assinatura, body.instrucao, body.paths);
    const row = this.store.criarGerando(
      { fingerprint, servico, assinatura, solucao, instrucao: body.instrucao ?? null, paths: candidatos },
      this.nowIso(),
    );
    logJson('info', 'proposta: geração solicitada', { fingerprint, servico, nCandidatos: candidatos.length });
    this.metrics.curadoria('proposta_gerando');
    return row;
  }

  @Post('propostas/:fingerprint')
  @HttpCode(200)
  async criar(@Param('fingerprint', FingerprintPipe) fingerprint: string, @Body() body: ProporIn) {
    return await this.gerar(fingerprint, body);
  }

  /** Teto de escopo (gate real que `aprovar` e o worker aplicam) — exposto ao
   * cockpit para o card de PR mostrar "N/max arquivos · M/max linhas". */
  private tetoEscopo(): { max_arquivos: number; max_linhas: number } {
    return { max_arquivos: this.cfg.propostaMaxArquivos, max_linhas: this.cfg.propostaMaxLinhasDiff };
  }

  @Get('propostas/:fingerprint')
  obter(@Param('fingerprint', FingerprintPipe) fingerprint: string) {
    return { ...this.toOut(this.obterOu404(fingerprint)), teto: this.tetoEscopo() };
  }

  @Get('remediacoes-aplicaveis/:fingerprint')
  async remediacoesAplicaveis(@Param('fingerprint', FingerprintPipe) fingerprint: string) {
    this.exigirMs8();
    const erro = await this._dadosDoErro(fingerprint); // 404 se desconhecido
    let catalogo: any;
    try {
      catalogo = await this.ms8.listarRemediacoes();
    } catch {
      // catálogo indisponível ≠ zero matches: estado distinto p/ o front não esconder por engano
      logJson('warn', 'remediacoes-aplicaveis: catálogo indisponível', { fingerprint });
      throw new HttpException({ detail: 'catalogo_indisponivel' }, 502);
    }
    const lista = Array.isArray(catalogo?.remediacoes) ? catalogo.remediacoes : [];
    const aplicaveis = remediacoesQueCasam(
      { assinatura: erro.assinatura, servico: erro.servico, template: erro.template },
      lista,
    );
    return { aplicaveis, total: aplicaveis.length, teto: this.tetoEscopo() };
  }

  /** Branches do repo do caso — o cockpit chama isto quando o `aprovar` volta
   * `base_inexistente`, para o operador escolher contra qual branch abrir o PR. */
  @Get('propostas/:fingerprint/branches')
  async branches(@Param('fingerprint', FingerprintPipe) fingerprint: string) {
    this.exigirMs8();
    const erro = await this._dadosDoErro(fingerprint); // 404 se desconhecido; garante `servico`
    if (!erro.servico) {
      throw new HttpException({ detail: 'serviço do caso desconhecido' }, 409);
    }
    return await this.ms8.listarBranchesRepo(erro.servico);
  }

  @Post('propostas/:fingerprint/aprovar')
  @HttpCode(200)
  async aprovar(
    @Param('fingerprint', FingerprintPipe) fingerprint: string,
    @Req() req: Request,
    @Body() body: { base?: string } = {},
  ) {
    this.exigirMs8();
    const row = this.obterOu404(fingerprint);
    if (row.estado !== 'pronta') {
      throw new HttpException(
        { detail: `proposta não está pronta para aprovação (estado atual: ${row.estado})` },
        409,
      );
    }
    // reconfere o teto com os contadores GRAVADOS na geração (não recalcula) —
    // segunda barreira, o worker já checou o mesmo teto ao marcar `pronta`.
    const nArquivos = row.n_arquivos ?? 0;
    const nLinhas = row.n_linhas_diff ?? 0;
    if (nArquivos > this.cfg.propostaMaxArquivos || nLinhas > this.cfg.propostaMaxLinhasDiff) {
      throw new HttpException({ detail: `teto de escopo excedido (arquivos=${nArquivos}, linhas=${nLinhas})` }, 409);
    }
    // TRAVA anti-duplo-PR: transição atômica `pronta` -> `aprovando` ANTES da
    // chamada ao MS 8. Dois `aprovar` concorrentes para o mesmo fingerprint
    // (poll do cockpit + clique na UI, ou duplo-clique) passariam os dois pelo
    // check `estado === 'pronta'` acima e abririam DOIS PRs, porque o estado só
    // virava `pr_aberto` depois do `await ms8.aplicarPr`. O CAS resolve isso no
    // SQLite (better-sqlite3 é síncrono): só um vê changes===1.
    if (!this.store.transicionarEstado(fingerprint, 'pronta', 'aprovando', this.nowIso())) {
      throw new HttpException(
        { detail: 'proposta já está sendo aprovada ou já foi aprovada' },
        409,
      );
    }

    let arquivos: ArquivoGuardado[] = [];
    try {
      arquivos = row.arquivos_json ? JSON.parse(row.arquivos_json) : [];
    } catch {
      arquivos = [];
    }
    // PedidoAplicar.arquivos do MS 8 só aceita {path, conteudo_novo} — o
    // conteudo_atual gravado (usado só para o guardrail de diff) NUNCA sai
    // daqui.
    const arquivosPr = arquivos.map((a) => ({
      path: a.path,
      conteudo_novo: a.conteudo_novo,
      operacao: a.operacao ?? 'editar',
    }));
    // base do PR = a branch em que a run de CI rodou (vem do órfão do caso). O
    // MS 8 abre o PR SEMPRE contra ela. Desconhecido/indisponível → null: o MS 8
    // cai para a branch default do repositório. Se o operador escolheu uma base
    // explícita no cockpit (após um `base_inexistente`), ela tem precedência.
    const baseEscolhida = typeof body?.base === 'string' ? body.base.trim() : '';
    let branchBase: string | null = null;
    if (baseEscolhida) {
      branchBase = baseEscolhida;
    } else {
      try {
        const erro = await this._dadosDoErro(fingerprint);
        branchBase = typeof erro?.branch === 'string' && erro.branch ? erro.branch : null;
      } catch {
        branchBase = null;
      }
    }
    const pedido = {
      fingerprint,
      servico: row.servico,
      assinatura: row.assinatura ?? '',
      titulo: row.titulo_pr,
      corpo: row.corpo_pr,
      arquivos: arquivosPr,
      branch_base: branchBase,
    };
    let pr: { pr_numero?: number | null; pr_url?: string | null; branch?: string | null };
    try {
      pr = await this.ms8.aplicarPr(pedido);
    } catch (e) {
      // falhou ao abrir o PR: devolve a proposta a `pronta` para permitir nova
      // tentativa (o CAS da etapa anterior a havia movido para `aprovando`).
      this.store.transicionarEstado(fingerprint, 'aprovando', 'pronta', this.nowIso());
      throw e;
    }

    const sessao = (req as unknown as { user?: { nome?: string } }).user;
    const agora = this.nowIso();
    const atualizado = this.store.atualizar(
      fingerprint,
      {
        estado: 'pr_aberto',
        pr_numero: pr.pr_numero ?? null,
        pr_url: pr.pr_url ?? null,
        aprovado_por: sessao?.nome ?? null,
        aprovado_em: agora,
      },
      agora,
    );
    logJson('info', 'proposta: PR aberto', { fingerprint, pr_numero: pr.pr_numero });
    this.metrics.curadoria('proposta_pr_aberto');
    // pr_branch = branch REAL que o MS 8 criou (agentix-pr-<fp>-<ts>); o MS 8 já
    // a devolve no PrOut, mas não é coluna do store — anexa à resposta para o
    // cockpit exibir a branch de fato aberta (não uma prevista).
    return { ...this.toOut(atualizado), pr_branch: pr.branch ?? null };
  }

  @Post('propostas/:fingerprint/regenerar')
  @HttpCode(200)
  async regenerar(@Param('fingerprint', FingerprintPipe) fingerprint: string, @Body() body: ProporIn) {
    return await this.gerar(fingerprint, body);
  }

  @Delete('propostas/:fingerprint')
  @HttpCode(204)
  descartar(@Param('fingerprint', FingerprintPipe) fingerprint: string): void {
    if (!this.store.delete(fingerprint)) {
      throw new HttpException({ detail: PROPOSTA_NAO_ENCONTRADA }, 404);
    }
    logJson('info', 'proposta: descartada', { fingerprint });
    this.metrics.curadoria('proposta_descartada');
  }

  @Post('propostas/:fingerprint/fechar-pr')
  @HttpCode(200)
  async fecharPr(@Param('fingerprint', FingerprintPipe) fingerprint: string) {
    this.exigirMs8();
    this.obterOu404(fingerprint);
    await this.ms8.fecharPr(fingerprint);
    const atualizado = this.store.atualizar(fingerprint, { estado: 'pr_rejeitado' }, this.nowIso());
    logJson('info', 'proposta: PR fechado', { fingerprint });
    this.metrics.curadoria('proposta_pr_fechado');
    return this.toOut(atualizado);
  }
}
