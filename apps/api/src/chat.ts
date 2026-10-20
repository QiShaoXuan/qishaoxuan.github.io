import { ChatError } from './sse.js';
export interface Message { role: 'user' | 'assistant'; content: string }
export interface Source { id: string; title: string; url?: string }
export interface Completion { finishReason: 'stop' | 'length'; promptTokens?: number; completionTokens?: number; upstreamId?: string; sources?: Source[] }
export interface ChatProvider {
  stream(messages: Message[], signal: AbortSignal): AsyncGenerator<string, Completion>;
}
export const MOCK_MESSAGE = '这是一条 Mock 测试回复，聊天链路已接通。正式工作经历问答将在后续接入。';
export const mockProvider: ChatProvider = {
  async *stream(_messages, signal) { signal.throwIfAborted(); yield MOCK_MESSAGE; return { finishReason: 'stop' }; },
};
export function validateHistory(messages: Message[]) {
  if (messages.at(-1)?.role !== 'user' || messages.some((message, index) => message.role !== (index % 2 === 0 ? 'user' : 'assistant')) || messages.reduce((total, message) => total + message.content.length, 0) > 16000) {
    throw new ChatError('INVALID_REQUEST', 400);
  }
}
