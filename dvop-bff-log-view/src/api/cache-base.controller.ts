import { Controller, Delete, Get, HttpCode, HttpException, Param, ParseIntPipe, Query } from '@nestjs/common';
import { CacheService } from '../upstreams/cache.service';
import { RetrievalService } from '../upstreams/retrieval.service';
import { SolucoesQueryDto } from './dto/solucoes-query.dto';
import { BaseQueryDto } from './dto/base-query.dto';

@Controller('api')
export class CacheBaseController {
  constructor(private readonly cache: CacheService, private readonly retrieval: RetrievalService) {}
  @Get('solucoes')
  async solucoes(@Query() qd: SolucoesQueryDto) {
    if (!this.cache.enabled) throw new HttpException({ detail: 'cache indisponível: configure LOG_BFF_CACHE_URL' }, 503);
    return { solucoes: await this.cache.listarSolucoes(qd.limit) };
  }
  @Get('base')
  async base(@Query() qd: BaseQueryDto) {
    if (!this.retrieval.enabled) throw new HttpException({ detail: 'base indisponível: configure LOG_BFF_RETRIEVAL_URL' }, 503);
    return this.retrieval.listarBase(qd.limit, qd.offset, qd.q);
  }
  @Delete('base/:id') @HttpCode(204)
  async excluir(@Param('id', ParseIntPipe) id: number) {
    if (!this.retrieval.enabled) throw new HttpException({ detail: 'base indisponível: configure LOG_BFF_RETRIEVAL_URL' }, 503);
    await this.retrieval.excluirBase(id);
  }
}
