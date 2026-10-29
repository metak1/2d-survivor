// Healing shared by the Cleric's spells and talents: heals that overflow into shields (Echo of
// Light), heal-over-time, and finding the most wounded friend.

import type { Ally } from './ally';
import type { Game } from './game';
import type { Player } from './player';

export type Healable = Player | Ally;

/** Players and companions that can be healed (not decoys). */
export function friends(g: Game): Healable[] {
  const out: Healable[] = [];
  for (const p of g.players) if (!p.dead) out.push(p);
  for (const a of g.allies) if (!a.dead && a.kind !== 'decoy') out.push(a);
  return out;
}

/** `by` heals a friend; with Echo of Light, healing past full health becomes a shield. */
export function healFriend(_g: Game, by: Player, f: Healable, amount: number, silent = true): void {
  if (f.dead || amount <= 0) return;
  const overflow = amount - (f.maxHp - f.hp);
  by.run.heal += Math.min(amount, f.maxHp - f.hp);
  f.heal(amount, silent);
  if (overflow > 0 && by.stats.flags.has('echoheal')) {
    f.barrier = Math.min(f.maxHp * 0.2, f.barrier + overflow);
    f.barrierT = Math.max(f.barrierT, 6);
  }
}

/** Heals `total` over `t` seconds (Prayer of Mending). */
export function applyHot(f: Healable, total: number, t: number): void {
  f.hot = total / t;
  f.hotT = t;
}

/** The friend missing the largest share of their health (optionally not `self`), or null. */
export function mostWounded(g: Game, self: Player, includeSelf: boolean): Healable | null {
  let best: Healable | null = null, frac = 1;
  for (const f of friends(g)) {
    if (!includeSelf && f === self) continue;
    const k = f.hp / f.maxHp;
    if (k < frac) { frac = k; best = f; }
  }
  return best;
}
