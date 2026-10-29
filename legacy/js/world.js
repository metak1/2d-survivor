'use strict';
// ---------------------------------------------------------------------------
// World: tile grid, resource nodes, buildings, flow-field pathing, collision.
// ---------------------------------------------------------------------------

const idx = (tx, ty) => ty * MAP_W + tx;
const inMap = (tx, ty) => tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H;
const tileOf = v => Math.floor(v / TILE);
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function generateWorld(seed) {
  const rng = mulberry32(seed);
  G.gridBld = new Array(MAP_W * MAP_H).fill(null);
  G.gridNode = new Array(MAP_W * MAP_H).fill(null);
  G.nodes = [];
  G.buildings = [];

  // Ground colours are precomputed per tile so rendering is just fillRect.
  G.groundCols = new Array(MAP_W * MAP_H);
  G.groundDecor = new Uint8Array(MAP_W * MAP_H);
  const cx = MAP_W / 2, cy = MAP_H / 2;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const h = hash2(x, y), d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const n = (Math.sin(x * 0.21 + seed) + Math.cos(y * 0.17 - seed * 0.5)) * 0.5;
      let col;
      if (d < 4.5 + h * 0.8) col = `hsl(${30 + h * 6},${28 + h * 6}%,${24 + h * 4}%)`;       // dirt around the hearth
      else col = `hsl(${92 + n * 10 + h * 6},${34 + h * 8}%,${25 + n * 3 + h * 4}%)`;
      G.groundCols[idx(x, y)] = col;
      const r = hash2(x * 7 + 3, y * 13 + 1);
      G.groundDecor[idx(x, y)] = d < 5 ? 0 : r < 0.12 ? 1 : r < 0.16 ? 2 : r < 0.18 ? 3 : 0;
    }
  }

  G.hearth = placeBuilding('hearth', cx - 1, cy - 1, true);

  // Forest clusters, rock clusters and rare gold veins.
  for (let c = 0; c < 42; c++) {
    const ax = rng() * MAP_W, ay = rng() * MAP_H;
    if (Math.hypot(ax - cx, ay - cy) < 9) continue;
    const n = 6 + Math.floor(rng() * 16), spread = 2 + rng() * 3.5;
    for (let i = 0; i < n; i++) trySpawnNode('tree', ax + (rng() - 0.5) * 2 * spread, ay + (rng() - 0.5) * 2 * spread);
  }
  for (let c = 0; c < 22; c++) {
    const ax = rng() * MAP_W, ay = rng() * MAP_H;
    if (Math.hypot(ax - cx, ay - cy) < 9) continue;
    const n = 3 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) trySpawnNode('rock', ax + (rng() - 0.5) * 4, ay + (rng() - 0.5) * 4);
  }
  for (let c = 0; c < 14; c++) {
    const a = rng() * TAU, d = 14 + rng() * 22;
    trySpawnNode('gold', cx + Math.cos(a) * d, cy + Math.sin(a) * d);
  }
  // Guarantee some starter resources close to the base.
  for (let i = 0; i < 16; i++) {
    const a = rng() * TAU, d = 7 + rng() * 5;
    trySpawnNode(i < 11 ? 'tree' : 'rock', cx + Math.cos(a) * d, cy + Math.sin(a) * d);
  }
  G.minimapDirty = true;
}

function trySpawnNode(type, fx, fy, minDist = 6) {
  const tx = Math.floor(fx), ty = Math.floor(fy);
  if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) return false;
  const i = idx(tx, ty);
  if (G.gridNode[i] || G.gridBld[i]) return false;
  if (Math.hypot(tx + 0.5 - MAP_W / 2, ty + 0.5 - MAP_H / 2) < minDist) return false;
  const def = NODES[type];
  const n = {
    type, def, tx, ty, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, r: def.r,
    amount: def.amount, shake: 0, seed: hash2(tx * 31, ty * 17),
  };
  // Don't bury the player or monsters inside a fresh node.
  if (G.player && dist(n.x, n.y, G.player.x, G.player.y) < 50) return false;
  G.nodes.push(n);
  G.gridNode[i] = n;
  G.flowDirty = true;
  G.minimapDirty = true;
  return true;
}

function removeNode(n) {
  const i = G.nodes.indexOf(n);
  if (i >= 0) G.nodes.splice(i, 1);
  G.gridNode[idx(n.tx, n.ty)] = null;
  G.flowDirty = true;
  G.minimapDirty = true;
}

// Each dawn the wilds regrow a bit so the map never runs dry.
function regrowNodes() {
  const cx = MAP_W / 2, cy = MAP_H / 2;
  let trees = 0, rocks = 0, gold = 0, tries = 0;
  while ((trees < 22 || rocks < 9 || gold < 3) && tries++ < 600) {
    const a = Math.random() * TAU, d = 10 + Math.random() * 28;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    if (trees < 22) { if (trySpawnNode('tree', x, y, 10)) trees++; }
    else if (rocks < 9) { if (trySpawnNode('rock', x, y, 10)) rocks++; }
    else if (trySpawnNode('gold', x, y, 14)) gold++;
  }
}

function harvestNode(n, power) {
  const s = G.player.stats;
  const take = Math.min(n.amount, Math.max(2, Math.round(power / 7)));
  const gain = Math.max(1, Math.round(take * s.gather));
  n.amount -= take;
  n.shake = 0.18;
  G.res[n.def.res] += gain;
  G.stats.gathered += gain;
  floatText(n.x, n.y - 20, `+${gain} ${RES_ICONS[n.def.res]}`, '#e9f5c9', 13);
  const col = n.type === 'tree' ? '#7a5a34' : n.type === 'rock' ? '#a3a7ad' : '#f3d25a';
  spawnParticles(n.x, n.y, 5, col, 120, 0.4, 3);
  if (n.amount <= 0) {
    spawnParticles(n.x, n.y, 16, n.type === 'tree' ? '#3d7a3f' : col, 180, 0.6, 4);
    removeNode(n);
  }
}

// ----------------------------- Buildings ----------------------------------

function buildCost(type) {
  const def = BUILDINGS[type], out = {};
  const mul = G.player ? Math.max(0.4, G.player.stats.buildCost) : 1;
  for (const k in def.cost) out[k] = Math.max(1, Math.round(def.cost[k] * mul));
  return out;
}

function canAfford(cost) {
  for (const k in cost) if ((G.res[k] || 0) < cost[k]) return false;
  return true;
}

function pay(cost) { for (const k in cost) G.res[k] -= cost[k]; }

function placementError(type, tx, ty) {
  const def = BUILDINGS[type], size = def.size || 1;
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) {
      if (x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) return 'Out of bounds';
      const i = idx(x, y);
      if (G.gridNode[i]) return 'Blocked';
      if (G.gridBld[i]) return 'Occupied';
    }
  }
  const px = (tx + size / 2) * TILE, py = (ty + size / 2) * TILE;
  if (dist(px, py, G.player.x, G.player.y) > BUILD_RANGE) return 'Too far';
  if (def.solid) {
    const rx = tx * TILE, ry = ty * TILE, rw = size * TILE;
    const overlaps = e => circleRectOverlap(e.x, e.y, e.r, rx, ry, rw, rw);
    if (!G.player.dead && overlaps(G.player)) return 'Blocked';
    for (const e of G.enemies) if (overlaps(e)) return 'Blocked';
  }
  if (!canAfford(buildCost(type))) return 'Not enough resources';
  return null;
}

function placeBuilding(type, tx, ty, free) {
  const def = BUILDINGS[type], size = def.size || 1;
  const maxHp = Math.round(def.hp * (def.wall && G.player ? G.player.stats.wallHp : 1));
  const b = {
    type, def, tx, ty, size, x: (tx + size / 2) * TILE, y: (ty + size / 2) * TILE,
    hp: maxHp, maxHp, timer: Math.random() * 0.5, hitFlash: 0, angle: -Math.PI / 2, dead: false,
    paid: free ? {} : buildCost(type), built: G.time || 0,
  };
  for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) G.gridBld[idx(x, y)] = b;
  G.buildings.push(b);
  if (!free) {
    pay(b.paid);
    G.stats.built++;
    spawnParticles(b.x, b.y, 10, '#d8c49a', 110, 0.4, 3);
  }
  G.flowDirty = true;
  G.minimapDirty = true;
  return b;
}

function damageBuilding(b, dmg) {
  if (b.dead) return;
  b.hp -= dmg;
  b.hitFlash = 0.12;
  if (b.hp <= 0) destroyBuilding(b);
}

function destroyBuilding(b, silent) {
  if (b.dead) return;
  b.dead = true;
  for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) G.gridBld[idx(x, y)] = null;
  const i = G.buildings.indexOf(b);
  if (i >= 0) G.buildings.splice(i, 1);
  if (!silent) {
    spawnParticles(b.x, b.y, 22, b.def.wall && b.type !== 'stonewall' ? '#8b5a2b' : '#9a9a9a', 200, 0.7, 4);
    shake(b.type === 'hearth' ? 20 : 3);
  }
  G.flowDirty = true;
  G.minimapDirty = true;
  if (b.type === 'hearth') gameOver();
}

function repairCost(b) {
  const missing = 1 - b.hp / b.maxHp;
  const base = (b.paid.wood || 0) + (b.paid.stone || 0) * 0.8 + 6;
  return { wood: Math.max(1, Math.ceil(base * missing * 0.4)) };
}

// ----------------------------- Flow field ---------------------------------
// Dijkstra from the hearth outward. Buildings are passable but expensive, so monsters
// walk around defenses when there's a reasonable detour, and smash through when there isn't.

function blockedTile(tx, ty) {
  if (!inMap(tx, ty)) return true;
  const i = idx(tx, ty);
  return !!G.gridNode[i] || !!(G.gridBld[i] && G.gridBld[i].def.solid);
}

function computeFlow() {
  const N = MAP_W * MAP_H;
  // Float64 on purpose: with Float32 rounding, `nd < d[j]` can stay true forever and the search never ends.
  if (!G.flow) G.flow = new Float64Array(N);
  const d = G.flow;
  d.fill(Infinity);
  const heap = new MinHeap();
  const h = G.hearth;
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
      if (G.gridNode[j]) continue;
      const diag = dx !== 0 && dy !== 0;
      if (diag && (blockedTile(x + dx, y) || blockedTile(x, y + dy))) continue;
      let c = diag ? 1.4142 : 1;
      const b = G.gridBld[j];
      if (b && b.def.solid && b !== h) c += 3 + b.hp / 30;
      const nd = di + c;
      if (nd < d[j]) { d[j] = nd; heap.push(nd, j); }
    }
  }
  G.flowDirty = false;
}

// Where should a monster at (e.x, e.y) step next? Returns a point and the building there, if any.
function flowStep(e) {
  const tx = tileOf(e.x), ty = tileOf(e.y);
  if (!inMap(tx, ty)) return { x: G.hearth.x, y: G.hearth.y, bld: null };
  let best = G.flow[idx(tx, ty)], bx = -1, by = -1;
  for (const [dx, dy] of DIRS8) {
    const nx = tx + dx, ny = ty + dy;
    if (!inMap(nx, ny)) continue;
    if (dx !== 0 && dy !== 0 && (blockedTile(tx + dx, ty) || blockedTile(tx, ty + dy))) continue;
    const v = G.flow[idx(nx, ny)];
    if (v < best) { best = v; bx = nx; by = ny; }
  }
  if (bx < 0) return { x: G.hearth.x, y: G.hearth.y, bld: null };
  const b = G.gridBld[idx(bx, by)];
  return { x: (bx + 0.5) * TILE, y: (by + 0.5) * TILE, bld: b && b.def.solid ? b : null };
}

// ----------------------------- Collision ----------------------------------

function circleRectOverlap(cx, cy, r, rx, ry, rw, rh) {
  const px = clamp(cx, rx, rx + rw), py = clamp(cy, ry, ry + rh);
  const dx = cx - px, dy = cy - py;
  return dx * dx + dy * dy < r * r;
}

function resolveCircleRect(e, rx, ry, rw, rh) {
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

function solidFor(b, isPlayer) { return b && b.def.solid && !(isPlayer && b.def.gate); }

// Pushes a circle entity out of nodes and solid buildings. Returns the building it bumped into, if any.
function collideWorld(e, isPlayer) {
  let hit = null;
  const x0 = tileOf(e.x - e.r), x1 = tileOf(e.x + e.r), y0 = tileOf(e.y - e.r), y1 = tileOf(e.y + e.r);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!inMap(tx, ty)) continue;
      const i = idx(tx, ty);
      const n = G.gridNode[i];
      if (n) {
        const dx = e.x - n.x, dy = e.y - n.y, d = Math.hypot(dx, dy), rr = e.r + n.r;
        if (d < rr && d > 1e-3) { e.x = n.x + (dx / d) * rr; e.y = n.y + (dy / d) * rr; }
        continue;
      }
      const b = G.gridBld[i];
      if (solidFor(b, isPlayer) && resolveCircleRect(e, tx * TILE, ty * TILE, TILE, TILE)) hit = b;
    }
  }
  e.x = clamp(e.x, e.r, WORLD_W - e.r);
  e.y = clamp(e.y, e.r, WORLD_H - e.r);
  return hit;
}

function circleBlocked(x, y, r, isPlayer) {
  if (x < r || y < r || x > WORLD_W - r || y > WORLD_H - r) return true;
  const x0 = tileOf(x - r), x1 = tileOf(x + r), y0 = tileOf(y - r), y1 = tileOf(y + r);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!inMap(tx, ty)) return true;
      const i = idx(tx, ty), n = G.gridNode[i];
      if (n && dist(x, y, n.x, n.y) < r + n.r) return true;
      if (solidFor(G.gridBld[i], isPlayer) && circleRectOverlap(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) return true;
    }
  }
  return false;
}

function distToBuilding(e, b) {
  const rx = b.tx * TILE, ry = b.ty * TILE, rw = b.size * TILE;
  const px = clamp(e.x, rx, rx + rw), py = clamp(e.y, ry, ry + rw);
  return Math.hypot(e.x - px, e.y - py);
}
