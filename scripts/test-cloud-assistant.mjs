import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CHUNK_BYTES, COMMAND_LIMIT, aliyunCli, cliFailure, commandToken, deploymentTarget, encodeCommand, prepareReleaseCommand, runCommand, splitChunks, verifyPublicApi } from './cloud-assistant.mjs';

const commit = 'a'.repeat(40);
const env = { ECS_INSTANCE_ID: 'i-test123', ALIYUN_REGION: 'cn-beijing', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
const target = deploymentTarget('dev', commit, env);
const invocation = (overrides = {}) => ({ Invocation: { InvocationResults: { InvocationResult: [{
  InvokeId: 't-test123', InstanceId: env.ECS_INSTANCE_ID, InvocationStatus: 'Success', ExitCode: 0, Dropped: 0, Output: '', ...overrides,
}] } } });
const fakeCli = (result) => async (args) => args[1] === 'RunCommand' ? { InvokeId: 't-test123' } : result;
const options = { log: () => {}, sleep: async () => {} };

test('target maps prod/dev to distinct users, roots, release attempts and API paths', () => {
  assert.equal(target.user, 'resume-dev');
  assert.equal(target.base, '/srv/resume-development');
  assert.equal(target.api, 'https://101.201.78.159/dev/api');
  assert.equal(deploymentTarget('prod', commit, env).user, 'resume');
  assert.equal(deploymentTarget('prod', commit, env).api, 'https://101.201.78.159/api');
  assert.notEqual(target.releaseId, deploymentTarget('dev', commit, { ...env, GITHUB_RUN_ATTEMPT: '2' }).releaseId);
  for (const [key, value] of [['ECS_INSTANCE_ID', 'i-test;id'], ['ALIYUN_REGION', 'cn-hangzhou'], ['GITHUB_RUN_ID', '../bad'], ['GITHUB_RUN_ATTEMPT', '0']]) {
    assert.throws(() => deploymentTarget('dev', commit, { ...env, [key]: value }));
  }
  assert.throws(() => deploymentTarget('unknown', commit, env));
  assert.throws(() => deploymentTarget('dev', 'not-a-sha', env));
});

test('chunk boundaries reconstruct bytes and double-base64 commands remain below limit', () => {
  for (const length of [0, 1, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, CHUNK_BYTES * 2]) {
    const input = Buffer.alloc(length, 255);
    const chunks = splitChunks(input);
    assert.deepEqual(Buffer.concat(chunks), input);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 9000);
      const command = `printf '%s' '${chunk.toString('base64')}' | base64 --decode > '/srv/resume-development/incoming/${target.releaseId}/api-release.tgz.part-000001'`;
      const encoded = encodeCommand(command);
      assert.ok(encoded.length <= COMMAND_LIMIT);
      assert.equal(Buffer.from(encoded, 'base64').toString(), command);
    }
  }
  assert.throws(() => encodeCommand('x'.repeat(COMMAND_LIMIT)), /exceeds/);
});

test('RunCommand submission retry keeps the idempotency token and validates actual async completion', async () => {
  const submissions = []; let polls = 0;
  await runCommand(target, 'echo ready', 4, { ...options, cli: async (args) => {
    if (args[1] === 'RunCommand') {
      submissions.push(args);
      if (submissions.length === 1) throw cliFailure('', { code: 'ECONNRESET' });
      return { InvokeId: 't-test123' };
    }
    polls++;
    if (polls === 1) return { Invocation: { InvocationResults: { InvocationResult: [] } } };
    return invocation({ InvocationStatus: polls === 2 ? 'Running' : 'Success' });
  } });
  assert.equal(polls, 3);
  assert.deepEqual(submissions[0], submissions[1]);
  assert.equal(submissions[0].at(-1), commandToken(target, 4, 'echo ready'));
  assert.notEqual(commandToken(target, 4, 'echo ready'), commandToken(target, 5, 'echo ready'));
  assert.notEqual(commandToken(target, 4, 'echo ready'), commandToken(target, 4, 'echo changed'));
  assert.equal(commandToken(target, 0, 'x').length, 64);
});

test('asynchronous nonzero exit, terminal failure and dropped output reject deployment', async () => {
  for (const result of [{ ExitCode: 1 }, { InvocationStatus: 'Failed' }, { InvocationStatus: 'Timeout' }, { Dropped: 1 }, { ExitCode: '0' }, { ErrorCode: 'ExecutionException' }]) {
    await assert.rejects(runCommand(target, 'false', 1, { ...options, cli: fakeCli(invocation(result)) }));
  }
  await assert.rejects(runCommand(target, 'false', 1, { ...options, cli: fakeCli(invocation({ ExitCode: 2, Output: Buffer.from('x'.repeat(6000)).toString('base64') })) }), (error) => error.message.length < 4200);
});

test('invocation and instance mismatch, malformed response or invalid output are rejected', async () => {
  for (const result of [invocation({ InvokeId: 't-other' }), invocation({ InstanceId: 'i-other' }), {}, invocation({ Output: 'not base64!' })]) {
    await assert.rejects(runCommand(target, 'echo ready', 1, { ...options, cli: fakeCli(result) }));
  }
});

test('polling deadline is bounded when instance never completes', async () => {
  let clock = 0;
  await assert.rejects(runCommand(target, 'sleep 999', 1, { ...options, timeout: 1, now: () => clock,
    sleep: async (ms) => { clock += ms; }, cli: fakeCli(invocation({ InvocationStatus: 'Pending' })),
  }), /timed out/);
  assert.ok(clock <= 33_000);
});

function publicFetch(healthOverrides = {}, cors = true) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok', service: 'resume-api', commit, environment: 'dev', ...healthOverrides }));
    const headers = cors ? { 'access-control-allow-origin': 'https://qishaoxuan.github.io', 'access-control-allow-methods': 'GET, HEAD, POST', 'access-control-allow-headers': 'content-type' } : {};
    if (init.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    return new Response(JSON.stringify({ mode: 'mock', message: { role: 'assistant', content: 'test reply' } }), { headers });
  };
  return { fetch, requests };
}
test('public verification rejects wrong commit/environment before any chat request', async () => {
  for (const overrides of [{ commit: 'b'.repeat(40) }, { environment: 'prod' }, { status: 'down' }]) {
    const client = publicFetch(overrides);
    await assert.rejects(verifyPublicApi(target, client), /commit\/environment mismatch/);
    assert.equal(client.requests.length, 1);
  }
});
test('public verification checks mock chat and CORS without redirect or TLS bypass', async () => {
  const client = publicFetch();
  await verifyPublicApi(target, client);
  assert.equal(client.requests.length, 3);
  assert.ok(client.requests.every(({ url, init }) => url.startsWith(target.api) && init.redirect === 'error' && init.signal instanceof AbortSignal));
  assert.equal(client.requests[1].init.method, 'POST');
  assert.equal(client.requests[2].init.method, 'OPTIONS');
  await assert.rejects(verifyPublicApi(target, publicFetch({}, false)), /CORS/);
});
test('release shell validates checksums and archive before extracting into a new version', () => {
  const command = prepareReleaseCommand(target, 'b'.repeat(64), 'c'.repeat(64));
  assert.equal(spawnSync('bash', ['-n'], { input: command, encoding: 'utf8' }).status, 0);
  assert.match(command, /sha256sum --check --strict/);
  assert.match(command, /assert not os\.path\.lexists\(release\)/);
  assert.match(command, /member\.isfile\(\)/);
  assert.match(command, /npm ci --omit=dev --ignore-scripts/);
  assert.match(command, /activate-api\.sh' dev/);
  assert.ok(encodeCommand(command).length < COMMAND_LIMIT);
});

test('real archive validator rejects traversal, links and duplicate members before extraction', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-upload-test-'));
  const validator = prepareReleaseCommand(target, 'b'.repeat(64), 'c'.repeat(64)).split("<<'PYTHON'\n")[1].split('\nPYTHON')[0];
  try {
    for (const attack of ['traversal', 'symlink', 'duplicate', 'absolute', 'valid']) {
      const archive = path.join(directory, `${attack}.tgz`);
      const release = path.join(directory, attack);
      const fixture = spawnSync('python3', ['-c', `import io,tarfile,sys
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    names=['server.js','package.json','package-lock.json','version.json','release.env']
    attack=sys.argv[2]
    if attack=='traversal': names+=['../escape.js']
    if attack=='absolute': names+=['/tmp/escape.js']
    if attack=='duplicate': names+=['server.js']
    if attack=='symlink': names+=['link.js']
    for name in names:
        item=tarfile.TarInfo(name)
        if name=='link.js':
            item.type=tarfile.SYMTYPE
            item.linkname='/tmp/outside'
            archive.addfile(item)
        else:
            item.size=2
            archive.addfile(item, io.BytesIO(b'{}'))`, archive, attack], { encoding: 'utf8' });
      assert.equal(fixture.status, 0, fixture.stderr);
      const result = spawnSync('python3', ['-c', validator, archive, release], { encoding: 'utf8' });
      if (attack === 'valid') assert.equal(result.status, 0, result.stderr);
      else assert.notEqual(result.status, 0, attack);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function processStub({ stderr = '', stdout = '', exitCode = 1, systemCode } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stderr.end(stderr);
      child.stdout.end(stdout);
      if (systemCode) child.emit('error', Object.assign(new Error('secret error message'), { code: systemCode }));
      child.emit('close', exitCode);
    });
    return child;
  };
}
test('real CLI transport exposes only bounded structured diagnostics and classifies failures', async () => {
  const requestId = '12345678-abcd-1234-abcd-1234567890ab';
  for (const [stderr, code, retryable] of [
    [`ERROR: SDK.ServerError\nErrorCode: Forbidden.RAM\nRequestId: ${requestId}\nStatusCode: 403\nMessage: SECRET_CREDENTIAL --CommandContent TOP_SECRET`, 'Forbidden.RAM', false],
    [JSON.stringify({ Code: 'InvalidSecurityToken.Expired', RequestId: requestId, StatusCode: 403, Message: 'SECRET_CREDENTIAL' }), 'InvalidSecurityToken.Expired', false],
    ['ErrorCode: Throttling.User\nStatusCode: 429\nMessage: SECRET_CREDENTIAL', 'Throttling.User', true],
    ['ErrorCode: InternalError\nStatusCode: 500\nMessage: SECRET_CREDENTIAL', 'InternalError', true],
  ]) {
    await assert.rejects(aliyunCli(['ecs', 'RunCommand', 'SECRET_ARG'], { spawnProcess: processStub({ stderr }) }), (error) => {
      assert.equal(error.retryable, retryable);
      assert.match(error.message, new RegExp(code.replaceAll('.', '\\.')));
      assert.doesNotMatch(error.message, /SECRET|Message|CommandContent/);
      return true;
    });
  }
  await assert.rejects(aliyunCli([], { spawnProcess: processStub({ stderr: 'SECRET'.repeat(20000), systemCode: 'ENOENT' }) }), (error) => {
    assert.equal(error.retryable, false);
    assert.match(error.message, /ENOENT/);
    assert.ok(error.message.length < 200);
    return true;
  });
  await assert.rejects(aliyunCli([], { spawnProcess: processStub({ systemCode: 'ETIMEDOUT' }) }), (error) => error.retryable === true && /ETIMEDOUT/.test(error.message));
});
test('permanent authorization or malformed CLI failure submits once; explicit transient errors retry three times with same token', async () => {
  for (const [error, count] of [
    [cliFailure('ErrorCode: Forbidden.RAM\nStatusCode: 403'), 1],
    [cliFailure('ErrorCode: InvalidParameter.Username'), 1],
    [cliFailure('ErrorCode: InvalidSecurityToken.Expired'), 1],
    [new Error('raw SECRET token must never escape'), 1],
    [cliFailure('ErrorCode: Throttling.User\nStatusCode: 429'), 3],
    [cliFailure('', { code: 'ECONNRESET' }), 3],
  ]) {
    const calls = [];
    await assert.rejects(runCommand(target, 'echo SECRET_SCRIPT', 9, { ...options, cli: async (args) => { calls.push(args); throw error; } }), (failure) => {
      assert.doesNotMatch(failure.message, /SECRET/);
      if (error.safeDiagnostics?.ErrorCode) assert.ok(failure.message.includes(error.safeDiagnostics.ErrorCode));
      return true;
    });
    assert.equal(calls.length, count);
    for (const call of calls) assert.deepEqual(call, calls[0]);
  }
});

test('CLI local failure codes and numeric exit codes survive submission sanitization without raw output', async () => {
  for (const [transport, expected, hint] of [
    [{ stdout: 'SECRET malformed response', exitCode: 0 }, 'INVALID_JSON', 'invalid JSON response'],
    [{ stdout: 'SECRET'.repeat(200000), exitCode: 0 }, 'OUTPUT_LIMIT', 'response exceeded output limit'],
    [{ stderr: 'SECRET unstructured stderr', exitCode: 17 }, undefined, undefined],
  ]) {
    let attempts = 0;
    await assert.rejects(runCommand(target, 'SECRET command', 5, { ...options, cli: async (args) => {
      attempts++;
      return aliyunCli(args, { spawnProcess: processStub(transport) });
    } }), (error) => {
      assert.equal(error.retryable, false);
      assert.equal(error.safeDiagnostics.ExitCode, transport.exitCode);
      assert.equal(error.safeDiagnostics.LocalCode, expected);
      assert.ok(error.message.includes(`ExitCode=${transport.exitCode}`));
      if (hint) assert.ok(error.message.includes(hint));
      assert.doesNotMatch(error.message, /SECRET/);
      return true;
    });
    assert.equal(attempts, 1);
  }
});

test('both API operations explicitly pass CLI global region as well as API RegionId', async () => {
  const calls = [];
  await runCommand(target, 'echo ready', 0, { ...options, cli: async (args) => {
    calls.push(args);
    return args[1] === 'RunCommand' ? { InvokeId: 't-test123' } : invocation();
  } });
  assert.equal(calls.length, 2);
  for (const args of calls) {
    assert.equal(args[args.indexOf('--region') + 1], 'cn-beijing');
    assert.equal(args[args.indexOf('--RegionId') + 1], 'cn-beijing');
  }
});
test('official CLI local parser/profile errors from stderr or stdout map to fixed safe diagnostics', async () => {
  for (const [raw, expected] of [
    ["ERROR: region can't be empty\n\nConfiguration failed, use `aliyun configure` to configure it\n", 'CLI_REGION_REQUIRED'],
    ["ERROR: profile SECRET is not configure yet\nConfiguration failed, use `aliyun configure` to configure it.\n", 'CLI_CREDENTIALS_REQUIRED'],
    ["ERROR: invalid flag --SECRET_COMMAND_CONTENT\n", 'CLI_ARGUMENT_ERROR'],
  ]) {
    for (const stream of ['stdout', 'stderr']) {
      let count = 0;
      await assert.rejects(runCommand(target, 'SECRET_SCRIPT', 0, { ...options, cli: async (args) => {
        count++;
        return aliyunCli(args, { spawnProcess: processStub({ [stream]: raw, exitCode: 3 }) });
      } }), (error) => {
        assert.equal(error.safeDiagnostics.LocalCode, expected);
        assert.equal(error.safeDiagnostics.ExitCode, 3);
        assert.doesNotMatch(error.message, /SECRET/);
        return true;
      });
      assert.equal(count, 1);
    }
  }
});
