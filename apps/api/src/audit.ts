import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, unlink, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface AuditRecord { question: string; answer: string; metadata: Record<string, unknown> }
export interface AuditOptions { directory: string; maxBytes: number; retentionDays: number; maxFiles?: number }
export type AuditStatus = 'stored' | 'dropped' | 'failed';
export interface AuditStore { write(record: AuditRecord): Promise<AuditStatus>; close(): Promise<void> }

const REDACTED = '[REDACTED]';
const MAX_RECORD_BYTES = 32 * 1024;
const MANAGED_FILE = /^chat-\d{13}-[a-f0-9-]{36}\.(json|tmp)$/;

// Pattern redaction reduces common accidental disclosures; it cannot guarantee anonymity.
// Only the current question and visible answer belong here, never prompt/history/reasoning.
export function redactText(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join(REDACTED);
  result = result.replace(/\b(?:sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{16,}|github_pat_[a-z0-9_]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/gi, REDACTED);
  result = result.replace(/\bBearer\s+[^\s,;"'<>]+/gi, `Bearer ${REDACTED}`);
  result = result.replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|pwd|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;，；]+)/gi, `$1=${REDACTED}`);
  result = result.replace(/(密码|口令|密钥|令牌)\s*[:：=]\s*(?:"[^"]*"|'[^']*'|[^\s,;，；]+)/gu, `$1=${REDACTED}`);
  result = result.replace(/https?:\/\/[^\s<>"'`]+/gi, match => {
    try {
      const url = new URL(match);
      if (url.username || url.password) { url.username = REDACTED; url.password = ''; }
      for (const key of new Set(url.searchParams.keys())) url.searchParams.set(key, REDACTED);
      if (url.hash) url.hash = REDACTED;
      return url.toString().replaceAll('%5BREDACTED%5D', REDACTED);
    } catch { return REDACTED; }
  });
  result = result.replace(/(?<![a-z0-9.!#$%&'*+/=?^_`{|}~-])[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi, REDACTED);
  result = result.replace(/(?<!\d)(?:\+?86[ -]?)?1[3-9](?:[ -]?\d){9}(?!\d)/g, REDACTED);
  result = result.replace(/(?<!\d)(?:\d{17}[\dXx]|\d{15})(?![\dXx])/g, REDACTED);
  result = result.replace(/(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g, REDACTED);
  result = result.replace(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, match => isIP(match) === 4 ? REDACTED : match);
  result = result.replace(/(?<![a-z0-9])(?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}(?:%[\w]+)?(?![a-z0-9])/gi, match => isIP(match) === 6 ? REDACTED : match);
  result = result.replace(/(姓名|联系人|收件人|称呼)\s*[:：=]\s*[\p{Script=Han}·]{2,10}/gu, `$1：${REDACTED}`);
  return result;
}

function truncate(text: string, maxBytes: number) {
  let result = '', bytes = 0;
  for (const char of text) {
    // Count JSON escapes too: newlines/control characters must not bypass the byte budget.
    const size = Buffer.byteLength(JSON.stringify(char)) - 2;
    if (bytes + size > maxBytes) return { text: result, truncated: true };
    result += char; bytes += size;
  }
  return { text: result, truncated: false };
}

// Validate each path component before mkdir so an existing directory symlink is never followed.
async function prepareDirectory(directory: string) {
  if (!path.isAbsolute(directory)) throw new Error('Invalid audit directory');
  const root = path.parse(directory).root;
  let current = root;
  for (const part of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe audit directory');
  }
  const info = await lstat(directory);
  if (process.getuid && info.uid !== process.getuid()) throw new Error('Unsafe audit directory owner');
  await chmod(directory, 0o700);
}

export function createAuditStore(options: AuditOptions, secrets: string[] = [], onCleanupError?: () => void): AuditStore {
  let closed = false, pending = 0;
  let tail = Promise.resolve();
  const directory = path.resolve(options.directory);
  const maxFiles = options.maxFiles ?? 10000;
  const valid = path.isAbsolute(options.directory) && Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    && Number.isSafeInteger(options.retentionDays) && options.retentionDays > 0
    && Number.isSafeInteger(maxFiles) && maxFiles > 0 && maxFiles <= 10000;
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation);
    tail = next.then(() => {}, () => {});
    return next;
  };
  const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!valid) throw new Error('Invalid audit settings');
    await prepareDirectory(directory);
    const lock = path.join(directory, '.lock');
    const deadline = Date.now() + 250;
    while (true) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw error;
        await delay(10);
      }
    }
    try {
      await writeFile(path.join(lock, 'pid'), String(process.pid), { mode: 0o600, flag: 'wx' });
      return await operation();
    } finally { await rm(lock, { recursive: true, force: true }); }
  };
  const prune = async (reserve = 0) => {
    const files: { file: string; bytes: number; mtime: number }[] = [];
    let total = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.lock') continue;
      // Refuse a contaminated directory rather than follow or overwrite an unexpected link.
      if (entry.isSymbolicLink()) throw new Error('Unsafe audit entry');
      if (!MANAGED_FILE.test(entry.name)) continue;
      const file = path.join(directory, entry.name), info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Unsafe audit file');
      if (entry.name.endsWith('.tmp') || info.mtimeMs <= Date.now() - options.retentionDays * 86400000) await unlink(file);
      else { files.push({ file, bytes: info.size, mtime: info.mtimeMs }); total += info.size; }
    }
    files.sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file));
    let count = files.length;
    for (const file of files) {
      if (total + reserve <= options.maxBytes && count + (reserve > 0 ? 1 : 0) <= maxFiles) break;
      await unlink(file.file); total -= file.bytes; count--;
    }
  };
  const cleanup = async () => {
    try { await withLock(() => prune()); }
    catch {
      // No exception details or filesystem paths cross the audit-store boundary.
      try { onCleanupError?.(); } catch { /* A diagnostic callback must not reject the queue. */ }
    }
  };
  void enqueue(cleanup);
  const timer = setInterval(() => { if (!closed && pending === 0) void enqueue(cleanup); }, 3600000);
  timer.unref();
  return {
    write(record) {
      if (closed || pending >= 32) return Promise.resolve('dropped');
      let serialized: string;
      try {
        const question = truncate(redactText(record.question, secrets), 8 * 1024);
        const answer = truncate(redactText(record.answer, secrets), 20 * 1024);
        serialized = JSON.stringify({ ...record.metadata, question: question.text, answer: answer.text, questionTruncated: question.truncated, answerTruncated: answer.truncated, redactionVersion: 'patterns-v1' }, (_key, value: unknown) => {
          // Exact configured secrets are also removed from unexpected string metadata values.
          if (typeof value !== 'string') return value;
          let sanitized = value;
          for (const secret of secrets.filter(Boolean)) sanitized = sanitized.split(secret).join(REDACTED);
          return sanitized;
        }) + '\n';
      } catch { return Promise.resolve('failed'); }
      const bytes = Buffer.byteLength(serialized);
      if (bytes > MAX_RECORD_BYTES || bytes > options.maxBytes) return Promise.resolve('dropped');
      pending++;
      return enqueue(async () => {
        try {
          await withLock(async () => {
            await prune(bytes);
            const name = `chat-${Date.now()}-${randomUUID()}`;
            const temporary = path.join(directory, name + '.tmp');
            try {
              const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
              try { await file.writeFile(serialized); await file.sync(); } finally { await file.close(); }
              await rename(temporary, path.join(directory, name + '.json'));
            } finally { await rm(temporary, { force: true }); }
          });
          return 'stored' as const;
        } catch { return 'failed' as const; }
        finally { pending--; }
      });
    },
    async close() {
      closed = true; clearInterval(timer);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([tail, new Promise<void>(resolve => { timeout = setTimeout(resolve, 10000); })]); }
      finally { clearTimeout(timeout); }
    },
  };
}
