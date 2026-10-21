import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createAuditStore, redactText } from '../src/audit.js';
import type { AuditOptions, AuditRecord, AuditStore } from '../src/audit.js';

const record = (id: number, answer = '公开回答'): AuditRecord => ({ question: '介绍一下项目经历', answer, metadata: { requestId: `request-${id}`, env: 'test', thinking: true } });

async function fixture(run: (store: AuditStore, directory: string, parent: string) => Promise<void>, overrides: Partial<AuditOptions> = {}, secrets: string[] = []) {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'resume-audit-')));
  const directory = path.join(parent, 'records');
  const store = createAuditStore({ directory, maxBytes: 100 * 1024 * 1024, retentionDays: 7, ...overrides }, secrets);
  try { await run(store, directory, parent); }
  finally { await store.close(); await rm(parent, { recursive: true, force: true }); }
}

async function records(directory: string): Promise<Record<string, unknown>[]> {
  const names = (await readdir(directory)).filter(name => name.endsWith('.json'));
  return Promise.all(names.map(async name => JSON.parse(await readFile(path.join(directory, name), 'utf8')) as Record<string, unknown>));
}

test('redaction removes configured secrets, credentials, URL data and common personal identifiers', () => {
  const sensitive = ['opaque.configured.secret', 'sk-otherABCDefghijklmnop', 'password-value', 'bearer-value', 'alice+work@example.com', '13800138000', '11010519491231002X', '4111111111111111', '192.0.2.42', '2001:db8::1234', '张三', 'url-user', 'url-pass', 'query-secret'];
  const input = `${sensitive[0]} ${sensitive[1]} password="password-value" Bearer bearer-value 邮箱 alice+work@example.com 手机13800138000 身份证11010519491231002X 银行卡4111111111111111 IP192.0.2.42 IPv6 2001:db8::1234 联系人：张三\nhttps://url-user:url-pass@example.com/path?arbitrary=query-secret#token-secret`;
  const output = redactText(input, [sensitive[0]!]);
  for (const value of sensitive) assert.ok(!output.includes(value), value);
  assert.ok(!output.includes('token-secret'));
  assert.match(output, /\[REDACTED\]/);
  assert.equal(redactText('React + TypeScript，20 条上限，耗时约 1.2 秒'), 'React + TypeScript，20 条上限，耗时约 1.2 秒');
});

test('records are private JSON files with sanitized question/answer and associated metadata', () => fixture(async (store, directory) => {
  assert.equal(await store.write({ question: '邮箱 a@example.com\n"metadata":"injection"', answer: '密钥：opaque.configured.secret，已停止', metadata: { requestId: 'safe-request', upstreamId: 'deepseek-response', outcome: 'aborted', promptTokens: 123 } }), 'stored');
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^chat-\d{13}-[a-f0-9-]{36}\.json$/);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(directory, files[0]!))).mode & 0o777, 0o600);
  const [saved] = await records(directory);
  assert.equal(saved?.requestId, 'safe-request');
  assert.equal(saved?.upstreamId, 'deepseek-response');
  assert.equal(saved?.promptTokens, 123);
  assert.equal(saved?.outcome, 'aborted');
  assert.ok(!JSON.stringify(saved).includes('opaque.configured.secret'));
  assert.ok(!JSON.stringify(saved).includes('a@example.com'));
  assert.equal(saved?.question, '邮箱 [REDACTED]\n"metadata":"injection"');
  assert.equal(saved?.redactionVersion, 'patterns-v1');
}, {}, ['opaque.configured.secret']));

test('record byte bounds include JSON escaping and mark truncated text', () => fixture(async (store, directory) => {
  assert.equal(await store.write({ question: '中'.repeat(10000), answer: '\u0000\n'.repeat(20000), metadata: { requestId: 'long' } }), 'stored');
  const names = await readdir(directory);
  assert.ok((await stat(path.join(directory, names[0]!))).size <= 32 * 1024);
  const [saved] = await records(directory);
  assert.equal(saved?.questionTruncated, true);
  assert.equal(saved?.answerTruncated, true);
  assert.ok(!String(saved?.question).includes('\ufffd'));
  assert.equal(await store.write({ ...record(2), metadata: { excessive: 'x'.repeat(40000) } }), 'dropped');
}));

test('capacity pruning removes oldest managed records without deleting unrelated files', () => fixture(async (store, directory) => {
  await store.write(record(0, 'a'.repeat(200)));
  const first = (await readdir(directory))[0]!;
  const old = new Date(Date.now() - 3600000);
  await utimes(path.join(directory, first), old, old);
  await writeFile(path.join(directory, 'notes.txt'), 'leave alone');
  for (let i = 1; i <= 8; i++) assert.equal(await store.write(record(i, 'a'.repeat(200))), 'stored');
  const names = (await readdir(directory)).filter(name => name.endsWith('.json'));
  const sizes = await Promise.all(names.map(async name => (await stat(path.join(directory, name))).size));
  assert.ok(sizes.reduce((a, b) => a + b, 0) <= 1000);
  assert.ok((await records(directory)).some(saved => saved.requestId === 'request-8'));
  assert.ok(!(await records(directory)).some(saved => saved.requestId === 'request-0'));
  assert.equal(await readFile(path.join(directory, 'notes.txt'), 'utf8'), 'leave alone');
}, { maxBytes: 1000 }));

test('file-count bound removes oldest records even when byte capacity remains available', () => fixture(async (store, directory) => {
  for (let i = 0; i < 8; i++) assert.equal(await store.write(record(i)), 'stored');
  assert.equal((await records(directory)).length, 3);
  assert.ok((await records(directory)).some(saved => saved.requestId === 'request-7'));
  assert.ok(!(await records(directory)).some(saved => saved.requestId === 'request-0'));
}, { maxFiles: 3 }));

test('configured secrets with JSON punctuation are removed without corrupting metadata serialization', () => fixture(async (store, directory) => {
  const secret = 'opaque"secret\\value';
  assert.equal(await store.write({ ...record(1), metadata: { harmless: `prefix ${secret} suffix` } }), 'stored');
  assert.equal((await records(directory))[0]?.harmless, 'prefix [REDACTED] suffix');
}, {}, ['opaque"secret\\value']));

test('startup cleanup removes expired files and stale temporary files', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'resume-audit-')));
  const directory = path.join(parent, 'records');
  await mkdir(directory);
  const oldFile = path.join(directory, `chat-${Date.now()}-${randomUUID()}.json`);
  const temporary = path.join(directory, `chat-${Date.now()}-${randomUUID()}.tmp`);
  await writeFile(oldFile, '{}'); await writeFile(temporary, 'incomplete');
  const old = new Date(Date.now() - 8 * 86400000);
  await utimes(oldFile, old, old);
  const store = createAuditStore({ directory, maxBytes: 10000, retentionDays: 7 });
  try { await store.close(); assert.deepEqual(await readdir(directory), []); }
  finally { await rm(parent, { recursive: true, force: true }); }
});

test('hourly cleanup expires records while no new conversations arrive', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  await fixture(async (store, directory) => {
    assert.equal(await store.write(record(1)), 'stored');
    const name = (await readdir(directory))[0]!;
    const old = new Date(Date.now() - 8 * 86400000);
    await utimes(path.join(directory, name), old, old);
    t.mock.timers.tick(3600000);
    await store.close();
    assert.deepEqual(await readdir(directory), []);
  });
});

test('startup and hourly cleanup failures notify only through a safe callback', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'resume-audit-')));
  const directory = path.join(parent, 'records');
  await mkdir(directory);
  await symlink(path.join(parent, 'missing'), path.join(directory, 'unexpected-link'));
  let notifications = 0;
  const store = createAuditStore({ directory, maxBytes: 10000, retentionDays: 7 }, [], () => { notifications++; throw new Error('callback failure'); });
  try {
    // Queue a write to wait for startup cleanup without closing the timer.
    assert.equal(await store.write(record(1)), 'failed');
    assert.equal(notifications, 1);
    t.mock.timers.tick(3600000);
    await store.close();
    assert.equal(notifications, 2);
  } finally { await store.close(); await rm(parent, { recursive: true, force: true }); }
});

test('two stores serialize capacity changes through the filesystem lock', () => fixture(async (first, directory) => {
  const second = createAuditStore({ directory, maxBytes: 1000, retentionDays: 7 });
  try {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).write(record(i, 'z'.repeat(200)))));
    assert.ok(results.every(status => status === 'stored'));
    const names = (await readdir(directory)).filter(name => name.endsWith('.json'));
    const sizes = await Promise.all(names.map(async name => (await stat(path.join(directory, name))).size));
    assert.ok(sizes.reduce((a, b) => a + b, 0) <= 1000);
  } finally { await second.close(); }
}, { maxBytes: 1000 }));

test('queue capacity and close reject additional records without unbounded buffering', () => fixture(async (store, directory) => {
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => store.write(record(i))));
  assert.equal(results.filter(status => status === 'dropped').length, 8);
  assert.equal(results.filter(status => status === 'stored').length, 32);
  await store.close();
  assert.equal(await store.write(record(41)), 'dropped');
  assert.equal((await records(directory)).length, 32);
}));

test('unsafe paths, contaminated directories and blocked locks fail closed without touching targets', () => fixture(async (store, directory, parent) => {
  assert.equal(await store.write(record(1)), 'stored');
  const victim = path.join(parent, 'victim'); await writeFile(victim, 'do not modify');
  const link = path.join(directory, `chat-${Date.now()}-${randomUUID()}.json`);
  await symlink(victim, link);
  assert.equal(await store.write(record(2)), 'failed');
  assert.equal(await readFile(victim, 'utf8'), 'do not modify');
  await rm(link);
  await mkdir(path.join(directory, '.lock'));
  assert.equal(await store.write(record(3)), 'failed');
  assert.equal((await stat(path.join(directory, '.lock'))).isDirectory(), true);
  await rm(path.join(directory, '.lock'), { recursive: true });
  const outside = path.join(parent, 'outside'); await mkdir(outside);
  const ancestor = path.join(parent, 'linked'); await symlink(outside, ancestor);
  const unsafe = createAuditStore({ directory: path.join(ancestor, 'records'), maxBytes: 1000, retentionDays: 7 });
  try { assert.equal(await unsafe.write(record(4)), 'failed'); assert.deepEqual(await readdir(outside), []); }
  finally { await unsafe.close(); }
}));

test('an over-budget record is dropped and existing directory permissions are tightened', () => fixture(async (store, directory) => {
  assert.equal(await store.write(record(1)), 'dropped');
  await store.close();
  assert.deepEqual(await readdir(directory), []);
  await chmod(directory, 0o755);
  const next = createAuditStore({ directory, maxBytes: 10000, retentionDays: 7 });
  try { assert.equal(await next.write(record(2)), 'stored'); assert.equal((await stat(directory)).mode & 0o777, 0o700); }
  finally { await next.close(); }
}, { maxBytes: 10 }));

test('long ordinary ASCII tokens are preserved by email filtering', () => {
  const plain = 'a'.repeat(16384);
  assert.equal(redactText(plain), plain);
  assert.equal(redactText(plain + '@example.com'), '[REDACTED]');
});
