/**
 * CRUD de um documento da base de conhecimento (MS 3) — o que a tela de detalhe
 * da Base consome. A listagem continua na ReviewController.
 *
 * Excluir aqui NÃO devolve erro à fila e NÃO mexe na elegibilidade: a base é
 * complementar ao cache, o erro segue curado.
 */
import {
  Body, Controller, Delete, Get, HttpCode, HttpException, Param, ParseIntPipe, Put, UseGuards,
} from '@nestjs/common';
import { logJson } from '../common/json-logger';
import { UpstreamError } from '../common/upstream-error';
import { AuthGuard } from '../auth/auth.guard';
import { EligibilityStore } from '../eligibility/eligibility-store.service';
import { anotarElegibilidade } from '../eligibility/eligibility-annotate';
import { RetrievalService } from '../upstreams/retrieval.service';
import { DocumentoEditIn } from './dto/documento-edit.dto';

const NAO_ENCONTRADO = 'documento não encontrado';

@UseGuards(AuthGuard)
@Controller('v1')
export class BaseRecordsController {
  constructor(
    private readonly ms3: RetrievalService,
    private readonly elegibilidade: EligibilityStore,
  ) {}

  private exigirMs3(): void {
    if (!this.ms3.enabled) {
      throw new HttpException(
        { detail: 'base de conhecimento indisponível: configure CURADORIA_BFF_MS3_URL' },
        503,
      );
    }
  }

  private anotar(doc: Record<string, any>) {
    return anotarElegibilidade([doc], (d: any) => d.origem_fingerprint ?? null, this.elegibilidade.mapa())[0];
  }

  private traduzir404(e: unknown): never {
    if (e instanceof UpstreamError && e.statusCode === 404) {
      throw new HttpException({ detail: NAO_ENCONTRADO }, 404);
    }
    throw e;
  }

  @Get('documentos/:id')
  async obter(@Param('id', ParseIntPipe) id: number) {
    this.exigirMs3();
    try {
      return this.anotar(await this.ms3.obterDocumento(id));
    } catch (e) {
      this.traduzir404(e);
    }
  }

  @Put('documentos/:id')
  @HttpCode(200)
  async editar(@Param('id', ParseIntPipe) id: number, @Body() body: DocumentoEditIn) {
    this.exigirMs3();
    try {
      const doc = await this.ms3.editarDocumento(id, {
        titulo: body.titulo,
        conteudo: body.conteudo,
        servico: body.servico ?? null,
        nivel: body.nivel ?? null,
        tags: body.tags ?? [],
      });
      logJson('info', 'documento editado', { doc_id: id });
      return this.anotar(doc);
    } catch (e) {
      this.traduzir404(e);
    }
  }

  @Delete('documentos/:id')
  @HttpCode(204)
  async excluir(@Param('id', ParseIntPipe) id: number): Promise<void> {
    this.exigirMs3();
    try {
      await this.ms3.excluirDocumento(id);
    } catch (e) {
      this.traduzir404(e);
    }
    logJson('info', 'documento excluído da base', { doc_id: id });
  }
}
