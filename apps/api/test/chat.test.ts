import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { ChatProvider } from '../src/chat.js';
import { deepseekProvider } from '../src/deepseek.js';
import { readSse } from '../src/sse.js';

const payload = { messages: [{ role: 'user' as const, content: '你好' }] };
const config = (extra: NodeJS.ProcessEnv = {}) => loadConfig({ NODE_ENV: 'test', API_CHAT_RATE_LIMIT_MAX: '100', ...extra });
const deepConfig = () => config({ API_CHAT_MODE: 'deepseek', DEEPSEEK_API_KEY: 'secret-key' });
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const complete = frame({ id: 'safe-upstream-id', choices: [{ delta: { content: '你好' }, finish_reason: null }] }) + frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 2 } }) + 'data: [DONE]\r\n\r\n';

test('mock SSE contract, generated request id and exposed CORS header', async (t) => {
  const app = await buildApp(config()); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/chat', headers: { accept: 'text/event-stream', origin: 'https://qishaoxuan.github.io', 'x-request-id': 'attacker-id' }, payload });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] as string, /text\/event-stream/);
  assert.notEqual(response.headers['x-request-id'], 'attacker-id');
  assert.match(response.headers['access-control-expose-headers'] as string, /X-Request-Id/i);
  assert.match(response.body, /event: meta\ndata: .*"mode":"mock"/);
  assert.match(response.body, /event: delta/);
  assert.match(response.body, /event: done\ndata: {"finishReason":"stop","sources":\[\]}/);
});

test('history alternation, last user and total characters are enforced', async (t) => {
  const app = await buildApp(config()); t.after(() => app.close());
  for (const messages of [
    [{ role: 'assistant', content: 'x' }],
    [...payload.messages, ...payload.messages],
    [...payload.messages, { role: 'assistant', content: 'x' }],
    Array.from({ length: 9 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'a'.repeat(4000) })),
  ]) assert.equal((await app.inject({ method: 'POST', url: '/api/chat', payload: { messages } })).statusCode, 400);
});

test('detailed assistant history is accepted intact while user and total history limits remain bounded', async (t) => {
  let received: unknown;
  const provider: ChatProvider = { async *stream(messages) { received = messages; yield '详细追问回答'; return { finishReason: 'stop' }; } };
  const app = await buildApp(config(), { provider }); t.after(() => app.close());
  const messages = [...payload.messages, { role: 'assistant', content: '详'.repeat(5000) }, { role: 'user', content: '继续展开' }];
  assert.equal((await app.inject({ method: 'POST', url: '/api/chat', payload: { messages } })).statusCode, 200);
  assert.deepEqual(received, messages);
  for (const messages of [
    [{ role: 'user', content: '问'.repeat(4001) }],
    [...payload.messages, { role: 'assistant', content: '答'.repeat(16385) }, { role: 'user', content: '继续' }],
    Array.from({ length: 9 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'x'.repeat(4000) })),
  ]) assert.equal((await app.inject({ method: 'POST', url: '/api/chat', payload: { messages } })).statusCode, 400);
});

test('DeepSeek fake HTTP preserves history, sends server system and strips reasoning', async (t) => {
  let sent: Record<string, unknown> = {};
  const upstream = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    sent = JSON.parse(body);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const bytes = Buffer.from(': comment\r\n\r\n' + frame({ choices: [{ delta: { reasoning_content: 'private-thought' } }] }) + complete);
    for (let i = 0; i < bytes.length; i += 7) response.write(bytes.subarray(i, i + 7));
    response.end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const url = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const app = await buildApp(deepConfig(), { fetch: (_url, init) => fetch(url, init) }); t.after(() => app.close());
  const messages = [...payload.messages, { role: 'assistant', content: '之前回答' }, { role: 'user', content: '追问' }];
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { messages } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().message.content, '你好');
  assert.equal(response.json().mode, 'deepseek');
  assert.deepEqual((sent.messages as unknown[]).slice(1), messages);
  assert.equal((sent.messages as { role: string }[])[0]?.role, 'system');
  assert.deepEqual(sent.thinking, { type: 'enabled' });
  assert.equal(sent.temperature, undefined);
  assert.equal(sent.max_tokens, 10000);
  assert.ok(!response.body.includes('private-thought'));
});

test('thinking stream forwards only final answer and never logs reasoning', async (t) => {
  let logs = '';
  const logStream = new Writable({ write(chunk, _encoding, callback) { logs += String(chunk); callback(); } });
  const body = frame({ choices: [{ delta: { reasoning_content: 'private-reasoning-marker', content: null } }] }) + complete;
  const app = await buildApp(deepConfig(), { logStream, fetch: async () => new Response(body) }); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/chat', headers: { accept: 'text/event-stream' }, payload });
  assert.match(response.body, /event: delta\ndata: {"content":"你好"}/);
  assert.match(response.body, /event: done/);
  assert.ok(!response.body.includes('private-reasoning-marker'));
  assert.ok(!logs.includes('private-reasoning-marker'));
});

test('Pro keeps its nonthinking request settings', async () => {
  let sent: Record<string, unknown> = {};
  const provider = deepseekProvider({ ...deepConfig().chat, model: 'deepseek-v4-pro' }, async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(complete);
  });
  for await (const text of provider.stream(payload.messages, new AbortController().signal)) assert.equal(text, '你好');
  assert.deepEqual(sent.thinking, { type: 'disabled' });
  assert.equal(sent.temperature, 0.3);
});

test('disconnect during thinking aborts the upstream before any answer is emitted', async (t) => {
  let aborted = false, cancelled = false;
  let started!: () => void;
  const thinkingStarted = new Promise<void>((resolve) => { started = resolve; });
  const app = await buildApp(deepConfig(), { fetch: async (_url, init) => {
    init!.signal!.addEventListener('abort', () => { aborted = true; }, { once: true });
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { reasoning_content: 'private-only-thinking' } }] }))); started(); },
      cancel() { cancelled = true; },
    }));
  } });
  await app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => app.close());
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(payload), signal: controller.signal });
  const first = await response.body!.getReader().read();
  assert.match(new TextDecoder().decode(first.value), /event: meta/);
  await thinkingStarted;
  controller.abort();
  for (let i = 0; i < 30 && !(aborted && cancelled); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(aborted, true);
  assert.equal(cancelled, true);
});

test('upstream failures and incomplete streams never emit done', async (t) => {
  for (const body of [
    frame({ choices: [{ delta: { content: 'partial' } }] }),
    frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    'data: [DONE]\n\n',
    frame({ choices: [{ delta: {}, finish_reason: 'content_filter' }] }) + 'data: [DONE]\n\n',
    'data: {bad json}\n\n',
  ]) {
    const app = await buildApp(deepConfig(), { fetch: async () => new Response(body) }); t.after(() => app.close());
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload, headers: { accept: 'text/event-stream' } });
    assert.match(response.body, /event: error/); assert.ok(!response.body.includes('event: done'));
  }
  const app = await buildApp(deepConfig(), { fetch: async () => new Response('secret upstream detail', { status: 401 }) }); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload });
  assert.equal(response.statusCode, 502); assert.ok(!response.body.includes('secret upstream detail'));
});

test('timeouts abort upstream and release concurrency; daily quota does not include health', async (t) => {
  let aborted = false;
  const app = await buildApp(config({ API_CHAT_TIMEOUT_MS: '20', API_CHAT_MAX_CONCURRENCY: '1', API_CHAT_DAILY_LIMIT: '2' }), {
    provider: { async *stream(_messages, signal) {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
      signal.throwIfAborted(); yield ''; return { finishReason: 'stop' };
    } },
  }); t.after(() => app.close());
  const first = app.inject({ method: 'POST', url: '/api/chat', payload });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const blocked = await app.inject({ method: 'POST', url: '/api/chat', payload });
  assert.equal(blocked.json().code, 'CONCURRENCY_LIMIT');
  assert.equal((await first).statusCode, 504); assert.equal(aborted, true);
  assert.equal((await app.inject({ url: '/api/health' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/chat', payload })).statusCode, 504);
  assert.equal((await app.inject({ method: 'POST', url: '/api/chat', payload })).json().code, 'DAILY_LIMIT_REACHED');
});

test('real client disconnect aborts a generation and frees its slot', async (t) => {
  let aborted = false;
  const provider: ChatProvider = { async *stream(_messages, signal) {
    yield 'start';
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    signal.throwIfAborted(); return { finishReason: 'stop' };
  } };
  const app = await buildApp(config({ API_CHAT_MAX_CONCURRENCY: '1' }), { provider });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/chat`;
  const controller = new AbortController();
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(payload), signal: controller.signal });
  await response.body!.getReader().read(); controller.abort();
  for (let i = 0; i < 30 && !aborted; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(aborted, true);
  const second = new AbortController();
  const retry = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(payload), signal: second.signal });
  assert.equal(retry.status, 200); second.abort();
});

test('structured logs never contain bodies, headers, IPs, queries, keys or provider errors', async (t) => {
  let logs = '';
  const logStream = new Writable({ write(chunk, _encoding, callback) { logs += String(chunk); callback(); } });
  const app = await buildApp(deepConfig(), { logStream, fetch: async () => { throw new Error('provider-private-error'); } }); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/chat?secret=query-private', remoteAddress: '192.0.2.123', headers: { authorization: 'header-private', 'x-request-id': 'client-private-id' }, payload: { messages: [{ role: 'user', content: 'body-private' }] } });
  assert.equal(response.statusCode, 502);
  for (const secret of ['secret-key', 'query-private', '192.0.2.123', 'header-private', 'client-private-id', 'body-private', 'provider-private-error']) assert.ok(!logs.includes(secret), secret);
  const records = logs.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(records.some((record) => record.id === response.headers['x-request-id']));
  assert.ok(records.some((record) => record.promptVersion && record.knowledgeVersion));
});

test('SSE parser supports byte splits, CRLF, comments and rejects huge or invalid frames', async () => {
  const bytes = Buffer.from(': comment\r\n\r\ndata: 你\r\ndata: 好\r\n\r\n');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const frames = []; for await (const item of readSse(stream, new AbortController().signal)) frames.push(item);
  assert.deepEqual(frames, ['你\n好']);
  for (const body of ['data: ' + 'x'.repeat(65537), 'data: unfinished']) {
    await assert.rejects(async () => { for await (const item of readSse(new Response(body).body!, new AbortController().signal)) { assert.fail(item); } });
  }
});

test('configuration makes paid mode explicit and bounds limits', () => {
  assert.equal(config().chat.mode, 'mock');
  assert.throws(() => config({ API_CHAT_MODE: 'deepseek' }), /DEEPSEEK_API_KEY/);
  assert.equal(config().chat.maxTokens, 10000);
  assert.equal(config().chat.timeoutMs, 120000);
  assert.equal(config({ API_CHAT_MAX_TOKENS: '2048' }).chat.maxTokens, 2048);
  assert.equal(config({ API_CHAT_MAX_TOKENS: '10000' }).chat.maxTokens, 10000);
  for (const env of [{ API_CHAT_MODE: 'invalid' }, { API_CHAT_MAX_TOKENS: '10001' }, { API_CHAT_MAX_CONCURRENCY: '0' }, { DEEPSEEK_MODEL: 'invalid' }]) assert.throws(() => config(env));
});

test('legacy usage-only final chunks and length finish are accepted', async () => {
  const body = frame({ choices: [{ delta: { content: 'cut' }, finish_reason: 'length' }] }) + frame({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }) + 'data: [DONE]\n\n';
  const iterator = deepseekProvider(deepConfig().chat, async () => new Response(body)).stream(payload.messages, new AbortController().signal);
  assert.deepEqual(await iterator.next(), { done: false, value: 'cut' });
  assert.deepEqual(await iterator.next(), { done: true, value: { finishReason: 'length', promptTokens: 3, completionTokens: 1 } });
});

test('health in paid mode never calls the provider', async (t) => {
  let calls = 0;
  const app = await buildApp(deepConfig(), { fetch: async () => { calls++; throw new Error('must not call'); } }); t.after(() => app.close());
  assert.equal((await app.inject({ url: '/api/health' })).json().chat.configured, true);
  assert.equal((await app.inject({ url: '/healthz' })).statusCode, 200);
  assert.equal(calls, 0);
});

test('stream timeout and output bounds terminate with error without done', async (t) => {
  const timeoutApp = await buildApp(config({ API_CHAT_TIMEOUT_MS: '10' }), {
    provider: { async *stream(_messages, signal) {
      yield 'partial';
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      signal.throwIfAborted(); return { finishReason: 'stop' };
    } },
  }); t.after(() => timeoutApp.close());
  const timed = await timeoutApp.inject({ method: 'POST', url: '/api/chat', payload, headers: { accept: 'text/event-stream' } });
  assert.match(timed.body, /REQUEST_TIMEOUT/); assert.ok(!timed.body.includes('event: done'));
  const app = await buildApp(deepConfig(), { fetch: async () => new Response(frame({ choices: [{ delta: { content: 'x'.repeat(16385) }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n') }); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload, headers: { accept: 'text/event-stream' } });
  assert.match(response.body, /OUTPUT_LIMIT/); assert.ok(!response.body.includes('event: done'));
});
