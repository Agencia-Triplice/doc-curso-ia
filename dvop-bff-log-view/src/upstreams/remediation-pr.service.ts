import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { UpstreamError } from '../common/upstream-error';
import { APP_CONFIG, AppConfig } from '../config/env';

export interface PrRemediacao {
  fingerprint: string; repo: string; branch: string;
  pr_numero: number; pr_url: string; estado: string;
  criado_em: string; resolvido_em: string | null;
}

/** Leitura do PR aberto pelo executor (MS 8), por fingerprint. 404 = ainda sem PR → null. */
@Injectable()
export class RemediationPrService extends UpstreamClient {
  label = 'executor de remediação';
  private readonly base: string;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    super(cfg.requestTimeout * 1000);
    this.base = cfg.remediationUrl.replace(/\/+$/, '');
  }
  get enabled(): boolean { return Boolean(this.base); }

  async prPorFingerprint(fingerprint: string): Promise<PrRemediacao | null> {
    if (!this.enabled) return null;
    try {
      return await this.getJson(`${this.base}/v1/prs/${encodeURIComponent(fingerprint)}`, {});
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) return null;
      throw e;
    }
  }
}
