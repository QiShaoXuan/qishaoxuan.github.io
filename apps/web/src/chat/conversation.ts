export type Source = { id: string; title: string; url?: string };
export type Turn = {
  id: number; user: string; assistant: string;
  status: 'pending' | 'complete' | 'error' | 'interrupted';
  mode?: 'mock' | 'deepseek'; sources?: Source[]; finishReason?: 'stop' | 'length';
};
export type HistoryMessage = { role: 'user' | 'assistant'; content: string };
export const MAX_REPLY = 32_000;

export function historyFor(turns: Turn[], user: string): HistoryMessage[] {
  if (!user.trim() || user.length > 4000) throw new Error('请输入 1 至 4000 字的内容。');
  const pairs: HistoryMessage[][] = [];
  let size = user.length;
  for (const turn of [...turns].reverse()) {
    if (turn.status !== 'complete' || turn.finishReason === 'length') continue;
    if (turn.user.length > 4000 || turn.assistant.length > 4000) break;
    const length = turn.user.length + turn.assistant.length;
    if (pairs.length >= 9 || size + length > 16_000) break;
    pairs.unshift([{ role: 'user', content: turn.user }, { role: 'assistant', content: turn.assistant }]);
    size += length;
  }
  return [...pairs.flat(), { role: 'user', content: user }];
}

export function startTurn(turns: Turn[], id: number, user: string, retry = false): Turn[] {
  const previous = turns.at(-1);
  const base = retry && previous && previous.status !== 'complete' && previous.user === user ? turns.slice(0, -1) : turns;
  return [...base, { id, user, assistant: '', status: 'pending' as const }];
}
