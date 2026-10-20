import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { generateKnowledge } from './generate-chat-knowledge.mjs';

test('knowledge follows the exact canonical resume and does not copy adjacent private files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-knowledge-'));
  try {
    const resume = '# 简历\n个人参与，2025 年样本提升 10%。\n`literal ${text}`';
    const input = path.join(directory, 'readme.md');
    const output = path.join(directory, 'knowledge.mjs');
    await writeFile(input, resume);
    await writeFile(path.join(directory, 'private.md'), 'NEVER_COPY_PRIVATE');
    const version = await generateKnowledge(input, output);
    const generated = await import(pathToFileURL(output).href);
    assert.equal(generated.RESUME_TEXT, resume);
    assert.equal(generated.RESUME_VERSION, createHash('sha256').update(resume).digest('hex').slice(0, 16));
    assert.equal(generated.RESUME_VERSION, version);
    assert.ok(!(await readFile(output, 'utf8')).includes('NEVER_COPY_PRIVATE'));
    await writeFile(input, resume + '\n新经历');
    assert.notEqual(await generateKnowledge(input, output), version);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('empty or oversized knowledge fails the build', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-knowledge-'));
  try {
    const input = path.join(directory, 'readme.md');
    const output = path.join(directory, 'knowledge.mjs');
    await writeFile(input, '  ');
    await assert.rejects(generateKnowledge(input, output), /nonempty/);
    await writeFile(input, '字'.repeat(30_000));
    await assert.rejects(generateKnowledge(input, output), /64 KiB/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
