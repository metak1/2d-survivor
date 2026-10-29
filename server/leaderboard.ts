// Leaderboards, one per party size (1 to MAX_PLAYERS), kept in a JSON file next to the server.
// Online runs are recorded by the room that ran them. Solo runs are played in the browser, so the
// browser reports them (POST /api/leaderboard): those scores are taken on trust.
//   LEADERBOARD_FILE=/path/to/file.json changes where it's kept (default: data/leaderboard.json).

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { MAX_PLAYERS } from '../src/config';
import { CLASS_IDS } from '../src/data/classes';
import type { ClassId } from '../src/data/types';
import type { RunResult, ScoreEntry } from '../src/net/protocol';

const FILE = resolve(process.env.LEADERBOARD_FILE || 'data/leaderboard.json');
/** Entries kept per party size. */
const KEEP = 100;
/** Entries listed per party size. */
const SHOW = 20;

interface Stored extends ScoreEntry {
  /** Lets whoever submitted an entry update it later (a solo run going on after its win). */
  key: string;
}

/** Best first: more nights, then a win, then more kills, then faster. */
const better = (a: ScoreEntry, b: ScoreEntry) =>
  b.nights - a.nights || Number(b.won) - Number(a.won) || b.kills - a.kills || a.time - b.time;

export class Leaderboard {
  private entries: Stored[] = [];
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    try {
      if (existsSync(FILE)) this.entries = JSON.parse(readFileSync(FILE, 'utf8'));
      if (!Array.isArray(this.entries)) this.entries = [];
    } catch (err) {
      console.error(`leaderboard: couldn't read ${FILE}, starting empty:`, err);
      this.entries = [];
    }
  }

  /** Adds a run, or updates the run `id` if `key` matches. Returns its id, key and rank in its bracket. */
  submit(run: RunResult, id?: string, key?: string): { id: string; key: string; rank: number | null } {
    let e = id ? this.entries.find(x => x.id === id && x.key === key) : undefined;
    if (e) Object.assign(e, run, { date: Date.now() });
    else {
      e = { ...run, id: randomBytes(6).toString('hex'), key: randomBytes(12).toString('hex'), date: Date.now() };
      this.entries.push(e);
    }
    this.prune(run.size);
    this.save();
    return { id: e.id, key: e.key, rank: this.rank(e.id) };
  }

  /** 1-based rank of an entry within its party size, or null if it fell off the board. */
  rank(id: string): number | null {
    const e = this.entries.find(x => x.id === id);
    if (!e) return null;
    return this.bracket(e.size).indexOf(e) + 1;
  }

  /** The top of every bracket, without the edit keys. */
  top(): Record<number, ScoreEntry[]> {
    const out: Record<number, ScoreEntry[]> = {};
    for (let n = 1; n <= MAX_PLAYERS; n++) out[n] = this.bracket(n).slice(0, SHOW).map(({ key: _key, ...e }) => e);
    return out;
  }

  private bracket(size: number): Stored[] {
    return this.entries.filter(e => e.size === size).sort(better);
  }

  private prune(size: number): void {
    const drop = new Set(this.bracket(size).slice(KEEP));
    if (drop.size) this.entries = this.entries.filter(e => !drop.has(e));
  }

  /** Writes soon (several submits in a row make one write), atomically. */
  private save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(dirname(FILE), { recursive: true });
        writeFileSync(FILE + '.tmp', JSON.stringify(this.entries));
        renameSync(FILE + '.tmp', FILE);
      } catch (err) {
        console.error(`leaderboard: couldn't write ${FILE}:`, err);
      }
    }, 500);
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
  return { size, players, nights, won: !!r.won, kills, time, online: false };
}

// ----------------------------------------------------------------- HTTP

/** Submissions per address per minute. */
const POST_LIMIT = 12;
const posts = new Map<string, { n: number; since: number }>();

const json = (res: ServerResponse, code: number, body: unknown) =>
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));

/**
 * GET  /api/leaderboard        → { boards: { 1: [...], 2: [...], ... } }
 * POST /api/leaderboard        { run, id?, key? } → { id, key, rank }   (solo runs only)
 * Returns false for other URLs.
 */
export function handleApi(req: IncomingMessage, res: ServerResponse): boolean {
  const url = (req.url ?? '').split('?')[0];
  if (!url.endsWith('/api/leaderboard')) return false;
  if (req.method === 'GET') { json(res, 200, { boards: leaderboard.top() }); return true; }
  if (req.method !== 'POST') { json(res, 405, { error: 'GET or POST' }); return true; }

  const ip = req.socket.remoteAddress ?? '?', now = Date.now();
  const rate = posts.get(ip);
  if (!rate || now - rate.since > 60_000) posts.set(ip, { n: 1, since: now });
  else if (++rate.n > POST_LIMIT) { json(res, 429, { error: 'Too many submissions' }); return true; }
  if (posts.size > 5000) posts.clear();

  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 4096) { json(res, 413, { error: 'Too large' }); req.destroy(); }
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(body); } catch { json(res, 400, { error: 'Bad JSON' }); return; }
    const run = parseRun(msg?.run, true);
    if (!run) { json(res, 400, { error: 'Bad run' }); return; }
    const id = typeof msg.id === 'string' ? msg.id : undefined, key = typeof msg.key === 'string' ? msg.key : undefined;
    json(res, 200, leaderboard.submit(run, id, key));
  });
  return true;
}
