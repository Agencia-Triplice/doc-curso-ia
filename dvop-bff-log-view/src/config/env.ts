export interface AppConfig {
  defaultSrvUrl: string; cacheUrl: string; cacheWriterUrl: string; retrievalUrl: string; reviewUrl: string;
  mcpghUrl: string; mcpghToken: string;
  agentixUrl: string; agentixUsername: string; agentixPassword: string;
  agentixTenantId: string;
  agentixBundleName: string; agentixBundleVersion: string; agentixEntityId: string;
  agentixEntityName: string; agentixEntityVersion: string; agentixEntityType: string;
  agentixCuradorEntityName: string;
  agentixPayloadKey: string; agentixTriagemEntityId: string; agentixTriagemEntityName: string;
  allowedHosts: string; corsOrigins: string; requestTimeout: number; logLevel: string;
  dbPath: string; auditMaxRows: number; maxBodyBytes: number; remediationUrl: string;
  curadoriaUrl: string; curadoriaS2sToken: string;
}
export const APP_CONFIG = Symbol('APP_CONFIG');

const str = (e: NodeJS.ProcessEnv, k: string, d: string): string => e[`LOG_BFF_${k}`] ?? d;
const num = (e: NodeJS.ProcessEnv, k: string, d: number): number => {
  const v = e[`LOG_BFF_${k}`]; return v === undefined || v === '' ? d : Number(v);
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    defaultSrvUrl: str(env, 'DEFAULT_SRV_URL', 'http://localhost:8000'),
    cacheUrl: str(env, 'CACHE_URL', ''),
    // Store de ESCRITA (MS5, cache-writer): órfãos/rascunhos/prompts moram só aqui.
    // O cache-query (CACHE_URL) é réplica só-leitura e devolve 404 nessas rotas —
    // por isso o cockpit precisa apontar as operações de curadoria para cá.
    cacheWriterUrl: str(env, 'CACHE_WRITER_URL', ''),
    retrievalUrl: str(env, 'RETRIEVAL_URL', ''),
    reviewUrl: str(env, 'REVIEW_URL', ''),
    mcpghUrl: str(env, 'MCPGH_URL', ''),
    mcpghToken: str(env, 'MCPGH_TOKEN', ''),
    remediationUrl: str(env, 'REMEDIATION_URL', ''),
    // curadoria (BFF): usada pelo cockpit para abrir PR de remediação headless
    // (gera a proposta via AgentiX e aprova). O token S2S vai no X-Internal-Token
    // e casa com CURADORIA_BFF_S2S_TOKEN no outro lado. Ambos vazios = recurso off.
    curadoriaUrl: str(env, 'CURADORIA_URL', ''),
    curadoriaS2sToken: str(env, 'CURADORIA_S2S_TOKEN', ''),
    agentixUrl: str(env, 'AGENTIX_URL', ''),
    agentixUsername: str(env, 'AGENTIX_USERNAME', ''),
    agentixPassword: str(env, 'AGENTIX_PASSWORD', ''),
    agentixTenantId: str(env, 'AGENTIX_TENANT_ID', ''),
    agentixBundleName: str(env, 'AGENTIX_BUNDLE_NAME', 'dvop-agx-ssol-consulta-erro'),
    agentixBundleVersion: str(env, 'AGENTIX_BUNDLE_VERSION', ''),
    agentixEntityId: str(env, 'AGENTIX_ENTITY_ID', ''),
    agentixEntityName: str(env, 'AGENTIX_ENTITY_NAME', 'diagnostico'),
    agentixEntityVersion: str(env, 'AGENTIX_ENTITY_VERSION', '1.0.0'),
    // curador/triagem invocados por este BFF são `kind: agent` no bundle; o contrato
    // real ROTEIA por entity_type e rejeita agente pedido como 'workflow'. Default 'agent'
    // (era 'workflow', tolerado só pelo sim). Confirme AGENTIX_ENTITY_TYPE=agent no real.
    agentixEntityType: str(env, 'AGENTIX_ENTITY_TYPE', 'agent'),
    agentixCuradorEntityName: str(env, 'AGENTIX_CURADOR_ENTITY_NAME', 'curador'),
    agentixPayloadKey: str(env, 'AGENTIX_PAYLOAD_KEY', 'erro'),
    agentixTriagemEntityId: str(env, 'AGENTIX_TRIAGEM_ENTITY_ID', ''),
    agentixTriagemEntityName: str(env, 'AGENTIX_TRIAGEM_ENTITY_NAME', 'triagem-group'),
    allowedHosts: str(env, 'ALLOWED_HOSTS', ''),
    corsOrigins: str(env, 'CORS_ORIGINS', ''),
    requestTimeout: num(env, 'REQUEST_TIMEOUT', 10),
    logLevel: str(env, 'LOG_LEVEL', 'INFO'),
    dbPath: str(env, 'DB_PATH', './data/requests.db'),
    auditMaxRows: num(env, 'AUDIT_MAX_ROWS', 10000),
    maxBodyBytes: num(env, 'MAX_BODY_BYTES', 2097152),
  };
}
