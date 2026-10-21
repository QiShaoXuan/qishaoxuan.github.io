import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { ChatComposer } from '../src/chat/beautiful/ChatComposer.tsx';

type ElementProps = { children?: ReactElement<ElementProps> | ReactElement<ElementProps>[]; disabled?: boolean; onSubmit?: (event: { preventDefault: () => void }) => void; onClick?: () => void; onKeyDown?: (event: { key: string; shiftKey: boolean; nativeEvent: { isComposing: boolean }; keyCode: number; preventDefault: () => void }) => void };
const props = { draft: '问题', onDraftChange: () => {}, pending: false, onSend: () => {}, onCancel: () => {}, inputRef: { current: null } };
const children = (element: ReactElement<ElementProps>) => Array.isArray(element.props.children) ? element.props.children : [element.props.children!];

test('达到容量后禁用输入、发送和Enter，但仍允许停止正在生成的回复', () => {
  let sent = 0; let stopped = 0;
  const form: ReactElement<ElementProps> = ChatComposer({ ...props, disabled: true, pending: true, onSend: () => { sent++; }, onCancel: () => { stopped++; } });
  const field = children(form)[0]!;
  const [textarea, footer] = children(field);
  assert.equal(textarea!.props.disabled, true);
  form.props.onSubmit!({ preventDefault() {} });
  textarea!.props.onKeyDown!({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, keyCode: 13, preventDefault() {} });
  assert.equal(sent, 0);
  const stopButton = children(footer!)[1]!;
  assert.notEqual(stopButton.props.disabled, true);
  stopButton.props.onClick!();
  assert.equal(stopped, 1);
  const markup = renderToStaticMarkup(ChatComposer({ ...props, disabled: true }));
  assert.match(markup, /聊天记录已达 500 KiB 容量限制/);
  assert.match(markup, /type="submit" disabled=""/);
});
test('未达容量时保留正常提交和Enter发送', () => {
  let sent = 0;
  const form: ReactElement<ElementProps> = ChatComposer({ ...props, onSend: () => { sent++; } });
  form.props.onSubmit!({ preventDefault() {} });
  const textarea = children(children(form)[0]!)[0]!;
  textarea.props.onKeyDown!({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, keyCode: 13, preventDefault() {} });
  assert.equal(sent, 2);
});
