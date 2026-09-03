export interface CuradoriaConfig {
  ms5Url: string;
  ms3Url: string;
  ms8Url: string;
  mcpGithubUrl: string;
  internalToken: string;
  s2sToken: string;
  dbPath: string;
  promptDbPath: string;
  requestTimeout: number;
  logLevel: string;
  maxBodyBytes: number;
  agentixUrl: string;
  agentixUsername: string;
  agentixPassword: string;
  agentixTenantId: string;
  agentixBundleName: string;
  agentixBundleVersion: string;
  agentixEntityId: string;
  agentixEntityName: string;
  agentixEntityVersion: string;
  agentixEntityType: string;
  curadorIntervalo: number;
  curadorLote: number;
  curadorMaxTentativas: number;
  sessionSecret: string;
  sessionTtl: number;
  githubClientId: string;
  githubClientSecret: string;
  githubCallbackUrl: string;
  githubBaseUrl: string;
  githubApiUrl: string;
  githubOrg: string;
  githubAllowedTeams: string[];
  authDevUser: string;
  production: boolean;
  propostaDbPath: string;
  agentixPrEntityName: string;
  propostaMaxArquivos: number;
  propostaMaxLinhasDiff: number;
  propostaIntervalo: number;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

const str = (e: NodeJS.ProcessEnv, k: string, d: string): string => e[`CURADORIA_BFF_${k}`] ?? d;
const num = (e: NodeJS.ProcessEnv, k: string, d: number): number => {
  const v = e[`CURADORIA_BFF_${k}`];
  return v === undefined || v === '' ? d : Number(v);
};
const csv = (e: NodeJS.ProcessEnv, k: string): string[] =>
  (e[`CURADORIA_BFF_${k}`] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
export function loadConfig(env: NodeJS.ProcessEnv = process.env): CuradoriaConfig {
  const production = env.NODE_ENV === 'production';
  const sessionSecret = str(env, 'SESSION_SECRET', '');
  if (production && !sessionSecret) {
    throw new Error('CURADORIA_BFF_SESSION_SECRET é obrigatório em produção (cookie de sessão não pode ser assinado sem ele)');
  }

  return {
    ms5Url: str(env, 'MS5_URL', 'http://localhost:8002'),
    ms3Url: str(env, 'MS3_URL', ''),
    ms8Url: str(env, 'MS8_URL', ''),
    mcpGithubUrl: str(env, 'MCP_GITHUB_URL', ''),
    internalToken: str(env, 'INTERNAL_TOKEN', ''),
    // token S2S de ENTRADA: quando setado, o AuthGuard aceita chamadas com o
    // header X-Internal-Token igual a este valor (usado pelo cockpit/log-view
    // para abrir PR de remediação headless). Vazio = sem bypass S2S.
    s2sToken: str(env, 'S2S_TOKEN', ''),
    dbPath: str(env, 'ELEGIBILIDADE_DB_PATH', 'data/elegibilidade.db'),
    promptDbPath: str(env, 'PROMPT_DB_PATH', 'data/prompts.db'),
    requestTimeout: num(env, 'REQUEST_TIMEOUT', 10),
    logLevel: str(env, 'LOG_LEVEL', 'INFO'),
    maxBodyBytes: num(env, 'MAX_BODY_BYTES', 2097152),
    agentixUrl: str(env, 'AGENTIX_URL', ''),
    agentixUsername: str(env, 'AGENTIX_USERNAME', ''),
    agentixPassword: str(env, 'AGENTIX_PASSWORD', ''),
    agentixTenantId: str(env, 'AGENTIX_TENANT_ID', ''),
    agentixBundleName: str(env, 'AGENTIX_BUNDLE_NAME', 'dvop-agx-ssol-consulta-erro'),
    agentixBundleVersion: str(env, 'AGENTIX_BUNDLE_VERSION', ''),
    agentixEntityId: str(env, 'AGENTIX_ENTITY_ID', ''),
    agentixEntityName: str(env, 'AGENTIX_ENTITY_NAME', 'curador'),
    agentixEntityVersion: str(env, 'AGENTIX_ENTITY_VERSION', '1.0.0'),
    // Ambos os entities que a curadoria invoca — `curador` e `propor-pr` — são
    // `kind: agent` no bundle. O contrato real valida entity_type ^(agent|workflow)$
    // e ROTEIA por ele: invocar um agente como 'workflow' não acha entidade → falha.
    // Default 'agent' (era 'workflow', que só funcionava porque o sim ignora o tipo
    // para nomes que não são workflow). Confirme AGENTIX_ENTITY_TYPE=agent no ambiente real.
    agentixEntityType: str(env, 'AGENTIX_ENTITY_TYPE', 'agent'),
    curadorIntervalo: num(env, 'CURADOR_INTERVALO', 60),
    curadorLote: num(env, 'CURADOR_LOTE', 2),
    curadorMaxTentativas: num(env, 'CURADOR_MAX_TENTATIVAS', 3),
    sessionSecret,
    sessionTtl: num(env, 'SESSION_TTL_SECONDS', 43200),
    githubClientId: str(env, 'GITHUB_CLIENT_ID', ''),
    githubClientSecret: str(env, 'GITHUB_CLIENT_SECRET', ''),
    githubCallbackUrl: str(env, 'GITHUB_CALLBACK_URL', ''),
    // Host do GitHub, configurável p/ portar entre github.com e GitHub Enterprise
    // Server (Bradesco): só trocar estas duas envs — o código não muda. GHES usa
    // BASE=https://<host> e API=https://<host>/api/v3.
    githubBaseUrl: str(env, 'GITHUB_BASE_URL', 'https://github.com'),
    githubApiUrl: str(env, 'GITHUB_API_URL', 'https://api.github.com'),
    githubOrg: str(env, 'GITHUB_ORG', 'GDD-Core'),
    githubAllowedTeams: csv(env, 'GITHUB_ALLOWED_TEAMS'),
    authDevUser: str(env, 'AUTH_DEV_USER', ''),
    production,
    propostaDbPath: str(env, 'PROPOSTA_DB_PATH', 'data/proposta_pr.db'),
    agentixPrEntityName: str(env, 'AGENTIX_PR_ENTITY_NAME', 'propor-pr'),
    propostaMaxArquivos: num(env, 'PROPOSTA_MAX_ARQUIVOS', 3),
    propostaMaxLinhasDiff: num(env, 'PROPOSTA_MAX_LINHAS_DIFF', 80),
    propostaIntervalo: num(env, 'PROPOSTA_INTERVALO', 20),
  };
}

export function agentixConfigurado(cfg: CuradoriaConfig): boolean {
  return !!cfg.agentixUrl && !!cfg.agentixUsername && !!cfg.agentixPassword && !!cfg.agentixTenantId;
}
