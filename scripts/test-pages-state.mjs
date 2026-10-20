import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepare, guard, verify } from './pages-state.mjs';

const first = 'a'.repeat(40);
const second = 'b'.repeat(40);
const third = 'c'.repeat(40);
const origin = 'https://example.github.io';
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resume-pages-'));
  try {
    const build = path.join(root, 'build');
    const previous = path.join(root, 'previous');
    await mkdir(build);
    await mkdir(previous);
    await writeFile(path.join(build, 'index.html'), '<html>production</html>');
    await mkdir(path.join(build, 'assets'));
    await writeFile(path.join(build, 'assets', 'sample.bin'), Buffer.from([0, 1, 128, 255]));
    await run({ root, build, previous, output: path.join(root, 'output') });
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function snapshot(directory, prefix = '') {
  const result = {};
  for (const item of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, item.name);
    if (item.isDirectory()) Object.assign(result, await snapshot(directory, relative));
    else result[relative] = (await readFile(path.join(directory, relative))).toString('base64');
  }
  return result;
}
const response = state => ({ ok: true, json: async () => state });
const state = (generation = '1-1') => ({ schema: 1, generation, environments: { prod: { commit: first } } });

test('prod bootstrap creates metadata, skips hidden source files, and accepts checkout .git', () => fixture(async ({ build, previous, output }) => {
  await mkdir(path.join(previous, '.git'));
  await writeFile(path.join(previous, '.git', 'HEAD'), 'checkout metadata');
  await writeFile(path.join(build, '.env'), 'not public');
  await prepare('prod', first, '1-1', build, previous, output);
  assert.deepEqual(await readJSON(path.join(output, 'deployment-state.json')), state());
  assert.deepEqual(await readJSON(path.join(output, 'version.json')), { commit: first, environment: 'prod', generation: '1-1' });
  assert.equal(await readFile(path.join(output, '.nojekyll'), 'utf8'), '');
  assert.equal((await snapshot(output))['.env'], undefined);
  assert.equal((await snapshot(output))['.git/HEAD'], undefined);
}));

test('real detached git worktree .git file is ignored and never published', () => fixture(async ({ root, build, output }) => {
  const repository = path.join(root, 'repository');
  const worktree = path.join(root, 'worktree');
  await mkdir(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: 'pipe' });
  git('init');
  git('-c', 'user.name=Pages Test', '-c', 'user.email=pages-test@example.invalid', 'commit', '--allow-empty', '-m', 'initial');
  git('worktree', 'add', '--detach', worktree, 'HEAD');
  assert.match(await readFile(path.join(worktree, '.git'), 'utf8'), /^gitdir: /);
  await prepare('prod', first, '1-1', build, worktree, output);
  assert.equal((await snapshot(output))['.git'], undefined);
  assert.deepEqual(await readJSON(path.join(output, 'deployment-state.json')), state());
  await guard(origin, worktree, { fetchImpl: () => assert.fail('empty worktree must not fetch') });
}));

test('development preserves production bytes; later production preserves all development bytes', () => fixture(async ({ root, build, previous, output }) => {
  await prepare('prod', first, '1-1', build, previous, output);
  await writeFile(path.join(output, '.nojekyll'), 'preserved marker');
  const prod = await snapshot(output);
  await writeFile(path.join(build, 'index.html'), '<html>development</html>');
  const devOutput = path.join(root, 'development');
  await prepare('dev', second, '2-1', build, output, devOutput);
  const dev = await snapshot(devOutput);
  for (const [file, bytes] of Object.entries(prod)) {
    if (file !== 'deployment-state.json') assert.equal(dev[file], bytes, file);
  }
  assert.deepEqual(await readJSON(path.join(devOutput, 'dev/version.json')), { commit: second, environment: 'dev', generation: '2-1' });
  await writeFile(path.join(build, 'index.html'), '<html>next production</html>');
  const nextOutput = path.join(root, 'next');
  await prepare('prod', third, '3-1', build, devOutput, nextOutput);
  const next = await snapshot(nextOutput);
  for (const [file, bytes] of Object.entries(dev)) {
    if (file.startsWith('dev/')) assert.equal(next[file], bytes, file);
  }
  assert.deepEqual(await readJSON(path.join(nextOutput, 'deployment-state.json')), {
    schema: 1, generation: '3-1', environments: { prod: { commit: third }, dev: { commit: second } },
  });
}));

test('development bootstrap refuses empty or missing previous state', () => fixture(async ({ root, build, previous, output }) => {
  for (const directory of [previous, path.join(root, 'missing')]) {
    await assert.rejects(prepare('dev', first, '1-1', build, directory, output), /Production must be bootstrapped/);
  }
}));

test('unknown or malformed previous metadata fails without treating it as bootstrap', () => fixture(async ({ build, previous, output }) => {
  await writeFile(path.join(previous, 'unexpected.txt'), 'existing site');
  await assert.rejects(prepare('prod', first, '1-1', build, previous, output), /Nonempty previous state/);
  for (const value of ['{', JSON.stringify({ ...state(), unknown: true }), JSON.stringify({ ...state(), schema: 2 }), JSON.stringify({ ...state(), environments: { prod: { commit: [first] } } })]) {
    await writeFile(path.join(previous, 'deployment-state.json'), value);
    await assert.rejects(prepare('prod', first, '1-1', build, previous, output), /metadata|Invalid/);
  }
}));

test('missing/mismatched version and missing index are rejected', () => fixture(async ({ root, build, previous, output }) => {
  await prepare('prod', first, '1-1', build, previous, output);
  const next = path.join(root, 'next');
  const file = path.join(output, 'version.json');
  await rm(file);
  await assert.rejects(prepare('dev', second, '2-1', build, output, next), /Cannot read metadata/);
  await writeFile(file, JSON.stringify({ commit: second, environment: 'prod' }));
  await assert.rejects(prepare('dev', second, '2-1', build, output, next), /Invalid version/);
  await writeFile(file, JSON.stringify({ commit: first, environment: 'prod' }));
  await rm(path.join(output, 'index.html'));
  await assert.rejects(prepare('dev', second, '2-1', build, output, next), /Missing index/);
}));

test('reserved build paths, symlinks including hidden entries, and unknown state dotfiles fail', () => fixture(async ({ root, build, previous, output }) => {
  for (const name of ['dev', 'deployment-state.json', 'version.json']) {
    await writeFile(path.join(build, name), '{}');
    await assert.rejects(prepare('prod', first, '1-1', build, previous, output), /reserved/);
    await rm(path.join(build, name));
  }
  for (const name of ['link', '.hidden-link']) {
    await symlink(path.join(build, 'index.html'), path.join(build, name));
    await assert.rejects(prepare('prod', first, '1-1', build, previous, output), /regular static/);
    await rm(path.join(build, name));
  }
  const linkedBuild = path.join(root, 'linked-build');
  await symlink(build, linkedBuild);
  await assert.rejects(prepare('prod', first, '1-1', linkedBuild, previous, output), /regular directory/);
  await symlink(path.join(build, 'index.html'), path.join(previous, '.git'));
  await assert.rejects(prepare('prod', first, '1-1', build, previous, output), /regular static/);
  await rm(path.join(previous, '.git'));
  await writeFile(path.join(previous, '.unknown'), 'private');
  await assert.rejects(prepare('prod', first, '1-1', build, previous, output), /Unknown hidden/);
}));

test('invalid arguments, overlapping directories, and dirty output fail', () => fixture(async ({ build, previous, output }) => {
  for (const [environment, commit, generation] of [['stage', first, '1-1'], ['prod', 'short', '1-1'], ['prod', first, '../bad']]) {
    await assert.rejects(prepare(environment, commit, generation, build, previous, output), /Invalid/);
  }
  await assert.rejects(prepare('prod', first, '1-1', build, previous, path.join(build, 'output')), /overlap/);
  await mkdir(output);
  await writeFile(path.join(output, 'old'), 'must not publish');
  await assert.rejects(prepare('prod', first, '1-1', build, previous, output), /must be empty/);
}));

test('guard skips bootstrap but rejects public mismatch and bad responses', () => fixture(async ({ build, previous, output }) => {
  await guard(origin, previous, { fetchImpl: () => assert.fail('bootstrap must not fetch') });
  await prepare('prod', first, '1-1', build, previous, output);
  await guard(origin, output, { fetchImpl: async url => {
    assert.equal(url.pathname, '/deployment-state.json');
    assert.ok(url.searchParams.get('check'));
    return response(state());
  } });
  await assert.rejects(guard(origin, output, { fetchImpl: async () => response(state('2-1')) }), /differs/);
  await assert.rejects(guard(origin, output, { fetchImpl: async () => response({ schema: 2 }) }), /Invalid/);
  await assert.rejects(guard(origin, output, { fetchImpl: async () => ({ ok: false, status: 404 }) }), /HTTP 404/);
}));

test('verify retries stale publication and reports bounded failure without external fetch', async () => {
  let clock = 0;
  let calls = 0;
  const timing = { now: () => clock, sleep: async ms => { clock += ms; }, timeoutMs: 20_000 };
  await verify(origin, '2-1', { ...timing, fetchImpl: async () => response(state(++calls === 1 ? '1-1' : '2-1')) });
  assert.equal(calls, 2);
  clock = 0;
  await assert.rejects(verify(origin, '2-1', { ...timing, fetchImpl: async () => { throw new Error('offline'); } }), /not confirmed: offline/);
  assert.ok(clock <= 20_000);
  await assert.rejects(verify('https://example.github.io/dev/', '2-1'), /without a path/);
});
