import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { UpstreamError } from '../common/upstream-error';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';
import { AgentixTokenProvider } from './agentix-token.provider';

export const AGENTIX_TOKEN_PROVIDER = Symbol('AGENTIX_TOKEN_PROVIDER');

/** Requerimento HITL pendente — o entity de proposta pode PAUSAR (hitl) no meio
 * da geração (sim: `BLOCKED`; plataforma real: `WAITING_HITL`). O worker lista e
 * resolve cada um para a sessão seguir até `DONE`. */
export interface HitlRequirement {
  requirement_id: string;
  session_id: string;
  requirement_type: string;
  requirement_data?: { message?: string; [k: string]: unknown };
  status: string;
}

@Injectable()
export class AgentixService extends UpstreamClient {
  label = 'agente Agentix';

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: CuradoriaConfig,
    @Inject(AGENTIX_TOKEN_PROVIDER) private readonly tokens: AgentixTokenProvider,
  ) {
    super(cfg.requestTimeout * 1000);
  }

  get enabled(): boolean {
    return Boolean(this.cfg.agentixUrl && this.tokens.configurado && this.cfg.agentixTenantId);
  }

  /** Recebe os pares do curador (chave/valor); o 1º par vira `payload.input` e
   * todos viram `constants` no contrato REST v2 do Agentix. */
  async invocarComEntidade(entityName: string, payload: Array<{ key: string; value: string }>): Promise<string> {
    const constants = Object.fromEntries(payload.map((p) => [p.key, p.value]));
    const input = payload[0]?.value ?? '';
    const corpo = await this.postJson(
      `${this.cfg.agentixUrl}/sessions/invoke`,
      {
        // Contrato oficial: entity_type valida com pattern ^(agent|workflow)$ — sempre
        // minúsculo. Normaliza aqui para blindar contra env mal-configurada ('AGENT'
        // seria rejeitado no real). curador/propor-pr são `kind: agent` (ver env).
        entity_type: String(this.cfg.agentixEntityType).toLowerCase(),
        entity_name: entityName,
        entity_version: this.cfg.agentixEntityVersion,
        bundle: this.cfg.agentixBundleName,
        payload: { input },
        constants,
      },
      { headers: await this.headers() },
    );
    const sessao = corpo.session_id;
    if (!sessao) throw new UpstreamError(502, `${this.label} não devolveu session_id`);
    return String(sessao);
  }

  invocar(payload: Array<{ key: string; value: string }>): Promise<string> {
    return this.invocarComEntidade(this.cfg.agentixEntityName, payload);
  }

  /** Estado + saída bruta da sessão. Lê `state` (contrato do sim unificado, que
   * só devolve `state` da 2ª consulta em diante) com fallback para `status`
   * (envelope QUEUED inicial e contrato antigo) — retrocompat + robustez. */
  async sessao(id: string): Promise<{ sessionId?: string; state?: string; result?: string }> {
    const corpo = await this.getJson(`${this.cfg.agentixUrl}/sessions/${id}`, { headers: await this.headers() });
    // Resultado: o SessionResponse real NÃO tem campo `output` — a saída final da
    // sessão DONE vem em `partial_output` (preenchido com a última entrada do
    // conversation_log). Lê `partial_output` com fallback para `output` (contrato do sim).
    return { sessionId: corpo.session_id, state: corpo.state ?? corpo.status, result: corpo.partial_output ?? corpo.output };
  }

  /** Lista os requerimentos HITL pendentes da sessão (pausa `hitl:true`). */
  async listarHitl(sessionId: string): Promise<HitlRequirement[]> {
    const corpo = await this.getJson(
      `${this.cfg.agentixUrl}/hitl?session_id=${encodeURIComponent(sessionId)}&status=pending`,
      { headers: await this.headers() },
    );
    const items = corpo.items;
    return Array.isArray(items) ? (items as HitlRequirement[]) : [];
  }

  /**
   * Resolve um requerimento HITL. `requirementId` pode ser COMPOSTO no caminho de
   * workflow (ex.: "s1:hitl-step") — o `:` é pchar LEGAL (RFC 3986) e a rota do sim
   * o aceita CRU; encodar para `%3A` cairia em 404. Encodamos tudo inseguro mas
   * restauramos o `:`. Devolve o estado da retomada (workflow resolve é síncrono).
   */
  async resolverHitl(requirementId: string, body: Record<string, unknown>): Promise<{ state: string; output: unknown }> {
    const rid = encodeURIComponent(requirementId).replace(/%3A/gi, ':');
    const corpo = await this.postJson(
      `${this.cfg.agentixUrl}/hitl/${rid}/resolve`,
      body,
      { headers: await this.headers() },
    );
    return { state: String(corpo.state ?? corpo.status ?? ''), output: corpo.output ?? null };
  }

  private async headers(): Promise<Record<string, string>> {
    return { 'x-api-key': await this.tokens.token(), 'x-tenant-id': this.cfg.agentixTenantId };
  }
}
