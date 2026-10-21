import type { ApiConfig } from './config.js';
import type { ChatProvider, Completion } from './chat.js';
import { buildSystemPrompt } from './prompts.js';
import { ChatError, readSse } from './sse.js';
import type { GithubLoader } from './github.js';

export function deepseekProvider(config: ApiConfig['chat'], fetcher: typeof fetch = fetch, githubLoader?: GithubLoader): ChatProvider {
  return {
    async *stream(messages, signal) {
      const context = githubLoader ? await githubLoader(messages, signal) : undefined;
      signal.throwIfAborted();
      const thinking = config.model === 'deepseek-flash';
      const response = await fetcher('https://api.deepseek.com/chat/completions', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: buildSystemPrompt(context) }, ...messages], thinking: { type: thinking ? 'enabled' : 'disabled' }, stream: true, stream_options: { include_usage: true }, max_tokens: config.maxTokens, ...(!thinking ? { temperature: 0.3 } : {}) }),
      });
      if (!response.ok || !response.body) {
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
        const chunk = value as { id?: unknown; error?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }; choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[] };
        if (chunk.error || !Array.isArray(chunk.choices)) throw new ChatError('UPSTREAM_INVALID_RESPONSE');
        if (typeof chunk.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(chunk.id)) upstreamId = chunk.id;
        if (Number.isSafeInteger(chunk.usage?.prompt_tokens) && Number(chunk.usage?.prompt_tokens) >= 0) promptTokens = Number(chunk.usage?.prompt_tokens);
        if (Number.isSafeInteger(chunk.usage?.completion_tokens) && Number(chunk.usage?.completion_tokens) >= 0) completionTokens = Number(chunk.usage?.completion_tokens);
        const choice = chunk.choices[0];
        const content = choice?.delta?.content;
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
    },
  };
}
