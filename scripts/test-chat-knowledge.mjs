import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { generateKnowledge } from './generate-chat-knowledge.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const legacy = '### ByteDance（2023-11 ~ 至今）\nSENSITIVE_LEGACY_BYTE\n\n';
const resume = '# 简历\n个人参与，2025 年样本提升 10%。\n`literal ${text}`\n## 工作经历\n2023-11 ~ 至今 - ByteDance\n## 项目经验\n### Other\nOTHER_PROJECT_PRESERVED\n## 个人作品\nOTHER_SECTION_PRESERVED\n';
const resumeDocument = resume.replace('### Other', `${legacy}### Other`);
const body = Array.from({ length: 6 }, (_, index) => `## ${index + 1}. 章节\n已确认的项目内容 ${index + 1}。`).join('\n\n');
const document = `# 内部整理标题\nHEADER_EXCLUDED\n\n${body}\n\n## 7. 后续补充\nMAINTENANCE_EXCLUDED\n\n## 8. 接入要求\nINTEGRATION_EXCLUDED\n`;

const bytedanceBody = Array.from({ length: 5 }, (_, index) => `## ${index + 1}. 字节项目\n字节已批准内容 ${index + 1}。`).join('\n\n');
const bytedanceDocument = `# 字节跳动\nBYTE_HEADER_EXCLUDED\n## 经历概览\nBYTE_OVERVIEW_EXCLUDED\n\n${bytedanceBody}\n`;

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-knowledge-'));
  try {
    const input = path.join(directory, 'readme.md');
    const affine = path.join(directory, 'affine.md');
    const output = path.join(directory, 'knowledge.mjs');
    const bytedance = path.join(directory, 'bytedance.md');
    await writeFile(input, resumeDocument);
    await writeFile(affine, document);
    await writeFile(bytedance, bytedanceDocument);
    await run({ directory, input, affine, bytedance, output, generate: () => generateKnowledge(input, output, affine, bytedance) });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('knowledge contains curated resume and approved project sections, with stable content versions', () => fixture(async ({ directory, input, output, generate }) => {
  for (const file of ['private.md', 'affine-evidence.md', 'affine-contributions.tsv']) await writeFile(path.join(directory, file), 'NEVER_COPY_NEIGHBORS');
  for (const subdirectory of ['archive', 'private']) {
    await mkdir(path.join(directory, subdirectory));
    await writeFile(path.join(directory, subdirectory, 'source.md'), 'NEVER_COPY_NEIGHBORS');
  }
  const version = await generate();
  const generated = await import(pathToFileURL(output).href);
  assert.equal(generated.RESUME_TEXT, resume);
  assert.equal(generated.AFFINE_TEXT, body);
  assert.equal(generated.BYTEDANCE_TEXT, bytedanceBody);
  assert.equal(generated.RESUME_VERSION, hash(resume));
  assert.equal(generated.AFFINE_VERSION, hash(body));
  assert.equal(generated.BYTEDANCE_VERSION, hash(bytedanceBody));
  assert.equal(generated.KNOWLEDGE_VERSION, hash(JSON.stringify({ resume, affine: body, bytedance: bytedanceBody })));
  assert.equal(generated.KNOWLEDGE_VERSION, version);
  const text = await readFile(output, 'utf8');
  for (const excluded of ['HEADER_EXCLUDED', 'MAINTENANCE_EXCLUDED', 'INTEGRATION_EXCLUDED', 'NEVER_COPY_NEIGHBORS', 'SENSITIVE_LEGACY_BYTE', 'BYTE_HEADER_EXCLUDED', 'BYTE_OVERVIEW_EXCLUDED']) assert.ok(!text.includes(excluded));
  assert.equal(await readFile(input, 'utf8'), resumeDocument);
  for (const preserved of ['2023-11 ~ 至今 - ByteDance', 'OTHER_PROJECT_PRESERVED', 'OTHER_SECTION_PRESERVED']) assert.ok(generated.RESUME_TEXT.includes(preserved));
  await writeFile(input, `${resumeDocument}\n新经历`);
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

test('all public source documents must be nonempty and within the UTF-8 byte limit', () => fixture(async ({ input, affine, bytedance, generate }) => {
  for (const [file, valid] of [[input, resumeDocument], [affine, document], [bytedance, bytedanceDocument]]) {
    await writeFile(file, ' \n');
    await assert.rejects(generate(), /nonempty/);
    await writeFile(file, '字'.repeat(30_000));
    await assert.rejects(generate(), /64 KiB/);
    await writeFile(file, valid + 'a'.repeat(64 * 1024 - Buffer.byteLength(valid)));
    await generate();
    await writeFile(file, valid + 'a'.repeat(64 * 1024 - Buffer.byteLength(valid) + 1));
    await assert.rejects(generate(), /64 KiB/);
    await writeFile(file, valid);
  }
}));

test('missing required source files fail instead of silently dropping knowledge', () => fixture(async ({ input, affine, bytedance, generate }) => {
  for (const [file, valid] of [[input, resumeDocument], [affine, document], [bytedance, bytedanceDocument]]) {
    await rm(file);
    await assert.rejects(generate(), { code: 'ENOENT' });
    await writeFile(file, valid);
  }
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

test('ByteDance and resume redactions are versioned by actual model input, excluding maintenance', () => fixture(async ({ input, bytedance, output, generate }) => {
  const version = await generate();
  const marker = new Date('2000-01-01T00:00:00Z');
  await utimes(output, marker, marker);
  await writeFile(input, resumeDocument.replace('SENSITIVE_LEGACY_BYTE', 'CHANGED_PRIVATE_LEGACY'));
  await writeFile(bytedance, `${bytedanceDocument.replace('BYTE_OVERVIEW_EXCLUDED', 'updated overview')}\n## 6. 维护\nBYTE_MAINTENANCE_EXCLUDED\n## 7. 审计\nBYTE_AUDIT_EXCLUDED\n`);
  assert.equal(await generate(), version);
  assert.equal((await stat(output)).mtimeMs, marker.getTime());
  const unchanged = await readFile(output, 'utf8');
  for (const excluded of ['CHANGED_PRIVATE_LEGACY', 'updated overview', 'BYTE_MAINTENANCE_EXCLUDED', 'BYTE_AUDIT_EXCLUDED']) assert.ok(!unchanged.includes(excluded));
  await writeFile(bytedance, bytedanceDocument.replace('字节已批准内容 3', '字节新增已批准事实'));
  assert.notEqual(await generate(), version);
  const changed = await readFile(output, 'utf8');
  assert.ok(changed.includes('字节新增已批准事实'));
  assert.ok(!changed.includes('字节已批准内容 3'));
}));

test('Chinese ByteDance name preserves employment while removing the legacy project block', () => fixture(async ({ input, output, generate }) => {
  const renamed = resumeDocument.replaceAll('ByteDance', '字节跳动-抖音电商');
  await writeFile(input, renamed);
  await generate();
  const generated = await import(pathToFileURL(output).href);
  assert.equal(generated.RESUME_TEXT, resume.replaceAll('ByteDance', '字节跳动-抖音电商'));
  assert.ok(!generated.RESUME_TEXT.includes('SENSITIVE_LEGACY_BYTE'));
  assert.equal(await readFile(input, 'utf8'), renamed);
  for (const broken of [
    renamed.replace('### 字节跳动-抖音电商（2023-11 ~ 至今）', '### 字节跳动-抖音电商(2023-11 ~ 至今)'),
    renamed.replace('### Other', `${legacy}### Other`),
  ]) {
    await writeFile(input, broken);
    await assert.rejects(generate(), /exactly one legacy ByteDance project block/);
  }
}));

test('legacy ByteDance resume removal fails closed when its section or following boundary changes', () => fixture(async ({ input, generate }) => {
  for (const broken of [
    resume,
    resumeDocument.replace('## 项目经验', '## 其他经验'),
    resumeDocument.replace('### Other', `${legacy}### Other`),
    resumeDocument.replace('### ByteDance（2023-11 ~ 至今）', '### ByteDance(2023-11 ~ 至今)'),
    resumeDocument.replace('### Other', '#### Other'),
    resumeDocument.replace('### Other', '## 意外边界\n### Other'),
    resumeDocument.replace('## 项目经验', '## 项目经验\n## 项目经验'),
    resumeDocument.replace('## 项目经验', '## 其他\n').replace('## 个人作品', '## 项目经验'),
  ]) {
    await writeFile(input, broken);
    await assert.rejects(generate(), /exactly one legacy ByteDance project block/);
  }
}));

test('ByteDance sections reject missing, repeated, reordered, empty, and unexpected boundaries', () => fixture(async ({ bytedance, generate }) => {
  for (const broken of [
    bytedanceDocument.replace('## 1.', '### 1.'),
    bytedanceDocument.replace('## 3.', '### 3.'),
    bytedanceDocument.replace('## 3.', '## 2.'),
    bytedanceDocument.replace('## 2.', '## 3.').replace('## 3. 字节项目\n字节已批准内容 3', '## 2. 字节项目\n字节已批准内容 3'),
    bytedanceDocument.replace('字节已批准内容 5。', ''),
    bytedanceDocument.replace('## 3.', '## 意外非编号正文\nUNAPPROVED\n## 3.'),
    bytedanceDocument.replace('## 3.', '## 9. 意外编号正文\nUNAPPROVED\n## 3.'),
    bytedanceDocument.replace('## 经历概览', '## 2. 错误前置章节'),
    `${bytedanceDocument}\n## 7. 跳过边界\nUNAPPROVED`,
    `${bytedanceDocument}\n## 6. 维护\nNOTE\n## 1. 重复章节\nUNAPPROVED`,
    `${bytedanceDocument}\n## 意外尾部章节\nUNAPPROVED`,
  ]) {
    await writeFile(bytedance, broken);
    await assert.rejects(generate(), /ByteDance knowledge requires complete, nonempty sections/);
  }
}));
