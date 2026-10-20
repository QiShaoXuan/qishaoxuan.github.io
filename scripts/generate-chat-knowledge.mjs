import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Read only the two approved public inputs; never scan neighboring directories. */
export async function generateKnowledge(
  resumePath = path.join(root, 'readme.md'),
  outputPath = path.join(root, 'apps/api/src/knowledge.generated.ts'),
  affinePath = path.join(root, 'docs/knowledge/affine.md'),
) {
  const [resume, affineDocument] = await Promise.all([
    readFile(resumePath, 'utf8'), readFile(affinePath, 'utf8'),
  ]);
  for (const [name, content] of [['Public resume', resume], ['AFFiNE knowledge', affineDocument]]) {
    if (!content.trim() || Buffer.byteLength(content) > 64 * 1024) {
      throw new Error(`${name} must be nonempty and at most 64 KiB.`);
    }
  }
  const sections = [...affineDocument.matchAll(/^## (\d+)\. [^\r\n]+\r?$/gm)];
  const approved = sections.slice(0, 7);
  if (approved.length !== 7 || sections.slice(7).some((section) => Number(section[1]) <= 7) || approved.some((section, index) => Number(section[1]) !== index + 1)
    || approved.slice(0, 6).some((section, index) => !affineDocument.slice(section.index + section[0].length, approved[index + 1].index).trim())) {
    throw new Error('AFFiNE knowledge requires complete, nonempty sections 1–6 and an ordered section 7 boundary.');
  }
  const affine = affineDocument.slice(approved[0].index, approved[6].index).trimEnd();
  const hash = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);
  const version = hash(JSON.stringify({ resume, affine }));
  const module = [
    '// Generated from readme.md and approved sections of docs/knowledge/affine.md. Do not edit.',
    `export const RESUME_TEXT = ${JSON.stringify(resume)};`,
    `export const RESUME_VERSION = ${JSON.stringify(hash(resume))};`,
    `export const AFFINE_TEXT = ${JSON.stringify(affine)};`,
    `export const AFFINE_VERSION = ${JSON.stringify(hash(affine))};`,
    `export const KNOWLEDGE_VERSION = ${JSON.stringify(version)};`,
    '',
  ].join('\n');
  await mkdir(path.dirname(outputPath), { recursive: true });
  let existing;
  try {
    existing = await readFile(outputPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Avoid restarting tsx watch when tests/builds regenerate unchanged knowledge.
  if (existing !== module) await writeFile(outputPath, module);
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateKnowledge();
}
