import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [environment, commit, ...extra] = process.argv.slice(2);
if (extra.length || !['prod', 'dev'].includes(environment) || !/^[a-f0-9]{40}$/.test(commit ?? '')) {
  throw new Error('Usage: package-api.mjs <prod|dev> <40-character commit>');
}
const run = (command, args, cwd, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
};
const source = JSON.parse(await readFile(path.join(root, 'apps/api/package.json'), 'utf8'));
const manifest = Object.fromEntries(
  ['name', 'version', 'private', 'type', 'engines', 'dependencies'].map((key) => [key, source[key]]),
);
const lockPath = path.join(root, 'deploy/api-package-lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const sameObject = (left, right) => JSON.stringify(Object.entries(left ?? {}).sort()) === JSON.stringify(Object.entries(right ?? {}).sort());
if (lock.lockfileVersion !== 3 || lock.name !== manifest.name || lock.version !== manifest.version
  || lock.packages?.['']?.name !== manifest.name || lock.packages?.['']?.version !== manifest.version
  || !sameObject(lock.packages?.['']?.dependencies, manifest.dependencies)
  || !sameObject(lock.packages?.['']?.engines, manifest.engines)) {
  throw new Error('API production lock does not match apps/api/package.json; regenerate deploy/api-package-lock.json first.');
}
run('npm', ['run', 'build:api'], root);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'resume-api-release-'));
try {
  const dist = path.join(root, 'apps/api/dist');
  const files = (await readdir(dist, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => entry.name).sort();
  if (!files.includes('server.js')) throw new Error('API build is missing server.js');
  for (const file of files) await cp(path.join(dist, file), path.join(temporary, file));
  await writeFile(path.join(temporary, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(lockPath, path.join(temporary, 'package-lock.json'));
  await writeFile(path.join(temporary, 'version.json'), `${JSON.stringify({ commit, environment })}\n`);
  await writeFile(path.join(temporary, 'release.env'), `RELEASE_COMMIT=${commit}\nDEPLOY_ENV=${environment}\n`);
  const metadata = ['version.json', 'release.env'];
  const artifacts = path.join(root, '.artifacts');
  await mkdir(artifacts, { recursive: true });
  const output = path.join(artifacts, 'api-release.tgz');
  // BSD tar otherwise adds AppleDouble files on macOS, which the server correctly rejects.
  run('tar', ['-czf', output, '-C', temporary, 'package.json', 'package-lock.json', ...files, ...metadata], root, { ...process.env, COPYFILE_DISABLE: '1' });
  console.info(`API release: ${output}`);
  console.info(`Files: package.json, package-lock.json, ${files.join(', ')}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
