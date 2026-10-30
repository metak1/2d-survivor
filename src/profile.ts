// Progress kept between runs: per class, the most nights survived and the number of wins, and
// the personal best run. Milestones unlock an heirloom, a better starting weapon for that class.
// Signed in, it lives on the account (any device); as a guest, in this browser. Signing in
// merges a guest's progress into the account.

import { FINAL_NIGHT } from './config';
import type { Rarity } from './data/items';
import type { ClassId } from './data/types';
import { account, pushProgress, signedIn } from './net/account';
import type { ClassProgress, Progress } from './net/protocol';

export type { ClassProgress };

export interface HeirloomStep { rarity: Rarity; need: string; ok: (c: ClassProgress) => boolean }

export const HEIRLOOM_STEPS: HeirloomStep[] = [
  { rarity: 'magic', need: 'Survive 5 nights', ok: c => c.best >= 5 },
  { rarity: 'rare', need: 'Survive 10 nights', ok: c => c.best >= 10 },
  { rarity: 'epic', need: `Win a run (survive night ${FINAL_NIGHT})`, ok: c => c.wins > 0 },
];

const CLASSES_KEY = 'nightfall_profile';
const BEST_KEY = 'nightfall_best';

function guestProgress(): Progress {
  const read = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  return { classes: read(CLASSES_KEY) ?? {}, best: read(BEST_KEY) };
}

function current(): Progress {
  return account()?.progress ?? guestProgress();
}

function store(p: Progress): void {
  if (signedIn()) return pushProgress(p);
  try {
    localStorage.setItem(CLASSES_KEY, JSON.stringify(p.classes));
    if (p.best) localStorage.setItem(BEST_KEY, JSON.stringify(p.best));
  } catch { /* storage unavailable */ }
}

export function progress(cls: ClassId): ClassProgress {
  return { best: 0, wins: 0, ...current().classes[cls] };
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
  const before = heirloomFor(cls), p = current();
  const c = { best: 0, wins: 0, ...p.classes[cls] };
  c.best = Math.max(c.best, nights);
  if (won) c.wins++;
  store({ ...p, classes: { ...p.classes, [cls]: c } });
  const after = heirloomFor(cls);
  return after !== before ? after : null;
}

export type Best = NonNullable<Progress['best']>;

export const loadBest = (): Partial<Best> => current().best ?? {};

export function saveBest(b: Best): void {
  store({ ...current(), best: b });
}

/** After signing in: a guest's progress in this browser counts toward the account. */
export function mergeGuestProgress(): void {
  const acc = account();
  if (!acc) return;
  const guest = guestProgress(), p: Progress = { classes: { ...acc.progress.classes }, best: acc.progress.best };
  let changed = false;
  for (const [cls, g] of Object.entries(guest.classes) as [ClassId, ClassProgress][]) {
    const a = p.classes[cls] ?? { best: 0, wins: 0 };
    const merged = { best: Math.max(a.best, g.best ?? 0), wins: Math.max(a.wins, g.wins ?? 0) };
    if (merged.best !== a.best || merged.wins !== a.wins) { p.classes[cls] = merged; changed = true; }
  }
  const gb = guest.best;
  if (gb && (!p.best || gb.nights > p.best.nights || (gb.nights === p.best.nights && gb.kills > p.best.kills))) { p.best = gb; changed = true; }
  if (changed) pushProgress(p);
}
