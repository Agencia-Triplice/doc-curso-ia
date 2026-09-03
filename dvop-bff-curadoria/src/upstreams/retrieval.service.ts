import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';

@Injectable()
export class RetrievalService extends UpstreamClient {
  label = 'retrieval (MS 3)';
  private readonly base: string;
  constructor(@Inject(APP_CONFIG) cfg: CuradoriaConfig) {
    super(cfg.requestTimeout * 1000);
    this.base = cfg.ms3Url.replace(/\/+$/, '');
  }
  get enabled(): boolean { return Boolean(this.base); }

  buscar(query: string, servico: string | null, nivel: string | null) {
    // SEM fingerprint de propósito: com ele, uma busca não-grounded faria o
    // MS 3 reincrementar o órfão no MS 5 — consulta de revisão não é nova
    // ocorrência do erro
    return this.postJson(`${this.base}/v1/search`, { query, servico, nivel });
  }

  ingerirDocumento(documentos: unknown[]) {
    return this.postJson(`${this.base}/v1/documents`, documentos);
  }

  listarDocumentos(limit: number) {
    return this.getJson(`${this.base}/v1/documents`, { params: { limit } });
  }

  obterDocumento(id: number) {
    return this.getJson(`${this.base}/v1/documents/${id}`, {});
  }
  editarDocumento(id: number, payload: unknown) {
    return this.putJson(`${this.base}/v1/documents/${id}`, payload);
  }
  async excluirDocumento(id: number): Promise<void> {
    await this.send('DELETE', `${this.base}/v1/documents/${id}`);
  }
}
