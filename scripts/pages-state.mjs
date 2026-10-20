import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const commitPattern = /^[a-f0-9]{40}$/;
const generationPattern = /^\d+-\d+$/;
const validCommit = value => typeof value === 'string' && commitPattern.test(value);
const validGeneration = value => typeof value === 'string' && generationPattern.test(value);
const metadataFiles = new Set(['deployment-state.json', 'version.json']);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value, allowed) => plainObject(value) && Object.keys(value).every(key => allowed.includes(key));
const fail = message => { throw new Error(message); };

function validateState(state) {
  if (!keysAre(state, ['schema', 'generation', 'environments']) || state.schema !== 1 ||
      !validGeneration(state.generation) || !keysAre(state.environments, ['prod', 'dev']) ||
      !state.environments.prod) fail('Invalid deployment-state.json');
  for (const entry of Object.values(state.environments)) {
    if (!keysAre(entry, ['commit']) || !validCommit(entry.commit)) fail('Invalid environment metadata');
  }
  return state;
}

async function json(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`Cannot read metadata ${file}: ${error.message}`, { cause: error }); }
}

// Validate every entry before copying, including hidden entries that will be omitted.
async function entries(directory, { previous = false } = {}, prefix = '') {
  const directoryInfo = await lstat(path.join(directory, prefix));
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) fail(`Not a regular directory: ${directory}`);
  const result = [];
  for (const name of await readdir(path.join(directory, prefix))) {
    const relative = path.join(prefix, name);
    const info = await lstat(path.join(directory, relative));
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) fail(`Not a regular static entry: ${relative}`);
    if (previous && !prefix && name === '.git') continue;
    if (name.startsWith('.') && name !== '.nojekyll') {
      if (previous) fail(`Unknown hidden state entry: ${relative}`);
      if (info.isDirectory()) await entries(directory, {}, relative);
      continue;
    }
    if (name === '.nojekyll' && !info.isFile()) fail('.nojekyll must be a file');
    if (info.isDirectory()) result.push(...await entries(directory, { previous }, relative));
    else result.push(relative);
  }
  return result;
}

async function previousState(directory) {
  let files;
  try { files = await entries(directory, { previous: true }); }
  catch (error) {
    if (error.code === 'ENOENT' && error.path === directory) return { state: null, files: [] };
    throw error;
  }
  if (!files.length) return { state: null, files };
  if (!files.includes('deployment-state.json')) fail('Nonempty previous state has no deployment-state.json');
  const state = validateState(await json(path.join(directory, 'deployment-state.json')));
  for (const environment of ['prod', 'dev']) {
    const prefix = environment === 'prod' ? '' : 'dev/';
    const file = `${prefix}version.json`;
    if (!state.environments[environment]) {
      if (files.some(name => name.startsWith('dev/'))) fail('Untracked development files in previous state');
      continue;
    }
    const version = await json(path.join(directory, file));
    if (!keysAre(version, ['commit', 'environment', 'generation']) ||
        version.commit !== state.environments[environment].commit || version.environment !== environment ||
        (version.generation !== undefined && !validGeneration(version.generation))) fail(`Invalid ${file}`);
    if (!files.includes(`${prefix}index.html`)) fail(`Missing ${prefix}index.html`);
  }
  return { state, files };
}

export async function prepare(environment, commit, generation, buildDir, previousDir, outputDir) {
  if (!['prod', 'dev'].includes(environment) || !validCommit(commit) || !validGeneration(generation)) fail('Invalid environment, commit, or generation');
  const directories = [buildDir, previousDir, outputDir].map(directory => path.resolve(directory));
  for (let a = 0; a < directories.length; a++) {
    for (let b = a + 1; b < directories.length; b++) {
      const relative = path.relative(directories[a], directories[b]);
      const reverse = path.relative(directories[b], directories[a]);
      if (!relative || !relative.startsWith('..') || !reverse.startsWith('..')) fail('Build, previous, and output directories must not overlap');
    }
  }
  const buildFiles = await entries(buildDir);
  const buildNames = await readdir(buildDir);
  if (buildNames.some(name => name === 'dev' || metadataFiles.has(name))) fail('Build contains reserved dev directory or metadata');
  if (!buildFiles.includes('index.html')) fail('Build requires index.html');
  const previous = await previousState(previousDir);
  if (!previous.state && environment === 'dev') fail('Production must be bootstrapped before development');
  await mkdir(outputDir, { recursive: true });
  const outputInfo = await lstat(outputDir);
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) fail('Output must be a regular directory');
  if ((await readdir(outputDir)).length) fail('Output directory must be empty');
  const copy = async (source, file, target = file) => {
    await mkdir(path.dirname(path.join(outputDir, target)), { recursive: true });
    await copyFile(path.join(source, file), path.join(outputDir, target));
  };
  for (const file of previous.files) {
    if (file === 'deployment-state.json') continue;
    const preserve = environment === 'dev' ? !file.startsWith('dev/') : file.startsWith('dev/');
    if (preserve || file === '.nojekyll') await copy(previousDir, file);
  }
  for (const file of buildFiles) await copy(buildDir, file, environment === 'dev' ? path.join('dev', file) : file);
  const state = { schema: 1, generation, environments: { ...previous.state?.environments, [environment]: { commit } } };
  await writeFile(path.join(outputDir, environment === 'dev' ? 'dev/version.json' : 'version.json'), `${JSON.stringify({ commit, environment, generation })}\n`);
  await writeFile(path.join(outputDir, 'deployment-state.json'), `${JSON.stringify(state)}\n`);
  if (!previous.files.includes('.nojekyll') && !(environment === 'prod' && buildFiles.includes('.nojekyll'))) {
    await writeFile(path.join(outputDir, '.nojekyll'), '');
  }
  return state;
}

function stateURL(origin) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) fail('Expected a Pages origin without a path');
  url.pathname = '/deployment-state.json';
  url.search = '';
  url.hash = '';
  return url;
}

async function publishedState(origin, fetchImpl) {
  const url = stateURL(origin);
  url.searchParams.set('check', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) fail(`Published state HTTP ${response.status}`);
  return validateState(await response.json());
}

export async function guard(origin, previousDir, { fetchImpl = fetch } = {}) {
  const previous = await previousState(previousDir);
  if (!previous.state) return;
  const published = await publishedState(origin, fetchImpl);
  if (published.generation !== previous.state.generation || ['prod', 'dev'].some(environment => published.environments[environment]?.commit !== previous.state.environments[environment]?.commit)) fail('Published Pages state differs from saved state; recover state before deploying');
}

export async function verify(origin, expectedGeneration, { fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeoutMs = 120_000 } = {}) {
  if (!validGeneration(expectedGeneration)) fail('Invalid expected generation');
  stateURL(origin);
  const deadline = now() + timeoutMs;
  let lastError;
  do {
    try {
      const published = await publishedState(origin, fetchImpl);
      if (published.generation === expectedGeneration) return published;
      lastError = new Error(`Expected generation ${expectedGeneration}, got ${published.generation}`);
    } catch (error) { lastError = error; }
    if (now() + 10_000 >= deadline) break;
    await sleep(5_000);
  } while (now() < deadline);
  throw new Error(`Pages publication not confirmed: ${lastError?.message}`);
}

async function main(args) {
  const [command, ...parameters] = args;
  if (command === 'prepare' && parameters.length === 6) await prepare(...parameters);
  else if (command === 'guard' && parameters.length === 2) await guard(...parameters);
  else if (command === 'verify' && parameters.length === 2) await verify(...parameters);
  else fail('Usage: pages-state.mjs prepare <prod|dev> <commit> <generation> <build> <previous> <output> | guard <origin> <previous> | verify <origin> <generation>');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
