import { resolverPersona } from '../src/agente-curador/persona';
import { montarPayloadCurador } from '../src/agente-curador/payload';

describe('resolverPersona (port do curador)', () => {
  it('mapeia arquétipo conhecido para persona especialista com dossiê', () => {
    const r = resolverPersona('srv-java');
    expect(r.persona).toContain('Java');
    expect(r.dossieTemplate.length).toBeGreaterThan(0);
  });
  it('cai no SRE genérico quando o template é desconhecido/null/undefined/vazio', () => {
    expect(resolverPersona('inexistente')).toEqual({ persona: 'SRE sênior', dossieTemplate: '' });
    expect(resolverPersona(null)).toEqual({ persona: 'SRE sênior', dossieTemplate: '' });
    expect(resolverPersona(undefined)).toEqual({ persona: 'SRE sênior', dossieTemplate: '' });
    expect(resolverPersona('   ')).toEqual({ persona: 'SRE sênior', dossieTemplate: '' });
  });
  it('resolve os 7 arquétipos com persona e dossiê não vazios', () => {
    for (const slug of ['srv-java', 'bff-node', 'python-sim', 'api-axway', 'mon-ant', 'bat-iws', 'fed-node']) {
      const r = resolverPersona(slug);
      expect(r.persona).not.toBe('SRE sênior');
      expect(r.dossieTemplate.length).toBeGreaterThan(0);
    }
  });
});

describe('montarPayloadCurador (port do curador)', () => {
  const orfao = { assinatura: 'sig-1', servico: 'svc', nivel: 'ERROR', workflow: 'ci', job: 'build', step_cmd: 'mvn', exit_code: 1 };
  it('monta os 11 pares na ordem do contrato; erro e assinatura usam a assinatura', () => {
    expect(montarPayloadCurador(orfao, 'CTX', 'SRE sênior', '')).toEqual([
      { key: 'erro', value: 'sig-1' },
      { key: 'assinatura', value: 'sig-1' },
      { key: 'servico', value: 'svc' },
      { key: 'nivel', value: 'ERROR' },
      { key: 'contexto', value: 'CTX' },
      { key: 'persona', value: 'SRE sênior' },
      { key: 'dossie_template', value: '' },
      { key: 'workflow', value: 'ci' },
      { key: 'job', value: 'build' },
      { key: 'step_cmd', value: 'mvn' },
      { key: 'exit_code', value: '1' },
    ]);
  });
  it('servico/nivel ausentes viram "desconhecido"; campos de esteira ausentes viram ""', () => {
    const p = montarPayloadCurador({ assinatura: 'sig' }, 'c', 'p', 'd');
    expect(p.find((x) => x.key === 'servico')!.value).toBe('desconhecido');
    expect(p.find((x) => x.key === 'nivel')!.value).toBe('desconhecido');
    expect(p.find((x) => x.key === 'workflow')!.value).toBe('');
    expect(p.find((x) => x.key === 'exit_code')!.value).toBe('');
  });
});
