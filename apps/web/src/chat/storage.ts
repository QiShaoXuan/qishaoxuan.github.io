import { MAX_REPLY } from './conversation';
import type { Turn } from './conversation';
import { validSources } from './stream';
const TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_SIZE = 200_000;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function storageKey(base: string, development: boolean) {
  return `resume-chat:v1:${encodeURIComponent(base)}:${development ? 'local' : 'site'}`;
}
export function decodeConversation(raw: string, now = Date.now()): Turn[] {
  if (raw.length > MAX_SIZE) throw new Error('记录过大');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('savedAt' in value) || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt > TTL || !('turns' in value) || !Array.isArray(value.turns) || value.turns.length > 10 || Object.keys(value).some((key) => !['version', 'savedAt', 'turns'].includes(key))) throw new Error('记录无效或已过期');
  const ids = new Set<number>();
  return value.turns.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('记录格式错误');
    const turn = item as Record<string, unknown>;
    if (Object.keys(turn).some((key) => !['id', 'user', 'assistant', 'status', 'mode', 'sources', 'finishReason'].includes(key)) || typeof turn.id !== 'number' || !Number.isSafeInteger(turn.id) || turn.id < 0 || ids.has(turn.id) || typeof turn.user !== 'string' || !turn.user.trim() || turn.user.length > 4000 || typeof turn.assistant !== 'string' || turn.assistant.length > MAX_REPLY || typeof turn.status !== 'string' || !['pending', 'complete', 'error', 'interrupted'].includes(turn.status) || (turn.status === 'complete' && !turn.assistant.trim()) || (turn.mode !== undefined && turn.mode !== 'mock' && turn.mode !== 'deepseek') || (turn.sources !== undefined && !validSources(turn.sources)) || (turn.finishReason !== undefined && turn.finishReason !== 'stop' && turn.finishReason !== 'length') || (turn.status === 'complete' && turn.finishReason === 'length')) throw new Error('记录格式错误');
    ids.add(turn.id);
    return { ...turn, status: turn.status === 'pending' ? 'interrupted' : turn.status } as Turn;
  });
}
export function createConversationStorage(getStorage: () => StorageLike, key: string) {
  let unavailable = false;
  return {
    get unavailable() { return unavailable; },
    load(): Turn[] {
      try {
        const storage = getStorage(); const raw = storage.getItem(key);
        if (raw === null) return [];
        try { return decodeConversation(raw); }
        catch { storage.removeItem(key); return []; }
      } catch { unavailable = true; return []; }
    },
    save(turns: Turn[]) {
      try {
        if (!turns.length) { getStorage().removeItem(key); return; }
        if (unavailable) return;
        const storage = getStorage();
        // Trim whole turns to bound persisted records, including long partial replies.
        const kept = turns.slice(-10);
        let raw = JSON.stringify({ version: 1, savedAt: Date.now(), turns: kept });
        while (raw.length > MAX_SIZE && kept.length) { kept.shift(); raw = JSON.stringify({ version: 1, savedAt: Date.now(), turns: kept }); }
        storage.setItem(key, raw);
      } catch { unavailable = true; }
    },
  };
}
