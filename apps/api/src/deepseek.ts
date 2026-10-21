import type { ApiConfig } from './config.js';
import type { ChatProvider, Completion, ChatTelemetry } from './chat.js';
import { buildChatMessages } from './prompts.js';
import { ChatError, readSse } from './sse.js';
import type { GithubLoader } from './github.js';

export function deepseekProvider(config: ApiConfig['chat'], fetcher: typeof fetch = fetch, githubLoader?: GithubLoader): ChatProvider {
  return {
    async *stream(messages, signal, onTelemetry) {
      const thinking = config.model === 'deepseek-flash';
      const telemetry: ChatTelemetry = { thinkingEnabled: thinking, reasoningEffort: thinking ? 'high' : 'none', usageStatus: 'missing' };
      const report = (update: ChatTelemetry) => { Object.assign(telemetry, update); onTelemetry?.({ ...telemetry }); };
      report({});
      const context = githubLoader ? await githubLoader(messages, signal) : undefined;
      signal.throwIfAborted();
      const started = performance.now();
      report({ upstreamStartedAt: Date.now() });
      try {
        const response = await fetcher('https://api.deepseek.com/chat/completions', {
          method: 'POST', signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, messages: buildChatMessages(messages, context), thinking: { type: thinking ? 'enabled' : 'disabled' }, stream: true, stream_options: { include_usage: true }, max_tokens: config.maxTokens, ...(!thinking ? { temperature: 0.3 } : {}) }),
        });
        report({ upstreamStatus: response.status });
        if (!response.ok || !response.body) {
          report({ upstreamErrorCode: 'UPSTREAM_HTTP_ERROR' });
          await response.body?.cancel();
          throw new ChatError(response.status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE');
        }
        let finish: Completion | undefined;
        let done = false, outputLength = 0;
        let promptTokens: number | undefined, completionTokens: number | undefined, upstreamId: string | undefined;
        for await (const frame of readSse(response.body, signal)) {
          if (frame === '[DONE]') { done = true; break; }
          let value: unknown;
          try { value = JSON.parse(frame); } catch { throw new ChatError('UPSTREAM_INVALID_RESPONSE'); }
          if (typeof value !== 'object' || value === null) throw new ChatError('UPSTREAM_INVALID_RESPONSE');
          const chunk = value as { id?: unknown; model?: unknown; error?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_cache_hit_tokens?: unknown; prompt_cache_miss_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown }; completion_tokens_details?: { reasoning_tokens?: unknown } }; choices?: { delta?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }[] };
          if (chunk.error || !Array.isArray(chunk.choices)) {
            report({ upstreamErrorCode: 'UPSTREAM_STREAM_ERROR' });
            throw new ChatError('UPSTREAM_INVALID_RESPONSE');
          }
          if (typeof chunk.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(chunk.id) && (!config.apiKey || !chunk.id.includes(config.apiKey))) upstreamId = chunk.id;
          if (upstreamId) telemetry.upstreamId = upstreamId;
          if (typeof chunk.model === 'string' && /^deepseek-[a-zA-Z0-9._-]{1,80}$/.test(chunk.model) && (!config.apiKey || !chunk.model.includes(config.apiKey))) telemetry.upstreamModel = chunk.model;
          if (Number.isSafeInteger(chunk.usage?.prompt_tokens) && Number(chunk.usage?.prompt_tokens) >= 0) promptTokens = Number(chunk.usage?.prompt_tokens);
          if (Number.isSafeInteger(chunk.usage?.completion_tokens) && Number(chunk.usage?.completion_tokens) >= 0) completionTokens = Number(chunk.usage?.completion_tokens);
          if (promptTokens !== undefined) telemetry.promptTokens = promptTokens;
          if (completionTokens !== undefined) telemetry.completionTokens = completionTokens;
          for (const [key, value] of [
            ['cacheHitTokens', chunk.usage?.prompt_cache_hit_tokens ?? chunk.usage?.prompt_tokens_details?.cached_tokens],
            ['cacheMissTokens', chunk.usage?.prompt_cache_miss_tokens],
            ['reasoningTokens', chunk.usage?.completion_tokens_details?.reasoning_tokens],
          ] as const) if (Number.isSafeInteger(value) && Number(value) >= 0) telemetry[key] = Number(value);
          telemetry.usageStatus = promptTokens !== undefined && completionTokens !== undefined ? 'complete'
            : [telemetry.promptTokens, telemetry.completionTokens, telemetry.cacheHitTokens, telemetry.cacheMissTokens, telemetry.reasoningTokens].some((value) => value !== undefined) ? 'partial' : 'missing';
          const choice = chunk.choices[0];
          if (typeof choice?.delta?.reasoning_content === 'string' && choice.delta.reasoning_content && telemetry.firstReasoningMs === undefined) telemetry.firstReasoningMs = performance.now() - started;
          const content = choice?.delta?.content;
          if (typeof content === 'string' && content && telemetry.firstContentMs === undefined) telemetry.firstContentMs = performance.now() - started;
          report({});
          if (content !== undefined && content !== null) {
            if (typeof content !== 'string' || finish) throw new ChatError('UPSTREAM_INVALID_RESPONSE');
            outputLength += content.length;
            if (outputLength > 16384) throw new ChatError('OUTPUT_LIMIT');
            if (content) yield content;
          }
          if (choice?.finish_reason != null) {
            if (finish || !['stop', 'length'].includes(String(choice.finish_reason))) throw new ChatError('UPSTREAM_FINISH_ERROR');
            finish = { finishReason: choice.finish_reason as 'stop' | 'length' };
          }
        }
        if (!done || !finish) throw new ChatError('UPSTREAM_TRUNCATED');
        return { ...finish, ...(promptTokens !== undefined ? { promptTokens } : {}), ...(completionTokens !== undefined ? { completionTokens } : {}), ...(upstreamId ? { upstreamId } : {}), ...(context?.repositories.length ? { sources: context.repositories.map((repository) => repository.source) } : {}) };
      } finally { report({ upstreamDurationMs: performance.now() - started }); }
    },
  };
}
