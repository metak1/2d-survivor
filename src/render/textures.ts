// Procedurally drawn pixel-art textures for everything the sprite packs don't cover
// (ground, trees, rocks, buildings, flames, lights). Drawn at half resolution with hard-edged
// pixels and shown at ART_SCALE, so they sit in the same chunky style as the character sprites.
// Replace any of these keys with a loaded image of the same name to swap in real art.

import Phaser from 'phaser';
import { BUILDINGS, HEARTH_LEVELS } from '../data/buildings';
import type { BuildingId } from '../data/types';
import { GROUND } from '../sim/worldgen';

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

const px = (x: Ctx, col: string, X: number, Y: number, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(X, Y, w, h); };

/** Hard-edged pixel disc (or ellipse with ry). */
function disc(x: Ctx, col: string, cx: number, cy: number, r: number, ry = r): void {
  x.fillStyle = col;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let X = Math.floor(cx - r); X <= Math.ceil(cx + r); X++) {
      const dx = (X + 0.5 - cx) / r, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) x.fillRect(X, y, 1, 1);
    }
  }
}

/** Deterministic pseudo-random for texture speckles. */
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function add(scene: Phaser.Scene, key: string, c: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, c);
}

function addSheet(scene: Phaser.Scene, key: string, c: HTMLCanvasElement, fw: number, fh: number): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addSpriteSheet(key, c as unknown as HTMLImageElement, { frameWidth: fw, frameHeight: fh });
}

// ----------------------------- Ground --------------------------------------

export const GROUND_TILE = 20;

function groundTiles(scene: Phaser.Scene): void {
  const T = GROUND_TILE;
  const [c, x] = makeCanvas(T * GROUND.count, T);
  const grassBases = ['#3d6b2f', '#457537', '#4d7d3a'];
  const draw = (i: number, base: string, speck: string[], seed: number, extra?: (ox: number, r: () => number) => void) => {
    const ox = i * T, r = seeded(seed);
    px(x, base, ox, 0, T, T);
    for (let k = 0; k < 26; k++) px(x, speck[k % speck.length], ox + Math.floor(r() * T), Math.floor(r() * T));
    extra?.(ox, r);
  };
  grassBases.forEach((b, i) => draw(GROUND.grass[i], b, ['#36602a', '#5a8a44', '#41712f'], 11 + i));
  draw(GROUND.grassTufts, grassBases[1], ['#36602a', '#5a8a44'], 21, (ox, r) => {
    for (let k = 0; k < 3; k++) {
      const X = ox + 3 + Math.floor(r() * 13), Y = 6 + Math.floor(r() * 10);
      px(x, '#6f9e4c', X, Y - 2, 1, 3); px(x, '#6f9e4c', X - 1, Y - 1); px(x, '#6f9e4c', X + 1, Y - 1);
    }
  });
  draw(GROUND.grassFlowers, grassBases[1], ['#36602a', '#5a8a44'], 31, (ox, r) => {
    for (let k = 0; k < 3; k++) {
      const X = ox + 2 + Math.floor(r() * 15), Y = 2 + Math.floor(r() * 15);
      const col = k % 2 ? '#e8d26a' : '#d98ac9';
      px(x, col, X, Y); px(x, col, X + 1, Y); px(x, col, X, Y + 1); px(x, '#fff3c0', X + 1, Y + 1);
    }
  });
  draw(GROUND.grassPebbles, grassBases[1], ['#36602a', '#5a8a44'], 41, (ox, r) => {
    for (let k = 0; k < 3; k++) {
      const X = ox + 2 + Math.floor(r() * 15), Y = 2 + Math.floor(r() * 15);
      px(x, '#8c8f86', X, Y, 2, 1); px(x, '#6d7069', X, Y + 1, 2, 1);
    }
  });
  ['#6b4f34', '#73563a', '#654a30'].forEach((b, i) => draw(GROUND.dirt[i], b, ['#5a412a', '#80644a', '#5e452d'], 51 + i));
  // Dungeon floors (flagstones with seams) and solid rock.
  const flags = (i: number, base: string, seam: string, speck: string[], seed: number, extra?: (ox: number, r: () => number) => void) =>
    draw(i, base, speck, seed, (ox, r) => {
      px(x, seam, ox, 0, T, 1); px(x, seam, ox, 10, T, 1); px(x, seam, ox, 0, 1, 10); px(x, seam, ox + 10, 10, 1, 10);
      extra?.(ox, r);
    });
  flags(GROUND.floor[0], '#3b404b', '#2a2e37', ['#454b57', '#343944'], 61);
  flags(GROUND.floor[1], '#4a3b2c', '#352a1f', ['#56463a', '#3f3226'], 62);
  flags(GROUND.floor[2], '#3a2522', '#261816', ['#46302b', '#2f1d1a'], 63, (ox, r) => {
    for (let k = 0; k < 2; k++) { const X = ox + 2 + Math.floor(r() * 15), Y = 2 + Math.floor(r() * 15); px(x, '#ff6a2a', X, Y, 2, 1); px(x, '#ffb347', X, Y); }
  });
  draw(GROUND.wall, '#15161b', ['#1c1d23', '#101115', '#22232a'], 64, (ox, r) => {
    for (let k = 0; k < 3; k++) px(x, '#26272e', ox + Math.floor(r() * 16), Math.floor(r() * 18), 3, 1);
  });
  add(scene, 'ground', c);
}

// ----------------------------- Nature --------------------------------------

function trees(scene: Phaser.Scene): void {
  const palettes = [['#1f4d27', '#2b6b33', '#3a8a40', '#5aa85a'], ['#25521f', '#336b28', '#468a34', '#6aa84a']];
  palettes.forEach((p, i) => {
    const [c, x] = makeCanvas(26, 32);
    disc(x, 'rgba(0,0,0,0.3)', 14, 28, 10, 3.5);
    px(x, '#4a3220', 11, 18, 4, 10); px(x, '#5e4129', 12, 18, 2, 10);
    disc(x, p[0], 13, 12, 11, 10);
    disc(x, p[1], 12, 11, 9, 8.5);
    disc(x, p[2], 11, 9, 6, 5.5);
    disc(x, p[3], 9, 7, 2.5, 2);
    add(scene, `tree${i}`, c);
  });
}

function rocks(scene: Phaser.Scene): void {
  for (const kind of ['rock', 'gold'] as const) {
    const [c, x] = makeCanvas(22, 18);
    disc(x, 'rgba(0,0,0,0.3)', 12, 14, 9, 3);
    disc(x, kind === 'gold' ? '#55524a' : '#61656c', 11, 9, 9, 7);
    disc(x, kind === 'gold' ? '#6d6a60' : '#7d828a', 10, 8, 7.5, 5.5);
    disc(x, kind === 'gold' ? '#868277' : '#9aa0a8', 8, 6, 3.5, 2.5);
    if (kind === 'gold') {
      for (const [X, Y] of [[6, 8], [12, 6], [14, 10], [9, 11]]) {
        px(x, '#f3d25a', X, Y, 2, 2); px(x, '#fff3a0', X, Y);
      }
    }
    add(scene, kind, c);
  }
}

// ----------------------------- Walls ---------------------------------------
// Walls join up: each of 16 neighbour masks (1 N, 2 E, 4 S, 8 W) gets its own texture, with
// edges and a front face only on the sides that don't touch another wall.

const WALL_PALETTES = [
  { base: '#7b5230', light: '#a8774a', mid: '#946538', dark: '#4a2e18', face: '#5a3a20' },   // wood
  { base: '#6c7078', light: '#a5aab2', mid: '#8d929b', dark: '#3e4248', face: '#4e5258' },   // stone
  { base: '#4a4e58', light: '#8a909c', mid: '#646a76', dark: '#24262c', face: '#33363e' },   // iron
];

export const wallKey = (tier: number, mask: number) => `wall_${tier}_${mask}`;
export const gateKey = (tier: number) => `gate_${tier}`;

function walls(scene: Phaser.Scene): void {
  const S = 20;
  WALL_PALETTES.forEach((p, tier) => {
    for (let mask = 0; mask < 16; mask++) {
      const [c, x] = makeCanvas(S, S);
      const n = mask & 1, e = mask & 2, s = mask & 4, w = mask & 8;
      px(x, p.base, 0, 0, S, S);
      if (tier === 0) {
        for (let i = 0; i < 4; i++) { px(x, p.mid, 1 + i * 5, 0, 4, S); px(x, p.light, 1 + i * 5, 0, 1, S); }
        px(x, p.dark, 0, 6, S, 1); px(x, p.dark, 0, 13, S, 1);
      } else {
        for (let r = 0; r < 4; r++) {
          const off = r % 2 ? 5 : 0;
          for (let k = -1; k < 3; k++) {
            const X = Math.max(0, off + k * 10);
            px(x, p.mid, X, r * 5 + 1, Math.min(8, S - X), 3);
            px(x, p.light, X, r * 5 + 1, Math.min(8, S - X), 1);
          }
        }
        if (tier === 2) for (const [X, Y] of [[3, 3], [16, 3], [3, 16], [16, 16]]) px(x, '#c9ccd4', X, Y);
      }
      // Outline and front face only where the wall ends.
      if (!n) px(x, p.light, 0, 0, S, 1);
      if (!w) px(x, p.dark, 0, 0, 1, S);
      if (!e) px(x, p.dark, S - 1, 0, 1, S);
      if (!s) { px(x, p.face, 0, S - 4, S, 4); px(x, p.dark, 0, S - 1, S, 1); }
      add(scene, wallKey(tier, mask), c);
    }
  });
  ['#7a5230', '#7d828a', '#4a4e58'].forEach((plank, tier) => {
    const [c, x] = makeCanvas(S, S);
    px(x, '#3e2814', 0, 0, S, S);
    px(x, plank, 2, 2, S - 4, S - 4);
    for (let i = 0; i < 4; i++) px(x, tier === 0 ? '#8c6038' : '#9aa0a8', 3 + i * 4, 2, 1, S - 4);
    const band = tier === 2 ? '#1e2026' : '#3a3a40';
    px(x, band, 0, 5, S, 2); px(x, band, 0, 13, S, 2);
    px(x, tier ? '#e8c547' : '#c9b46a', 9, 9, 2, 2);
    add(scene, gateKey(tier), c);
  });
}

// ----------------------------- Buildings -----------------------------------

const TIER_TRIM = ['', '#c9ced6', '#f0c850', '#ff8a3a', '#ff5ad0'];

export const buildingKey = (type: BuildingId, tier: number) => `b_${type}_${tier}`;

/**
 * Registers the base art plus a copy for every upgrade tier. Square buildings get a coloured
 * trim; round or thin ones (`frame: false`) only get tier pips.
 */
function tiered(scene: Phaser.Scene, type: BuildingId, base: HTMLCanvasElement, tiers: number, frame = true): void {
  for (let t = 0; t < tiers; t++) {
    const [c, x] = makeCanvas(base.width, base.height);
    x.drawImage(base, 0, 0);
    if (t > 0) {
      const W = base.width, H = base.height, col = TIER_TRIM[t];
      if (frame) { px(x, col, 0, 0, W, 1); px(x, col, 0, H - 1, W, 1); px(x, col, 0, 0, 1, H); px(x, col, W - 1, 0, 1, H); }
      const pipY = frame ? 2 : H - 5;
      for (let k = 0; k < t; k++) px(x, col, (frame ? 2 : W / 2 - t * 1.5) + k * 3, pipY, 2, 2);
    }
    add(scene, buildingKey(type, t), c);
  }
}

const tierCount = (type: BuildingId) => type === 'hearth' ? HEARTH_LEVELS.length : 1 + (BUILDINGS[type].tiers?.length ?? 0);

function buildings(scene: Phaser.Scene): void {
  const S = 20;
  const make = (type: BuildingId, w: number, h: number, draw: (x: Ctx) => void) => {
    const [c, x] = makeCanvas(w, h);
    draw(x);
    tiered(scene, type, c, tierCount(type), type !== 'hearth' && type !== 'torch');
  };

  make('arrowtower', S, S, x => {
    px(x, '#4a4e55', 0, 0, S, S); px(x, '#70747c', 1, 1, S - 2, S - 2); px(x, '#868a92', 1, 1, S - 2, 2);
    disc(x, '#5c4630', 10, 10, 6.5); disc(x, '#8a6a44', 10, 10, 5);
  });
  make('firetower', S, S, x => {
    px(x, '#3e3834', 0, 0, S, S); px(x, '#5d5550', 1, 1, S - 2, S - 2); px(x, '#746b64', 1, 1, S - 2, 2);
    disc(x, '#2b2522', 10, 10, 6.5); disc(x, '#5a2a12', 10, 10, 4.5);
  });
  make('frostspire', S, S, x => {
    px(x, '#3a4a5a', 0, 0, S, S); px(x, '#5a7088', 1, 1, S - 2, S - 2); px(x, '#7a94ac', 1, 1, S - 2, 2);
    disc(x, '#2a3a4c', 10, 10, 6);
  });
  make('stormtotem', S, S, x => {
    px(x, '#2c2a36', 0, 0, S, S); px(x, '#46425a', 1, 1, S - 2, S - 2);
    px(x, '#5a3a20', 7, 3, 6, 15); px(x, '#7a5230', 8, 3, 2, 15);
    for (const Y of [6, 10, 14]) px(x, '#7fd3ff', 9, Y, 2, 1);
  });
  make('spikes', S, S, x => {
    px(x, 'rgba(50,40,30,0.75)', 1, 1, S - 2, S - 2);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
      const X = 3 + k * 6, Y = 4 + r * 6;
      px(x, '#c2c6cc', X, Y - 2, 1, 1); px(x, '#c2c6cc', X - 1, Y - 1, 3, 1); px(x, '#8d929b', X - 1, Y, 3, 1);
    }
  });
  make('torch', 8, 16, x => {
    disc(x, 'rgba(0,0,0,0.3)', 4, 14.5, 3.5, 1.5);
    px(x, '#4a3220', 3, 4, 2, 11); px(x, '#6b4a2b', 3, 4, 1, 11); px(x, '#3a3a40', 2, 3, 4, 2);
  });
  make('shrine', S, S, x => {
    px(x, '#55594f', 1, 3, S - 2, S - 4); px(x, '#7d8275', 2, 4, S - 4, S - 7);
    px(x, '#9a9f90', 2, 4, S - 4, 1); px(x, '#3f4239', 1, S - 2, S - 2, 1);
    for (const [X, Y] of [[4, 7], [14, 9], [6, 13]]) px(x, '#5e9a6a', X, Y, 2, 1);
  });
  make('hearth', 40, 40, x => {
    disc(x, 'rgba(0,0,0,0.3)', 21, 22, 19);
    disc(x, '#5e5852', 20, 20, 19);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      disc(x, i % 2 ? '#958c84' : '#a59c93', 20 + Math.cos(a) * 15, 20 + Math.sin(a) * 15, 4);
    }
    disc(x, '#2b1d14', 20, 20, 10.5);
    disc(x, '#4a2a14', 20, 20, 7);
  });

  // Rotating crossbow heads: plain for tiers I and II, a heavy ballista for tier III.
  {
    const [c, x] = makeCanvas(12, 8);
    px(x, '#4a3420', 2, 3, 9, 2);
    px(x, '#c9a36b', 8, 0, 2, 8); px(x, '#c9a36b', 7, 0); px(x, '#c9a36b', 7, 7);
    px(x, '#e8e0c8', 9, 1, 1, 6);
    add(scene, 'head_arrow', c);
  }
  {
    const [c, x] = makeCanvas(16, 12);
    px(x, '#3a2a18', 1, 5, 14, 2);
    px(x, '#8a8f98', 10, 0, 3, 12); px(x, '#b0b5bd', 11, 1, 1, 10);
    px(x, '#e8e0c8', 12, 1, 1, 10);
    px(x, '#cfd6dd', 14, 5, 2, 2);
    add(scene, 'head_ballista', c);
  }
  {
    const [c, x] = makeCanvas(9, 15);
    for (let y = 0; y < 15; y++) {
      const w = Math.max(1, Math.round(4.5 - Math.abs(y - 7) * 0.6));
      px(x, '#8fd8ff', 4.5 - w, y, w * 2, 1);
      px(x, '#e6f8ff', 4.5 - w + 1, y, 1, 1);
    }
    add(scene, 'frost_crystal', c);
  }
  {
    const [c, x] = makeCanvas(8, 8);
    disc(x, '#3a8acc', 4, 4, 4); disc(x, '#9fe0ff', 4, 4, 2.6); disc(x, '#ffffff', 3.5, 3.5, 1.2);
    add(scene, 'storm_orb', c);
  }
  {
    const [c, x] = makeCanvas(9, 13);
    for (let y = 0; y < 13; y++) {
      const w = Math.max(1, Math.round(4.5 - Math.abs(y - 6) * 0.7));
      px(x, '#3fcf7a', 4.5 - w, y, w * 2, 1);
      px(x, '#a8ffcf', 4.5 - w + 1, y, 1, 1);
    }
    add(scene, 'shrine_crystal', c);
  }
}

function props(scene: Phaser.Scene): void {
  for (const open of [false, true]) {
    const [c, x] = makeCanvas(18, 16);
    disc(x, 'rgba(0,0,0,0.3)', 9, 14, 8, 2);
    px(x, '#5a3a1c', 1, 6, 16, 8); px(x, '#7a5230', 2, 7, 14, 6);
    px(x, '#c9a336', 1, 6, 16, 1); px(x, '#c9a336', 1, 13, 16, 1); px(x, '#c9a336', 8, 6, 2, 8);
    if (open) {
      px(x, '#3a2410', 2, 3, 14, 3); px(x, '#ffe27a', 4, 5, 10, 2); px(x, '#fff8c0', 6, 5, 2, 1);
    } else {
      px(x, '#6a4424', 1, 2, 16, 4); px(x, '#8a5e34', 2, 2, 14, 2); px(x, '#c9a336', 1, 2, 16, 1);
      px(x, '#f0d060', 8, 5, 2, 3);
    }
    add(scene, open ? 'chest_open' : 'chest', c);
  }
  {
    const [c, x] = makeCanvas(16, 14);
    disc(x, 'rgba(0,0,0,0.3)', 8, 12, 7, 2);
    px(x, '#6b4a2b', 1, 2, 14, 10); px(x, '#946538', 2, 3, 12, 8);
    px(x, '#5a3a20', 1, 6, 14, 1); px(x, '#5a3a20', 7, 2, 2, 10);
    px(x, '#d8c49a', 3, 4, 3, 1);
    add(scene, 'crate', c);
  }
}

// ----------------------------- Dungeons ------------------------------------

/** Cave mouths in the wilds (one per theme, rune stones in its colour; sealed with bars) and the way out. */
function dungeonProps(scene: Phaser.Scene): void {
  const theme: [string, string][] = [['crypt', '#9ad8ff'], ['warren', '#9be36b'], ['depths', '#ff8a3a']];
  for (const [name, rune] of theme) for (const sealed of [false, true]) {
    const [c, x] = makeCanvas(30, 24);
    disc(x, 'rgba(0,0,0,0.35)', 15, 21, 14, 3);
    disc(x, '#5d6068', 15, 14, 14, 10); disc(x, '#73767f', 13, 11, 10, 7); disc(x, '#878a93', 11, 8, 5, 3);
    disc(x, '#0a0a0e', 15, 16, 7, 7); px(x, '#0a0a0e', 8, 16, 15, 6); disc(x, '#1a1a22', 15, 15, 5, 5);
    px(x, '#4a4d55', 6, 20, 4, 2); px(x, '#4a4d55', 21, 20, 4, 2);
    px(x, rune, 5, 13, 2, 3); px(x, rune, 24, 13, 2, 3); px(x, '#ffffff', 5, 13); px(x, '#ffffff', 24, 13);
    if (sealed) for (let k = 0; k < 4; k++) px(x, '#8a8f98', 10 + k * 3, 10, 1, 12);
    add(scene, `cave_${name}${sealed ? '_sealed' : ''}`, c);
  }
  const [c, x] = makeCanvas(20, 20);
  disc(x, '#3a1a6a', 10, 10, 9, 9); disc(x, '#6a3ab0', 10, 10, 7, 7); disc(x, '#a07aff', 10, 10, 4.5, 4.5); disc(x, '#e8dcff', 10, 10, 2, 2);
  px(x, '#c8a8ff', 3, 9, 2, 1); px(x, '#c8a8ff', 15, 11, 2, 1); px(x, '#c8a8ff', 9, 3, 1, 2);
  add(scene, 'portal', c);
}

function flames(scene: Phaser.Scene): void {
  const W = 12, H = 16, N = 4;
  const [c, x] = makeCanvas(W * N, H);
  for (let f = 0; f < N; f++) {
    const ox = f * W, sway = [0, 1, 0, -1][f];
    const layers: [string, number, number][] = [['#ff5a1a', 5, 13], ['#ffa83a', 3.5, 10], ['#fff0a0', 2, 6]];
    for (const [col, w, h] of layers) {
      for (let y = 0; y < h; y++) {
        const t = y / h, half = Math.max(0.5, w * Math.sin(Math.PI * (0.15 + 0.85 * (1 - t)) * 0.5 + 0.6) * (1 - t * 0.6));
        const cx = 6 + sway * t * 1.5;
        px(x, col, ox + Math.round(cx - half), H - 1 - y, Math.max(1, Math.round(half * 2)), 1);
      }
    }
  }
  addSheet(scene, 'flame', c, W, H);
  if (!scene.anims.exists('flame')) scene.anims.create({ key: 'flame', frames: scene.anims.generateFrameNumbers('flame', {}), frameRate: 9, repeat: -1 });
}

// ----------------------------- Lights & misc -------------------------------

function gradients(scene: Phaser.Scene): void {
  const R = 128;
  const make = (key: string, stops: [number, string][]) => {
    const [c, x] = makeCanvas(R * 2, R * 2);
    const g = x.createRadialGradient(R, R, 0, R, R, R);
    for (const [o, col] of stops) g.addColorStop(o, col);
    x.fillStyle = g;
    x.fillRect(0, 0, R * 2, R * 2);
    add(scene, key, c);
    scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
  };
  make('light', [[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
  make('glow', [[0, 'rgba(255,140,50,0.55)'], [1, 'rgba(255,140,50,0)']]);
  make('cloud', [[0, 'rgba(155,227,91,0.9)'], [1, 'rgba(90,150,40,0)']]);
  make('ice', [[0, 'rgba(190,235,255,0.8)'], [0.8, 'rgba(150,210,255,0.5)'], [1, 'rgba(150,210,255,0)']]);
}

function projectiles(scene: Phaser.Scene): void {
  const orb = (key: string, r: number, outer: string, inner: string) => {
    const s = Math.ceil(r * 2) + 2;
    const [c, x] = makeCanvas(s, s);
    disc(x, outer, s / 2, s / 2, r);
    disc(x, inner, s / 2 - 0.5, s / 2 - 0.5, r * 0.45);
    add(scene, key, c);
  };
  orb('p_bolt', 3.5, '#b49cff', '#ffffff');
  orb('p_holy', 3.5, '#ffd86a', '#fffbe0');
  orb('p_fireball', 5, '#ff8a3a', '#fff2b0');
  orb('p_spit', 3.5, '#c8e04a', '#f4ffc0');
  orb('p_lob', 4, '#ffb347', '#fff2b0');
  if (!scene.textures.exists('p_cannon')) orb('p_cannon', 4, '#2a2a30', '#6a6a78');
  if (!scene.textures.exists('p_arrow')) {
    const [c, x] = makeCanvas(12, 3);
    px(x, '#e8d8b0', 0, 1, 9, 1); px(x, '#cfd6dd', 9, 0, 2, 3); px(x, '#cfd6dd', 11, 1); px(x, '#b04a3a', 0, 0, 2, 3);
    add(scene, 'p_arrow', c);
  }
}

export function generateTextures(scene: Phaser.Scene): void {
  groundTiles(scene);
  dungeonProps(scene);
  trees(scene);
  rocks(scene);
  walls(scene);
  buildings(scene);
  props(scene);
  flames(scene);
  gradients(scene);
  projectiles(scene);
}

/** A stand-in character sheet (one frame) for when imported sprites are missing. */
export function placeholderSheet(scene: Phaser.Scene, key: string, color: string, frameSize: number): void {
  const [c, x] = makeCanvas(frameSize, frameSize);
  const m = frameSize / 2;
  disc(x, 'rgba(0,0,0,0.3)', m, m + 8, 7, 2.5);
  disc(x, color, m, m, 7);
  disc(x, '#ffffff', m + 3, m - 2, 1.5);
  addSheet(scene, key, c, frameSize, frameSize);
}
