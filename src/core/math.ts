export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const choice = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Small seeded PRNG so world generation is reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 0..1 noise for a grid coordinate. */
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function circleRectOverlap(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number): boolean {
  const px = clamp(cx, rx, rx + rw), py = clamp(cy, ry, ry + rh);
  const dx = cx - px, dy = cy - py;
  return dx * dx + dy * dy < r * r;
}

export function compass(a: number): string {
  const names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return names[((Math.round(a / (TAU / 8)) % 8) + 8) % 8];
}
