import { RemediationPrService } from '../src/upstreams/remediation-pr.service';
import { UpstreamError } from '../src/common/upstream-error';

const PR = {
  fingerprint: 'fp-1', repo: 'org/app', branch: 'agentix-pr-fp-1',
  pr_numero: 7, pr_url: 'http://gh/pr/7', estado: 'aberto',
  criado_em: '2026-07-16T09:00:00Z', resolvido_em: null,
};

function resp(status: number, body: unknown): Response {
  return {
    status, ok: status < 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function make(url: string) {
  return new RemediationPrService({ remediationUrl: url, requestTimeout: 10 } as any);
}

describe('RemediationPrService', () => {
  const fetchMock = jest.fn();
  beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock as any; });

  it('sem LOG_BFF_REMEDIATION_URL → disabled, retorna null sem fetch', async () => {
    const s = make('');
    expect(s.enabled).toBe(false);
    expect(await s.prPorFingerprint('fp-1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('200 → GET /v1/prs/{fp} e devolve o PR', async () => {
    fetchMock.mockResolvedValue(resp(200, PR));
    const s = make('http://ms8:8007');
    expect(await s.prPorFingerprint('fp-1')).toEqual(PR);
    expect(fetchMock.mock.calls[0][0]).toBe('http://ms8:8007/v1/prs/fp-1');
  });

  it('404 → null (ainda sem PR)', async () => {
    fetchMock.mockResolvedValue(resp(404, { detail: 'PR não encontrado' }));
    expect(await make('http://ms8:8007').prPorFingerprint('fp-x')).toBeNull();
  });

  it('5xx → propaga UpstreamError (não vira null)', async () => {
    fetchMock.mockResolvedValue(resp(500, { detail: 'boom' }));
    await expect(make('http://ms8:8007').prPorFingerprint('fp-1'))
      .rejects.toBeInstanceOf(UpstreamError);
  });

  it('barra final da url normalizada', async () => {
    fetchMock.mockResolvedValue(resp(200, PR));
    await make('http://ms8:8007/').prPorFingerprint('fp-1');
    expect(fetchMock.mock.calls[0][0]).toBe('http://ms8:8007/v1/prs/fp-1');
  });
});
