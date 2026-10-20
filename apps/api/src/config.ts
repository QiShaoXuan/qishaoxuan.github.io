export type ConfigErrorCode = 'INVALID_INTEGER' | 'INVALID_NODE_ENV' | 'INVALID_RELEASE' | 'INVALID_HOST' | 'INVALID_ORIGINS' | 'INVALID_CHAT_MODE' | 'MISSING_DEEPSEEK_KEY' | 'INVALID_MODEL';
export class ConfigError extends Error {
  constructor(public readonly code: ConfigErrorCode, message: string) { super(message); }
}

const pagesOrigin = 'https://qishaoxuan.github.io';
const developmentOrigins = ['http://localhost:8080', 'http://127.0.0.1:8080'];

export interface ApiConfig {
  release?: { commit: string; environment: 'prod' | 'dev' };
  chat: { mode: 'mock' | 'deepseek'; apiKey: string | undefined; model: string; maxTokens: number; timeoutMs: number; maxConcurrency: number; dailyLimit: number };
  host: string;
  port: number;
  allowedOrigins: string[];
  chatRateLimit: { max: number; timeWindow: number };
}

function positiveInteger(value: string | undefined, fallback: number, name: string, max: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new ConfigError('INVALID_INTEGER', `${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new ConfigError('INVALID_INTEGER', `${name} is out of range`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const mode = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new ConfigError('INVALID_NODE_ENV', 'Invalid NODE_ENV');
  const commit = env.RELEASE_COMMIT;
  const environment = env.DEPLOY_ENV;
  let release: ApiConfig['release'];
  if (commit !== undefined || environment !== undefined) {
    if (commit === undefined || !/^[a-f0-9]{40}$/.test(commit) || !['prod', 'dev'].includes(environment ?? '')) {
      throw new ConfigError('INVALID_RELEASE', 'RELEASE_COMMIT and DEPLOY_ENV must be a valid commit and prod/dev pair');
    }
    release = { commit, environment: environment as 'prod' | 'dev' };
  }
  const host = env.API_HOST ?? env.HOSTNAME ?? '127.0.0.1';
  if (host.trim() !== host || !host || /[\s/:]/.test(host) && host !== '::1' && host !== '::') {
    throw new ConfigError('INVALID_HOST', 'Invalid API_HOST or HOSTNAME');
  }
  const supportedOrigins = mode === 'development' ? [pagesOrigin, ...developmentOrigins] : [pagesOrigin];
  const allowedOrigins = env.API_ALLOWED_ORIGINS === undefined
    ? supportedOrigins
    : env.API_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim());
  if (allowedOrigins.some((origin) => !supportedOrigins.includes(origin))) {
    throw new ConfigError('INVALID_ORIGINS', 'API_ALLOWED_ORIGINS must use the Pages origin; localhost is only allowed in development');
  }
  const chatMode = env.API_CHAT_MODE ?? 'mock';
  if (chatMode !== 'mock' && chatMode !== 'deepseek') throw new ConfigError('INVALID_CHAT_MODE', 'Invalid API_CHAT_MODE');
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (chatMode === 'deepseek' && !apiKey) throw new ConfigError('MISSING_DEEPSEEK_KEY', 'DEEPSEEK_API_KEY is required in deepseek mode');
  const model = env.DEEPSEEK_MODEL ?? 'deepseek-flash';
  if (!['deepseek-flash', 'deepseek-v4-pro'].includes(model)) throw new ConfigError('INVALID_MODEL', 'Invalid DEEPSEEK_MODEL');
  return {
    chat: {
      mode: chatMode, apiKey, model,
      maxTokens: positiveInteger(env.API_CHAT_MAX_TOKENS, 1024, 'API_CHAT_MAX_TOKENS', 2048),
      timeoutMs: positiveInteger(env.API_CHAT_TIMEOUT_MS, 60000, 'API_CHAT_TIMEOUT_MS', 120000),
      maxConcurrency: positiveInteger(env.API_CHAT_MAX_CONCURRENCY, 2, 'API_CHAT_MAX_CONCURRENCY', 100),
      dailyLimit: positiveInteger(env.API_CHAT_DAILY_LIMIT, 100, 'API_CHAT_DAILY_LIMIT', 100000),
    },
    ...(release ? { release } : {}),
    host,
    port: positiveInteger(env.API_PORT ?? env.PORT, 3000, 'API_PORT / PORT', 65535),
    allowedOrigins: [...new Set(allowedOrigins)],
    chatRateLimit: {
      max: positiveInteger(env.API_CHAT_RATE_LIMIT_MAX, 10, 'API_CHAT_RATE_LIMIT_MAX', 1000),
      timeWindow: positiveInteger(env.API_CHAT_RATE_LIMIT_WINDOW_MS, 60_000, 'API_CHAT_RATE_LIMIT_WINDOW_MS', 3_600_000),
    },
  };
}
