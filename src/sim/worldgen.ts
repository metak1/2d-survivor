import { GRID_H, MAP_H, MAP_W } from '../config';
import { hash2, mulberry32, TAU } from '../core/math';
import { idx, type World } from './world';

/** Ground tile variants; the renderer's tileset uses the same order. */
export const GROUND = {
  grass: [0, 1, 2],
  grassTufts: 3,
  grassFlowers: 4,
  grassPebbles: 5,
  dirt: [6, 7, 8],
  /** Dungeon interiors: stone floor per theme (crypt, warren, depths), and solid rock. */
  floor: [9, 10, 11],
  wall: 12,
  count: 13,
} as const;

export function generateWorld(w: World, seed: number): void {
  const rng = mulberry32(seed);
  const cx = MAP_W / 2, cy = MAP_H / 2;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const h = hash2(x, y), d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const n = (Math.sin(x * 0.21 + seed) + Math.cos(y * 0.17 - seed * 0.5)) * 0.5; // -1..1, broad patches
      let v: number;
      if (d < 4.5 + h * 0.8) v = GROUND.dirt[Math.floor(h * 3)];          // packed dirt around the hearth
      else {
        const r = hash2(x * 7 + 3, y * 13 + 1);
        v = r < 0.12 ? GROUND.grassTufts : r < 0.16 ? GROUND.grassFlowers : r < 0.18 ? GROUND.grassPebbles
          : GROUND.grass[n < -0.3 ? 0 : n < 0.35 ? 1 : 2];
      }
      w.ground[idx(x, y)] = v;
    }
  }

  // Below the map: solid rock, until generateDungeons carves the interiors out of it.
  for (let y = MAP_H; y < GRID_H; y++) for (let x = 0; x < MAP_W; x++) {
    w.ground[idx(x, y)] = GROUND.wall;
    w.wall[idx(x, y)] = 1;
  }

  w.hearth = w.place('hearth', cx - 1, cy - 1, null);

  // Forest clusters, rock clusters and rare gold veins.
  for (let c = 0; c < 42; c++) {
    const ax = rng() * MAP_W, ay = rng() * MAP_H;
    if (Math.hypot(ax - cx, ay - cy) < 9) continue;
    const n = 6 + Math.floor(rng() * 16), spread = 2 + rng() * 3.5;
    for (let i = 0; i < n; i++) w.trySpawnNode('tree', ax + (rng() - 0.5) * 2 * spread, ay + (rng() - 0.5) * 2 * spread);
  }
  for (let c = 0; c < 22; c++) {
    const ax = rng() * MAP_W, ay = rng() * MAP_H;
    if (Math.hypot(ax - cx, ay - cy) < 9) continue;
    const n = 3 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) w.trySpawnNode('rock', ax + (rng() - 0.5) * 4, ay + (rng() - 0.5) * 4);
  }
  for (let c = 0; c < 14; c++) {
    const a = rng() * TAU, d = 14 + rng() * 22;
    w.trySpawnNode('gold', cx + Math.cos(a) * d, cy + Math.sin(a) * d);
  }
  // Guarantee some starter resources close to the base.
  for (let i = 0; i < 16; i++) {
    const a = rng() * TAU, d = 7 + rng() * 5;
    w.trySpawnNode(i < 11 ? 'tree' : 'rock', cx + Math.cos(a) * d, cy + Math.sin(a) * d);
  }
}
