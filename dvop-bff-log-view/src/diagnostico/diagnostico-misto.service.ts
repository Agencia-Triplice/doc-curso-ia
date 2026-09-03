import { HttpException, Injectable } from '@nestjs/common';
import { UpstreamError } from '../common/upstream-error';
import { AgentixService } from '../agentix/agentix.service';
import { TriagemService, TETO_LINKS_ERRO } from '../agentix/triagem.service';
import { McpGithubService } from '../upstreams/mcp-github.service';
import { DiagnosticoService } from './diagnostico.service';
import { extrairLinks, ehLinkActions, ehLinkJob } from './extrair-links';

export interface MistoIn { message: string; github_token?: string; }

const CURADOS = new Set(['cache_exato', 'cache_aproximado']);
const MSG_MCPGH_503 = 'importação indisponível: configure LOG_BFF_MCPGH_URL';

/**
 * Escada da spec: regex extrai as URLs; caso simples (0 links, ou exatamente 1
 * link de Actions) segue direto; ambíguo (2+ links, ou ≥1 não-Actions) passa
 * pela triagem do Agentix com fallback determinístico. Cada link papel=erro
 * vira uma importação (mcp-github); texto de erro vai ao DiagnosticoService.
 * Falha de um item não derruba a resposta (resultado parcial, erro por item).
 */
@Injectable()
export class DiagnosticoMistoService {
  constructor(
    private readonly diag: DiagnosticoService,
    private readonly mcpgh: McpGithubService,
    private readonly triagem: TriagemService,
    private readonly agentix: AgentixService,
  ) {}

  async diagnosticar(p: MistoIn): Promise<Record<string, unknown>> {
    const ext = extrairLinks(p.message);
    const ambiguo = ext.actions.length + ext.outras.length >= 2 || ext.outras.length >= 1;

    // fallback determinístico (também é o caminho do caso simples)
    let usada = false;
    let intencao = 'diagnosticar';
    let linksErro = ext.actions.slice(0, TETO_LINKS_ERRO);
    let linksReferencia = [...ext.actions.slice(TETO_LINKS_ERRO), ...ext.outras];
    let textoErro = ext.actions.length === 0 ? ext.texto : '';
    let contexto = textoErro ? '' : ext.texto;

    if (ambiguo) {
      // capturado ANTES da triagem: se ela vier sem nada acionável mas o
      // determinístico tinha achado algo, a triagem é descartada (ver abaixo)
      const deterministicoAcionavel = linksErro.length > 0 || textoErro !== '';
      const t = await this.triagem.triar(p.message);
      if (t) {
        const linksErroT = t.links.filter((l) => l.papel === 'erro').map((l) => l.url);
        const textoErroT = t.erro_texto.trim();
        const triagemAcionavel = linksErroT.length > 0 || textoErroT !== '';
        // triagem sem item acionável (sem link erro e sem erro_texto) enquanto o
        // determinístico achou algo → descartada, segue como se triar() tivesse
        // devolvido null (fallback determinístico, triagem.usada=false)
        if (triagemAcionavel || !deterministicoAcionavel) {
          usada = true;
          intencao = t.intencao;
          linksErro = linksErroT;
          linksReferencia = t.links.filter((l) => l.papel === 'referencia').map((l) => l.url);
          textoErro = textoErroT;
          contexto = t.contexto.trim() || ext.texto;
        }
      }
    }

    // sem mcp-github e sem item de texto não há o que responder: 503 honesto;
    // com item de texto junto, o link falha POR ITEM e o texto segue
    if (linksErro.length > 0 && !textoErro && !this.mcpgh.enabled) {
      throw new HttpException({ detail: MSG_MCPGH_503 }, 503);
    }

    const itens: Array<Record<string, unknown>> = [];
    for (const url of linksErro) itens.push(await this.itemDeLink(url, p.github_token));
    if (textoErro) itens.push(await this.itemDeTexto(textoErro));
    for (const url of linksReferencia) itens.push({ tipo: 'link', url, papel: 'referencia' });

    return {
      origem: 'misto',
      contexto_usuario: contexto,
      triagem: { usada, intencao },
      itens,
      agente: this.elegibilidade(itens),
    };
  }

  private async itemDeLink(url: string, githubToken?: string): Promise<Record<string, unknown>> {
    const item: Record<string, unknown> = { tipo: 'link', url, papel: 'erro' };
    if (!this.mcpgh.enabled) return { ...item, erro: { status: 503, detail: MSG_MCPGH_503 } };
    try {
      // link de run "cru" (sem /job/<n>): pergunta antes quantos jobs falharam.
      // exatamente 1 → segue o import (como antes); 0 ou 2+ → pede o job específico
      if (ehLinkActions(url) && !ehLinkJob(url)) {
        const r = await this.mcpgh.jobsFalhos(url, githubToken ?? null);
        const jobs = Array.isArray(r.jobs_falhos) ? r.jobs_falhos : [];
        if (jobs.length !== 1) {
          return { ...item, tipo: 'precisa_job', jobs_falhos: jobs, mensagem: this.mensagemPrecisaJob(jobs.length) };
        }
      }
      const res = await this.mcpgh.importar(url, githubToken ?? null);
      return {
        ...item,
        importacao: {
          jobs_falhos: Array.isArray(res.jobs_falhos) ? res.jobs_falhos.length : 0,
          workflow: res.workflow ?? null,
          branch: res.branch ?? null,
          // primeiro job com step falho (mcp-github já pega o 1º conclusion=failure)
          passo_falho: (res?.trace?.github?.jobs ?? [])
            .find((j: any) => j?.passo_falho)?.passo_falho ?? null,
          linhas_coletadas: res.linhas_coletadas ?? null,
        },
        diagnostico: res.diagnostico ?? null,
      };
    } catch (e) {
      if (e instanceof UpstreamError) return { ...item, erro: { status: e.statusCode, detail: e.detail } };
      throw e;
    }
  }

  private mensagemPrecisaJob(n: number): string {
    if (n === 0) {
      return 'Não encontrei jobs com falha neste run. Se souber qual falhou, cole o link do job'
        + ' específico (…/job/<n>) para eu diagnosticar.';
    }
    return `Este run tem ${n} jobs com falha. Cole o link do job específico (…/job/<n>)`
      + ' para eu importar e diagnosticar o job certo.';
  }

  private async itemDeTexto(texto: string): Promise<Record<string, unknown>> {
    const item: Record<string, unknown> = { tipo: 'texto', papel: 'erro' };
    try {
      return { ...item, diagnostico: await this.diag.diagnosticar({ message: texto }) };
    } catch (e) {
      if (e instanceof UpstreamError) return { ...item, erro: { status: e.statusCode, detail: e.detail } };
      if (e instanceof HttpException) {
        const r = e.getResponse() as Record<string, unknown> | string;
        const detail = typeof r === 'object' && r !== null && 'detail' in r ? String(r.detail) : String(r);
        return { ...item, erro: { status: e.getStatus(), detail } };
      }
      throw e;
    }
  }

  private elegibilidade(itens: Array<Record<string, unknown>>): Record<string, unknown> {
    const diags = itens
      .map((i) => i.diagnostico as Record<string, unknown> | null | undefined)
      .filter((d): d is Record<string, unknown> => Boolean(d));
    if (diags.length === 0) return { elegivel: false, motivo: 'nenhum diagnóstico executado' };
    if (!diags.some((d) => !CURADOS.has(String(d.resultado)))) {
      return { elegivel: false, motivo: 'solução curada encontrada' };
    }
    if (!this.agentix.enabled) return { elegivel: false, motivo: 'agente não configurado' };
    return { elegivel: true, motivo: 'sem solução curada' };
  }
}
