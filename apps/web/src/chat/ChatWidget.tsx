import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeftStartOnRectangleIcon, ArrowRightStartOnRectangleIcon, ArrowsPointingOutIcon, ChatBubbleLeftRightIcon, XMarkIcon, ArrowPathIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { sendMockMessage } from '../api';
import { ChatComposer } from './beautiful/ChatComposer';
import { ThinkingState } from './beautiful/ThinkingState';
import { clampPosition, dockTarget, floatingSize, initialPosition, passedDragThreshold } from './geometry';
import type { DockSide, Point } from './geometry';
import './chat.css';

export type ChatMode = 'floating' | 'left' | 'right';
type Message = { id: number; role: 'user' | 'assistant'; content: string };
type RequestState = { state: 'idle' } | { state: 'pending'; content: string } | { state: 'error'; content: string; message: string };
type Drag = { pointerId: number; start: Point; origin: Point; target: DockSide | null; active: boolean; docked: boolean };
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

export function ChatWidget({ open, onOpenChange, mode, onModeChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}) {
  const [position, setPosition] = useState(() => initialPosition(viewport()));
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const [snap, setSnap] = useState<DockSide | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [request, setRequest] = useState<RequestState>({ state: 'idle' });
  const pending = useRef<AbortController | null>(null);
  const drag = useRef<Drag | null>(null);
  const nextId = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const resize = () => {
      setMobile(window.innerWidth < 768);
      setPosition((current) => clampPosition(current, viewport()));
      drag.current = null;
      setDragging(false);
      setSnap(null);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
    else if (wasOpen.current) launcher.current?.focus();
    wasOpen.current = open;
  }, [open, mobile]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        drag.current = null;
        setDragging(false);
        setSnap(null);
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open, onOpenChange]);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'instant' });
  }, [messages, request, open]);

  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);

  function close() {
    drag.current = null;
    setDragging(false);
    setSnap(null);
    onOpenChange(false);
  }

  function changeMode(next: ChatMode) {
    if (next === 'floating') setPosition(initialPosition(viewport()));
    onModeChange(next);
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (mobile || event.button !== 0 || (event.target as HTMLElement).closest('button, input, textarea, a')) return;
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
    let origin = { x: bounds.left, y: bounds.top };
    if (mode !== 'floating') {
      const size = floatingSize(viewport());
      origin = clampPosition({ x: event.clientX - Math.min(size.width - 20, Math.max(20, (event.clientX - bounds.left) / bounds.width * size.width)), y: event.clientY - Math.min(32, event.clientY - bounds.top) }, viewport());
    }
    drag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin, target: null, active: false, docked: mode !== 'floating' };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active) {
      if (!passedDragThreshold(current.start, { x: event.clientX, y: event.clientY })) return;
      current.active = true;
      setDragging(true);
      if (current.docked) onModeChange('floating');
    }
    setPosition(clampPosition({ x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y }, viewport()));
    current.target = dockTarget(event.clientX, window.innerWidth);
    setSnap(current.target);
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    setSnap(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && current.active && current.target) onModeChange(current.target);
  }

  async function send(content: string, retry = false) {
    const text = content.trim();
    if (pending.current || !text || text.length > 4000) return;
    const controller = new AbortController();
    pending.current = controller;
    if (!retry) {
      setMessages((current) => [...current, { id: nextId.current++, role: 'user', content: text }]);
      setDraft('');
    }
    setRequest({ state: 'pending', content: text });
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    try {
      const reply = await sendMockMessage(text, controller.signal);
      if (pending.current !== controller || controller.signal.aborted) return;
      setMessages((current) => [...current, { id: nextId.current++, role: 'assistant', content: reply.message.content }]);
      setRequest({ state: 'idle' });
    } catch {
      if (pending.current === controller) {
        setRequest({ state: 'error', content: text, message: timedOut ? '回复超时，请重试。' : controller.signal.aborted ? '已停止本次回复。' : '暂时无法连接，请重试。' });
      }
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === controller) pending.current = null;
    }
  }

  return (
    <>
      <button ref={launcher} className="chat-launcher" hidden={open} onClick={() => onOpenChange(true)} aria-label="打开聊天" title="打开聊天" aria-expanded={open} aria-controls="resume-chat">
        <ChatBubbleLeftRightIcon aria-hidden="true" /><span>聊聊我的经历</span>
      </button>
      {open && <>
        {snap && <div className="chat-snap-preview" data-side={snap} aria-hidden="true"><span>松开以停靠到{snap === 'left' ? '左' : '右'}侧</span></div>}
        <section ref={panel} id="resume-chat" role="dialog" aria-labelledby="chat-title" aria-modal={mobile} onKeyDown={(event) => {
          if (!mobile || event.key !== 'Tab') return;
          const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? []).filter((control) => control.getClientRects().length > 0);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }} className="chat-panel" data-mode={mode} data-dragging={dragging || undefined} style={mode === 'floating' && !mobile ? { left: position.x, top: position.y } : undefined}>
          <header className="chat-header" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={(event) => endDrag(event)} onPointerCancel={(event) => endDrag(event, true)} onLostPointerCapture={(event) => endDrag(event, true)}>
            <div className="chat-heading"><SparklesIcon aria-hidden="true" /><div><h2 id="chat-title">关于我的经历</h2><span>简历对话 · 演示模式</span></div></div>
            <div className="chat-actions">
              {!mobile && <>
                <button type="button" onClick={() => changeMode('left')} title="停靠左侧" aria-label="停靠左侧" aria-pressed={mode === 'left'}><ArrowLeftStartOnRectangleIcon aria-hidden="true" /></button>
                <button type="button" onClick={() => changeMode('right')} title="停靠右侧" aria-label="停靠右侧" aria-pressed={mode === 'right'}><ArrowRightStartOnRectangleIcon aria-hidden="true" /></button>
                {mode !== 'floating' && <button type="button" onClick={() => changeMode('floating')} title="恢复浮窗" aria-label="恢复浮窗"><ArrowsPointingOutIcon aria-hidden="true" /></button>}
              </>}
              <button type="button" onClick={close} title="关闭聊天" aria-label="关闭聊天"><XMarkIcon aria-hidden="true" /></button>
            </div>
          </header>
          <div className="chat-thread" ref={thread} role="log" aria-label="聊天记录" aria-live="polite" aria-relevant="additions text">
            {messages.length === 0 && <div className="chat-welcome"><span className="chat-welcome-icon"><ChatBubbleLeftRightIcon aria-hidden="true" /></span><h3>从一段对话开始</h3><p>工作经历、项目实践，或是协作方式，<br />你想先了解哪一部分？</p><div className="chat-suggestions">{['聊聊你的工作经历', '介绍一个代表项目', '你如何与团队协作？'].map((text) => <button key={text} type="button" onClick={() => { void send(text); }}>{text}</button>)}</div></div>}
            {messages.map((message) => <div key={message.id} className="beautiful-message" data-role={message.role}><span className="chat-message-label">{message.role === 'user' ? '你' : '演示回复'}</span><p>{message.content}</p></div>)}
            {request.state === 'pending' && <ThinkingState />}
            {request.state === 'error' && <div className="chat-error" role="status"><p>{request.message}</p><button type="button" onClick={() => { void send(request.content, true); }}><ArrowPathIcon aria-hidden="true" />重新发送</button></div>}
          </div>
          <ChatComposer draft={draft} onDraftChange={setDraft} pending={request.state === 'pending'} onSend={() => { void send(draft); }} onCancel={() => pending.current?.abort()} inputRef={input} />
          <p className="chat-disclaimer">当前为固定演示回复，尚未接入 AI 模型。</p>
        </section>
      </>}
    </>
  );
}
