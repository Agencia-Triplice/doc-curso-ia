import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { UpstreamError } from '../common/upstream-error';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AgentixTokenProvider } from './agentix-token.provider';
import { ParConstante } from '../agente-curador/payload';

export const AGENTIX_TOKEN_PROVIDER = Symbol('AGENTIX_TOKEN_PROVIDER');

@Injectable()
export class AgentixService extends UpstreamClient {
  label = 'agente Agentix';
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, @Inject(AGENTIX_TOKEN_PROVIDER) private readonly tokens: AgentixTokenProvider) {
    super(cfg.requestTimeout * 1000);
  }
  get enabled(): boolean {
    return Boolean(this.cfg.agentixUrl && this.tokens.configurado && this.cfg.agentixTenantId && this.cfg.agentixBundleVersion);
  }
  async invocar(valor: string, opcoes: { payloadKey?: string; entityId?: string; entityName?: string } = {}): Promise<string> {
    const corpo = await this.postJson(`${this.cfg.agentixUrl}/sessions/invoke`, {
      // entity_type valida ^(agent|workflow)$ (minúsculo) no contrato real; blinda env.
      entity_type: String(this.cfg.agentixEntityType).toLowerCase(),
      entity_name: opcoes.entityName ?? this.cfg.agentixEntityName,
      entity_version: this.cfg.agentixEntityVersion,
      bundle: this.cfg.agentixBundleName,
      payload: { input: valor },
      constants: {},
    }, { headers: await this.headers() });
    const sessao = corpo.session_id;
    if (!sessao) throw new UpstreamError(502, `${this.label} não devolveu session_id`);
    return String(sessao);
  }
  /** Card do agente pelo pipeline do curador: os pares viram `constants` e o 1º
   * vira `payload.input`; invoca o group `dvop-curador` (entity próprio). */
  async invocarCurador(payload: ParConstante[]): Promise<string> {
    const constants = Object.fromEntries(payload.map((p) => [p.key, p.value]));
    const input = payload[0]?.value ?? '';
    const corpo = await this.postJson(`${this.cfg.agentixUrl}/sessions/invoke`, {
      // entity_type valida ^(agent|workflow)$ (minúsculo) no contrato real; blinda env.
      entity_type: String(this.cfg.agentixEntityType).toLowerCase(),
      entity_name: this.cfg.agentixCuradorEntityName,
      entity_version: this.cfg.agentixEntityVersion,
      bundle: this.cfg.agentixBundleName,
      payload: { input },
      constants,
    }, { headers: await this.headers() });
    const sessao = corpo.session_id;
    if (!sessao) throw new UpstreamError(502, `${this.label} não devolveu session_id`);
    return String(sessao);
  }
  async sessao(id: string): Promise<{ state?: string; result?: string }> {
    const corpo = await this.detalheSessao(id);
    // Contrato real: o SessionResponse tem `state` (não `status`, que só existe no
    // envelope QUEUED inicial) e a saída em `partial_output` (NÃO `output`). Lê ambos
    // com fallback para o contrato do sim.
    return { state: corpo.state ?? corpo.status, result: corpo.partial_output ?? corpo.output };
  }
  async logs(id: string): Promise<Array<{ author?: string; log?: string }>> {
    const corpo = await this.detalheSessao(id);
    return [{ author: corpo.component ?? 'agente', log: (corpo.partial_output ?? corpo.output) ?? '' }];
  }
  decodificarResultado(bruto: string | null | undefined): Record<string, unknown> | null {
    if (!bruto) return null;
    const cands = [bruto];
    try { const dec = Buffer.from(bruto, 'base64').toString('utf-8'); if (Buffer.from(dec, 'utf-8').toString('base64').replace(/=+$/, '') === bruto.replace(/=+$/, '')) cands.push(dec); } catch { /* */ }
    for (const texto of cands) {
      try { const d = JSON.parse(texto); if (d && typeof d === 'object' && !Array.isArray(d)) return d; } catch { /* */ }
    }
    return null;
  }
  private async detalheSessao(id: string): Promise<any> {
    return this.getJson(`${this.cfg.agentixUrl}/sessions/${id}`, { headers: await this.headers() });
  }
  private async headers(): Promise<Record<string, string>> {
    return { 'x-api-key': await this.tokens.token(), 'x-tenant-id': this.cfg.agentixTenantId };
  }
}
