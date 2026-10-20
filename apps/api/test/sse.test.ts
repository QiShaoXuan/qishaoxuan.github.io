import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { test } from 'node:test';
import { readSse, writeSse } from '../src/sse.js';

class BackpressuredResponse extends EventEmitter {
  destroyed = false;
  writes: string[] = [];
  write(data: string) { this.writes.push(data); return false; }
}

test('backpressure waits for drain and removes listeners on drain, abort and close', async () => {
  for (const end of ['drain', 'abort', 'close']) {
    const response = new BackpressuredResponse();
    const controller = new AbortController();
    let settled = false;
    const pending = writeSse(response as unknown as ServerResponse, controller.signal, 'delta', { content: 'test' }).finally(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false);
    assert.equal(response.writes.length, 1);
    if (end === 'abort') controller.abort(); else response.emit(end);
    if (end === 'drain') await pending; else await assert.rejects(pending);
    assert.equal(response.listenerCount('drain'), 0);
    assert.equal(response.listenerCount('close'), 0);
    assert.equal(response.listenerCount('error'), 0);
  }
});

test('SSE accepts CR-only lines and rejects broken UTF-8', async () => {
  const received = [];
  for await (const value of readSse(new Response('data: valid\r\r').body!, new AbortController().signal)) received.push(value);
  assert.deepEqual(received, ['valid']);
  await assert.rejects(async () => {
    for await (const value of readSse(new Response(Uint8Array.of(0xff)).body!, new AbortController().signal)) assert.fail(value);
  });
});
