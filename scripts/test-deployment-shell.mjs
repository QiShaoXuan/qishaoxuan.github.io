import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
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
