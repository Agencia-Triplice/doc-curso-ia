import { loadConfig } from '../src/config/env';

describe('loadConfig', () => {
  it('usa defaults quando env vazio', () => {
    const c = loadConfig({});
    expect(c.defaultSrvUrl).toBe('http://localhost:8000');
    expect(c.cacheUrl).toBe('');
    expect(c.cacheWriterUrl).toBe('');
    expect(c.agentixBundleName).toBe('dvop-agx-ssol-consulta-erro');
    expect(c.agentixEntityName).toBe('diagnostico');
    expect(c.requestTimeout).toBe(10);
    expect(c.dbPath).toBe('./data/requests.db');
    expect(c.auditMaxRows).toBe(10000);
    expect(c.maxBodyBytes).toBe(2097152);
  });
  it('lê LOG_BFF_* do ambiente', () => {
    const c = loadConfig({ LOG_BFF_CACHE_URL: 'http://ms2:8001', LOG_BFF_CACHE_WRITER_URL: 'http://ms5:8002', LOG_BFF_REQUEST_TIMEOUT: '5' });
    expect(c.cacheUrl).toBe('http://ms2:8001');
    expect(c.cacheWriterUrl).toBe('http://ms5:8002');
    expect(c.requestTimeout).toBe(5);
  });
});

describe('envs do diagnóstico misto', () => {
  it('defaults: payload key erro, triagem desligada, name triagem-group', () => {
    const c = loadConfig({} as any);
    expect(c.agentixPayloadKey).toBe('erro');
    expect(c.agentixTriagemEntityId).toBe('');
    expect(c.agentixTriagemEntityName).toBe('triagem-group');
  });
  it('overrides via LOG_BFF_AGENTIX_PAYLOAD_KEY e _TRIAGEM_ENTITY_*', () => {
    const c = loadConfig({
      LOG_BFF_AGENTIX_PAYLOAD_KEY: 'descricao',
      LOG_BFF_AGENTIX_TRIAGEM_ENTITY_ID: 'uuid-t',
      LOG_BFF_AGENTIX_TRIAGEM_ENTITY_NAME: 'meu-group',
    } as any);
    expect(c.agentixPayloadKey).toBe('descricao');
    expect(c.agentixTriagemEntityId).toBe('uuid-t');
    expect(c.agentixTriagemEntityName).toBe('meu-group');
  });
});

describe('coordenada do group curador (card do agente)', () => {
  it('default do entity name do curador é "curador"', () => {
    expect(loadConfig({}).agentixCuradorEntityName).toBe('curador');
  });
  it('override via LOG_BFF_AGENTIX_CURADOR_ENTITY_NAME', () => {
    expect(loadConfig({ LOG_BFF_AGENTIX_CURADOR_ENTITY_NAME: 'dvop-curador' } as any).agentixCuradorEntityName).toBe('dvop-curador');
  });
});
