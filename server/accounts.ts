// Player accounts: a username and password (hashed with scrypt), sign-in sessions, and what the
// account keeps: progress (heirlooms, personal best), settings (display name) and the saved runs
// it can resume. Stored in the server's database (db.ts).
//
// Accounts are needed to play online; solo play works without one.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PASSWORD_HINT, PASSWORD_MIN, type AccountView, type Progress, type Settings } from '../src/net/protocol';
import { db } from './db';

/** Sessions last this long without use. */
const SESSION_DAYS = 30;
/** Saved runs remembered per account. */
const MAX_SAVES = 30;
const USERNAME = /^[A-Za-z0-9_-]{3,16}$/;

export interface Account {
  id: string;
  username: string;
  progress: Progress;
  settings: Settings;
}

interface Row { id: string; username: string; salt: string; hash: string; progress: string; settings: string }

const hashPassword = (password: string, salt: string) => scryptSync(password, salt, 64).toString('hex');
const toAccount = (r: Row): Account => ({ id: r.id, username: r.username, progress: JSON.parse(r.progress), settings: JSON.parse(r.settings) });

const q = {
  byName: db.prepare('SELECT * FROM accounts WHERE username = ?'),
  byId: db.prepare('SELECT * FROM accounts WHERE id = ?'),
  insert: db.prepare('INSERT INTO accounts (id, username, salt, hash, created, progress, settings) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  setProgress: db.prepare('UPDATE accounts SET progress = ? WHERE id = ?'),
  setSettings: db.prepare('UPDATE accounts SET settings = ? WHERE id = ?'),
  newSession: db.prepare('INSERT INTO sessions (token, account, used) VALUES (?, ?, ?)'),
  session: db.prepare('SELECT account, used FROM sessions WHERE token = ?'),
  touchSession: db.prepare('UPDATE sessions SET used = ? WHERE token = ?'),
  endSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  pruneSessions: db.prepare('DELETE FROM sessions WHERE used < ?'),
  addSave: db.prepare(`INSERT INTO account_saves (account, save, kind, added) VALUES (?, ?, ?, ?)
                       ON CONFLICT (account, save) DO UPDATE SET added = excluded.added`),
  dropSave: db.prepare('DELETE FROM account_saves WHERE account = ? AND save = ?'),
  dropSaveAll: db.prepare('DELETE FROM account_saves WHERE save = ?'),
  saves: db.prepare('SELECT save FROM account_saves WHERE account = ? ORDER BY added DESC'),
  savesOfKind: db.prepare('SELECT save FROM account_saves WHERE account = ? AND kind = ? ORDER BY added DESC'),
  owns: db.prepare('SELECT 1 FROM account_saves WHERE account = ? AND save = ?'),
  trimSaves: db.prepare(`DELETE FROM account_saves WHERE account = ? AND save NOT IN
                         (SELECT save FROM account_saves WHERE account = ? ORDER BY added DESC LIMIT ?)`),
};

export class Accounts {
  constructor() {
    q.pruneSessions.run(Date.now() - SESSION_DAYS * 864e5);
  }

  // ----------------------------------------------------------------- sign-in

  /** Creates an account and signs it in. Returns an error message, or the session. */
  register(username: unknown, password: unknown): { error: string } | { token: string; account: AccountView } {
    if (typeof username !== 'string' || !USERNAME.test(username)) return { error: 'Usernames are 3 to 16 letters, digits, - or _' };
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > 200) return { error: PASSWORD_HINT };
    if (q.byName.get(username)) return { error: 'That username is taken' };
    const salt = randomBytes(16).toString('hex'), id = randomBytes(8).toString('hex');
    const progress: Progress = { classes: {}, best: null }, settings: Settings = { name: username };
    try {
      q.insert.run(id, username, salt, hashPassword(password, salt), Date.now(), JSON.stringify(progress), JSON.stringify(settings));
    } catch {
      return { error: 'That username is taken' }; // a race with another sign-up
    }
    const a: Account = { id, username, progress, settings };
    return { token: this.newSession(a), account: this.view(a) };
  }

  login(username: unknown, password: unknown): { error: string } | { token: string; account: AccountView } {
    const r = typeof username === 'string' ? q.byName.get(username) as Row | undefined : undefined;
    // Same work whether or not the user exists, so timing doesn't reveal usernames.
    const hash = Buffer.from(hashPassword(typeof password === 'string' ? password : '', r?.salt ?? 'no-such-user'), 'hex');
    if (!r || !timingSafeEqual(hash, Buffer.from(r.hash, 'hex'))) return { error: 'Wrong username or password' };
    const a = toAccount(r);
    return { token: this.newSession(a), account: this.view(a) };
  }

  logout(token: string): void { q.endSession.run(token); }

  /** The account a session token belongs to (and keeps the session alive). */
  fromToken(token: unknown): Account | undefined {
    if (typeof token !== 'string') return undefined;
    const s = q.session.get(token) as { account: string; used: number } | undefined;
    if (!s) return undefined;
    if (Date.now() - s.used > SESSION_DAYS * 864e5) { q.endSession.run(token); return undefined; }
    if (Date.now() - s.used > 3_600_000) q.touchSession.run(Date.now(), token);
    return this.byId(s.account);
  }

  byId(id: string): Account | undefined {
    const r = q.byId.get(id) as Row | undefined;
    return r ? toAccount(r) : undefined;
  }

  private newSession(a: Account): string {
    const token = randomBytes(24).toString('hex');
    q.newSession.run(token, a.id, Date.now());
    return token;
  }

  // ----------------------------------------------------------------- what it holds

  /** What the browser sees of an account (never the password hash). */
  view(a: Account): AccountView {
    return { id: a.id, username: a.username, progress: a.progress, settings: a.settings };
  }

  setProgress(a: Account, p: Progress): void { a.progress = p; q.setProgress.run(JSON.stringify(p), a.id); }
  setSettings(a: Account, s: Settings): void { a.settings = s; q.setSettings.run(JSON.stringify(s), a.id); }

  /** Remembers a saved run for the account (most recent first). */
  addSave(a: Account, id: string, kind: 'solo' | 'online'): void {
    q.addSave.run(a.id, id, kind, Date.now());
    q.trimSaves.run(a.id, a.id, MAX_SAVES);
  }

  dropSave(a: Account, id: string): void { q.dropSave.run(a.id, id); }

  savesOf(a: Account, kind?: 'solo' | 'online'): string[] {
    const rows = (kind ? q.savesOfKind.all(a.id, kind) : q.saves.all(a.id)) as { save: string }[];
    return rows.map(r => r.save);
  }

  ownsSave(a: Account, id: string): boolean { return !!q.owns.get(a.id, id); }

  /** Forgets a save for every account (the run was lost). */
  dropSaveEverywhere(id: string): void { q.dropSaveAll.run(id); }
}

export const accounts = new Accounts();
