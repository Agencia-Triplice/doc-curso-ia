import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';

/**
 * Cliente do gateway único do GitHub (dvop-srv-mcp-github). A credencial de
 * escrita armada pelo operador agora vive aqui — não mais no MS 8 (executor
 * de PR) — para curadoria e mcp-github compartilharem o mesmo PAT.
 *
 * Toda chamada leva o `X-Internal-Token`: o gateway está atrás do guard S2S,
 * então sem esse header a chamada nem chega à store em memória.
 */
@Injectable()
export class McpGithubService extends UpstreamClient {
  label = 'mcp-github (gateway)';
  private readonly base: string;
  private readonly headers: Record<string, string>;
  constructor(@Inject(APP_CONFIG) cfg: CuradoriaConfig) {
    super(cfg.requestTimeout * 1000);
    this.base = cfg.mcpGithubUrl.replace(/\/+$/, '');
    this.headers = cfg.internalToken ? { 'x-internal-token': cfg.internalToken } : {};
  }
  get enabled(): boolean { return Boolean(this.base); }

  obterCredencial() {
    return this.getJson(`${this.base}/v1/credencial`, { headers: this.headers });
  }

  armarCredencial(token: string) {
    return this.putJson(`${this.base}/v1/credencial`, { token }, { headers: this.headers });
  }

  async desarmarCredencial() {
    const res = await this.send('DELETE', `${this.base}/v1/credencial`, { headers: this.headers });
    return res.json();
  }
}
