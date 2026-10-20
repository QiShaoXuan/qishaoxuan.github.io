import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildSystemPrompt, getKnowledgeSources, KNOWLEDGE_VERSION } from '../src/prompts.js';
import { AFFINE_VERSION, RESUME_VERSION } from '../src/knowledge.generated.js';

test('approved AFFiNE decisions and debugging process are available without live GitHub', () => {
  const prompt = buildSystemPrompt({ repositories: [], unavailable: ['toeverything/AFFiNE'] });
  for (const fact of ['8px', 'link-preview-js', 'Context', 'PasteManager', 'ContentParser', 'atext\nh1c', 'assertSelection(page, 1, 2, 0)', 'ClipboardEvent', '本人已确认的选型与复杂案例']) assert.ok(prompt.includes(fact), fact);
  for (const rule of ['以公开简历为准', '无需重复要求本人确认', '不等于齐少轩历史个人贡献', '不能新增或覆盖经历事实', '不声称测试全部通过', '仍可依据已提供的公开简历和 AFFiNE / BlockSuite 项目资料回答']) assert.ok(prompt.includes(rule), rule);
  for (const excluded of ['## 7. 后续可补充', '## 8. 后续接入', '未接入聊天服务', '533 条匹配作者提交索引', '## 4. 关键实现的核验']) assert.ok(!prompt.includes(excluded), excluded);
  assert.match(KNOWLEDGE_VERSION, /^[a-f0-9]{16}$/);
  assert.notEqual(KNOWLEDGE_VERSION, RESUME_VERSION);
});

test('local sources have content versions; deployed sources point to the exact release', () => {
  const local = getKnowledgeSources();
  assert.deepEqual(local.map((source) => source.id), [`resume:${RESUME_VERSION}`, `affine:${AFFINE_VERSION}`]);
  assert.ok(local.every((source) => source.url === undefined));
  const commit = 'a'.repeat(40);
  const deployed = getKnowledgeSources(commit);
  assert.deepEqual(deployed.map((source) => source.url), [
    `https://github.com/QiShaoXuan/qishaoxuan.github.io/blob/${commit}/readme.md`,
    `https://github.com/QiShaoXuan/qishaoxuan.github.io/blob/${commit}/docs/knowledge/affine.md`,
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
  const payload = { messages: [{ role: 'user', content: 'AFFiNE 的剪贴板定位过程是什么？' }] };
  const json = await app.inject({ method: 'POST', url: '/api/chat', payload });
  assert.equal(json.statusCode, 200);
  assert.deepEqual(json.json().sources, getKnowledgeSources(commit));
  const sse = await app.inject({ method: 'POST', url: '/api/chat', payload, headers: { accept: 'text/event-stream' } });
  assert.equal(sse.statusCode, 200);
  const done = /event: done\ndata: (.+)\n/.exec(sse.body);
  assert.ok(done);
  assert.deepEqual(JSON.parse(done[1]!).sources, json.json().sources);
  assert.ok(prompt.includes('atext\nh1c'));
  const records = logs.trim().split('\n').map((line) => JSON.parse(line));
  const chats = records.filter((record) => record.msg === 'chat');
  assert.equal(chats.length, 2);
  for (const record of chats) {
    assert.equal(record.knowledgeVersion, KNOWLEDGE_VERSION);
    assert.deepEqual(record.knowledgeRefs, getKnowledgeSources().map((source) => source.id));
    assert.deepEqual(record.repositoryRefs, []);
  }
  for (const secret of ['secret-not-in-logs', payload.messages[0]!.content, 'PasteManager', 'atext', '本人已确认']) assert.ok(!logs.includes(secret), secret);
});
