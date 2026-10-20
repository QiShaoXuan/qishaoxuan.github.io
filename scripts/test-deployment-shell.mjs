import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const activation = await readFile(new URL('deploy/activate-api.sh', root), 'utf8');
const commit = 'a'.repeat(40);

// Exercise the real Bash parser and metadata guard before any service mutation.
async function guardFixture(run) {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'resume-shell-test-')));
  try {
    const base = path.join(temporary, 'resume');
    const candidate = path.join(base, 'releases', 'candidate');
    const bin = path.join(temporary, 'bin');
    await mkdir(path.join(candidate, 'node_modules', 'fastify'), { recursive: true });
    await mkdir(bin);
    for (const file of ['server.js', 'package.json', 'package-lock.json', 'node_modules/fastify/package.json']) {
      await writeFile(path.join(candidate, file), '{}');
    }
    await writeFile(path.join(candidate, 'version.json'), JSON.stringify({ commit, environment: 'prod' }));
    await writeFile(path.join(candidate, 'release.env'), `RELEASE_COMMIT=${commit}\nDEPLOY_ENV=prod\n`);
    const environmentFile = path.join(temporary, 'server.env');
    await writeFile(environmentFile, 'NODE_ENV=production\n');
    await writeFile(path.join(bin, 'id'), '#!/bin/bash\necho resume\n', { mode: 0o755 });
    // Deliberately stop at the lock: all preceding validation is real, no sudo/systemd runs.
    await writeFile(path.join(bin, 'flock'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
    await writeFile(path.join(bin, 'realpath'), '#!/bin/bash\npython3 -c \'import os,sys; print(os.path.realpath(sys.argv[-1]))\' "$@"\n', { mode: 0o755 });
    const script = path.join(temporary, 'activate.sh');
    await writeFile(script, activation.replaceAll('/srv/resume', base).replaceAll('/etc/resume/resume.env', environmentFile));
    const execute = (...args) => spawnSync('bash', [script, ...args], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8',
    });
    await run({ candidate, execute, temporary });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test('deployment shell syntax is valid', async () => {
  for (const file of ['activate-api.sh', 'setup-environments.sh']) {
    const result = spawnSync('bash', ['-n', new URL(`deploy/${file}`, root).pathname], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
test('unknown environment is rejected before mutation', () => {
  const result = spawnSync('bash', ['-c', activation, '--', 'staging', '/invalid'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Environment must be prod or dev/);
});
test('legacy CLI and explicit production CLI both validate metadata', () => guardFixture(async ({ candidate, execute }) => {
  for (const args of [[candidate], ['prod', candidate, commit]]) {
    const result = execute(...args);
    assert.match(result.stderr, /Another API activation is in progress/, result.stderr);
  }
}));
test('wrong commit and cross-environment release are rejected', () => guardFixture(async ({ candidate, execute }) => {
  assert.match(execute('prod', candidate, 'b'.repeat(40)).stderr, /Release commit mismatch/);
  await writeFile(path.join(candidate, 'version.json'), JSON.stringify({ commit, environment: 'dev' }));
  assert.match(execute('prod', candidate, commit).stderr, /Release environment mismatch/);
}));
test('release.env cannot inject extra values or commands', () => guardFixture(async ({ candidate, execute }) => {
  await writeFile(path.join(candidate, 'release.env'), `RELEASE_COMMIT=${commit}\nDEPLOY_ENV=prod\nNODE_OPTIONS=--inspect=0.0.0.0\n`);
  assert.match(execute('prod', candidate, commit).stderr, /Invalid release.env/);
}));
test('symlink escaping release root is rejected', () => guardFixture(async ({ execute, temporary }) => {
  const escape = path.join(temporary, 'resume', 'releases', 'escape');
  await symlink(temporary, escape);
  assert.match(execute('prod', escape, commit).stderr, /Release must be canonical/);
}));
test('development proxy and service preserve environment isolation', async () => {
  const nginx = await readFile(new URL('deploy/resume.ip-https.nginx', root), 'utf8');
  const unit = await readFile(new URL('deploy/resume-development.service', root), 'utf8');
  assert.match(nginx, /location = \/dev\/api\/chat\s*\{\s*proxy_pass http:\/\/127\.0\.0\.1:3100\/api\/chat;/);
  assert.match(nginx, /location \^~ \/dev\/api\/\s*\{\s*proxy_pass http:\/\/127\.0\.0\.1:3100\/api\/;/);
  assert.match(nginx, /location = \/api\/chat\s*\{\s*proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(nginx, /location \^~ \/\.well-known\/acme-challenge\//);
  assert.match(unit, /User=resume-dev\nGroup=resume-dev/);
  assert.match(unit, /MemoryHigh=192M\nMemoryMax=256M/);
  assert.match(unit, /EnvironmentFile=-\/srv\/resume-development\/current\/release.env/);
});

async function proxyRetryFixture(failures) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'resume-nginx-retry-'));
  try {
    const setup = await readFile(new URL('deploy/setup-environments.sh', root), 'utf8');
    const helper = setup.match(/wait_proxy_health\(\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(helper, 'setup must use bounded post-reload HTTP health verification');
    const counter = path.join(temporary, 'attempts');
    // HTTP 404 is curl exit 22; emulate old workers before healthy new workers.
    await writeFile(path.join(temporary, 'curl'), `#!/bin/bash
count=0
[[ ! -f "$RETRY_COUNTER" ]] || read -r count < "$RETRY_COUNTER"
count=$((count+1))
echo "$count" > "$RETRY_COUNTER"
if [[ $count -le $RETRY_FAILURES ]]; then exit 22; fi
printf '%s' '{"status":"ok","stage":"deployment-preparation"}'
`, { mode: 0o755 });
    await writeFile(path.join(temporary, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
    const result = spawnSync('bash', ['-c', `set -Eeu -o pipefail\n${helper}\nwait_proxy_health /dev/healthz`], {
      env: { ...process.env, PATH: `${temporary}:${process.env.PATH}`, RETRY_COUNTER: counter, RETRY_FAILURES: String(failures) },
      encoding: 'utf8',
    });
    return { result, attempts: Number(await readFile(counter, 'utf8')) };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test('post-reload health tolerates old-worker 404 until new route is ready', async () => {
  const { result, attempts } = await proxyRetryFixture(2);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(attempts, 3);
});
test('persistent post-reload 404 fails within bounded attempts for rollback', async () => {
  const { result, attempts } = await proxyRetryFixture(20);
  assert.equal(result.status, 1);
  assert.equal(attempts, 10);
  assert.match(result.stderr, /Nginx health check failed after 10 attempts: \/dev\/healthz/);
});

async function routeProbeFixture(status = '400', code = 'INVALID_REQUEST') {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'resume-route-probe-'));
  try {
    const helper = activation.match(/check_routes\(\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(helper);
    await writeFile(path.join(temporary, 'curl'), `#!/bin/bash
output=''; headers=''; method='POST'; body=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    -D) headers=$2; shift 2 ;;
    -X) method=$2; shift 2 ;;
    --data) body=$2; shift 2 ;;
    *) shift ;;
  esac
done
if [[ $method == OPTIONS ]]; then
  printf 'access-control-allow-origin: https://qishaoxuan.github.io\\r\\n' > "$headers"
  printf '204'
else
  [[ $body == '{"messages":[]}' ]] || { echo 'Billable request attempted' >&2; exit 99; }
  printf '{"code":"%s"}' "$PROBE_CODE" > "$output"
  printf '%s' "$PROBE_STATUS"
fi
`, { mode: 0o755 });
    return spawnSync('bash', ['-c', `set -Eeuo pipefail\nhealth() { return 0; }\n${helper}\ncheck_routes 3001`], {
      env: { ...process.env, PATH: `${temporary}:${process.env.PATH}`, temporary, PROBE_STATUS: status, PROBE_CODE: code }, encoding: 'utf8',
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test('loopback route probe sends only invalid input and accepts INVALID_REQUEST 400', async () => {
  const result = await routeProbeFixture();
  assert.equal(result.status, 0, result.stderr);
});
test('loopback route probe rejects successful chat and wrong validation code', async () => {
  const success = await routeProbeFixture('200');
  assert.notEqual(success.status, 0);
  assert.match(success.stderr, /Expected invalid chat request 400/);
  assert.notEqual((await routeProbeFixture('400', 'OTHER_ERROR')).status, 0);
});


test('candidate preflight accepts structured startup logs and verifies real loopback routes', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'resume-preflight-startup-'));
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  try {
    await writeFile(path.join(temporary, 'server.env'), '');
    await writeFile(path.join(temporary, 'server.js'), `
const http = require('node:http');
const server = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', 'https://qishaoxuan.github.io');
  if (request.url === '/api/health' || request.url === '/healthz') {
    response.end(JSON.stringify({ status: 'ok', service: 'resume-api', commit: process.env.RELEASE_COMMIT, environment: process.env.DEPLOY_ENV }));
  } else if (request.url === '/api/chat' && request.method === 'OPTIONS') {
    response.writeHead(204); response.end();
  } else if (request.url === '/api/chat' && request.method === 'POST') {
    let body = ''; request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      if (body !== '{"messages":[]}') { response.writeHead(500); response.end('billable input attempted'); return; }
      response.writeHead(400); response.end(JSON.stringify({ code: 'INVALID_REQUEST' }));
    });
  } else { response.writeHead(404); response.end(); }
});
server.listen(Number(process.env.API_PORT), process.env.API_HOST, () => {
  console.log(JSON.stringify({ level: 30, time: Date.now(), env: process.env.DEPLOY_ENV, commit: process.env.RELEASE_COMMIT, msg: 'startup' }));
});
process.on('SIGTERM', () => server.close());
`);
    const helpers = activation.slice(activation.indexOf('stop_preflight() {'), activation.indexOf('cleanup() {'));
    const preflight = activation.slice(activation.indexOf('(\n  cd "$release"'), activation.indexOf("printf 'Release:"))
      .replace('/opt/node/bin/node', '"$node_binary"');
    assert.ok(preflight.includes('wait_health "$check_port"'));
    assert.ok(preflight.includes('check_routes "$check_port"'));
    const result = spawnSync('bash', ['-c', `set -Eeuo pipefail\npreflight_pid=''\ntrap stop_preflight EXIT\n${helpers}\n${preflight}`], {
      env: { ...process.env, temporary, release: temporary, env_file: path.join(temporary, 'server.env'), expected_commit: commit,
        environment: 'prod', check_port: String(port), heap: '128', node_binary: process.execPath },
      encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    const log = await readFile(path.join(temporary, 'preflight.log'), 'utf8');
    const startup = JSON.parse(log.trim());
    assert.equal(startup.msg, 'startup');
    assert.equal(startup.commit, commit);
    assert.doesNotMatch(log, /Resume API listening/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
