import { Injectable } from '@nestjs/common';
import { Registry, Counter, Gauge, Histogram } from 'prom-client';

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly httpTotal: Counter;
  private readonly httpDur: Histogram;
  private readonly emAndamento: Gauge;
  private readonly diagTotal: Counter;
  private readonly agenteTotal: Counter;

  constructor() {
    this.httpTotal = new Counter({ name: 'http_requests_total', help: 'Total de requisições HTTP', labelNames: ['method', 'rota', 'status'], registers: [this.registry] });
    this.httpDur = new Histogram({ name: 'http_request_duration_seconds', help: 'Duração das requisições HTTP em segundos', labelNames: ['method', 'rota'], buckets: BUCKETS, registers: [this.registry] });
    this.emAndamento = new Gauge({ name: 'http_requests_em_andamento', help: 'Requisições HTTP em processamento agora', registers: [this.registry] });
    this.diagTotal = new Counter({ name: 'diagnostico_total', help: 'Diagnósticos por desfecho (erro = exceção antes do desfecho)', labelNames: ['resultado', 'degradado'], registers: [this.registry] });
    this.agenteTotal = new Counter({ name: 'agente_diagnostico_total', help: 'Disparos do agente Agentix por desfecho do Invoke', labelNames: ['resultado'], registers: [this.registry] });
  }

  observarHttp(method: string, rota: string, status: number, durSeg: number): void {
    this.httpTotal.labels(method, rota, String(status)).inc();
    this.httpDur.labels(method, rota).observe(durSeg);
  }
  emAndamentoInc(): void { this.emAndamento.inc(); }
  emAndamentoDec(): void { this.emAndamento.dec(); }
  diagnostico(resultado: string, degradado: boolean): void { this.diagTotal.labels(resultado, String(degradado)).inc(); }
  agente(resultado: string): void { this.agenteTotal.labels(resultado).inc(); }

  async exportar(): Promise<{ body: string; contentType: string }> {
    return { body: await this.registry.metrics(), contentType: this.registry.contentType };
  }
}
