import type { ServerResponse } from 'node:http';

export class ChatError extends Error {
  constructor(public code: string, public status = 502) { super(code); }
}

// Decode bytes incrementally; SSE lines may use LF, CRLF or CR across chunks.
export async function* readSse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', data: string[] = [], size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) buffer += decoder.decode();
      else {
        size += next.value.byteLength;
        if (size > 2 * 1024 * 1024) throw new ChatError('UPSTREAM_TOO_LARGE');
        buffer += decoder.decode(next.value, { stream: true });
      }
      if (buffer.length > 65536) throw new ChatError('UPSTREAM_FRAME_TOO_LARGE');
      while (true) {
        const match = /[\r\n]/.exec(buffer);
        if (!match || (!next.done && buffer[match.index] === '\r' && match.index === buffer.length - 1)) break;
        const line = buffer.slice(0, match.index);
        const width = buffer.slice(match.index, match.index + 2) === '\r\n' ? 2 : 1;
        buffer = buffer.slice(match.index + width);
        if (!line) {
          if (data.length) { yield data.join('\n'); data = []; }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
          if (data.reduce((n, value) => n + value.length, 0) > 65536) throw new ChatError('UPSTREAM_FRAME_TOO_LARGE');
        }
      }
      if (next.done) break;
    }
    if (buffer || data.length) throw new ChatError('UPSTREAM_TRUNCATED');
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function writeSse(response: ServerResponse, signal: AbortSignal, event: string, data: unknown) {
  signal.throwIfAborted();
  if (response.destroyed) throw new ChatError('CLIENT_ABORTED', 499);
  if (response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.off('drain', drain); response.off('close', close); response.off('error', close);
      signal.removeEventListener('abort', close);
    };
    const drain = () => { cleanup(); resolve(); };
    const close = () => { cleanup(); reject(new ChatError('STREAM_CLOSED', 499)); };
    response.once('drain', drain); response.once('close', close); response.once('error', close);
    signal.addEventListener('abort', close, { once: true });
    if (signal.aborted || response.destroyed) close();
  });
}
