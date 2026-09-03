/**
 * Worker de curadoria automática (passo 8 v2 — MVP-2), porta fiel de
 * ms7/app/services/curador.py.
 *
 * A cada ciclo, órfãos sem rascunho ganham um rascunho de solução gerado pelo
 * group `dvop-curador` no Agentix. O contexto do MS 3 vai no payload do Invoke
 * (o agente não usa tools — sem egress novo). A aprovação humana na fila segue
 * obrigatória: o worker só preenche o rascunho (autor "IA (Agentix)").
 *
 * Tentativas são contadas em memória (o bff-curadoria é stateless): reiniciar o
 * serviço zera os contadores e um órfão que falhou ganha no máximo mais
 * `curadorMaxTentativas` tentativas — a corretude não depende disso, porque a
 * seleção usa o `tem_rascunho` anotado pelo MS 5 e o PUT do rascunho é atômico
 * lá (404 se o órfão saiu da fila durante a sessão).
 */

import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { logJson } from '../common/json-logger';
import { UpstreamError } from '../common/upstream-error';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';
import { AgentixService } from '../agentix/agentix.service';
import { MetricsService } from '../metrics/metrics.service';
import { CacheWriterService } from '../upstreams/cache-writer.service';
import { RetrievalService } from '../upstreams/retrieval.service';
import { resolverPersona } from './persona';
import { montarPayloadCurador } from './payload';
import { PromptStore } from './prompt-store.service';

export const AUTOR_IA = 'IA (Agentix)';
// `QUEUED` incluído: no contrato real a sessão NASCE em QUEUED (o invoke devolve
// status:QUEUED e o 1º GET pode ainda estar QUEUED antes de o motor pegar). Sem ele,
// o 1º poll trataria QUEUED como estado terminal desconhecido → falha espúria.
export const ESTADOS_EXECUTANDO = new Set(['CREATED', 'PENDING', 'RUNNING', 'QUEUED']);

// polling da sessão: mesma referência da doc biat (3 s x 60 = 180 s)
export const POLL_INTERVALO = 3;
export const POLL_MAX = 60;

// contexto (docs do MS 3) embutido no payload enviado ao AgentiX
export const MAX_DOC_CHARS = 1200;
export const MAX_DOCS = 3;

export const BACKOFF_TETO = 600; // intervalo máximo entre ciclos quando o Agentix falha
export const FILA_LIMIT = 500; // teto de browse da fila (contrato do MS 5)
export const MAX_SOLUCAO_CHARS = 20000; // teto do campo `solucao` no schema DraftIn do MS 5

/** MS 3 fora do ar — o órfão é pulado no ciclo sem contar tentativa. */
export class InfraIndisponivelError extends Error {
  constructor() {
    super('infra indisponível');
    this.name = 'InfraIndisponivelError';
  }
}

export interface ResumoCiclo {
  selecionados: number;
  gerados: number;
  falhas: number;
  descartados: number;
}

type Desfecho = 'gerados' | 'falhas' | 'descartados';

/** Top-N documentos como texto para o placeholder {{contexto}} do goal. */
export function formatarContexto(documentos: Array<Record<string, unknown>>): string {
  if (!documentos || documentos.length === 0) {
    return '(nenhum documento encontrado)';
  }
  const blocos: string[] = [];
  documentos.slice(0, MAX_DOCS).forEach((doc, idx) => {
    const i = idx + 1;
    let conteudo = String(doc.conteudo ?? '');
    if (conteudo.length > MAX_DOC_CHARS) {
      conteudo = conteudo.slice(0, MAX_DOC_CHARS) + ' [...]';
    }
    const titulo = doc.titulo ?? 'sem título';
    const confianca = Number(doc.confianca || 0).toFixed(2);
    blocos.push(`${i}. ${titulo} (confiança ${confianca})\n${conteudo}`);
  });
  return blocos.join('\n\n');
}

/** Replica `base64.b64decode(validate=True).decode('utf-8')`: rejeita base64
 * não-canônico e utf-8 inválido via roundtrip. */
export function b64OuNull(bruto: string): string | null {
  const texto = Buffer.from(bruto, 'base64').toString('utf-8');
  const reencodado = Buffer.from(texto, 'utf-8').toString('base64').replace(/=+$/, '');
  return reencodado === bruto.replace(/=+$/, '') ? texto : null;
}

/** Conteúdo interno de uma cerca de código markdown (```json … ``` ou ``` … ```);
 * null se não houver cerca. O LLM real (gpt-4o-mini) embrulha o JSON assim mesmo
 * quando o prompt pede "SOMENTE o JSON" — sem descascar, o JSON.parse falha. */
export function semCercaMarkdown(bruto: string): string | null {
  const m = /```[a-zA-Z0-9]*\r?\n?([\s\S]*?)```/.exec(bruto);
  return m ? m[1].trim() : null;
}

/** JSON direto, JSON em cerca markdown, ou base64→JSON (as convenções do MVP-1 +
 * a cerca do LLM real); só aceita dict com 'solucao' não-vazia — senão null. */
export function decodificarRascunho(bruto: unknown): Record<string, unknown> | null {
  if (typeof bruto !== 'string' || !bruto.trim()) {
    return null;
  }
  const candidatos: string[] = [bruto];
  const semCerca = semCercaMarkdown(bruto);
  if (semCerca !== null) {
    candidatos.push(semCerca);
  }
  const decodificado = b64OuNull(bruto.trim());
  if (decodificado !== null) {
    candidatos.push(decodificado);
  }
  for (const texto of candidatos) {
    let dados: unknown;
    try {
      dados = JSON.parse(texto);
    } catch {
      continue;
    }
    if (
      typeof dados === 'object' &&
      dados !== null &&
      !Array.isArray(dados) &&
      String((dados as Record<string, unknown>).solucao || '').trim()
    ) {
      return dados as Record<string, unknown>;
    }
  }
  return null;
}

/** Corpo do rascunho: solução + rodapé de confiança/fontes, truncado ao teto do
 * schema DraftIn.solucao do MS 5 (max_length=20000). */
export function montarRascunho(dados: Record<string, unknown>): string {
  const solucao = String(dados.solucao).trim();
  const confianca = String(dados.confianca || 'desconhecida');
  const fontes = ((dados.fontes || []) as unknown[]).map(String).filter((f) => f.trim());
  let rodape = 'Confiança: ' + confianca;
  if (fontes.length) {
    rodape += ' — Fontes: ' + fontes.join(', ');
  }
  return `${solucao}\n\n---\n${rodape}`.slice(0, MAX_SOLUCAO_CHARS);
}

@Injectable()
export class CuradorWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly intervalo: number;
  intervaloAtual: number;
  private readonly lote: number;
  private readonly maxTentativas: number;

  // memória do processo: fingerprint -> nº de tentativas.
  // (O Python guarda {tentativas, ultimo_erro}; `ultimo_erro` é write-only —
  // o `motivo` já é logado direto em registrarFalha — então só a contagem
  // importa aqui.)
  private tentativas = new Map<string, number>();

  private parado = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly sleepPendentes = new Map<NodeJS.Timeout, () => void>();

  constructor(
    private readonly ms5: CacheWriterService,
    private readonly ms3: RetrievalService,
    private readonly agentix: AgentixService,
    private readonly metrics: MetricsService,
    private readonly prompts: PromptStore,
    @Inject(APP_CONFIG) cfg: CuradoriaConfig,
  ) {
    this.intervalo = cfg.curadorIntervalo;
    this.intervaloAtual = cfg.curadorIntervalo;
    this.lote = cfg.curadorLote;
    this.maxTentativas = cfg.curadorMaxTentativas;
  }

  /** Fonte única de habilitação — espelha `self._agentix.enabled` do Python. */
  get enabled(): boolean {
    return this.agentix.enabled;
  }

  onApplicationBootstrap(): void {
    if (this.enabled) {
      this.agendarProximo();
    }
  }

  onApplicationShutdown(): void {
    this.parado = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // cancela e resolve qualquer sleep pendente (polling da sessão)
    for (const [t, resolve] of this.sleepPendentes) {
      clearTimeout(t);
      resolve();
    }
    this.sleepPendentes.clear();
  }

  /** "falhou" quando as tentativas do órfão esgotaram (badge na fila). */
  iaEstado(fingerprint: string): string | null {
    const t = this.tentativas.get(fingerprint);
    return t !== undefined && t >= this.maxTentativas ? 'falhou' : null;
  }

  /** Loop auto-agendado com setTimeout recursivo (honra o backoff dinâmico).
   * O Python dorme ANTES do 1º ciclo — aqui o 1º delay usa `intervaloAtual`
   * (== intervalo base no bootstrap). */
  private agendarProximo(): void {
    if (this.parado) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.intervaloAtual * 1000);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (this.parado) {
      return;
    }
    try {
      await this.rodarCiclo();
    } catch (e) {
      logJson('error', 'curador: ciclo falhou de forma inesperada', { erro: String(e) });
    }
    if (this.parado) {
      return;
    }
    this.agendarProximo();
  }

  /** Sleep cancelável: resolvido normalmente pelo timer, ou de imediato no
   * shutdown. */
  sleep(segundos: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.parado) {
        resolve();
        return;
      }
      const t = setTimeout(() => {
        this.sleepPendentes.delete(t);
        resolve();
      }, segundos * 1000);
      this.sleepPendentes.set(t, resolve);
    });
  }

  async rodarCiclo(): Promise<ResumoCiclo> {
    const resumo: ResumoCiclo = { selecionados: 0, gerados: 0, falhas: 0, descartados: 0 };
    let orfaos: Array<Record<string, any>>;
    try {
      orfaos = await this.ms5.listarOrfaos(FILA_LIMIT);
    } catch (e) {
      if (e instanceof UpstreamError) {
        logJson('warn', 'curador: fila indisponível', { status: e.statusCode });
        this.metrics.curadorCiclo('erro_infra');
        return resumo;
      }
      throw e;
    }
    // reconciliação: poda tentativas de órfãos que saíram da fila por outra via
    // (aprovação humana, descarte, PUT 404) — só ocorre com a listagem em mãos,
    // nunca quando o MS 5 está fora (acima).
    const presentes = new Set(orfaos.map((o) => o.fingerprint));
    this.tentativas = new Map(
      [...this.tentativas].filter(([fp]) => presentes.has(fp)),
    );
    // mais antigos primeiro; idade desconhecida (null/ausente) vai para o fim;
    // sort estável preserva a ordem do MS 5 nos empates.
    const ordenados = [...orfaos].sort((a, b) => {
      const an = a.primeiro_visto == null ? 1 : 0;
      const bn = b.primeiro_visto == null ? 1 : 0;
      if (an !== bn) {
        return an - bn;
      }
      const av = a.primeiro_visto || '';
      const bv = b.primeiro_visto || '';
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    let houveFalhaAgentix = false;
    for (const orfao of ordenados) {
      if (resumo.selecionados >= this.lote) {
        break;
      }
      const fingerprint = orfao.fingerprint;
      const t = this.tentativas.get(fingerprint) ?? 0;
      if (orfao.tem_rascunho || t >= this.maxTentativas) {
        continue;
      }
      resumo.selecionados += 1;
      try {
        const desfecho: Desfecho = await this.processar(orfao);
        resumo[desfecho] += 1;
      } catch (e) {
        if (e instanceof UpstreamError) {
          // falha do Agentix (ou do PUT no MS 5): conta tentativa e aciona o
          // backoff do ciclo.
          houveFalhaAgentix = true;
          this.registrarFalha(fingerprint, `HTTP ${e.statusCode}`);
          resumo.falhas += 1;
          continue;
        }
        if (e instanceof InfraIndisponivelError) {
          continue; // MS 3 fora: pula sem contar tentativa
        }
        throw e;
      }
    }
    this.metrics.curadorCiclo('ok');
    if (houveFalhaAgentix) {
      this.intervaloAtual = Math.min(this.intervaloAtual * 2, BACKOFF_TETO);
    } else {
      this.intervaloAtual = this.intervalo;
    }
    return resumo;
  }

  /** Um órfão: contexto → Invoke → polling → rascunho no MS 5. Devolve a chave
   * do desfecho ('gerados'|'falhas'|'descartados'). Lança InfraIndisponivelError
   * (MS 3 fora, não conta tentativa) ou UpstreamError (Agentix/MS 5, conta). */
  async processar(orfao: Record<string, any>): Promise<Desfecho> {
    const fingerprint = orfao.fingerprint;
    const contexto = await this.contexto(orfao);
    const { persona, dossieTemplate } = resolverPersona(orfao.template);
    const payload = montarPayloadCurador(orfao, contexto, persona, dossieTemplate);
    const sessaoId = await this.agentix.invocar(payload);
    const sessao = await this.aguardar(sessaoId);
    if (sessao == null || String(sessao.state ?? '').toUpperCase() !== 'DONE') {
      const estado = sessao == null ? 'timeout' : String(sessao.state);
      this.registrarFalha(fingerprint, `sessão ${estado}`);
      return 'falhas';
    }
    const dados = decodificarRascunho(sessao.result);
    if (dados === null) {
      this.registrarFalha(fingerprint, 'resultado ausente ou inválido');
      return 'falhas';
    }
    try {
      await this.ms5.salvarRascunho(fingerprint, montarRascunho(dados), AUTOR_IA);
    } catch (e) {
      if (e instanceof UpstreamError && e.statusCode === 404) {
        // órfão aprovado/descartado durante a sessão — nada a gravar
        this.metrics.curadorRascunho('descartado');
        logJson('info', 'curador: órfão saiu da fila durante a sessão', { fingerprint });
        return 'descartados';
      }
      throw e;
    }
    // registra o prompt que ACABOU de gerar este rascunho — a tela mostra o que
    // foi criado, não uma reconstrução. Best-effort: falha no store local nunca
    // desfaz o rascunho já gravado no MS 5.
    const registradoEm = new Date().toISOString();
    try {
      this.prompts.registrar(fingerprint, payload, registradoEm);
    } catch (e) {
      logJson('warn', 'curador: falha ao registrar prompt (rascunho preservado)', {
        fingerprint,
        erro: String(e),
      });
    }
    // publica o MESMO prompt na store compartilhada (MS 5) para o cockpit reexibir
    // idêntico — o cockpit é aberto e não alcança esta UI autenticada. Best-effort:
    // falha aqui nunca desfaz o rascunho já gravado (o cockpit fica em "aguardando").
    try {
      await this.ms5.salvarPrompt(fingerprint, payload);
    } catch (e) {
      logJson('warn', 'curador: falha ao publicar prompt no MS 5 (rascunho preservado)', {
        fingerprint,
        erro: String(e),
      });
    }
    this.tentativas.delete(fingerprint);
    this.metrics.curadorRascunho('gerado');
    logJson('info', 'curador: rascunho gerado', { fingerprint });
    return 'gerados';
  }

  async contexto(orfao: Record<string, any>): Promise<string> {
    if (!this.ms3.enabled) {
      return '(nenhum documento encontrado)';
    }
    let busca: Record<string, any>;
    try {
      busca = await this.ms3.buscar(orfao.assinatura, orfao.servico ?? null, orfao.nivel ?? null);
    } catch (e) {
      if (e instanceof UpstreamError) {
        logJson('warn', 'curador: retrieval indisponível — órfão adiado', {
          fingerprint: orfao.fingerprint,
          status: e.statusCode,
        });
        throw new InfraIndisponivelError();
      }
      throw e;
    }
    return formatarContexto(busca.resultados ?? []);
  }

  /** Polling GetSession 3 s x 60; null = timeout (~180 s). */
  async aguardar(
    sessaoId: string,
  ): Promise<{ state?: string; result?: string } | null> {
    for (let i = 0; i < POLL_MAX; i += 1) {
      const sessao = await this.agentix.sessao(sessaoId);
      if (ESTADOS_EXECUTANDO.has(String(sessao.state ?? '').toUpperCase())) {
        await this.sleep(POLL_INTERVALO);
        continue;
      }
      return sessao;
    }
    return null;
  }

  registrarFalha(fingerprint: string, motivo: string): void {
    const tentativas = (this.tentativas.get(fingerprint) ?? 0) + 1;
    this.tentativas.set(fingerprint, tentativas);
    this.metrics.curadorRascunho('falhou');
    logJson('warn', 'curador: tentativa falhou', { fingerprint, motivo, tentativas });
  }
}
