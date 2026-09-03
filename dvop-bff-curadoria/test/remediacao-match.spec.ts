import { assinaturaCompativelJs, casaRemediacao, compilarAssinaturaJs, remediacoesQueCasam } from '../src/propostas/remediacao-match';

const erro = { assinatura: '400 Repository does not allow updating assets', servico: 'owner/repo', template: 'bff-node' };

describe('casaRemediacao', () => {
  it('casa quando o assinatura_regex bate', () => {
    expect(casaRemediacao(erro, { aplicabilidade: { assinatura_regex: 'does not allow updating assets' } })).toBe(true);
  });
  it('(?i) inicial vira flag i: casa case-insensitive (não lança)', () => {
    const maiusc = { assinatura: '400 REPOSITORY DOES NOT ALLOW UPDATING ASSETS', servico: 'owner/repo', template: 'bff-node' };
    expect(casaRemediacao(maiusc, { aplicabilidade: { assinatura_regex: '(?i)does not allow updating assets' } })).toBe(true);
  });
  it('sem (?i) o match é case-sensitive', () => {
    const maiusc = { assinatura: 'DOES NOT ALLOW', servico: 'owner/repo', template: 'bff-node' };
    expect(casaRemediacao(maiusc, { aplicabilidade: { assinatura_regex: 'does not allow' } })).toBe(false);
  });
  it('não casa quando o regex não bate', () => {
    expect(casaRemediacao(erro, { aplicabilidade: { assinatura_regex: 'timeout' } })).toBe(false);
  });
  it('fail-closed: sem assinatura_regex nunca casa', () => {
    expect(casaRemediacao(erro, { aplicabilidade: { arquetipos: ['bff-node'] } })).toBe(false);
    expect(casaRemediacao(erro, { aplicabilidade: null })).toBe(false);
    expect(casaRemediacao(erro, {})).toBe(false);
  });
  it('AND: arquetipos presente deve conter template', () => {
    const rem = { aplicabilidade: { assinatura_regex: 'does not allow', arquetipos: ['srv-java'] } };
    expect(casaRemediacao(erro, rem)).toBe(false);
    const rem2 = { aplicabilidade: { assinatura_regex: 'does not allow', arquetipos: ['bff-node'] } };
    expect(casaRemediacao(erro, rem2)).toBe(true);
  });
  it('AND: servicos presente deve conter servico', () => {
    const rem = { aplicabilidade: { assinatura_regex: 'does not allow', servicos: ['outro/repo'] } };
    expect(casaRemediacao(erro, rem)).toBe(false);
  });
  it('assinatura ausente no erro → não casa', () => {
    expect(casaRemediacao({ servico: 'owner/repo' }, { aplicabilidade: { assinatura_regex: '.*' } })).toBe(false);
  });
  it('regex inválida no catálogo é tratada como não-casa (não lança)', () => {
    expect(casaRemediacao(erro, { aplicabilidade: { assinatura_regex: '[' } })).toBe(false);
  });
});

describe('remediacoesQueCasam', () => {
  it('devolve só o subconjunto que casa', () => {
    const cat = [
      { id: 'a', aplicabilidade: { assinatura_regex: 'does not allow' } },
      { id: 'b', aplicabilidade: { assinatura_regex: 'timeout' } },
      { id: 'c', aplicabilidade: null },
    ];
    expect(remediacoesQueCasam(erro, cat).map((r) => r.id)).toEqual(['a']);
  });
});

describe('seam de dialeto de regex (Java↔JS)', () => {
  // Assinatura real do piloto em produção (assinatura_regex `(?i)Repository does
  // not allow updating assets`), usada para travar o comportamento hoje vivo.
  const ASSINATURA_PILOTO =
    'npm ERR! 400 Repository does not allow updating assets: maven-releases';

  it('piloto: (?i)Repository does not allow updating assets casa a assinatura real (case-insensitive)', () => {
    expect(casaRemediacao(
      { assinatura: ASSINATURA_PILOTO, servico: null, template: null },
      { aplicabilidade: { assinatura_regex: '(?i)Repository does not allow updating assets' } },
    )).toBe(true);
  });

  it('piloto: assinatura sem o texto não casa', () => {
    expect(casaRemediacao(
      { assinatura: 'npm ERR! 404 Not Found - GET https://registry/…', servico: null, template: null },
      { aplicabilidade: { assinatura_regex: '(?i)Repository does not allow updating assets' } },
    )).toBe(false);
  });

  // Tradeoff documentado: um construto Java-only cujo CORPO casaria o texto ainda
  // devolve false, porque `new RegExp` lança e o matcher fail-closa. O par abaixo
  // prova que o false vem do construto incompatível, não do texto: o MESMO corpo
  // sem o construto casa.
  it('Java-only `(?s)` inicial → não casa (fail-closed por design), sem lançar', () => {
    expect(() => casaRemediacao(
      { assinatura: ASSINATURA_PILOTO, servico: null, template: null },
      { aplicabilidade: { assinatura_regex: '(?s)does not allow updating assets' } },
    )).not.toThrow();
    expect(casaRemediacao(
      { assinatura: ASSINATURA_PILOTO, servico: null, template: null },
      { aplicabilidade: { assinatura_regex: '(?s)does not allow updating assets' } },
    )).toBe(false);
  });

  it('controle: o MESMO corpo sem `(?s)` casa — o false acima é do construto, não do texto', () => {
    expect(casaRemediacao(
      { assinatura: ASSINATURA_PILOTO, servico: null, template: null },
      { aplicabilidade: { assinatura_regex: 'does not allow updating assets' } },
    )).toBe(true);
  });
});

describe('assinaturaCompativelJs', () => {
  it('aceita (?i) inicial e padrão simples', () => {
    expect(assinaturaCompativelJs('(?i)Repository does not allow updating assets')).toBe(true);
    expect(assinaturaCompativelJs('blob upload invalid')).toBe(true);
  });
  it('rejeita construto Java-only e regex quebrada', () => {
    expect(assinaturaCompativelJs('(?s)qualquer')).toBe(false); // (?s) inline: Java ok, JS lança
    expect(assinaturaCompativelJs('(')).toBe(false);
  });
  it('compilarAssinaturaJs traduz (?i) inicial para a flag i', () => {
    const re = compilarAssinaturaJs('(?i)ABC');
    expect(re.flags).toBe('i');
    expect(re.test('abc')).toBe(true);
  });
});
