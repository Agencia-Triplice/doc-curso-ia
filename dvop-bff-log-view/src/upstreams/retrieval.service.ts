import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { APP_CONFIG, AppConfig } from '../config/env';

@Injectable()
export class RetrievalService extends UpstreamClient {
  label = 'base de conhecimento';
  private readonly base: string;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) { super(cfg.requestTimeout * 1000); this.base = cfg.retrievalUrl.replace(/\/+$/, ''); }
  get enabled(): boolean { return Boolean(this.base); }
  search(query: string, servico: string | null, nivel: string | null, fingerprint: string, template: string | null = null, runUrl: string | null = null, branch: string | null = null) {
    const corpo: Record<string, unknown> = { query, servico, nivel, fingerprint };
    if (template) corpo.template = template;
    if (runUrl) corpo.run_url = runUrl;
    if (branch) corpo.branch = branch;
    return this.postJson(`${this.base}/v1/search`, corpo);
  }
  /** Consulta de contexto para o card do agente: SEM fingerprint de propósito —
   * com ele, um miss faria o MS3 reincrementar o órfão no MS5. Espelha
   * `ms3.buscar` do curador. */
  buscarContexto(query: string, servico: string | null, nivel: string | null) {
    return this.postJson(`${this.base}/v1/search`, { query, servico, nivel });
  }
  info() { return this.getJson(`${this.base}/v1/info`, {}); }
  listarBase(limit: number, offset: number, q?: string) {
    const params: Record<string, unknown> = { limit, offset };
    if (q) params.q = q;
    return this.getJson(`${this.base}/v1/documents`, { params });
  }
  async excluirBase(docId: number): Promise<void> { await this.send('DELETE', `${this.base}/v1/documents/${docId}`); }
}
