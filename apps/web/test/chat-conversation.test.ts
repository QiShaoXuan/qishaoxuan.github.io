import assert from 'node:assert/strict';
import test from 'node:test';
import { historyFor, startTurn } from '../src/chat/conversation.ts';
import type { Turn } from '../src/chat/conversation.ts';
import { createConversationStorage, decodeConversation, storageKey } from '../src/chat/storage.ts';
const complete = (id: number): Turn => ({ id, user: `问题${id}`, assistant: `回答${id}`, status: 'complete' });
const encode = (turns: unknown[], savedAt = Date.now()) => JSON.stringify({ version: 1, savedAt, turns });
test('上下文仅包含完整轮次；失败、停止和重试不重复用户或部分回复', () => {
  const interrupted: Turn = { id: 1, user: '未完成问题', assistant: '部分回答', status: 'interrupted' };
  const turns = [complete(0), interrupted];
  const retry = startTurn(turns, 2, interrupted.user, true);
  assert.equal(retry.length, 2); assert.equal(retry[1]?.assistant, '');
  assert.deepEqual(historyFor(turns, interrupted.user), [{ role: 'user', content: '问题0' }, { role: 'assistant', content: '回答0' }, { role: 'user', content: '未完成问题' }]);
  assert.equal(historyFor([{ ...interrupted, status: 'error' }], '新问题').length, 1);
});
test('按完整轮次裁剪数量和16k字符，始终以 user 结尾并交替', () => {
  const history = historyFor(Array.from({ length: 15 }, (_, id) => complete(id)), '最新');
  assert.equal(history.length, 19); assert.equal(history[0]?.content, '问题6');
  assert.equal(history.at(-1)?.role, 'user');
  history.forEach((item, index) => assert.equal(item.role, index % 2 ? 'assistant' : 'user'));
  const large = { ...complete(1), assistant: 'a'.repeat(15_999) };
  assert.deepEqual(historyFor([complete(0), large], '新问题'), [{ role: 'user', content: '新问题' }]);
  assert.throws(() => historyFor([], 'x'.repeat(4001)));
});
test('存储恢复 pending 为中断，不恢复成可发送的完整上下文', () => {
  const restored = decodeConversation(encode([{ ...complete(0), status: 'pending' }]));
  assert.equal(restored[0]?.status, 'interrupted');
  assert.equal(historyFor(restored, '继续').length, 1);
});
test('严格拒绝过期、未来、重复id、超限、注入角色/来源字段和非法状态', () => {
  const now = Date.now();
  for (const raw of [encode([complete(0)], now - 8 * 86400000), encode([complete(0)], now + 1000), encode([complete(0), complete(0)]), encode([{ ...complete(0), role: 'system' }]), encode([{ ...complete(0), status: 'complete', assistant: '' }]), encode([{ ...complete(0), status: 'surprise' }]), encode([{ ...complete(0), status: ['complete'] }]), encode([{ ...complete(0), sources: [{ id: 'x', title: 'x', url: 'bad' }] }]), encode(Array.from({ length: 11 }, (_, id) => complete(id))), '{bad', 'x'.repeat(200001)]) assert.throws(() => decodeConversation(raw, now));
});
test('storage 禁用/quota 降级，损坏恢复；清空移除记录，namespace区分路径与本地', () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const store = createConversationStorage(() => storage, 'test'); store.save([complete(1)]);
  assert.deepEqual(store.load(), [complete(1)]); store.save([]); assert.equal(memory.size, 0);
  const blocked = createConversationStorage(() => { throw new Error('denied'); }, 'test'); assert.deepEqual(blocked.load(), []); assert.equal(blocked.unavailable, true); blocked.save([complete(1)]);
  const quota = createConversationStorage(() => ({ ...storage, setItem() { throw new Error('quota'); } }), 'test'); quota.save([complete(1)]); assert.equal(quota.unavailable, true);
  memory.set('test', '{bad'); const corrupt = createConversationStorage(() => storage, 'test'); assert.deepEqual(corrupt.load(), []); assert.equal(corrupt.unavailable, false); corrupt.save([complete(2)]); assert.deepEqual(corrupt.load(), [complete(2)]);
  assert.notEqual(storageKey('/', false), storageKey('/dev/', false)); assert.notEqual(storageKey('/', true), storageKey('/', false));
});

test('长回复按整轮裁剪，达到长度上限的回复不进入上下文', () => {
  assert.deepEqual(historyFor([complete(0), { ...complete(1), assistant: 'a'.repeat(4001) }], '下一轮'), [{ role: 'user', content: '下一轮' }]);
  assert.deepEqual(historyFor([{ ...complete(0), finishReason: 'length' }], '下一轮'), [{ role: 'user', content: '下一轮' }]);
  assert.throws(() => decodeConversation(encode([{ ...complete(0), finishReason: 'length' }])));
});
test('过期记录移除后仍能保存新会话', () => {
  let raw: string | null = encode([complete(0)], Date.now() - 8 * 86400000);
  const store = createConversationStorage(() => ({ getItem: () => raw, setItem: (_key, value) => { raw = value; }, removeItem: () => { raw = null; } }), 'ttl');
  assert.deepEqual(store.load(), []); assert.equal(raw, null); assert.equal(store.unavailable, false);
  store.save([complete(1)]); assert.deepEqual(store.load(), [complete(1)]);
});
