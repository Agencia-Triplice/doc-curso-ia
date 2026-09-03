import { rotaLabel, traceIdDoTraceparent } from '../src/common/route-label';

describe('rotaLabel', () => {
  it('mapeia paths com params para o template atual', () => {
    expect(rotaLabel('DELETE', '/api/base/42')).toBe('/api/base/{doc_id}');
    expect(rotaLabel('POST', '/api/fila/abc123/aprovar')).toBe('/api/fila/{fingerprint}/aprovar');
    expect(rotaLabel('GET', '/api/agente/sessao/s1/logs')).toBe('/api/agente/sessao/{sessao_id}/logs');
    expect(rotaLabel('GET', '/api/requests/deadbeef')).toBe('/api/requests/{digest}');
  });
  it('paths estáticos passam intactos', () => {
    expect(rotaLabel('GET', '/api/logs')).toBe('/api/logs');
    expect(rotaLabel('GET', '/health/live')).toBe('/health/live');
  });
  it('não-casada → nao_mapeada', () => {
    expect(rotaLabel('GET', '/qualquer/coisa')).toBe('nao_mapeada');
  });
});

describe('traceIdDoTraceparent', () => {
  it('sem header → null', () => {
    expect(traceIdDoTraceparent(undefined)).toBeNull();
  });
  it('header válido (W3C traceparent) → devolve o trace-id', () => {
    expect(traceIdDoTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'))
      .toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
  it('header com espaços nas bordas é aparado antes de validar', () => {
    expect(traceIdDoTraceparent('  00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01  '))
      .toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
  it('número de segmentos diferente de 4 → null', () => {
    expect(traceIdDoTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7')).toBeNull();
  });
  it('segmento com tamanho errado → null', () => {
    expect(traceIdDoTraceparent('0-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
  });
  it('caractere não-hex em algum segmento → null', () => {
    expect(traceIdDoTraceparent('0g-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
  });
  it('trace-id todo-zero → null', () => {
    expect(traceIdDoTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull();
  });
});
