// The damage pipeline: every hit on a monster goes through damageEnemy (or dealPlayerDamage,
// which adds the player's multipliers, crits and lifesteal on top).

import { dist } from '../core/math';
import type { Enemy } from './enemy';
import type { Game } from './game';
import type { Player } from './player';
import { hasCompanions } from './ally';
import { healFriend, mostWounded } from './heal';
import { bossReward } from './forge';
import { legendBonus } from './stats';
import { FORGE } from '../data/items';
import { monsterDrop } from './items';
import { distToBuilding } from './world';

// Damage-over-time effects are told apart by colour.
export const BURN_COLOR = '#ff8a3a';
export const BLEED_COLOR = '#c0392b';
export const POISON_COLOR = '#9be35b';
export const HOLY_COLOR = '#ffe27a';

/** What dealt a player hit, for talents that care (Hot Streak, Rampage, Hailstorm...). */
export type HitTag = 'cleave' | 'charge' | 'whirl' | 'cry' | 'bolt' | 'arrow' | 'fireball' | 'nova' | 'meteor'
  | 'volley' | 'trap' | 'rain' | 'hail' | 'smite' | 'holy' | 'beam' | 'chain' | 'other';

export interface HitOpts {
  crit?: boolean;
  noCrit?: boolean;
  color?: string;
  small?: boolean;
  silent?: boolean;
  noReward?: boolean;
  /** The player who dealt it (for Reaper and similar on-kill talents). */
  by?: Player;
  tag?: HitTag;
  knock?: number;
  fromX?: number;
  fromY?: number;
}

/** Damage multiplier for a monster's attacks (Sanctuary: weaker inside Consecration). */
export function enemyDmgMul(g: Game, e: Enemy): number {
  return g.zones.some(z => z.kind === 'field' && z.sanct && dist(z.x, z.y, e.x, e.y) < z.r) ? 0.7 : 1;
}

/** The first player with a talent, for effects that don't know who caused them (burns, poison). */
export const withFlag = (g: Game, flag: string): Player | undefined => g.players.find(p => p.stats.flags.has(flag));

/** Whether a point is inside a War Banner's radius. */
export function inBanner(g: Game, x: number, y: number): boolean {
  return g.zones.some(z => z.kind === 'banner' && dist(z.x, z.y, x, y) < z.r);
}

/** Something monsters fight: the player or an allied companion. */
export interface Friendly {
  x: number;
  y: number;
  r: number;
  dead: boolean;
  /** Building hunters within this range attack it instead (Warrior). */
  provoke?: number;
  hurt(dmg: number, src?: Enemy): void;
}

export function enemiesInRadius(g: Game, x: number, y: number, r: number): Enemy[] {
  return g.enemies.filter(e => !e.dead && dist(x, y, e.x, e.y) < r + e.r);
}

/** Closest living player or ally to a point. */
export function nearestFriendly(g: Game, x: number, y: number): { f: Friendly | null; d: number } {
  let f: Friendly | null = null, d = Infinity;
  const consider = (c: Friendly) => {
    if (c.dead) return;
    const cd = dist(x, y, c.x, c.y);
    if (cd < d) { d = cd; f = c; }
  };
  // Camouflage hides a player; Mirror Image decoys pull monsters from farther away.
  for (const p of g.players) if (!p.buffs.camo) consider(p);
  for (const a of g.allies) {
    if (a.kind !== 'decoy') consider(a);
    else if (!a.dead && dist(x, y, a.x, a.y) * 0.4 < d) { d = dist(x, y, a.x, a.y); f = a; }
  }
  return { f, d };
}

export function damageEnemy(g: Game, e: Enemy, amount: number, o: HitOpts = {}): number {
  if (e.dead || amount <= 0) return 0;
  if (e.freeze > 0 && (o.by ?? withFlag(g, 'shatter'))?.stats.flags.has('shatter')) amount *= 1.5;
  if (e.marked > 0) amount *= 1.25;
  if (e.shield > 0) amount *= 0.5;
  const dealt = Math.min(e.hp, amount);
  e.hp -= amount;
  if (o.by) o.by.run.dmg += dealt;
  if (!o.silent) {
    e.lastHit = g.time;
    g.fx.text(e.x + (Math.random() - 0.5) * 12, e.y - e.r, String(Math.round(amount)),
      o.crit ? '#ffd84a' : o.color || '#ffffff', o.crit ? 19 : o.small ? 11 : 13);
  }
  if (o.knock && !e.def.boss && o.fromX !== undefined && o.fromY !== undefined) {
    const a = Math.atan2(e.y - o.fromY, e.x - o.fromX);
    const k = o.knock * (e.r > 17 ? 0.35 : 1);
    e.kx += Math.cos(a) * k;
    e.ky += Math.sin(a) * k;
  }
  if (e.hp <= 0) killEnemy(g, e, o);
  return dealt;
}

/** Damage from the player: applies damage multipliers, buffs, crits and lifesteal. */
export function dealPlayerDamage(g: Game, p: Player, e: Enemy, base: number, o: HitOpts = {}): number {
  const s = p.stats, f = s.flags, r = s.ranks;
  let mul = s.dmgMul;
  if (p.buffs.cry) mul *= f.has('avatar') ? 1.7 : 1.4;
  if (f.has('execute') && e.hp < e.maxHp * 0.3) mul *= 1.8;
  if (f.has('lonewolf') && !hasCompanions(g, p)) mul *= 1.15;
  if (f.has('bloodlust') && p.buffs.lust) mul *= 1 + 0.03 * r.bloodlust * p.lustStacks;
  if (f.has('brittle') && e.slow > 0) mul *= 1 + 0.08 * r.brittle;
  if (f.has('steady') && !p.moving) mul *= 1 + 0.12 * r.steady;
  if (inBanner(g, p.x, p.y)) mul *= 1.25;
  if (f.has('bane') && (e.def.boss || e.def.guard)) mul *= 1 + 0.15 * r.bane;
  if (f.has('avenger') && p.hp > s.maxHp * 0.8) mul *= 1.3;
  const crit = !o.noCrit && Math.random() < s.crit;
  if (crit) mul *= 2 + 0.3 * (r.headhunter || 0);
  const dealt = damageEnemy(g, e, base * mul, { ...o, crit, by: p });
  if (s.lifesteal > 0 && dealt > 0) p.heal(dealt * s.lifesteal, true);
  if (dealt > 0 && o.tag === 'smite' && f.has('smiteheal')) {
    const w = mostWounded(g, p, false);
    if (w) healFriend(g, p, w, dealt * 0.4 * s.healMul);
  }
  if (dealt > 0 && f.has('atonement')) {
    const w = mostWounded(g, p, true);
    if (w) healFriend(g, p, w, dealt * 0.2 * s.healMul);
  }
  if (crit) onPlayerCrit(g, p, e, o.tag);
  if (dealt > 0) itemOnHit(g, p, e, base, o.tag);
  return dealt;
}

/** Legendary on-hit effects (Frostbite Band, Stormcaller). */
function itemOnHit(g: Game, p: Player, e: Enemy, base: number, tag?: HitTag): void {
  const f = p.stats.flags;
  const s = p.stats;
  if (f.has('item_frost') && !e.dead && !e.def.boss && Math.random() < 0.1 + 0.025 * legendBonus(s, 'frostbite')) e.freeze = Math.max(e.freeze, 0.8);
  // Lightning doesn't fork off its own forks.
  if (!f.has('item_chain') || tag === 'chain' || Math.random() >= 0.15 + 0.025 * legendBonus(s, 'stormcaller')) return;
  const points = [{ x: e.x, y: e.y }], hit = new Set([e.id]);
  let from: Enemy = e;
  for (let j = 0; j < 3; j++) {
    let next: Enemy | null = null, bd = 170;
    for (const o of g.enemies) {
      if (o.dead || hit.has(o.id)) continue;
      const d = dist(from.x, from.y, o.x, o.y);
      if (d < bd) { bd = d; next = o; }
    }
    if (!next) break;
    hit.add(next.id);
    points.push({ x: next.x, y: next.y });
    dealPlayerDamage(g, p, next, Math.max(8, base * 0.6), { noCrit: true, color: '#bfe4ff', tag: 'chain' });
    from = next;
  }
  if (points.length > 1) g.events.emit('vfx', { kind: 'chain', points, color: '#bfe4ff' });
}

function onPlayerCrit(g: Game, p: Player, e: Enemy, tag?: HitTag): void {
  const f = p.stats.flags;
  if (f.has('critcdr') && p.critCdT <= 0) {
    p.critCdT = 0.15;
    p.reduceCooldowns(0.3);
  }
  if (tag === 'fireball' && f.has('hotstreak')) p.cds.fireball = 0;
  if (tag === 'arrow' && f.has('hail')) {
    // Fire a bonus arrow from the struck enemy at another one nearby.
    let best: Enemy | null = null, bd = 260;
    for (const o of g.enemies) {
      if (o.dead || o === e) continue;
      const d = dist(e.x, e.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return;
    const a = Math.atan2(best.y - e.y, best.x - e.x);
    g.projectiles.push({ id: g.nextId(), kind: 'arrow', team: 'player', owner: p.id, x: e.x, y: e.y, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900,
      r: 5, life: 0.4, dmg: p.def.basic.dmg, pierce: 0, hits: new Set([e.id]), tag: 'hail' });
  }
}

export function applyDot(e: Enemy, dps: number, t: number, color: string): void {
  const existing = e.dots.find(d => d.color === color);
  if (existing) {
    existing.t = Math.max(existing.t, t);
    existing.dps = Math.max(existing.dps, dps);
    return;
  }
  e.dots.push({ dps, t, tick: 0.5, color });
}

export function slowEnemy(e: Enemy, amount: number, t: number): void {
  e.slowAmt = Math.max(e.slow > 0 ? e.slowAmt : 0, amount);
  e.slow = Math.max(e.slow, t);
}

function killEnemy(g: Game, e: Enemy, o: HitOpts): void {
  if (e.dead) return;
  e.dead = true;
  g.events.emit('died', { id: e.id });
  g.fx.particles(e.x, e.y, e.def.boss ? 60 : 12, e.def.color, e.def.boss ? 300 : 150, 0.7, e.def.boss ? 6 : 4);
  if (o.noReward) return;

  onKill(g, e, o);

  // A Blood Moon doubles what the night's monsters drop.
  const mul = g.bloodMoon && !e.def.guard ? 2 : 1;
  const goldMul = Math.max(1, ...g.players.map(p => p.stats.goldMul));
  g.stats.kills++;
  if (o.by) o.by.run.kills++;
  g.res.gold += Math.round(e.def.gold * mul * goldMul);
  // Everyone in the party levels together. Bigger parties face more monsters, each worth less.
  for (const p of g.players) p.gainXp((e.def.xp * mul) / g.partyMul);
  monsterDrop(g, e);
  if (e.def.boss) {
    bossReward(g, g.players, FORGE.nightBoss);
    g.fx.shake(20);
    g.fx.toast(`The ${e.def.name} is slain! +60 wood, +40 stone`);
    g.res.wood += 60;
    g.res.stone += 40;
  }
}

/** Talents that trigger when a monster dies. */
function onKill(g: Game, e: Enemy, o: HitOpts): void {
  // Effects of a monster's death that don't depend on who landed the blow.
  const burning = e.dots.some(d => d.color === BURN_COLOR), poisoned = e.dots.some(d => d.color === POISON_COLOR);
  const bomb = burning && withFlag(g, 'livingbomb');
  if (bomb) explode(g, e.x, e.y, 75 * bomb.stats.aoe, 28, { team: 'player', owner: bomb.id, color: BURN_COLOR, knock: 120 });
  const spread = burning && withFlag(g, 'spreadburn');
  if (spread) {
    const near = enemiesInRadius(g, e.x, e.y, 160).filter(x => x !== e).slice(0, 2 * spread.stats.ranks.spreadburn);
    for (const x of near) applyDot(x, 10 * burnMul(spread), 3, BURN_COLOR);
  }
  const black = poisoned && withFlag(g, 'blackarrow');
  if (black) g.zones.push({ id: g.nextId(), owner: black.id, kind: 'cloud', x: e.x, y: e.y, t: 0, r: 70, life: 3, tick: 0, dps: 16 });
  const zero = e.freeze > 0 && withFlag(g, 'absolutezero');
  if (zero) explode(g, e.x, e.y, 80 * zero.stats.aoe, 40, { team: 'player', owner: zero.id, color: '#bfe9ff', knock: 100, tag: 'nova' });

  const p = o.by;
  if (!p) return;
  const s = p.stats, f = s.flags;
  if (f.has('reaper')) p.heal(s.maxHp * (0.04 + 0.01 * legendBonus(s, 'bloodfang')), true);
  if (f.has('bloodlust')) {
    p.buffs.lust = 6;
    p.lustStacks = Math.min(5, p.lustStacks + 1);
  }
  if (f.has('chrono')) p.reduceCooldowns(0.2 + 0.05 * legendBonus(s, 'crown'));
  if (o.tag === 'charge' && f.has('rampage') && p.rampageT <= 0) {
    p.cds.charge = 0;
    p.rampageT = 3;
  }
}

/** Ignite makes all of a player's burns hit harder. */
export const burnMul = (p: Player) => 1 + 0.4 * (p.stats.ranks.ignite || 0);

export interface ExplodeOpts {
  team: 'player' | 'tower' | 'enemy' | 'none';
  color?: string;
  knock?: number;
  burn?: number;
  /** Slows survivors by this fraction for 2s (Frostfire). */
  slow?: number;
  /** Stuns survivors for this long (Aftershock). */
  stun?: number;
  dmgColor?: string;
  tag?: HitTag;
  /** For team 'player': the id of the player who caused it. */
  owner?: number;
}

/**
 * Area blast. 'player' applies crits and talents, 'tower' plain damage, 'enemy' hurts buildings
 * and friendlies (siege shells, sappers), 'none' is visual only.
 */
export function explode(g: Game, x: number, y: number, r: number, dmg: number, o: ExplodeOpts): void {
  if (dmg > 0 && o.team === 'enemy') {
    // The Hearth shrugs off most of a blast: sappers and siege shells are meant to break walls.
    for (const b of [...g.world.buildings]) if (distToBuilding({ x, y }, b) < r) g.world.damage(b, b.type === 'hearth' ? dmg * 0.35 : dmg);
    const friends = [...g.players, ...g.allies];
    for (const f of friends) if (!f.dead && dist(x, y, f.x, f.y) < r + f.r) f.hurt(dmg * 0.3);
  } else if (dmg > 0 && o.team !== 'none') {
    const by = o.team === 'player' ? g.owner(o.owner) : undefined;
    for (const e of enemiesInRadius(g, x, y, r)) {
      const opts: HitOpts = { knock: o.knock || 0, fromX: x, fromY: y, color: o.dmgColor, tag: o.tag };
      if (by) dealPlayerDamage(g, by, e, dmg, opts);
      else damageEnemy(g, e, dmg, opts);
      if (e.dead) continue;
      if (o.burn) applyDot(e, o.burn * (by ? burnMul(by) : 1), 3, BURN_COLOR);
      if (o.slow) slowEnemy(e, o.slow, 2);
      if (o.stun && !e.def.boss) e.stun = Math.max(e.stun, o.stun);
    }
  }
  const color = o.color || '#ff9a3a';
  g.events.emit('vfx', { kind: 'blast', x, y, r, color });
  g.fx.particles(x, y, Math.min(40, 10 + r / 6), color, r * 2.2, 0.5, 4);
}
