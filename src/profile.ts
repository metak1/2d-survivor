// Progress kept in this browser between runs: per class, the most nights survived and the number
// of wins. Milestones unlock an heirloom, a better starting weapon for that class.

import { FINAL_NIGHT } from './config';
import type { Rarity } from './data/items';
import type { ClassId } from './data/types';

export interface ClassProgress { best: number; wins: number }

export interface HeirloomStep { rarity: Rarity; need: string; ok: (c: ClassProgress) => boolean }

export const HEIRLOOM_STEPS: HeirloomStep[] = [
  { rarity: 'magic', need: 'Survive 5 nights', ok: c => c.best >= 5 },
  { rarity: 'rare', need: 'Survive 10 nights', ok: c => c.best >= 10 },
  { rarity: 'epic', need: `Win a run (survive night ${FINAL_NIGHT})`, ok: c => c.wins > 0 },
];

const KEY = 'nightfall_profile';

function load(): Partial<Record<ClassId, ClassProgress>> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export function progress(cls: ClassId): ClassProgress {
  return { best: 0, wins: 0, ...load()[cls] };
}

/** The best starting weapon this class has unlocked, if any. */
export function heirloomFor(cls: ClassId): Rarity | null {
  const c = progress(cls);
  return [...HEIRLOOM_STEPS].reverse().find(s => s.ok(c))?.rarity ?? null;
}

/** The next heirloom still to unlock for this class. */
export function nextHeirloom(cls: ClassId): HeirloomStep | null {
  const c = progress(cls);
  return HEIRLOOM_STEPS.find(s => !s.ok(c)) ?? null;
}

/** Notes a run's result (`won` only at the moment of winning). Returns a newly unlocked heirloom. */
export function recordRun(cls: ClassId, nights: number, won: boolean): Rarity | null {
  const all = load(), before = heirloomFor(cls);
  const c = { best: 0, wins: 0, ...all[cls] };
  c.best = Math.max(c.best, nights);
  if (won) c.wins++;
  all[cls] = c;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
  const after = heirloomFor(cls);
  return after !== before ? after : null;
}
