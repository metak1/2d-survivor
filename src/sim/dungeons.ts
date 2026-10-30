// Dungeons: entrances out in the wilds lead to interiors carved into the walled-off strip below
// the map (see config DUNGEON_ROWS). Layouts come from the world seed, so an online client builds
// the same rooms; only each dungeon's state travels in snapshots. Inside wait packs of monsters
// and a boss whose death reveals a legendary to craft at the forge (see forge.ts) and drops shards.
//
// Dungeons stay open at night: staying in (or going in) means trusting the base to hold without
// you. Players inside are told when night falls and when the Hearth is in trouble.

import { DUNGEON_GAP, DUNGEON_ROWS, MAP_H, MAP_W, TILE, WORLD_H } from '../config';
import { DUNGEON_ORDER, DUNGEON_REOPEN, DUNGEONS, type DungeonTheme } from '../data/dungeons';
import { ENEMIES } from '../data/enemies';
import type { EnemyId } from '../data/types';
import { dist, mulberry32, rand, TAU } from '../core/math';
import { Enemy } from './enemy';
import type { Game } from './game';
import { dropLoot, makeItem, rollRarity } from './items';
import { bossReward } from './forge';
import { FORGE } from '../data/items';
import type { Player } from './player';
import { GROUND } from './worldgen';
import { idx } from './world';

interface Pt { x: number; y: number }

export interface Dungeon {
  id: number;
  theme: DungeonTheme;
  /** Entrance, out in the wilds. */
  x: number;
  y: number;
  /** Interior bounds in world pixels (its slot of the strip). */
  box: { x: number; y: number; w: number; h: number };
  /** Where you arrive inside, and the portal back out. */
  start: Pt;
  exit: Pt;
  packs: Pt[];
  bossAt: Pt;
  torches: Pt[];
  /** Goes up by one each time it's cleared and reopens: stronger monsters. */
  depth: number;
  cleared: boolean;
  /** Day a cleared dungeon reopens. */
  reopen: number;
  /** Its monsters have been placed for the current depth. */
  populated: boolean;
}

/** Slot width in tiles; one slot per dungeon, side by side. */
const SLOT_W = Math.floor((MAP_W - 2) / DUNGEON_ORDER.length);
/** Fixed ids, far above entity ids, so renderers can key them like entities. */
const ID_BASE = 900_000;

// ----------------------------------------------------------------- layout

/** Carves every dungeon's interior and places its entrance. Same seed, same dungeons. */
export function generateDungeons(g: Game, seed: number): Dungeon[] {
  const w = g.world, rng = mulberry32(seed ^ 0x5eed1e);
  const cx = MAP_W / 2, cy = MAP_H / 2, base = rng() * TAU;
  const floor = (tx: number, ty: number, v: number) => { w.wall[idx(tx, ty)] = 0; w.ground[idx(tx, ty)] = v; };
  const out: Dungeon[] = [];

  DUNGEON_ORDER.forEach((theme, i) => {
    const def = DUNGEONS[theme], x0 = 1 + i * SLOT_W, y0 = MAP_H + DUNGEON_GAP;
    const tile = (_k: number) => GROUND.floor[def.floor];
    const room = (rw: number, rh: number, bottom: number) => {
      const left = x0 + 1 + Math.floor(rng() * (SLOT_W - rw - 2));
      return { x: left, y: bottom - rh + 1, w: rw, h: rh };
    };
    const carve = (r: { x: number; y: number; w: number; h: number }) => {
      for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) floor(tx, ty, tile((tx * 7 + ty * 3) % 5 === 0 ? 1 : 0));
    };
    const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE });

    // Entry hall at the bottom, two pack chambers, the boss chamber at the top; corridors between.
    const specs: [number, number][] = [[9, 6], [13 + Math.floor(rng() * 5), 7], [14 + Math.floor(rng() * 5), 7], [Math.min(SLOT_W - 3, 20), 10]];
    const rooms: { x: number; y: number; w: number; h: number }[] = [];
    let bottom = y0 + DUNGEON_ROWS - 2;
    for (const [rw, rh] of specs) {
      const r = room(rw, rh, bottom);
      carve(r);
      const prev = rooms[rooms.length - 1];
      if (prev) {
        // Up from the previous room's top, across, and into this room's bottom.
        const ax = Math.floor(prev.x + prev.w / 2), bx = Math.floor(r.x + r.w / 2), mid = r.y + r.h;
        for (let ty = mid; ty < prev.y; ty++) for (let k = -1; k <= 1; k++) floor(ax + k, ty, tile(1));
        for (let tx = Math.min(ax, bx) - 1; tx <= Math.max(ax, bx) + 1; tx++) for (let k = 0; k < 2; k++) floor(tx, mid + k, tile(1));
      }
      rooms.push(r);
      bottom = r.y - 3;
    }
    // Pillars for cover in the boss chamber.
    const boss = rooms[3], bc = { x: Math.floor(boss.x + boss.w / 2), y: Math.floor(boss.y + boss.h / 2) };
    for (const [dx, dy] of [[-5, -2], [5, -2], [-5, 2], [5, 2]]) {
      w.wall[idx(bc.x + dx, bc.y + dy)] = 1;
      w.ground[idx(bc.x + dx, bc.y + dy)] = GROUND.wall;
    }

    const entry = centre(rooms[0]);
    const packs: Pt[] = [];
    for (const r of [rooms[1], rooms[2]]) {
      const c = centre(r);
      // On the far side of each chamber, so they wake as you come in rather than at the door.
      packs.push({ x: c.x - r.w * TILE * 0.25, y: c.y - TILE * 1.5 }, { x: c.x + r.w * TILE * 0.25, y: c.y - TILE * 1.5 });
    }
    const bc2 = centre(boss);
    packs.push({ x: bc2.x, y: (boss.y + boss.h - 1.5) * TILE });
    const torches: Pt[] = [];
    for (const r of rooms) for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      torches.push({ x: (r.x + 0.5 + fx * (r.w - 1)) * TILE, y: (r.y + 0.5 + fy * (r.h - 1)) * TILE });
    }

    // The entrance: spread around the Hearth, out past the first ring of camps.
    const a = base + (i * TAU) / DUNGEON_ORDER.length + (rng() - 0.5) * 0.8, d = 17 + rng() * 9;
    const ex = Math.max(4, Math.min(MAP_W - 5, Math.floor(cx + Math.cos(a) * d)));
    const ey = Math.max(4, Math.min(MAP_H - 5, Math.floor(cy + Math.sin(a) * d)));
    w.clearNodes(ex, ey, 2.5);

    out.push({
      id: ID_BASE + i, theme, x: (ex + 0.5) * TILE, y: (ey + 0.5) * TILE,
      box: { x: x0 * TILE, y: y0 * TILE, w: SLOT_W * TILE, h: DUNGEON_ROWS * TILE },
      start: { x: entry.x, y: entry.y + TILE * 0.5 }, exit: { x: entry.x, y: entry.y + TILE * 2 },
      packs, bossAt: { x: bc2.x, y: bc2.y - TILE }, torches,
      depth: 1, cleared: false, reopen: 0, populated: false,
    });
  });
  return out;
}

// ----------------------------------------------------------------- queries

/** Which dungeon a point is inside: its id, 0 for the overworld, -1 for solid rock in between. */
export function regionAt(g: Game, x: number, y: number): number {
  if (y < WORLD_H) return 0;
  for (const d of g.dungeons) if (x >= d.box.x && x < d.box.x + d.box.w && y >= d.box.y && y < d.box.y + d.box.h) return d.id;
  return -1;
}

export const dungeonById = (g: Game, id: number) => g.dungeons.find(d => d.id === id);

/** Why `d` can't be entered right now, or null. */
export function entryLock(g: Game, d: Dungeon): string | null {
  const def = DUNGEONS[d.theme];
  if (g.day < def.opens) return `The ${def.name} opens on day ${def.opens}`;
  if (d.cleared) return `Conquered. Something stirs in it again on day ${d.reopen}`;
  return null;
}

/** "Enter the Forgotten Crypt (depth 2)". */
export function entryLabel(d: Dungeon): string {
  return `Enter the ${DUNGEONS[d.theme].name}` + (d.depth > 1 ? ` (depth ${d.depth})` : '');
}

// ----------------------------------------------------------------- going in and out

/** Moves a player (and their companions) somewhere else on the map. */
function teleport(g: Game, p: Player, x: number, y: number): void {
  p.dash = null;
  p.x = x;
  p.y = y;
  for (const a of g.allies) {
    if (a.owner !== p || a.dead) continue;
    a.x = x + rand(-40, 40);
    a.y = y + rand(20, 50);
  }
  g.events.emit('vfx', { kind: 'ring', x, y, r: 60, color: '#c8a8ff', life: 0.5 });
}

export function enterDungeon(g: Game, p: Player, d: Dungeon): void {
  const lock = entryLock(g, d);
  if (lock) return g.fx.text(d.x, d.y - 40, lock, '#ff9a8a', 13);
  if (!d.populated) populate(g, d);
  teleport(g, p, d.start.x + (p.slot - 1.5) * 30, d.start.y);
  const name = DUNGEONS[d.theme].name;
  g.fx.toast(`You enter the ${name}. Its master waits in the deepest chamber.`
    + (g.phase === 'night' ? ' The Hearth is on its own while you\'re down here.' : ''), p.id);
  if (g.players.length > 1) g.fx.toast(`${p.name} entered the ${name}.`);
}

export function leaveDungeon(g: Game, p: Player, d: Dungeon): void {
  teleport(g, p, d.x + (p.slot - 1.5) * 30, d.y + 60);
}

/** Tells every player inside a dungeon something about the world above. */
function tellInside(g: Game, msg: string): void {
  for (const p of g.players) if (dungeonById(g, regionAt(g, p.x, p.y))) g.fx.toast(msg, p.id);
}

/** Dusk: a heads-up for anyone below. */
export function warnInside(g: Game): void {
  tellInside(g, 'Dusk is falling above. Head back to defend the Hearth, or trust the walls to hold without you.');
}

/** Nightfall, with players still below. */
export function nightfallInside(g: Game): void {
  tellInside(g, 'Night has fallen. The horde is attacking the Hearth while you\'re below.');
}

/** Health shares of the Hearth that alert players below, once each per night. */
const HEARTH_ALERTS = [0.5, 0.25];

/** Called each night step: alerts players below when the Hearth drops past a threshold. */
export function watchHearth(g: Game): void {
  const h = g.world.hearth, k = h.hp / h.maxHp;
  while (g.hearthAlert < HEARTH_ALERTS.length && k <= HEARTH_ALERTS[g.hearthAlert]) {
    tellInside(g, `⚠ The Hearth is down to ${Math.round(HEARTH_ALERTS[g.hearthAlert++] * 100)}% health!`);
  }
}

/** Dawn: dungeons open on their day, and cleared ones come back one level deeper. */
export function dungeonsAtDawn(g: Game): void {
  for (const d of g.dungeons) {
    const def = DUNGEONS[d.theme];
    if (g.day === def.opens && !d.cleared) g.fx.toast(`The ${def.name} has opened. Its treasure is guarded by the ${ENEMIES[def.boss].name}.`);
    if (!d.cleared || g.day < d.reopen) continue;
    d.cleared = false;
    d.depth++;
    d.populated = false;
    g.enemies = g.enemies.filter(e => e.dungeon !== d.id);
    g.fx.toast(`Something stirs in the ${def.name} again (depth ${d.depth}).`);
  }
}

// ----------------------------------------------------------------- monsters

/** Places the packs and the boss, as strong as the current day, the theme and the depth make them. */
function populate(g: Game, d: Dungeon): void {
  const def = DUNGEONS[d.theme], level = g.day + def.bonus + 2 * (d.depth - 1);
  const total = def.pool.reduce((s, [, w]) => s + w, 0);
  const pick = (): EnemyId => {
    let r = Math.random() * total;
    for (const [t, w] of def.pool) if ((r -= w) <= 0) return t;
    return def.pool[0][0];
  };
  const spawn = (type: EnemyId, at: Pt, spread: number) => {
    const e = new Enemy(g, type, at.x + rand(-spread, spread), at.y + rand(-spread * 0.6, spread * 0.6), level);
    e.home = { x: e.x, y: e.y };
    e.dungeon = d.id;
    g.enemies.push(e);
  };
  // Bigger parties meet bigger packs (the boss already scales with the party).
  const size = 1 + 0.35 * (g.players.length - 1);
  for (const at of d.packs) {
    const n = Math.round((3 + Math.floor(Math.random() * 2) + (d.depth > 1 ? 1 : 0)) * size);
    for (let i = 0; i < n; i++) spawn(pick(), at, 60);
  }
  spawn(def.boss, d.bossAt, 0);
  d.populated = true;
}

/**
 * The boss fell: the dungeon is cleared. Everyone inside discovers the same one legendary and gets
 * shards (more for harder dungeons and deeper visits); it also drops an epic and gold.
 */
export function dungeonBossKilled(g: Game, e: Enemy): void {
  const d = dungeonById(g, e.dungeon);
  if (!d) return;
  const def = DUNGEONS[d.theme];
  d.cleared = true;
  d.reopen = g.day + DUNGEON_REOPEN;
  const ilvl = g.day + def.bonus + d.depth - 1;
  const inside = g.players.filter(p => regionAt(g, p.x, p.y) === d.id);
  bossReward(g, inside.length ? inside : g.players, FORGE.dungeonBoss + 2 * def.bonus + FORGE.perDepth * (d.depth - 1));
  dropLoot(g, e.x, e.y, makeItem(g, ilvl, rollRarity(1.5, 'epic')));
  const gold = 60 + 20 * g.day + 40 * (d.depth - 1);
  g.res.gold += gold;
  g.fx.shake(20);
  g.fx.toast(`The ${e.def.name} is slain! The ${def.name} is conquered (+${gold} gold).`);
  g.events.emit('vfx', { kind: 'ring', x: e.x, y: e.y, r: 140, color: def.color, life: 0.8 });
}

export const nearDungeon = (g: Game, x: number, y: number, r: number) => g.dungeons.some(d => dist(d.x, d.y, x, y) < r);
