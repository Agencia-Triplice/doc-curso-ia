import { Injectable } from '@nestjs/common';
import { Registry, Counter, Gauge, Histogram } from 'prom-client';

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly httpTotal: Counter;
  private readonly httpDur: Histogram;
  private readonly emAndamento: Gauge;
  private readonly curadoriaTotal: Counter;
  private readonly curadorRascunhosTotal: Counter;
  private readonly curadorCiclosTotal: Counter;
  private readonly elegibilidadeTotal: Counter;

  constructor() {
    this.httpTotal = new Counter({ name: 'http_requests_total', help: 'Total de requisições HTTP', labelNames: ['method', 'rota', 'status'], registers: [this.registry] });
    this.httpDur = new Histogram({ name: 'http_request_duration_seconds', help: 'Duração das requisições HTTP em segundos', labelNames: ['method', 'rota'], buckets: BUCKETS, registers: [this.registry] });
    this.emAndamento = new Gauge({ name: 'http_requests_em_andamento', help: 'Requisições HTTP em processamento agora', registers: [this.registry] });
    this.curadoriaTotal = new Counter({ name: 'curadoria_total', help: 'Ações de curadoria concluídas', labelNames: ['acao'], registers: [this.registry] });
    this.curadorRascunhosTotal = new Counter({ name: 'curador_rascunhos_total', help: 'Rascunhos do curador automático por desfecho', labelNames: ['resultado'], registers: [this.registry] });
    this.curadorCiclosTotal = new Counter({ name: 'curador_ciclos_total', help: 'Ciclos do worker curador por resultado', labelNames: ['resultado'], registers: [this.registry] });
    this.elegibilidadeTotal = new Counter({ name: 'elegibilidade_total', help: 'Ações de elegibilidade a PR concluídas', labelNames: ['acao'], registers: [this.registry] });
  }

  observarHttp(method: string, rota: string, status: number, durSeg: number): void {
    this.httpTotal.labels(method, rota, String(status)).inc();
    this.httpDur.labels(method, rota).observe(durSeg);
  }
  emAndamentoInc(): void { this.emAndamento.inc(); }
  emAndamentoDec(): void { this.emAndamento.dec(); }
  curadoria(acao: string): void { this.curadoriaTotal.labels(acao).inc(); }
  curadorRascunho(resultado: string): void { this.curadorRascunhosTotal.labels(resultado).inc(); }
  curadorCiclo(resultado: string): void { this.curadorCiclosTotal.labels(resultado).inc(); }
  elegibilidade(acao: string): void { this.elegibilidadeTotal.labels(acao).inc(); }

  async exportar(): Promise<{ body: string; contentType: string }> {
    return { body: await this.registry.metrics(), contentType: this.registry.contentType };
  }
}
