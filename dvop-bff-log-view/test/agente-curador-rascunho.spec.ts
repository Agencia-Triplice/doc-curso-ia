import {
  formatarContexto,
  decodificarRascunho,
  montarRascunho,
  parseCura,
  b64OuNull,
  MAX_SOLUCAO_CHARS,
} from '../src/agente-curador/rascunho';

describe('parseCura (inversa de montarRascunho)', () => {
  it('roundtrip: montarRascunho → parseCura recupera solucao/confianca/fontes', () => {
    const texto = montarRascunho({ solucao: 'faça X\ncom Y', confianca: 'alta', fontes: ['runbook', 'wiki'] });
    expect(parseCura(texto)).toEqual({ solucao: 'faça X\ncom Y', confianca: 'alta', fontes: ['runbook', 'wiki'] });
  });
  it('sem fontes → confianca preenchida, fontes vazia', () => {
    const texto = montarRascunho({ solucao: 'faça X', confianca: 'media' });
    expect(parseCura(texto)).toEqual({ solucao: 'faça X', confianca: 'media', fontes: [] });
  });
  it('texto sem rodapé (humano) → solucao inteira, confianca null, fontes vazia', () => {
    expect(parseCura('texto livre')).toEqual({ solucao: 'texto livre', confianca: null, fontes: [] });
  });
  it('não confunde um "---" no corpo da solução com o rodapé (usa o último)', () => {
    const texto = 'linha\n\n---\ndivisor no corpo\n\n---\nConfiança: baixa';
    expect(parseCura(texto)).toEqual({ solucao: 'linha\n\n---\ndivisor no corpo', confianca: 'baixa', fontes: [] });
  });
});

describe('formatarContexto', () => {
  it('lista vazia/ausente → placeholder', () => {
    expect(formatarContexto([])).toBe('(nenhum documento encontrado)');
    expect(formatarContexto(undefined as unknown as [])).toBe('(nenhum documento encontrado)');
  });
  it('doc sem título/conteúdo/confiança usa defaults (sem título, vazio, 0.00)', () => {
    expect(formatarContexto([{}])).toBe('1. sem título (confiança 0.00)\n');
  });
  it('trunca conteúdo acima de 1200 chars com sufixo " [...]"', () => {
    const out = formatarContexto([{ titulo: 'T', conteudo: 'a'.repeat(1300), confianca: 0.5 }]);
    expect(out).toBe(`1. T (confiança 0.50)\n${'a'.repeat(1200)} [...]`);
  });
  it('formata até 3 docs (1-indexado) e ignora o 4º, junção "\\n\\n"', () => {
    const docs = [
      { titulo: 'A', conteudo: 'ca', confianca: 0.9 },
      { titulo: 'B', conteudo: 'cb', confianca: 0.8 },
      { titulo: 'C', conteudo: 'cc', confianca: 0.7 },
      { titulo: 'D', conteudo: 'cd', confianca: 0.6 },
    ];
    expect(formatarContexto(docs)).toBe(
      '1. A (confiança 0.90)\nca\n\n2. B (confiança 0.80)\ncb\n\n3. C (confiança 0.70)\ncc',
    );
  });
  it('confianca 0/null vira 0.00 (via `|| 0`)', () => {
    expect(formatarContexto([{ titulo: 'X', conteudo: 'y', confianca: null }])).toBe('1. X (confiança 0.00)\ny');
  });
});

describe('b64OuNull', () => {
  it('base64 canônico de utf-8 → texto decodificado', () => {
    expect(b64OuNull(Buffer.from('olá mundo', 'utf-8').toString('base64'))).toBe('olá mundo');
  });
  it('base64 não-canônico → null', () => {
    expect(b64OuNull('{"solucao":"x"}')).toBeNull();
  });
});

describe('decodificarRascunho', () => {
  it('não-string / vazio → null', () => {
    expect(decodificarRascunho(123)).toBeNull();
    expect(decodificarRascunho(null)).toBeNull();
    expect(decodificarRascunho(undefined)).toBeNull();
    expect(decodificarRascunho('   ')).toBeNull();
  });
  it('JSON direto com solucao não-vazia → objeto', () => {
    expect(decodificarRascunho('{"solucao":"faça X","confianca":"alta"}')).toEqual({ solucao: 'faça X', confianca: 'alta' });
  });
  it('JSON em base64 → objeto', () => {
    const b64 = Buffer.from('{"solucao":"passo a passo"}', 'utf-8').toString('base64');
    expect(decodificarRascunho(b64)).toEqual({ solucao: 'passo a passo' });
  });
  it('dict sem solucao / solucao vazia → null', () => {
    expect(decodificarRascunho('{"confianca":"alta"}')).toBeNull();
    expect(decodificarRascunho('{"solucao":"   "}')).toBeNull();
  });
  it('array (não-dict) → null', () => {
    expect(decodificarRascunho('[{"solucao":"x"}]')).toBeNull();
  });
  it('texto que não é JSON nem base64→JSON válido → null', () => {
    expect(decodificarRascunho('isto não é json')).toBeNull();
  });
  it('JSON embrulhado em cerca markdown ```json → objeto', () => {
    const bruto = '```json\n{"solucao":"1. faça X\\n2. faça Y","confianca":"media","fontes":["Doc A"]}\n```';
    expect(decodificarRascunho(bruto)).toEqual({ solucao: '1. faça X\n2. faça Y', confianca: 'media', fontes: ['Doc A'] });
  });
  it('cerca ``` sem linguagem também é aceita', () => {
    expect(decodificarRascunho('```\n{"solucao":"passo único"}\n```')).toEqual({ solucao: 'passo único' });
  });
  it('array dentro de cerca → null', () => {
    expect(decodificarRascunho('```json\n[{"solucao":"x"}]\n```')).toBeNull();
  });
});

describe('montarRascunho', () => {
  it('sem fontes → solução + rodapé de confiança', () => {
    expect(montarRascunho({ solucao: '  faça X  ', confianca: 'alta' })).toBe('faça X\n\n---\nConfiança: alta');
  });
  it('com fontes → rodapé inclui as fontes (filtra vazias, aplica String)', () => {
    expect(montarRascunho({ solucao: 'X', confianca: 'média', fontes: ['a', '  ', 'b', 42] })).toBe(
      'X\n\n---\nConfiança: média — Fontes: a, b, 42',
    );
  });
  it('confianca ausente/falsy → "desconhecida"', () => {
    expect(montarRascunho({ solucao: 'X' })).toBe('X\n\n---\nConfiança: desconhecida');
  });
  it('trunca ao teto de 20000 chars', () => {
    const out = montarRascunho({ solucao: 'a'.repeat(25000), confianca: 'alta' });
    expect(out.length).toBe(MAX_SOLUCAO_CHARS);
  });
});
