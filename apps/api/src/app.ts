import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { loadConfig } from './config.js';
import type { ApiConfig } from './config.js';

const chatBodySchema = {
  type: 'object',
  required: ['messages'],
  additionalProperties: false,
  properties: {
    messages: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        required: ['role', 'content'],
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          content: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
        },
      },
    },
  },
} as const;

export async function buildApp(config: ApiConfig = loadConfig()) {
  const app = Fastify({
    logger: false,
    bodyLimit: 100 * 1024,
    trustProxy: ['127.0.0.1', '::1'],
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
      return reply.code(403).send({ code: 'ORIGIN_NOT_ALLOWED', message: '此来源不允许访问。' });
    }
  });

  await app.register(cors, {
    origin: config.allowedOrigins,
    methods: ['GET', 'HEAD', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
    strictPreflight: true,
  });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : 500;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    if (status === 500) {
      // Preserve diagnostics without logging request data or upstream error bodies.
      console.error('Unhandled API error', {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
          ? error.code : undefined,
      });
    }
    const code = status === 429 ? 'RATE_LIMITED' : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST';
    return reply.code(status).send({ code, message: status === 429 ? '请求过于频繁，请稍后重试。' : '请求无法处理。' });
  });

  const health = () => ({ status: 'ok', service: 'resume-api' });
  app.get('/healthz', health);
  app.get('/api/health', health);
  app.post('/api/chat', {
    schema: { body: chatBodySchema },
    config: { rateLimit: config.chatRateLimit },
  }, async (_request, reply) => {
    return reply.send({
      mode: 'mock',
      message: {
        role: 'assistant',
        content: '这是一条 Mock 测试回复，聊天链路已接通。正式工作经历问答将在后续接入。',
      },
    });
  });

  return app;
}
