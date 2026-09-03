import { Body, Controller, Get, HttpCode, HttpException, Param, Post } from '@nestjs/common';
import { ReviewService } from '../upstreams/review.service';
import { AprovarDto } from './dto/aprovar.dto';

const OFF = 'fila indisponível: configure LOG_BFF_REVIEW_URL';

@Controller('api')
export class FilaController {
  constructor(private readonly review: ReviewService) {}
  @Get('fila')
  async fila() { if (!this.review.enabled) throw new HttpException({ detail: OFF }, 503); return this.review.listarFila(); }
  @Post('fila/:fp/aprovar') @HttpCode(201)
  async aprovar(@Param('fp') fp: string, @Body() b: AprovarDto) {
    if (!this.review.enabled) throw new HttpException({ detail: OFF }, 503);
    return this.review.aprovar(fp, b.solucao ?? null, b.autor ?? null, b.publicar_base);
  }
  @Post('fila/:fp/descartar') @HttpCode(204)
  async descartar(@Param('fp') fp: string) {
    if (!this.review.enabled) throw new HttpException({ detail: OFF }, 503);
    await this.review.descartar(fp);
  }
}
