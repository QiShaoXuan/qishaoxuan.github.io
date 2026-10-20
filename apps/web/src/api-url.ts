type ApiPath = '/api/health' | '/api/chat';

/** Preserve the optional development prefix instead of resolving an absolute path against origin. */
export function resolveApiUrl(path: ApiPath, base: string, allowHttp = false): string {
  if (!base) return path;

  const invalid = () => new Error('API 地址配置无效，请检查公开的服务地址。');
  // Validate before URL parsing: URL normalizes encoded dots, traversal and backslashes.
  if (/\s|\\|%/.test(base) || !/^https?:\/\/[^/?#]+(?:\/dev\/?|\/)?$/i.test(base)) {
    throw invalid();
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw invalid();
  }
  if (
    (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) ||
    url.username || url.password || url.search || url.hash ||
    !['/', '/dev', '/dev/'].includes(url.pathname)
  ) {
    throw invalid();
  }
  const prefix = url.pathname === '/' ? '' : '/dev';
  return `${url.origin}${prefix}${path}`;
}
