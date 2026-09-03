import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}
  @Get('metrics')
  async getMetrics(@Res() res: Response): Promise<void> {
    const { body, contentType } = await this.metrics.exportar();
    res.setHeader('content-type', contentType);
    res.send(body);
  }
}
