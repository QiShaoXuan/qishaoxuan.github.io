import { MAX_REPLY } from './conversation';
import type { Turn } from './conversation';
import { validSources } from './stream';
const TTL = 7 * 24 * 60 * 60 * 1000;
export const MAX_CONVERSATION_BYTES = 500 * 1024;
const MAX_PARSE_BYTES = 2 * 1024 * 1024;
const MAX_HYDRATED_TURNS = 10_000;
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export const encodeConversation = (turns: Turn[], now = Date.now()) => JSON.stringify({ version: 1, savedAt: now, turns });
export const conversationBytes = (turns: Turn[]) => utf8Bytes(encodeConversation(turns));
export const atConversationCapacity = (turns: Turn[]) => conversationBytes(turns) >= MAX_CONVERSATION_BYTES;
class HydrationLimitError extends Error {}
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function storageKey(base: string, development: boolean) {
  return `resume-chat:v1:${encodeURIComponent(base)}:${development ? 'local' : 'site'}`;
}
export function decodeConversation(raw: string, now = Date.now()): Turn[] {
  if (raw.length > MAX_PARSE_BYTES || utf8Bytes(raw) > MAX_PARSE_BYTES) throw new HydrationLimitError('记录过大，需手动清空');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('savedAt' in value) || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt > TTL || !('turns' in value) || !Array.isArray(value.turns) || Object.keys(value).some((key) => !['version', 'savedAt', 'turns'].includes(key))) throw new Error('记录无效或已过期');
  if (value.turns.length > MAX_HYDRATED_TURNS) throw new HydrationLimitError('记录轮次过多，需手动清空');
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
  let capacityLocked = false;
  let preserveRaw = false;
  let hasPersistedRecord = false;
  return {
    get unavailable() { return unavailable; },
    get capacityLocked() { return capacityLocked; },
    load(): Turn[] {
      try {
        const storage = getStorage(); const raw = storage.getItem(key);
        if (raw === null) return [];
        hasPersistedRecord = true;
        const rawAtCapacity = raw.length >= MAX_CONVERSATION_BYTES || utf8Bytes(raw) >= MAX_CONVERSATION_BYTES;
        try {
          const turns = decodeConversation(raw);
          capacityLocked = rawAtCapacity || atConversationCapacity(turns);
          return turns;
        } catch (error) {
          if (rawAtCapacity || error instanceof HydrationLimitError) { capacityLocked = true; preserveRaw = true; return []; }
          storage.removeItem(key); hasPersistedRecord = false; return [];
        }
      } catch { unavailable = true; return []; }
    },
    save(turns: Turn[]) {
      if (preserveRaw) return;
      capacityLocked = atConversationCapacity(turns);
      try {
        if (unavailable) return;
        getStorage().setItem(key, encodeConversation(turns));
        hasPersistedRecord = true;
      } catch { unavailable = true; }
    },
    clear(confirmed: boolean) {
      if (!confirmed) return false;
      try { getStorage().removeItem(key); }
      catch {
        unavailable = true;
        // A known persisted record must survive in the UI until deletion succeeds.
        // Sessions that never loaded or saved a record may still clear memory.
        if (hasPersistedRecord) return false;
      }
      hasPersistedRecord = false;
      preserveRaw = false;
      capacityLocked = false;
      return true;
    },
  };
}
