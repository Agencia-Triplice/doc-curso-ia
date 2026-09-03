import { resolverPersona } from '../src/curador/persona';

describe('resolverPersona', () => {
  it('mapeia arquétipo conhecido para persona especialista', () => {
    const r = resolverPersona('srv-java');
    expect(r.persona).toContain('Java');
    expect(r.dossieTemplate.length).toBeGreaterThan(0);
  });
  it('cai no SRE genérico quando o template é desconhecido', () => {
    expect(resolverPersona('inexistente')).toEqual({ persona: 'SRE sênior', dossieTemplate: '' });
  });
  it('cai no SRE genérico quando o template é null', () => {
    expect(resolverPersona(null)).toEqual({ persona: 'SRE sênior', dossieTemplate: '' });
  });
  it('cai no SRE genérico quando o template é undefined', () => {
    expect(resolverPersona(undefined)).toEqual({ persona: 'SRE sênior', dossieTemplate: '' });
  });
  it('cai no SRE genérico quando o template é string vazia/espaços', () => {
    expect(resolverPersona('   ')).toEqual({ persona: 'SRE sênior', dossieTemplate: '' });
  });
  it('resolve os 7 arquétipos conhecidos com persona e dossiê não vazios', () => {
    const slugs = [
      'srv-java',
      'bff-node',
      'python-sim',
      'api-axway',
      'mon-ant',
      'bat-iws',
      'fed-node',
    ];
    for (const slug of slugs) {
      const r = resolverPersona(slug);
      expect(r.persona).not.toBe('SRE sênior');
      expect(r.persona.length).toBeGreaterThan(0);
      expect(r.dossieTemplate.length).toBeGreaterThan(0);
    }
  });
});
