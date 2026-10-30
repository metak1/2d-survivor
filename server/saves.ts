// Saved runs, kept in the server's database (db.ts): online runs, which rooms write as they go
// and a room's host can resume later (see Room.resume), and signed-in players' solo runs.
// Saves untouched for SAVE_DAYS are deleted when the server starts.

import type { SaveData, SaveMeta } from '../src/sim/save';
import { db } from './db';

const SAVE_DAYS = 30;
const ID = /^[a-f0-9]{12,32}$/;

const q = {
  write: db.prepare(`INSERT INTO saves (id, data, meta, updated) VALUES (?, ?, ?, ?)
                     ON CONFLICT (id) DO UPDATE SET data = excluded.data, meta = excluded.meta, updated = excluded.updated`),
  read: db.prepare('SELECT data FROM saves WHERE id = ?'),
  meta: db.prepare('SELECT meta FROM saves WHERE id = ?'),
  exists: db.prepare('SELECT 1 FROM saves WHERE id = ?'),
  delete: db.prepare('DELETE FROM saves WHERE id = ?'),
  prune: db.prepare('DELETE FROM saves WHERE updated < ?'),
};

export const validSaveId = (id: unknown): id is string => typeof id === 'string' && ID.test(id);

export function writeSave(id: string, data: SaveData): void {
  try {
    q.write.run(id, JSON.stringify(data), JSON.stringify(data.meta), Date.now());
  } catch (err) {
    console.error(`saves: couldn't write ${id}:`, err);
  }
}

export function readSave(id: string): SaveData | null {
  if (!validSaveId(id)) return null;
  const r = q.read.get(id) as { data: string } | undefined;
  try { return r ? JSON.parse(r.data) as SaveData : null; } catch { return null; }
}

export const saveExists = (id: string) => validSaveId(id) && !!q.exists.get(id);

export function deleteSave(id: string): void {
  if (validSaveId(id)) q.delete.run(id);
}

/** What's known about the saves in `ids` that still exist (for lists of saved runs). */
export function saveMetas(ids: string[]): { id: string; meta: SaveMeta }[] {
  const out: { id: string; meta: SaveMeta }[] = [];
  for (const id of ids.slice(0, 30)) {
    const r = q.meta.get(id) as { meta: string } | undefined;
    if (r) out.push({ id, meta: JSON.parse(r.meta) as SaveMeta });
  }
  return out;
}

/** Deletes saves nobody has touched in a long time. */
export function pruneSaves(): void {
  const n = q.prune.run(Date.now() - SAVE_DAYS * 864e5).changes;
  if (n) console.log(`saves: deleted ${n} saved run(s) untouched for ${SAVE_DAYS} days`);
}
