import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/env';
import { SrvLogService } from '../upstreams/srv-log.service';
import { RequestAuditService } from '../audit/request-audit.service';
import { validarSrc } from '../common/src-validator';
import { LogsQueryDto } from './dto/logs-query.dto';

@Controller('api')
export class LogsController {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, private readonly srv: SrvLogService, private readonly audit: RequestAuditService) {}
  @Get('logs')
  async logs(@Query() qd: LogsQueryDto, @Res({ passthrough: true }) res: Response) {
    const base = validarSrc(qd.src, this.cfg.allowedHosts);
    const filtros: Record<string, unknown> = { level: qd.level, service: qd.service, q: qd.q, since: qd.since, until: qd.until, limit: qd.limit, offset: qd.offset };
    const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== undefined && v !== null));
    const digest = this.audit.record('GET', `${base}/v1/logs`, params);
    res.setHeader('X-Srv-Request-Hash', digest);
    return this.srv.fetchLogs(base, params);
  }
  @Get('stats')
  async stats(@Query('src') src: string, @Res({ passthrough: true }) res: Response) {
    const base = validarSrc(src, this.cfg.allowedHosts);
    const digest = this.audit.record('GET', `${base}/v1/stats`, null);
    res.setHeader('X-Srv-Request-Hash', digest);
    return this.srv.fetchStats(base);
  }
}
