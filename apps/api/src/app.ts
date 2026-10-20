import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController } from 'fastify';
import { loadConfig } from './config.js';
import type { ApiConfig } from './config.js';
import { mockProvider, validateHistory } from './chat.js';
import type { ChatProvider, Message, Completion } from './chat.js';
import { safeDiagnostic } from './diagnostics.js';
import { deepseekProvider } from './deepseek.js';
import { ChatError, writeSse } from './sse.js';
import { PROMPT_VERSION, KNOWLEDGE_VERSION, KNOWLEDGE_SOURCES } from './prompts.js';

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

export interface AppOptions { provider?: ChatProvider; fetch?: typeof fetch; logStream?: Writable }

export async function buildApp(config: ApiConfig = loadConfig(), options: AppOptions = {}) {
  const app = Fastify({
    logger: { hooks: { logMethod(args, method) { if (['request', 'chat', 'startup', 'shutdown', 'diagnostic'].includes(String(args[1]))) method.apply(this, args); } }, level: 'info', ...(options.logStream ? { stream: options.logStream } : {}), base: null, timestamp: true, serializers: { req: () => ({}), res: () => ({}), err: () => ({ type: 'Error', message: '', stack: '' }) } },
    logController: new LogController({ disableRequestLogging: true }), requestIdHeader: false, genReqId: () => randomUUID(),
    bodyLimit: 100 * 1024,
    trustProxy: ['127.0.0.1', '::1'],
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  const provider = options.provider ?? (config.chat.mode === 'mock' ? mockProvider : deepseekProvider(config.chat, options.fetch));
  let concurrent = 0, used = 0, day = new Date().toISOString().slice(0, 10);
  const active = new Set<AbortController>();
  app.addHook('preClose', async () => { for (const controller of active) controller.abort(); });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
    const origin = request.headers.origin;
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
      return reply.code(403).send({ code: 'ORIGIN_NOT_ALLOWED', message: '此来源不允许访问。', requestId: request.id });
    }
  });
  app.addHook('onResponse', async (request, reply) => {
    app.log.info({ route: request.routeOptions.url ?? 'unmatched', method: request.method, status: reply.statusCode, id: request.id, env: config.release?.environment ?? 'local', commit: config.release?.commit, timing: reply.elapsedTime }, 'request');
  });
  await app.register(cors, { origin: config.allowedOrigins, methods: ['GET', 'HEAD', 'POST'], allowedHeaders: ['Content-Type', 'Accept'], exposedHeaders: ['X-Request-Id'], credentials: false, strictPreflight: true });
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, request, reply) => {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : 500;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    const code = status === 429 ? 'RATE_LIMITED' : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST';
    if (status === 500) app.log.error({ route: request.routeOptions.url ?? 'unmatched', method: request.method, id: request.id, status, ...safeDiagnostic(error, 'request') }, 'diagnostic');
    return reply.code(status).send({ code, message: status === 429 ? '请求过于频繁，请稍后重试。' : '请求无法处理。', requestId: request.id });
  });
  const health = () => ({ status: 'ok', service: 'resume-api', ...config.release });
  app.get('/healthz', health);
  app.get('/api/health', () => ({ ...health(), chat: { mode: config.chat.mode, configured: config.chat.mode === 'mock' || Boolean(config.chat.apiKey) } }));
  app.post<{ Body: { messages: Message[] } }>('/api/chat', { schema: { body: chatBodySchema }, config: { rateLimit: config.chatRateLimit } }, async (request, reply) => {
    const fail = (status: number, code: string) => reply.code(status).send({ code, message: '请求暂时无法处理，请稍后重试。', requestId: request.id });
    try { validateHistory(request.body.messages); } catch { return fail(400, 'INVALID_REQUEST'); }
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; used = 0; }
    if (used >= config.chat.dailyLimit) return fail(429, 'DAILY_LIMIT_REACHED');
    if (concurrent >= config.chat.maxConcurrency) return fail(429, 'CONCURRENCY_LIMIT');
    concurrent++; used++;
    const controller = new AbortController();
    active.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.chat.timeoutMs);
    timer.unref();
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once('close', abort);
    const streaming = request.headers.accept?.split(',').some((part) => part.trim().split(';')[0] === 'text/event-stream') ?? false;
    const started = performance.now();
    let firstToken: number | undefined, completion: Completion | undefined;
    let outcome = 'error', errorCode: string | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let iterator: AsyncGenerator<string, Completion> | undefined;
    try {
      if (streaming) {
        reply.header('content-type', 'text/event-stream; charset=utf-8').header('cache-control', 'no-cache, no-transform').header('x-accel-buffering', 'no');
        reply.hijack();
        for (const [name, value] of Object.entries(reply.getHeaders())) { if (value !== undefined) reply.raw.setHeader(name, value); }
        reply.raw.writeHead(200);
        await writeSse(reply.raw, controller.signal, 'meta', { requestId: request.id, mode: config.chat.mode });
        heartbeat = setInterval(() => {
          // Never buffer heartbeats while the socket is backpressured.
          if (!controller.signal.aborted && !reply.raw.writableNeedDrain && !reply.raw.destroyed) reply.raw.write(': heartbeat\n\n');
        }, 15000);
        heartbeat.unref();
      }
      iterator = provider.stream(request.body.messages, controller.signal);
      let content = '';
      while (true) {
        const result = await new Promise<IteratorResult<string, Completion>>((resolve, reject) => {
          const listener = () => reject(new ChatError('REQUEST_ABORTED', 499));
          if (controller.signal.aborted) { listener(); return; }
          controller.signal.addEventListener('abort', listener, { once: true });
          void iterator!.next().then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', listener));
        });
        controller.signal.throwIfAborted();
        if (result.done) { completion = result.value; break; }
        firstToken ??= performance.now() - started;
        content += result.value;
        if (content.length > 16384) throw new ChatError('OUTPUT_LIMIT');
        if (streaming) await writeSse(reply.raw, controller.signal, 'delta', { content: result.value });
      }
      if (!completion || !['stop', 'length'].includes(completion.finishReason)) throw new ChatError('UPSTREAM_FINISH_ERROR');
      const sources = config.chat.mode === 'mock' ? [] : KNOWLEDGE_SOURCES;
      if (streaming) {
        await writeSse(reply.raw, controller.signal, 'done', { finishReason: completion.finishReason, sources });
        reply.raw.end();
        outcome = 'success';
      } else { outcome = 'success'; return reply.send({ mode: config.chat.mode, message: { role: 'assistant', content }, requestId: request.id, sources }); }
    } catch (error) {
      const code = timedOut ? 'REQUEST_TIMEOUT' : controller.signal.aborted ? 'REQUEST_ABORTED' : error instanceof ChatError ? error.code : 'UPSTREAM_UNAVAILABLE';
      errorCode = code; outcome = timedOut ? 'timeout' : controller.signal.aborted ? 'aborted' : 'error';
      if (streaming) {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          try { await writeSse(reply.raw, AbortSignal.timeout(1000), 'error', { code, message: '回复中断，请稍后重试。', requestId: request.id }); } catch { /* Client disconnected. */ }
          reply.raw.end();
        }
      } else if (!reply.raw.destroyed) return fail(timedOut ? 504 : 502, code);
    } finally {
      clearTimeout(timer); if (heartbeat) clearInterval(heartbeat);
      controller.abort();
      // A provider may be blocked inside next(); cancellation is signaled, never awaited indefinitely.
      void iterator?.return({ finishReason: 'stop' }).catch(() => {});
      reply.raw.off('close', abort); active.delete(controller); concurrent--;
      app.log.info({ route: '/api/chat', method: 'POST', id: request.id, env: config.release?.environment ?? 'local', commit: config.release?.commit, timing: performance.now() - started, firstToken, status: reply.statusCode, model: config.chat.mode === 'deepseek' ? config.chat.model : 'mock', outcome, errorCode, finish: outcome === 'success' ? completion?.finishReason : 'error', upstreamId: completion?.upstreamId, promptTokens: completion?.promptTokens, completionTokens: completion?.completionTokens, promptVersion: PROMPT_VERSION, knowledgeVersion: KNOWLEDGE_VERSION }, 'chat');
    }
  });
  return app;
}
