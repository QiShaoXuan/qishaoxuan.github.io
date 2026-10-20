import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeftStartOnRectangleIcon, ArrowRightStartOnRectangleIcon, ArrowsPointingOutIcon, ChatBubbleLeftRightIcon, XMarkIcon, ArrowPathIcon, SparklesIcon, TrashIcon } from '@heroicons/react/24/outline';
import { streamChat } from '../api';
import { historyFor, startTurn } from './conversation';
import type { Turn } from './conversation';
import { atConversationCapacity, createConversationStorage, storageKey } from './storage';
import { ChatComposer } from './beautiful/ChatComposer';
import { ThinkingState } from './beautiful/ThinkingState';
import { clampPosition, dockTarget, floatingSize, initialPosition, passedDragThreshold } from './geometry';
import type { DockSide, Point } from './geometry';
import './chat.css';

export type ChatMode = 'floating' | 'left' | 'right';
type RequestState = { state: 'idle' } | { state: 'pending'; content: string; generating: boolean } | { state: 'error'; content: string; message: string };
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
  const [storage] = useState(() => createConversationStorage(() => window.localStorage, storageKey(import.meta.env.BASE_URL, import.meta.env.DEV)));
  const [messages, setMessages] = useState<Turn[]>(() => storage.load());
  const [capacityLocked, setCapacityLocked] = useState(storage.capacityLocked);
  const [sendCapacityExceeded, setSendCapacityExceeded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(storage.unavailable);
  const messagesRef = useRef(messages);
  const [request, setRequest] = useState<RequestState>({ state: 'idle' });
  const pending = useRef<AbortController | null>(null);
  const drag = useRef<Drag | null>(null);
  const nextId = useRef(Math.max(-1, ...messages.map((turn) => turn.id)) + 1);
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

  function updateMessages(update: (current: Turn[]) => Turn[]) {
    const next = update(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
    storage.save(next);
    setStorageUnavailable(storage.unavailable);
    setCapacityLocked(storage.capacityLocked);
    setSendCapacityExceeded(false);
  }

  function stop() {
    const controller = pending.current;
    if (!controller) return;
    pending.current = null;
    controller.abort();
    updateMessages((current) => current.map((turn) => turn.status === 'pending' ? { ...turn, status: 'interrupted' } : turn));
    const last = messagesRef.current.at(-1);
    setRequest(last ? { state: 'error', content: last.user, message: '已停止本次回复，未完成内容不会用于后续对话。' } : { state: 'idle' });
  }

  function clear() {
    if (!confirmClear) return;
    if (!storage.clear(true)) {
      setClearFailed(true);
      setStorageUnavailable(storage.unavailable);
      return;
    }
    pending.current?.abort();
    pending.current = null;
    setClearFailed(false);
    messagesRef.current = [];
    setMessages([]);
    setCapacityLocked(false);
    setSendCapacityExceeded(false);
    setStorageUnavailable(storage.unavailable);
    setConfirmClear(false);
    setDraft('');
    setRequest({ state: 'idle' });
  }

  async function send(content: string, retry = false) {
    const text = content.trim();
    if (pending.current || capacityLocked || storage.capacityLocked || atConversationCapacity(messagesRef.current) || !text || text.length > 4000) return;
    const id = nextId.current;
    const next = startTurn(messagesRef.current, id, text, retry);
    if (atConversationCapacity(next)) { setSendCapacityExceeded(true); return; }
    const history = historyFor(messagesRef.current, text);
    const controller = new AbortController();
    pending.current = controller;
    nextId.current++;
    updateMessages(() => next);
    if (!retry) setDraft('');
    setRequest({ state: 'pending', content: text, generating: false });
    let finished = false;
    try {
      await streamChat(history, controller.signal, (event) => {
        if (pending.current !== controller || controller.signal.aborted) return;
        if (event.type === 'meta') updateMessages((current) => current.map((turn) => turn.id === id ? { ...turn, mode: event.mode } : turn));
        if (event.type === 'delta') {
          updateMessages((current) => current.map((turn) => turn.id === id ? { ...turn, assistant: turn.assistant + event.content } : turn));
          if (!storage.capacityLocked) setRequest({ state: 'pending', content: text, generating: true });
        }
        if (event.type === 'done') {
          finished = true;
          updateMessages((current) => current.map((turn) => turn.id === id ? { ...turn, sources: event.sources, finishReason: event.finishReason } : turn));
        }
        if (storage.capacityLocked) {
          pending.current = null;
          controller.abort();
          updateMessages((current) => current.map((turn) => turn.id === id ? { ...turn, status: 'interrupted' } : turn));
          setCapacityLocked(true);
          setRequest({ state: 'idle' });
        }
      });
      if (pending.current !== controller || controller.signal.aborted) return;
      if (!finished || !messagesRef.current.find((turn) => turn.id === id)?.assistant.trim()) throw new Error('未收到完整回复，请重试。');
      const limited = messagesRef.current.find((turn) => turn.id === id)?.finishReason === 'length';
      updateMessages((current) => current.map((turn) => turn.id === id ? { ...turn, status: limited ? 'interrupted' : 'complete' } : turn));
      setRequest(limited ? { state: 'error', content: text, message: '回复已达到长度上限，未完成内容不会用于后续对话。' } : { state: 'idle' });
    } catch (error) {
      if (pending.current !== controller) return;
      updateMessages((current) => current.map((turn) => turn.id === id ? { ...turn, status: 'error' } : turn));
      setRequest({ state: 'error', content: text, message: error instanceof Error ? error.message : '连接中断，请重试。' });
    } finally {
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
            <div className="chat-heading"><SparklesIcon aria-hidden="true" /><div><h2 id="chat-title">AI 简历助手</h2><span>基于公开简历回答</span></div></div>
            <div className="chat-actions">
              {!mobile && <>
                <button type="button" onClick={() => changeMode('left')} title="停靠左侧" aria-label="停靠左侧" aria-pressed={mode === 'left'}><ArrowLeftStartOnRectangleIcon aria-hidden="true" /></button>
                <button type="button" onClick={() => changeMode('right')} title="停靠右侧" aria-label="停靠右侧" aria-pressed={mode === 'right'}><ArrowRightStartOnRectangleIcon aria-hidden="true" /></button>
                {mode !== 'floating' && <button type="button" onClick={() => changeMode('floating')} title="恢复浮窗" aria-label="恢复浮窗"><ArrowsPointingOutIcon aria-hidden="true" /></button>}
              </>}
              <button type="button" onClick={() => setConfirmClear(true)} title="清空对话" aria-label="清空对话"><TrashIcon aria-hidden="true" /></button>
              <button type="button" onClick={close} title="关闭聊天" aria-label="关闭聊天"><XMarkIcon aria-hidden="true" /></button>
            </div>
          </header>
          {confirmClear && <div className="chat-clear-confirm" role="alertdialog" aria-labelledby="chat-clear-title" aria-describedby="chat-clear-description">
            <h3 id="chat-clear-title">清空聊天记录</h3>
            <p id="chat-clear-description">清空当前浏览器中的本环境聊天记录？清空后无法恢复。</p>
            {clearFailed && <p role="alert">清除失败，请检查浏览器存储权限后重试</p>}
            <div><button type="button" onClick={() => { setConfirmClear(false); setClearFailed(false); }}>取消</button><button type="button" onClick={clear}>确认清空</button></div>
          </div>}
          {(capacityLocked || sendCapacityExceeded) && <div className="chat-capacity-warning" role="alert"><p>{capacityLocked ? '聊天记录已达到 500 KiB 容量限制，继续聊天前请清除聊天缓存。已有记录会保留，清空后无法恢复。' : '发送本条消息将达到 500 KiB 容量限制，请缩短消息或清除聊天缓存。'}</p><button type="button" onClick={() => setConfirmClear(true)}>清除聊天缓存</button></div>}
          <div className="chat-thread" ref={thread} role="log" aria-label="聊天记录" aria-live="polite" aria-relevant="additions text">
            {messages.length === 0 && <div className="chat-welcome"><span className="chat-welcome-icon"><ChatBubbleLeftRightIcon aria-hidden="true" /></span><h3>从一段对话开始</h3><p>工作经历、项目实践，或是协作方式，<br />你想先了解哪一部分？</p><div className="chat-suggestions">{['聊聊你的工作经历', '介绍一个代表项目', '你如何与团队协作？'].map((text) => <button key={text} type="button" disabled={capacityLocked} onClick={() => { void send(text); }}>{text}</button>)}</div></div>}
            {messages.map((turn) => <div key={turn.id} className="chat-turn">
              <div className="beautiful-message" data-role="user"><span className="chat-message-label">你</span><p>{turn.user}</p></div>
              {(turn.assistant || turn.status === 'interrupted' || turn.status === 'error') && <div className="beautiful-message" data-role="assistant"><span className="chat-message-label">{turn.mode === 'mock' ? '演示回复' : 'AI 回复'}{turn.finishReason === 'length' ? ' · 达到长度上限' : turn.status === 'interrupted' ? ' · 已停止 / 中断' : turn.status === 'error' ? ' · 未完成' : ''}</span><p>{turn.assistant || '未生成回复。'}</p>{turn.status === 'complete' && !!turn.sources?.length && <p className="chat-sources">参考：{turn.sources.map((source, index) => <span key={source.id}>{index > 0 && '、'}{source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title}</span>)}</p>}</div>}
            </div>)}
            {request.state === 'pending' && <ThinkingState generating={request.generating} />}
            {!capacityLocked && request.state === 'idle' && ['interrupted', 'error'].includes(messages.at(-1)?.status ?? '') && <div className="chat-error" role="status"><p>上次回复已中断，可以重新发送。</p><button type="button" onClick={() => { void send(messages.at(-1)!.user, true); }}><ArrowPathIcon aria-hidden="true" />重新发送</button></div>}
            {!capacityLocked && request.state === 'error' && <div className="chat-error" role="status"><p>{request.message}</p><button type="button" onClick={() => { void send(request.content, true); }}><ArrowPathIcon aria-hidden="true" />重新发送</button></div>}
          </div>
          <ChatComposer draft={draft} onDraftChange={(value) => { setDraft(value); setSendCapacityExceeded(false); }} pending={request.state === 'pending'} disabled={capacityLocked} onSend={() => { void send(draft); }} onCancel={stop} inputRef={input} />
          {storageUnavailable && <p className="chat-disclaimer" role="status">本地存储不可用，当前对话仅在内存中保留。</p>}
          <p className="chat-disclaimer">当前对话使用 deepseek。 AI 可能出错，可以和本人聊聊～</p>
        </section>
      </>}
    </>
  );
}
