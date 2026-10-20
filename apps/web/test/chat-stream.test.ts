import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatParser } from '../src/chat/stream.ts';
import type { ChatEvent } from '../src/chat/stream.ts';
const frame = (event: string, data: unknown) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const meta = frame('meta', { requestId: 'test-1', mode: 'deepseek' });
const done = frame('done', { finishReason: 'stop', sources: [{ id: 'resume', title: '公开简历' }] });
test('UTF-8 单字节切块、CRLF、注释和多行 data 保持内容', () => {
  const events: ChatEvent[] = [];
  const parser = createChatParser((event) => events.push(event));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const bytes = new TextEncoder().encode(`: heartbeat\r\n\r\n${meta}event: delta\r\ndata: {"content":\r\ndata: "你好🙂"}\r\n\r\n${done}`);
  for (const byte of bytes) parser.push(decoder.decode(Uint8Array.of(byte), { stream: true }));
  parser.push(decoder.decode()); parser.finish();
  assert.deepEqual(events.map((event) => event.type), ['meta', 'delta', 'done']);
  assert.deepEqual(events[1], { type: 'delta', content: '你好🙂' });
});
test('EOF、partial、未知/非法事件、顺序与过大帧均失败', () => {
  for (const raw of [meta, `${meta}event: done\ndata: {}`, `${meta}${frame('delta', { content: 3 })}`, frame('delta', { content: 'x' }), `${meta}${meta}`, `${meta}${frame('other', {})}`, `${meta}${done}${done}`, `${meta}${done}event: delta\n`, `${meta}${frame('done', { finishReason: 'stop', sources: [{ id: '1', title: 'a', url: 'https://fake' }] })}`, `:${'x'.repeat(33_000)}`]) {
    assert.throws(() => { const parser = createChatParser(() => {}); parser.push(raw); parser.finish(); }, Error, raw.slice(0, 70));
  }
});
test('累计回复有界；错误事件可识别，不能被当作完整回复', () => {
  const events: ChatEvent[] = []; const parser = createChatParser((event) => events.push(event));
  parser.push(frame('error', { code: 'upstream', message: '稍后重试', requestId: 'request' })); parser.finish();
  assert.equal(events[0]?.type, 'error');
  const oversized = createChatParser(() => {}); oversized.push(meta);
  oversized.push(frame('delta', { content: 'x'.repeat(20_000) }));
  assert.throws(() => oversized.push(frame('delta', { content: 'x'.repeat(20_000) })), /内容过长/);
});
