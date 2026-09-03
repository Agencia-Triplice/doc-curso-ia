import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { DiagnosticoService } from '../diagnostico/diagnostico.service';
import { MetricsService } from '../metrics/metrics.service';
import { DiagnosticoDto } from './dto/diagnostico.dto';

@Controller('api')
export class DiagnosticoController {
  constructor(private readonly diag: DiagnosticoService, private readonly metrics: MetricsService) {}
  @Post('diagnostico')
  @HttpCode(200)
  async diagnostico(@Body() body: DiagnosticoDto) {
    let resultado = 'erro'; let degradado = false;
    try {
      const resp = await this.diag.diagnosticar(body);
      resultado = String(resp.resultado); degradado = Boolean(resp.degradado);
      return resp;
    } finally { this.metrics.diagnostico(resultado, degradado); }
  }
}
