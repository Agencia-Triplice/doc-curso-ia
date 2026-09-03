import { RequestAuditService, requestHash } from '../src/audit/request-audit.service';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('RequestAuditService', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  it('hash canônico estável e determinístico', () => {
    const h1 = requestHash('get', 'http://x/v1/logs', { b: 2, a: 1 });
    const h2 = requestHash('GET', 'http://x/v1/logs', { a: 1, b: 2 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
  it('hash bate byte-a-byte com o request_hash do Python (golden)', () => {
    // ground-truth: json.dumps(sort_keys=True,ensure_ascii=False,separators=(",",":")) + sha256
    expect(requestHash('GET', 'http://x/v1/logs', { limit: 50 }))
      .toBe('acd762e199de2fe6690ec82214fa2903af46a0e387d4b95e3db70a6f097e08da');
    // não-ASCII preservado literal (ensure_ascii=False), chaves ordenadas, valor coerido a str
    expect(requestHash('get', 'http://x/v1/logs', { q: 'ção', a: 1 }))
      .toBe('2b776dd2f33b40706f83916a212ffb56aea196e3a6f0da165164ba40c10ad172');
  });
  it('record incrementa contagem e get devolve a entrada', () => {
    const a = new RequestAuditService(join(dir, 'r.db'), 10000);
    const d = a.record('GET', 'http://x/v1/logs', { limit: 50 });
    a.record('GET', 'http://x/v1/logs', { limit: 50 });
    const row = a.get(d)!;
    expect(row.count).toBe(2);
    expect(a.summary()).toEqual({ total_requests: 2, unique_requests: 1 });
  });

  it('listEntries devolve as entradas ordenadas por contagem desc', () => {
    const a = new RequestAuditService(join(dir, 'list.db'), 10000);
    const d1 = a.record('GET', 'http://x/v1/logs', { limit: 1 });
    const d2 = a.record('GET', 'http://x/v1/stats', null);
    a.record('GET', 'http://x/v1/stats', null); // stats agora tem count=2
    const items = a.listEntries(10);
    expect(items.length).toBe(2);
    expect(items[0].hash).toBe(d2);
    expect(items[0].count).toBe(2);
    expect(items.some((i) => i.hash === d1)).toBe(true);
  });

  it('get devolve null quando o hash não existe', () => {
    const a = new RequestAuditService(join(dir, 'miss.db'), 10000);
    expect(a.get('nao-existe')).toBeNull();
  });
});
