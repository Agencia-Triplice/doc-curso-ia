import { DiagnosticoService } from '../src/diagnostico/diagnostico.service';
import { UpstreamError } from '../src/common/upstream-error';

const cfg = { defaultSrvUrl: 'http://ms1:8000' } as any;
const fp = { fingerprint: 'fp', assinatura: 'assin', service: 'svc', level: 'ERROR' };

function make(over: Partial<any> = {}) {
  const srv = { fingerprint: jest.fn().mockResolvedValue(fp) } as any;
  const cache = { enabled: true, lookup: jest.fn().mockResolvedValue({ hit: false }) } as any;
  const retrieval = { enabled: true, search: jest.fn() } as any;
  Object.assign(srv, over.srv); Object.assign(cache, over.cache); Object.assign(retrieval, over.retrieval);
  return { s: new DiagnosticoService(srv, cache, retrieval, cfg), srv, cache, retrieval };
}

describe('DiagnosticoService', () => {
  it('cache off → 503', async () => {
    const { s } = make({ cache: { enabled: false } });
    await expect(s.diagnosticar({ message: 'x' })).rejects.toMatchObject({ status: 503 });
  });
  it('hit exato → cache_exato', async () => {
    const { s } = make({ cache: { lookup: jest.fn().mockResolvedValue({ hit: true, match: 'exact', solucao: 'S' }) } });
    expect((await s.diagnosticar({ message: 'x' })).resultado).toBe('cache_exato');
  });
  it('miss + retrieval grounded → base_conhecimento', async () => {
    const { s } = make({ retrieval: { search: jest.fn().mockResolvedValue({ grounded: true, confianca: 0.9, resultados: [] }) } });
    expect((await s.diagnosticar({ message: 'x' })).resultado).toBe('base_conhecimento');
  });
  it('miss + não-grounded → escalado', async () => {
    const { s } = make({ retrieval: { search: jest.fn().mockResolvedValue({ grounded: false, orfao_registrado: true, resultados: [] }) } });
    expect((await s.diagnosticar({ message: 'x' })).resultado).toBe('escalado');
  });

  // Coverage-gate additions
  it('hit aproximado (match !== exact) → cache_aproximado', async () => {
    const { s } = make({ cache: { lookup: jest.fn().mockResolvedValue({ hit: true, match: 'fuzzy', similarity: 0.5, solucao: 'S' }) } });
    expect((await s.diagnosticar({ message: 'x' })).resultado).toBe('cache_aproximado');
  });

  it('retrieval desabilitado → sem_solucao com detalhe correto', async () => {
    const { s } = make({ retrieval: { enabled: false } });
    const r = await s.diagnosticar({ message: 'x' });
    expect(r.resultado).toBe('sem_solucao');
    expect(r.detalhe).toBe('cache miss e retrieval desabilitado (LOG_BFF_RETRIEVAL_URL)');
  });

  it('cache.lookup falha com UpstreamError → degradado:true e segue pipeline', async () => {
    const { s } = make({
      cache: { lookup: jest.fn().mockRejectedValue(new UpstreamError(502, 'x')) },
      retrieval: { search: jest.fn().mockResolvedValue({ grounded: true, confianca: 0.9, resultados: [] }) },
    });
    const r = await s.diagnosticar({ message: 'x' });
    expect(r.degradado).toBe(true);
    expect(r.resultado).toBe('base_conhecimento');
  });

  it('retrieval.search falha com UpstreamError → sem_solucao e degradado:true', async () => {
    const { s } = make({ retrieval: { search: jest.fn().mockRejectedValue(new UpstreamError(502, 'x')) } });
    const r = await s.diagnosticar({ message: 'x' });
    expect(r.resultado).toBe('sem_solucao');
    expect(r.degradado).toBe(true);
  });

  it('cache.lookup falha com Error genérico → rejeita (rethrow)', async () => {
    const { s } = make({ cache: { lookup: jest.fn().mockRejectedValue(new Error('boom')) } });
    await expect(s.diagnosticar({ message: 'x' })).rejects.toThrow('boom');
  });

  it('retrieval.search falha com Error genérico → rejeita (rethrow)', async () => {
    const { s } = make({ retrieval: { search: jest.fn().mockRejectedValue(new Error('boom')) } });
    await expect(s.diagnosticar({ message: 'x' })).rejects.toThrow('boom');
  });

  it('service e level informados → search recebe servico/nivel do fingerprint', async () => {
    const searchMock = jest.fn().mockResolvedValue({ grounded: true, confianca: 0.9, resultados: [] });
    const { s } = make({ retrieval: { search: searchMock } });
    await s.diagnosticar({ message: 'x', service: 'svc', level: 'ERROR' });
    expect(searchMock).toHaveBeenCalledWith(fp.assinatura, fp.service, fp.level, fp.fingerprint, null, null, null);
  });

  it('template no payload → repassado ao retrieval.search; ausência vira null', async () => {
    const searchMock = jest.fn().mockResolvedValue({ grounded: false, resultados: [] });
    const { s } = make({ retrieval: { search: searchMock } });
    await s.diagnosticar({ message: 'x', template: 'srv-java' });
    expect(searchMock).toHaveBeenCalledWith(fp.assinatura, null, null, fp.fingerprint, 'srv-java', null, null);
    await s.diagnosticar({ message: 'x' });
    expect(searchMock).toHaveBeenLastCalledWith(fp.assinatura, null, null, fp.fingerprint, null, null, null);
  });

  it('origem_run.html_url no payload → repassado como run_url ao retrieval.search; ausência vira null', async () => {
    const searchMock = jest.fn().mockResolvedValue({ grounded: false, resultados: [] });
    const { s } = make({ retrieval: { search: searchMock } });
    await s.diagnosticar({ message: 'x', origem_run: { run_id: 42, html_url: 'https://run/42' } });
    expect(searchMock).toHaveBeenCalledWith(fp.assinatura, null, null, fp.fingerprint, null, 'https://run/42', null);
    await s.diagnosticar({ message: 'x' });
    expect(searchMock).toHaveBeenLastCalledWith(fp.assinatura, null, null, fp.fingerprint, null, null, null);
  });

  it('branch no payload → repassado ao retrieval.search; ausência vira null', async () => {
    const searchMock = jest.fn().mockResolvedValue({ grounded: false, resultados: [] });
    const { s } = make({ retrieval: { search: searchMock } });
    await s.diagnosticar({ message: 'x', branch: 'main' });
    expect(searchMock).toHaveBeenCalledWith(fp.assinatura, null, null, fp.fingerprint, null, null, 'main');
    await s.diagnosticar({ message: 'x' });
    expect(searchMock).toHaveBeenLastCalledWith(fp.assinatura, null, null, fp.fingerprint, null, null, null);
  });

  it('retrieval desabilitado + cache degradado → sem_solucao com degradado:true', async () => {
    const { s } = make({
      cache: { lookup: jest.fn().mockRejectedValue(new UpstreamError(502, 'x')) },
      retrieval: { enabled: false },
    });
    const r = await s.diagnosticar({ message: 'x' });
    expect(r.resultado).toBe('sem_solucao');
    expect(r.degradado).toBe(true);
  });

  it('escalado com cache degradado → degradado:true', async () => {
    const { s } = make({
      cache: { lookup: jest.fn().mockRejectedValue(new UpstreamError(502, 'x')) },
      retrieval: { search: jest.fn().mockResolvedValue({ grounded: false, resultados: [] }) },
    });
    const r = await s.diagnosticar({ message: 'x' });
    expect(r.resultado).toBe('escalado');
    expect(r.degradado).toBe(true);
  });

  it('escalado sem orfao_registrado/resultados → usa defaults (false / [])', async () => {
    const { s } = make({ retrieval: { search: jest.fn().mockResolvedValue({ grounded: false }) } });
    const r = await s.diagnosticar({ message: 'x' });
    expect(r.orfao_registrado).toBe(false);
    expect(r.documentos).toEqual([]);
  });

  it('base_conhecimento sem resultados → documentos usa default []', async () => {
    const { s } = make({ retrieval: { search: jest.fn().mockResolvedValue({ grounded: true, confianca: 0.7 }) } });
    const r = await s.diagnosticar({ message: 'x' });
    expect(r.documentos).toEqual([]);
  });

});
