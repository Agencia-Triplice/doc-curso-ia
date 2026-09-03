import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';
import { ParConstante } from '../curador/payload';

@Injectable()
export class CacheWriterService extends UpstreamClient {
  label = 'cache-writer (MS 5)';
  private readonly base: string;
  constructor(@Inject(APP_CONFIG) cfg: CuradoriaConfig) {
    super(cfg.requestTimeout * 1000);
    this.base = cfg.ms5Url.replace(/\/+$/, '');
  }
  get enabled(): boolean { return Boolean(this.base); }

  listarOrfaos(limit = 500) { return this.getJson(`${this.base}/v1/orfaos`, { params: { limit } }); }
  obterOrfao(fingerprint: string) { return this.getJson(`${this.base}/v1/orfaos/${fingerprint}`, {}); }
  async excluirOrfao(fingerprint: string): Promise<void> { await this.send('DELETE', `${this.base}/v1/orfaos/${fingerprint}`); }

  salvarRascunho(fingerprint: string, solucao: string, autor: string | null) {
    return this.putJson(`${this.base}/v1/rascunhos/${fingerprint}`, { solucao, autor });
  }
  obterRascunho(fingerprint: string) { return this.getJson(`${this.base}/v1/rascunhos/${fingerprint}`, {}); }
  async excluirRascunho(fingerprint: string): Promise<void> { await this.send('DELETE', `${this.base}/v1/rascunhos/${fingerprint}`); }

  /** Publica o prompt (pares chave/valor) que o curador enviou ao AgentiX na store
   * compartilhada (MS 5), para o cockpit (bff-log-view) reexibir o MESMO prompt sem
   * passar por esta UI autenticada. Upsert idempotente por fingerprint. */
  salvarPrompt(fingerprint: string, pares: ParConstante[]) {
    return this.putJson(`${this.base}/v1/prompts/${fingerprint}`, { pares });
  }

  criarSolucao(payload: unknown) { return this.postJson(`${this.base}/v1/solucoes`, payload); }
  listarSolucoes(limit: number) { return this.getJson(`${this.base}/v1/solucoes`, { params: { limit } }); }
  obterSolucao(fingerprint: string) { return this.getJson(`${this.base}/v1/solucoes/${fingerprint}`, {}); }
  editarSolucao(fingerprint: string, solucao: string, autor: string | null) {
    return this.putJson(`${this.base}/v1/solucoes/${fingerprint}`, { solucao, autor });
  }
  async excluirSolucao(fingerprint: string, devolver = true): Promise<void> {
    // devolver=true: o MS 5 devolve o erro à fila na mesma transação e avisa o MS 2.
    // devolver=false: exclusão permanente — o erro não volta para a fila.
    const q = devolver ? '' : '?devolver=false';
    await this.send('DELETE', `${this.base}/v1/solucoes/${fingerprint}${q}`);
  }

  info() { return this.getJson(`${this.base}/v1/info`, {}); }
}
