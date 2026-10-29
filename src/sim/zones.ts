// Lingering area effects created by spells and bosses. Plain data so the renderer can draw them
// by `kind` and they could be saved or sent over the network later.

import { dist, rand, TAU } from '../core/math';
import { applyDot, dealPlayerDamage, enemiesInRadius, explode, POISON_COLOR, slowEnemy } from './combat';
import type { Enemy } from './enemy';
import type { Game } from './game';
import { friends, healFriend } from './heal';
import { distToBuilding } from './world';

/** `owner`: id of the player whose spell made it (their talents and damage apply). */
interface ZoneBase { id: number; x: number; y: number; t: number; owner?: number }

/** What a Venom Snare does when triggered (set by talents when it's placed). */
export interface SnareMods { big: boolean; frost: boolean; explosive: boolean }

export type Zone =
  | ZoneBase & { kind: 'meteor'; r: number; dmg: number; delay: number; crater?: boolean }
  | ZoneBase & { kind: 'snare'; life: number; mods: SnareMods; done?: boolean }
  | ZoneBase & { kind: 'cloud'; r: number; life: number; tick: number; dps: number; slow?: number; poison?: number }
  | ZoneBase & { kind: 'rain'; r: number; life: number; tick: number; mark: boolean; poison?: number }
  | ZoneBase & { kind: 'icefield'; r: number; life: number; dps?: number; tick?: number }
  /** Burning or freezing ground (fire trails, craters, Blizzard). */
  | ZoneBase & { kind: 'field'; r: number; life: number; tick: number; dps: number; color: string;
      burn?: number; slow?: number; freezeEvery?: number; freezeT?: number;
      /** Consecration: heals friends (HP/s) and repairs buildings (HP/s, plus a share of max HP/s). */
      holy?: boolean; heal?: number; repair?: number; repairPct?: number;
      /** Sanctuary: monsters inside deal less damage. */
      sanct?: boolean;
      /** Wrath of Heaven: seconds until the next beam. */
      beamT?: number }
  | ZoneBase & { kind: 'banner'; r: number; life: number }
  | ZoneBase & { kind: 'telegraph'; r: number; life: number; follow: Enemy; color: string }
  /** A boss's delayed blast on the ground (Flame Golem's fire rain): hurts friends and buildings. */
  | ZoneBase & { kind: 'hazard'; r: number; life: number; dmg: number; color: string };

const ownerOf = (g: Game, z: Zone) => g.owner(z.owner);

/** Advances a zone; returns false when it should be removed. */
export function updateZone(g: Game, z: Zone, dt: number): boolean {
  z.t += dt;
  switch (z.kind) {
    case 'meteor':
      if (z.t < z.delay) return true;
      explode(g, z.x, z.y, z.r, z.dmg, { team: 'player', owner: z.owner, burn: 12, color: '#ff6a2a', knock: 260, tag: 'meteor' });
      g.fx.shake(14);
      g.events.emit('vfx', { kind: 'scorch', x: z.x, y: z.y, r: z.r * 0.8 });
      if (z.crater) {
        g.zones.push({ id: g.nextId(), owner: z.owner, kind: 'field', x: z.x, y: z.y, t: 0, r: z.r * 0.7, life: 5, tick: 0, dps: 14, burn: 8, color: '#ff6a2a' });
      }
      return false;

    case 'snare': {
      if (z.done || z.t > z.life) return false;
      const trigger = g.enemies.find(e => !e.dead && !e.def.flying && dist(z.x, z.y, e.x, e.y) <= e.r + 18);
      if (!trigger) return true;
      z.done = true;
      triggerSnare(g, z);
      return false;
    }

    case 'cloud':
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = 0.5;
        for (const e of enemiesInRadius(g, z.x, z.y, z.r)) {
          dealPlayerDamage(g, ownerOf(g, z), e, z.dps * 0.5, { noCrit: true, color: POISON_COLOR, small: true, tag: 'trap' });
          if (e.dead) continue;
          if (z.slow) slowEnemy(e, z.slow, 0.7);
          if (z.poison) applyDot(e, z.poison, 3, POISON_COLOR);
        }
      }
      if (Math.random() < 0.5) {
        const a = rand(0, TAU), d = rand(0, z.r);
        g.fx.particles(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 1, z.slow ? 'rgba(170,220,255,0.6)' : 'rgba(140,210,80,0.6)', 15, 1, 8);
      }
      return z.t < z.life;

    case 'rain':
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = 0.15;
        for (const e of enemiesInRadius(g, z.x, z.y, z.r)) {
          if (z.mark) e.marked = 3;
          dealPlayerDamage(g, ownerOf(g, z), e, 5, { small: true, tag: 'rain' });
          if (z.poison && !e.dead) applyDot(e, z.poison, 3, POISON_COLOR);
        }
      }
      return z.t < z.life;

    case 'icefield':
      for (const e of enemiesInRadius(g, z.x, z.y, z.r)) if (!e.def.flying) slowEnemy(e, 0.5, 0.3);
      if (z.dps) {
        z.tick = (z.tick ?? 0) - dt;
        if (z.tick <= 0) {
          z.tick = 0.5;
          for (const e of enemiesInRadius(g, z.x, z.y, z.r)) if (!e.def.flying) dealPlayerDamage(g, ownerOf(g, z), e, z.dps * 0.5, { noCrit: true, color: '#bfe9ff', small: true, tag: 'nova' });
        }
      }
      return z.t < z.life;

    case 'field': {
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = 0.5;
        for (const e of enemiesInRadius(g, z.x, z.y, z.r)) {
          if (z.dps) dealPlayerDamage(g, ownerOf(g, z), e, z.dps * 0.5, { noCrit: true, color: z.color, small: true, tag: 'other' });
          if (e.dead) continue;
          if (z.burn) applyDot(e, z.burn, 2, '#ff8a3a');
          if (z.slow) slowEnemy(e, z.slow, 0.7);
        }
      }
      if (z.freezeEvery) {
        z.freezeT = (z.freezeT ?? z.freezeEvery) - dt;
        if (z.freezeT <= 0) {
          z.freezeT = z.freezeEvery;
          for (const e of enemiesInRadius(g, z.x, z.y, z.r)) e.freeze = Math.max(e.freeze, e.def.boss ? 0.3 : 0.8);
          g.events.emit('vfx', { kind: 'ring', x: z.x, y: z.y, r: z.r, color: '#d8f4ff', life: 0.4 });
        }
      }
      if (z.holy) updateHoly(g, z, dt);
      if (Math.random() < z.r / 120) {
        const a = rand(0, TAU), d = rand(0, z.r);
        g.fx.particles(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 1, z.color, 30, 0.6, 3);
      }
      return z.t < z.life;
    }

    case 'banner':
      return z.t < z.life;

    case 'telegraph':
      z.x = z.follow.x;
      z.y = z.follow.y;
      return z.t < z.life && !z.follow.dead;

    case 'hazard':
      if (z.t < z.life) return true;
      for (const f of [...g.players, ...g.allies]) if (!f.dead && dist(z.x, z.y, f.x, f.y) < z.r + f.r) f.hurt(z.dmg);
      for (const b of [...g.world.buildings]) if (distToBuilding(z, b) < z.r) g.world.damage(b, b.type === 'hearth' ? z.dmg * 0.3 : z.dmg);
      g.events.emit('vfx', { kind: 'blast', x: z.x, y: z.y, r: z.r, color: z.color });
      g.events.emit('vfx', { kind: 'scorch', x: z.x, y: z.y, r: z.r * 0.7 });
      g.fx.particles(z.x, z.y, 16, z.color, 160, 0.5, 4);
      g.fx.shake(4);
      return false;
  }
}

function updateHoly(g: Game, z: Zone & { kind: 'field' }, dt: number): void {
  if (z.heal) for (const f of friends(g)) if (dist(z.x, z.y, f.x, f.y) < z.r) healFriend(g, ownerOf(g, z), f, z.heal * dt);
  if (z.repair) {
    for (const b of g.world.buildings) {
      if (b.hp >= b.maxHp || distToBuilding(z, b) > z.r) continue;
      b.hp = Math.min(b.maxHp, b.hp + (z.repair + b.maxHp * (z.repairPct ?? 0)) * dt);
    }
  }
  if (z.beamT === undefined) return;
  z.beamT -= dt;
  if (z.beamT > 0) return;
  z.beamT = 0.5;
  const inside = enemiesInRadius(g, z.x, z.y, z.r);
  if (!inside.length) return;
  const e = inside[Math.floor(Math.random() * inside.length)];
  dealPlayerDamage(g, ownerOf(g, z), e, 30, { color: '#fff2b0', tag: 'holy' });
  g.events.emit('vfx', { kind: 'chain', points: [{ x: e.x + 30, y: e.y - 260 }, { x: e.x, y: e.y }], color: '#fff2b0' });
}

function triggerSnare(g: Game, z: Zone & { kind: 'snare' }): void {
  const s = ownerOf(g, z).stats, m = z.mods;
  for (const o of enemiesInRadius(g, z.x, z.y, 80)) {
    o.root = Math.max(o.root, o.def.boss ? 0.6 : 1.8);
    if (m.frost) o.freeze = Math.max(o.freeze, o.def.boss ? 0.5 : 1.5);
  }
  if (m.explosive) explode(g, z.x, z.y, 110 * s.aoe, 70, { team: 'player', owner: z.owner, color: '#ffb347', knock: 200, tag: 'trap' });
  const viru = s.ranks.virulence || 0;
  g.zones.push({ id: g.nextId(), owner: z.owner, kind: 'cloud', x: z.x, y: z.y, t: 0, r: m.big ? 135 : 90, life: m.big ? 8 : 4, tick: 0,
    dps: 16 * (1 + 0.4 * viru), slow: m.frost ? 0.5 : undefined, poison: viru ? 6 * viru : undefined });
  g.fx.particles(z.x, z.y, 20, m.frost ? '#bfe9ff' : '#9be35b', 150, 0.6, 4);
}
