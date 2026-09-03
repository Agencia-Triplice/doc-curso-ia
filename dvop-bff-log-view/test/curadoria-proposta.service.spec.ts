import { CuradoriaPropostaService } from '../src/upstreams/curadoria-proposta.service';
import { loadConfig } from '../src/config/env';
import { UpstreamError } from '../src/common/upstream-error';

// loadConfig lê as vars com o prefixo LOG_BFF_ (ver helper `str` em env.ts).
const cfg = (over: Record<string, string> = {}) =>
  loadConfig({ LOG_BFF_CURADORIA_URL: 'http://cur', LOG_BFF_CURADORIA_S2S_TOKEN: 'tok', LOG_BFF_REQUEST_TIMEOUT: '10', ...over } as any);

describe('CuradoriaPropostaService', () => {
  it('enabled=true com url+token', () => {
    expect(new CuradoriaPropostaService(cfg()).enabled).toBe(true);
  });

  it('enabled=false sem token (headers vazio)', () => {
    expect(new CuradoriaPropostaService(cfg({ LOG_BFF_CURADORIA_S2S_TOKEN: '' })).enabled).toBe(false);
  });

  it('enabled=false sem url', () => {
    expect(new CuradoriaPropostaService(cfg({ LOG_BFF_CURADORIA_URL: '' })).enabled).toBe(false);
  });

  it('rejeitar: 200 → dispara DELETE (fp encodado), drena o corpo e resolve', async () => {
    const svc = new CuradoriaPropostaService(cfg());
    const text = jest.fn().mockResolvedValue('ok');
    const send = jest.fn().mockResolvedValue({ text });
    (svc as any).send = send;
    await expect(svc.rejeitar('fp 1')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith('DELETE', 'http://cur/v1/propostas/fp%201', { headers: { 'x-internal-token': 'tok' } });
    expect(text).toHaveBeenCalled();
  });

  it('rejeitar: 404 → idempotente (resolve sem lançar)', async () => {
    const svc = new CuradoriaPropostaService(cfg());
    (svc as any).send = jest.fn().mockRejectedValue(new UpstreamError(404, 'ausente'));
    await expect(svc.rejeitar('fp1')).resolves.toBeUndefined();
  });

  it('rejeitar: UpstreamError não-404 → propaga', async () => {
    const svc = new CuradoriaPropostaService(cfg());
    (svc as any).send = jest.fn().mockRejectedValue(new UpstreamError(500, 'boom'));
    await expect(svc.rejeitar('fp1')).rejects.toMatchObject({ statusCode: 500 });
  });

  it('rejeitar: erro genérico (não-UpstreamError) → propaga', async () => {
    const svc = new CuradoriaPropostaService(cfg());
    (svc as any).send = jest.fn().mockRejectedValue(new Error('net'));
    await expect(svc.rejeitar('fp1')).rejects.toThrow('net');
  });
});
