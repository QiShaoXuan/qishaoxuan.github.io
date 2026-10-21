import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkResumePdf, pdfInputs, readPdfInputs } from './resume-pdf.mjs';
import { repairCMap } from './pdf-text-map.mjs';

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resume-pdf-'));
  try {
    for (const file of pdfInputs) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await writeFile(path.join(directory, file), `source for ${file}`);
    }
    const pdf = Buffer.from('%PDF-1.7\nfixture\n%%EOF\n');
    const metadata = { schema: 1, sourceHash: (await readPdfInputs(directory)).sourceHash, pdfHash: createHash('sha256').update(pdf).digest('hex') };
    await mkdir(path.join(directory, 'apps/web/public'), { recursive: true });
    await writeFile(path.join(directory, 'apps/web/public/resume.pdf'), pdf);
    await writeFile(path.join(directory, 'apps/web/src/resume/pdf-metadata.json'), JSON.stringify(metadata));
    await run(directory, metadata);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('committed static PDF matches its README, layout and generation inputs', () => fixture(async (directory, metadata) => {
  assert.deepEqual(await checkResumePdf(directory), metadata);
  await writeFile(path.join(directory, 'unrelated.txt'), 'not an input');
  assert.deepEqual(await checkResumePdf(directory), metadata);
}));

test('README and rendering changes invalidate the PDF instead of silently shipping stale content', () => fixture(async directory => {
  for (const file of pdfInputs) {
    const target = path.join(directory, file), original = await readFile(target);
    await writeFile(target, 'updated source');
    await assert.rejects(checkResumePdf(directory), /stale or changed/);
    await writeFile(target, original);
    await checkResumePdf(directory);
  }
}));

test('missing, truncated or replaced PDF and corrupt metadata are rejected', () => fixture(async directory => {
  const pdf = path.join(directory, 'apps/web/public/resume.pdf');
  const original = await readFile(pdf);
  for (const content of ['not a PDF', '%PDF-1.7\ntruncated', '%PDF-1.7\nreplacement\n%%EOF']) {
    await writeFile(pdf, content);
    await assert.rejects(checkResumePdf(directory), /stale or changed/);
  }
  await rm(pdf);
  await assert.rejects(checkResumePdf(directory), { code: 'ENOENT' });
  await writeFile(pdf, original);
  await writeFile(path.join(directory, 'apps/web/src/resume/pdf-metadata.json'), '{broken');
  await assert.rejects(checkResumePdf(directory), SyntaxError);
}));

test('PingFang searchable text preserves characters and expands noncontiguous radical ranges', () => {
  const cmap = '2 beginbfchar\n<55> <2EEC>\n<EB> <2F2F>\nendbfchar\n1 beginbfrange\n<06> <07> <2ED3>\nendbfrange';
  const corrected = repairCMap(cmap, '齐少轩的简历，前端工程师，长期负责。');
  for (const mapping of ['<55> <9F50>', '<EB> <5DE5>', '<06> <957F>', '<07> <95E8>']) assert.ok(corrected.includes(mapping), mapping);
  assert.ok(!corrected.includes('beginbfrange'));
  assert.equal(repairCMap('1 beginbfchar\n<55> <2EEC>\nendbfchar', '这里刻意使用部首⻬'), '1 beginbfchar\n<55> <2EEC>\nendbfchar');
  assert.equal(repairCMap('1 beginbfchar\n<01> <FF08>\nendbfchar', '（正文）'), '1 beginbfchar\n<01> <FF08>\nendbfchar');
});
