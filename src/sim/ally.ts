// Companions that fight for a player: soldiers recruited from travellers or the merchant, and
// summons granted by talents (squires, the arcane familiar, hounds, Mirror Image decoys). Each
// belongs to one player (`owner`), follows them and uses their talents. Recruits are lost for good
// when killed; summons come back at dawn while the talent is learned.

import type { SpriteRef } from '../data/types';
import { NPC_LOOKS } from '../data/events';
import { dist } from '../core/math';
import { applyDot, bannerOf, damageEnemy, explode, inBanner, POISON_COLOR, type Friendly } from './combat';
import type { Enemy } from './enemy';
import type { Game } from './game';
import type { Player } from './player';

export type AllyKind = 'soldier' | 'squire' | 'familiar' | 'hound' | 'spectral' | 'levy' | 'decoy';

interface AllyDef {
  name: string;
  look: SpriteRef;
  hp: number;
  hpPerDay: number;
  dmg: number;
  dmgPerDay: number;
  speed: number;
  atkCd: number;
  /** Ranged companions shoot from this distance. */
  range?: number;
  flying?: boolean;
  /** Summoned by talents (doesn't use a companion slot). */
  summon?: boolean;
  /** Seconds before it vanishes on its own. */
  life?: number;
}

export const ALLY_DEFS: Record<Exclude<AllyKind, 'decoy'>, AllyDef> = {
  soldier: { name: 'Companion', look: NPC_LOOKS.ally, hp: 140, hpPerDay: 20, dmg: 12, dmgPerDay: 2, speed: 175, atkCd: 0.9 },
  squire: { name: 'Squire', look: { sprite: 'templar', scale: 2.6 }, hp: 170, hpPerDay: 22, dmg: 11, dmgPerDay: 2, speed: 180, atkCd: 1.0, summon: true },
  familiar: { name: 'Familiar', look: { sprite: 'ghostfire', scale: 2.2, offsetY: -16 }, hp: 90, hpPerDay: 12, dmg: 11, dmgPerDay: 2,
    speed: 200, atkCd: 1.1, range: 260, flying: true, summon: true },
  hound: { name: 'Hellhound', look: { sprite: 'hellhound', scale: 2.4 }, hp: 120, hpPerDay: 16, dmg: 10, dmgPerDay: 2, speed: 240, atkCd: 0.7, summon: true },
  spectral: { name: 'Spectral Hound', look: { sprite: 'hellhound', scale: 2.1 }, hp: 70, hpPerDay: 10, dmg: 8, dmgPerDay: 1.5, speed: 250, atkCd: 0.7,
    summon: true, life: 10 },
  levy: { name: 'Man-at-arms', look: NPC_LOOKS.ally, hp: 110, hpPerDay: 16, dmg: 10, dmgPerDay: 2, speed: 190, atkCd: 0.9,
    summon: true, life: 15 },
};

/** Base companion slots for recruits; talents add more. */
export const BASE_ALLY_SLOTS = 2;

export class Ally implements Friendly {
  readonly id: number;
  readonly r = 13;
  readonly look: SpriteRef;
  hp: number;
  maxHp = 1;
  dead = false;
  lastHit = -1;
  moving = false;
  angle = 0;
  /** Damage absorbed before health (Arcane Ward). */
  barrier = 0;
  barrierT = 0;
  /** Heal-over-time per second, and seconds left (Prayer of Mending). */
  hot = 0;
  hotT = 0;
  /** Seconds of Shared Fury (Battle Cry) left. */
  cry = 0;
  /** King's Host: seconds until a fallen companion returns, or -1. */
  respawn = -1;
  life: number;
  private atk = 0;
  private baseHp: number;
  private baseDmg: number;

  constructor(private g: Game, readonly owner: Player, readonly kind: AllyKind, public x: number, public y: number) {
    this.id = g.nextId();
    if (kind === 'decoy') {
      this.look = owner.def.look;
      this.baseHp = 60 + g.day * 15;
      this.baseDmg = 0;
      this.life = 4;
    } else {
      const d = ALLY_DEFS[kind];
      this.look = d.look;
      this.baseHp = d.hp + d.hpPerDay * g.day;
      this.baseDmg = d.dmg + d.dmgPerDay * g.day;
      this.life = d.life ?? Infinity;
    }
    this.refresh();
    this.hp = this.maxHp;
  }

  get def(): AllyDef | null { return this.kind === 'decoy' ? null : ALLY_DEFS[this.kind]; }
  get summon(): boolean { return this.kind === 'decoy' || !!this.def!.summon; }
  get flying(): boolean { return !!this.def?.flying; }
  /** Summoned for a few seconds (and never mourned or brought back). */
  get fleeting(): boolean { return this.kind === 'spectral' || this.kind === 'levy'; }

  /** Re-applies the owner's companion talents to health. */
  refresh(): void {
    const s = this.owner.stats;
    const hound = this.kind === 'hound' || this.kind === 'spectral';
    const mul = (this.kind === 'decoy' ? 1 : s.allyPow) * (hound && s.flags.has('alpha') ? 2 : 1);
    const max = Math.round(this.baseHp * mul), frac = this.maxHp > 1 ? this.hp / this.maxHp : 1;
    this.maxHp = max;
    this.hp = Math.min(max, max * frac);
  }

  private get damage(): number {
    const g = this.g;
    return this.baseDmg * this.owner.stats.allyPow * (this.cry > 0 ? 1.4 : 1) * (inBanner(g, this.x, this.y) ? 1.25 : 1);
  }

  update(dt: number): void {
    const g = this.g, p = this.owner, s = p.stats;
    if (this.dead) {
      if (this.respawn > 0 && (this.respawn -= dt) <= 0) this.revive();
      return;
    }
    this.atk -= dt;
    this.cry = Math.max(0, this.cry - dt);
    if ((this.barrierT -= dt) <= 0) this.barrier = 0;
    this.moving = false;
    let regen = 2;
    if (this.hotT > 0) { this.hotT -= dt; regen += this.hot; }
    if (s.flags.has('innerlight') && dist(this.x, this.y, p.x, p.y) < 200) regen += this.maxHp * 0.01;
    this.hp = Math.min(this.maxHp, this.hp + regen * dt);
    if (s.flags.has('inspire') && (dist(this.x, this.y, p.x, p.y) < 300 || inBanner(g, this.x, this.y))) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.02 * s.ranks.inspire * dt);
    }

    if ((this.life -= dt) <= 0) return this.expire();
    if (this.kind === 'decoy') return;

    const d = this.def!;
    // Hold the Line: squires guard their owner's War Banner instead of following them.
    const post = this.kind === 'squire' && s.flags.has('holdline') ? bannerOf(g, p) : null;
    const lead = post ?? p;
    // Fight monsters near us that are also near our player (or post); otherwise keep close to them.
    let target: Enemy | null = null, best = d.range ? d.range + 40 : 230;
    for (const e of g.enemies) {
      if (e.dead || (e.def.flying && !d.range && dist(e.x, e.y, lead.x, lead.y) > 200)) continue;
      const dd = dist(this.x, this.y, e.x, e.y);
      if (dd < best && dist(e.x, e.y, lead.x, lead.y) < (post ? post.r + 60 : 420)) { best = dd; target = e; }
    }

    if (!post && dist(this.x, this.y, p.x, p.y) > 650 && !p.dead) {
      // Too far behind: catch up.
      this.x = p.x - 40;
      this.y = p.y + 20;
    }

    let tx: number, ty: number, stop: number;
    if (target) { tx = target.x; ty = target.y; stop = d.range ? d.range * 0.8 : this.r + target.r + 6; }
    else if (post) { const a = this.id * 2.4; tx = post.x + Math.cos(a) * 40; ty = post.y + Math.sin(a) * 40; stop = 12; }
    else { tx = p.x - Math.cos(p.angle) * 45; ty = p.y - Math.sin(p.angle) * 45; stop = 18; }
    const dx = tx - this.x, dy = ty - this.y, dl = Math.hypot(dx, dy);
    if (dl > stop) {
      this.angle = Math.atan2(dy, dx);
      const step = Math.min(dl - stop, d.speed * dt);
      this.x += (dx / dl) * step;
      this.y += (dy / dl) * step;
      this.moving = true;
    }
    if (!d.flying) g.world.collide(this, true);

    if (!target || this.atk > 0) return;
    const td = dist(this.x, this.y, target.x, target.y);
    if (d.range ? td > d.range : td > this.r + target.r + 12) return;
    this.atk = d.atkCd * (s.flags.has('frenzy') ? 0.6 : 1);
    this.angle = Math.atan2(target.y - this.y, target.x - this.x);
    g.events.emit('anim', { id: this.id, anim: 'attack' });
    if (d.range) {
      g.projectiles.push({ id: g.nextId(), kind: 'bolt', team: 'tower', x: this.x, y: this.y - 10,
        vx: Math.cos(this.angle) * 560, vy: Math.sin(this.angle) * 560, r: 6, life: 0.8, dmg: this.damage, pierce: 0,
        hits: new Set(), trail: '#c4a8ff', light: 60, homing: true });
      return;
    }
    damageEnemy(g, target, this.damage, { knock: 80, fromX: this.x, fromY: this.y, color: '#cfe8ff' });
    if (target.dead) return;
    if (s.flags.has('packpoison')) applyDot(target, 5 + g.day, 3, POISON_COLOR);
    if ((this.kind === 'hound' || this.kind === 'spectral') && s.flags.has('alpha')) target.stun = Math.max(target.stun, 0.5);
  }

  hurt(dmg: number): void {
    if (this.dead) return;
    const g = this.g, p = this.owner;
    const f = p.stats.flags, near = !p.dead ? dist(this.x, this.y, p.x, p.y) : Infinity;
    if (f.has('bulwark') && near < 200) dmg *= 1 - 0.15 * p.stats.ranks.bulwark;
    if (f.has('devotion') && near < 250) dmg *= 1 - 0.06 * p.stats.ranks.devotion;
    if (f.has('hostheaven') && near < 300) dmg *= 0.8;
    if (f.has('valor') && inBanner(g, this.x, this.y)) dmg *= 0.8;
    // Martyrdom: the Cleric takes part of the blow.
    if (f.has('martyr') && !p.dead && this.kind !== 'decoy') {
      p.hurt(dmg * 0.3);
      dmg *= 0.7;
    }
    const absorbed = Math.min(this.barrier, dmg);
    this.barrier -= absorbed;
    dmg -= absorbed;
    this.hp -= dmg;
    this.lastHit = g.time;
    g.fx.text(this.x, this.y - 22, String(Math.round(dmg)), '#ff9a9a', 12);
    if (this.hp > 0) return;
    if (this.kind !== 'decoy' && !this.fleeting && guardianSpirit(g, p, this)) return;
    this.dead = true;
    g.events.emit('died', { id: this.id });
    if (this.kind === 'decoy') return this.explodeDecoy();
    if (this.fleeting) return;
    if (p.stats.flags.has('kingshost')) {
      this.respawn = 20;
      g.fx.toast(`Your ${this.def!.name.toLowerCase()} has fallen. It will return to the Hearth.`, p.id);
    } else {
      g.fx.toast(this.summon ? `Your ${this.def!.name.toLowerCase()} has fallen. Another will come at dawn.` : 'Your companion has fallen.', p.id);
    }
  }

  heal(n: number, _silent = true): void {
    if (!this.dead) this.hp = Math.min(this.maxHp, this.hp + n);
  }

  private expire(): void {
    this.dead = true;
    this.g.events.emit('died', { id: this.id });
    if (this.kind === 'decoy') this.explodeDecoy();
  }

  private explodeDecoy(): void {
    explode(this.g, this.x, this.y, 110 * this.owner.stats.aoe, 60, { team: 'player', owner: this.owner.id, color: '#b58cff', knock: 220 });
  }

  private revive(): void {
    const h = this.g.world.hearth;
    this.dead = false;
    this.respawn = -1;
    this.hp = this.maxHp;
    this.x = h.x + 50;
    this.y = h.y + 60;
    this.g.events.emit('vfx', { kind: 'ring', x: this.x, y: this.y, r: 50, color: '#ffe27a', life: 0.5 });
  }
}

/**
 * Guardian Spirit: once per night, saves the first of a Cleric (`p`) and their companions from a
 * killing blow. Returns true if it did.
 */
export function guardianSpirit(g: Game, p: Player, f: { x: number; y: number; hp: number; maxHp: number }): boolean {
  if (!p.stats.flags.has('guardianspirit') || p.nightUsed.has('guardianspirit')) return false;
  p.nightUsed.add('guardianspirit');
  f.hp = f.maxHp * 0.4;
  g.fx.text(f.x, f.y - 34, 'GUARDIAN SPIRIT', '#fff2b0', 16, 1.4);
  g.events.emit('vfx', { kind: 'ring', x: f.x, y: f.y, r: 70, color: '#fff2b0', life: 0.6 });
  return true;
}

/** A player's companions that use a slot (recruits), alive or waiting to return. */
export const recruitCount = (g: Game, p: Player) => g.allies.filter(a => a.kind === 'soldier' && a.owner === p).length;
export const allySlots = (p: Player) => BASE_ALLY_SLOTS + p.stats.allyMax;

/** A player's companions that count for Lone Wolf (decoys and temporary hounds don't). */
export const hasCompanions = (g: Game, p: Player) =>
  g.allies.some(a => a.owner === p && !a.dead && a.kind !== 'decoy' && !a.fleeting);

/** How many of each persistent summon a player's talents grant. */
function wantedSummons(p: Player): Partial<Record<AllyKind, number>> {
  const f = p.stats.flags;
  return {
    squire: (f.has('squire') ? 1 : 0) + (f.has('guard2') ? 1 : 0),
    familiar: f.has('spirit') ? 1 : 0,
    hound: f.has('hound') || f.has('alpha') ? 1 : 0,
  };
}

/**
 * Brings a player's talent summons in line with their talents: adds missing ones (when `restore`,
 * also replacing fallen ones, as at dawn) and dismisses ones whose talent was refunded.
 */
export function syncSummons(g: Game, p: Player, restore: boolean): void {
  const want = wantedSummons(p);
  if (restore) p.fallenSummons = {};
  for (const kind of ['squire', 'familiar', 'hound'] as const) {
    const mine = g.allies.filter(a => a.kind === kind && a.owner === p);
    const n = want[kind] ?? 0;
    for (const a of mine.slice(n)) {
      g.allies.splice(g.allies.indexOf(a), 1);
      g.events.emit('died', { id: a.id });
    }
    // Summons that fell tonight aren't replaced until dawn.
    const have = Math.min(n, mine.length) + (p.fallenSummons[kind] ?? 0);
    for (let i = have; i < n; i++) {
      const a = new Ally(g, p, kind, p.x - 40 + i * 30, p.y + 30);
      g.allies.push(a);
      g.events.emit('vfx', { kind: 'ring', x: a.x, y: a.y, r: 45, color: '#ffe27a', life: 0.5 });
    }
  }
  for (const a of g.allies) if (a.owner === p) a.refresh();
}
