type Health = { status: 'ok'; service: string };

type MockReply = { mode: 'mock'; message: { role: 'assistant'; content: string } };

function apiUrl(path: '/api/health' | '/api/chat'): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  const base = configured || (import.meta.env.PROD ? 'https://101.201.78.159' : '');
  if (!base) return path;

  const url = new URL(base);
  if (
    (url.protocol !== 'https:' && !(import.meta.env.DEV && url.protocol === 'http:')) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash
  ) {
    throw new Error('API 地址配置无效，请检查公开的服务地址。');
  }
  return new URL(path, url.origin).href;
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
  return { status: 'ok', service: result.service };
}

export async function sendMockMessage(content: string, signal: AbortSignal): Promise<MockReply> {
  const message = content.trim();
  if (!message || content.length > 4_000) throw new Error('请输入 1 至 4000 字的测试内容。');
  const response = await fetch(apiUrl('/api/chat'), {
    method: 'POST',
    signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: message }] }),
  });
  if (!response.ok) throw new Error('测试请求失败，请稍后重试。');
  const result: unknown = await response.json();
  if (
    typeof result !== 'object' || result === null ||
    !('mode' in result) || result.mode !== 'mock' ||
    !('message' in result) || typeof result.message !== 'object' || result.message === null ||
    !('role' in result.message) || result.message.role !== 'assistant' ||
    !('content' in result.message) || typeof result.message.content !== 'string' ||
    !result.message.content.trim()
  ) {
    throw new Error('测试响应格式不符合预期。');
  }
  return { mode: 'mock', message: { role: 'assistant', content: result.message.content } };
}
