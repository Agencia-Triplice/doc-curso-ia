import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { UpstreamError } from '../common/upstream-error';
import { logJson } from '../common/json-logger';
import { SrvLogService } from '../upstreams/srv-log.service';
import { RetrievalService } from '../upstreams/retrieval.service';
import { CacheService } from '../upstreams/cache.service';
import { AgentixService } from '../agentix/agentix.service';
import { resolverPersona } from './persona';
import { montarPayloadCurador, ParConstante } from './payload';
import { formatarContexto, decodificarRascunho, montarRascunho, parseCura, AUTOR_IA } from './rascunho';

// QUEUED incluído: no contrato real a sessão nasce em QUEUED (1º GET pode ser QUEUED).
const EXEC = new Set(['CREATED', 'PENDING', 'RUNNING', 'QUEUED']);

export interface AgenteEntrada {
  message: string;
  service?: string;
  level?: string;
  template?: string | null;
  fingerprint?: string;
}

export interface AgenteResultado {
  sessao: string;
  estado: 'executando' | 'concluido' | 'falhou';
  diagnostico?: { solucao: unknown; confianca: unknown; fontes: unknown } | null;
  detalhe?: string;
}

export interface CuraPronta {
  solucao: string;
  confianca: string | null;
  fontes: string[];
  autor: string | null;
  atualizado_em: string | null;
}

/** O que a curadoria já produziu para este órfão, lido da store REAL (MS5). O prompt
 * é a fonte da verdade que o cockpit reexibe idêntico; `pronto` = o curador já gerou
 * e publicou o prompt (o cockpit para de esperar). */
export interface EstadoCuradoria {
  pronto: boolean;
  prompt: ParConstante[] | null;
  cura: CuraPronta | null;
  motivo?: 'sem_cura' | 'indisponivel';
}

/**
 * Análogo request-driven do CuradorWorker para o card do agente do cockpit:
 * normaliza a mensagem → busca contexto no MS3 (sem registrar órfão) → monta o
 * payload do curador → invoca o group `dvop-curador`. Quando a sessão conclui com
 * cura e o órfão já existe na fila, grava o rascunho no MS5 (best-effort) para o
 * CuradorWorker não gerar de novo.
 */
@Injectable()
export class AgenteCuradorService {
  // sessão → fingerprint (para a entrega do rascunho no GET). Estado de processo,
  // best-effort: some no restart, como as tentativas em memória do worker.
  private readonly fpDaSessao = new Map<string, string>();
  private readonly entregues = new Set<string>();

  constructor(
    private readonly srv: SrvLogService,
    private readonly retrieval: RetrievalService,
    private readonly agentix: AgentixService,
    private readonly cache: CacheService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.agentix.enabled;
  }

  /** Estado da curadoria para este órfão, para o cockpit REEXIBIR sem gerar nada.
   * Lê a store real (MS5) direto — NÃO a curadoria, que é UI atrás de auth de sessão
   * e recusaria a chamada server-to-server do cockpit. Devolve o PROMPT que o curador
   * enviou (fonte da verdade, idêntico ao da curadoria — o worker o publica no MS5 ao
   * gerar) e a CURA (parse do rascunho). `pronto` = o prompt já existe → o cockpit para
   * de esperar. Sem prompt e sem cura → `sem_cura` (aguardando o curador); MS5 fora →
   * `indisponivel`. Best-effort: nunca lança. */
  async estadoCuradoria(fingerprint: string): Promise<EstadoCuradoria> {
    if (!this.cache.writerEnabled) return { pronto: false, prompt: null, cura: null, motivo: 'indisponivel' };
    let indisponivel = false;
    const marcarIndisponivel = () => {
      indisponivel = true;
    };
    const prompt = await this.lerPrompt(fingerprint, marcarIndisponivel);
    const cura = await this.lerCura(fingerprint, marcarIndisponivel);
    if (prompt) return { pronto: true, prompt, cura };
    return { pronto: false, prompt: null, cura, motivo: indisponivel ? 'indisponivel' : 'sem_cura' };
  }

  /** Prompt do curador no MS5 (pares chave/valor). 404 = ainda não gerado → null;
   * outro erro → null + marca indisponível. */
  private async lerPrompt(fingerprint: string, onErro: () => void): Promise<ParConstante[] | null> {
    try {
      const p: any = await this.cache.obterPrompt(fingerprint);
      const pares = p?.pares;
      return Array.isArray(pares) && pares.length ? (pares as ParConstante[]) : null;
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) return null;
      logJson('warning', 'agente: falha ao consultar o prompt no MS5', { fingerprint, erro: String(e) });
      onErro();
      return null;
    }
  }

  /** Cura (rascunho) do curador no MS5. 404/vazio = sem cura → null; outro erro →
   * null + marca indisponível. Reconstrói {solucao, confianca, fontes} do texto plano. */
  private async lerCura(fingerprint: string, onErro: () => void): Promise<CuraPronta | null> {
    try {
      const rascunho: any = await this.cache.obterRascunho(fingerprint);
      if (!rascunho || !String(rascunho.solucao ?? '').trim()) return null;
      const { solucao, confianca, fontes } = parseCura(String(rascunho.solucao));
      return { solucao, confianca, fontes, autor: rascunho.autor ?? null, atualizado_em: rascunho.atualizado_em ?? null };
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) return null;
      logJson('warning', 'agente: falha ao consultar a cura no MS5', { fingerprint, erro: String(e) });
      onErro();
      return null;
    }
  }

  async iniciar(e: AgenteEntrada): Promise<{ sessao: string; prompt: ParConstante[]; degradado: boolean }> {
    const srvBase = this.cfg.defaultSrvUrl.replace(/\/+$/, '');

    // Caminho misto (órfão conhecido): monta o prompt A PARTIR do órfão do MS5 —
    // mesmos campos que o CuradorWorker usa (assinatura limpa, serviço, nível,
    // template → persona/dossiê), pra o prompt do cockpit ficar IDÊNTICO ao do
    // curador e a cura entregue ser de fato equivalente. Best-effort: se o órfão
    // não puder ser lido, cai na derivação a partir do texto (colagem crua não
    // tem órfão pra ler).
    let orfao: Record<string, any> | null = null;
    if (e.fingerprint) {
      try {
        const o: any = await this.cache.obterOrfao(e.fingerprint);
        if (o) orfao = o;
      } catch {
        /* sem órfão legível → deriva do texto abaixo */
      }
    }

    let orfaoLike: Record<string, any>;
    let assinatura: string;
    let servico: string | null;
    let nivel: string | null;
    let template: string | null | undefined;
    let fpEntrega: string;
    if (orfao) {
      orfaoLike = orfao;
      assinatura = orfao.assinatura;
      servico = orfao.servico ?? null;
      nivel = orfao.nivel ?? null;
      template = orfao.template ?? null;
      fpEntrega = orfao.fingerprint ?? (e.fingerprint as string);
    } else {
      const fp: any = await this.srv.fingerprint(srvBase, e.message, e.service, e.level);
      orfaoLike = { assinatura: fp.assinatura, servico: fp.service, nivel: fp.level };
      assinatura = fp.assinatura;
      servico = fp.service ?? null;
      nivel = fp.level ?? null;
      template = e.template;
      // sem fingerprint (colagem crua) cai no derivado da mensagem
      fpEntrega = e.fingerprint ?? fp.fingerprint;
    }

    let degradado = false;
    let docs: Array<Record<string, unknown>> = [];
    if (this.retrieval.enabled) {
      try {
        const busca: any = await this.retrieval.buscarContexto(assinatura, servico, nivel);
        docs = busca?.resultados ?? [];
      } catch (err) {
        if (err instanceof UpstreamError) {
          logJson('warning', 'agente: MS3 indisponível — segue sem contexto', { status: err.statusCode });
          degradado = true;
        } else {
          throw err;
        }
      }
    } else {
      degradado = true;
    }

    const contexto = formatarContexto(docs);
    const { persona, dossieTemplate } = resolverPersona(template);
    const prompt = montarPayloadCurador(orfaoLike, contexto, persona, dossieTemplate);

    const sessao = await this.agentix.invocarCurador(prompt);
    this.fpDaSessao.set(sessao, fpEntrega);
    return { sessao, prompt, degradado };
  }

  async resultado(sessaoId: string): Promise<AgenteResultado> {
    const info = await this.agentix.sessao(sessaoId);
    const estado = String(info.state ?? '').toUpperCase();
    if (EXEC.has(estado)) return { sessao: sessaoId, estado: 'executando' };
    if (estado === 'DONE') {
      const dados = decodificarRascunho(info.result);
      if (dados === null) {
        return { sessao: sessaoId, estado: 'concluido', diagnostico: null, detalhe: 'sessão concluída sem resultado estruturado (result não decodificável)' };
      }
      await this.entregar(sessaoId, dados);
      return {
        sessao: sessaoId,
        estado: 'concluido',
        diagnostico: { solucao: dados.solucao, confianca: dados.confianca, fontes: dados.fontes },
      };
    }
    return { sessao: sessaoId, estado: 'falhou', detalhe: `sessão terminou em ${estado || 'estado desconhecido'}` };
  }

  logs(sessaoId: string) {
    return this.agentix.logs(sessaoId);
  }

  /** Entrega da cura à curadoria (uma vez por sessão): confirma o órfão de forma
   * síncrona e grava o rascunho. Tudo best-effort — nada aqui pode derrubar a
   * resposta ao usuário. */
  private async entregar(sessaoId: string, dados: Record<string, unknown>): Promise<void> {
    const fingerprint = this.fpDaSessao.get(sessaoId);
    if (!fingerprint || this.entregues.has(sessaoId)) return;
    this.entregues.add(sessaoId);
    try {
      const ok = await this.cache.garantirOrfao(fingerprint);
      if (!ok) {
        logJson('info', 'agente: órfão não confirmado no limite — CuradorWorker cura depois', { fingerprint });
        return;
      }
      await this.cache.salvarRascunho(fingerprint, montarRascunho(dados), AUTOR_IA);
      logJson('info', 'agente: rascunho entregue à curadoria', { fingerprint });
    } catch (e) {
      logJson('warning', 'agente: falha ao entregar rascunho (best-effort)', { fingerprint, erro: String(e) });
    }
  }
}
