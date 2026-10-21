import { ConfigError } from './config.js';

export type DiagnosticStage = 'config' | 'build' | 'listen' | 'request' | 'shutdown';
const configCodes = new Set(['INVALID_INTEGER', 'INVALID_NODE_ENV', 'INVALID_RELEASE', 'INVALID_HOST', 'INVALID_ORIGINS', 'INVALID_CHAT_MODE', 'MISSING_DEEPSEEK_KEY', 'INVALID_MODEL', 'INVALID_AUDIT_CONFIG']);
const listenCodes = new Set(['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL']);

// Never serialize arbitrary error names, codes, messages or stack traces.
export function safeDiagnostic(error: unknown, stage: DiagnosticStage) {
  let errorCategory = 'UNKNOWN_ERROR';
  if (stage === 'config' && error instanceof ConfigError && configCodes.has(error.code)) errorCategory = error.code;
  else if (stage === 'listen' && error instanceof Error && 'code' in error && typeof error.code === 'string' && listenCodes.has(error.code)) errorCategory = error.code;
  else if (error instanceof TypeError) errorCategory = 'TYPE_ERROR';
  else if (error instanceof RangeError) errorCategory = 'RANGE_ERROR';
  else if (error instanceof SyntaxError) errorCategory = 'SYNTAX_ERROR';
  else if (error instanceof Error) errorCategory = 'INTERNAL_ERROR';
  return { stage, errorCategory };
}
