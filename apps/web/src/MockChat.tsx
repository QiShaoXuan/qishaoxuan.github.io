import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { sendMockMessage } from './api';

type Result =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; content: string }
  | { state: 'error'; message: string };

export function MockChat() {
  const [content, setContent] = useState('你好，请测试聊天连接。');
  const [result, setResult] = useState<Result>({ state: 'idle' });
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => {
    pending.current?.abort();
    pending.current = null;
  }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !content.trim() || content.length > 4_000) return;
    const controller = new AbortController();
    pending.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);
    setResult({ state: 'loading' });

    try {
      const reply = await sendMockMessage(content, controller.signal);
      if (pending.current === controller && !controller.signal.aborted) {
        setResult({ state: 'ready', content: reply.message.content });
      }
    } catch {
      if (pending.current === controller) {
        setResult({
          state: 'error',
          message: timedOut
            ? '测试请求超时，请稍后重新发送。'
            : '测试请求失败，请检查服务状态后重新发送。',
        });
      }
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === controller) pending.current = null;
    }
  }

  const loading = result.state === 'loading';

  return (
    <section className="connection mock-chat" aria-labelledby="mock-heading">
      <div className="section-heading">
        <h2 id="mock-heading">Mock 聊天联调</h2>
        <span className="badge">固定测试回复</span>
      </div>
      <p className="mock-description">仅用于检查聊天链路，不调用模型，不提供真实工作经历问答。</p>
      <form onSubmit={(event) => { void send(event); }}>
        <label htmlFor="mock-message">测试内容</label>
        <textarea
          id="mock-message"
          name="message"
          rows={3}
          maxLength={4_000}
          required
          disabled={loading}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          aria-describedby="mock-hint"
        />
        <p className="hint" id="mock-hint">最多 4000 字，仅用于 Mock 测试。</p>
        <button type="submit" disabled={loading || !content.trim()}>
          {loading ? '正在发送…' : result.state === 'error' ? '重新发送测试' : '发送测试'}
        </button>
      </form>
      <div className="mock-result" role="status" aria-live="polite" aria-atomic="true">
        {result.state === 'loading' && <p>正在等待测试回复…</p>}
        {result.state === 'ready' && <><h3>Mock 回复</h3><p>{result.content}</p></>}
        {result.state === 'error' && <p>{result.message}</p>}
      </div>
    </section>
  );
}
