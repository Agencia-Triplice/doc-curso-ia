import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { ehLinkActions, extrairLinks } from '../diagnostico/extrair-links';
import { AgentixService } from './agentix.service';
import { logJson } from '../common/json-logger';

export const TETO_LINKS_ERRO = 3;

export interface TriagemLink { url: string; papel: 'erro' | 'referencia'; }
export interface Triagem {
  intencao: 'diagnosticar' | 'comparar' | 'duvida';
  links: TriagemLink[];
  erro_texto: string;
  contexto: string;
}

const INTENCOES = new Set(['diagnosticar', 'comparar', 'duvida']);
// QUEUED incluído: no contrato real a sessão nasce em QUEUED (1º GET pode ser QUEUED).
const EXECUTANDO = new Set(['CREATED', 'PENDING', 'RUNNING', 'QUEUED']);

/**
 * Valida o JSON devolvido pela triagem contra o contrato da spec. Guardrails:
 * URL precisa bater com uma URL extraída de fato da mensagem — token match via
 * extrairLinks, não substring (anti-injection: uma URL que é prefixo estrito de
 * outra URL da mensagem não cola); links duplicados (mesma URL) são deduplicados
 * (fica o papel da primeira ocorrência); papel=erro só para link de Actions (o
 * mcp-github não importa outra coisa); teto de TETO_LINKS_ERRO erros — excedente
 * vira referencia. Fora do schema → null.
 */
export function validarTriagem(bruto: unknown, mensagem: string): Triagem | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const b = bruto as Record<string, unknown>;
  if (typeof b.intencao !== 'string' || !INTENCOES.has(b.intencao)) return null;
  if (!Array.isArray(b.links)) return null;
  const extraidas = extrairLinks(mensagem);
  const urlsDaMensagem = new Set([...extraidas.actions, ...extraidas.outras]);
  const vistos = new Set<string>();
  const brutosValidos: TriagemLink[] = [];
  for (const cru of b.links) {
    if (!cru || typeof cru !== 'object') return null;
    const { url, papel } = cru as Record<string, unknown>;
    if (typeof url !== 'string' || (papel !== 'erro' && papel !== 'referencia')) return null;
    if (!urlsDaMensagem.has(url)) continue;
    if (vistos.has(url)) continue;
    vistos.add(url);
    brutosValidos.push({ url, papel });
  }
  const links: TriagemLink[] = [];
  let erros = 0;
  for (const { url, papel } of brutosValidos) {
    let p: TriagemLink['papel'] = papel;
    if (p === 'erro' && (!ehLinkActions(url) || erros >= TETO_LINKS_ERRO)) p = 'referencia';
    if (p === 'erro') erros++;
    links.push({ url, papel: p });
  }
  return {
    intencao: b.intencao as Triagem['intencao'],
    links,
    erro_texto: typeof b.erro_texto === 'string' ? b.erro_texto : '',
    contexto: typeof b.contexto === 'string' ? b.contexto : '',
  };
}

@Injectable()
export class TriagemService {
  pollMs = 1000;
  timeoutMs = 30000; // curto de propósito: é interpretação, não geração longa

  constructor(
    private readonly agentix: AgentixService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.agentix.enabled && Boolean(this.cfg.agentixTriagemEntityName);
  }

  /** null = triagem indisponível/falhou/JSON inválido → chamador usa o fallback determinístico. */
  async triar(mensagem: string): Promise<Triagem | null> {
    if (!this.enabled) return null;
    try {
      const sessao = await this.agentix.invocar(mensagem, {
        payloadKey: 'mensagem',
        entityId: this.cfg.agentixTriagemEntityId,
        entityName: this.cfg.agentixTriagemEntityName,
      });
      const inicio = Date.now();
      while (Date.now() - inicio < this.timeoutMs) {
        const info = await this.agentix.sessao(sessao);
        const estado = String(info.state ?? '').toUpperCase();
        if (estado === 'DONE') return validarTriagem(this.agentix.decodificarResultado(info.result), mensagem);
        if (!EXECUTANDO.has(estado)) return null;
        await new Promise((r) => setTimeout(r, this.pollMs));
      }
      return null;
    } catch (e) {
      logJson('warning', 'triagem indisponível; fallback determinístico', { erro: (e as Error).message });
      return null;
    }
  }
}
