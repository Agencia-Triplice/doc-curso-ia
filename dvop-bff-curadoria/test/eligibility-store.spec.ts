import { EligibilityStore, ElegibilidadeRow } from '../src/eligibility/eligibility-store.service';

const AGORA = '2026-08-03T10:00:00+00:00';

describe('EligibilityStore', () => {
  let store: EligibilityStore;

  beforeEach(() => {
    store = new EligibilityStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('upsert cria e retorna a row', () => {
    const row = store.upsert(
      {
        fingerprint: 'fp-1',
        remediacao_id: 'rem-1',
        remediacao_versao: 'v1',
        assinatura: 'assin-1',
        servico: 'srv-a',
        autor: 'alice',
      },
      '2026-01-01T00:00:00Z',
    );
    expect(row).toEqual({
      fingerprint: 'fp-1',
      remediacao_id: 'rem-1',
      remediacao_versao: 'v1',
      assinatura: 'assin-1',
      servico: 'srv-a',
      autor: 'alice',
      criado_em: '2026-01-01T00:00:00Z',
      atualizado_em: '2026-01-01T00:00:00Z',
    });
  });

  it('segundo upsert do mesmo fingerprint preserva criado_em e atualiza atualizado_em + demais campos', () => {
    store.upsert(
      {
        fingerprint: 'fp-1',
        remediacao_id: 'rem-1',
        remediacao_versao: 'v1',
        assinatura: 'assin-1',
        servico: 'srv-a',
        autor: 'alice',
      },
      '2026-01-01T00:00:00Z',
    );
    const updated = store.upsert(
      {
        fingerprint: 'fp-1',
        remediacao_id: 'rem-2',
        remediacao_versao: 'v2',
        assinatura: 'assin-2',
        servico: 'srv-b',
        autor: 'bob',
      },
      '2026-01-02T00:00:00Z',
    );
    expect(updated.criado_em).toBe('2026-01-01T00:00:00Z');
    expect(updated.atualizado_em).toBe('2026-01-02T00:00:00Z');
    expect(updated.remediacao_id).toBe('rem-2');
    expect(updated.remediacao_versao).toBe('v2');
    expect(updated.assinatura).toBe('assin-2');
    expect(updated.servico).toBe('srv-b');
    expect(updated.autor).toBe('bob');
  });

  it('get retorna a row existente', () => {
    store.upsert(
      {
        fingerprint: 'fp-1',
        remediacao_id: 'rem-1',
        remediacao_versao: 'v1',
        assinatura: 'assin-1',
      },
      '2026-01-01T00:00:00Z',
    );
    const row = store.get('fp-1');
    expect(row).not.toBeNull();
    expect(row?.fingerprint).toBe('fp-1');
  });

  it('get retorna null para fingerprint inexistente', () => {
    expect(store.get('nao-existe')).toBeNull();
  });

  it('list ordena por atualizado_em DESC', () => {
    store.upsert(
      { fingerprint: 'fp-a', remediacao_id: 'r', remediacao_versao: 'v', assinatura: 'a' },
      '2026-01-01T00:00:00Z',
    );
    store.upsert(
      { fingerprint: 'fp-b', remediacao_id: 'r', remediacao_versao: 'v', assinatura: 'a' },
      '2026-01-02T00:00:00Z',
    );
    store.upsert(
      { fingerprint: 'fp-c', remediacao_id: 'r', remediacao_versao: 'v', assinatura: 'a' },
      '2026-01-03T00:00:00Z',
    );
    const rows = store.list(10);
    expect(rows.map((r: ElegibilidadeRow) => r.fingerprint)).toEqual(['fp-c', 'fp-b', 'fp-a']);
  });

  it('list respeita o limit', () => {
    store.upsert(
      { fingerprint: 'fp-a', remediacao_id: 'r', remediacao_versao: 'v', assinatura: 'a' },
      '2026-01-01T00:00:00Z',
    );
    store.upsert(
      { fingerprint: 'fp-b', remediacao_id: 'r', remediacao_versao: 'v', assinatura: 'a' },
      '2026-01-02T00:00:00Z',
    );
    expect(store.list(1)).toHaveLength(1);
  });

  it('delete retorna true quando existia e false quando não existia mais', () => {
    store.upsert(
      { fingerprint: 'fp-1', remediacao_id: 'r', remediacao_versao: 'v', assinatura: 'a' },
      '2026-01-01T00:00:00Z',
    );
    expect(store.delete('fp-1')).toBe(true);
    expect(store.delete('fp-1')).toBe(false);
  });

  it('delete retorna false para fingerprint que nunca existiu', () => {
    expect(store.delete('fantasma')).toBe(false);
  });

  it('count reflete inserts e deletes', () => {
    expect(store.count()).toBe(0);
    store.upsert(
      { fingerprint: 'fp-1', remediacao_id: 'r', remediacao_versao: 'v', assinatura: 'a' },
      '2026-01-01T00:00:00Z',
    );
    store.upsert(
      { fingerprint: 'fp-2', remediacao_id: 'r', remediacao_versao: 'v', assinatura: 'a' },
      '2026-01-01T00:00:00Z',
    );
    expect(store.count()).toBe(2);
    store.delete('fp-1');
    expect(store.count()).toBe(1);
  });

  it('ping não lança', () => {
    expect(() => store.ping()).not.toThrow();
  });

  it('mapa devolve todos os vínculos indexados por fingerprint', () => {
    store.upsert({ fingerprint: 'fp1', remediacao_id: 'r1', remediacao_versao: '1.0.0', assinatura: 'a' }, AGORA);
    store.upsert({ fingerprint: 'fp2', remediacao_id: 'r2', remediacao_versao: '2.0.0', assinatura: 'b' }, AGORA);

    const mapa = store.mapa();

    expect(mapa.size).toBe(2);
    expect(mapa.get('fp1')?.remediacao_id).toBe('r1');
    expect(mapa.get('naoexiste')).toBeUndefined();
  });

  it('servico e autor nulos (omitidos) persistem como null', () => {
    const row = store.upsert(
      { fingerprint: 'fp-1', remediacao_id: 'r', remediacao_versao: 'v', assinatura: 'a' },
      '2026-01-01T00:00:00Z',
    );
    expect(row.servico).toBeNull();
    expect(row.autor).toBeNull();
  });

  it('cria diretório do arquivo de banco quando dbPath não é :memory:', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const dir = path.join(os.tmpdir(), `eligibility-store-test-${Date.now()}`);
    const dbPath = path.join(dir, 'sub', 'elegibilidade.db');
    expect(fs.existsSync(dir)).toBe(false);
    const fileStore = new EligibilityStore(dbPath);
    try {
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
      fileStore.upsert(
        { fingerprint: 'fp-1', remediacao_id: 'r', remediacao_versao: 'v', assinatura: 'a' },
        '2026-01-01T00:00:00Z',
      );
      expect(fileStore.get('fp-1')).not.toBeNull();
    } finally {
      fileStore.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
