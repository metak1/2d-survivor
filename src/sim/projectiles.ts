import { FULL_H, WORLD_H, WORLD_W } from '../config';
import { dist, lerp } from '../core/math';
import { applyDot, damageEnemy, dealPlayerDamage, explode, slowEnemy, type ExplodeOpts, type HitTag } from './combat';
import type { Enemy } from './enemy';
import type { Game } from './game';
import { idx, inMap, tileOf } from './world';

export interface Blast extends ExplodeOpts { r: number; dmg: number }

export interface Projectile {
  id: number;
  kind: 'arrow' | 'bolt' | 'holy' | 'fireball' | 'spit' | 'lob' | 'cannon';
  team: 'player' | 'tower' | 'enemy';
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  dmg: number;
  pierce: number;
  hits: Set<number>;
  /** Player shots chop trees and mine rocks they hit. */
  harvest?: boolean;
  knock?: number;
  /** Radius of the light it casts at night. */
  light?: number;
  /** Particle colour left behind while flying. */
  trail?: string;
  /** Draw scale (e.g. ballista bolts). */
  scale?: number;
  /** Explodes on impact (or on landing, for lobs). */
  blast?: Blast;
  /** Bursts into this many small fireballs when it explodes. */
  split?: number;
  /** Slows enemies it hits by this fraction. */
  slow?: number;
  /** Curves toward nearby enemies. */
  homing?: boolean;
  /** Bounces to another enemy this many times. */
  bounce?: number;
  /** Damage over time applied on hit (burn, poison). */
  dot?: { dps: number; t: number; color: string };
  /** Stuns what it hits for this long (Chastise). */
  stun?: number;
  /** Seconds of +25% damage taken applied on hit (Tracer Arrows). */
  mark?: number;
  /** Sniper: where the shot started, for its distance bonus. */
  origin?: { x: number; y: number };
  tag?: HitTag;
  /** For player shots: the id of the player who fired it. */
  owner?: number;
  src?: Enemy;
  /** Lobbed shots fly in an arc from (sx, sy) to (tx, ty) over `dur` seconds; h is the current height. */
  lob?: { sx: number; sy: number; tx: number; ty: number; t: number; dur: number; h: number };
}

export function updateProjectiles(g: Game, dt: number): void {
  const list = g.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const pr = list[i];
    if (pr.lob) {
      const L = pr.lob;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      pr.x = lerp(L.sx, L.tx, k);
      pr.y = lerp(L.sy, L.ty, k);
      L.h = Math.sin(Math.PI * k) * (pr.kind === 'cannon' ? 110 : 70);
      if (pr.kind === 'lob' && Math.random() < 0.5) g.fx.particles(pr.x, pr.y - L.h, 1, '#ffb04a', 30, 0.3, 3);
      if (k >= 1) {
        if (pr.blast) explode(g, pr.x, pr.y, pr.blast.r, pr.blast.dmg, pr.blast);
        list.splice(i, 1);
      }
      continue;
    }

    if (pr.homing) steer(g, pr, dt);
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;
    let dead = pr.life <= 0 || pr.x < 0 || pr.y < 0 || pr.x > WORLD_W || pr.y > FULL_H;
    // Dungeon walls stop shots.
    if (!dead && pr.y >= WORLD_H && g.world.wall[idx(tileOf(pr.x), tileOf(pr.y))]) dead = true;
    if (pr.trail && Math.random() < 0.6) g.fx.particles(pr.x, pr.y, 1, pr.trail, 20, 0.3, pr.r * 0.6);

    if (!dead && pr.team !== 'enemy') dead = hitMonsters(g, pr) || hitNode(g, pr);
    else if (!dead) dead = hitFriendlySide(g, pr);

    if (dead) {
      if (pr.blast && pr.life > 0) burst(g, pr);
      list.splice(i, 1);
    }
  }
}

function burst(g: Game, pr: Projectile): void {
  const b = pr.blast!;
  explode(g, pr.x, pr.y, b.r, b.dmg, b);
  if (!pr.split) return;
  for (let i = 0; i < pr.split; i++) {
    const a = (i / pr.split) * Math.PI * 2 + Math.random() * 0.5;
    g.projectiles.push({
      id: g.nextId(), kind: 'fireball', team: pr.team, owner: pr.owner, x: pr.x, y: pr.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380,
      r: 6, life: 0.35, dmg: b.dmg * 0.4, pierce: 0, hits: new Set(pr.hits), trail: '#ffb347', light: 70, scale: 0.6,
      blast: { ...b, r: b.r * 0.55, dmg: b.dmg * 0.4 },
    });
  }
}

/** Turns a homing shot toward the nearest monster ahead of it. */
function steer(g: Game, pr: Projectile, dt: number): void {
  let best: Enemy | null = null, bd = 260;
  for (const e of g.enemies) {
    if (e.dead || pr.hits.has(e.id)) continue;
    const d = dist(pr.x, pr.y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return;
  const speed = Math.hypot(pr.vx, pr.vy), cur = Math.atan2(pr.vy, pr.vx);
  const want = Math.atan2(best.y - pr.y, best.x - pr.x);
  let diff = want - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = Math.max(-7 * dt, Math.min(7 * dt, diff));
  pr.vx = Math.cos(cur + turn) * speed;
  pr.vy = Math.sin(cur + turn) * speed;
}

function hitMonsters(g: Game, pr: Projectile): boolean {
  for (const e of g.enemies) {
    if (e.dead || pr.hits.has(e.id) || dist(pr.x, pr.y, e.x, e.y) > pr.r + e.r) continue;
    pr.hits.add(e.id);
    if (!pr.blast) {
      const from = { fromX: pr.x - pr.vx, fromY: pr.y - pr.vy };
      const dmg = pr.origin ? pr.dmg * (1 + 0.06 * dist(pr.origin.x, pr.origin.y, pr.x, pr.y) / 100) : pr.dmg;
      if (pr.team === 'player') dealPlayerDamage(g, g.owner(pr.owner), e, dmg, { knock: pr.knock ?? 60, tag: pr.tag, ...from });
      else damageEnemy(g, e, dmg, { knock: 40, color: '#ffe0b0', ...from });
    }
    if (!e.dead) {
      if (pr.slow) slowEnemy(e, pr.slow, 1.5);
      if (pr.dot) applyDot(e, pr.dot.dps, pr.dot.t, pr.dot.color);
      if (pr.mark) e.marked = Math.max(e.marked, pr.mark);
      if (pr.stun && !e.def.boss) e.stun = Math.max(e.stun, pr.stun);
    }
    if (pr.bounce) ricochet(g, pr, e);
    if (pr.pierce-- <= 0) return true;
  }
  return false;
}

function ricochet(g: Game, pr: Projectile, from: Enemy): void {
  let best: Enemy | null = null, bd = 230;
  for (const e of g.enemies) {
    if (e.dead || e === from || pr.hits.has(e.id)) continue;
    const d = dist(from.x, from.y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return;
  const a = Math.atan2(best.y - from.y, best.x - from.x), speed = Math.hypot(pr.vx, pr.vy);
  g.projectiles.push({ ...pr, id: g.nextId(), x: from.x, y: from.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
    life: 0.4, dmg: pr.dmg * 0.7, pierce: 0, bounce: pr.bounce! - 1, hits: new Set(pr.hits), harvest: false });
}

function hitNode(g: Game, pr: Projectile): boolean {
  const tx = tileOf(pr.x), ty = tileOf(pr.y);
  if (!inMap(tx, ty)) return false;
  const n = g.world.node[idx(tx, ty)];
  if (!n || dist(pr.x, pr.y, n.x, n.y) >= n.r + pr.r) return false;
  if (pr.team === 'player' && pr.harvest) g.world.harvest(n, pr.dmg, g.owner(pr.owner));
  return true;
}

function hitFriendlySide(g: Game, pr: Projectile): boolean {
  let dead = false;
  for (const f of [...g.players, ...g.allies]) {
    if (f.dead || dist(pr.x, pr.y, f.x, f.y) >= pr.r + f.r) continue;
    f.hurt(pr.dmg, pr.src);
    dead = true;
    break;
  }
  if (!dead) {
    const tx = tileOf(pr.x), ty = tileOf(pr.y);
    if (inMap(tx, ty)) {
      const b = g.world.bld[idx(tx, ty)];
      if (b && b.def.solid) { g.world.damage(b, pr.dmg); dead = true; }
      else if (g.world.node[idx(tx, ty)]) dead = true;
    }
  }
  if (dead) g.fx.particles(pr.x, pr.y, 6, '#c8e04a', 80, 0.3, 3);
  return dead;
}
