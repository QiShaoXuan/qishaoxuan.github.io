import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const CHUNK_BYTES = 9000;
export const COMMAND_LIMIT = 24 * 1024;
const origin = 'https://qishaoxuan.github.io';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shell = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

export function deploymentTarget(environment, commit, env = process.env) {
  if (!['prod', 'dev'].includes(environment)) throw new Error('Environment must be prod or dev');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Expected a lowercase 40-character commit SHA');
  if (!/^i-[a-zA-Z0-9]+$/.test(env.ECS_INSTANCE_ID ?? '')) throw new Error('Invalid ECS_INSTANCE_ID');
  if (env.ALIYUN_REGION !== 'cn-beijing') throw new Error('ALIYUN_REGION must be cn-beijing');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) {
    if (!/^[1-9]\d{0,19}$/.test(env[key] ?? '')) throw new Error(`Invalid ${key}`);
  }
  return {
    environment, commit, instanceId: env.ECS_INSTANCE_ID, region: env.ALIYUN_REGION,
    user: environment === 'prod' ? 'resume' : 'resume-dev',
    base: environment === 'prod' ? '/srv/resume' : '/srv/resume-development',
    releaseId: `${commit}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    api: `https://101.201.78.159${environment === 'dev' ? '/dev' : ''}/api`,
  };
}

export function encodeCommand(command) {
  const encoded = Buffer.from(command).toString('base64');
  if (Buffer.byteLength(encoded) > COMMAND_LIMIT) throw new Error('Cloud Assistant command exceeds 24 KiB');
  return encoded;
}
export function splitChunks(bytes) {
  return Array.from({ length: Math.ceil(bytes.length / CHUNK_BYTES) }, (_, index) => bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES));
}
export function commandToken(target, step, command) {
  if (!Number.isSafeInteger(step) || step < 0 || step > 99999) throw new Error('Invalid command sequence');
  return digest(`${target.environment}:${target.releaseId}:${step}:${digest(command)}`);
}

const systemCodes = new Set(['ENOENT', 'EACCES', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']);
const localHints = {
  INVALID_JSON: 'invalid JSON response', OUTPUT_LIMIT: 'response exceeded output limit',
  CLI_REGION_REQUIRED: 'CLI global region is missing; supply --region',
  CLI_CREDENTIALS_REQUIRED: 'CLI credentials or profile configuration is missing',
  CLI_ARGUMENT_ERROR: 'CLI rejected command arguments; check the API schema',
};
const transientSystemCodes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']);
const apiCodeRoots = new Set(['Forbidden', 'InvalidParameter', 'MissingParameter', 'InvalidAccessKeyId', 'SignatureDoesNotMatch',
  'InvalidSecurityToken', 'SecurityTokenExpired', 'InvalidRegionId', 'InvalidInstanceId', 'InvalidAction', 'InvalidVersion',
  'Throttling', 'ThrottlingException', 'InternalError', 'InternalFailure', 'ServiceUnavailable', 'RequestTimeout', 'OperationDenied']);
const transientApiRoots = new Set(['Throttling', 'ThrottlingException', 'InternalError', 'InternalFailure', 'ServiceUnavailable', 'RequestTimeout']);

// Parse only typed diagnostic fields. Untrusted CLI prose, request URLs, credentials and
// command contents never become part of an exception or a log line.
export function cliFailure(stderr = '', { code, status, exitCode, localCode, timedOut = false } = {}) {
  // Known CLI-local messages are mapped to fixed labels, never copied to diagnostics.
  if (!localCode) {
    if (/(?:^|\n)(?:ERROR: )?region can't be empty\s*(?:\n|$)/.test(stderr)) localCode = 'CLI_REGION_REQUIRED';
    else if (/(?:^|\n)Configuration failed, use `aliyun configure` to configure it\.?\s*(?:\n|$)/.test(stderr)) localCode = 'CLI_CREDENTIALS_REQUIRED';
    else if (/(?:^|\n)ERROR: (?:invalid flag |unknown flag |not support flag form |too many arguments|missing required parameter)/.test(stderr)) localCode = 'CLI_ARGUMENT_ERROR';
  }
  let structured;
  try { structured = JSON.parse(stderr); } catch { /* CLI also emits line-based SDK errors. */ }
  const candidate = structured?.Code ?? structured?.ErrorCode ?? stderr.match(/(?:^|\n)\s*(?:ErrorCode|Code):\s*([A-Za-z][A-Za-z0-9.]{0,95})\s*(?:\r?\n|$)/)?.[1];
  const root = typeof candidate === 'string' ? candidate.split('.')[0] : '';
  // Preserve recognized roots and bounded suffixes; never expose arbitrary code values.
  const apiCode = apiCodeRoots.has(root) && /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]{0,31}){0,2}$/.test(candidate) ? candidate : undefined;
  const requestCandidate = structured?.RequestId ?? stderr.match(/(?:^|\n)\s*RequestId:\s*([A-Fa-f0-9-]{36})\s*(?:\r?\n|$)/)?.[1];
  const requestId = typeof requestCandidate === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestCandidate) ? requestCandidate : undefined;
  const statusCandidate = status ?? structured?.StatusCode ?? structured?.HttpStatusCode ?? stderr.match(/(?:^|\n)\s*(?:StatusCode|HTTPStatus|HttpStatusCode):\s*([1-5]\d{2})\s*(?:\r?\n|$)/)?.[1];
  const httpStatus = /^[1-5]\d{2}$/.test(String(statusCandidate)) ? Number(statusCandidate) : undefined;
  const systemCode = timedOut ? 'ETIMEDOUT' : systemCodes.has(code) ? code : systemCodes.has(candidate) ? candidate : undefined;
  const safeLocalCode = Object.hasOwn(localHints, localCode) ? localCode : undefined;
  const fields = { ...(safeLocalCode ? { LocalCode: safeLocalCode } : {}), ...(Number.isSafeInteger(exitCode) ? { ExitCode: exitCode } : {}), ...(apiCode ? { ErrorCode: apiCode } : {}), ...(requestId ? { RequestId: requestId } : {}),
    ...(httpStatus ? { HTTPStatus: httpStatus } : {}), ...(systemCode ? { SystemCode: systemCode } : {}) };
  const diagnostic = Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(', ');
  const failure = new Error(`Aliyun CLI failed${diagnostic ? ` (${diagnostic})` : ' (exit unknown)'}${safeLocalCode ? `: ${localHints[safeLocalCode]}` : ''}`);
  failure.safeDiagnostics = fields;
  // Explicit permanent API errors win even when an upstream response uses HTTP 5xx.
  failure.retryable = safeLocalCode ? false : apiCode ? transientApiRoots.has(root) : transientSystemCodes.has(systemCode) || [429, 500, 502, 503, 504].includes(httpStatus);
  return failure;
}
function safeCliError(error) {
  const fields = error?.safeDiagnostics ?? {};
  return cliFailure(JSON.stringify({ ErrorCode: fields.ErrorCode, RequestId: fields.RequestId }), {
    code: fields.SystemCode ?? error?.code, status: fields.HTTPStatus, exitCode: fields.ExitCode, localCode: fields.LocalCode,
  });
}

// Credentials are inherited from the OIDC-configured CLI environment. Never log CLI arguments,
// command content, credentials, or raw CLI stderr (which may echo request parameters).
export function aliyunCli(args, { spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnProcess('aliyun', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env }); }
    catch (error) { reject(cliFailure('', { code: error.code })); return; }
    let output = ''; let stderr = ''; let size = 0; let excessive = false; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 60_000);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) { excessive = true; child.kill('SIGKILL'); } else output += chunk;
    });
    // Drain everything but retain at most 64 KiB for structured diagnostic extraction.
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8').slice(0, Math.max(0, 65536 - stderr.length)); });
    child.on('error', (error) => { clearTimeout(timer); reject(cliFailure(stderr, { code: error.code })); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (excessive) return reject(cliFailure('', { localCode: 'OUTPUT_LIMIT', exitCode: code }));
      if (timedOut || code !== 0) {
        const stderrFailure = cliFailure(stderr, { exitCode: code, timedOut });
        const stdoutFailure = cliFailure(output.slice(0, 65536), { exitCode: code, timedOut });
        const hasDiagnostic = (error) => Object.keys(error.safeDiagnostics).some((key) => key !== 'ExitCode');
        return reject(hasDiagnostic(stderrFailure) ? stderrFailure : stdoutFailure);
      }
      try { resolve(JSON.parse(output)); } catch { reject(cliFailure('', { localCode: 'INVALID_JSON', exitCode: code })); }
    });
  });
}

function diagnostics(result) {
  const output = result.Output ?? '';
  if (typeof output !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(output) || output.length % 4 !== 0) {
    throw new Error('Cloud Assistant returned invalid base64 output');
  }
  return Buffer.from(output, 'base64').toString('utf8').slice(0, 4000);
}
export async function runCommand(target, command, step, {
  cli = aliyunCli, sleep = pause, now = Date.now, timeout = 900, log = console.info,
} = {}) {
  const content = encodeCommand(command);
  const token = commandToken(target, step, command);
  const args = ['ecs', 'RunCommand', '--region', target.region, '--RegionId', target.region, '--InstanceId.1', target.instanceId,
    '--Type', 'RunShellScript', '--CommandContent', content, '--ContentEncoding', 'Base64',
    '--Username', target.user, '--WorkingDir', target.base, '--Timeout', String(timeout),
    '--RepeatMode', 'Once', '--KeepCommand', 'false', '--EnableParameter', 'false', '--ClientToken', token];
  let submitted;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { submitted = await cli(args); break; } catch (error) {
      const failure = safeCliError(error);
      if (!failure.retryable || attempt === 2) {
        failure.message = `Cloud Assistant submission failed at step ${step}: ${failure.message}`;
        throw failure;
      }
      await sleep(1000 * (attempt + 1));
    }
  }
  const invokeId = submitted?.InvokeId;
  if (typeof invokeId !== 'string' || !/^t-[a-zA-Z0-9-]+$/.test(invokeId)) throw new Error('Missing or invalid Cloud Assistant InvokeId');
  const deadline = now() + (timeout + 30) * 1000;
  while (now() < deadline) {
    let response;
    try {
      response = await cli(['ecs', 'DescribeInvocationResults', '--region', target.region, '--RegionId', target.region,
        '--InvokeId', invokeId, '--InstanceId', target.instanceId, '--ContentEncoding', 'Base64']);
    } catch (error) {
      const failure = safeCliError(error);
      if (!failure.retryable) {
        failure.message = `Cloud Assistant polling failed at step ${step}: ${failure.message}`;
        throw failure;
      }
      await sleep(2000);
      continue;
    }
    const results = response?.Invocation?.InvocationResults?.InvocationResult;
    if (!Array.isArray(results)) throw new Error('Invalid Cloud Assistant invocation results shape');
    if (results.length === 0) { await sleep(2000); continue; }
    if (results.length !== 1 || results[0].InvokeId !== invokeId || results[0].InstanceId !== target.instanceId) {
      throw new Error('Cloud Assistant invocation or instance mismatch');
    }
    const result = results[0];
    if (['Pending', 'Running', 'Stopping'].includes(result.InvocationStatus)) { await sleep(2000); continue; }
    const diagnostic = diagnostics(result);
    if (Number(result.Dropped ?? 0) !== 0 || result.Truncated === true || result.OutputTruncated === true) {
      throw new Error(`Cloud Assistant output was truncated at step ${step}: ${diagnostic}`);
    }
    if (result.InvocationStatus !== 'Success' || result.ExitCode !== 0 || result.ErrorCode) {
      throw new Error(`Cloud Assistant step ${step} failed (${result.InvocationStatus}, exit ${result.ExitCode}): ${diagnostic}`);
    }
    log(`Cloud Assistant step ${step}: success`);
    return result;
  }
  throw new Error(`Cloud Assistant step ${step} timed out`);
}

export function prepareReleaseCommand(target, archiveHash, scriptHash) {
  const incoming = `${target.base}/incoming/${target.releaseId}`;
  const release = `${target.base}/releases/${target.releaseId}`;
  return `#!/bin/bash
set -Eeuo pipefail
export PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin
cd ${shell(incoming)}
cat api-release.tgz.part-* > api-release.tgz
cat activate-api.sh.part-* > activate-api.sh
printf '%s  %s\\n' ${shell(archiveHash)} api-release.tgz ${shell(scriptHash)} activate-api.sh | sha256sum --check --strict
python3 - ${shell(incoming + '/api-release.tgz')} ${shell(release)} <<'PYTHON'
import os,re,sys,tarfile
archive,release=sys.argv[1:]
assert not os.path.lexists(release), 'Candidate release already exists'
with tarfile.open(archive, 'r:gz') as source:
    members=source.getmembers()
    names=[member.name for member in members]
    assert 0 < len(members) <= 128 and len(set(names)) == len(names), 'Invalid archive members'
    required={'server.js','package.json','package-lock.json','version.json','release.env'}
    assert required.issubset(names), 'Missing required files'
    assert sum(member.size for member in members) <= 50*1024*1024, 'Archive is too large'
    for member in members:
        assert member.isfile() and member.size <= 10*1024*1024, 'Only bounded regular files are allowed'
        assert re.fullmatch(r'[A-Za-z0-9_-]+\\.js|package\\.json|package-lock\\.json|version\\.json|release\\.env',member.name), 'Unexpected archive path'
    os.mkdir(release, 0o750)
    for member in members:
        with source.extractfile(member) as data, open(os.path.join(release,member.name),'xb') as output:
            output.write(data.read())
PYTHON
cd ${shell(release)}
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
bash ${shell(incoming + '/activate-api.sh')} ${target.environment} ${shell(release)} ${shell(target.commit)}
`;
}

export async function verifyPublicApi(target, { fetch: request = fetch } = {}) {
  const get = async (path, options = {}) => {
    const response = await request(`${target.api}${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    return response;
  };
  const health = await get('/health', { headers: { 'Cache-Control': 'no-cache' } });
  if (health.status !== 200) throw new Error(`Public health returned ${health.status}`);
  const data = await health.json();
  if (data.status !== 'ok' || data.service !== 'resume-api' || data.commit !== target.commit || data.environment !== target.environment) {
    throw new Error('Public health commit/environment mismatch');
  }
  const response = await get('/chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'deployment health check' }] }) });
  if (response.status !== 200 || response.headers.get('access-control-allow-origin') !== origin) throw new Error('Public mock chat or CORS check failed');
  const chat = await response.json();
  if (chat.mode !== 'mock' || chat.message?.role !== 'assistant' || typeof chat.message?.content !== 'string' || !chat.message.content.trim()) throw new Error('Invalid public mock chat response');
  const preflight = await get('/chat', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== origin
    || !preflight.headers.get('access-control-allow-methods')?.split(',').map((method) => method.trim()).includes('POST')
    || !preflight.headers.get('access-control-allow-headers')?.toLowerCase().split(',').map((header) => header.trim()).includes('content-type')) {
    throw new Error('Public CORS preflight check failed');
  }
}

export async function deploy(environment, commit, archivePath, activationPath, options = {}) {
  const target = deploymentTarget(environment, commit, options.env ?? process.env);
  const files = await Promise.all([readFile(archivePath), readFile(activationPath)]);
  if (!files[0].length || files[0].length > 5 * 1024 * 1024 || !files[1].length || files[1].length > 256 * 1024) throw new Error('Invalid deployment input size');
  const incoming = `${target.base}/incoming/${target.releaseId}`;
  let step = 0;
  const execute = (command) => runCommand(target, command, step++, options);
  await execute(`#!/bin/bash\nset -Eeuo pipefail\numask 027\nmkdir -p ${shell(target.base + '/incoming')} ${shell(target.base + '/releases')}\nmkdir ${shell(incoming)}\n`);
  for (const [index, bytes] of files.entries()) {
    const filename = index === 0 ? 'api-release.tgz' : 'activate-api.sh';
    for (const [part, chunk] of splitChunks(bytes).entries()) {
      await execute(`#!/bin/bash\nset -Eeuo pipefail\numask 027\nprintf '%s' '${chunk.toString('base64')}' | base64 --decode > ${shell(`${incoming}/${filename}.part-${String(part).padStart(6, '0')}`)}\n`);
    }
  }
  await execute(prepareReleaseCommand(target, digest(files[0]), digest(files[1])));
  await verifyPublicApi(target, options);
  console.info(`Verified ${environment} API at commit ${commit}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, environment, commit, archive, activation, ...extra] = process.argv.slice(2);
  if (action !== 'deploy' || !archive || !activation || extra.length) {
    console.error('Usage: node scripts/cloud-assistant.mjs deploy <prod|dev> <commit> <api-release.tgz> <activate-api.sh>');
    process.exitCode = 1;
  } else {
    deploy(environment, commit, archive, activation).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
