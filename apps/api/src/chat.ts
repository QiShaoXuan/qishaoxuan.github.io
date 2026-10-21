import { ChatError } from './sse.js';
export interface Message { role: 'user' | 'assistant'; content: string }
export interface Source { id: string; title: string; url?: string }
export interface Completion { finishReason: 'stop' | 'length'; promptTokens?: number; completionTokens?: number; upstreamId?: string; sources?: Source[] }
export interface ChatTelemetry {
  thinkingEnabled?: boolean; reasoningEffort?: 'high' | 'none';
  upstreamStatus?: number; upstreamId?: string; upstreamModel?: string;
  upstreamStartedAt?: number; upstreamDurationMs?: number; firstReasoningMs?: number; firstContentMs?: number;
  promptTokens?: number; completionTokens?: number; cacheHitTokens?: number; cacheMissTokens?: number; reasoningTokens?: number;
  usageStatus?: 'missing' | 'partial' | 'complete'; upstreamErrorCode?: 'UPSTREAM_HTTP_ERROR' | 'UPSTREAM_STREAM_ERROR';
}
export interface ChatProvider {
  stream(messages: Message[], signal: AbortSignal, onTelemetry?: (update: ChatTelemetry) => void): AsyncGenerator<string, Completion>;
}
export const MOCK_MESSAGE = '这是一条 Mock 测试回复，聊天链路已接通。正式工作经历问答将在后续接入。';
export const mockProvider: ChatProvider = {
  async *stream(_messages, signal) { signal.throwIfAborted(); yield MOCK_MESSAGE; return { finishReason: 'stop' }; },
};
export function validateHistory(messages: Message[]) {
  if (messages.at(-1)?.role !== 'user' || messages.some((message, index) => message.role !== (index % 2 === 0 ? 'user' : 'assistant') || message.content.length > (message.role === 'user' ? 4000 : 16384)) || messages.reduce((total, message) => total + message.content.length, 0) > 32768) {
    throw new ChatError('INVALID_REQUEST', 400);
  }
}
