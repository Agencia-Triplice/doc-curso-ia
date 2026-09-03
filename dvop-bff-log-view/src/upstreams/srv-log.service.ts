import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { APP_CONFIG, AppConfig } from '../config/env';

@Injectable()
export class SrvLogService extends UpstreamClient {
  label = 'serviço de logs';
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) { super(cfg.requestTimeout * 1000); }
  fetchLogs(base: string, params: Record<string, unknown>) { return this.getJson(`${base}/v1/logs`, { params }); }
  fetchStats(base: string) { return this.getJson(`${base}/v1/stats`, {}); }
  fingerprint(base: string, message: string, service?: string, level?: string) {
    const payload: Record<string, unknown> = { message };
    if (service) payload.service = service;
    if (level) payload.level = level;
    return this.postJson(`${base}/v1/fingerprint`, payload);
  }
}
