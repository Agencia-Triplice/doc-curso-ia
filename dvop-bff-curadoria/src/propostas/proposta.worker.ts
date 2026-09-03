/**
 * Worker de geração de proposta de PR via AgentiX — clone estrutural de
 * `curador.worker.ts` (mesmo ritual de lifecycle/loop/polling), trocando o
 * "achar trabalho" (órfãos sem rascunho) por linhas `PropostaStore` em estado
 * `gerando` (casos que a curadoria decidiu levar a PR).
 *
 * A cada ciclo: lê o conteúdo atual dos arquivos candidatos no repo (MS 8),
 * invoca o entity de proposta do Agentix com o contexto (assinatura/solução/
 * serviço/arquivos), aguarda a sessão concluir, decodifica a proposta e
 * confere o teto de escopo (arquivos/linhas) antes de marcar `pronta`. Falha
 * em qualquer etapa marca `erro_geracao` com o motivo — a linha nunca fica
 * presa em `gerando` por uma sessão que terminou (sucesso ou erro).
 */

import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { logJson } from '../common/json-logger';
import { APP_CONFIG, CuradoriaConfig } from '../config/env';
import { AgentixService } from '../agentix/agentix.service';
import { RemediationService } from '../upstreams/remediation.service';
import { ESTADOS_EXECUTANDO } from '../curador/curador.worker';
import { PropostaStore, PropostaRow } from './proposta-store.service';
import {
  decodificarProposta,
  dentroDoTeto,
  referenciasDeArquivo,
  ArquivoComAtual,
} from './proposta-decode';

// polling da sessão: mesma referência do curador (3 s x 60 = 180 s)
export const POLL_INTERVALO = 3;
export const POLL_MAX = 60;

// Estados de PAUSA por HITL: o entity de proposta pode parar no meio da geração
// aguardando decisão humana. O sim unificado devolve `BLOCKED`; a plataforma
// AgentiX real devolve `WAITING_HITL`. Em ambos, o worker CONDUZ a pausa (lista
// e resolve os requerimentos) em vez de tratar como falha.
export const ESTADOS_HITL = new Set(['BLOCKED', 'WAITING_HITL']);
// Teto anti-loop: quantas pausas HITL o worker resolve numa mesma sessão antes de
// desistir (evita ficar preso num BLOCKED que nunca avança).
export const MAX_RESOLUCOES_HITL = 5;

export const BACKOFF_TETO = 600; // intervalo máximo entre ciclos quando o Agentix falha
export const LOTE = 5; // teto de linhas `gerando` processadas por ciclo (sem campo de cfg dedicado)

// slug owner/repo exigido pelo MS8 — mesmo formato usado na validação de `servico`.
const SLUG_SERVICO = /^[^/\s]+\/[^/\s]+$/;

interface CandidatoAtual {
  path: string;
  conteudo_atual: string;
  existe?: boolean;
  sha?: string;
}

@Injectable()
export class PropostaWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly intervalo: number;
  intervaloAtual: number;
  private readonly lote = LOTE;

  private parado = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly sleepPendentes = new Map<NodeJS.Timeout, () => void>();

  constructor(
    private readonly store: PropostaStore,
    private readonly ms8: RemediationService,
    private readonly agentix: AgentixService,
    @Inject(APP_CONFIG) private readonly cfg: CuradoriaConfig,
  ) {
    this.intervalo = cfg.propostaIntervalo;
    this.intervaloAtual = cfg.propostaIntervalo;
  }

  /** Fonte única de habilitação — mesmo gate do curador (sem Agentix, não há
   * quem gere a proposta). */
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

  /** Loop auto-agendado com setTimeout recursivo (honra o backoff dinâmico). */
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
      logJson('error', 'proposta: ciclo falhou de forma inesperada', { erro: String(e) });
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

  /** Um ciclo: lote de linhas `gerando` → `processarUma` cada. Uma linha que
   * lança não derruba as demais nem o loop — logada e pulada (retry no
   * próximo ciclo, a linha permanece em `gerando`). */
  async rodarCiclo(): Promise<void> {
    let rows: PropostaRow[];
    try {
      rows = this.store.listByEstado('gerando', this.lote);
    } catch (e) {
      logJson('error', 'proposta: listagem de propostas em geração falhou', { erro: String(e) });
      this.intervaloAtual = Math.min(this.intervaloAtual * 2, BACKOFF_TETO);
      return;
    }
    let houveFalha = false;
    for (const row of rows) {
      try {
        await this.processarUma(row);
      } catch (e) {
        houveFalha = true;
        logJson('error', 'proposta: processamento de uma linha falhou', {
          fingerprint: row.fingerprint,
          erro: String(e),
        });
      }
    }
    this.intervaloAtual = houveFalha ? Math.min(this.intervaloAtual * 2, BACKOFF_TETO) : this.intervalo;
  }

  /** Uma linha `gerando`: lê os candidatos no repo, invoca o Agentix, aguarda
   * a sessão e decide `pronta` ou `erro_geracao`. Exceções de upstream (MS 8/
   * Agentix) propagam para o chamador — `rodarCiclo` as loga e segue o lote. */
  async processarUma(row: PropostaRow): Promise<void> {
    const fingerprint = row.fingerprint;
    if (!row.servico || !SLUG_SERVICO.test(row.servico)) {
      this.store.atualizar(
        fingerprint,
        { estado: 'erro_geracao', motivo: 'serviço inválido (esperado owner/repo)' },
        this.agora(),
      );
      logJson('warn', 'proposta: serviço inválido, geração abortada', {
        fingerprint,
        servico: row.servico,
      });
      return;
    }
    let paths: string[];
    try {
      paths = JSON.parse(row.paths_json ?? '[]');
    } catch {
      paths = [];
    }

    const candidatos: CandidatoAtual[] = [];
    for (const path of paths) {
      const resp = await this.ms8.lerArquivoRepo(row.servico ?? '', path);
      candidatos.push({
        path,
        conteudo_atual: String(resp.conteudo ?? ''),
        existe: resp.existe,
        sha: resp.sha,
      });
    }

    const modoAgente = !!(row.instrucao && row.instrucao.trim());
    // Em modo agente, um candidato citado na instrução que AINDA NÃO existe no
    // repo é enviado mesmo assim (conteúdo vazio, existe:false) para o agente
    // poder CRIÁ-LO. Candidatos inexistentes vindos só dos manifestos padrão
    // continuam descartados — não inventar manifesto que o repo não tem.
    const nomeadosNaInstrucao = new Set(referenciasDeArquivo(row.instrucao ?? undefined));
    const enviados = modoAgente
      ? candidatos.filter((c) => c.existe !== false || nomeadosNaInstrucao.has(c.path))
      : candidatos;

    const payload = [
      { key: 'assinatura', value: row.assinatura ?? '' },
      { key: 'solucao', value: row.solucao ?? '' },
      { key: 'servico', value: row.servico ?? '' },
      { key: 'instrucao', value: row.instrucao ?? '' },
      { key: 'arquivos', value: JSON.stringify(enviados) },
    ];
    const sessaoId = await this.agentix.invocarComEntidade(this.cfg.agentixPrEntityName, payload);

    const sessao = await this.aguardar(sessaoId);
    if (sessao == null || String(sessao.state ?? '').toUpperCase() !== 'DONE') {
      const estado = sessao == null ? 'timeout' : String(sessao.state ?? 'desconhecido');
      this.marcarErro(fingerprint, `sessão ${estado}`, sessaoId);
      return;
    }

    const decoded = decodificarProposta(sessao.result);
    if (decoded === null) {
      this.marcarErro(fingerprint, 'resposta inválida', sessaoId);
      return;
    }

    if (decoded.aplica === false) {
      this.store.atualizar(
        fingerprint,
        {
          estado: 'nao_aplicavel',
          motivo: decoded.resumo || 'o agente considerou a remediação inaplicável a este repositório',
          session_id: sessaoId,
        },
        this.agora(),
      );
      logJson('info', 'proposta: remediação inaplicável', { fingerprint });
      return;
    }

    const atuaisPorPath = new Map(candidatos.map((c) => [c.path, c.conteudo_atual]));
    const merged: ArquivoComAtual[] = decoded.arquivos.map((a) => ({
      path: a.path,
      conteudo_atual: atuaisPorPath.get(a.path) ?? '',
      // exclusão: conteúdo novo vazio → o diff conta como remoção total e o
      // executor chama o DELETE em vez do PUT. Criar/editar preserva o conteúdo.
      conteudo_novo: a.operacao === 'excluir' ? '' : a.conteudo_novo,
      operacao: a.operacao,
    }));

    const teto = dentroDoTeto(merged, this.cfg.propostaMaxArquivos, this.cfg.propostaMaxLinhasDiff);
    if (!teto.ok) {
      this.marcarErro(
        fingerprint,
        `teto de escopo excedido (arquivos=${teto.nArquivos}, linhas=${teto.nLinhas})`,
        sessaoId,
      );
      return;
    }

    this.store.atualizar(
      fingerprint,
      {
        estado: 'pronta',
        resumo: decoded.resumo,
        titulo_pr: decoded.titulo,
        corpo_pr: decoded.corpo,
        arquivos_json: JSON.stringify(merged),
        n_arquivos: teto.nArquivos,
        n_linhas_diff: teto.nLinhas,
        session_id: sessaoId,
      },
      this.agora(),
    );
    logJson('info', 'proposta: proposta pronta', { fingerprint, nArquivos: teto.nArquivos });
  }

  private marcarErro(fingerprint: string, motivo: string, sessaoId: string): void {
    this.store.atualizar(fingerprint, { estado: 'erro_geracao', motivo, session_id: sessaoId }, this.agora());
    logJson('warn', 'proposta: geração falhou', { fingerprint, motivo });
  }

  private agora(): string {
    return new Date().toISOString();
  }

  /** Polling GetSession 3 s x 60; null = timeout (~180 s) — mesma ritual do
   * curador (`ESTADOS_EXECUTANDO` compartilhado). Ao ver PAUSA por HITL
   * (`BLOCKED`/`WAITING_HITL`), CONDUZ a pausa (`resolverPausa`) e segue o poll
   * até a sessão terminar — sem isso a pausa era tratada como falha
   * ("sessão WAITING_HITL"). */
  async aguardar(sessaoId: string): Promise<{ state?: string; result?: string } | null> {
    let resolucoes = 0;
    let polls = 0;
    while (polls < POLL_MAX) {
      const sessao = await this.agentix.sessao(sessaoId);
      const estado = String(sessao.state ?? '').toUpperCase();
      if (ESTADOS_EXECUTANDO.has(estado)) {
        polls += 1;
        await this.sleep(POLL_INTERVALO);
        continue;
      }
      if (ESTADOS_HITL.has(estado)) {
        // teto anti-loop: se o entity insiste em pausar, desiste devolvendo o
        // estado pausado (o chamador marca erro de geração — melhor que loop).
        if (resolucoes >= MAX_RESOLUCOES_HITL) return sessao;
        resolucoes += 1;
        const houve = await this.resolverPausa(sessaoId);
        // BLOCKED sem requerimento pendente correspondente: não há o que
        // resolver — devolve como está em vez de reconsultar em loop.
        if (!houve) return sessao;
        continue; // re-lê o estado logo após a retomada
      }
      return sessao; // terminal (DONE / FAILED / …)
    }
    return null;
  }

  /**
   * Conduz a pausa HITL da sessão de proposta: lista os requerimentos pendentes e
   * AUTO-confirma cada `confirmation`. É seguro auto-aprovar aqui: o entity `propor-pr`
   * só PROPÕE o diff (não tem ferramenta de escrita/git, não abre PR); a aprovação
   * humana de fato acontece depois, na UI da curadoria, antes de o MS8 abrir o PR.
   *
   * SÓ `confirmation` é auto-resolvível — é o único tipo que o propor-pr emite e o
   * único que o contrato real resolve sem dados extras. `external_execution` exigiria
   * um `result` (que a geração de proposta não produz) e daria 400; `user_input`/
   * `user_feedback` exigiriam `fields`. Nesses casos NÃO resolvemos: a sessão segue
   * pausada → o chamador marca erro de geração (honesto, melhor que um resolve inválido).
   *
   * Devolve `true` se auto-confirmou ao menos um requerimento; `false` se não havia
   * nenhum pendente OU nenhum era `confirmation`.
   */
  async resolverPausa(sessaoId: string): Promise<boolean> {
    const pendentes = await this.agentix.listarHitl(sessaoId);
    if (pendentes.length === 0) {
      logJson('warn', 'proposta: sessão pausada em HITL sem requerimento pendente', { sessaoId });
      return false;
    }
    let resolvidos = 0;
    for (const req of pendentes) {
      const tipo = String(req.requirement_type ?? '').toLowerCase();
      if (tipo !== 'confirmation') {
        logJson('warn', 'proposta: requerimento HITL não auto-resolvível (só confirmation)', {
          sessaoId,
          requirementId: req.requirement_id,
          tipo: req.requirement_type,
        });
        continue;
      }
      await this.agentix.resolverHitl(req.requirement_id, {
        action: 'confirm',
        note: 'aprovação automática da curadoria (a aprovação humana ocorre na UI, antes de o PR ser aberto)',
      });
      resolvidos += 1;
      logJson('info', 'proposta: pausa HITL resolvida', {
        sessaoId,
        requirementId: req.requirement_id,
        tipo: req.requirement_type,
        acao: 'confirm',
      });
    }
    return resolvidos > 0;
  }
}
