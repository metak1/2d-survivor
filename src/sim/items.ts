// Items: rolling them, where they drop, picking them up, and wearing them. An item is plain data
// (so it can be sent over the network); what it does comes from its mods and flag, which
// computeStats adds to the player's stats.

import { ROMAN } from '../data/buildings';
import {
  AFFIXES, BAG_SIZE, FORGE, BASES, EXTRA_STAT_LABELS, LEGENDARIES, RARITIES, RARITY_ORDER, SLOT_ICONS, SLOT_NAMES,
  type ItemSlot, type Rarity, ITEM_SLOTS,
} from '../data/items';
import type { ClassId, StatKey } from '../data/types';
import { choice, dist, rand } from '../core/math';
import type { Enemy } from './enemy';
import type { Game } from './game';
import type { Player } from './player';

export interface Item {
  id: number;
  slot: ItemSlot;
  rarity: Rarity;
  /** Day it dropped on; affixes scale with it. */
  ilvl: number;
  /** Variant used for the base name and icon. */
  look: number;
  mods: Partial<Record<StatKey, number>>;
  flag?: string;
  prefix?: string;
  suffix?: string;
  /** Legendary id, if it is one, and its rank (I to V, raised at the forge). */
  legend?: string;
  rank?: number;
}

/** An item lying on the ground. */
export interface Loot { id: number; x: number; y: number; item: Item; t: number }

/** Loot on the ground at once; the oldest goes first. */
const MAX_LOOT = 60;
const PICKUP_RANGE = 34;

export const levelMul = (ilvl: number) => 1 + 0.12 * (ilvl - 1);
/** Percentages to a tenth of a percent; health and thorns to whole numbers; regeneration to a tenth. */
const round = (stat: StatKey, v: number, pct: boolean) =>
  pct ? Math.round(v * 1000) / 1000 : stat === 'regen' ? Math.round(v * 10) / 10 : Math.max(1, Math.round(v));
const PCT_STATS = new Set<StatKey>(['allyPow', 'wallHp', ...AFFIXES.filter(a => a.pct).map(a => a.stat)]);
/** Rounds a stat the way rolled items show it. */
export const roundStat = (stat: StatKey, v: number) => round(stat, v, PCT_STATS.has(stat));

/**
 * Picks a rarity; `luck` shifts the odds toward better ones (Blood Moon, bosses, chests).
 * Legendaries are never rolled: they're crafted at the forge (sim/forge.ts), so the roll stops at epic.
 */
export function rollRarity(luck = 0, min: Rarity = 'common'): Rarity {
  const from = RARITY_ORDER.indexOf(min);
  const pool = RARITY_ORDER.slice(from, RARITY_ORDER.indexOf('epic') + 1);
  const weights = pool.map((r, i) => RARITIES[r].weight * (1 + luck) ** (i + from));
  let x = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((x -= weights[i]) <= 0) return pool[i];
  return pool[pool.length - 1];
}

export function makeItem(g: Game, ilvl: number, rarity: Rarity, slot: ItemSlot = choice(ITEM_SLOTS), legend?: string): Item {
  const r = RARITIES[rarity], item: Item = { id: g.nextId(), slot, rarity, ilvl, look: Math.floor(Math.random() * 1000), mods: {} };
  const add = (stat: StatKey, v: number) => { item.mods[stat] = (item.mods[stat] ?? 0) + v; };
  if (rarity === 'legendary') {
    const L = LEGENDARIES.find(l => l.id === legend) ?? choice(LEGENDARIES.filter(l => l.slot === slot)) ?? choice(LEGENDARIES);
    item.slot = L.slot;
    item.legend = L.id;
    item.flag = L.flag;
    for (const [k, v] of Object.entries(L.mods)) add(k as StatKey, v!);
  }
  const pool = AFFIXES.filter(a => a.slots.includes(item.slot) && (!a.needs || g.players.some(p => p.cls === a.needs)));
  for (let i = 0; i < r.affixes && pool.length; i++) {
    const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    add(a.stat, round(a.stat, a.per * r.power * levelMul(ilvl) * rand(0.6, 1), a.pct));
    if (rarity !== 'legendary' && rarity !== 'common') {
      if (i === 0) item.prefix = a.prefix;
      else if (i === 1) item.suffix = a.suffix;
    }
  }
  return item;
}

// ----------------------------------------------------------------- names and text

export function itemName(item: Item, cls: ClassId): string {
  if (item.legend) return LEGENDARIES.find(l => l.id === item.legend)!.name + ((item.rank ?? 1) > 1 ? ` ${ROMAN[item.rank! - 1]}` : '');
  const set = BASES[item.slot], bases = set[cls] ?? set.any!;
  const base = bases[item.look % bases.length];
  return [item.prefix, base, item.suffix].filter(Boolean).join(' ');
}

export function itemIcon(item: Item, cls: ClassId): number {
  if (item.legend) return LEGENDARIES.find(l => l.id === item.legend)!.icon;
  const set = SLOT_ICONS[item.slot], icons = set[cls] ?? set.any!;
  return icons[item.look % icons.length];
}

/** One line per stat, e.g. "+6% damage". */
export function itemLines(item: Item): string[] {
  return Object.entries(item.mods).map(([k, v]) => statLine(k as StatKey, v!));
}

export function statLine(stat: StatKey, v: number): string {
  const a = AFFIXES.find(x => x.stat === stat), e = EXTRA_STAT_LABELS[stat];
  const label = a?.label ?? e?.label ?? stat, pct = a?.pct ?? e?.pct ?? false;
  if (stat === 'buildCost') return `${Math.round(v * 100)}% ${label}`;
  return pct ? `+${Math.round(v * 1000) / 10}% ${label}` : `+${Math.round(v * 10) / 10} ${label}`;
}

export const legendText = (item: Item) => (item.legend ? LEGENDARIES.find(l => l.id === item.legend)!.desc(item.rank ?? 1) : '');
export const slotName = (item: Item) => SLOT_NAMES[item.slot];
export const salvageValue = (item: Item) => (item.legend ? 0 : Math.round(RARITIES[item.rarity].salvage * levelMul(item.ilvl)));
/** Legendary Shards back from salvaging. */
export const salvageShards = (item: Item) => (item.legend ? FORGE.salvageLegend : item.rarity === 'epic' ? FORGE.salvageEpic : 0);
/** "12 gold and 1 shard". */
export function salvageText(item: Item): string {
  const gold = salvageValue(item), sh = salvageShards(item);
  return [gold ? `${gold} gold` : '', sh ? `${sh} Legendary Shard${sh === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
}
export const itemPrice = (item: Item) => Math.round(RARITIES[item.rarity].price * (1 + 0.1 * (item.ilvl - 1)));

// ----------------------------------------------------------------- drops

export function dropLoot(g: Game, x: number, y: number, item: Item): void {
  g.loot.push({ id: g.nextId(), x: x + rand(-14, 14), y: y + rand(-14, 14), item, t: 0 });
  if (g.loot.length > MAX_LOOT) g.loot.shift();
  const col = RARITIES[item.rarity].color;
  g.events.emit('vfx', { kind: 'ring', x, y, r: item.rarity === 'common' ? 14 : 26, color: col, life: 0.5 });
}

/**
 * A monster died: maybe it drops something. Tougher monsters drop more often. Night bosses drop an
 * epic (and reward shards and a legendary discovery, see forge.ts); dungeon bosses drop theirs when
 * the dungeon is cleared (dungeons.ts).
 */
export function monsterDrop(g: Game, e: Enemy): void {
  const d = e.def;
  if (d.boss && e.dungeon) return;
  const chance = d.boss ? 1 : d.guard ? 0.45 : Math.min(0.35, 0.035 * Math.max(1, d.cost));
  if (Math.random() > chance) return;
  const luck = (g.bloodMoon ? 0.6 : 0) + (d.boss ? 1.5 : d.guard ? 0.5 : 0) + 0.03 * g.day;
  if (d.boss) {
    dropLoot(g, e.x, e.y, makeItem(g, g.day, rollRarity(luck, 'epic')));
    return;
  }
  dropLoot(g, e.x, e.y, makeItem(g, g.day, rollRarity(luck)));
}

/** A treasure chest spills one or two items. */
export function chestDrop(g: Game, x: number, y: number): void {
  const n = Math.random() < 0.35 ? 2 : 1;
  for (let i = 0; i < n; i++) dropLoot(g, x, y + 20, makeItem(g, g.day, rollRarity(0.4 + 0.03 * g.day, 'magic')));
}

/** What the merchant offers this visit. */
export function merchantWares(g: Game): Item[] {
  return [rollRarity(0.2, 'magic'), rollRarity(0.5, 'magic'), rollRarity(0.9, 'rare')].map(r => makeItem(g, g.day, r));
}

/** Players walking over loot pick it up, if their bag has room. */
export function updateLoot(g: Game, dt: number): void {
  for (const l of g.loot) l.t += dt;
  for (const p of g.players) {
    if (p.dead) continue;
    for (const l of [...g.loot]) {
      if (dist(p.x, p.y, l.x, l.y) > PICKUP_RANGE) continue;
      if (p.bag.length >= BAG_SIZE) {
        if (l.t > 0.5 && Math.floor(g.time * 2) % 4 === 0) g.fx.text(p.x, p.y - 40, 'Bag full', '#ff9a8a', 12);
        break;
      }
      g.loot.splice(g.loot.indexOf(l), 1);
      p.bag.push(l.item);
      noteFind(p, l.item);
      const col = RARITIES[l.item.rarity].color;
      g.fx.text(p.x, p.y - 36, itemName(l.item, p.cls), col, 13, 1.2);
      if (l.item.rarity === 'epic' || l.item.rarity === 'legendary') {
        g.fx.toast(g.players.length > 1 ? `${p.name} found ${itemName(l.item, p.cls)}!` : `You found ${itemName(l.item, p.cls)}!`);
      }
    }
  }
}

// ----------------------------------------------------------------- wearing

/** The legendary worn in another slot that would block wearing `item`, if any (one at a time). */
export function legendaryConflict(p: Player, item: Item): Item | undefined {
  if (!item.legend) return undefined;
  return Object.values(p.equip).find(w => w?.legend && w.slot !== item.slot);
}

/** Puts on the item in bag slot `index`, swapping out whatever was worn there. Returns an error message, or null. */
export function equipItem(p: Player, index: number): string | null {
  const item = p.bag[index];
  if (!item) return 'No such item';
  if (legendaryConflict(p, item)) return 'Only one legendary can be worn at a time';
  const worn = p.equip[item.slot];
  p.bag.splice(index, 1);
  if (worn) p.bag.splice(index, 0, worn);
  p.equip[item.slot] = item;
  p.recalc();
  return null;
}

export function unequipItem(p: Player, slot: ItemSlot): boolean {
  const worn = p.equip[slot];
  if (!worn || p.bag.length >= BAG_SIZE) return false;
  delete p.equip[slot];
  p.bag.push(worn);
  p.recalc();
  return true;
}

/** Breaks down an item in the bag for gold (shared with the party). */
export function salvageItem(g: Game, p: Player, index: number): boolean {
  const item = p.bag[index];
  if (!item) return false;
  p.bag.splice(index, 1);
  const gold = salvageValue(item), shards = salvageShards(item);
  g.res.gold += gold;
  p.shards += shards;
  g.fx.text(p.x, p.y - 30, [gold ? `+${gold} 🪙` : '', shards ? `+${shards} 💠` : ''].filter(Boolean).join(' '), '#ffe27a', 13);
  return true;
}

/** Buys one of the merchant's items into `p`'s bag. Returns an error, or null. */
export function buyItem(g: Game, p: Player, index: number): string | null {
  const item = g.wares[index];
  if (!item) return 'Sold out';
  if (!g.npcs.some(n => n.kind === 'merchant')) return 'The merchant has left';
  if (p.bag.length >= BAG_SIZE) return 'Your bag is full';
  const price = itemPrice(item);
  if (g.res.gold < price) return 'Not enough gold';
  g.res.gold -= price;
  g.wares.splice(index, 1);
  p.bag.push(item);
  noteFind(p, item);
  return null;
}

/** Keeps the best item a player got this run (for the end screen): rarest, then highest level. */
export function noteFind(p: Player, item: Item): void {
  const b = p.run.best, rank = (i: Item) => RARITY_ORDER.indexOf(i.rarity) * 1000 + i.ilvl;
  if (!b || rank(item) > rank(b)) p.run.best = item;
}
