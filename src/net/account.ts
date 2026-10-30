// The signed-in account, if any: its session token (kept in this browser), what it holds
// (progress, settings), and calls to the server's account API (server/api.ts).
// Signing in is optional for solo play and required online.

import type { AccountView, Progress, Settings } from './protocol';
import type { SaveData, SaveMeta } from '../sim/save';

const TOKEN_KEY = 'nightfall_session';

let token: string | null = null;
let view: AccountView | null = null;
const listeners = new Set<() => void>();

export const account = () => view;
export const signedIn = () => !!view;
/** The session token, for the online connection. */
export const sessionToken = () => (view ? token : null);

/** Called when the account signs in, out, or changes. */
export function onAccount(fn: () => void): void { listeners.add(fn); }
const changed = () => { for (const fn of listeners) fn(); };

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && path !== 'account/login' && path !== 'account/register') signOutLocally();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

function signOutLocally(): void {
  token = null;
  view = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  changed();
}

/** Restores the session saved in this browser, if it's still valid. */
export async function restoreSession(): Promise<void> {
  try { token = localStorage.getItem(TOKEN_KEY); } catch { token = null; }
  if (!token) return;
  try {
    view = (await api<{ account: AccountView }>('GET', 'account')).account;
    changed();
  } catch {
    // Offline, or no game server (a static copy): play as a guest.
    view = null;
  }
}

async function signIn(kind: 'login' | 'register', username: string, password: string): Promise<void> {
  const r = await api<{ token: string; account: AccountView }>('POST', `account/${kind}`, { username, password });
  token = r.token;
  view = r.account;
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ }
  changed();
}

export const login = (username: string, password: string) => signIn('login', username, password);
export const register = (username: string, password: string) => signIn('register', username, password);

export async function logout(): Promise<void> {
  try { await api('POST', 'account/logout'); } catch { /* signed out anyway */ }
  signOutLocally();
}

// ----------------------------------------------------------------- what the account holds

/** Stores progress (heirlooms, personal best) on the account. */
export function pushProgress(p: Progress): void {
  if (!view) return;
  view.progress = p;
  void api('PUT', 'account/progress', { progress: p }).catch(() => { /* kept locally; sent next time */ });
}

export async function pushSettings(s: Settings): Promise<void> {
  if (!view) return;
  view = (await api<{ account: AccountView }>('PUT', 'account/settings', { settings: s })).account;
  changed();
}

export interface RemoteSave { id: string; kind: 'solo' | 'online'; meta: SaveMeta }

export async function remoteSaves(): Promise<RemoteSave[]> {
  return (await api<{ saves: RemoteSave[] }>('GET', 'account/saves')).saves;
}
export async function fetchSave(id: string): Promise<SaveData> {
  return (await api<{ save: SaveData }>('GET', `account/saves/${id}`)).save;
}
export function uploadSave(id: string, save: SaveData): Promise<unknown> {
  return api('PUT', `account/saves/${id}`, { save });
}
export function removeSave(id: string): Promise<unknown> {
  return api('DELETE', `account/saves/${id}`);
}
