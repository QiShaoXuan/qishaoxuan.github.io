import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Read only the three approved public inputs; never scan neighboring directories. */
export async function generateKnowledge(
  resumePath = path.join(root, 'readme.md'),
  outputPath = path.join(root, 'apps/api/src/knowledge.generated.ts'),
  affinePath = path.join(root, 'docs/knowledge/affine.md'),
  bytedancePath = path.join(root, 'docs/knowledge/bytedance.md'),
) {
  const [resumeDocument, affineDocument, bytedanceDocument] = await Promise.all([
    readFile(resumePath, 'utf8'), readFile(affinePath, 'utf8'), readFile(bytedancePath, 'utf8'),
  ]);
  for (const [name, content] of [['Public resume', resumeDocument], ['AFFiNE knowledge', affineDocument], ['ByteDance knowledge', bytedanceDocument]]) {
    if (!content.trim() || Buffer.byteLength(content) > 64 * 1024) {
      throw new Error(`${name} must be nonempty and at most 64 KiB.`);
    }
  }
  // Keep the canonical resume untouched. Its legacy ByteDance project block contains details
  // superseded by the approved redacted knowledge, so do not expose that block to the model.
  const resumeSections = [...resumeDocument.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  const projects = resumeSections.filter((section) => section[1] === '项目经验');
  const resumeProjects = [...resumeDocument.matchAll(/^### ([^\r\n]+)\r?$/gm)];
  const legacy = resumeProjects.filter((section) => /^ByteDance(?:[（(\s]|$)/.test(section[1]));
  const nextProject = legacy.length === 1 ? resumeProjects[resumeProjects.indexOf(legacy[0]) + 1] : undefined;
  const nextResumeSection = projects.length === 1 ? resumeSections[resumeSections.indexOf(projects[0]) + 1] : undefined;
  if (projects.length !== 1 || legacy.length !== 1 || !/^ByteDance（[^）\r\n]+）$/.test(legacy[0][1])
    || legacy[0].index < projects[0].index || !nextProject || !nextResumeSection || nextProject.index >= nextResumeSection.index) {
    throw new Error('Public resume requires exactly one legacy ByteDance project block inside 项目经验 with a following same-level project boundary.');
  }
  const resume = resumeDocument.slice(0, legacy[0].index) + resumeDocument.slice(nextProject.index);
  const sections = [...affineDocument.matchAll(/^## (\d+)\. [^\r\n]+\r?$/gm)];
  const approved = sections.slice(0, 7);
  if (approved.length !== 7 || sections.slice(7).some((section) => Number(section[1]) <= 7) || approved.some((section, index) => Number(section[1]) !== index + 1)
    || approved.slice(0, 6).some((section, index) => !affineDocument.slice(section.index + section[0].length, approved[index + 1].index).trim())) {
    throw new Error('AFFiNE knowledge requires complete, nonempty sections 1–6 and an ordered section 7 boundary.');
  }
  const affine = affineDocument.slice(approved[0].index, approved[6].index).trimEnd();
  // ByteDance has an unnumbered overview before the approved body and may later add maintenance sections.
  // Inspect every level-two heading so unexpected sections cannot enter the model unnoticed.
  const bytedanceSections = [...bytedanceDocument.matchAll(/^##[ \t]+([^\r\n]*)\r?$/gm)];
  const bytedanceStart = bytedanceSections.findIndex((section) => /^1\. \S/.test(section[1]));
  const bytedanceApproved = bytedanceSections.slice(bytedanceStart);
  if (bytedanceStart < 0 || bytedanceSections.slice(0, bytedanceStart).some((section) => /^\d+\./.test(section[1]))
    || bytedanceApproved.length < 5
    || bytedanceApproved.some((section, index) => Number(section[1].match(/^(\d+)\. \S/)?.[1]) !== index + 1)
    || bytedanceApproved.slice(0, 5).some((section, index) => !bytedanceDocument.slice(section.index + section[0].length, bytedanceApproved[index + 1]?.index ?? bytedanceDocument.length).trim())) {
    throw new Error('ByteDance knowledge requires complete, nonempty sections 1–5 followed only by ordered numbered maintenance sections.');
  }
  const bytedance = bytedanceDocument.slice(bytedanceApproved[0].index, bytedanceApproved[5]?.index).trimEnd();
  const hash = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);
  const version = hash(JSON.stringify({ resume, affine, bytedance }));
  const module = [
    '// Generated from readme.md and approved sections of docs/knowledge/affine.md and bytedance.md. Do not edit.',
    `export const RESUME_TEXT = ${JSON.stringify(resume)};`,
    `export const RESUME_VERSION = ${JSON.stringify(hash(resume))};`,
    `export const AFFINE_TEXT = ${JSON.stringify(affine)};`,
    `export const AFFINE_VERSION = ${JSON.stringify(hash(affine))};`,
    `export const BYTEDANCE_TEXT = ${JSON.stringify(bytedance)};`,
    `export const BYTEDANCE_VERSION = ${JSON.stringify(hash(bytedance))};`,
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
