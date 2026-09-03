import { MetricsService } from '../src/metrics/metrics.service';

describe('MetricsService', () => {
  it('exporta séries com nomes e buckets corretos', async () => {
    const m = new MetricsService();
    m.observarHttp('GET', '/api/logs', 200, 0.01);
    m.diagnostico('cache_exato', false);
    m.agente('aceito');
    const { body, contentType } = await m.exportar();
    expect(contentType).toContain('text/plain');
    expect(body).toContain('http_requests_total');
    expect(body).toContain('http_request_duration_seconds_bucket');
    expect(body).toContain('le="0.075"');           // bucket específico do prometheus_client
    expect(body).toContain('diagnostico_total');
    expect(body).toContain('agente_diagnostico_total');
    expect(body).toContain('http_requests_em_andamento');
  });
});
