// Solo saves in this browser. As a guest they're the only copy; signed in, the account keeps
// them on the server (any device) and this is a local copy, so closing the tab before an upload
// loses nothing. Online runs are saved on the server and listed by the account (see the lobby).

import { account, removeSave, remoteSaves, signedIn, uploadSave } from '../net/account';
import type { SaveData, SaveMeta } from '../sim/save';

const GUEST_KEY = 'nightfall_saves';
/** Solo saves kept in this browser; the oldest goes when another run starts. */
const MAX_LOCAL = 3;

export interface SoloSave { id: string; meta: SaveMeta; data: SaveData }

const key = () => (signedIn() ? `nightfall_saves_${account()!.id}` : GUEST_KEY);

function read(k = key()): SoloSave[] {
  try { return (JSON.parse(localStorage.getItem(k) || '[]') as SoloSave[]).sort((a, b) => b.meta.savedAt - a.meta.savedAt); } catch { return []; }
}
function write(list: SoloSave[], k = key()): boolean {
  try { localStorage.setItem(k, JSON.stringify(list)); return true; } catch { return false; }
}

export const newSaveId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');

export const localSaves = () => read();

export function writeLocal(id: string, data: SaveData): boolean {
  const list = read().filter(s => s.id !== id);
  list.unshift({ id, meta: data.meta, data });
  // Storage is limited: drop the oldest until it fits.
  for (let keep = Math.min(list.length, MAX_LOCAL); keep > 0; keep--) if (write(list.slice(0, keep))) return true;
  return false;
}

export function deleteLocal(id: string): void {
  write(read().filter(s => s.id !== id));
}

/** A solo save as the "Continue" list shows it: here, on the account, or both (the newer wins). */
export interface ContinueEntry { id: string; meta: SaveMeta; local?: SaveData; remote: boolean }

export async function continueList(): Promise<ContinueEntry[]> {
  const out = new Map<string, ContinueEntry>();
  for (const s of read()) out.set(s.id, { id: s.id, meta: s.meta, local: s.data, remote: false });
  if (signedIn()) {
    try {
      for (const r of await remoteSaves()) {
        if (r.kind !== 'solo') continue;
        const mine = out.get(r.id);
        if (!mine) out.set(r.id, { id: r.id, meta: r.meta, remote: true });
        else if (r.meta.savedAt > mine.meta.savedAt) out.set(r.id, { id: r.id, meta: r.meta, remote: true });
        else mine.remote = true;
      }
    } catch { /* offline: the local copies still work */ }
  }
  return [...out.values()].sort((a, b) => b.meta.savedAt - a.meta.savedAt);
}

/** Deletes a solo save here and on the account. */
export async function deleteSolo(id: string): Promise<void> {
  deleteLocal(id);
  if (signedIn()) await removeSave(id).catch(() => { /* already gone */ });
}

/** After signing in: saves made as a guest in this browser move to the account. */
export async function moveGuestSaves(): Promise<void> {
  if (!signedIn()) return;
  const guest = read(GUEST_KEY);
  for (const s of guest) {
    try {
      await uploadSave(s.id, s.data);
      writeLocal(s.id, s.data);
      write(read(GUEST_KEY).filter(x => x.id !== s.id), GUEST_KEY);
    } catch { /* stays a guest save for now */ }
  }
}

/** "Day 7 (night) · 6 nights survived · 5 minutes ago". */
export function describeSave(m: SaveMeta): string {
  const ago = Math.max(0, Date.now() - m.savedAt) / 1000;
  const when = ago < 60 ? 'just now' : ago < 3600 ? `${Math.floor(ago / 60)} min ago` : ago < 86400 ? `${Math.floor(ago / 3600)} h ago` : `${Math.floor(ago / 86400)} days ago`;
  return `Day ${m.day}${m.phase === 'night' ? ' (night)' : ''}${m.won ? ' · endless' : ''} · ${m.nights} night${m.nights === 1 ? '' : 's'} survived · ${when}`;
}
