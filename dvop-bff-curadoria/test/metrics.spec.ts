import { MetricsService } from '../src/metrics/metrics.service';
import { MetricsController } from '../src/metrics/metrics.controller';

describe('MetricsService', () => {
  it('exporta séries com nomes, labels e buckets corretos', async () => {
    const m = new MetricsService();
    m.observarHttp('GET', '/v1/orfaos', 200, 0.01);
    m.emAndamentoInc();
    m.emAndamentoDec();
    m.curadoria('aprovar');
    m.curadorRascunho('aceito');
    m.curadorCiclo('ok');
    m.elegibilidade('marcar_elegivel');
    const { body, contentType } = await m.exportar();
    expect(contentType).toContain('text/plain');

    // RED
    expect(body).toContain('http_requests_total');
    expect(body).toContain('http_request_duration_seconds_bucket');
    expect(body).toContain('le="0.075"');           // bucket específico do prometheus_client
    expect(body).toContain('http_requests_em_andamento');

    // counters de negócio da curadoria (nomes/labels verbatim de ms7/app/main.py)
    expect(body).toContain('curadoria_total');
    expect(body).toContain('acao="aprovar"');
    expect(body).toContain('curador_rascunhos_total');
    expect(body).toContain('curador_ciclos_total');
    expect(body).toContain('resultado="aceito"');
    expect(body).toContain('resultado="ok"');
    expect(body).toContain('elegibilidade_total');
    expect(body).toContain('acao="marcar_elegivel"');
  });
});

describe('MetricsController', () => {
  it('GET /metrics devolve o corpo e content-type do registry', async () => {
    const metrics = new MetricsService();
    metrics.curadoria('aprovar');
    const controller = new MetricsController(metrics);
    const res: any = { setHeader: jest.fn(), send: jest.fn() };
    await controller.getMetrics(res);
    expect(res.setHeader).toHaveBeenCalledWith('content-type', expect.stringContaining('text/plain'));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('curadoria_total'));
  });
});
