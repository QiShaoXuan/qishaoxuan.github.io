import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiUrl } from '../src/api-url.ts';

test('本地空地址保留 Vite API 代理路径', () => {
  assert.equal(resolveApiUrl('/api/health', ''), '/api/health');
  assert.equal(resolveApiUrl('/api/chat', ''), '/api/chat');
});

test('正式 origin 与开发前缀均保留完整接口路径', () => {
  for (const path of ['/api/health', '/api/chat'] as const) {
    for (const base of ['https://101.201.78.159', 'https://101.201.78.159/']) {
      assert.equal(resolveApiUrl(path, base), `https://101.201.78.159${path}`);
    }
    for (const base of ['https://101.201.78.159/dev', 'https://101.201.78.159/dev/']) {
      assert.equal(resolveApiUrl(path, base), `https://101.201.78.159/dev${path}`);
    }
  }
});

test('HTTP 仅在本地开发显式允许，生产要求 HTTPS', () => {
  assert.throws(() => resolveApiUrl('/api/chat', 'http://127.0.0.1:3000'));
  assert.equal(resolveApiUrl('/api/chat', 'http://127.0.0.1:3000', true), 'http://127.0.0.1:3000/api/chat');
});

test('拒绝账号、查询、锚点与 URL 归一化可能隐藏的非法前缀', () => {
  const invalidBases = [
    'https://user:password@example.com/dev',
    'https://user@example.com',
    'https://example.com/dev?foo=bar',
    'https://example.com/dev?',
    'https://example.com/dev#section',
    'https://example.com/dev#',
    'https://example.com/staging',
    'https://example.com/dev/api',
    'https://example.com//dev',
    'https://example.com/DEV',
    'https://example.com/other/../dev',
    'https://example.com/dev/..',
    'https://example.com/%64ev',
    'https://example.com/%2e%2e/dev',
    'https://example.com/dev%2f',
    'https://example.com\\dev',
    'https://example.com/de\nv',
    '//example.com/dev',
    'javascript:alert(1)',
    'not-a-url',
  ];
  for (const base of invalidBases) {
    assert.throws(() => resolveApiUrl('/api/chat', base), /API 地址配置无效/, base);
  }
});
