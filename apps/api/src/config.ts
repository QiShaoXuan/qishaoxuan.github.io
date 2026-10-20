const pagesOrigin = 'https://qishaoxuan.github.io';
const developmentOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export interface ApiConfig {
  host: string;
  port: number;
  allowedOrigins: string[];
  chatRateLimit: { max: number; timeWindow: number };
}

function positiveInteger(value: string | undefined, fallback: number, name: string, max: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new Error(`${name} is out of range`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const mode = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('Invalid NODE_ENV');
  const host = env.API_HOST ?? env.HOSTNAME ?? '127.0.0.1';
  if (host.trim() !== host || !host || /[\s/:]/.test(host) && host !== '::1' && host !== '::') {
    throw new Error('Invalid API_HOST or HOSTNAME');
  }
  const supportedOrigins = mode === 'development' ? [pagesOrigin, ...developmentOrigins] : [pagesOrigin];
  const allowedOrigins = env.API_ALLOWED_ORIGINS === undefined
    ? supportedOrigins
    : env.API_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim());
  if (allowedOrigins.some((origin) => !supportedOrigins.includes(origin))) {
    throw new Error('API_ALLOWED_ORIGINS must use the Pages origin; localhost is only allowed in development');
  }
  return {
    host,
    port: positiveInteger(env.API_PORT ?? env.PORT, 3000, 'API_PORT / PORT', 65535),
    allowedOrigins: [...new Set(allowedOrigins)],
    chatRateLimit: {
      max: positiveInteger(env.API_CHAT_RATE_LIMIT_MAX, 10, 'API_CHAT_RATE_LIMIT_MAX', 1000),
      timeWindow: positiveInteger(env.API_CHAT_RATE_LIMIT_WINDOW_MS, 60_000, 'API_CHAT_RATE_LIMIT_WINDOW_MS', 3_600_000),
    },
  };
}
