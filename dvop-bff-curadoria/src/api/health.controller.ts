import { Controller, Get } from '@nestjs/common';
import { EligibilityStore } from '../eligibility/eligibility-store.service';

// Porta fiel de ms7/app/api/routes_health.py.
@Controller('health')
export class HealthController {
  constructor(private readonly store: EligibilityStore) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(): { status: string } {
    // o único estado local é o SQLite de elegibilidade; se estiver quebrado,
    // ping() lança e o filtro devolve 500. Indisponibilidade dos upstreams
    // (MS 5/MS 3) segue reportada por rota (502/504), não pela readiness.
    this.store.ping();
    return { status: 'ok' };
  }
}
