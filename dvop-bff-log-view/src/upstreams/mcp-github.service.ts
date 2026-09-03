import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { APP_CONFIG, AppConfig } from '../config/env';

@Injectable()
export class McpGithubService extends UpstreamClient {
  label = 'importador do GitHub';
  private readonly base: string;
  private readonly token: string;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) { super(cfg.requestTimeout * 1000); this.base = cfg.mcpghUrl.replace(/\/+$/, ''); this.token = cfg.mcpghToken; }
  get enabled(): boolean { return Boolean(this.base); }
  private headers(githubToken?: string | null): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (githubToken) headers['X-GitHub-Token'] = githubToken;
    return headers;
  }
  importar(url: string, githubToken?: string | null) {
    return this.postJson(`${this.base}/v1/importar`, { url }, { headers: this.headers(githubToken) });
  }
  // lê quantos jobs falharam no run SEM importar (decide 1 job → segue; 0/2+ → pede o job)
  jobsFalhos(url: string, githubToken?: string | null) {
    return this.postJson(`${this.base}/v1/jobs-falhos`, { url }, { headers: this.headers(githubToken) });
  }
}
