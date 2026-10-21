import { resolveApiUrl } from './api-url';

import { createChatParser } from './chat/stream';
import type { ChatEvent } from './chat/stream';
import type { HistoryMessage } from './chat/conversation';

type Health = { status: 'ok'; service: string; audit?: { enabled: boolean; retentionDays: number } };

function apiUrl(path: '/api/health' | '/api/chat'): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  const base = configured || (import.meta.env.PROD ? 'https://101.201.78.159' : '');
  return resolveApiUrl(path, base, import.meta.env.DEV);
}

export async function checkHealth(signal: AbortSignal): Promise<Health> {
  const response = await fetch(apiUrl('/api/health'), { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('连接检查失败，请确认服务已启动后重试。');
  const result: unknown = await response.json();
  if (
    typeof result !== 'object' || result === null ||
    !('status' in result) || result.status !== 'ok' ||
    !('service' in result) || typeof result.service !== 'string'
  ) {
    throw new Error('服务响应格式不符合预期，请检查后端状态。');
  }
  const audit = 'audit' in result ? result.audit : undefined;
  const policy = typeof audit === 'object' && audit !== null && 'enabled' in audit && typeof audit.enabled === 'boolean' && 'retentionDays' in audit && typeof audit.retentionDays === 'number' && Number.isInteger(audit.retentionDays) && audit.retentionDays >= 1 && audit.retentionDays <= 7
    ? { enabled: audit.enabled, retentionDays: audit.retentionDays } : undefined;
  return { status: 'ok', service: result.service, audit: policy };
}

export async function streamChat(messages: HistoryMessage[], signal: AbortSignal, onEvent: (event: ChatEvent) => void): Promise<void> {
  const controller = new AbortController();
  let timedOut = false;
  let requestId: string | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const abort = () => controller.abort();
  const expire = () => { timedOut = true; controller.abort(); };
  const total = window.setTimeout(expire, 125_000);
  let idle = window.setTimeout(expire, 30_000);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  try {
    const response = await fetch(apiUrl('/api/chat'), {
      method: 'POST', signal: controller.signal,
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    requestId = response.headers.get('X-Request-Id');
    if (!response.ok) throw new Error(response.status === 429 ? '请求过于频繁，请稍后再试。' : '暂时无法回复，请稍后重试。');
    if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream') || !response.body) throw new Error('服务未返回有效的流式回复。');
    const parser = createChatParser((event) => {
      if (controller.signal.aborted) return;
      if (event.type === 'error') throw new Error(event.message);
      onEvent(event);
    });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw new Error('已停止本次回复。');
      window.clearTimeout(idle);
      idle = window.setTimeout(expire, 30_000);
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
  } catch (error) {
    if (timedOut) throw new Error('回复超时，请重试。', { cause: error });
    if (signal.aborted) throw new Error('已停止本次回复。', { cause: error });
    const message = error instanceof Error ? error.message : '连接中断，请重试。';
    throw new Error(`${message}${requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId) ? `（请求编号：${requestId}）` : ''}`, { cause: error });
  } finally {
    window.clearTimeout(total); window.clearTimeout(idle);
    signal.removeEventListener('abort', abort);
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  }
}
