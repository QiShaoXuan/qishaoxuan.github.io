import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { generateKnowledge } from './generate-chat-knowledge.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const resume = '# 简历\n个人参与，2025 年样本提升 10%。\n`literal ${text}`';
const body = Array.from({ length: 6 }, (_, index) => `## ${index + 1}. 章节\n已确认的项目内容 ${index + 1}。`).join('\n\n');
const document = `# 内部整理标题\nHEADER_EXCLUDED\n\n${body}\n\n## 7. 后续补充\nMAINTENANCE_EXCLUDED\n\n## 8. 接入要求\nINTEGRATION_EXCLUDED\n`;

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-knowledge-'));
  try {
    const input = path.join(directory, 'readme.md');
    const affine = path.join(directory, 'affine.md');
    const output = path.join(directory, 'knowledge.mjs');
    await writeFile(input, resume);
    await writeFile(affine, document);
    await run({ directory, input, affine, output, generate: () => generateKnowledge(input, output, affine) });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('knowledge contains exact resume and only AFFiNE sections 1–6, with stable content versions', () => fixture(async ({ directory, input, output, generate }) => {
  for (const file of ['private.md', 'affine-evidence.md', 'affine-contributions.tsv']) await writeFile(path.join(directory, file), 'NEVER_COPY_NEIGHBORS');
  const version = await generate();
  const generated = await import(pathToFileURL(output).href);
  assert.equal(generated.RESUME_TEXT, resume);
  assert.equal(generated.AFFINE_TEXT, body);
  assert.equal(generated.RESUME_VERSION, hash(resume));
  assert.equal(generated.AFFINE_VERSION, hash(body));
  assert.equal(generated.KNOWLEDGE_VERSION, hash(JSON.stringify({ resume, affine: body })));
  assert.equal(generated.KNOWLEDGE_VERSION, version);
  const text = await readFile(output, 'utf8');
  for (const excluded of ['HEADER_EXCLUDED', 'MAINTENANCE_EXCLUDED', 'INTEGRATION_EXCLUDED', 'NEVER_COPY_NEIGHBORS']) assert.ok(!text.includes(excluded));
  await writeFile(input, `${resume}\n新经历`);
  assert.notEqual(await generate(), version);
}));

test('AFFiNE answer changes affect versions; maintenance changes do not rewrite the module', () => fixture(async ({ affine, output, generate }) => {
  const version = await generate();
  const marker = new Date('2000-01-01T00:00:00Z');
  await utimes(output, marker, marker);
  const original = await stat(output);
  assert.equal(await generate(), version);
  assert.equal((await stat(output)).mtimeMs, original.mtimeMs);
  await writeFile(affine, document.replace('HEADER_EXCLUDED', 'new header').replace('MAINTENANCE_EXCLUDED', 'new maintenance').replace('INTEGRATION_EXCLUDED', 'new integration'));
  assert.equal(await generate(), version);
  assert.equal((await stat(output)).mtimeMs, original.mtimeMs);
  await writeFile(affine, document.replace('已确认的项目内容 3', '新增确认的项目内容 3'));
  assert.notEqual(await generate(), version);
  assert.notEqual((await stat(output)).mtimeMs, original.mtimeMs);
}));

test('both public inputs must be nonempty and within the UTF-8 byte limit', () => fixture(async ({ input, affine, generate }) => {
  for (const file of [input, affine]) {
    const valid = file === input ? resume : document;
    await writeFile(file, ' \n');
    await assert.rejects(generate(), /nonempty/);
    await writeFile(file, '字'.repeat(30_000));
    await assert.rejects(generate(), /64 KiB/);
    await writeFile(file, valid);
  }
  await writeFile(input, 'a'.repeat(64 * 1024));
  await generate();
  await writeFile(input, 'a'.repeat(64 * 1024 + 1));
  await assert.rejects(generate(), /64 KiB/);
  await writeFile(input, resume);
  await writeFile(affine, document + 'a'.repeat(64 * 1024 - Buffer.byteLength(document)));
  await generate();
  await writeFile(affine, document + 'a'.repeat(64 * 1024 - Buffer.byteLength(document) + 1));
  await assert.rejects(generate(), /64 KiB/);
}));

test('missing resume or AFFiNE input fails instead of silently dropping knowledge', () => fixture(async ({ input, affine, generate }) => {
  await rm(input);
  await assert.rejects(generate(), { code: 'ENOENT' });
  await writeFile(input, resume);
  await rm(affine);
  await assert.rejects(generate(), { code: 'ENOENT' });
}));

test('missing, repeated, reordered, or empty AFFiNE sections fail closed', () => fixture(async ({ affine, generate }) => {
  for (const broken of [
    document.replace('## 1.', '### 1.'),
    document.replace('## 7.', '### 7.'),
    document.replace('## 3.', '### 3.'),
    document.replace('## 3.', '## 2.'),
    document.replace('## 2.', '## 3.').replace('## 3. 章节\n已确认的项目内容 3', '## 2. 章节\n已确认的项目内容 3'),
    document.replace('已确认的项目内容 4。', ''),
    document.replace('## 3.', '## 9. 意外章节\n\n## 3.'),
  ]) {
    await writeFile(affine, broken);
    await assert.rejects(generate(), /complete, nonempty sections/);
  }
}));
