// Daytime content: guarded treasure camps out in the wilds, visiting NPCs, supply drops,
// Blood Moon omens, and the merchant's shop. Gives the player reasons to leave the base.

import { MAP_H, MAP_W, TILE } from '../config';
import { CAMPS, DAY_EVENTS, DAY_EVENT_CHANCE, SHOP, type DayEvent, type NpcKind, type ShopEffect } from '../data/events';
import { GUARD_TYPES } from '../data/enemies';
import type { ResKey } from '../data/types';
import { choice, dist, rand, TAU } from '../core/math';
import { Ally, allySlots, recruitCount, syncSummons } from './ally';
import { chestDrop, merchantWares } from './items';
import { Enemy } from './enemy';
import type { Game } from './game';
import type { Player } from './player';
import { tileOf } from './world';

export interface Camp { id: number; x: number; y: number; guardIds: number[]; opened: boolean }
export interface Npc { id: number; kind: NpcKind; x: number; y: number }
export interface Pickup { id: number; x: number; y: number }

export interface Interactable {
  kind: 'merchant' | 'traveller' | 'chest';
  id: number;
  x: number;
  y: number;
  label: string;
  /** Why it can't be used yet, if so. */
  locked?: string;
}

const INTERACT_RANGE = 70;

/** A random open spot at `minT`..`maxT` tiles from the Hearth, away from `avoid`. */
function openSpot(g: Game, minT: number, maxT: number, avoid: { x: number; y: number }[] = [], gap = 0): { x: number; y: number } | null {
  const cx = MAP_W / 2, cy = MAP_H / 2;
  for (let i = 0; i < 80; i++) {
    const a = rand(0, TAU), d = rand(minT, maxT);
    const tx = Math.floor(cx + Math.cos(a) * d), ty = Math.floor(cy + Math.sin(a) * d);
    if (tx < 3 || ty < 3 || tx > MAP_W - 4 || ty > MAP_H - 4) continue;
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    if (avoid.some(o => dist(o.x, o.y, x, y) < gap)) continue;
    if (g.world.blocked(tx, ty) && gap === 0) continue;
    return { x, y };
  }
  return null;
}

export function spawnCamp(g: Game): void {
  const spot = openSpot(g, CAMPS.minDist, CAMPS.maxDist, g.camps, 10 * TILE);
  if (!spot) return;
  g.world.clearNodes(tileOf(spot.x), tileOf(spot.y), 2.5);
  const n = 2 + (g.day >= 5 ? 1 : 0) + (Math.random() < 0.3 ? 1 : 0);
  const camp: Camp = { id: g.nextId(), x: spot.x, y: spot.y, guardIds: [], opened: false };
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.3, 0.3);
    const e = new Enemy(g, choice(GUARD_TYPES), spot.x + Math.cos(a) * 55, spot.y + Math.sin(a) * 55, g.day);
    e.home = { x: e.x, y: e.y };
    g.enemies.push(e);
    camp.guardIds.push(e.id);
  }
  g.camps.push(camp);
}

export const campCleared = (g: Game, c: Camp) => !g.enemies.some(e => !e.dead && c.guardIds.includes(e.id));

/** Rolls the day's event. Returns a sentence for the dawn banner, if anything happened. */
export function onDawn(g: Game): string | null {
  if (g.day % CAMPS.every === 0 && g.camps.filter(c => !c.opened).length < CAMPS.max) spawnCamp(g);
  g.camps = g.camps.filter(c => !c.opened);
  for (const p of g.players) {
    syncSummons(g, p, true);
    p.fallenRecruits = 0;
  }

  if (Math.random() > DAY_EVENT_CHANCE) return null;
  const options = DAY_EVENTS.filter(e => g.day >= e.minDay && !(e.id === 'traveller' && g.players.every(p => recruitCount(g, p) >= allySlots(p))));
  const total = options.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total, pick: DayEvent | null = null;
  for (const e of options) { r -= e.weight; if (r <= 0) { pick = e.id; break; } }
  switch (pick) {
    case 'merchant': {
      const h = g.world.hearth;
      g.npcs.push({ id: g.nextId(), kind: 'merchant', x: h.x + 130, y: h.y - 40 });
      g.shopBought = new Set();
      g.wares = merchantWares(g);
      return 'A merchant has set up shop by the Hearth.';
    }
    case 'traveller': {
      const spot = openSpot(g, 13, 22);
      if (!spot) return null;
      g.npcs.push({ id: g.nextId(), kind: 'traveller', x: spot.x, y: spot.y });
      return 'Scouts spotted a wounded traveller in the wilds.';
    }
    case 'supplies': {
      const spot = openSpot(g, 11, 20);
      if (!spot) return null;
      g.pickups.push({ id: g.nextId(), x: spot.x, y: spot.y });
      return 'A supply cart crashed nearby. Go collect it!';
    }
    case 'bloodmoon':
      g.bloodMoonNext = true;
      return 'Omen: a Blood Moon rises tonight (more monsters, double rewards).';
    default:
      return null;
  }
}

export function onNightfall(g: Game): void {
  if (g.npcs.some(n => n.kind === 'traveller')) g.fx.toast('The wounded traveller was lost to the night.');
  if (g.npcs.some(n => n.kind === 'merchant')) g.fx.toast('The merchant packs up and leaves.');
  g.npcs = [];
  g.wares = [];
  for (const p of g.players) p.nightUsed.clear();
}

export function updateDaylife(g: Game, dt: number): void {
  for (const a of [...g.allies]) a.update(dt);
  g.allies = g.allies.filter(a => {
    if (!a.dead || a.respawn > 0) return true;
    const p = a.owner;
    if (a.kind === 'squire' || a.kind === 'familiar' || a.kind === 'hound') p.fallenSummons[a.kind] = (p.fallenSummons[a.kind] ?? 0) + 1;
    if (a.kind === 'soldier') p.fallenRecruits++;
    return false;
  });

  for (const pk of [...g.pickups]) {
    if (!g.players.some(p => !p.dead && dist(p.x, p.y, pk.x, pk.y) <= 40)) continue;
    const wood = Math.round(rand(50, 80)), stone = Math.round(rand(30, 60));
    g.res.wood += wood;
    g.res.stone += stone;
    g.fx.text(pk.x, pk.y - 20, `+${wood} 🪵 +${stone} 🪨`, '#e9f5c9', 15);
    g.fx.particles(pk.x, pk.y, 18, '#d8c49a', 140, 0.5, 3);
    g.pickups = g.pickups.filter(x => x !== pk);
  }
}

export function nearestInteractable(g: Game, p: Player): Interactable | null {
  if (p.dead) return null;
  let best: Interactable | null = null, bd = INTERACT_RANGE;
  const offer = (it: Interactable) => {
    const d = dist(p.x, p.y, it.x, it.y);
    if (d < bd) { bd = d; best = it; }
  };
  for (const n of g.npcs) {
    offer(n.kind === 'merchant'
      ? { kind: 'merchant', id: n.id, x: n.x, y: n.y, label: 'Trade with the merchant' }
      : { kind: 'traveller', id: n.id, x: n.x, y: n.y, label: 'Help the traveller',
          locked: recruitCount(g, p) >= allySlots(p) ? 'No free companion slot' : undefined });
  }
  for (const c of g.camps) {
    if (c.opened) continue;
    offer({ kind: 'chest', id: c.id, x: c.x, y: c.y, label: 'Open the treasure chest',
      locked: campCleared(g, c) ? undefined : 'Defeat the guardians first' });
  }
  return best;
}

export function interact(g: Game, p: Player): void {
  const it = nearestInteractable(g, p);
  if (!it) return;
  if (it.locked) { g.fx.text(it.x, it.y - 30, it.locked, '#ff9a8a', 13); return; }
  switch (it.kind) {
    case 'merchant':
      g.events.emit('shop', { to: p.id });
      break;
    case 'traveller':
      g.npcs = g.npcs.filter(n => n.id !== it.id);
      g.allies.push(new Ally(g, p, 'soldier', it.x, it.y));
      g.fx.toast(g.players.length > 1 ? `The traveller joins ${p.name} as a companion!` : 'The traveller joins you as a companion!');
      g.events.emit('vfx', { kind: 'ring', x: it.x, y: it.y, r: 50, color: '#8fff9a', life: 0.5 });
      break;
    case 'chest':
      openChest(g, p, g.camps.find(c => c.id === it.id)!);
      break;
  }
}

function openChest(g: Game, p: Player, c: Camp): void {
  c.opened = true;
  const gold = Math.round((40 + 12 * g.day) * (p.stats.flags.has('pathfinder') ? 1.5 : 1)), wood = 30, stone = 25, xp = 25 + 8 * g.day;
  g.res.gold += gold;
  g.res.wood += wood;
  g.res.stone += stone;
  for (const q of g.players) q.gainXp(xp);
  let msg = `Treasure! +${gold} gold, +${wood} wood, +${stone} stone`;
  if (Math.random() < 0.35) {
    p.points++;
    msg += ' and an ancient tome (+1 talent point)';
  }
  g.fx.toast(msg);
  chestDrop(g, c.x, c.y);
  g.fx.text(c.x, c.y - 30, `+${gold} 🪙`, '#ffe27a', 18, 1.4);
  g.fx.particles(c.x, c.y, 40, '#ffe27a', 220, 0.8, 4);
  g.events.emit('vfx', { kind: 'ring', x: c.x, y: c.y, r: 70, color: '#ffe27a', life: 0.6 });
  g.events.emit('worldChanged', undefined);
}

/** Buys a merchant item. Returns an error message, or null on success. */
export function buy(g: Game, p: Player, id: ShopEffect): string | null {
  const item = SHOP.find(s => s.id === id)!;
  if (item.once && g.shopBought.has(id)) return 'Sold out';
  if (id === 'ally' && recruitCount(g, p) >= allySlots(p)) return 'No free companion slot';
  if (!g.canAfford(item.cost)) return 'Not enough gold';
  g.pay(item.cost);
  g.shopBought.add(id);
  const add = (k: ResKey, v: number) => { g.res[k] += v; };
  switch (id) {
    case 'heal': p.heal(p.stats.maxHp); break;
    case 'repairAll': for (const b of g.world.buildings) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.5); break;
    case 'wood': add('wood', 60); break;
    case 'stone': add('stone', 50); break;
    case 'talent': p.points++; break;
    case 'ally': g.allies.push(new Ally(g, p, 'soldier', p.x - 30, p.y + 20)); break;
  }
  return null;
}
