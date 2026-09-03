import { Body, Controller, Get, HttpCode, HttpException, Param, Post } from '@nestjs/common';
import { RemediationPrService } from '../upstreams/remediation-pr.service';
import { CuradoriaPropostaService } from '../upstreams/curadoria-proposta.service';
import { UpstreamError } from '../common/upstream-error';

@Controller('api')
export class RemediacaoController {
  constructor(
    private readonly prs: RemediationPrService,
    private readonly curadoria: CuradoriaPropostaService,
  ) {}

  /** O cockpit consulta por fingerprint; {pr:null} = ainda sem PR ou upstream desabilitado. */
  @Get('remediacao/pr/:fingerprint')
  async pr(@Param('fingerprint') fingerprint: string) {
    return { pr: await this.prs.prPorFingerprint(fingerprint) };
  }

  // ---- abrir PR de remediação headless (cockpit orquestra a curadoria) ----

  private exigirCuradoria(): void {
    if (!this.curadoria.enabled) {
      throw new HttpException({ detail: 'abertura de PR indisponível: configure LOG_BFF_CURADORIA_URL e CURADORIA_S2S_TOKEN' }, 503);
    }
  }

  /** Remediações de PR aplicáveis ao caso — o cockpit usa para decidir se mostra
   * o botão "Abrir PR" e de qual remediação tirar {instrucao, paths}. `disponivel:
   * false` = recurso desligado; 404 da curadoria (caso desconhecido) = lista vazia. */
  @Get('remediacao/aplicaveis/:fingerprint')
  async aplicaveis(@Param('fingerprint') fingerprint: string) {
    if (!this.curadoria.enabled) return { disponivel: false, aplicaveis: [], total: 0 };
    try {
      const r = await this.curadoria.aplicaveis(fingerprint);
      return { disponivel: true, aplicaveis: r?.aplicaveis ?? [], total: r?.total ?? 0, teto: r?.teto };
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) {
        return { disponivel: true, aplicaveis: [], total: 0 };
      }
      throw e;
    }
  }

  /** Dispara a geração da proposta (assíncrona). */
  @Post('remediacao/proposta/:fingerprint')
  @HttpCode(200)
  async gerar(@Param('fingerprint') fingerprint: string, @Body() body: { instrucao?: string; paths?: string[] } = {}) {
    this.exigirCuradoria();
    return await this.curadoria.gerar(fingerprint, { instrucao: body?.instrucao, paths: body?.paths });
  }

  /** Estado da proposta (polling do cockpit até `pronta`). */
  @Get('remediacao/proposta/:fingerprint')
  async obterProposta(@Param('fingerprint') fingerprint: string) {
    this.exigirCuradoria();
    return await this.curadoria.obter(fingerprint);
  }

  /** Aprova a proposta pronta → o executor abre o PR no repo do caso. */
  @Post('remediacao/proposta/:fingerprint/aprovar')
  @HttpCode(200)
  async aprovarProposta(@Param('fingerprint') fingerprint: string, @Body() body: { base?: string } = {}) {
    this.exigirCuradoria();
    return await this.curadoria.aprovar(fingerprint, { base: body?.base });
  }
}
