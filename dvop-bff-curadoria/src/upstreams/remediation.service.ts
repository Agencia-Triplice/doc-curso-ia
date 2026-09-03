import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';

@Injectable()
export class RemediationService extends UpstreamClient {
  label = 'remediation (MS 8)';
  private readonly base: string;
  constructor(@Inject(APP_CONFIG) cfg: CuradoriaConfig) {
    super(cfg.requestTimeout * 1000);
    this.base = cfg.ms8Url.replace(/\/+$/, '');
  }
  get enabled(): boolean { return Boolean(this.base); }

  listarRemediacoes() { return this.getJson(`${this.base}/v1/remediacoes`, {}); }

  obterRemediacao(id: string) {
    // 404 do MS 8 (não catalogada) → UpstreamError(404) propagada — sem
    // catch aqui; a tradução 404→400 é feita no controller de elegibilidade
    return this.getJson(`${this.base}/v1/remediacoes/${id}`, {});
  }

  // ---- credencial de escrita armada em tempo de execução ----
  // O PAT só transita daqui para o MS 8; a resposta das três rotas devolve
  // apenas o estado (presente/origem/login), nunca o token.

  obterCredencial() {
    return this.getJson(`${this.base}/v1/credencial`, {});
  }

  armarCredencial(token: string) {
    return this.putJson(`${this.base}/v1/credencial`, { token });
  }

  async desarmarCredencial() {
    const res = await this.send('DELETE', `${this.base}/v1/credencial`, {});
    return res.json();
  }

  // ---- PR de remediação (aplicar/fechar) e leitura de arquivo no repo ----

  aplicarPr(pedido: unknown) {
    return this.postJson(`${this.base}/v1/prs/aplicar`, pedido);
  }

  async fecharPr(fingerprint: string): Promise<void> {
    await this.send('DELETE', `${this.base}/v1/prs/${encodeURIComponent(fingerprint)}`, {});
  }

  lerArquivoRepo(servico: string, path: string) {
    return this.getJson(`${this.base}/v1/repo/arquivo`, { params: { servico, path } });
  }

  listarBranchesRepo(servico: string) {
    return this.getJson(`${this.base}/v1/repo/branches`, { params: { servico } });
  }

  // ---- catálogo gravável (remediações criadas pela tela) ----

  criarRemediacao(payload: unknown) {
    return this.postJson(`${this.base}/v1/remediacoes`, payload);
  }

  async excluirRemediacao(id: string): Promise<void> {
    await this.send('DELETE', `${this.base}/v1/remediacoes/${encodeURIComponent(id)}`, {});
  }
}
