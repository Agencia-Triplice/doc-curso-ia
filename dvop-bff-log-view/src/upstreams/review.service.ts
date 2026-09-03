import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { APP_CONFIG, AppConfig } from '../config/env';

@Injectable()
export class ReviewService extends UpstreamClient {
  label = 'fila de revisão';
  private readonly base: string;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) { super(cfg.requestTimeout * 1000); this.base = cfg.reviewUrl.replace(/\/+$/, ''); }
  get enabled(): boolean { return Boolean(this.base); }
  info() { return this.getJson(`${this.base}/v1/info`, {}); }
  listarFila() { return this.getJson(`${this.base}/v1/fila`, {}); }
  aprovar(fp: string, solucao: string | null, autor: string | null, publicarBase: boolean) {
    return this.postJson(`${this.base}/v1/fila/${fp}/aprovar`, { solucao, autor, publicar_base: publicarBase });
  }
  async descartar(fp: string): Promise<void> { await this.send('POST', `${this.base}/v1/fila/${fp}/descartar`, { body: {} }); }
}
