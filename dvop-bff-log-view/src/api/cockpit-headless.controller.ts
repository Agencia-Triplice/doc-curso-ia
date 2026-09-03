import { Body, Controller, Get, HttpCode, HttpException, Param, Post } from '@nestjs/common';
import { DiagnosticoMistoService } from '../diagnostico/diagnostico-misto.service';
import { CuradoriaPropostaService } from '../upstreams/curadoria-proposta.service';
import { DiagnosticoMistoDto } from './dto/diagnostico-misto.dto';
import { montarTrace } from '../cockpit/trace-builder';
import { UpstreamError } from '../common/upstream-error';
import { logJson } from '../common/json-logger';

const OFERECE_PR = new Set(['cache_exato', 'cache_aproximado', 'base_conhecimento']);

@Controller('api/cockpit')
export class CockpitHeadlessController {
  constructor(
    private readonly misto: DiagnosticoMistoService,
    private readonly curadoria: CuradoriaPropostaService,
  ) {}

  /** "Digitar + Analisar" headless: diagnostica e devolve o trace estruturado +
   * a ação de PR disponível (quando o caso casa com uma remediação). */
  @Post('analisar')
  @HttpCode(200)
  async analisar(@Body() body: DiagnosticoMistoDto) {
    const res = await this.misto.diagnosticar(body);
    const { trace, itens_extras, principal_fingerprint, principal_resultado } = montarTrace(res);
    const acoes = await this.acoesDePr(principal_fingerprint, principal_resultado);
    return { trace, itens_extras, acoes };
  }

  /** PR aplicável ao caso (mesmo gatilho da C.6). Falha de consulta NÃO derruba a
   * análise: cai em `{}` (o trace continua válido). */
  private async acoesDePr(fingerprint: string | null, resultado: string | null): Promise<Record<string, unknown>> {
    if (!fingerprint || !resultado || !OFERECE_PR.has(resultado) || !this.curadoria.enabled) return {};
    try {
      const r = await this.curadoria.aplicaveis(fingerprint);
      const rem = (r?.aplicaveis ?? [])[0];
      if (!rem) return {};
      return {
        pr_disponivel: {
          fingerprint, remediacao_id: rem.id, remediacao_versao: rem.versao,
          titulo: rem.titulo_pr_template ?? rem.descricao_acao ?? null,
          instrucao: rem.instrucao ?? null,
        },
      };
    } catch (e) {
      if (!(e instanceof UpstreamError)) throw e;
      logJson('warning', 'consulta de remediação aplicável falhou; segue sem ação de PR', { fingerprint, status: e.statusCode });
      return {};
    }
  }

  protected exigirCuradoria(): void {
    if (!this.curadoria.enabled) {
      throw new HttpException({ detail: 'PR indisponível: configure LOG_BFF_CURADORIA_URL e CURADORIA_S2S_TOKEN' }, 503);
    }
  }

  private readonly pollMs = 3000;
  private readonly pollMax = 60;

  /** Dispara a abertura do PR (assíncrono): gera a proposta e orquestra
   * poll→aprovar em background. O chamador consulta GET .../estado. */
  @Post('pr/:fingerprint/aprovar')
  @HttpCode(202)
  async aprovar(@Param('fingerprint') fingerprint: string) {
    this.exigirCuradoria();
    const r = await this.curadoria.aplicaveis(fingerprint);
    const rem = (r?.aplicaveis ?? [])[0];
    if (!rem) throw new HttpException({ detail: 'nenhuma remediação de PR casa com este caso' }, 409);
    await this.curadoria.gerar(fingerprint, { instrucao: rem.instrucao, paths: rem.escopo?.paths_permitidos });
    void this.orquestrarAbertura(fingerprint);
    return { estado: 'gerando' };
  }

  /** Estado atual da proposta (poll). 404 (proposta ausente, ex.: após rejeitar) → 'ausente'. */
  @Get('pr/:fingerprint/estado')
  async estado(@Param('fingerprint') fingerprint: string) {
    this.exigirCuradoria();
    try {
      const p = await this.curadoria.obter(fingerprint);
      return { estado: p?.estado ?? null, pr_numero: p?.pr_numero ?? null, pr_url: p?.pr_url ?? null, motivo: p?.motivo ?? null };
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) return { estado: 'ausente' };
      throw e;
    }
  }

  /** Recusa a remediação: descarta a proposta (nenhum PR é aberto). */
  @Post('pr/:fingerprint/rejeitar')
  @HttpCode(200)
  async rejeitar(@Param('fingerprint') fingerprint: string) {
    this.exigirCuradoria();
    await this.curadoria.rejeitar(fingerprint);
    return { estado: 'rejeitado' };
  }

  /** Background: poll da proposta até `pronta` (→ aprovar/abre o PR) ou terminal.
   * Público p/ teste direto (sleepMs=0). Best-effort: erros só logam. */
  async orquestrarAbertura(fingerprint: string, sleepMs = this.pollMs): Promise<void> {
    for (let i = 0; i < this.pollMax; i++) {
      let p: any;
      try { p = await this.curadoria.obter(fingerprint); }
      catch (e) { logJson('warning', 'poll da proposta falhou', { fingerprint, erro: String(e) }); return; }
      const est = String(p?.estado ?? '');
      if (est === 'pronta') {
        try { await this.curadoria.aprovar(fingerprint, {}); }
        catch (e) { logJson('warning', 'aprovação headless falhou', { fingerprint, erro: String(e) }); }
        return;
      }
      if (est === 'nao_aplicavel' || est === 'erro_geracao' || est.startsWith('pr_')) return;
      await new Promise((res) => setTimeout(res, sleepMs));
    }
    logJson('warning', 'orquestração de PR esgotou o poll sem estado terminal', { fingerprint });
  }
}
