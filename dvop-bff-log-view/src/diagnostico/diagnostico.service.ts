import { HttpException, Inject, Injectable } from '@nestjs/common';
import { UpstreamError } from '../common/upstream-error';
import { APP_CONFIG, AppConfig } from '../config/env';
import { SrvLogService } from '../upstreams/srv-log.service';
import { CacheService } from '../upstreams/cache.service';
import { RetrievalService } from '../upstreams/retrieval.service';
import { logJson } from '../common/json-logger';

export interface DiagnosticoIn { message: string; service?: string; level?: string; origem_run?: { run_id: number; html_url: string } | null; template?: string | null; branch?: string | null; }

@Injectable()
export class DiagnosticoService {
  constructor(
    private readonly srv: SrvLogService, private readonly cache: CacheService,
    private readonly retrieval: RetrievalService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async diagnosticar(p: DiagnosticoIn): Promise<Record<string, unknown>> {
    if (!this.cache.enabled) throw new HttpException({ detail: 'diagnóstico indisponível: configure LOG_BFF_CACHE_URL' }, 503);
    const srvBase = this.cfg.defaultSrvUrl.replace(/\/+$/, '');
    const fp: any = await this.srv.fingerprint(srvBase, p.message, p.service, p.level);
    const base = { fingerprint: fp.fingerprint, assinatura: fp.assinatura, servico: fp.service, nivel: fp.level };

    let degradado = false; let lookup: any = {};
    try { lookup = await this.cache.lookup(fp.fingerprint, fp.assinatura); }
    catch (e) { if (e instanceof UpstreamError) { logJson('warning', 'cache indisponível; segue sem cache', { status: e.statusCode }); degradado = true; } else throw e; }

    if (lookup.hit) {
      const resultado = lookup.match === 'exact' ? 'cache_exato' : 'cache_aproximado';
      return { ...base, resultado, similaridade: lookup.similarity, solucao: lookup.solucao };
    }
    if (!this.retrieval.enabled) {
      return { ...base, resultado: 'sem_solucao', detalhe: 'cache miss e retrieval desabilitado (LOG_BFF_RETRIEVAL_URL)', ...(degradado ? { degradado: true } : {}) };
    }
    let search: any;
    try { search = await this.retrieval.search(fp.assinatura, p.service ? fp.service : null, p.level ? fp.level : null, fp.fingerprint, p.template ?? null, p.origem_run?.html_url ?? null, p.branch ?? null); }
    catch (e) {
      if (e instanceof UpstreamError) { logJson('warning', 'retrieval indisponível', { status: e.statusCode }); return { ...base, resultado: 'sem_solucao', detalhe: 'cache miss e retrieval indisponível no momento', degradado: true }; }
      throw e;
    }
    if (search.grounded) return { ...base, resultado: 'base_conhecimento', confianca: search.confianca, documentos: search.resultados ?? [], ...(degradado ? { degradado: true } : {}) };
    return { ...base, resultado: 'escalado', orfao_registrado: search.orfao_registrado ?? false, confianca: search.confianca, documentos: search.resultados ?? [], ...(degradado ? { degradado: true } : {}) };
  }
}
