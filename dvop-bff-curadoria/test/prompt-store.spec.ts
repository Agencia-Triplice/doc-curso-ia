import { PromptStore } from '../src/curador/prompt-store.service';

const PARES = [
  { key: 'erro', value: 'sig-1' },
  { key: 'contexto', value: 'passo a passo' },
];

describe('PromptStore', () => {
  let store: PromptStore;

  beforeEach(() => {
    store = new PromptStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('registrar grava e get devolve os pares + instante', () => {
    store.registrar('fp-1', PARES, '2026-01-01T00:00:00Z');
    const reg = store.get('fp-1');
    expect(reg).toEqual({ fingerprint: 'fp-1', pares: PARES, registrado_em: '2026-01-01T00:00:00Z' });
  });

  it('get devolve null para fingerprint inexistente', () => {
    expect(store.get('nao-existe')).toBeNull();
  });

  it('registrar de novo sobrescreve pares e instante', () => {
    store.registrar('fp-1', PARES, '2026-01-01T00:00:00Z');
    const novos = [{ key: 'erro', value: 'sig-2' }];
    store.registrar('fp-1', novos, '2026-01-02T00:00:00Z');
    const reg = store.get('fp-1');
    expect(reg?.pares).toEqual(novos);
    expect(reg?.registrado_em).toBe('2026-01-02T00:00:00Z');
  });

  it('delete remove e retorna true; false quando não havia', () => {
    store.registrar('fp-1', PARES, '2026-01-01T00:00:00Z');
    expect(store.delete('fp-1')).toBe(true);
    expect(store.get('fp-1')).toBeNull();
    expect(store.delete('fp-1')).toBe(false);
  });

  it('cria o diretório do arquivo quando dbPath não é :memory:', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const dir = path.join(os.tmpdir(), `prompt-store-test-${process.pid}-${process.hrtime.bigint()}`);
    const dbPath = path.join(dir, 'sub', 'prompts.db');
    expect(fs.existsSync(dir)).toBe(false);
    const fileStore = new PromptStore(dbPath);
    try {
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
      fileStore.registrar('fp-1', PARES, '2026-01-01T00:00:00Z');
      expect(fileStore.get('fp-1')?.pares).toEqual(PARES);
    } finally {
      fileStore.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
