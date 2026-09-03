import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { APP_CONFIG, AppConfig } from '../config/env';
import { UpstreamError } from '../common/upstream-error';

/**
 * Orquestra o pipeline de proposta de PR da curadoria por S2S (o cockpit abre
 * o PR de remediação "direto", sem a UI da curadoria). Só a curadoria gera o
 * diff `agente` (AgentiX); o MS 8 apenas aplica. Todas as chamadas levam o
 * X-Internal-Token — a curadoria libera a rota /v1 quando o token casa com o
 * CURADORIA_BFF_S2S_TOKEN dela.
 *
 * `enabled` exige URL E token: sem qualquer um, o cockpit não oferece o botão.
 */
@Injectable()
export class CuradoriaPropostaService extends UpstreamClient {
  label = 'curadoria';
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    super(cfg.requestTimeout * 1000);
    this.base = (cfg.curadoriaUrl || '').replace(/\/+$/, '');
    this.headers = cfg.curadoriaS2sToken ? { 'x-internal-token': cfg.curadoriaS2sToken } : {};
  }

  get enabled(): boolean {
    return Boolean(this.base && this.headers['x-internal-token']);
  }

  private fp(fingerprint: string): string {
    return encodeURIComponent(fingerprint);
  }

  /** Remediações de PR que casam com o erro do caso. 404 (curadoria não conhece
   * o caso) é tratado no controller — aqui propaga. */
  aplicaveis(fingerprint: string): Promise<any> {
    return this.getJson(`${this.base}/v1/remediacoes-aplicaveis/${this.fp(fingerprint)}`, { headers: this.headers });
  }

  /** Dispara a geração da proposta (assíncrona: a linha entra em `gerando` e o
   * worker da curadoria a processa via AgentiX). */
  gerar(fingerprint: string, body: { instrucao?: string; paths?: string[] }): Promise<any> {
    return this.postJson(`${this.base}/v1/propostas/${this.fp(fingerprint)}`, body, { headers: this.headers });
  }

  /** Estado atual da proposta (para o cockpit fazer polling até `pronta`). */
  obter(fingerprint: string): Promise<any> {
    return this.getJson(`${this.base}/v1/propostas/${this.fp(fingerprint)}`, { headers: this.headers });
  }

  /** Aprova a proposta pronta → o executor abre o PR no repo do caso. */
  aprovar(fingerprint: string, body: { base?: string }): Promise<any> {
    return this.postJson(`${this.base}/v1/propostas/${this.fp(fingerprint)}/aprovar`, body, { headers: this.headers });
  }

  /** Descarta a proposta (recusa antes de abrir o PR). Proxy para o
   * DELETE /v1/propostas/:fp da curadoria. 404 = já ausente → idempotente. */
  async rejeitar(fingerprint: string): Promise<void> {
    try {
      const r = await this.send('DELETE', `${this.base}/v1/propostas/${this.fp(fingerprint)}`, { headers: this.headers });
      await r.text().catch(() => undefined);
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) return;
      throw e;
    }
  }
}
