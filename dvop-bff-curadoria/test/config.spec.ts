import { agentixConfigurado, loadConfig } from '../src/config/env';

describe('loadConfig', () => {
  it('usa defaults quando env vazio', () => {
    const c = loadConfig({});
    expect(c.ms5Url).toBe('http://localhost:8002');
    expect(c.ms3Url).toBe('');
    expect(c.ms8Url).toBe('');
    expect(c.dbPath).toBe('data/elegibilidade.db');
    expect(c.promptDbPath).toBe('data/prompts.db');
    expect(c.requestTimeout).toBe(10);
    expect(c.logLevel).toBe('INFO');
    expect(c.maxBodyBytes).toBe(2097152);
    expect(c.agentixUrl).toBe('');
    expect(c.agentixUsername).toBe('');
    expect(c.agentixPassword).toBe('');
    expect(c.agentixTenantId).toBe('');
    expect(c.agentixBundleName).toBe('dvop-agx-ssol-consulta-erro');
    expect(c.agentixBundleVersion).toBe('');
    expect(c.agentixEntityId).toBe('');
    expect(c.agentixEntityName).toBe('curador');
    expect(c.agentixEntityVersion).toBe('1.0.0');
    expect(c.agentixEntityType).toBe('agent');
    expect(c.curadorIntervalo).toBe(60);
    expect(c.curadorLote).toBe(2);
    expect(c.curadorMaxTentativas).toBe(3);
    expect(c.propostaDbPath).toBe('data/proposta_pr.db');
    expect(c.agentixPrEntityName).toBe('propor-pr');
    expect(c.propostaMaxArquivos).toBe(3);
    expect(c.propostaMaxLinhasDiff).toBe(80);
    expect(c.propostaIntervalo).toBe(20);
  });

  it('lê CURADORIA_BFF_* do ambiente (strings)', () => {
    const c = loadConfig({
      CURADORIA_BFF_MS5_URL: 'http://ms5:8002',
      CURADORIA_BFF_MS3_URL: 'http://ms3:8003',
      CURADORIA_BFF_MS8_URL: 'http://ms8:8008',
      CURADORIA_BFF_ELEGIBILIDADE_DB_PATH: '/data/elegibilidade.db',
      CURADORIA_BFF_PROMPT_DB_PATH: '/data/prompts.db',
      CURADORIA_BFF_LOG_LEVEL: 'DEBUG',
      CURADORIA_BFF_AGENTIX_URL: 'http://agentix/graphql/',
      CURADORIA_BFF_AGENTIX_USERNAME: 'usr',
      CURADORIA_BFF_AGENTIX_PASSWORD: 'pwd',
      CURADORIA_BFF_AGENTIX_TENANT_ID: 'tenant-1',
      CURADORIA_BFF_AGENTIX_BUNDLE_NAME: 'outro-bundle',
      CURADORIA_BFF_AGENTIX_BUNDLE_VERSION: '2.0.0',
      CURADORIA_BFF_AGENTIX_ENTITY_ID: 'entity-1',
      CURADORIA_BFF_AGENTIX_ENTITY_NAME: 'outro-curador',
      CURADORIA_BFF_AGENTIX_ENTITY_VERSION: '2.0.0',
      CURADORIA_BFF_AGENTIX_ENTITY_TYPE: 'USER',
      CURADORIA_BFF_PROPOSTA_DB_PATH: '/data/proposta_pr.db',
      CURADORIA_BFF_AGENTIX_PR_ENTITY_NAME: 'outro-propor-pr',
    });
    expect(c.ms5Url).toBe('http://ms5:8002');
    expect(c.ms3Url).toBe('http://ms3:8003');
    expect(c.ms8Url).toBe('http://ms8:8008');
    expect(c.dbPath).toBe('/data/elegibilidade.db');
    expect(c.promptDbPath).toBe('/data/prompts.db');
    expect(c.logLevel).toBe('DEBUG');
    expect(c.agentixUrl).toBe('http://agentix/graphql/');
    expect(c.agentixUsername).toBe('usr');
    expect(c.agentixPassword).toBe('pwd');
    expect(c.agentixTenantId).toBe('tenant-1');
    expect(c.agentixBundleName).toBe('outro-bundle');
    expect(c.agentixBundleVersion).toBe('2.0.0');
    expect(c.agentixEntityId).toBe('entity-1');
    expect(c.agentixEntityName).toBe('outro-curador');
    expect(c.agentixEntityVersion).toBe('2.0.0');
    expect(c.agentixEntityType).toBe('USER');
    expect(c.propostaDbPath).toBe('/data/proposta_pr.db');
    expect(c.agentixPrEntityName).toBe('outro-propor-pr');
  });

  it('lê CURADORIA_BFF_* do ambiente (números, preservando decimais)', () => {
    const c = loadConfig({
      CURADORIA_BFF_REQUEST_TIMEOUT: '2.5',
      CURADORIA_BFF_MAX_BODY_BYTES: '1048576',
      CURADORIA_BFF_CURADOR_INTERVALO: '30.5',
      CURADORIA_BFF_CURADOR_LOTE: '5',
      CURADORIA_BFF_CURADOR_MAX_TENTATIVAS: '7',
      CURADORIA_BFF_PROPOSTA_MAX_ARQUIVOS: '4',
      CURADORIA_BFF_PROPOSTA_MAX_LINHAS_DIFF: '120',
      CURADORIA_BFF_PROPOSTA_INTERVALO: '15',
    });
    expect(c.requestTimeout).toBe(2.5);
    expect(c.maxBodyBytes).toBe(1048576);
    expect(c.curadorIntervalo).toBe(30.5);
    expect(c.curadorLote).toBe(5);
    expect(c.curadorMaxTentativas).toBe(7);
    expect(c.propostaMaxArquivos).toBe(4);
    expect(c.propostaMaxLinhasDiff).toBe(120);
    expect(c.propostaIntervalo).toBe(15);
  });

  it('string vazia em env numérico cai no default', () => {
    const c = loadConfig({ CURADORIA_BFF_REQUEST_TIMEOUT: '' });
    expect(c.requestTimeout).toBe(10);
  });

  it('sem argumento, usa process.env', () => {
    const prev = process.env.CURADORIA_BFF_MS5_URL;
    process.env.CURADORIA_BFF_MS5_URL = 'http://process-env:8002';
    try {
      const c = loadConfig();
      expect(c.ms5Url).toBe('http://process-env:8002');
    } finally {
      if (prev === undefined) delete process.env.CURADORIA_BFF_MS5_URL;
      else process.env.CURADORIA_BFF_MS5_URL = prev;
    }
  });
});

describe('agentixConfigurado', () => {
  const base = () => loadConfig({});

  it('false por default (tudo vazio)', () => {
    expect(agentixConfigurado(base())).toBe(false);
  });

  it('true com url + username + password + tenant', () => {
    const c = loadConfig({
      CURADORIA_BFF_AGENTIX_URL: 'http://agentix/graphql/',
      CURADORIA_BFF_AGENTIX_USERNAME: 'usr',
      CURADORIA_BFF_AGENTIX_PASSWORD: 'pwd',
      CURADORIA_BFF_AGENTIX_TENANT_ID: 'tenant-1',
    });
    expect(agentixConfigurado(c)).toBe(true);
  });

  it('false sem agentixUrl mesmo com o resto preenchido', () => {
    const c = loadConfig({
      CURADORIA_BFF_AGENTIX_USERNAME: 'usr',
      CURADORIA_BFF_AGENTIX_PASSWORD: 'pwd',
      CURADORIA_BFF_AGENTIX_TENANT_ID: 'tenant-1',
    });
    expect(agentixConfigurado(c)).toBe(false);
  });

  it('false sem username', () => {
    const c = loadConfig({
      CURADORIA_BFF_AGENTIX_URL: 'http://agentix/graphql/',
      CURADORIA_BFF_AGENTIX_PASSWORD: 'pwd',
      CURADORIA_BFF_AGENTIX_TENANT_ID: 'tenant-1',
    });
    expect(agentixConfigurado(c)).toBe(false);
  });

  it('false sem password', () => {
    const c = loadConfig({
      CURADORIA_BFF_AGENTIX_URL: 'http://agentix/graphql/',
      CURADORIA_BFF_AGENTIX_USERNAME: 'usr',
      CURADORIA_BFF_AGENTIX_TENANT_ID: 'tenant-1',
    });
    expect(agentixConfigurado(c)).toBe(false);
  });

  it('false sem tenantId', () => {
    const c = loadConfig({
      CURADORIA_BFF_AGENTIX_URL: 'http://agentix/graphql/',
      CURADORIA_BFF_AGENTIX_USERNAME: 'usr',
      CURADORIA_BFF_AGENTIX_PASSWORD: 'pwd',
    });
    expect(agentixConfigurado(c)).toBe(false);
  });
});

describe('config de autenticação', () => {
  const base = { CURADORIA_BFF_MS5_URL: 'http://ms5' };

  it('defaults: org GDD-Core, teams vazio, host github.com, não-produção', () => {
    const c = loadConfig({ ...base } as any);
    expect(c.githubOrg).toBe('GDD-Core');
    expect(c.githubAllowedTeams).toEqual([]);
    expect(c.githubBaseUrl).toBe('https://github.com');
    expect(c.githubApiUrl).toBe('https://api.github.com');
    expect(c.production).toBe(false);
    expect(c.sessionTtl).toBe(43200);
  });

  it('parseia ALLOWED_TEAMS CSV com espaços e vazios', () => {
    const c = loadConfig({ ...base, CURADORIA_BFF_GITHUB_ALLOWED_TEAMS: ' curadoria , plataforma ,' } as any);
    expect(c.githubAllowedTeams).toEqual(['curadoria', 'plataforma']);
  });

  it('host do GitHub é configurável (GitHub Enterprise Server)', () => {
    const c = loadConfig({
      ...base,
      CURADORIA_BFF_GITHUB_BASE_URL: 'https://ghe.bradesco.com',
      CURADORIA_BFF_GITHUB_API_URL: 'https://ghe.bradesco.com/api/v3',
    } as any);
    expect(c.githubBaseUrl).toBe('https://ghe.bradesco.com');
    expect(c.githubApiUrl).toBe('https://ghe.bradesco.com/api/v3');
  });

  it('NODE_ENV=production sem SESSION_SECRET → fail-fast', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' } as any)).toThrow(/SESSION_SECRET/);
  });

  it('NODE_ENV=production com SESSION_SECRET → ok e production=true', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'production', CURADORIA_BFF_SESSION_SECRET: 's3gr3d0' } as any);
    expect(c.production).toBe(true);
    expect(c.sessionSecret).toBe('s3gr3d0');
  });
});
