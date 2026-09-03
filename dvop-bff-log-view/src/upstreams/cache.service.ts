import { Inject, Injectable } from '@nestjs/common';
import { UpstreamClient } from '../common/upstream.client';
import { UpstreamError } from '../common/upstream-error';
import { APP_CONFIG, AppConfig } from '../config/env';

@Injectable()
export class CacheService extends UpstreamClient {
  label = 'cache de soluções';
  // base de LEITURA (cache-query, réplica só-leitura): lookup e soluções.
  private readonly base: string;
  // base de ESCRITA (cache-writer/MS5): órfãos, rascunhos e prompts — rotas que a
  // réplica de leitura NÃO expõe (404). Sem CACHE_WRITER_URL, cai na base de leitura
  // (comportamento atual, sem quebrar o boot) até o config apontar o writer.
  private readonly writer: string;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    super(cfg.requestTimeout * 1000);
    this.base = cfg.cacheUrl.replace(/\/+$/, '');
    this.writer = (cfg.cacheWriterUrl || cfg.cacheUrl).replace(/\/+$/, '');
  }
  get enabled(): boolean { return Boolean(this.base); }
  /** Store de escrita (MS5) configurada — gate das operações de órfão/rascunho/prompt. */
  get writerEnabled(): boolean { return Boolean(this.writer); }
  lookup(fingerprint: string, assinatura: string) { return this.postJson(`${this.base}/v1/lookup`, { fingerprint, assinatura }); }
  listarSolucoes(limit: number) { return this.getJson(`${this.base}/v1/solucoes`, { params: { limit } }); }
  /** Contadores do MS5 (cache-writer): `{solucoes, orfaos, rascunhos, ...}`. É a
   * store aberta S2S com os dados da curadoria (a curadoria BFF fica atrás de auth),
   * usada pelos contadores do cockpit (fila=orfaos, cache=solucoes). */
  infoWriter() { return this.getJson(`${this.writer}/v1/info`, {}); }
  obterOrfao(fingerprint: string) { return this.getJson(`${this.writer}/v1/orfaos/${fingerprint}`, {}); }
  /** Cura pronta (rascunho de curadoria) direto do MS5 — a store real, sem passar
   * pela curadoria (que é UI autenticada). `{fingerprint, solucao, autor,
   * atualizado_em}`; 404 quando não há rascunho. */
  obterRascunho(fingerprint: string) { return this.getJson(`${this.writer}/v1/rascunhos/${fingerprint}`, {}); }
  /** Prompt que o curador enviou ao AgentiX, direto do MS5 — o MESMO prompt da
   * curadoria (o worker publica lá após gerar). `{fingerprint, pares, registrado_em}`;
   * 404 enquanto o curador ainda não gerou. */
  obterPrompt(fingerprint: string) { return this.getJson(`${this.writer}/v1/prompts/${fingerprint}`, {}); }
  salvarRascunho(fingerprint: string, solucao: string, autor: string | null) {
    return this.putJson(`${this.writer}/v1/rascunhos/${fingerprint}`, { solucao, autor });
  }

  /** Confirma que o órfão existe na fila antes de gravar o rascunho — o registro
   * do órfão (fluxo de diagnóstico) é fire-and-forget, então damos um poll curto
   * e limitado. `true` = presente; `false` = não confirmou no limite (o
   * CuradorWorker cura depois — self-healing). Só 404 é "ainda não"; outro erro
   * encerra o poll com `false` (best-effort). */
  async garantirOrfao(
    fingerprint: string,
    opts: { tentativas?: number; intervaloMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ): Promise<boolean> {
    const tentativas = opts.tentativas ?? 6;
    const intervaloMs = opts.intervaloMs ?? 500;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let i = 0; i < tentativas; i += 1) {
      try {
        await this.obterOrfao(fingerprint);
        return true;
      } catch (e) {
        if (e instanceof UpstreamError && e.statusCode === 404) {
          if (i < tentativas - 1) await sleep(intervaloMs);
          continue;
        }
        return false;
      }
    }
    return false;
  }
}
