import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { safeDiagnostic } from '../src/diagnostics.js';

const secret = 'diagnostic-private-message-key-body';

function startup(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { NODE_ENV: 'test', API_HOST: '127.0.0.1', ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

test('startup distinguishes missing key, invalid config and occupied port without raw details', async (t) => {
  for (const [env, expected] of [
    [{ API_CHAT_MODE: 'deepseek' }, 'MISSING_DEEPSEEK_KEY'],
    [{ API_CHAT_MODE: secret }, 'INVALID_CHAT_MODE'],
    [{ API_CHAT_MAX_TOKENS: secret }, 'INVALID_INTEGER'],
  ] as const) {
    const result = await startup(env);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stderr), { level: 'error', outcome: 'startup_failed', stage: 'config', errorCategory: expected });
    assert.ok(!result.stderr.includes(secret));
  }
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const result = await startup({ API_PORT: String((server.address() as AddressInfo).port) });
  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stderr), { level: 'error', outcome: 'startup_failed', stage: 'listen', errorCategory: 'EADDRINUSE' });
  assert.ok(!result.stderr.includes('127.0.0.1'));
});

test('request diagnostics classify built-in errors and discard spoofed names and codes', async (t) => {
  let logs = '';
  const logStream = new Writable({ write(chunk, _encoding, callback) { logs += String(chunk); callback(); } });
  const app = await buildApp(loadConfig({ NODE_ENV: 'test' }), { logStream }); t.after(() => app.close());
  const errors = [new TypeError(secret), Object.assign(new Error(secret), { name: secret, code: secret }), Object.assign(new Error(secret), { name: 'TypeError', code: 'EADDRINUSE' })];
  for (const [index, error] of errors.entries()) {
    app.get(`/diagnostic-${index}`, async () => { throw error; });
  }
  for (let index = 0; index < errors.length; index++) {
    const response = await app.inject({ url: `/diagnostic-${index}` });
    assert.equal(response.statusCode, 500); assert.ok(!response.body.includes(secret));
  }
  const diagnostics = logs.trim().split('\n').map((line) => JSON.parse(line)).filter((entry) => entry.msg === 'diagnostic');
  assert.deepEqual(diagnostics.map((entry) => entry.errorCategory), ['TYPE_ERROR', 'INTERNAL_ERROR', 'INTERNAL_ERROR']);
  assert.ok(diagnostics.every((entry) => entry.stage === 'request' && entry.status === 500));
  assert.ok(!logs.includes(secret)); assert.ok(!logs.includes('EADDRINUSE'));
  assert.deepEqual(safeDiagnostic({ name: secret, code: secret }, 'build'), { stage: 'build', errorCategory: 'UNKNOWN_ERROR' });
});
