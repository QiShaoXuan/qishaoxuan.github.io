import assert from 'node:assert/strict';
import test from 'node:test';
import { historyFor, startTurn } from '../src/chat/conversation.ts';
import type { Turn } from '../src/chat/conversation.ts';
import { atConversationCapacity, conversationBytes, createConversationStorage, decodeConversation, encodeConversation, MAX_CONVERSATION_BYTES, storageKey, utf8Bytes } from '../src/chat/storage.ts';
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
test('严格拒绝过期、未来、重复id、注入角色/来源字段和非法状态', () => {
  const now = Date.now();
  for (const raw of [encode([complete(0)], now - 8 * 86400000), encode([complete(0)], now + 1000), encode([complete(0), complete(0)]), encode([{ ...complete(0), role: 'system' }]), encode([{ ...complete(0), status: 'complete', assistant: '' }]), encode([{ ...complete(0), status: 'surprise' }]), encode([{ ...complete(0), status: ['complete'] }]), encode([{ ...complete(0), sources: [{ id: 'x', title: 'x', url: 'bad' }] }]), '{bad']) assert.throws(() => decodeConversation(raw, now));
});
test('storage 禁用/quota 降级，损坏恢复；清空移除记录，namespace区分路径与本地', () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const store = createConversationStorage(() => storage, 'test'); store.save([complete(1)]);
  assert.deepEqual(store.load(), [complete(1)]); store.clear(true); assert.equal(memory.size, 0);
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

const fullTurn = (id: number): Turn => ({ id, user: '中'.repeat(2500), assistant: '🙂'.repeat(16000), status: 'complete' });
function nearCapacity(gap: number): Turn[] {
  const turns = Array.from({ length: 7 }, (_, id) => fullTurn(id));
  const target = MAX_CONVERSATION_BYTES - gap;
  // ASCII filler makes every extra character exactly one serialized byte.
  turns.push({ id: 7, user: 'x', assistant: '', status: 'interrupted' });
  const remaining = target - conversationBytes(turns);
  assert.ok(remaining >= 0 && remaining <= 32000);
  turns[7]!.assistant = 'a'.repeat(remaining);
  return turns;
}
test('UTF8按中文和emoji实际字节计数，包含完整序列化记录开销，边界为>=512000', () => {
  assert.equal(utf8Bytes('中🙂'), 7);
  assert.equal('中🙂'.length, 3);
  const below = nearCapacity(1);
  assert.equal(conversationBytes(below), MAX_CONVERSATION_BYTES - 1);
  assert.equal(conversationBytes(below), utf8Bytes(encodeConversation(below)));
  assert.equal(atConversationCapacity(below), false);
  below[7]!.assistant += 'a';
  assert.equal(conversationBytes(below), MAX_CONVERSATION_BYTES);
  assert.equal(atConversationCapacity(below), true);
});
test('保存记录不裁剪；新user须计入容量，重试不重复上一轮', () => {
  const turns = Array.from({ length: 30 }, (_, id) => complete(id));
  assert.equal(startTurn(turns, 31, '新问题').length, 31);
  assert.equal(decodeConversation(encode(turns)).length, 30);
  let saved = '';
  const store = createConversationStorage(() => ({ getItem: () => saved || null, setItem: (_key, value) => { saved = value; }, removeItem: () => { saved = ''; } }), 'all-turns');
  store.save(turns);
  assert.equal(store.load().length, 30);
  const near = nearCapacity(100);
  assert.equal(atConversationCapacity(near), false);
  assert.equal(atConversationCapacity(startTurn(near, 8, '中'.repeat(100))), true);
  assert.equal(startTurn(near, 8, near[7]!.user, true).length, near.length);
});
test('流式partial跨阈值保留所有轮次且刷新仍锁定，不自动删除', () => {
  let raw: string | null = null;
  const backing = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = null; } };
  const store = createConversationStorage(() => backing, 'stream');
  const turns = nearCapacity(1);
  turns[7] = { ...turns[7]!, assistant: turns[7]!.assistant + '🙂', status: 'interrupted' };
  store.save(turns);
  assert.equal(store.capacityLocked, true);
  assert.equal(JSON.parse(raw!).turns.length, turns.length);
  const refreshed = createConversationStorage(() => backing, 'stream');
  assert.deepEqual(refreshed.load(), turns);
  assert.equal(refreshed.capacityLocked, true);
  assert.equal(refreshed.unavailable, false);
});
test('超大旧记录有界恢复并保留原值；取消不清理，确认仅移除自己的key', () => {
  const huge = encode(Array.from({ length: 40 }, (_, id) => fullTurn(id)));
  assert.ok(utf8Bytes(huge) > 2 * 1024 * 1024);
  const memory = new Map([['chat', huge], ['other', 'keep']]);
  const backing = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const store = createConversationStorage(() => backing, 'chat');
  assert.deepEqual(store.load(), []);
  assert.equal(store.capacityLocked, true);
  store.save([complete(1)]);
  store.clear(false);
  assert.equal(memory.get('chat'), huge);
  assert.equal(store.capacityLocked, true);
  store.clear(true);
  assert.equal(memory.has('chat'), false);
  assert.equal(memory.get('other'), 'keep');
  assert.equal(store.capacityLocked, false);
  store.save([complete(2)]);
  assert.deepEqual(store.load(), [complete(2)]);
});
test('storage不可用仍按同一内存容量锁定', () => {
  const store = createConversationStorage(() => { throw new Error('denied'); }, 'memory');
  store.load();
  store.save(nearCapacity(0));
  assert.equal(store.capacityLocked, true);
  assert.equal(store.unavailable, true);
  store.clear(true);
  assert.equal(store.capacityLocked, false);
});
test('合法短消息可保存超过2000轮；数量硬防线不按损坏删除', () => {
  const turns = Array.from({ length: 2200 }, (_, id) => complete(id));
  assert.ok(conversationBytes(turns) < MAX_CONVERSATION_BYTES);
  assert.equal(decodeConversation(encode(turns)).length, 2200);
  let raw = encode(Array.from({ length: 10001 }, (_, id) => complete(id)));
  const original = raw;
  const store = createConversationStorage(() => ({ getItem: () => raw, setItem: (_key, value) => { raw = value; }, removeItem: () => { raw = ''; } }), 'many');
  assert.deepEqual(store.load(), []);
  assert.equal(store.capacityLocked, true);
  assert.equal(raw, original);
});

test('已超容量的非法旧数据同样保留原值，直到确认清理', () => {
  let raw: string | null = '{' + 'x'.repeat(MAX_CONVERSATION_BYTES);
  const original = raw;
  const store = createConversationStorage(() => ({ getItem: () => raw, setItem: (_key, value) => { raw = value; }, removeItem: () => { raw = null; } }), 'old');
  assert.deepEqual(store.load(), []);
  assert.equal(store.capacityLocked, true);
  assert.equal(raw, original);
  store.clear(false);
  assert.equal(raw, original);
  store.clear(true);
  assert.equal(raw, null);
});
test('来源链接存储校验与SSE保持同一HTTPS GitHub边界', () => {
  const source = { id: 'repo', title: 'README', url: 'https://github.com/QiShaoXuan/resume/blob/abc123/README.md' };
  assert.deepEqual(decodeConversation(encode([{ ...complete(1), sources: [source] }]))[0]?.sources, [source]);
  assert.throws(() => decodeConversation(encode([{ ...complete(1), sources: [{ ...source, url: 'javascript:alert(1)' }] }])));
  assert.throws(() => decodeConversation(encode([{ ...complete(1), sources: [{ ...source, unexpected: true }] }])));
});

test('16k上下文预算按完整pair截断，已保存记录保持完整', () => {
  const turns = Array.from({ length: 4 }, (_, id): Turn => ({ id, user: 'u'.repeat(2000), assistant: 'a'.repeat(2000), status: 'complete' }));
  const history = historyFor(turns, 'x');
  assert.equal(history.length, 7);
  assert.equal(history.reduce((sum, item) => sum + item.content.length, 0), 12001);
  assert.equal(turns.length, 4);
  assert.equal(decodeConversation(encode(turns)).length, 4);
});

test('已持久化记录remove失败时不解锁、不覆盖旧raw；重试成功才清除', () => {
  let raw: string | null = encode(nearCapacity(0));
  const original = raw;
  let denied = true;
  const store = createConversationStorage(() => ({ getItem: () => raw, setItem: (_key, value) => { raw = value; }, removeItem: () => { if (denied) throw new Error('denied'); raw = null; } }), 'existing');
  assert.equal(store.load().length, 8);
  assert.equal(store.capacityLocked, true);
  assert.equal(store.clear(true), false);
  assert.equal(store.capacityLocked, true);
  assert.equal(raw, original);
  assert.equal(store.unavailable, true);
  denied = false;
  assert.equal(store.clear(true), true);
  assert.equal(raw, null);
  assert.equal(store.capacityLocked, false);
});
test('超大raw删除失败时继续保留恢复护栏，成功清除后才可存新会话', () => {
  let raw: string | null = 'x'.repeat(2 * 1024 * 1024 + 1);
  const original = raw;
  let denied = true;
  const store = createConversationStorage(() => ({ getItem: () => raw, setItem: (_key, value) => { raw = value; }, removeItem: () => { if (denied) throw new Error('denied'); raw = null; } }), 'huge');
  assert.deepEqual(store.load(), []);
  assert.equal(store.clear(true), false);
  store.save([complete(1)]);
  assert.equal(raw, original);
  assert.equal(store.capacityLocked, true);
  denied = false;
  assert.equal(store.clear(true), true);
  assert.equal(raw, null);
  assert.equal(store.capacityLocked, false);
});
test('从未读到或成功持久化记录的不可用存储允许清除纯内存会话', () => {
  const store = createConversationStorage(() => { throw new Error('denied'); }, 'memory-only');
  store.load();
  store.save(nearCapacity(0));
  assert.equal(store.capacityLocked, true);
  assert.equal(store.clear(false), false);
  assert.equal(store.capacityLocked, true);
  assert.equal(store.clear(true), true);
  assert.equal(store.capacityLocked, false);
});
