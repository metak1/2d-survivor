// The Legendary Forge at the Hearth. Bosses (night and dungeon) each reveal one legendary to the
// players who fought them and drop Legendary Shards. Shards craft any discovered legendary,
// empower legendaries from rank I to V, and reroll or upgrade any other item, so dungeons stay
// worth running after the collection is complete. The collection lasts for the run.

import { ROMAN } from '../data/buildings';
import { BAG_SIZE, FORGE, LEGENDARIES, LEGEND_MAX_RANK, RANK_FIXED, rankMul } from '../data/items';
import type { StatKey } from '../data/types';
import { choice } from '../core/math';
import type { Game } from './game';
import { levelMul, makeItem, noteFind, roundStat, type Item } from './items';
import type { Player } from './player';
import { distToBuilding } from './world';

/** How close to the Hearth a player must stand to use the forge. */
const FORGE_RANGE = 120;

export const nearForge = (g: Game, p: Player) => !p.dead && distToBuilding(p, g.world.hearth) < FORGE_RANGE;

const legendDef = (item: Item) => LEGENDARIES.find(l => l.id === item.legend);

/** An item a player has, worn or carried. */
export function findItem(p: Player, id: number): Item | undefined {
  return p.bag.find(i => i.id === id) ?? p.worn.find(i => i.id === id);
}

const worn = (p: Player, item: Item) => p.equip[item.slot] === item;

/** The share of a stat that comes from the legendary itself (it grows with rank, not item level). */
function fixedPart(item: Item, k: StatKey): number {
  const base = legendDef(item)?.mods[k] ?? 0;
  return RANK_FIXED.includes(k) ? base : base * rankMul(item.rank ?? 1);
}

/** Moves a legendary's own stats from rank `from` to rank `to`. */
function applyRank(item: Item, from: number, to: number): void {
  const L = legendDef(item);
  if (!L) return;
  for (const [k, v] of Object.entries(L.mods) as [StatKey, number][]) {
    if (RANK_FIXED.includes(k)) continue;
    item.mods[k] = roundStat(k, (item.mods[k] ?? 0) + v * (rankMul(to) - rankMul(from)));
  }
  item.rank = to;
}

export const empowerCost = (item: Item) => FORGE.empower[(item.rank ?? 1) + 1] ?? 0;
export const rerollCost = (item: Item) => FORGE.reroll[item.rarity];
export const upgradeCost = (item: Item) => FORGE.upgrade[item.rarity];

function pay(g: Game, p: Player, cost: number): string | null {
  if (!nearForge(g, p)) return 'Stand by the Hearth to use the forge';
  if (p.shards < cost) return `Not enough Legendary Shards (need ${cost})`;
  p.shards -= cost;
  return null;
}

function done(g: Game, p: Player, item: Item, text: string): void {
  if (worn(p, item)) p.recalc();
  g.fx.text(p.x, p.y - 36, text, '#ff9a3a', 14, 1.2);
  g.fx.particles(g.world.hearth.x, g.world.hearth.y - 10, 18, '#ffb347', 160, 0.6, 3);
}

/** Crafts a discovered legendary at rank I into the bag. */
export function craftLegend(g: Game, p: Player, id: string): string | null {
  const L = LEGENDARIES.find(l => l.id === id);
  if (!L || !p.codex.has(id)) return 'You have not discovered that legendary yet';
  if (p.bag.length >= BAG_SIZE) return 'Your bag is full';
  const err = pay(g, p, FORGE.craft);
  if (err) return err;
  const item = makeItem(g, g.day, 'legendary', L.slot, L.id);
  item.rank = 1;
  p.bag.push(item);
  noteFind(p, item);
  done(g, p, item, `Forged ${L.name}`);
  return null;
}

/** Raises a legendary one rank: more of its stats, a stronger effect. */
export function empower(g: Game, p: Player, itemId: number): string | null {
  const item = findItem(p, itemId);
  if (!item?.legend) return 'Only legendaries can be empowered';
  const r = item.rank ?? 1;
  if (r >= LEGEND_MAX_RANK) return 'Already at its highest rank';
  const err = pay(g, p, empowerCost(item));
  if (err) return err;
  applyRank(item, r, r + 1);
  noteFind(p, item);
  done(g, p, item, `${legendDef(item)!.name} ${ROMAN[r]}`);
  return null;
}

/** Rolls an item's random stats again (a legendary keeps its own stats and rank). */
export function reroll(g: Game, p: Player, itemId: number): string | null {
  const item = findItem(p, itemId);
  if (!item) return 'No such item';
  const err = pay(g, p, rerollCost(item));
  if (err) return err;
  const fresh = makeItem(g, item.ilvl, item.rarity, item.slot, item.legend);
  const rank = item.rank ?? 1;
  Object.assign(item, { mods: fresh.mods, prefix: fresh.prefix, suffix: fresh.suffix, rank: item.legend ? 1 : undefined });
  if (item.legend) applyRank(item, 1, rank);
  done(g, p, item, 'Rerolled');
  return null;
}

/** Raises an item's level by one (up to the current day): its random stats grow to match. */
export function upgrade(g: Game, p: Player, itemId: number): string | null {
  const item = findItem(p, itemId);
  if (!item) return 'No such item';
  if (item.ilvl >= g.day) return `Already at today's level (${g.day})`;
  const err = pay(g, p, upgradeCost(item));
  if (err) return err;
  const k = levelMul(item.ilvl + 1) / levelMul(item.ilvl);
  for (const [stat, v] of Object.entries(item.mods) as [StatKey, number][]) {
    const fixed = fixedPart(item, stat);
    item.mods[stat] = roundStat(stat, fixed + (v - fixed) * k);
  }
  item.ilvl++;
  done(g, p, item, `Item level ${item.ilvl}`);
  return null;
}

/**
 * A boss fell. The players who fought it get shards, and discover one legendary between them:
 * the one the fewest of them have. Anyone whose collection is already complete gets extra shards.
 */
export function bossReward(g: Game, players: Player[], shards: number): void {
  const counts = LEGENDARIES.map(l => ({ id: l.id, missing: players.filter(p => !p.codex.has(l.id)).length }));
  const most = Math.max(0, ...counts.map(c => c.missing));
  const id = most > 0 ? choice(counts.filter(c => c.missing === most)).id : null;
  const L = LEGENDARIES.find(l => l.id === id);
  for (const p of players) {
    p.shards += shards;
    if (L && !p.codex.has(L.id)) {
      p.codex.add(L.id);
      g.fx.toast(`Legendary discovered: ${L.name}! Craft it at the Hearth's forge. (+${shards} Legendary Shards)`, p.id);
    } else if (p.codex.size >= LEGENDARIES.length) {
      p.shards += FORGE.complete;
      g.fx.toast(`+${shards + FORGE.complete} Legendary Shards (your collection is complete).`, p.id);
    } else {
      g.fx.toast(`+${shards} Legendary Shards.`, p.id);
    }
  }
}
