// Leaderboards, one per party size (1 to MAX_PLAYERS), kept in the server's database (db.ts).
// Online runs are recorded by the room that ran them. Solo runs are played in the browser, so the
// browser reports them (POST /api/leaderboard, signed in; see api.ts): their numbers are taken on trust.

import { randomBytes } from 'node:crypto';
import { MAX_PLAYERS } from '../src/config';
import { CLASS_IDS } from '../src/data/classes';
import type { ClassId } from '../src/data/types';
import type { RunResult, ScoreEntry } from '../src/net/protocol';
import { db } from './db';

/** Entries kept per party size. */
const KEEP = 100;
/** Entries listed per party size. */
const SHOW = 20;

/** Best first: more nights, then a win, then further into the last night, then more kills, then faster. */
const ORDER = 'nights DESC, won DESC, progress DESC, kills DESC, time ASC';

interface Row { id: string; key: string; size: number; players: string; nights: number; won: number; progress: number; kills: number; time: number; online: number; date: number }

const toEntry = (r: Row): ScoreEntry => ({
  id: r.id, size: r.size, players: JSON.parse(r.players), nights: r.nights, won: !!r.won, progress: r.progress,
  kills: r.kills, time: r.time, online: !!r.online, date: r.date,
});

const q = {
  insert: db.prepare(`INSERT INTO scores (id, key, size, players, nights, won, progress, kills, time, online, date)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  update: db.prepare(`UPDATE scores SET size = ?, players = ?, nights = ?, won = ?, progress = ?, kills = ?, time = ?, online = ?, date = ?
                      WHERE id = ? AND key = ?`),
  get: db.prepare('SELECT * FROM scores WHERE id = ?'),
  top: db.prepare(`SELECT * FROM scores WHERE size = ? ORDER BY ${ORDER} LIMIT ?`),
  ids: db.prepare(`SELECT id FROM scores WHERE size = ? ORDER BY ${ORDER}`),
  prune: db.prepare(`DELETE FROM scores WHERE size = ? AND id NOT IN (SELECT id FROM scores WHERE size = ? ORDER BY ${ORDER} LIMIT ?)`),
};

export class Leaderboard {
  /** Adds a run, or updates the run `id` if `key` matches. Returns its id, key and rank in its bracket. */
  submit(run: RunResult, id?: string, key?: string): { id: string; key: string; rank: number | null } {
    const vals = [run.size, JSON.stringify(run.players), run.nights, run.won ? 1 : 0, run.progress ?? 0, run.kills, run.time, run.online ? 1 : 0, Date.now()] as const;
    let updated = false;
    if (id && key) updated = q.update.run(...vals, id, key).changes > 0;
    if (!updated) {
      id = randomBytes(6).toString('hex');
      key = randomBytes(12).toString('hex');
      const [size, players, nights, won, progress, kills, time, online, date] = vals;
      q.insert.run(id, key, size, players, nights, won, progress, kills, time, online, date);
    }
    q.prune.run(run.size, run.size, KEEP);
    return { id: id!, key: key!, rank: this.rank(id!) };
  }

  /** 1-based rank of an entry within its party size, or null if it fell off the board. */
  rank(id: string): number | null {
    const e = q.get.get(id) as Row | undefined;
    if (!e) return null;
    const ids = (q.ids.all(e.size) as { id: string }[]).map(r => r.id);
    return ids.indexOf(id) + 1;
  }

  /** The top of every bracket, without the edit keys. */
  top(): Record<number, ScoreEntry[]> {
    const out: Record<number, ScoreEntry[]> = {};
    for (let n = 1; n <= MAX_PLAYERS; n++) out[n] = (q.top.all(n, SHOW) as unknown as Row[]).map(toEntry);
    return out;
  }
}

export const leaderboard = new Leaderboard();

// ----------------------------------------------------------------- validation

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

/** Checks a run reported over the network; null if it doesn't make sense. */
export function parseRun(raw: unknown, soloOnly: boolean): RunResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const size = int(r.size, 1, MAX_PLAYERS), nights = int(r.nights, 0, 999), kills = int(r.kills, 0, 1e6);
  const time = typeof r.time === 'number' && r.time >= 0 && r.time < 1e7 ? Math.round(r.time) : null;
  if (size === null || nights === null || kills === null || time === null) return null;
  if (soloOnly && size !== 1) return null;
  if (!Array.isArray(r.players) || !r.players.length || r.players.length > MAX_PLAYERS) return null;
  const players: { name: string; cls: ClassId }[] = [];
  for (const p of r.players as Record<string, unknown>[]) {
    if (!p || typeof p.name !== 'string' || !CLASS_IDS.includes(p.cls as ClassId)) return null;
    players.push({ name: p.name.trim().slice(0, 16) || 'Player', cls: p.cls as ClassId });
  }
  const progress = typeof r.progress === 'number' && r.progress >= 0 && r.progress < 1 ? Math.floor(r.progress * 100) / 100 : 0;
  return { size, players, nights, won: !!r.won, kills, time, online: false, progress };
}
