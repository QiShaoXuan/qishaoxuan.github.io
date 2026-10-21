import { ArrowUpIcon, StopIcon } from '@heroicons/react/24/outline';
import type { RefObject } from 'react';

/** Adapted from Beautiful UI ChatComposer (MIT), commit
 * 44a274e598395ab61e7c96c26fda2758780253b7, components/primitives/ChatComposer.tsx.
 * Preserves the field shell, footer and send control. Controlled textarea replaces
 * the demo input, scripted replies and timers. Icons use Heroicons.
 * https://github.com/slev12397/beautiful-ui
 */
export function ChatComposer({ draft, onDraftChange, pending, disabled = false, onSend, onCancel, inputRef }: {
  draft: string;
  onDraftChange: (value: string) => void;
  pending: boolean;
  disabled?: boolean;
  onSend: () => void;
  onCancel: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <form className="beautiful-composer" onSubmit={(event) => { event.preventDefault(); if (!disabled) onSend(); }}>
      <div className="beautiful-field">
        <textarea
          ref={inputRef}
          disabled={disabled}
          aria-label="聊天内容"
          aria-describedby="chat-input-hint"
          placeholder="想进一步了解什么？"
          rows={3}
          maxLength={4000}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              if (!disabled) onSend();
            }
          }}
        />
        <div className="beautiful-composer-footer">
          <span id="chat-input-hint">{disabled ? '聊天记录已达 500 KiB 容量限制，请先清除缓存' : 'Enter 发送 · Shift + Enter 换行'}</span>
          {pending ? (
            <button className="beautiful-send" type="button" onClick={onCancel} aria-label="停止回复" title="停止回复"><StopIcon aria-hidden="true" /></button>
          ) : (
            <button className="beautiful-send" type="submit" disabled={disabled || !draft.trim()} aria-label="发送消息" title="发送消息"><ArrowUpIcon aria-hidden="true" /></button>
          )}
        </div>
      </div>
    </form>
  );
}
