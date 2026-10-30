// The game server's HTTP API (everything under /api), used by the dev server and server/main.ts.
//
//   GET    /api/leaderboard                 the boards
//   POST   /api/leaderboard                 { run, id?, key? }: a solo run (signed in)
//   POST   /api/account/register|login      { username, password } → { token, account }
//   POST   /api/account/logout
//   GET    /api/account                     the signed-in account
//   PUT    /api/account/progress|settings   { progress } / { settings }
//   GET    /api/account/saves               the account's saved runs (solo and online)
//   GET    /api/account/saves/:id           a solo save
//   PUT    /api/account/saves/:id           store a solo save
//   DELETE /api/account/saves/:id           delete a solo save, or forget an online one
//
// Signed-in requests carry "Authorization: Bearer <session token>".

import type { IncomingMessage, ServerResponse } from 'node:http';
import { CLASS_IDS } from '../src/data/classes';
import type { ClassId } from '../src/data/types';
import type { Progress, Settings } from '../src/net/protocol';
import type { SaveData } from '../src/sim/save';
import { accounts } from './accounts';
import { leaderboard, parseRun } from './leaderboard';
import { deleteSave, readSave, saveExists, saveMetas, validSaveId, writeSave } from './saves';

/** Solo saves kept per account; the oldest goes when there are more. */
const SOLO_SAVES = 5;
/** Largest request body: a solo save (they're around 100 KB). */
const MAX_BODY = 2 * 1024 * 1024;

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}

/** Requests per address per minute, per kind (sign-in attempts, score submissions). */
const LIMITS = { auth: 10, score: 12 };
const hits = new Map<string, { n: number; since: number }>();
function limited(req: IncomingMessage, kind: keyof typeof LIMITS): boolean {
  const key = `${kind}:${req.socket.remoteAddress ?? '?'}`, now = Date.now(), h = hits.get(key);
  if (hits.size > 10_000) hits.clear();
  if (!h || now - h.since > 60_000) { hits.set(key, { n: 1, since: now }); return false; }
  return ++h.n > LIMITS[kind];
}

function readBody(req: IncomingMessage, res: ServerResponse, done: (body: Record<string, unknown>) => void): void {
  let body = '', size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY) { json(res, 413, { error: 'Too large' }); req.destroy(); return; }
    body += chunk;
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let msg: unknown;
    try { msg = body ? JSON.parse(body) : {}; } catch { return json(res, 400, { error: 'Bad JSON' }); }
    if (!msg || typeof msg !== 'object') return json(res, 400, { error: 'Bad request' });
    done(msg as Record<string, unknown>);
  });
}

const tokenOf = (req: IncomingMessage) => /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];

/** Handles /api requests; returns false for anything else. */
export function handleApi(req: IncomingMessage, res: ServerResponse): boolean {
  const path = (req.url ?? '').split('?')[0].replace(/^.*?\/api\//, '/api/');
  if (!path.startsWith('/api/')) return false;
  if (path === '/api/leaderboard') return leaderboardRoute(req, res), true;
  if (path.startsWith('/api/account')) return accountRoute(req, res, path), true;
  json(res, 404, { error: 'Not found' });
  return true;
}

function leaderboardRoute(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET') return json(res, 200, { boards: leaderboard.top() });
  if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
  // Solo runs are played in the browser; tying them to an account keeps names honest.
  const a = accounts.fromToken(tokenOf(req));
  if (!a) return json(res, 401, { error: 'Sign in to put your runs on the leaderboard' });
  if (limited(req, 'score')) return json(res, 429, { error: 'Too many submissions' });
  readBody(req, res, msg => {
    const run = parseRun(msg.run, true);
    if (!run) return json(res, 400, { error: 'Bad run' });
    run.players = [{ name: a.settings.name, cls: run.players[0].cls, account: a.id }];
    const id = typeof msg.id === 'string' ? msg.id : undefined, key = typeof msg.key === 'string' ? msg.key : undefined;
    json(res, 200, leaderboard.submit(run, id, key));
  });
}

function accountRoute(req: IncomingMessage, res: ServerResponse, path: string): void {
  const m = req.method;
  if (m === 'POST' && (path === '/api/account/register' || path === '/api/account/login')) {
    if (limited(req, 'auth')) return json(res, 429, { error: 'Too many attempts. Wait a minute and try again.' });
    return readBody(req, res, msg => {
      const r = path.endsWith('register') ? accounts.register(msg.username, msg.password) : accounts.login(msg.username, msg.password);
      json(res, 'error' in r ? 400 : 200, r);
    });
  }

  const token = tokenOf(req), a = accounts.fromToken(token);
  if (!a || !token) return json(res, 401, { error: 'Not signed in' });

  if (m === 'POST' && path === '/api/account/logout') { accounts.logout(token); return json(res, 200, {}); }
  if (m === 'GET' && path === '/api/account') return json(res, 200, { account: accounts.view(a) });
  if (m === 'PUT' && path === '/api/account/progress') {
    return readBody(req, res, msg => {
      const p = cleanProgress(msg.progress);
      if (!p) return json(res, 400, { error: 'Bad progress' });
      accounts.setProgress(a, p);
      json(res, 200, {});
    });
  }
  if (m === 'PUT' && path === '/api/account/settings') {
    return readBody(req, res, msg => {
      const s = msg.settings as Partial<Settings> | undefined, name = typeof s?.name === 'string' ? s.name.trim().slice(0, 16) : '';
      if (!name) return json(res, 400, { error: 'Pick a name' });
      accounts.setSettings(a, { ...a.settings, name });
      json(res, 200, { account: accounts.view(a) });
    });
  }

  // Saved runs.
  if (m === 'GET' && path === '/api/account/saves') {
    const ids = accounts.savesOf(a), metas = saveMetas(ids);
    // Saves that are gone (a lost run, or expired) leave the list.
    for (const id of ids) if (!metas.some(s => s.id === id)) accounts.dropSave(a, id);
    const kind = (id: string) => (accounts.savesOf(a, 'solo').includes(id) ? 'solo' : 'online');
    return json(res, 200, { saves: metas.map(s => ({ ...s, kind: kind(s.id) })) });
  }
  const sm = /^\/api\/account\/saves\/([a-f0-9]{12,32})$/.exec(path);
  if (!sm) return json(res, 404, { error: 'Not found' });
  const id = sm[1], solo = accounts.savesOf(a, 'solo').includes(id);
  if (m === 'GET') {
    const s = solo ? readSave(id) : null;
    return s ? json(res, 200, { save: s }) : json(res, 404, { error: 'No such save' });
  }
  if (m === 'DELETE') {
    if (solo) deleteSave(id);
    accounts.dropSave(a, id);
    return json(res, 200, {});
  }
  if (m === 'PUT') {
    // A solo save: someone else's id can't be overwritten.
    if (!solo && saveExists(id)) return json(res, 403, { error: 'Not your save' });
    return readBody(req, res, msg => {
      const s = msg.save as SaveData | undefined;
      if (!validSaveId(id) || !s || typeof s !== 'object' || typeof s.v !== 'number' || typeof s.seed !== 'number' || !s.meta) return json(res, 400, { error: 'Bad save' });
      writeSave(id, s);
      accounts.addSave(a, id, 'solo');
      // Keep the newest few solo saves.
      for (const old of accounts.savesOf(a, 'solo').slice(SOLO_SAVES)) { deleteSave(old); accounts.dropSave(a, old); }
      json(res, 200, {});
    });
  }
  json(res, 405, { error: 'Method not allowed' });
}

/** Checks progress sent by a browser (heirloom unlocks and the personal best). */
function cleanProgress(raw: unknown): Progress | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>, out: Progress = { classes: {}, best: null };
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(9999, Math.floor(v))) : 0);
  if (r.classes && typeof r.classes === 'object') {
    for (const [cls, v] of Object.entries(r.classes as Record<string, { best?: unknown; wins?: unknown }>)) {
      if (CLASS_IDS.includes(cls as ClassId) && v && typeof v === 'object') out.classes[cls as ClassId] = { best: int(v.best), wins: int(v.wins) };
    }
  }
  const b = r.best as Record<string, unknown> | null;
  if (b && typeof b === 'object' && typeof b.cls === 'string') out.best = { nights: int(b.nights), kills: int(b.kills), cls: b.cls.slice(0, 20) };
  return out;
}
