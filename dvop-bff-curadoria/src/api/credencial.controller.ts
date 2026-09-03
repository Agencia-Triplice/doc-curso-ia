/**
 * Credencial de escrita do GitHub, armada pelo operador.
 *
 * Existe para o ambiente de destino não depender de cofre: em vez do PAT vir
 * de Key Vault por variável de ambiente, um humano autenticado o arma pela
 * tela. O PAT vive no gateway único do GitHub (dvop-srv-mcp-github), só em
 * memória — some a cada restart do pod, e a tela mostra `origem: "ausente"`
 * quando isso acontece. Curadoria (executor de PR) e mcp-github compartilham
 * essa mesma credencial.
 *
 * Gated pelo AuthGuard: armar credencial de escrita é ação de curador.
 */
import { Body, Controller, Delete, Get, HttpException, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { UpstreamError } from '../common/upstream-error';
import { McpGithubService } from '../upstreams/mcp-github.service';
import { CredencialDto } from './dto/credencial.dto';

const MSG_GW_OFF = 'gateway do GitHub não configurado: defina CURADORIA_BFF_MCP_GITHUB_URL';

@Controller('v1')
@UseGuards(AuthGuard)
export class CredencialController {
  constructor(private readonly gw: McpGithubService) {}

  @Get('credencial')
  async estado() {
    // sem gateway a tela não pode mentir "ausente": isso confundiria falta de
    // credencial com falta de serviço. Diz que o gateway não está ligado.
    if (!this.gw.enabled) throw new HttpException({ detail: MSG_GW_OFF }, 503);
    return this.repassar(() => this.gw.obterCredencial());
  }

  @Put('credencial')
  async armar(@Body() body: CredencialDto) {
    if (!this.gw.enabled) throw new HttpException({ detail: MSG_GW_OFF }, 503);
    return this.repassar(() => this.gw.armarCredencial(body.token));
  }

  @Delete('credencial')
  async desarmar() {
    if (!this.gw.enabled) throw new HttpException({ detail: MSG_GW_OFF }, 503);
    return this.repassar(() => this.gw.desarmarCredencial());
  }

  /** 400 do gateway (token recusado pelo GitHub) chega ao operador como 400. */
  private async repassar<T>(chamada: () => Promise<T>): Promise<T> {
    try {
      return await chamada();
    } catch (e) {
      if (e instanceof UpstreamError) throw new HttpException({ detail: e.detail }, e.statusCode);
      throw e;
    }
  }
}
