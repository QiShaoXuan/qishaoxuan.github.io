import { MAX_REPLY } from './conversation';
import type { Source } from './conversation';
export type ChatEvent =
  | { type: 'meta'; requestId: string; mode: 'mock' | 'deepseek' }
  | { type: 'delta'; content: string }
  | { type: 'done'; finishReason: 'stop' | 'length'; sources: Source[] }
  | { type: 'error'; code: string; message: string; requestId: string };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
export function validSources(value: unknown): value is Source[] {
  return Array.isArray(value) && value.length <= 20 && value.every((source: unknown) => record(source) && string(source.id, 100) && string(source.title, 200) && Object.keys(source).every((key) => key === 'id' || key === 'title'));
}
function parseEvent(type: string, data: string): ChatEvent {
  const value: unknown = JSON.parse(data);
  if (!record(value)) throw new Error('回复格式异常。');
  if (type === 'meta' && string(value.requestId, 128) && (value.mode === 'mock' || value.mode === 'deepseek')) return { type, requestId: value.requestId, mode: value.mode };
  if (type === 'delta' && string(value.content, MAX_REPLY)) return { type, content: value.content };
  if (type === 'done' && (value.finishReason === 'stop' || value.finishReason === 'length') && validSources(value.sources)) return { type, finishReason: value.finishReason, sources: value.sources };
  if (type === 'error' && string(value.code, 100) && string(value.message, 1000) && string(value.requestId, 128)) return { type, code: value.code, message: value.message, requestId: value.requestId };
  throw new Error('回复格式异常。');
}

/** Incremental SSE parser. Neither unterminated frames nor EOF imply success. */
export function createChatParser(onEvent: (event: ChatEvent) => void) {
  let buffer = ''; let event = ''; let data: string[] = []; let frameSize = 0;
  let meta = false; let done = false; let contentSize = 0;
  const line = (value: string) => {
    frameSize += value.length;
    if (frameSize > 32_768) throw new Error('回复数据过大。');
    if (!value) {
      if (data.length) {
        if (done) throw new Error('回复结束后收到额外数据。');
        const parsed = parseEvent(event, data.join('\n'));
        if (parsed.type === 'meta') { if (meta) throw new Error('重复的回复信息。'); meta = true; }
        else if (!meta && parsed.type !== 'error') throw new Error('缺少回复信息。');
        if (parsed.type === 'delta') { contentSize += parsed.content.length; if (contentSize > MAX_REPLY) throw new Error('回复内容过长。'); }
        if (parsed.type === 'done' || parsed.type === 'error') done = true;
        onEvent(parsed);
      }
      event = ''; data = []; frameSize = 0; return;
    }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let body = colon < 0 ? '' : value.slice(colon + 1);
    if (body.startsWith(' ')) body = body.slice(1);
    if (field === 'event') event = body;
    if (field === 'data') data.push(body);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const current = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        line(current.endsWith('\r') ? current.slice(0, -1) : current);
      }
      if (buffer.length + frameSize > 32_768) throw new Error('回复数据过大。');
    },
    finish() { if (!done || buffer || data.length || event || frameSize) throw new Error('回复中断，请重试。'); },
  };
}
