'use strict';
// ---------------------------------------------------------------------------
// Game state, main loop, day/night cycle, waves, building logic and rendering.
// ---------------------------------------------------------------------------

const G = { state: 'menu', time: 0 };
let canvas, ctx, darkCanvas, darkCtx, dpr = 1, viewW = 0, viewH = 0;
const DARK_SCALE = 0.5;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = innerWidth; viewH = innerHeight;
  canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
  canvas.style.width = viewW + 'px'; canvas.style.height = viewH + 'px';
  darkCanvas.width = Math.ceil(viewW * DARK_SCALE); darkCanvas.height = Math.ceil(viewH * DARK_SCALE);
}

function mouseWorld() { return { x: Input.mx + G.cam.x, y: Input.my + G.cam.y }; }

function newGame(cls) {
  Object.assign(G, {
    state: 'playing', cls, time: 0, day: 1, phase: 'day', phaseTime: 0, phaseLen: FIRST_DAY_LEN,
    res: { wood: 60, stone: 25, gold: 0 },
    enemies: [], projectiles: [], effects: [], particles: [], texts: [],
    spawnQueue: [], spawnAngles: [], bossAlive: false,
    stats: { kills: 0, built: 0, gathered: 0, deaths: 0, nights: 0 },
    buildMode: false, buildSel: 'wall', lastPlacedTile: -1,
    shakeAmt: 0, flowTimer: 0, flowDirty: true, minimapDirty: true, flow: null, player: null,
  });
  generateWorld((Math.random() * 1e9) | 0);
  G.player = new Player(cls);
  G.cam = { x: G.player.x - viewW / 2, y: G.player.y - viewH / 2 };
  computeFlow();
  UI.startGame();
  UI.banner('Day 1', 'Gather wood and stone, then fortify the Hearth before nightfall.');
}

// ----------------------------- Day / night --------------------------------

function updateCycle(dt) {
  G.phaseTime += dt;
  if (G.phase === 'day') {
    if (G.phaseTime >= G.phaseLen) startNight();
    return;
  }
  while (G.spawnQueue.length && G.spawnQueue[0].t <= G.phaseTime) {
    const s = G.spawnQueue.shift();
    spawnEnemy(s.type, s.angle);
  }
  if (G.phaseTime >= G.phaseLen) startDay();
}

function compass(a) {
  const names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return names[(Math.round(a / (TAU / 8)) % 8 + 8) % 8];
}

function startNight(early) {
  const n = G.day;
  if (early) {
    const bonus = Math.floor((G.phaseLen - G.phaseTime) / 4);
    if (bonus > 0) { G.res.gold += bonus; UI.toast(`Eager defender: +${bonus} 🪙`); }
  }
  G.phase = 'night';
  G.phaseTime = 0;
  G.phaseLen = NIGHT_BASE_LEN + Math.min(25, n * 2);
  G.buildMode = false;

  const sides = n >= 7 ? 3 : n >= 3 ? 2 : 1;
  const base = rand(0, TAU);
  G.spawnAngles = [];
  for (let i = 0; i < sides; i++) G.spawnAngles.push(base + (i * TAU) / sides + rand(-0.4, 0.4));

  // Spend a point budget on monsters, unlocking tougher types on later nights.
  let budget = Math.floor(10 + n * 8 + n * n * 0.9);
  const pool = Object.keys(ENEMIES).filter(k => ENEMIES[k].minNight <= n && ENEMIES[k].weight > 0);
  const totalW = pool.reduce((s, k) => s + ENEMIES[k].weight, 0);
  const list = [];
  while (budget > 0) {
    let r = Math.random() * totalW, type = pool[0];
    for (const k of pool) { r -= ENEMIES[k].weight; if (r <= 0) { type = k; break; } }
    budget -= ENEMIES[type].cost;
    list.push(type);
  }
  const spawnWindow = G.phaseLen * 0.72;
  G.spawnQueue = list.map(type => ({ type, t: Math.pow(Math.random(), 1.3) * spawnWindow, angle: choice(G.spawnAngles) }));
  if (n % 5 === 0) G.spawnQueue.push({ type: 'boss', t: spawnWindow * 0.35, angle: G.spawnAngles[0] });
  G.spawnQueue.sort((a, b) => a.t - b.t);

  const dirs = [...new Set(G.spawnAngles.map(compass))].join(' and ');
  UI.banner(`Night ${n}`, n % 5 === 0 ? `A Night Horror stirs… They come from the ${dirs}!` : `The horde approaches from the ${dirs}!`, true);
}

function startDay() {
  G.stats.nights++;
  const survived = G.day;
  G.day++;
  G.phase = 'day';
  G.phaseTime = 0;
  G.phaseLen = DAY_LEN;
  G.spawnQueue = [];
  const bonus = 8 * survived;
  G.res.gold += bonus;
  regrowNodes();
  UI.banner(`Day ${G.day}`, `You survived night ${survived}! +${bonus} 🪙 — the remaining monsters burn in the sun.`);
}

function spawnEnemy(type, angle) {
  const cx = WORLD_W / 2, cy = WORLD_H / 2, R = WORLD_W / 2 - 70;
  for (let tries = 0; tries < 12; tries++) {
    const a = angle + rand(-0.3, 0.3), r = R - rand(0, 120);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (blockedTile(tileOf(x), tileOf(y))) continue;
    G.enemies.push(new Enemy(type, x, y, G.day));
    if (type === 'boss') UI.toast('⚠ A Night Horror has appeared!');
    return;
  }
}

// ----------------------------- Update -------------------------------------

function update(dt) {
  G.time += dt;
  updateCycle(dt);
  if (G.state !== 'playing') return;

  G.flowTimer -= dt;
  if (G.flowDirty || G.flowTimer <= 0) { computeFlow(); G.flowTimer = 1; }

  G.player.update(dt);
  handleBuildInput();

  for (const e of G.enemies) e.update(dt);
  separateEnemies();
  G.enemies = G.enemies.filter(e => !e.dead);
  G.bossAlive = G.enemies.some(e => e.def.boss);

  updateBuildings(dt);
  updateProjectiles(dt);
  G.effects = G.effects.filter(f => f.update(dt));
  updateParticles(dt);
  for (const n of G.nodes) if (n.shake > 0) n.shake -= dt;

  // Camera follows the player, clamped to the world.
  const p = G.player;
  const tx = clamp(p.x - viewW / 2, Math.min(0, WORLD_W - viewW), Math.max(0, WORLD_W - viewW));
  const ty = clamp(p.y - viewH / 2, Math.min(0, WORLD_H - viewH), Math.max(0, WORLD_H - viewH));
  const k = 1 - Math.pow(0.0001, dt);
  G.cam.x = lerp(G.cam.x, tx, k);
  G.cam.y = lerp(G.cam.y, ty, k);
  G.shakeAmt = Math.max(0, G.shakeAmt - dt * 30);
}

function separateEnemies() {
  const cell = 64, grid = new Map();
  for (const e of G.enemies) {
    const k = ((e.x / cell) | 0) + ((e.y / cell) | 0) * 1024;
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(e);
  }
  for (const e of G.enemies) {
    const cx = (e.x / cell) | 0, cy = (e.y / cell) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const a = grid.get(cx + ox + (cy + oy) * 1024);
      if (!a) continue;
      for (const o of a) {
        if (o.id <= e.id) continue;
        const dx = e.x - o.x, dy = e.y - o.y, rr = e.r + o.r, d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-4) continue;
        // Soft push, weighted so big monsters shove small ones aside.
        const d = Math.sqrt(d2), push = (rr - d) * 0.5, nx = dx / d, ny = dy / d;
        const me = e.r * e.r, mo = o.r * o.r, tot = me + mo;
        e.x += nx * push * (mo / tot); e.y += ny * push * (mo / tot);
        o.x -= nx * push * (me / tot); o.y -= ny * push * (me / tot);
      }
    }
  }
}

function updateBuildings(dt) {
  const p = G.player, s = p.stats;
  for (const b of [...G.buildings]) {
    if (b.dead) continue;
    b.hitFlash = Math.max(0, b.hitFlash - dt);
    const d = b.def;

    if (b.type === 'hearth' && G.phase === 'day') b.hp = Math.min(b.maxHp, b.hp + 8 * dt);

    if (d.tower) {
      b.timer -= dt * s.towerSpeed;
      let target = null, best = d.tower.range;
      for (const e of G.enemies) {
        if (e.dead) continue;
        const dd = dist(b.x, b.y, e.x, e.y);
        if (dd < best) { best = dd; target = e; }
      }
      if (target) {
        b.angle = Math.atan2(target.y - b.y, target.x - b.x);
        if (b.timer <= 0) {
          b.timer = d.tower.cd;
          const dmg = d.tower.dmg * s.towerDmg;
          if (d.tower.proj === 'arrow') {
            G.projectiles.push({ kind: 'arrow', team: 'tower', x: b.x, y: b.y, vx: Math.cos(b.angle) * 900, vy: Math.sin(b.angle) * 900,
              r: 5, life: best / 900 + 0.3, dmg, pierce: 0, hits: new Set() });
          } else {
            G.projectiles.push({ kind: 'lob', team: 'tower', sx: b.x, sy: b.y - 14, x: b.x, y: b.y, tx: target.x, ty: target.y,
              t: 0, dur: 0.75, h: 0, dmg, splash: d.tower.splash });
          }
        }
      }
    }

    if (d.trap) {
      b.timer -= dt;
      let any = false;
      for (const e of G.enemies) {
        if (e.dead || !circleRectOverlap(e.x, e.y, e.r, b.tx * TILE, b.ty * TILE, TILE, TILE)) continue;
        any = true;
        e.slowAmt = Math.max(e.slow > 0 ? e.slowAmt : 0, d.trap.slow);
        e.slow = 0.2;
        if (b.timer <= 0) damageEnemy(e, d.trap.dmg * s.towerDmg, { color: '#d0d0d0', small: true });
      }
      if (any && b.timer <= 0) { b.timer = d.trap.cd; damageBuilding(b, 3); }
    }

    if (d.aura) {
      if (!p.dead && dist(b.x, b.y, p.x, p.y) < d.aura.r) p.heal(d.aura.heal * dt, true);
      for (const o of G.buildings) {
        if (o !== b && o.hp < o.maxHp && distToBuilding(b, o) < d.aura.r) o.hp = Math.min(o.maxHp, o.hp + d.aura.repair * dt);
      }
    }
  }
}

// ----------------------------- Building input -----------------------------

function selectedSlotIsBuilding() { return !!BUILDINGS[G.buildSel]; }

function handleBuildInput() {
  if (!G.buildMode || G.player.dead) return;
  if (Input.wheel) {
    const i = BUILD_SLOTS.indexOf(G.buildSel);
    G.buildSel = BUILD_SLOTS[(i + Input.wheel + BUILD_SLOTS.length) % BUILD_SLOTS.length];
  }
  for (let i = 0; i < BUILD_KEYS.length; i++) if (Input.wasPressed(BUILD_KEYS[i])) G.buildSel = BUILD_SLOTS[i];
  if (Input.rclicked) { G.buildMode = false; return; }

  const m = mouseWorld(), tx = tileOf(m.x), ty = tileOf(m.y);
  if (!inMap(tx, ty)) return;
  const tileKey = idx(tx, ty);
  if (!Input.down) { G.lastPlacedTile = -1; return; }
  // Click to act; walls also allow click-and-drag to paint lines.
  const dragOk = selectedSlotIsBuilding() && BUILDINGS[G.buildSel].wall;
  if (!Input.clicked && !(dragOk && tileKey !== G.lastPlacedTile)) return;
  G.lastPlacedTile = tileKey;

  if (selectedSlotIsBuilding()) {
    const err = placementError(G.buildSel, tx, ty);
    if (err) { if (Input.clicked) floatText(m.x, m.y, err, '#ff8080', 13); return; }
    placeBuilding(G.buildSel, tx, ty);
    return;
  }
  const b = G.gridBld[tileKey];
  if (!b || b.type === 'hearth') {
    if (Input.clicked && b) floatText(m.x, m.y, G.buildSel === 'repair' ? 'The Hearth mends itself by day' : "Can't demolish the Hearth", '#ff8080', 13);
    return;
  }
  if (G.buildSel === 'repair') {
    if (b.hp >= b.maxHp) { floatText(m.x, m.y, 'Already intact', '#cccccc', 12); return; }
    const c = repairCost(b);
    if (!canAfford(c)) { floatText(m.x, m.y, `Need ${c.wood} 🪵`, '#ff8080', 13); return; }
    pay(c);
    b.hp = b.maxHp;
    floatText(b.x, b.y - 20, 'Repaired', '#8fff9a', 13);
    spawnParticles(b.x, b.y, 8, '#8fff9a', 80, 0.4, 3);
  } else if (G.buildSel === 'demolish') {
    const frac = 0.5 * (b.hp / b.maxHp);
    const refund = [];
    for (const k in b.paid) {
      const v = Math.floor(b.paid[k] * frac);
      if (v > 0) { G.res[k] += v; refund.push(`+${v} ${RES_ICONS[k]}`); }
    }
    destroyBuilding(b);
    if (refund.length) floatText(b.x, b.y - 20, refund.join(' '), '#e9f5c9', 13);
  }
}

// ----------------------------- Rendering ----------------------------------

function darkness() {
  const MAX = 0.84;
  if (G.phase === 'night') {
    const rem = G.phaseLen - G.phaseTime;
    return rem < 6 ? MAX * (rem / 6) : MAX;
  }
  const rem = G.phaseLen - G.phaseTime;
  if (rem < 22) return MAX * (1 - rem / 22);
  return 0;
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0c120b';
  ctx.fillRect(0, 0, viewW, viewH);

  const sx = (Math.random() - 0.5) * G.shakeAmt, sy = (Math.random() - 0.5) * G.shakeAmt;
  const camX = Math.round(G.cam.x + sx), camY = Math.round(G.cam.y + sy);
  const view = { x0: camX - 60, y0: camY - 60, x1: camX + viewW + 60, y1: camY + viewH + 60 };
  const visible = o => o.x > view.x0 && o.x < view.x1 && o.y > view.y0 && o.y < view.y1;

  ctx.save();
  ctx.translate(-camX, -camY);
  drawGround(camX, camY);

  for (const b of G.buildings) if (!b.def.solid && visible(b)) drawBuilding(ctx, b);
  for (const f of G.effects) if (f.layer === 'ground') f.draw(ctx);
  for (const b of G.buildings) if (b.def.solid && visible(b)) drawBuilding(ctx, b);
  for (const e of G.enemies) if (visible(e)) e.draw(ctx);
  G.player.draw(ctx);
  for (const n of G.nodes) if (visible(n)) drawNode(ctx, n);
  for (const pr of G.projectiles) if (visible(pr)) drawProjectile(ctx, pr);
  for (const f of G.effects) if (f.layer !== 'ground') f.draw(ctx);
  for (const p of G.particles) {
    if (!visible(p)) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawDarkness(camX, camY);

  ctx.save();
  ctx.translate(-camX, -camY);
  const dk = darkness();
  if (dk > 0.15) {
    ctx.globalAlpha = Math.min(1, dk * 1.1);
    for (const e of G.enemies) if (visible(e) && e.freeze <= 0) e.drawEyes(ctx);
    ctx.globalAlpha = 1;
  }
  drawBuildGhost();
  ctx.textAlign = 'center';
  for (const t of G.texts) {
    if (!visible(t)) continue;
    ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
    ctx.font = `bold ${t.size}px system-ui, sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawIndicators(camX, camY);
}

function drawGround(camX, camY) {
  const x0 = Math.max(0, tileOf(camX)), y0 = Math.max(0, tileOf(camY));
  const x1 = Math.min(MAP_W - 1, tileOf(camX + viewW)), y1 = Math.min(MAP_H - 1, tileOf(camY + viewH));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      ctx.fillStyle = G.groundCols[i];
      ctx.fillRect(x * TILE, y * TILE, TILE + 1, TILE + 1);
      const dec = G.groundDecor[i];
      if (!dec) continue;
      const h = hash2(x * 3, y * 5), px = x * TILE + 6 + h * 26, py = y * TILE + 8 + hash2(y, x) * 24;
      if (dec === 1) {
        ctx.strokeStyle = 'rgba(120,170,80,0.5)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - 3, py - 7); ctx.moveTo(px, py); ctx.lineTo(px + 1, py - 8);
        ctx.moveTo(px, py); ctx.lineTo(px + 4, py - 6); ctx.stroke();
      } else if (dec === 2) {
        ctx.fillStyle = h < 0.5 ? '#e8d26a' : '#d98ac9';
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(140,140,130,0.6)';
        ctx.beginPath(); ctx.ellipse(px, py, 4, 3, 0, 0, TAU); ctx.fill();
      }
    }
  }
  // World edge
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
}

function drawNode(ctx, n) {
  const sx = n.shake > 0 ? Math.sin(G.time * 80) * 2.5 : 0;
  const x = n.x + sx, y = n.y;
  const k = 0.75 + 0.25 * (n.amount / n.def.amount);
  if (n.type === 'tree') {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(n.x + 4, y + 10, 20 * k, 9 * k, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5a3d22'; ctx.fillRect(n.x - 3.5, y - 2, 7, 13);
    const s = n.seed;
    ctx.fillStyle = s < 0.5 ? '#245a2e' : '#2c5f26';
    ctx.beginPath(); ctx.arc(x, y - 8, 20 * k, 0, TAU); ctx.fill();
    ctx.fillStyle = s < 0.5 ? '#2f7a3b' : '#3b7a2f';
    ctx.beginPath(); ctx.arc(x - 4, y - 12, 14 * k, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(160,220,120,0.25)';
    ctx.beginPath(); ctx.arc(x - 7, y - 16, 6 * k, 0, TAU); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(n.x + 3, y + 9, 18 * k, 7 * k, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = n.type === 'gold' ? '#6d6a60' : '#7d828a';
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU, r = (14 + hash2(n.tx + i, n.ty) * 5) * k;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.8;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.ellipse(x - 4, y - 5, 7 * k, 4 * k, -0.4, 0, TAU); ctx.fill();
    if (n.type === 'gold') {
      ctx.fillStyle = '#f3d25a';
      for (let i = 0; i < 4; i++) {
        const a = n.seed * 10 + i * 1.7, r = 7 * k;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r - 4); ctx.lineTo(x + Math.cos(a) * r + 3, y + Math.sin(a) * r);
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r + 3); ctx.lineTo(x + Math.cos(a) * r - 3, y + Math.sin(a) * r); ctx.fill();
      }
    }
  }
}

function drawBuilding(ctx, b) {
  const x = b.tx * TILE, y = b.ty * TILE, S = TILE * b.size, cx = b.x, cy = b.y;
  const flash = b.hitFlash > 0;
  switch (b.type) {
    case 'wall': {
      ctx.fillStyle = flash ? '#fff' : '#7b5230'; ctx.fillRect(x + 1, y + 1, S - 2, S - 2);
      ctx.fillStyle = '#946538';
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 3 + i * 9, y + 3, 7, S - 6);
      ctx.fillStyle = '#5a3a20'; ctx.fillRect(x + 1, y + 12, S - 2, 3); ctx.fillRect(x + 1, y + 26, S - 2, 3);
      break;
    }
    case 'stonewall': {
      ctx.fillStyle = flash ? '#fff' : '#6c7078'; ctx.fillRect(x + 1, y + 1, S - 2, S - 2);
      ctx.fillStyle = '#8d929b';
      for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
        const off = r % 2 ? 9 : 0;
        ctx.fillRect(x + 3 + c * 18 + off - (r % 2 && c ? 18 : 0), y + 3 + r * 12, 15, 10);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, S - 2, S - 2);
      break;
    }
    case 'gate': {
      ctx.fillStyle = flash ? '#fff' : '#5c3b20'; ctx.fillRect(x + 1, y + 1, S - 2, S - 2);
      ctx.fillStyle = '#7a5230'; ctx.fillRect(x + 4, y + 4, S - 8, S - 8);
      ctx.fillStyle = '#3a3a40'; ctx.fillRect(x + 1, y + 9, S - 2, 4); ctx.fillRect(x + 1, y + 27, S - 2, 4);
      ctx.fillStyle = '#c9b46a'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, TAU); ctx.fill();
      break;
    }
    case 'arrowtower': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 4, y + 6, S, S);
      ctx.fillStyle = flash ? '#fff' : '#70747c'; ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
      ctx.fillStyle = '#8a6a44'; ctx.beginPath(); ctx.arc(cx, cy, 13, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.angle);
      ctx.fillStyle = '#4a3420'; ctx.fillRect(-3, -3, 20, 6);
      ctx.strokeStyle = '#c9a36b'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(10, 0, 9, -1.3, 1.3); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'firetower': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 4, y + 6, S, S);
      ctx.fillStyle = flash ? '#fff' : '#5d5550'; ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
      ctx.fillStyle = '#2b2522'; ctx.beginPath(); ctx.arc(cx, cy, 13, 0, TAU); ctx.fill();
      drawFlame(cx, cy, 11);
      break;
    }
    case 'spikes': {
      ctx.fillStyle = 'rgba(60,50,40,0.7)'; ctx.fillRect(x + 3, y + 3, S - 6, S - 6);
      ctx.fillStyle = flash ? '#fff' : '#c2c6cc';
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const px = x + 8 + c * 12, py = y + 10 + r * 11;
        ctx.beginPath(); ctx.moveTo(px, py - 5); ctx.lineTo(px + 4, py + 3); ctx.lineTo(px - 4, py + 3); ctx.fill();
      }
      break;
    }
    case 'torch': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(cx + 2, cy + 12, 7, 3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = flash ? '#fff' : '#6b4a2b'; ctx.fillRect(cx - 2.5, cy - 6, 5, 18);
      drawFlame(cx, cy - 10, 6);
      break;
    }
    case 'shrine': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 4, y + 6, S, S);
      ctx.fillStyle = flash ? '#fff' : '#c9cbc0'; ctx.fillRect(x + 3, y + 3, S - 6, S - 6);
      const pulse = 0.6 + Math.sin(G.time * 3) * 0.3;
      ctx.fillStyle = `rgba(90,230,130,${pulse})`;
      ctx.beginPath(); ctx.moveTo(cx, cy - 13); ctx.lineTo(cx + 8, cy); ctx.lineTo(cx, cy + 13); ctx.lineTo(cx - 8, cy); ctx.fill();
      ctx.strokeStyle = `rgba(90,230,130,${pulse * 0.25})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, b.def.aura.r, 0, TAU); ctx.stroke();
      break;
    }
    case 'hearth': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(cx + 4, cy + 6, S / 2, 0, TAU); ctx.fill();
      ctx.fillStyle = flash ? '#fff' : '#77706a'; ctx.beginPath(); ctx.arc(cx, cy, S / 2 - 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#958c84';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (S / 2 - 8), cy + Math.sin(a) * (S / 2 - 8), 7, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#2b1d14'; ctx.beginPath(); ctx.arc(cx, cy, S / 2 - 16, 0, TAU); ctx.fill();
      drawFlame(cx, cy, 22 * (0.5 + 0.5 * b.hp / b.maxHp));
      break;
    }
  }
  if (b.hp < b.maxHp && b.type !== 'hearth') {
    const w = S - 6;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x + 3, y - 7, w, 4);
    const f = b.hp / b.maxHp;
    ctx.fillStyle = f > 0.5 ? '#7bd36b' : f > 0.25 ? '#e0c24a' : '#e05a4a';
    ctx.fillRect(x + 3, y - 7, w * f, 4);
  }
}

function drawFlame(x, y, s) {
  const t = G.time;
  const layers = [['#ff6a1a', 1], ['#ffa83a', 0.7], ['#fff0a0', 0.38]];
  for (const [col, k] of layers) {
    ctx.fillStyle = col;
    ctx.beginPath();
    const fl = Math.sin(t * 14 + x) * 0.12 + 1;
    ctx.moveTo(x - s * k, y + s * 0.3 * k);
    ctx.quadraticCurveTo(x - s * k * 0.9, y - s * k * 0.6, x + Math.sin(t * 9 + y) * s * 0.2, y - s * 1.5 * k * fl);
    ctx.quadraticCurveTo(x + s * k * 0.9, y - s * k * 0.6, x + s * k, y + s * 0.3 * k);
    ctx.quadraticCurveTo(x, y + s * 0.8 * k, x - s * k, y + s * 0.3 * k);
    ctx.fill();
  }
}

function collectLights() {
  const L = [], p = G.player;
  if (!p.dead) L.push({ x: p.x, y: p.y, r: p.def.light });
  for (const b of G.buildings) if (b.def.light) L.push({ x: b.x, y: b.y, r: b.def.light * (b.type === 'hearth' ? 0.8 + 0.2 * b.hp / b.maxHp : 1), warm: true });
  for (const pr of G.projectiles) if (pr.light) L.push({ x: pr.x, y: pr.y, r: pr.light });
  for (const pr of G.projectiles) if (pr.kind === 'lob') L.push({ x: pr.x, y: pr.y - pr.h, r: 70 });
  for (const f of G.effects) if (f.light) { const l = f.light(); if (l && l.r > 1) L.push(l); }
  return L;
}

function drawDarkness(camX, camY) {
  const dk = darkness();
  if (dk <= 0.01) return;
  const dc = darkCtx, S = DARK_SCALE, W = darkCanvas.width, H = darkCanvas.height;
  dc.globalCompositeOperation = 'source-over';
  dc.clearRect(0, 0, W, H);
  dc.fillStyle = `rgba(6,10,30,${dk})`;
  dc.fillRect(0, 0, W, H);
  dc.globalCompositeOperation = 'destination-out';
  const lights = collectLights();
  for (const l of lights) {
    const flick = l.warm ? 1 + Math.sin(G.time * 11 + l.x) * 0.025 : 1;
    const x = (l.x - camX) * S, y = (l.y - camY) * S, r = l.r * S * flick;
    if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
    const g = dc.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.7)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dc.fillStyle = g;
    dc.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.drawImage(darkCanvas, 0, 0, viewW, viewH);

  // Warm glow around fires.
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    if (!l.warm) continue;
    const x = l.x - camX, y = l.y - camY, r = l.r * 0.7;
    if (x + r < 0 || y + r < 0 || x - r > viewW || y - r > viewH) continue;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,140,50,${0.1 * dk})`);
    g.addColorStop(1, 'rgba(255,140,50,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawBuildGhost() {
  if (!G.buildMode || G.player.dead) return;
  const p = G.player;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.beginPath(); ctx.arc(p.x, p.y, BUILD_RANGE, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);

  const m = mouseWorld(), tx = tileOf(m.x), ty = tileOf(m.y);
  if (!inMap(tx, ty)) return;
  if (selectedSlotIsBuilding()) {
    const def = BUILDINGS[G.buildSel], size = def.size || 1;
    const ok = !placementError(G.buildSel, tx, ty);
    ctx.fillStyle = ok ? 'rgba(120,255,140,0.3)' : 'rgba(255,90,90,0.3)';
    ctx.strokeStyle = ok ? 'rgba(120,255,140,0.9)' : 'rgba(255,90,90,0.9)';
    ctx.fillRect(tx * TILE, ty * TILE, TILE * size, TILE * size);
    ctx.strokeRect(tx * TILE + 1, ty * TILE + 1, TILE * size - 2, TILE * size - 2);
    const r = def.tower ? def.tower.range : def.aura ? def.aura.r : 0;
    if (r) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc((tx + 0.5) * TILE, (ty + 0.5) * TILE, r, 0, TAU); ctx.stroke();
    }
    ctx.font = '20px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.8;
    ctx.fillText(def.icon, (tx + 0.5) * TILE, (ty + 0.5) * TILE);
    ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
  } else {
    const b = G.gridBld[idx(tx, ty)];
    const col = G.buildSel === 'repair' ? '120,200,255' : '255,120,80';
    ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 2;
    if (b) ctx.strokeRect(b.tx * TILE, b.ty * TILE, b.size * TILE, b.size * TILE);
    else ctx.strokeRect(tx * TILE, ty * TILE, TILE, TILE);
    if (b && b.type !== 'hearth') {
      let label;
      if (G.buildSel === 'repair') label = b.hp >= b.maxHp ? 'Intact' : `Repair: ${repairCost(b).wood} 🪵`;
      else {
        const frac = 0.5 * (b.hp / b.maxHp);
        label = 'Refund: ' + Object.keys(b.paid).map(k => `${Math.floor(b.paid[k] * frac)} ${RES_ICONS[k]}`).join(' ');
      }
      ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(label, b.x, b.ty * TILE - 10);
      ctx.fillStyle = '#fff'; ctx.fillText(label, b.x, b.ty * TILE - 10);
    }
  }
}

// Arrows at the screen edge pointing toward incoming monsters.
function drawIndicators(camX, camY) {
  if (G.phase !== 'night') return;
  const cx = viewW / 2, cy = viewH / 2, pad = 34;
  const targets = [];
  for (const a of G.spawnAngles) targets.push({ x: WORLD_W / 2 + Math.cos(a) * (WORLD_W / 2 - 100), y: WORLD_H / 2 + Math.sin(a) * (WORLD_H / 2 - 100), col: '#ff5a4a', s: 1 });
  for (const e of G.enemies) if (e.def.boss) targets.push({ x: e.x, y: e.y, col: '#ff3fa0', s: 1.4 });
  for (const t of targets) {
    const sx = t.x - camX, sy = t.y - camY;
    if (sx > 0 && sy > 0 && sx < viewW && sy < viewH) continue;
    const a = Math.atan2(sy - cy, sx - cx);
    const k = Math.min((viewW / 2 - pad) / Math.abs(Math.cos(a) || 1e-6), (viewH / 2 - pad) / Math.abs(Math.sin(a) || 1e-6));
    const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.globalAlpha = 0.6 + Math.sin(G.time * 6) * 0.3;
    ctx.fillStyle = t.col;
    ctx.beginPath(); ctx.moveTo(14 * t.s, 0); ctx.lineTo(-8 * t.s, -10 * t.s); ctx.lineTo(-8 * t.s, 10 * t.s); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

// ----------------------------- Minimap ------------------------------------

let minimapBase = null;
function drawMinimap(mm) {
  const mctx = mm.getContext('2d'), W = mm.width, s = W / WORLD_W;
  if (!minimapBase || G.minimapDirty) {
    minimapBase = minimapBase || document.createElement('canvas');
    minimapBase.width = minimapBase.height = W;
    const b = minimapBase.getContext('2d');
    b.fillStyle = '#2c4426'; b.fillRect(0, 0, W, W);
    const ts = TILE * s;
    for (const n of G.nodes) {
      b.fillStyle = n.type === 'tree' ? '#1d5a26' : n.type === 'rock' ? '#8a8f98' : '#f3d25a';
      b.fillRect(n.tx * ts, n.ty * ts, Math.max(1.5, ts), Math.max(1.5, ts));
    }
    for (const bl of G.buildings) {
      b.fillStyle = bl.type === 'hearth' ? '#ff9a3a' : bl.def.tower ? '#e8e8e8' : '#b08a5a';
      b.fillRect(bl.tx * ts, bl.ty * ts, Math.max(2, bl.size * ts), Math.max(2, bl.size * ts));
    }
    G.minimapDirty = false;
  }
  mctx.drawImage(minimapBase, 0, 0);
  const dk = darkness();
  if (dk > 0) { mctx.fillStyle = `rgba(6,10,30,${dk * 0.5})`; mctx.fillRect(0, 0, W, W); }
  for (const e of G.enemies) {
    mctx.fillStyle = e.def.boss ? '#ff3fa0' : '#ff4a3a';
    const r = e.def.boss ? 3 : 1.5;
    mctx.fillRect(e.x * s - r, e.y * s - r, r * 2, r * 2);
  }
  const p = G.player;
  mctx.strokeStyle = 'rgba(255,255,255,0.5)'; mctx.lineWidth = 1;
  mctx.strokeRect(G.cam.x * s, G.cam.y * s, viewW * s, viewH * s);
  if (!p.dead) {
    mctx.fillStyle = '#ffffff';
    mctx.beginPath(); mctx.arc(p.x * s, p.y * s, 3, 0, TAU); mctx.fill();
  }
}

// ----------------------------- Main loop ----------------------------------

function handleGlobalKeys() {
  if (G.state === 'menu' || G.state === 'over') return;
  if (Input.wasPressed('Escape') || Input.wasPressed('KeyP')) {
    if (G.state === 'talents') UI.closeTalents();
    else if (G.state === 'paused') UI.resume();
    else if (G.buildMode && Input.wasPressed('Escape')) G.buildMode = false;
    else UI.pause();
    return;
  }
  if (Input.wasPressed('KeyT')) {
    if (G.state === 'talents') UI.closeTalents();
    else if (G.state === 'playing') UI.openTalents();
    return;
  }
  if (G.state !== 'playing') return;
  if (Input.wasPressed('KeyB')) G.buildMode = !G.buildMode && !G.player.dead;
  if (Input.wasPressed('KeyN') && G.phase === 'day') startNight(true);
  // Number keys outside build mode jump straight into build mode with that slot.
  if (!G.buildMode) {
    for (let i = 0; i < BUILD_KEYS.length; i++) {
      if (Input.wasPressed(BUILD_KEYS[i])) { G.buildMode = true; G.buildSel = BUILD_SLOTS[i]; Input.pressed.delete(BUILD_KEYS[i]); }
    }
  }
}

function gameOver() {
  G.state = 'over';
  UI.gameOver();
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  handleGlobalKeys();
  if (G.state === 'playing') update(dt);
  if (G.state !== 'menu') render();
  UI.update();
  Input.endFrame();
  requestAnimationFrame(frame);
}

function boot() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  darkCanvas = document.createElement('canvas');
  darkCtx = darkCanvas.getContext('2d');
  resize();
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'playing') UI.pause(); });
  Input.init(canvas);
  UI.init();
  requestAnimationFrame(frame);
}

addEventListener('DOMContentLoaded', boot);
