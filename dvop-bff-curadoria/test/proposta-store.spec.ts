import { PropostaStore, PropostaRow } from '../src/propostas/proposta-store.service';

describe('PropostaStore', () => {
  let store: PropostaStore;

  beforeEach(() => {
    store = new PropostaStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('criarGerando cria a linha em estado gerando', () => {
    const row = store.criarGerando(
      { fingerprint: 'fp-1', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: ['package.json'] },
      '2026-01-01T00:00:00Z',
    );
    expect(row.estado).toBe('gerando');
    expect(row.servico).toBe('org/app');
    expect(JSON.parse(row.paths_json!)).toEqual(['package.json']);
  });

  it('atualizar move para pronta com arquivos e contadores', () => {
    store.criarGerando({ fingerprint: 'fp-1', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    const row = store.atualizar(
      'fp-1',
      {
        estado: 'pronta',
        resumo: 'r',
        titulo_pr: 't',
        corpo_pr: 'c',
        arquivos_json: JSON.stringify([{ path: 'package.json', conteudo_atual: 'a', conteudo_novo: 'b' }]),
        n_arquivos: 1,
        n_linhas_diff: 2,
      },
      'now2',
    );
    expect(row.estado).toBe('pronta');
    expect(row.n_arquivos).toBe(1);
  });

  it('criarGerando reexecutado no mesmo fingerprint volta para gerando e limpa campos anteriores', () => {
    store.criarGerando({ fingerprint: 'fp-1', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    store.atualizar('fp-1', { estado: 'pronta', resumo: 'r', titulo_pr: 't' }, 'now2');
    const row = store.criarGerando(
      { fingerprint: 'fp-1', servico: 'org/app2', assinatura: 'a2', solucao: 's2', instrucao: 'i2', paths: ['a.ts', 'b.ts'] },
      'now3',
    );
    expect(row.estado).toBe('gerando');
    expect(row.servico).toBe('org/app2');
    expect(row.assinatura).toBe('a2');
    expect(row.solucao).toBe('s2');
    expect(row.instrucao).toBe('i2');
    expect(JSON.parse(row.paths_json!)).toEqual(['a.ts', 'b.ts']);
    expect(row.atualizado_em).toBe('now3');
  });

  it('get retorna null para fingerprint inexistente', () => {
    expect(store.get('nao-existe')).toBeNull();
  });

  it('get retorna a row existente', () => {
    store.criarGerando({ fingerprint: 'fp-1', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    const row = store.get('fp-1');
    expect(row).not.toBeNull();
    expect(row?.fingerprint).toBe('fp-1');
  });

  it('atualizar ignora chaves fora da lista branca (proteção contra injeção de identificador SQL)', () => {
    store.criarGerando({ fingerprint: 'fp-1', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    const patchMalicioso = { estado: 'pronta' } as Record<string, unknown>;
    patchMalicioso["estado = 'x'; DROP TABLE proposta_pr; --"] = 'y';
    const row = store.atualizar('fp-1', patchMalicioso as any, 'now2');
    expect(row.estado).toBe('pronta');
    expect(store.count()).toBe(1);
  });

  it('atualizar em fingerprint inexistente lança erro', () => {
    expect(() => store.atualizar('nao-existe', { estado: 'pronta' }, 'now')).toThrow();
  });

  it('atualizar seta aprovacao e pr_numero/pr_url', () => {
    store.criarGerando({ fingerprint: 'fp-1', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    const row = store.atualizar(
      'fp-1',
      { estado: 'aprovada', aprovado_por: 'alice', aprovado_em: 'now2', pr_numero: 42, pr_url: 'https://github.com/org/app/pull/42' },
      'now2',
    );
    expect(row.estado).toBe('aprovada');
    expect(row.aprovado_por).toBe('alice');
    expect(row.pr_numero).toBe(42);
    expect(row.pr_url).toBe('https://github.com/org/app/pull/42');
  });

  it('atualizar seta motivo (ex.: falha na geração)', () => {
    store.criarGerando({ fingerprint: 'fp-1', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    const row = store.atualizar('fp-1', { estado: 'falhou', motivo: 'timeout' }, 'now2');
    expect(row.estado).toBe('falhou');
    expect(row.motivo).toBe('timeout');
  });

  it('listByEstado filtra por estado e respeita o limit', () => {
    store.criarGerando({ fingerprint: 'fp-a', servico: 's', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 't1');
    store.criarGerando({ fingerprint: 'fp-b', servico: 's', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 't2');
    store.atualizar('fp-b', { estado: 'pronta' }, 't3');
    store.criarGerando({ fingerprint: 'fp-c', servico: 's', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 't4');
    store.atualizar('fp-c', { estado: 'pronta' }, 't5');

    const prontas = store.listByEstado('pronta', 10);
    expect(prontas.map((r: PropostaRow) => r.fingerprint).sort()).toEqual(['fp-b', 'fp-c']);

    const gerando = store.listByEstado('gerando', 10);
    expect(gerando.map((r: PropostaRow) => r.fingerprint)).toEqual(['fp-a']);

    expect(store.listByEstado('pronta', 1)).toHaveLength(1);
  });

  it('delete remove e retorna true; false quando não havia', () => {
    store.criarGerando({ fingerprint: 'fp-1', servico: 'org/app', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    expect(store.delete('fp-1')).toBe(true);
    expect(store.get('fp-1')).toBeNull();
    expect(store.delete('fp-1')).toBe(false);
  });

  it('count reflete inserts e deletes', () => {
    expect(store.count()).toBe(0);
    store.criarGerando({ fingerprint: 'fp-1', servico: 's', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    store.criarGerando({ fingerprint: 'fp-2', servico: 's', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
    expect(store.count()).toBe(2);
    store.delete('fp-1');
    expect(store.count()).toBe(1);
  });

  it('ping não lança', () => {
    expect(() => store.ping()).not.toThrow();
  });

  it('cria o diretório do arquivo quando dbPath não é :memory:', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const dir = path.join(os.tmpdir(), `proposta-store-test-${process.pid}-${process.hrtime.bigint()}`);
    const dbPath = path.join(dir, 'sub', 'propostas.db');
    expect(fs.existsSync(dir)).toBe(false);
    const fileStore = new PropostaStore(dbPath);
    try {
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
      fileStore.criarGerando({ fingerprint: 'fp-1', servico: 's', assinatura: 'a', solucao: 's', instrucao: null, paths: [] }, 'now');
      expect(fileStore.get('fp-1')).not.toBeNull();
    } finally {
      fileStore.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
