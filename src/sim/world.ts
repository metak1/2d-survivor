// Tile grid holding buildings and resource nodes, plus collision queries and the flow field
// monsters use to reach the Hearth.

import { BUILD_RANGE, FULL_H, GRID_H, MAP_H, MAP_W, TILE, WORLD_W } from '../config';
import { BUILDINGS, HEARTH_LEVELS, ROMAN } from '../data/buildings';
import { NODES, RES_EMOJI } from '../data/enemies';
import type { BuildingDef, BuildingId, Cost, NodeDef, NodeId, TierStats } from '../data/types';
import { MinHeap } from '../core/heap';
import { circleRectOverlap, clamp, dist, hash2 } from '../core/math';
import type { Game } from './game';
import type { Player } from './player';

export const idx = (tx: number, ty: number) => ty * MAP_W + tx;
/** In the grid: the overworld or the dungeon strip below it. */
export const inMap = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < MAP_W && ty < GRID_H;
export const tileOf = (v: number) => Math.floor(v / TILE);
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export interface Circle { x: number; y: number; r: number }

export interface ResourceNode extends Circle {
  id: number;
  type: NodeId;
  def: NodeDef;
  tx: number;
  ty: number;
  amount: number;
  seed: number;
  lastHit: number;
}

export interface Building {
  id: number;
  type: BuildingId;
  def: BuildingDef;
  /** 0 = base; each upgrade adds one. For the Hearth, tier = level - 1. */
  tier: number;
  /** Stats of the current tier (towers, traps, auras and light read from here, not from def). */
  stats: TierStats;
  tx: number;
  ty: number;
  size: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  timer: number;
  angle: number;
  dead: boolean;
  /** Everything spent on it so far, for demolish refunds. */
  paid: Cost;
  lastHit: number;
  /** Holy Ward: damage taken is multiplied by `mul` until game time `until`. */
  ward?: { until: number; mul: number };
}

export interface UpgradeInfo { name: string; cost: Cost; needHearth: number }

export function tierStats(type: BuildingId, tier: number): TierStats {
  const def = BUILDINGS[type];
  if (type === 'hearth') {
    const L = HEARTH_LEVELS[tier];
    return { name: L.name, hp: L.hp, light: L.light };
  }
  if (tier === 0) return { name: def.name, hp: def.hp, light: def.light, tower: def.tower, trap: def.trap, aura: def.aura };
  const t = def.tiers![tier - 1];
  return { name: t.name, hp: t.hp, light: t.light ?? def.light, tower: t.tower ?? def.tower, trap: t.trap ?? def.trap, aura: t.aura ?? def.aura };
}

const addCost = (a: Cost, b: Cost): Cost => {
  const out: Cost = { ...a };
  for (const k of Object.keys(b) as (keyof Cost)[]) out[k] = (out[k] || 0) + b[k]!;
  return out;
};

export class World {
  readonly bld: (Building | null)[] = new Array(MAP_W * GRID_H).fill(null);
  readonly node: (ResourceNode | null)[] = new Array(MAP_W * GRID_H).fill(null);
  /** Solid rock: the dungeon strip, except where interiors are carved out of it. */
  readonly wall = new Uint8Array(MAP_W * GRID_H);
  readonly nodes: ResourceNode[] = [];
  readonly buildings: Building[] = [];
  /** Ground tile variant per cell, chosen by the generator and drawn by the renderer. */
  readonly ground = new Uint8Array(MAP_W * GRID_H);
  // Float64 on purpose: with Float32 rounding, `nd < d[j]` can stay true forever and the search never ends.
  readonly flow = new Float64Array(MAP_W * GRID_H);
  flowDirty = true;
  hearth!: Building;
  /** Bumped whenever buildings or nodes are added or removed (multiplayer resends the lists). */
  version = 0;

  constructor(private g: Game) {}

  changed(): void {
    this.flowDirty = true;
    this.version++;
    this.g.events.emit('worldChanged', undefined);
  }

  // ----------------------------- Nodes ------------------------------------

  trySpawnNode(type: NodeId, fx: number, fy: number, minDist = 6): boolean {
    const tx = Math.floor(fx), ty = Math.floor(fy);
    if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) return false;
    const i = idx(tx, ty);
    if (this.node[i] || this.bld[i]) return false;
    if (Math.hypot(tx + 0.5 - MAP_W / 2, ty + 0.5 - MAP_H / 2) < minDist) return false;
    // Keep dungeon entrances clear.
    if (this.g.dungeons.some(d => Math.hypot(d.x - (tx + 0.5) * TILE, d.y - (ty + 0.5) * TILE) < 2.5 * TILE)) return false;
    const def = NODES[type];
    const n: ResourceNode = {
      id: this.g.nextId(), type, def, tx, ty, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, r: def.r,
      amount: def.amount, seed: hash2(tx * 31, ty * 17), lastHit: -1,
    };
    // Don't bury a player inside a fresh node.
    if (this.g.players.some(p => dist(n.x, n.y, p.x, p.y) < 50)) return false;
    this.nodes.push(n);
    this.node[i] = n;
    this.changed();
    return true;
  }

  removeNode(n: ResourceNode): void {
    const i = this.nodes.indexOf(n);
    if (i >= 0) this.nodes.splice(i, 1);
    this.node[idx(n.tx, n.ty)] = null;
    this.changed();
  }

  /** Each dawn the wilds regrow a bit so the map never runs dry. */
  regrow(): void {
    const cx = MAP_W / 2, cy = MAP_H / 2;
    let trees = 0, rocks = 0, gold = 0, tries = 0;
    while ((trees < 22 || rocks < 9 || gold < 3) && tries++ < 600) {
      const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 28;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      if (trees < 22) { if (this.trySpawnNode('tree', x, y, 10)) trees++; }
      else if (rocks < 9) { if (this.trySpawnNode('rock', x, y, 10)) rocks++; }
      else if (this.trySpawnNode('gold', x, y, 14)) gold++;
    }
  }

  harvest(n: ResourceNode, power: number, by: Player): void {
    const g = this.g, s = by.stats;
    const take = Math.min(n.amount, Math.max(3, Math.round(power / 4.5)));
    const gain = Math.max(1, Math.round(take * s.gather));
    n.amount -= take;
    n.lastHit = g.time;
    g.res[n.def.res] += gain;
    g.stats.gathered += gain;
    g.fx.text(n.x, n.y - 20, `+${gain} ${RES_EMOJI[n.def.res]}`, '#e9f5c9', 13);
    const col = n.type === 'tree' ? '#7a5a34' : n.type === 'rock' ? '#a3a7ad' : '#f3d25a';
    g.fx.particles(n.x, n.y, 5, col, 120, 0.4, 3);
    if (n.amount <= 0) {
      g.fx.particles(n.x, n.y, 16, n.type === 'tree' ? '#3d7a3f' : col, 180, 0.6, 4);
      this.removeNode(n);
    }
  }

  nodesNear(x: number, y: number, r: number): ResourceNode[] {
    const out: ResourceNode[] = [];
    for (let ty = tileOf(y - r); ty <= tileOf(y + r); ty++) {
      for (let tx = tileOf(x - r); tx <= tileOf(x + r); tx++) {
        if (!inMap(tx, ty)) continue;
        const n = this.node[idx(tx, ty)];
        if (n) out.push(n);
      }
    }
    return out;
  }

  // ----------------------------- Buildings --------------------------------

  /** Applies a player's build-cost talents. */
  private scaled(cost: Cost, p: Player | null): Cost {
    const out: Cost = {};
    const mul = p ? Math.max(0.4, p.stats.buildCost) : 1;
    for (const k of Object.keys(cost) as (keyof Cost)[]) out[k] = Math.max(1, Math.round(cost[k]! * mul));
    return out;
  }

  buildCost(type: BuildingId, p: Player): Cost { return this.scaled(BUILDINGS[type].cost, p); }

  placementError(p: Player, type: BuildingId, tx: number, ty: number): string | null {
    const def = BUILDINGS[type], size = def.size || 1;
    if (def.unlock > this.g.hearthLevel) return `Requires Hearth ${ROMAN[def.unlock - 1]}`;
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) return 'Out of bounds';
        const i = idx(x, y);
        if (this.node[i]) return 'Blocked';
        if (this.bld[i]) return 'Occupied';
      }
    }
    const px = (tx + size / 2) * TILE, py = (ty + size / 2) * TILE;
    if (dist(px, py, p.x, p.y) > BUILD_RANGE) return 'Too far';
    if (def.solid) {
      const rx = tx * TILE, ry = ty * TILE, rw = size * TILE;
      const overlaps = (e: Circle) => circleRectOverlap(e.x, e.y, e.r, rx, ry, rw, rw);
      if (this.g.players.some(q => !q.dead && overlaps(q))) return 'Blocked';
      if (this.g.enemies.some(overlaps)) return 'Blocked';
    }
    if (!this.g.canAfford(this.buildCost(type, p))) return 'Not enough resources';
    return null;
  }

  /** Max health of a building, with the builder's wall and tower talents. */
  private maxHpFor(b: Building, p: Player | null): number {
    if (!p) return b.stats.hp;
    return Math.round(b.stats.hp * (b.def.wall ? p.stats.wallHp : 1) * (b.stats.tower ? p.stats.towerHp : 1));
  }

  /** Places a building; `builder` pays and their talents apply (null: placed for free, e.g. the Hearth). */
  place(type: BuildingId, tx: number, ty: number, builder: Player | null): Building {
    const free = !builder;
    const g = this.g, def = BUILDINGS[type], size = def.size || 1;
    const b: Building = {
      id: g.nextId(), type, def, tier: 0, stats: tierStats(type, 0), tx, ty, size, x: (tx + size / 2) * TILE, y: (ty + size / 2) * TILE,
      hp: 0, maxHp: 0, timer: Math.random() * 0.5, angle: -Math.PI / 2, dead: false,
      paid: builder ? this.buildCost(type, builder) : {}, lastHit: -1,
    };
    b.hp = b.maxHp = this.maxHpFor(b, builder);
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) this.bld[idx(x, y)] = b;
    this.buildings.push(b);
    if (!free) {
      g.pay(b.paid);
      g.stats.built++;
      g.fx.particles(b.x, b.y, 10, '#d8c49a', 110, 0.4, 3);
    }
    this.changed();
    return b;
  }

  damage(b: Building, dmg: number): void {
    if (b.dead) return;
    for (const p of this.g.players) {
      if (p.stats.flags.has('bulwark') && !p.dead && distToBuilding(p, b) < 200) { dmg *= 1 - 0.15 * p.stats.ranks.bulwark; break; }
    }
    if (b.ward && b.ward.until > this.g.time) dmg *= b.ward.mul;
    b.hp -= dmg;
    b.lastHit = this.g.time;
    if (b.hp <= 0) this.destroy(b);
  }

  destroy(b: Building, silent = false): void {
    if (b.dead) return;
    b.dead = true;
    for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) this.bld[idx(x, y)] = null;
    const i = this.buildings.indexOf(b);
    if (i >= 0) this.buildings.splice(i, 1);
    if (!silent) {
      this.g.fx.particles(b.x, b.y, 22, b.def.wall && b.tier === 0 ? '#8b5a2b' : '#9a9a9a', 200, 0.7, 4);
      this.g.fx.shake(b.type === 'hearth' ? 20 : 3);
    }
    this.changed();
    if (b.type === 'hearth') this.g.endGame();
  }

  /** The next upgrade for a building at `p`'s prices, or null when it's maxed. */
  nextUpgrade(b: Building, p: Player): UpgradeInfo | null {
    if (b.type === 'hearth') {
      const L = HEARTH_LEVELS[b.tier + 1];
      return L ? { name: L.name, cost: this.scaled(L.cost, p), needHearth: 0 } : null;
    }
    const t = b.def.tiers?.[b.tier];
    return t ? { name: t.name, cost: this.scaled(t.cost, p), needHearth: t.hearth } : null;
  }

  upgradeError(p: Player, b: Building): string | null {
    const up = this.nextUpgrade(b, p);
    if (!up) return 'Fully upgraded';
    if (up.needHearth > this.g.hearthLevel) return `Requires Hearth ${ROMAN[up.needHearth - 1]}`;
    if (!this.g.canAfford(up.cost)) return 'Not enough resources';
    return null;
  }

  upgrade(p: Player, b: Building): boolean {
    const up = this.nextUpgrade(b, p);
    if (!up || this.upgradeError(p, b)) return false;
    const g = this.g;
    g.pay(up.cost);
    b.paid = addCost(b.paid, up.cost);
    b.tier++;
    b.stats = tierStats(b.type, b.tier);
    const oldMax = b.maxHp;
    b.maxHp = this.maxHpFor(b, p);
    b.hp = Math.min(b.maxHp, b.hp + (b.maxHp - oldMax));
    if (b.type === 'hearth') {
      g.hearthLevel = b.tier + 1;
      g.events.emit('banner', { title: `Hearth ${ROMAN[b.tier]}`, sub: `${b.stats.name}: ${HEARTH_LEVELS[b.tier].desc}` });
    }
    g.fx.text(b.x, b.y - 24, `${b.stats.name}!`, '#ffe27a', 15);
    g.fx.particles(b.x, b.y, 24, '#ffe27a', 160, 0.6, 3);
    g.events.emit('vfx', { kind: 'ring', x: b.x, y: b.y, r: 40 * b.size, color: '#ffe27a', life: 0.5 });
    this.changed();
    return true;
  }

  repairCost(b: Building): Cost {
    const missing = 1 - b.hp / b.maxHp;
    const base = (b.paid.wood || 0) + (b.paid.stone || 0) * 0.8 + 6;
    return { wood: Math.max(1, Math.ceil(base * missing * 0.4)) };
  }

  demolishRefund(b: Building): Cost {
    const frac = 0.5 * (b.hp / b.maxHp), out: Cost = {};
    for (const k of Object.keys(b.paid) as (keyof Cost)[]) {
      const v = Math.floor(b.paid[k]! * frac);
      if (v > 0) out[k] = v;
    }
    return out;
  }

  buildingAt(tx: number, ty: number): Building | null {
    return inMap(tx, ty) ? this.bld[idx(tx, ty)] : null;
  }

  buildingById(id: number): Building | undefined {
    return this.buildings.find(b => b.id === id);
  }

  /** Bit mask of neighbouring wall tiles (1 = north, 2 = east, 4 = south, 8 = west) for joined-up wall art. */
  wallMask(b: Building): number {
    const at = (dx: number, dy: number) => {
      const o = this.buildingAt(b.tx + dx, b.ty + dy);
      return !!o && !!o.def.wall;
    };
    return (at(0, -1) ? 1 : 0) | (at(1, 0) ? 2 : 0) | (at(0, 1) ? 4 : 0) | (at(-1, 0) ? 8 : 0);
  }

  /** Clears resource nodes in a radius (tiles) around a point, e.g. to make room for a camp. */
  clearNodes(tx: number, ty: number, radius: number): void {
    for (const n of [...this.nodes]) if (Math.hypot(n.tx - tx, n.ty - ty) <= radius) this.removeNode(n);
  }

  // ----------------------------- Flow field -------------------------------
  // Dijkstra from the Hearth outward. Buildings are passable but expensive, so monsters walk
  // around defenses when there's a reasonable detour and smash through when there isn't.

  blocked(tx: number, ty: number): boolean {
    if (!inMap(tx, ty)) return true;
    const i = idx(tx, ty), b = this.bld[i];
    return !!this.wall[i] || !!this.node[i] || !!(b && b.def.solid);
  }

  computeFlow(): void {
    const d = this.flow, h = this.hearth;
    d.fill(Infinity);
    const heap = new MinHeap();
    for (let y = h.ty; y < h.ty + h.size; y++) for (let x = h.tx; x < h.tx + h.size; x++) {
      d[idx(x, y)] = 0;
      heap.push(0, idx(x, y));
    }
    while (heap.size) {
      const i = heap.pop(), di = heap.lastKey;
      if (di > d[i]) continue;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx, ny = y + dy;
        if (!inMap(nx, ny)) continue;
        const j = idx(nx, ny);
        if (this.node[j] || this.wall[j]) continue;
        const diag = dx !== 0 && dy !== 0;
        if (diag && (this.blocked(x + dx, y) || this.blocked(x, y + dy))) continue;
        let c = diag ? 1.4142 : 1;
        const b = this.bld[j];
        if (b && b.def.solid && b !== h) c += 3 + b.hp / 30;
        const nd = di + c;
        if (nd < d[j]) { d[j] = nd; heap.push(nd, j); }
      }
    }
    this.flowDirty = false;
  }

  /** Where a monster at (x, y) should step next, and the building occupying that tile, if any. */
  flowStep(x: number, y: number): { x: number; y: number; bld: Building | null } {
    const h = this.hearth, tx = tileOf(x), ty = tileOf(y);
    if (!inMap(tx, ty)) return { x: h.x, y: h.y, bld: null };
    let best = this.flow[idx(tx, ty)], bx = -1, by = -1;
    for (const [dx, dy] of DIRS8) {
      const nx = tx + dx, ny = ty + dy;
      if (!inMap(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (this.blocked(tx + dx, ty) || this.blocked(tx, ty + dy))) continue;
      const v = this.flow[idx(nx, ny)];
      if (v < best) { best = v; bx = nx; by = ny; }
    }
    if (bx < 0) return { x: h.x, y: h.y, bld: null };
    const b = this.bld[idx(bx, by)];
    return { x: (bx + 0.5) * TILE, y: (by + 0.5) * TILE, bld: b && b.def.solid ? b : null };
  }

  // ----------------------------- Collision --------------------------------

  private solidFor(b: Building | null, isPlayer: boolean): b is Building {
    return !!b && b.def.solid && !(isPlayer && b.def.gate);
  }

  /** Pushes a circle out of nodes and solid buildings. Returns the building it bumped into, if any. */
  collide(e: Circle, isPlayer: boolean): Building | null {
    let hit: Building | null = null;
    for (let ty = tileOf(e.y - e.r); ty <= tileOf(e.y + e.r); ty++) {
      for (let tx = tileOf(e.x - e.r); tx <= tileOf(e.x + e.r); tx++) {
        if (!inMap(tx, ty)) continue;
        const i = idx(tx, ty), n = this.node[i];
        if (this.wall[i]) { resolveCircleRect(e, tx * TILE, ty * TILE, TILE, TILE); continue; }
        if (n) {
          const dx = e.x - n.x, dy = e.y - n.y, d = Math.hypot(dx, dy), rr = e.r + n.r;
          if (d < rr && d > 1e-3) { e.x = n.x + (dx / d) * rr; e.y = n.y + (dy / d) * rr; }
          continue;
        }
        const b = this.bld[i];
        if (this.solidFor(b, isPlayer) && resolveCircleRect(e, tx * TILE, ty * TILE, TILE, TILE)) hit = b;
      }
    }
    e.x = clamp(e.x, e.r, WORLD_W - e.r);
    e.y = clamp(e.y, e.r, FULL_H - e.r);
    return hit;
  }

  circleBlocked(x: number, y: number, r: number, isPlayer: boolean): boolean {
    if (x < r || y < r || x > WORLD_W - r || y > FULL_H - r) return true;
    for (let ty = tileOf(y - r); ty <= tileOf(y + r); ty++) {
      for (let tx = tileOf(x - r); tx <= tileOf(x + r); tx++) {
        if (!inMap(tx, ty)) return true;
        const i = idx(tx, ty), n = this.node[i];
        if (this.wall[i] && circleRectOverlap(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) return true;
        if (n && dist(x, y, n.x, n.y) < r + n.r) return true;
        if (this.solidFor(this.bld[i], isPlayer) && circleRectOverlap(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) return true;
      }
    }
    return false;
  }
}

export function distToBuilding(e: { x: number; y: number }, b: Building): number {
  const rx = b.tx * TILE, ry = b.ty * TILE, rw = b.size * TILE;
  return Math.hypot(e.x - clamp(e.x, rx, rx + rw), e.y - clamp(e.y, ry, ry + rw));
}

function resolveCircleRect(e: Circle, rx: number, ry: number, rw: number, rh: number): boolean {
  const px = clamp(e.x, rx, rx + rw), py = clamp(e.y, ry, ry + rh);
  const dx = e.x - px, dy = e.y - py, d2 = dx * dx + dy * dy;
  if (d2 >= e.r * e.r) return false;
  if (d2 > 1e-4) {
    const d = Math.sqrt(d2), push = e.r - d;
    e.x += (dx / d) * push;
    e.y += (dy / d) * push;
  } else {
    // Centre is inside the rect: push out along the shortest axis.
    const l = e.x - rx, r = rx + rw - e.x, t = e.y - ry, b = ry + rh - e.y, m = Math.min(l, r, t, b);
    if (m === l) e.x = rx - e.r; else if (m === r) e.x = rx + rw + e.r;
    else if (m === t) e.y = ry - e.r; else e.y = ry + rh + e.r;
  }
  return true;
}
