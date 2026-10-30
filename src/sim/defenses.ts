// Per-step behaviour of placed buildings: towers shoot, traps bite, shrines heal, the Hearth
// mends by day and (at higher levels) scorches monsters that touch it.

import { TILE } from '../config';
import { HEARTH_LEVELS } from '../data/buildings';
import { circleRectOverlap, dist } from '../core/math';
import { damageEnemy, enemiesInRadius, inBanner, slowEnemy } from './combat';
import type { Enemy } from './enemy';
import type { Game } from './game';
import { distToBuilding, type Building } from './world';

export function updateDefenses(g: Game, dt: number): void {
  const team = g.team, w = g.world;
  // Field Repairs works around each player who has it.
  const repairers = g.players.filter(p => !p.dead && (p.stats.flags.has('fieldrepair') || p.stats.flags.has('mender')));

  for (const b of [...w.buildings]) {
    if (b.dead) continue;
    const st = b.stats;

    if (b.type === 'hearth') updateHearth(g, b, dt);
    for (const p of repairers) {
      const mender = p.stats.flags.has('mender');
      if (b.hp < b.maxHp && distToBuilding(p, b) < (mender ? 260 : 100)) b.hp = Math.min(b.maxHp, b.hp + (mender ? 24 : 12) * dt);
    }

    if (st.tower) {
      b.timer -= dt * team.towerSpeed;
      const target = nearestEnemy(g, b, st.tower.range * team.towerRange);
      if (target) b.angle = Math.atan2(target.y - b.y, target.x - b.x);
      if (target && b.timer <= 0) {
        b.timer = st.tower.cd;
        fireTower(g, b, target);
      }
    }

    if (st.trap) {
      b.timer -= dt;
      let any = false;
      for (const e of g.enemies) {
        if (e.dead || e.def.flying || !circleRectOverlap(e.x, e.y, e.r, b.tx * TILE, b.ty * TILE, TILE, TILE)) continue;
        any = true;
        slowEnemy(e, st.trap.slow, 0.2);
        if (b.timer <= 0) damageEnemy(g, e, st.trap.dmg * team.towerDmg, { color: '#d0d0d0', small: true });
      }
      if (any && b.timer <= 0) { b.timer = st.trap.cd; w.damage(b, 3); }
    }

    if (st.aura) {
      for (const p of g.players) if (!p.dead && dist(b.x, b.y, p.x, p.y) < st.aura.r) p.heal(st.aura.heal * dt, true);
      for (const a of g.allies) if (!a.dead && dist(b.x, b.y, a.x, a.y) < st.aura.r) a.hp = Math.min(a.maxHp, a.hp + st.aura.heal * dt);
      for (const o of w.buildings) {
        if (o !== b && o.hp < o.maxHp && distToBuilding(b, o) < st.aura.r) o.hp = Math.min(o.maxHp, o.hp + st.aura.repair * dt);
      }
    }
  }
}

function nearestEnemy(g: Game, b: Building, range: number): Enemy | null {
  let target: Enemy | null = null, best = range;
  for (const e of g.enemies) {
    if (e.dead) continue;
    const d = dist(b.x, b.y, e.x, e.y);
    if (d < best) { best = d; target = e; }
  }
  return target;
}

function fireTower(g: Game, b: Building, target: Enemy): void {
  const s = g.team, t = b.stats.tower!;
  const dmg = t.dmg * s.towerDmg * (inBanner(g, b.x, b.y) ? 1.25 : 1);
  // Rime Towers: every tower attack slows.
  const rime = s.flags.has('rime') ? 0.25 : 0;
  switch (t.kind) {
    case 'arrow': {
      const d = dist(b.x, b.y, target.x, target.y), heavy = (t.pierce ?? 0) > 0;
      g.projectiles.push({ id: g.nextId(), kind: 'arrow', team: 'tower', x: b.x, y: b.y,
        vx: Math.cos(b.angle) * 900, vy: Math.sin(b.angle) * 900, r: heavy ? 7 : 5, life: d / 900 + (heavy ? 0.5 : 0.3),
        dmg, pierce: t.pierce ?? 0, hits: new Set(), scale: heavy ? 1.6 : 1,
        slow: rime || undefined, bounce: s.flags.has('towerrico') ? 1 : 0 });
      break;
    }
    case 'lob':
      g.projectiles.push({ id: g.nextId(), kind: 'lob', team: 'tower', x: b.x, y: b.y, vx: 0, vy: 0, r: 7, life: 1, dmg,
        pierce: 0, hits: new Set(), light: 70,
        lob: { sx: b.x, sy: b.y - 14, tx: target.x, ty: target.y, t: 0, dur: 0.75, h: 0 },
        blast: { team: 'tower', r: t.splash!, dmg, burn: t.burn, slow: rime || undefined } });
      break;
    case 'pulse':
      for (const e of enemiesInRadius(g, b.x, b.y, t.range * s.towerRange)) {
        damageEnemy(g, e, dmg, { color: '#bfe9ff', small: true });
        if (!e.dead) slowEnemy(e, t.slow ?? 0.5, 1.8);
      }
      g.events.emit('vfx', { kind: 'ring', x: b.x, y: b.y, r: t.range * s.towerRange, color: '#a8e0ff', life: 0.45 });
      break;
    case 'chain': {
      const points = [{ x: b.x, y: b.y - 16 }], hit = new Set<number>();
      let cur: Enemy | null = target, power = dmg;
      for (let j = 0; cur && j <= (t.jumps ?? 0); j++) {
        hit.add(cur.id);
        points.push({ x: cur.x, y: cur.y });
        damageEnemy(g, cur, power, { color: '#d9f0ff' });
        if (rime && !cur.dead) slowEnemy(cur, rime, 1.5);
        power *= 0.85;
        const from: Enemy = cur;
        cur = null;
        let bd = 150;
        for (const e of g.enemies) {
          if (e.dead || hit.has(e.id)) continue;
          const d = dist(from.x, from.y, e.x, e.y);
          if (d < bd) { bd = d; cur = e; }
        }
      }
      g.events.emit('vfx', { kind: 'chain', points, color: '#bfe4ff' });
      break;
    }
  }
}

function updateHearth(g: Game, h: Building, dt: number): void {
  const keeper = g.team.flags.has('hearthkeeper');
  const mend = g.phase === 'day' ? (keeper ? 16 : 8) : keeper ? 8 : 0;
  h.hp = Math.min(h.maxHp, h.hp + mend * dt);
  const burn = HEARTH_LEVELS[h.tier].burn;
  if (!burn) return;
  h.timer -= dt;
  if (h.timer > 0) return;
  h.timer = 0.5;
  for (const e of g.enemies) {
    if (!e.dead && distToBuilding(e, h) < e.r + 14) damageEnemy(g, e, burn * 0.5, { color: '#ffb04a', small: true });
  }
}
