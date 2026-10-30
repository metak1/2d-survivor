// Talks to the leaderboard API on the game server (server/leaderboard.ts). Online runs are
// recorded by the server itself; solo runs are reported from here.

import type { RunResult, ScoreEntry } from './protocol';
import { sessionToken } from './account';

const URL_ = 'api/leaderboard';

export type Boards = Record<number, ScoreEntry[]>;

/** All leaderboards, or null when there's no game server (a static copy of the game). */
export async function fetchBoards(): Promise<Boards | null> {
  try {
    const res = await fetch(URL_, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).boards as Boards;
  } catch {
    return null;
  }
}

export interface Submitted { id: string; key: string; rank: number | null }

/** Records a solo run (signed in), or updates the one submitted earlier (`prev`). Null if it couldn't. */
export async function submitSolo(run: RunResult, prev?: Submitted | null): Promise<Submitted | null> {
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken() ?? ''}` },
      body: JSON.stringify({ run, id: prev?.id, key: prev?.key }),
    });
    return res.ok ? ((await res.json()) as Submitted) : null;
  } catch {
    return null;
  }
}
