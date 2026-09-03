import { Controller, Get, HttpException, Param, Query } from '@nestjs/common';
import { RequestAuditService } from '../audit/request-audit.service';
import { RequestsQueryDto } from './dto/requests-query.dto';

@Controller('api')
export class RequestsController {
  constructor(private readonly audit: RequestAuditService) {}
  @Get('requests')
  requests(@Query() qd: RequestsQueryDto) {
    return { ...this.audit.summary(), items: this.audit.listEntries(qd.limit) };
  }
  @Get('requests/:digest')
  entry(@Param('digest') digest: string) {
    const e = this.audit.get(digest);
    if (!e) throw new HttpException({ detail: `hash '${digest}' não encontrado` }, 404);
    return e;
  }
}
