import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildSystemPrompt, getKnowledgeSources, KNOWLEDGE_VERSION } from '../src/prompts.js';
import { AFFINE_TEXT, AFFINE_VERSION, BYTEDANCE_TEXT, BYTEDANCE_VERSION, RESUME_TEXT, RESUME_VERSION } from '../src/knowledge.generated.js';

test('AFFiNE cleanup preserves technical facts, shared authorship and contribution boundaries', () => {
  for (const fact of [
    '2022 年 5 月至 2023 年 9 月', '前端核心开发', '清除本地认证状态',
    '443', '336', '107', '90', '83', '指定历史快照', '提交者时间',
    'alt0', 'Peng Xiao', 'Yifeng Wang', 'zqran', '共同作者',
    '8px', 'onDrop', 'Context', 'DOM 挂载', 'link-preview-js', '失败回退',
    'a[b]c', 'atext\nh1c', 'assertSelection(page, 1, 2, 0)',
    '不是跨工作区搬迁', '不是后端授权', 'EdgelessClipboard', 'BlockSuite `#2912`', 'BlockSuite `#2951`',
    '用户增长', '不能等同独立完成的功能数',
  ]) assert.ok(AFFINE_TEXT.includes(fact), fact);
});

test('approved AFFiNE decisions and debugging process are available without live GitHub', () => {
  const prompt = buildSystemPrompt({ repositories: [], unavailable: ['toeverything/AFFiNE'] });
  for (const fact of ['8px', 'link-preview-js', 'Context', 'PasteManager', 'ContentParser', 'atext\nh1c', 'assertSelection(page, 1, 2, 0)', 'ClipboardEvent']) assert.ok(prompt.includes(fact), fact);
  for (const rule of ['任职时间以公开简历为准', '无需重复要求本人确认', '不等于齐少轩历史个人贡献', '不能新增或覆盖经历事实', '不声称测试全部通过', '仍可依据已提供的公开简历、AFFiNE / BlockSuite 和字节跳动项目资料回答']) assert.ok(prompt.includes(rule), rule);
  for (const excluded of ['## 7. 后续可补充', '## 8. 后续接入', '未接入聊天服务', '533 条匹配作者提交索引', '## 4. 关键实现的核验']) assert.ok(!prompt.includes(excluded), excluded);
  assert.match(KNOWLEDGE_VERSION, /^[a-f0-9]{16}$/);
  assert.notEqual(KNOWLEDGE_VERSION, RESUME_VERSION);
});

test('model-facing knowledge excludes editorial workflow while the prompt retains honesty boundaries', () => {
  assert.doesNotMatch(AFFINE_TEXT, /本次|本轮|待补|待核|确认日期|未逐行审查|未运行当年|可继续补充|见第\s*\d+\./);
  assert.doesNotMatch(AFFINE_TEXT, /^### Q\d+.*【/m);
  const prompt = buildSystemPrompt();
  for (const rule of ['不主动附加资料整理过程', '只有问题所需的信息确实缺失时', '未提供的主观难度排名、协作故事和个人动机不能自行补写', '不声称测试全部通过', '不能暗示重新运行过历史测试', '信息缺失不代表项目未完成', '不将其作为本人经历补入回答']) assert.ok(prompt.includes(rule), rule);
});

test('local sources have content versions; deployed sources point to the exact release', () => {
  const local = getKnowledgeSources();
  assert.deepEqual(local.map((source) => source.id), [`resume:${RESUME_VERSION}`, `affine:${AFFINE_VERSION}`, `bytedance:${BYTEDANCE_VERSION}`]);
  assert.ok(local.every((source) => source.url === undefined));
  const commit = 'a'.repeat(40);
  const deployed = getKnowledgeSources(commit);
  assert.deepEqual(deployed.map((source) => source.url), [
    `https://github.com/QiShaoXuan/qishaoxuan.github.io/blob/${commit}/readme.md`,
    `https://github.com/QiShaoXuan/qishaoxuan.github.io/blob/${commit}/docs/knowledge/affine.md`,
    `https://github.com/QiShaoXuan/qishaoxuan.github.io/blob/${commit}/docs/knowledge/bytedance.md`,
  ]);
  assert.throws(() => getKnowledgeSources('../private'), /Invalid knowledge source commit/);
});

test('JSON and SSE cite loaded local knowledge even if GitHub fails; logs only contain versions', async (t) => {
  let logs = '', prompt = '';
  const commit = 'b'.repeat(40);
  const logStream = new Writable({ write(chunk, _encoding, callback) { logs += String(chunk); callback(); } });
  const app = await buildApp(loadConfig({ NODE_ENV: 'test', API_CHAT_MODE: 'deepseek', DEEPSEEK_API_KEY: 'secret-not-in-logs', RELEASE_COMMIT: commit, DEPLOY_ENV: 'dev' }), {
    logStream,
    githubFetch: async () => new Response('', { status: 404 }),
    fetch: async (_input, init) => {
      prompt = JSON.parse(String(init?.body)).messages[0].content;
      return new Response('data: {"choices":[{"delta":{"content":"素材已读取"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    },
  });
  t.after(() => app.close());
  const payload = { messages: [{ role: 'user', content: '字节跳动的复制导出和录屏诊断具体怎么做？' }] };
  const json = await app.inject({ method: 'POST', url: '/api/chat', payload });
  assert.equal(json.statusCode, 200);
  assert.deepEqual(json.json().sources, getKnowledgeSources(commit));
  const sse = await app.inject({ method: 'POST', url: '/api/chat', payload, headers: { accept: 'text/event-stream' } });
  assert.equal(sse.statusCode, 200);
  const done = /event: done\ndata: (.+)\n/.exec(sse.body);
  assert.ok(done);
  assert.deepEqual(JSON.parse(done[1]!).sources, json.json().sources);
  assert.ok(prompt.includes('atext\nh1c'));
  assert.ok(prompt.includes(BYTEDANCE_TEXT));
  assert.ok(json.json().sources.some((source: { id: string }) => source.id === `bytedance:${BYTEDANCE_VERSION}`));
  const records = logs.trim().split('\n').map((line) => JSON.parse(line));
  const chats = records.filter((record) => record.msg === 'chat');
  assert.equal(chats.length, 2);
  for (const record of chats) {
    assert.equal(record.knowledgeVersion, KNOWLEDGE_VERSION);
    assert.deepEqual(record.knowledgeRefs, getKnowledgeSources().map((source) => source.id));
    assert.deepEqual(record.repositoryRefs, []);
  }
  for (const secret of ['secret-not-in-logs', payload.messages[0]!.content, 'PasteManager', 'atext', '本人已确认', 'ClipboardItem', '12000px', '5 分钟滑动环形缓冲']) assert.ok(!logs.includes(secret), secret);
});


test('ByteDance context uses redacted project facts without the legacy resume project claims', () => {
  const prompt = buildSystemPrompt();
  assert.ok(prompt.includes(BYTEDANCE_TEXT));
  for (const fact of ['ClipboardItem', 'text/plain', '90s', '12000px', '10MiB', '750px', '375px', '5 分钟', 'P75', '2026 年 8 月 10–16 日', '10 月 2–8 日', '后续迭代', '五个数据查询接口', '一期灰度']) {
    assert.ok(BYTEDANCE_TEXT.includes(fact), fact);
  }
  assert.doesNotMatch(RESUME_TEXT, /^### ByteDance/m);
  assert.ok(RESUME_TEXT.includes('2023-11 ~ 至今 - ByteDance'));
  for (const employer of ['### AFFiNE', '### 京东', '### Finxos', '### 垓方']) assert.ok(RESUME_TEXT.includes(employer), employer);
  assert.doesNotMatch(prompt, /橙蕉|ECAM|1\.72|16\.7pp|27\.61%|11\.68%|62\.55%/);
  for (const rule of ['不从其他内容', '精确业务指标', '不扩大', '不能推导因果', '不能说全量迁完', '不能把影子流量、自动对账']) {
    assert.ok(prompt.includes(rule), rule);
  }
});


test('published resume and model knowledge exclude the removed support experience', async () => {
  const resume = await readFile(new URL('../../../readme.md', import.meta.url), 'utf8');
  const knowledge = await readFile(new URL('../../../docs/knowledge/bytedance.md', import.meta.url), 'utf8');
  for (const text of [resume, knowledge, BYTEDANCE_TEXT, buildSystemPrompt()]) {
    assert.doesNotMatch(text, /智能客服|客服支援|知识库配置|客服监控/);
  }
  assert.match(BYTEDANCE_TEXT, /^## 4\. 线上问题录屏与诊断$/m);
  assert.match(BYTEDANCE_TEXT, /^## 5\. 工程效能与服务迁移$/m);
});
