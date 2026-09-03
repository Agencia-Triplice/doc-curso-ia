import { Controller, Get } from '@nestjs/common';
import { RetrievalService } from '../upstreams/retrieval.service';
import { CacheService } from '../upstreams/cache.service';
import { UpstreamError } from '../common/upstream-error';

@Controller('api')
export class EstadoController {
  constructor(private readonly retrieval: RetrievalService, private readonly cache: CacheService) {}
  @Get('estado')
  async estado() {
    const res: any = { fila: null, cache: null, base: null, servicos: [] };
    // fila (órfãos pendentes) e cache (soluções) vêm do MS5 (cache-writer), a store
    // aberta S2S com os dados da curadoria — a curadoria BFF fica atrás de auth de
    // sessão e recusaria a chamada server-to-server do cockpit (401).
    if (this.cache.writerEnabled) {
      try { const i: any = await this.cache.infoWriter(); res.fila = i.orfaos ?? null; res.cache = i.solucoes ?? null; res.servicos.push({ nome: 'curadoria', ok: true }); }
      catch (e) { if (e instanceof UpstreamError) res.servicos.push({ nome: 'curadoria', ok: false }); else throw e; }
    }
    if (this.retrieval.enabled) {
      try { const i: any = await this.retrieval.info(); res.base = i.documentos ?? null; res.servicos.push({ nome: 'base', ok: true }); }
      catch (e) { if (e instanceof UpstreamError) res.servicos.push({ nome: 'base', ok: false }); else throw e; }
    }
    return res;
  }
}
