// Basic attacks and class spells, with the talent flags that change them. To add a spell: add its
// id to SpellId in data/types.ts, define it on a class in data/classes.ts, and implement it here.

import type { SpellId } from '../data/types';
import { angleDiff, dist, rand, TAU } from '../core/math';
import { applyDot, BLEED_COLOR, BURN_COLOR, burnMul, dealPlayerDamage, enemiesInRadius, explode, HOLY_COLOR, POISON_COLOR, slowEnemy } from './combat';
import { Ally, allySlots, recruitCount, syncSummons } from './ally';
import { applyHot, friends, healFriend, mostWounded, type Healable } from './heal';
import type { Projectile } from './projectiles';
import { distToBuilding, type Building } from './world';
import type { Game } from './game';
import type { Player } from './player';
import type { SnareMods } from './zones';

type SpellFn = (g: Game, p: Player, tx: number, ty: number) => boolean | void;

function castPoint(p: Player, tx: number, ty: number, max: number) {
  if (dist(p.x, p.y, tx, ty) <= max) return { x: tx, y: ty };
  const a = Math.atan2(ty - p.y, tx - p.x);
  return { x: p.x + Math.cos(a) * max, y: p.y + Math.sin(a) * max };
}

export function basicAttack(g: Game, p: Player): void {
  const b = p.def.basic, s = p.stats, f = s.flags;
  p.swings++;
  if (b.type === 'melee') return cleave(g, p);
  if (b.type === 'smite') return smite(g, p);

  // Arcane Charge: every 5th bolt (every 3rd with Overload) is empowered.
  const every = f.has('overload') ? 3 : f.has('arcanecharge') ? 5 : 0;
  const charged = b.type === 'bolt' && every > 0 && p.swings % every === 0;
  const ruin = b.type === 'arrow' && f.has('ruin') && p.ruinT <= 0;
  if (ruin) p.ruinT = 8;

  const multi = b.type === 'arrow' && f.has('multishot');
  const count = 1 + s.extraProj + (multi ? 2 : 0), spread = 0.14;
  for (let i = 0; i < count; i++) {
    const a = p.angle + (i - (count - 1) / 2) * spread;
    // Multishot's extra arrows are the outermost two.
    const side = multi && (i === 0 || i === count - 1);
    const speed = b.speed! * (f.has('sniper') ? 1.3 : 1);
    const base = { id: g.nextId(), team: 'player' as const, owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      dmg: b.dmg * (side ? 0.6 : 1), pierce: s.pierce, hits: new Set<number>(), harvest: true };
    if (b.type === 'bolt') {
      const pr: Projectile = { ...base, kind: 'bolt', r: 6, life: 0.9, trail: '#9f7bff', light: 70, tag: 'bolt',
        slow: f.has('chill') ? 0.35 : undefined, homing: f.has('homing'),
        dot: f.has('ignite') ? { dps: 5 * burnMul(p), t: 3, color: BURN_COLOR } : undefined };
      if (charged) {
        Object.assign(pr, { dmg: pr.dmg * 2.5, pierce: pr.pierce + 3, r: 10, scale: 1.8, light: 120, trail: '#d0b0ff' });
        if (f.has('overload')) pr.blast = { team: 'player', owner: p.id, r: 60 * s.aoe, dmg: pr.dmg * 0.6, color: '#b58cff', knock: 100, tag: 'bolt' };
      }
      g.projectiles.push(pr);
    } else {
      const pr: Projectile = { ...base, kind: 'arrow', r: 5, life: 0.7 * (f.has('sniper') ? 1.3 : 1), tag: 'arrow',
        bounce: (f.has('ricochet') ? 1 : 0) + (f.has('chainshot') ? 2 : 0),
        dot: f.has('poison') ? { dps: 6 * s.ranks.poison, t: 3, color: POISON_COLOR } : undefined,
        origin: f.has('sniper') ? { x: p.x, y: p.y } : undefined };
      if (ruin && i === Math.floor(count / 2)) {
        Object.assign(pr, { dmg: pr.dmg * 4, pierce: 99, r: 9, scale: 2.2, life: 1, vx: pr.vx * 1.25, vy: pr.vy * 1.25 });
        g.fx.particles(p.x, p.y, 12, '#ffe27a', 120, 0.4, 3);
      }
      g.projectiles.push(pr);
    }
  }
  if (b.type === 'bolt' && f.has('missiles') && Math.random() < 0.15) {
    for (let i = 0; i < 3; i++) {
      const a = p.angle + rand(-0.8, 0.8);
      g.projectiles.push({ id: g.nextId(), kind: 'bolt', team: 'player', owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480,
        r: 4, life: 1, dmg: 7, pierce: 0, hits: new Set(), trail: '#d0b0ff', homing: true, scale: 0.6, tag: 'bolt' });
    }
  }
}

function cleave(g: Game, p: Player): void {
  const b = p.def.basic, s = p.stats, f = s.flags;
  const third = p.swings % 3 === 0, over = third && f.has('overpower');
  const range = b.range! * s.rangeMul * (over ? 1.5 : 1), arc = b.arc! * s.arcMul;
  let dmg = b.dmg * (over ? 1.6 : 1);
  if (p.buffs.revenge) { dmg *= 1.5; delete p.buffs.revenge; }
  let hit = false;
  for (const e of g.enemies) {
    if (e.dead || dist(p.x, p.y, e.x, e.y) > range + e.r) continue;
    if (Math.abs(angleDiff(p.angle, Math.atan2(e.y - p.y, e.x - p.x))) > arc / 2) continue;
    hit = true;
    dealPlayerDamage(g, p, e, dmg, { knock: over ? 260 : 160, fromX: p.x, fromY: p.y, tag: 'cleave' });
    if (f.has('bleed') && !e.dead) applyDot(e, 6 * p.bleedMul, 3, BLEED_COLOR);
  }
  if (hit && f.has('rhythm')) p.cds.charge = Math.max(0, (p.cds.charge || 0) - 0.25 * s.ranks.rhythm);
  if (third && f.has('earthsplitter')) {
    // A long, narrow shockwave in front of the warrior.
    const len = 320 * s.rangeMul;
    for (const e of g.enemies) {
      if (e.dead || dist(p.x, p.y, e.x, e.y) > len + e.r) continue;
      if (Math.abs(angleDiff(p.angle, Math.atan2(e.y - p.y, e.x - p.x))) > 0.22) continue;
      dealPlayerDamage(g, p, e, b.dmg * 1.2, { knock: 200, fromX: p.x, fromY: p.y, tag: 'cleave' });
    }
    g.events.emit('vfx', { kind: 'swing', x: p.x, y: p.y, angle: p.angle, range: len, arc: 0.44 });
    g.fx.shake(4);
  }
  // Harvest the closest node inside the swing.
  let best = null, bd = Infinity;
  for (const n of g.world.nodesNear(p.x, p.y, range + 20)) {
    const d = dist(p.x, p.y, n.x, n.y);
    if (d > range + n.r || Math.abs(angleDiff(p.angle, Math.atan2(n.y - p.y, n.x - p.x))) > arc / 2) continue;
    if (d < bd) { bd = d; best = n; }
  }
  if (best) g.world.harvest(best, b.dmg * s.dmgMul, p);
  g.events.emit('vfx', { kind: 'swing', x: p.x, y: p.y, angle: p.angle, range, arc });
}

function smite(g: Game, p: Player): void {
  const s = p.stats, f = s.flags, ascend = !!p.buffs.ascend;
  const count = 1 + s.extraProj + (ascend ? 2 : 0), spread = ascend ? 0.22 : 0.14;
  const stun = f.has('chastise') && p.swings % 4 === 0 ? 1 : undefined;
  for (let i = 0; i < count; i++) fireSmite(g, p, p.angle + (i - (count - 1) / 2) * spread, { pierce: ascend ? 99 : s.pierce, stun });
}

function fireSmite(g: Game, p: Player, a: number, extra: Partial<Projectile> = {}): void {
  const b = p.def.basic, s = p.stats, f = s.flags;
  g.projectiles.push({ id: g.nextId(), kind: 'holy', team: 'player', owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * b.speed!, vy: Math.sin(a) * b.speed!,
    r: 6, life: 0.85, dmg: b.dmg, pierce: s.pierce, hits: new Set(), harvest: true, trail: '#ffe9a0', light: 80, tag: 'smite',
    dot: f.has('holyfire') ? { dps: 6 * s.ranks.holyfire, t: 3, color: HOLY_COLOR } : undefined,
    blast: f.has('smiteblast') ? { team: 'player', owner: p.id, r: 50 * s.aoe, dmg: b.dmg, color: HOLY_COLOR, knock: 60, tag: 'smite' } : undefined,
    ...extra });
}

// ------------------------------ Right-click abilities -------------------

const BEAM_RANGE = 320;

/** Arcane Beam: every 0.15s, hits everything along a line toward the cursor. */
export function channelBeam(g: Game, p: Player, dt: number): void {
  const s = p.stats, dx = Math.cos(p.angle), dy = Math.sin(p.angle);
  p.altEnd = { x: p.x + dx * BEAM_RANGE, y: p.y + dy * BEAM_RANGE };
  if ((p.altTick -= dt) > 0) return;
  p.altTick = 0.15;
  for (const e of g.enemies) {
    if (e.dead) continue;
    const along = (e.x - p.x) * dx + (e.y - p.y) * dy;
    if (along < 0 || along > BEAM_RANGE + e.r) continue;
    const off = Math.abs((e.x - p.x) * dy - (e.y - p.y) * dx);
    if (off > e.r + 12) continue;
    dealPlayerDamage(g, p, e, 6, { small: true, color: '#d0b0ff', tag: 'beam' });
    if (!e.dead && s.flags.has('chill')) slowEnemy(e, 0.25, 0.4);
  }
}

const MEND_RANGE = 360;

/**
 * Mend picks, in order: the hurt companion or damaged building nearest the cursor, the most
 * wounded companion in range, then the Cleric. Healing done is shown every half second.
 */
export function channelMend(g: Game, p: Player, dt: number, ax: number, ay: number): void {
  const s = p.stats;
  let ally: Healable | null = null, bld: Building | null = null, best = 110;
  for (const f of friends(g)) {
    if (f === p || f.hp >= f.maxHp || dist(f.x, f.y, p.x, p.y) > MEND_RANGE) continue;
    const d = dist(f.x, f.y, ax, ay);
    if (d < best) { best = d; ally = f; }
  }
  for (const b of g.world.buildings) {
    if (b.hp >= b.maxHp || distToBuilding(p, b) > MEND_RANGE) continue;
    const d = distToBuilding({ x: ax, y: ay }, b) + 20;
    if (d < best) { best = d; bld = b; ally = null; }
  }
  if (!ally && !bld) {
    const w = mostWounded(g, p, false);
    if (w && dist(w.x, w.y, p.x, p.y) <= MEND_RANGE) ally = w;
  }

  let healed: number, at: { x: number; y: number };
  if (bld) {
    healed = Math.min(bld.maxHp - bld.hp, 40 * dt);
    bld.hp += healed;
    at = bld;
  } else {
    const t = ally ?? p, amount = (ally ? 22 : 10) * s.healMul * dt;
    healed = Math.min(t.maxHp - t.hp, amount);
    healFriend(g, p, t, amount);
    at = t;
  }
  p.altEnd = at === p ? null : { x: at.x, y: at.y };

  // Pop a "+N" over the target twice a second so the healing is visible.
  p.mendAcc += healed;
  if ((p.altTick -= dt) <= 0) {
    p.altTick = 0.5;
    if (p.mendAcc >= 1) g.fx.text(at.x, at.y - 28, `+${Math.round(p.mendAcc)}`, '#8fff9a', 13);
    p.mendAcc = 0;
  }
  if (Math.random() < 0.5) g.fx.particles(at.x + rand(-10, 10), at.y - 6, 1, '#fff2b0', 40, 0.5, 3);
}

/** Aimed Shot: `k` is how fully the bow was drawn (0..1). */
export function fireAimedShot(g: Game, p: Player, k: number): void {
  const b = p.def.basic, s = p.stats, f = s.flags, a = p.angle;
  g.projectiles.push({ id: g.nextId(), kind: 'arrow', team: 'player', owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * 1150, vy: Math.sin(a) * 1150,
    r: 6 + 3 * k, life: 0.75, dmg: b.dmg * (1 + 3.5 * k), pierce: s.pierce + 1 + Math.round(4 * k), hits: new Set(), harvest: true,
    scale: 1.2 + 0.8 * k, knock: 100 + 300 * k, tag: 'arrow',
    dot: f.has('poison') ? { dps: 6 * s.ranks.poison, t: 3, color: POISON_COLOR } : undefined });
  p.atkTimer = Math.max(p.atkTimer, 0.25);
  if (k >= 1) g.fx.particles(p.x + Math.cos(a) * 20, p.y + Math.sin(a) * 20, 12, '#ffe27a', 160, 0.35, 3);
}

/** A fan of arrows from the player (Volley, Strafe). */
export function fireArrowFan(g: Game, p: Player, angle: number, n: number, spread: number, dmg: number,
  extra: Partial<Projectile> = {}): void {
  for (let i = 0; i < n; i++) {
    const a = angle + (i / (n - 1) - 0.5) * spread;
    g.projectiles.push({ id: g.nextId(), kind: 'arrow', team: 'player', owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * 820, vy: Math.sin(a) * 820,
      r: 5, life: 0.6, dmg, pierce: p.stats.pierce, hits: new Set(), knock: 120, tag: 'volley', ...extra });
  }
}

const SPELLS: Record<SpellId, SpellFn> = {
  // ------------------------------ Mobility ------------------------------
  roll(_g, p) {
    const a = p.moveDir.x || p.moveDir.y ? Math.atan2(p.moveDir.y, p.moveDir.x) : p.angle;
    p.startDash(a, 560, 0.26, 'roll');
  },

  blink(g, p, tx, ty) {
    const s = p.stats, f = s.flags;
    const a = Math.atan2(ty - p.y, tx - p.x);
    for (let d = Math.min(240, dist(p.x, p.y, tx, ty)); d > 10; d -= 10) {
      const nx = p.x + Math.cos(a) * d, ny = p.y + Math.sin(a) * d;
      if (g.world.circleBlocked(nx, ny, p.r, true)) continue;
      const ox = p.x, oy = p.y;
      g.fx.particles(ox, oy, 18, '#9fe7ff', 140, 0.5, 3);
      if (f.has('blinkblast')) explode(g, ox, oy, 90 * s.aoe, 30, { team: 'player', owner: p.id, color: '#b58cff', knock: 200, tag: 'other' });
      if (f.has('decoy')) {
        g.allies.push(new Ally(g, p, 'decoy', ox, oy));
        for (const e of enemiesInRadius(g, ox, oy, 320)) e.taunt = 0;
      }
      if (f.has('blazeblink')) {
        for (let k = 0; k <= d; k += 40) {
          g.zones.push({ id: g.nextId(), owner: p.id, kind: 'field', x: ox + Math.cos(a) * k, y: oy + Math.sin(a) * k, t: 0, r: 34, life: 3,
            tick: 0, dps: 18, burn: 6 * burnMul(p), color: '#ff8a3a' });
        }
      }
      p.x = nx;
      p.y = ny;
      p.invuln = Math.max(p.invuln, f.has('iceblock') ? 1.5 : 0.25);
      if (f.has('iceblock')) {
        p.heal(s.maxHp * 0.15);
        g.events.emit('vfx', { kind: 'ring', x: p.x, y: p.y, r: 30, color: '#d8f4ff', life: 1.2 });
      }
      if (f.has('ward')) {
        p.shield(s.maxHp * 0.15, 5);
        for (const al of g.allies) {
          if (al.dead || al.kind === 'decoy' || al.owner !== p || dist(al.x, al.y, p.x, p.y) > 400) continue;
          al.barrier = Math.max(al.barrier, al.maxHp * 0.15);
          al.barrierT = 5;
        }
      }
      g.fx.particles(p.x, p.y, 18, '#c4a8ff', 140, 0.5, 3);
      g.events.emit('vfx', { kind: 'ring', x: p.x, y: p.y, r: 40, color: '#9fe7ff', life: 0.3 });
      return true;
    }
    return false;
  },

  stride(g, p, tx, ty) {
    p.startDash(Math.atan2(ty - p.y, tx - p.x), 700, 0.24, 'roll');
    if (p.stats.flags.has('divineshield')) p.invuln = Math.max(p.invuln, 2);
    g.fx.particles(p.x, p.y, 14, '#fff2b0', 120, 0.5, 3);
  },

  // ------------------------------ Warrior -------------------------------
  charge(_g, p, tx, ty) {
    const far = p.stats.flags.has('juggernaut');
    p.startDash(Math.atan2(ty - p.y, tx - p.x), 820, far ? 0.48 : 0.32, 'charge', 34, 0.9);
  },

  whirlwind(_g, p) {
    p.whirl = p.stats.flags.has('endless') ? 2.6 : 1.6;
    p.whirlTick = 0;
  },

  battlecry(g, p) {
    const s = p.stats, f = s.flags, r = 190 * s.aoe;
    const heal = 0.3 + 0.1 * (s.ranks.cryheal || 0);
    p.heal(s.maxHp * heal);
    p.buffs.cry = f.has('avatar') ? 12 : 8;
    if (f.has('indomitable')) p.invuln = Math.max(p.invuln, 3);
    for (const e of enemiesInRadius(g, p.x, p.y, r)) dealPlayerDamage(g, p, e, 20, { knock: 520, fromX: p.x, fromY: p.y, tag: 'cry' });
    if (f.has('taunt')) {
      for (const e of enemiesInRadius(g, p.x, p.y, 350)) if (!e.def.guard) e.tauntBy(p, 4);
      g.events.emit('vfx', { kind: 'ring', x: p.x, y: p.y, r: 350, color: '#ff9a5a', life: 0.6 });
    }
    for (const a of g.allies) {
      if (a.dead || a.kind === 'decoy' || dist(a.x, a.y, p.x, p.y) > 500) continue;
      if (f.has('cryheal')) a.heal(a.maxHp * heal);
      if (f.has('sharedcry')) { a.cry = p.buffs.cry; a.heal(a.maxHp * 0.3); }
    }
    if (f.has('banner')) g.zones.push({ id: g.nextId(), owner: p.id, kind: 'banner', x: p.x, y: p.y, t: 0, r: 260, life: 10 });
    if (f.has('rally')) {
      for (const b of g.world.buildings) {
        if (b.hp < b.maxHp && distToBuilding(p, b) < 260) {
          b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.3);
          g.fx.particles(b.x, b.y, 6, '#8fff9a', 80, 0.4, 3);
        }
      }
    }
    g.events.emit('vfx', { kind: 'ring', x: p.x, y: p.y, r, color: '#f2c879', life: 0.5 });
    g.fx.shake(7);
  },

  // ------------------------------ Mage ----------------------------------
  fireball(g, p) {
    const s = p.stats, f = s.flags;
    const pyro = f.has('pyroblast'), fan = f.has('flamefan');
    const power = pyro ? 1.8 : fan ? 0.6 : 1, size = pyro ? 1.4 : fan ? 0.7 : 1, speed = pyro ? 380 : 520;
    const angles = fan ? [-0.25, 0, 0.25] : [0];
    for (const off of angles) {
      const a = p.angle + off;
      g.projectiles.push({
        id: g.nextId(), kind: 'fireball', team: 'player', owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        r: 9 * size, life: 1.2 * (520 / speed), dmg: 42 * power, pierce: 0, hits: new Set(), trail: '#ffb347', light: 130,
        scale: pyro ? 1.6 : fan ? 0.8 : 1,
        blast: { team: 'player', owner: p.id, r: 90 * s.aoe * size, dmg: 42 * power, burn: 10, color: '#ff8a3a', knock: 120, tag: 'fireball',
          slow: f.has('frostfire') ? 0.4 : undefined },
        split: f.has('split_fireball') ? 3 : 0,
      });
    }
  },

  frostnova(g, p) {
    const s = p.stats, f = s.flags, r = 170 * s.aoe * (f.has('wintergrasp') ? 1.4 : 1);
    const freeze = f.has('absolutezero') ? 2 : 1;
    for (const e of enemiesInRadius(g, p.x, p.y, r)) {
      e.freeze = Math.max(e.freeze, ((e.def.boss ? 0.8 : 2) + s.freezeBonus) * freeze);
      if (f.has('wintergrasp') && !e.def.boss) {
        const a = Math.atan2(p.y - e.y, p.x - e.x), k = Math.min(dist(p.x, p.y, e.x, e.y) - e.r - p.r, 120);
        if (k > 0) { e.x += Math.cos(a) * k; e.y += Math.sin(a) * k; }
      }
      dealPlayerDamage(g, p, e, 18, { color: '#a8e0ff', tag: 'nova' });
    }
    const ground = s.ranks.frozenground || 0;
    if (f.has('icefield') || ground) {
      g.zones.push({ id: g.nextId(), owner: p.id, kind: 'icefield', x: p.x, y: p.y, t: 0, r, life: 5 + 3 * ground, dps: ground ? 6 * ground : undefined });
    }
    if (f.has('shards')) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        g.projectiles.push({ id: g.nextId(), kind: 'bolt', team: 'player', owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560,
          r: 6, life: 0.7, dmg: 16, pierce: 1, hits: new Set(), trail: '#d8f4ff', slow: 0.4, tag: 'nova' });
      }
    }
    if (f.has('barrier')) p.shield(s.maxHp * 0.25, 6);
    g.events.emit('vfx', { kind: 'ring', x: p.x, y: p.y, r, color: '#a8e0ff', life: 0.5 });
    g.fx.particles(p.x, p.y, 40, '#d8f4ff', r * 2.5, 0.6, 3);
  },

  meteor(g, p, tx, ty) {
    const s = p.stats, f = s.flags, c = castPoint(p, tx, ty, 600), crater = f.has('crater');
    if (f.has('blizzard')) {
      g.zones.push({ id: g.nextId(), owner: p.id, kind: 'field', x: c.x, y: c.y, t: 0, r: 190 * s.aoe, life: 6, tick: 0, dps: 14,
        slow: 0.5, freezeEvery: 1.5, color: '#d8f4ff' });
      return;
    }
    g.zones.push({ id: g.nextId(), owner: p.id, kind: 'meteor', x: c.x, y: c.y, t: 0, r: 170 * s.aoe, dmg: 160, delay: 0.9, crater });
    const extra = f.has('cataclysm') ? 4 : f.has('twin') ? 2 : 0;
    for (let i = 0; i < extra; i++) {
      const a = extra === 4 ? (i / 4) * TAU + rand(-0.3, 0.3) : rand(0, TAU), d = rand(90, 160);
      g.zones.push({ id: g.nextId(), owner: p.id, kind: 'meteor', x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, t: 0,
        r: 130 * s.aoe, dmg: 110, delay: 1.25 + i * 0.3, crater });
    }
  },

  // ------------------------------ Ranger --------------------------------
  volley(g, p) {
    const s = p.stats, f = s.flags, barrage = f.has('barrage'), explosive = f.has('explosive');
    const fire = () => fireArrowFan(g, p, p.angle, barrage ? 13 : 7, barrage ? 1.2 : 0.9, 14, {
      pierce: explosive ? 0 : s.pierce + (barrage ? 2 : 0),
      mark: f.has('tracer') ? 3 : undefined,
      blast: explosive ? { team: 'player', owner: p.id, r: 45 * s.aoe, dmg: 12, color: '#ffb347', knock: 80, tag: 'volley' } : undefined,
    });
    fire();
    if (f.has('doublevolley')) p.schedule(0.35, fire);
  },

  snare(g, p, tx, ty) {
    const f = p.stats.flags, c = castPoint(p, tx, ty, 320);
    const mods: SnareMods = { big: f.has('bigtrap'), frost: f.has('frosttrap'), explosive: f.has('explotrap') };
    let spots = [c];
    if (f.has('minefield')) {
      spots = [c, ...[0, 1, 2, 3].map(i => ({ x: c.x + Math.cos(i * TAU / 4 + 0.6) * 70, y: c.y + Math.sin(i * TAU / 4 + 0.6) * 70 }))];
    } else if (f.has('multisnare')) {
      spots = [-1, 0, 1].map(k => ({ x: c.x - Math.sin(p.angle) * k * 60, y: c.y + Math.cos(p.angle) * k * 60 }));
    }
    for (const s of spots) g.zones.push({ id: g.nextId(), owner: p.id, kind: 'snare', x: s.x, y: s.y, t: 0, life: 45, mods });
    const traps = g.zones.filter(z => z.kind === 'snare' && !z.done) as { done?: boolean }[];
    const cap = (f.has('minefield') ? 10 : f.has('multisnare') ? 9 : 4) + (f.has('trapmaster') ? 2 : 0);
    for (let i = 0; i < traps.length - cap; i++) traps[i].done = true;
  },

  rain(g, p, tx, ty) {
    const s = p.stats, f = s.flags, c = castPoint(p, tx, ty, 650), long = f.has('longrain'), black = f.has('blackarrow');
    g.zones.push({ id: g.nextId(), owner: p.id, kind: 'rain', x: c.x, y: c.y, t: 0, r: 150 * s.aoe * (long ? 1.3 : 1),
      life: 4 + (long ? 2 : 0) + (black ? 2 : 0), tick: 0, mark: f.has('mark'), poison: black ? 10 : undefined });
    if (f.has('wild')) {
      for (let i = 0; i < 2; i++) {
        const a = new Ally(g, p, 'spectral', p.x + (i ? 30 : -30), p.y + 20);
        g.allies.push(a);
        g.fx.particles(a.x, a.y, 14, '#9fd8ff', 120, 0.5, 3);
      }
    }
  },

  // ------------------------------ Cleric --------------------------------
  holynova(g, p) {
    const s = p.stats, f = s.flags, big = s.ranks.bignova || 0;
    const r = 180 * s.aoe * (1 + 0.2 * big), heal = s.healMul * (1 + 0.25 * big);
    const dmg = 26 * (1 + 0.4 * (s.ranks.wrathnova || 0)), exo = f.has('exorcism');
    for (const e of enemiesInRadius(g, p.x, p.y, r)) {
      dealPlayerDamage(g, p, e, dmg, { knock: exo ? 650 : 260, fromX: p.x, fromY: p.y, color: '#fff2b0', tag: 'nova' });
      if (exo && !e.dead && !e.def.boss) e.stun = Math.max(e.stun, 0.8);
    }
    for (const fr of friends(g)) {
      if (dist(fr.x, fr.y, p.x, p.y) > r) continue;
      healFriend(g, p, fr, fr.maxHp * (fr === p ? 0.15 : 0.25) * heal, fr !== p);
      if (f.has('hot')) applyHot(fr, fr.maxHp * 0.2 * heal, 5);
    }
    for (const b of g.world.buildings) {
      if (b.hp < b.maxHp && distToBuilding(p, b) < r) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.1);
    }
    if (f.has('reckoning')) for (let i = 0; i < 8; i++) fireSmite(g, p, (i / 8) * TAU);
    g.events.emit('vfx', { kind: 'ring', x: p.x, y: p.y, r, color: '#fff2b0', life: 0.5 });
    g.fx.particles(p.x, p.y, 36, '#ffe9a0', r * 2.4, 0.6, 3);
  },

  consecrate(g, p, tx, ty) {
    const s = p.stats, f = s.flags, c = castPoint(p, tx, ty, 420), big = s.ranks.bigconsec || 0, well = f.has('lightwell');
    const r = 130 * s.aoe * (1 + 0.2 * big);
    g.zones.push({ id: g.nextId(), owner: p.id, kind: 'field', x: c.x, y: c.y, t: 0, r, life: 6 + 2 * big + (well ? 4 : 0), tick: 0,
      dps: 12, slow: 0.3, color: HOLY_COLOR, holy: true, sanct: f.has('sanctuary'), heal: 7 * s.healMul * (well ? 2 : 1), repair: 10,
      repairPct: f.has('holyrepair') ? 0.03 : 0, beamT: f.has('heavenbeam') ? 0.3 : undefined });
    if (f.has('judgement')) explode(g, c.x, c.y, r, 40, { team: 'player', owner: p.id, color: '#fff2b0', knock: 150, stun: 1, tag: 'holy' });
    else g.events.emit('vfx', { kind: 'ring', x: c.x, y: c.y, r, color: HOLY_COLOR, life: 0.5 });
  },

  holyward(g, p) {
    const s = p.stats, f = s.flags, r = 380 * s.aoe, long = f.has('longward'), dur = long ? 12 : 8;
    const mul = f.has('sacredbastion') ? 0 : long ? 0.35 : 0.5;
    for (const b of g.world.buildings) {
      if (distToBuilding(p, b) > r) continue;
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.4);
      b.ward = { until: g.time + dur, mul };
    }
    if (f.has('salvation')) {
      // Bring back recruits and summons lost since dawn.
      for (let i = 0; i < p.fallenRecruits && recruitCount(g, p) < allySlots(p); i++) g.allies.push(new Ally(g, p, 'soldier', p.x - 30, p.y + 30));
      p.fallenRecruits = 0;
      p.fallenSummons = {};
      syncSummons(g, p, false);
    }
    const shield = 0.3 * (1 + 0.5 * (s.ranks.aegis || 0));
    for (const fr of friends(g)) {
      if (dist(fr.x, fr.y, p.x, p.y) > r) continue;
      fr.barrier = Math.max(fr.barrier, fr.maxHp * shield);
      fr.barrierT = Math.max(fr.barrierT, dur);
      if (f.has('hymn')) fr.heal(fr.maxHp, fr !== p);
    }
    for (const e of enemiesInRadius(g, p.x, p.y, r)) {
      if (f.has('wardtaunt') && !e.def.guard) e.tauntBy(p, 4);
      if (f.has('judgementday')) {
        dealPlayerDamage(g, p, e, 80, { color: '#fff2b0', tag: 'holy' });
        g.events.emit('vfx', { kind: 'chain', points: [{ x: e.x + 30, y: e.y - 260 }, { x: e.x, y: e.y }], color: '#fff2b0' });
      }
    }
    if (f.has('ascension')) p.buffs.ascend = 10;
    if (f.has('apotheosis')) p.buffs.apo = 8;
    g.events.emit('vfx', { kind: 'ring', x: p.x, y: p.y, r, color: '#fff2b0', life: 0.8 });
    g.fx.shake(6);
  },
};

/** Returns false when the spell couldn't be cast (no cooldown is spent). */
export function castSpell(g: Game, p: Player, id: SpellId, tx: number, ty: number): boolean {
  return SPELLS[id](g, p, tx, ty) !== false;
}
