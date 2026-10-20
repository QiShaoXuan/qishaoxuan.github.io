import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { blockText, parseResumeBlocks, parseResumeSections, safeLink } from '../src/resume/resume-source.ts';
import type { ResumeBlock } from '../src/resume/resume-source.ts';

const source = readFileSync(new URL('../../../readme.md', import.meta.url), 'utf8');

test('all resume sections, lines, links and numeric facts survive parsing', () => {
  const sections = parseResumeSections(source);
  assert.deepEqual(sections.map(section => section.title), ['个人相关', '联系方式', '工作经历', '个人总结', '项目经验', '个人项目及作品']);
  const parsed = sections.map(section => `${section.title}\n${blockText(section.blocks)}`).join('\n');
  for (const line of source.split('\n').filter(line => line.trim())) {
    const content = line.trim().replace(/^#{1,6}\s+/, '').replace(/^(?:[-*+]|\d+\.)\s+/, '');
    assert.ok(parsed.includes(content), `lost source content: ${content}`);
  }
  for (const fact of source.match(/\d+(?:[.\-–]\d+)*(?:k\+|\+|%|pp|ms|KB|s)?/g) ?? []) assert.ok(parsed.includes(fact), `lost numeric fact: ${fact}`);
  const work = sections.find(section => section.title === '工作经历')!.blocks[0];
  assert.equal(work.type, 'list');
  if (work.type === 'list') assert.equal(work.items.length, 5);
});

test('nested ordered and unordered lists retain parent relationships and paragraphs', () => {
  const blocks = parseResumeBlocks('1. **项目**\n\n   第一段说明\n\n   - 分析\n     - 第一级\n     - 第二级\n   - 解决\n\n2. 后续项目');
  assert.equal(blocks.length, 1);
  const outer = blocks[0];
  assert.equal(outer.type, 'list');
  if (outer.type !== 'list') return;
  assert.equal(outer.ordered, true);
  assert.equal(outer.items.length, 2);
  assert.deepEqual(outer.items[0].slice(0, 2), [{ type: 'paragraph', text: '**项目**' }, { type: 'paragraph', text: '第一段说明' }]);
  const nested = outer.items[0][2];
  assert.equal(nested.type, 'list');
  if (nested.type !== 'list') return;
  assert.equal(nested.ordered, false);
  assert.equal(nested.items.length, 2);
  const sublist = nested.items[0][1];
  assert.equal(sublist.type, 'list');
  if (sublist.type === 'list') assert.equal(sublist.items.length, 2);
});

test('current project content keeps all five company groups and deeply nested lists', () => {
  const project = parseResumeSections(source).find(section => section.title === '项目经验')!;
  assert.equal(project.blocks.filter(block => block.type === 'heading').length, 5);
  const depth = (blocks: ResumeBlock[]): number => Math.max(0, ...blocks.map(block => block.type === 'list' ? 1 + Math.max(0, ...block.items.map(depth)) : 0));
  assert.ok(depth(project.blocks) >= 3);
});

test('empty input is empty; raw HTML remains inert text and unsafe links are rejected', () => {
  assert.deepEqual(parseResumeBlocks(' \n\n'), []);
  assert.deepEqual(parseResumeSections(''), []);
  assert.deepEqual(parseResumeBlocks('<script>alert(1)</script>'), [{ type: 'paragraph', text: '<script>alert(1)</script>' }]);
  for (const href of ['javascript:alert(1)', 'data:text/html,test', '//example.com', ' javascript:alert(1)']) assert.equal(safeLink(href), undefined);
  assert.equal(safeLink('https://github.com/QiShaoXuan'), 'https://github.com/QiShaoXuan');
});
