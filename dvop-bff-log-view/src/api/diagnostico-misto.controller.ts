import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { DiagnosticoMistoService } from '../diagnostico/diagnostico-misto.service';
import { DiagnosticoMistoDto } from './dto/diagnostico-misto.dto';

@Controller('api')
export class DiagnosticoMistoController {
  constructor(private readonly misto: DiagnosticoMistoService) {}
  @Post('diagnostico/misto')
  @HttpCode(200)
  diagnosticoMisto(@Body() body: DiagnosticoMistoDto) {
    return this.misto.diagnosticar(body);
  }
}
