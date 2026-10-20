import type { Message, Source } from './chat.js';

// Commit and exact root README casing verified via git ls-remote + git ls-tree on 2026-10-20.
const REPOSITORIES = [
  { name: 'toeverything/AFFiNE', pattern: /\baffine\b/i, commit: '0b69a6da21e8fd35beb85667bb8496d9b3852238', readme: 'README.md' },
  { name: 'toeverything/blocksuite', pattern: /\bblock\s?suite\b|块级编辑器/i, commit: '5cb5cb68471ca692f3c162258f0087cb22fcb82d', readme: 'README.md' },
  { name: 'QiShaoXuan/css_tricks', pattern: /css[\s_-]*tricks|css\s*总结/i, commit: '939adae5008ace1e4df17c871ccb4c0e583ea1d2', readme: 'README.md' },
  { name: 'QiShaoXuan/js_tricks', pattern: /js[\s_-]*tricks|(?:js|javascript)\s*(?:方法)?总结/i, commit: '02927b37063306fc4c7c236a274fec7f95362a6b', readme: 'README.md' },
  { name: 'QiShaoXuan/blog', pattern: /\bblog\b|博客|学习记录/i, commit: '6a253819533266476e6bda7f0ec16b40ed359b09', readme: 'readme.md' },
  { name: 'QiShaoXuan/wavejs', pattern: /\bwave\s?js\b|波浪动画/i, commit: '8ed8deb2e25a86c2ab1e9ee42b0be1d62f5914a6', readme: 'README.md' },
] as const;
export interface RepositoryContext { source: Source; repository: string; commit: string; text: string; excerpt: boolean; freshness: 'live' | 'snapshot' }
export interface GithubContext { repositories: RepositoryContext[]; unavailable: string[] }
export type GithubLoader = (messages: Message[], signal: AbortSignal) => Promise<GithubContext>;

export function selectRepositories(messages: Message[]): string[] {
  const users = messages.filter((message) => message.role === 'user');
  const current = users.at(-1)?.content ?? '';
  const match = (text: string) => REPOSITORIES.filter((repository) => repository.pattern.test(text)).map((repository) => repository.name);
  const direct = match(current);
  if (direct.length) return direct.slice(0, 2);
  if (/个人项目|个人作品/.test(current)) return ['QiShaoXuan/css_tricks', 'QiShaoXuan/js_tricks'];
  if (/^(?:那|它|这个|该项目|继续|具体|还有|如何|怎么)|上面|刚才|实现细节|技术栈/.test(current)) {
    for (const previous of users.slice(-4, -1).reverse()) {
      const repositories = match(previous.content);
      if (repositories.length) return repositories.slice(0, 2);
    }
  }
  return [];
}

function context(repository: string, commit: string, path: string, text: string, freshness: RepositoryContext['freshness']): RepositoryContext {
  if (!text.trim()) throw new Error('Empty README');
  const source = { id: `github:${repository}@${commit}`, title: `${repository} · README`, url: `https://github.com/${repository}/blob/${commit}/${path}` };
  return { source, repository, commit, text: text.slice(0, 12_000), excerpt: text.length > 12_000, freshness };
}

// Also bound injected transports that do not cooperate with AbortSignal.
async function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// This client never accepts visitor URLs, credentials or arbitrary repository paths.
export function createGithubLoader(fetcher: typeof fetch = fetch, options: { timeoutMs?: number; now?: () => number } = {}): GithubLoader {
  const cache = new Map<string, { expires: number; value?: RepositoryContext }>();
  const now = options.now ?? Date.now;
  async function request(url: string, signal: AbortSignal, accept: string, limit = 100_000): Promise<string> {
    if (!['https://api.github.com', 'https://raw.githubusercontent.com'].includes(new URL(url).origin)) throw new Error('Invalid GitHub origin');
    const response = await fetcher(url, {
      method: 'GET', signal, redirect: 'error', credentials: 'omit',
      headers: { accept, 'x-github-api-version': '2026-03-10', 'user-agent': 'resume-public-project-context' },
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Repository unavailable'); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('Repository response too large');
        chunks.push(value);
      }
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function read(repository: string, signal: AbortSignal): Promise<RepositoryContext | undefined> {
    // Defense in depth: only literal server-owned entries can reach fetch.
    const manifest = REPOSITORIES.find((entry) => entry.name === repository);
    if (!manifest) return undefined;
    signal.throwIfAborted();
    const cached = cache.get(repository);
    if (cached && cached.expires > now()) return cached.value;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 6000);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const value = await bounded((async () => {
        try {
          const liveSignal = AbortSignal.any([combined, AbortSignal.timeout(Math.min(2500, Math.max(1, Math.floor((options.timeoutMs ?? 6000) / 2))))]);
          return await bounded((async (): Promise<RepositoryContext> => {
            const commit = (await request(`https://api.github.com/repos/${repository}/commits/HEAD`, liveSignal, 'application/vnd.github.sha')).trim();
            if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid commit');
            const data = JSON.parse(await request(`https://api.github.com/repos/${repository}/readme?ref=${commit}`, liveSignal, 'application/vnd.github+json')) as { type?: unknown; encoding?: unknown; content?: unknown; path?: unknown; size?: unknown };
            if (data?.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string' || typeof data.path !== 'string' || data.path.length > 1024 || !/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(data.path) || data.path.split('/').some((part) => part === '..' || part === '.') || !Number.isSafeInteger(data.size) || Number(data.size) <= 0 || Number(data.size) > 48_000) throw new Error('Invalid README');
            const base64 = data.content.replace(/\s/g, '');
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Invalid encoding');
            const bytes = Buffer.from(base64, 'base64');
            if (bytes.byteLength !== data.size || bytes.byteLength > 48_000) throw new Error('Invalid size');
            return context(repository, commit, data.path, new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'live');
          })(), liveSignal);
        } catch {
          combined.throwIfAborted();
          const text = await request(`https://raw.githubusercontent.com/${repository}/${manifest.commit}/${manifest.readme}`, combined, 'text/plain', 48_000);
          return context(repository, manifest.commit, manifest.readme, text, 'snapshot');
        }
      })(), combined);
      signal.throwIfAborted();
      cache.set(repository, { expires: now() + 3_600_000, value });
      return value;
    } catch {
      signal.throwIfAborted();
      cache.set(repository, { expires: now() + 60_000 });
      return undefined;
    }
  }
  return async (messages, signal) => {
    signal.throwIfAborted();
    const selected = selectRepositories(messages);
    const values = await Promise.all(selected.map((repository) => read(repository, signal)));
    return { repositories: values.filter((value): value is RepositoryContext => Boolean(value)), unavailable: selected.filter((_repository, index) => !values[index]) };
  };
}
