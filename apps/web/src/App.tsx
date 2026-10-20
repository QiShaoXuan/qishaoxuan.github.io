import { useEffect, useState } from 'react';
import { checkHealth } from './api';
import { MockChat } from './MockChat';

type Connection =
  | { state: 'loading' }
  | { state: 'ready'; service: string }
  | { state: 'error'; message: string };

export function App() {
  const [attempt, setAttempt] = useState(0);
  const [connection, setConnection] = useState<Connection>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);
    void checkHealth(controller.signal)
      .then(({ service }) => {
        if (active && !controller.signal.aborted) setConnection({ state: 'ready', service });
      })
      .catch((error: unknown) => {
        if (!active || (controller.signal.aborted && !timedOut)) return;
        setConnection({
          state: 'error',
          message: timedOut
            ? '连接检查超时，请确认服务已启动后重试。'
            : error instanceof TypeError
              ? '暂时无法连接服务，请检查网络或后端状态。'
              : error instanceof Error ? error.message : '连接检查失败，请稍后重试。',
        });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  return (
    <main className="page">
      <header>
        <p className="eyebrow">QI SHAO XUAN / WORK IN PROGRESS</p>
        <h1>简历网站开发环境</h1>
        <p className="intro">个人经历与对话体验，从这里开始。</p>
      </header>

      <section className="connection" aria-labelledby="connection-heading">
        <div className="section-heading">
          <h2 id="connection-heading">连接检查</h2>
          <span className={`badge badge-${connection.state}`}>
            {connection.state === 'loading' ? '检查中' : connection.state === 'ready' ? '已连接' : '待重试'}
          </span>
        </div>
        <div className="status" role="status" aria-live="polite" aria-atomic="true">
          {connection.state === 'loading' && <p>正在检查前后端连接…</p>}
          {connection.state === 'ready' && <p>服务响应正常：<strong>{connection.service}</strong></p>}
          {connection.state === 'error' && <p>{connection.message}</p>}
        </div>
        <button
          type="button"
          disabled={connection.state === 'loading'}
          onClick={() => {
            setConnection({ state: 'loading' });
            setAttempt((value) => value + 1);
          }}
        >
          {connection.state === 'loading' ? '正在检查…' : connection.state === 'error' ? '重试连接' : '重新检查'}
        </button>
        <p className="hint">此区域用于开发阶段确认服务连接。</p>
      </section>

      <MockChat />

      <section className="upcoming" aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading">接下来</h2>
        <div className="cards">
          <article><span>01</span><h3>简历展示</h3><p>待接入最新简历与项目经历。</p></article>
          <article><span>02</span><h3>AI 对话</h3><p>当前可测试 Mock 回复，真实工作经历问答待接入。</p></article>
        </div>
      </section>
      <footer>网站建设中 · 基础架构预览</footer>
    </main>
  );
}
