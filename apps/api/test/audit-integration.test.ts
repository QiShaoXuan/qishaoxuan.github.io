import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AuditRecord, AuditStatus, AuditStore } from '../src/audit.js';

const config = (extra: NodeJS.ProcessEnv = {}) => loadConfig({ NODE_ENV: 'test', API_CHAT_MODE: 'deepseek', DEEPSEEK_API_KEY: 'test-configured-key', API_CHAT_AUDIT_ENABLED: 'true', API_CHAT_RATE_LIMIT_MAX: '100', ...extra });
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const payload = { messages: [{ role: 'user', content: '请介绍项目经历' }] };
const completed = frame({ id: 'request-upstream-123', model: 'deepseek-flash', choices: [{ delta: { reasoning_content: 'private-reasoning' } }] })
  + frame({ choices: [{ delta: { content: '项目回答 contact@example.com' }, finish_reason: 'stop' }] })
  + frame({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 24, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20, completion_tokens_details: { reasoning_tokens: 12 } } })
  + 'data: [DONE]\n\n';
function capture(status: AuditStatus = 'stored') {
  const records: AuditRecord[] = [];
  let closed = false, logs = '';
  const store: AuditStore = { async write(record) { records.push(record); return status; }, async close() { closed = true; } };
  const logStream = new Writable({ write(chunk, _encoding, callback) { logs += String(chunk); callback(); } });
  return { records, store, logStream, logs: () => logs, closed: () => closed };
}

test('private redacted audit joins current question, visible answer and upstream telemetry', async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'resume-audit-integration-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const captured = capture();
  const app = await buildApp(config({ API_CHAT_AUDIT_DIR: directory }), { logStream: captured.logStream, fetch: async () => new Response(completed) });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/chat', headers: { accept: 'text/event-stream' }, payload: { messages: [
    { role: 'user', content: 'previous-history-marker' }, { role: 'assistant', content: 'previous-answer-marker' },
    { role: 'user', content: '邮箱 user@example.com 电话 13800138000 密钥 test-configured-key，介绍项目' },
  ] } });
  await app.close();
  assert.match(response.body, /event: done/);
  const files = (await readdir(directory)).filter(file => file.endsWith('.json'));
  assert.equal(files.length, 1);
  const text = await readFile(path.join(directory, files[0]!), 'utf8');
  const record = JSON.parse(text);
  assert.equal(record.id, response.headers['x-request-id']);
  assert.equal(record.upstreamId, 'request-upstream-123');
  assert.equal(record.upstreamStatus, 200);
  assert.equal(record.upstreamModel, 'deepseek-flash');
  assert.equal(record.thinkingEnabled, true);
  assert.equal(record.reasoningEffort, 'high');
  assert.equal(record.promptTokens, 100);
  assert.equal(record.completionTokens, 24);
  assert.equal(record.cacheHitTokens, 80);
  assert.equal(record.cacheMissTokens, 20);
  assert.equal(record.reasoningTokens, 12);
  assert.equal(record.usageStatus, 'complete');
  assert.equal(record.outcome, 'success');
  assert.ok(record.timing >= 0 && record.upstreamDurationMs >= 0 && record.firstReasoningMs >= 0 && record.firstContentMs >= 0);
  assert.ok(record.promptVersion && record.knowledgeVersion);
  assert.match(record.question, /\[REDACTED\]/);
  assert.match(record.answer, /\[REDACTED\]/);
  for (const secret of ['user@example.com', '13800138000', 'test-configured-key', 'contact@example.com', 'private-reasoning', 'previous-history-marker', 'previous-answer-marker']) assert.ok(!text.includes(secret), secret);
  for (const secret of ['user@example.com', '13800138000', 'contact@example.com', 'private-reasoning', 'previous-history-marker', '项目回答', '[REDACTED]']) assert.ok(!captured.logs().includes(secret), secret);
  const journal = captured.logs().trim().split('\n').map(line => JSON.parse(line));
  assert.ok(journal.some(record => record.msg === 'audit' && record.auditStatus === 'stored'));
});

test('incomplete upstream preserves partial answer and request id without inventing token counts', async (t) => {
  const captured = capture();
  const body = frame({ id: 'partial-upstream', choices: [{ delta: { content: '部分回答' } }] });
  const app = await buildApp(config(), { auditStore: captured.store, logStream: captured.logStream, fetch: async () => new Response(body) });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/chat', headers: { accept: 'text/event-stream' }, payload });
  assert.match(response.body, /UPSTREAM_TRUNCATED/);
  assert.ok(!response.body.includes('event: done'));
  assert.equal(captured.records.length, 1);
  const record = captured.records[0]!;
  assert.equal(record.answer, '部分回答');
  assert.equal(record.metadata.upstreamId, 'partial-upstream');
  assert.equal(record.metadata.upstreamStatus, 200);
  assert.equal(record.metadata.outcome, 'error');
  assert.equal(record.metadata.usageStatus, 'missing');
  assert.equal(record.metadata.promptTokens, null);
  assert.equal(record.metadata.completionTokens, null);
  assert.equal(record.metadata.reasoningTokens, null);
});

test('HTTP upstream failures retain safe status and never response body', async (t) => {
  for (const status of [401, 429]) {
    const captured = capture();
    const app = await buildApp(config(), { auditStore: captured.store, logStream: captured.logStream, fetch: async () => new Response('private-upstream-error-body', { status }) });
    t.after(() => app.close());
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload });
    assert.equal(response.statusCode, 502);
    assert.equal(captured.records[0]!.metadata.upstreamStatus, status);
    assert.equal(captured.records[0]!.metadata.upstreamErrorCode, 'UPSTREAM_HTTP_ERROR');
    assert.equal(captured.records[0]!.metadata.errorCode, status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE');
    assert.equal(captured.records[0]!.answer, '');
    assert.ok(!JSON.stringify(captured.records).includes('private-upstream-error-body'));
    assert.ok(!captured.logs().includes('private-upstream-error-body'));
  }
});

test('timeout keeps already observed upstream identity and unknown usage', async (t) => {
  const captured = capture();
  const app = await buildApp(config({ API_CHAT_TIMEOUT_MS: '25' }), {
    auditStore: captured.store, logStream: captured.logStream,
    fetch: async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(frame({ id: 'timeout-upstream', choices: [{ delta: { reasoning_content: 'private-timeout-thought' } }] })));
    } })),
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/chat', payload });
  assert.equal(response.statusCode, 504);
  const metadata = captured.records[0]!.metadata;
  assert.equal(metadata.outcome, 'timeout');
  assert.equal(metadata.upstreamId, 'timeout-upstream');
  assert.equal(metadata.upstreamStatus, 200);
  assert.equal(metadata.usageStatus, 'missing');
  assert.equal(metadata.reasoningTokens, null);
  assert.equal(captured.records[0]!.answer, '');
  assert.ok(!JSON.stringify(captured.records).includes('private-timeout-thought'));
});

test('audit failure or capacity drop does not fail a successful chat; close flushes store', async () => {
  for (const status of ['failed', 'dropped'] as const) {
    const captured = capture(status);
    const app = await buildApp(config(), { auditStore: captured.store, logStream: captured.logStream, fetch: async () => new Response(completed) });
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload });
    assert.equal(response.statusCode, 200);
    await app.close();
    assert.equal(captured.closed(), true);
    const journal = captured.logs().trim().split('\n').map(line => JSON.parse(line));
    assert.ok(journal.some(record => record.msg === 'audit' && record.auditStatus === status));
  }
});

test('invalid requests and explicitly disabled audits never store bodies', async (t) => {
  const captured = capture();
  let calls = 0;
  const app = await buildApp(config(), { auditStore: captured.store, logStream: captured.logStream, fetch: async () => { calls++; return new Response(completed); } });
  t.after(() => app.close());
  const invalid = await app.inject({ method: 'POST', url: '/api/chat', payload: { messages: [] } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(captured.records.length, 0);
  assert.equal(calls, 0);
  const disabled = await buildApp(config({ API_CHAT_AUDIT_ENABLED: 'false' }), { auditStore: captured.store, logStream: captured.logStream, fetch: async () => new Response(completed) });
  t.after(() => disabled.close());
  assert.equal((await disabled.inject({ method: 'POST', url: '/api/chat', payload })).statusCode, 200);
  assert.equal(captured.records.length, 0);
});

test('audit configuration defaults, environment isolation and bounds are explicit', () => {
  const testConfig = loadConfig({ NODE_ENV: 'test' });
  assert.equal(testConfig.audit.enabled, false);
  assert.equal(testConfig.audit.maxBytes, 100 * 1024 * 1024);
  assert.equal(testConfig.audit.retentionDays, 7);
  assert.ok(path.isAbsolute(testConfig.audit.directory));
  assert.equal(loadConfig({ API_CHAT_MODE: 'deepseek', DEEPSEEK_API_KEY: 'test-key' }).audit.enabled, true);
  assert.equal(loadConfig({ NODE_ENV: 'production', DEPLOY_ENV: 'dev', RELEASE_COMMIT: 'a'.repeat(40) }).audit.directory, '/var/lib/resume-development/chat-audit');
  assert.equal(loadConfig({ NODE_ENV: 'production' }).audit.directory, '/var/lib/resume/chat-audit');
  for (const env of [{ API_CHAT_AUDIT_ENABLED: 'yes' }, { API_CHAT_AUDIT_DIR: 'relative' }, { API_CHAT_AUDIT_DIR: '/tmp/\nunsafe' }, { API_CHAT_AUDIT_MAX_BYTES: '0' }, { API_CHAT_AUDIT_MAX_BYTES: String(1024 ** 3 + 1) }, { API_CHAT_AUDIT_RETENTION_DAYS: '8' }]) assert.throws(() => loadConfig(env));
});

test('actual zero token usage is preserved and invalid usage is unknown', async (t) => {
  for (const [usage, expected] of [
    [{ prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } }, 'complete'],
    [{ prompt_tokens: -1, completion_tokens: '5', prompt_cache_hit_tokens: 1.5, completion_tokens_details: { reasoning_tokens: -1 } }, 'missing'],
    [{ prompt_tokens: 3 }, 'partial'],
  ] as const) {
    const captured = capture();
    const body = frame({ choices: [{ delta: { content: '回答' }, finish_reason: 'stop' }], usage }) + 'data: [DONE]\n\n';
    const app = await buildApp(config(), { auditStore: captured.store, logStream: captured.logStream, fetch: async () => new Response(body) });
    t.after(() => app.close());
    assert.equal((await app.inject({ method: 'POST', url: '/api/chat', payload })).statusCode, 200);
    const metadata = captured.records[0]!.metadata;
    assert.equal(metadata.usageStatus, expected);
    if (expected === 'complete') {
      assert.equal(metadata.promptTokens, 0);
      assert.equal(metadata.completionTokens, 0);
      assert.equal(metadata.cacheHitTokens, 0);
      assert.equal(metadata.reasoningTokens, 0);
    } else if (expected === 'missing') {
      assert.equal(metadata.promptTokens, null);
      assert.equal(metadata.completionTokens, null);
      assert.equal(metadata.cacheHitTokens, null);
      assert.equal(metadata.reasoningTokens, null);
    } else {
      assert.equal(metadata.promptTokens, 3);
      assert.equal(metadata.completionTokens, null);
    }
  }
});

test('client cancellation audits the partial answer and observed upstream identity', async (t) => {
  const captured = capture();
  const app = await buildApp(config(), { auditStore: captured.store, logStream: captured.logStream, fetch: async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(frame({ id: 'cancelled-upstream', choices: [{ delta: { content: '取消前的回答' } }] })));
  } })) });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(payload), signal: controller.signal });
  const reader = response.body!.getReader();
  let received = '';
  while (!received.includes('event: delta')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    received += new TextDecoder().decode(chunk.value);
  }
  controller.abort();
  for (let index = 0; index < 100 && !captured.records.length; index++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(captured.records.length, 1);
  const record = captured.records[0]!;
  assert.equal(record.answer, '取消前的回答');
  assert.equal(record.metadata.outcome, 'aborted');
  assert.equal(record.metadata.upstreamId, 'cancelled-upstream');
  assert.equal(record.metadata.upstreamStatus, 200);
  assert.equal(record.metadata.usageStatus, 'missing');
  assert.equal(record.metadata.reasoningTokens, null);
});
