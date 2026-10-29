'use strict';
// ---------------------------------------------------------------------------
// Basic attacks, class spells and the visual/area effects they create.
// Effects are plain objects: update(dt) -> keep alive?, draw(ctx), optional light(), layer.
// ---------------------------------------------------------------------------

function addEffect(fx) { G.effects.push(fx); return fx; }

// Clamp a cast target to a max distance from the player.
function castPoint(p, tx, ty, max) {
  const d = dist(p.x, p.y, tx, ty);
  if (d <= max) return { x: tx, y: ty };
  const a = Math.atan2(ty - p.y, tx - p.x);
  return { x: p.x + Math.cos(a) * max, y: p.y + Math.sin(a) * max };
}

function basicAttack(p) {
  const b = p.def.basic, s = p.stats;
  if (b.type === 'melee') {
    const range = b.range * s.rangeMul, arc = b.arc * s.arcMul;
    p.swingT = 0.16;
    for (const e of G.enemies) {
      if (e.dead || dist(p.x, p.y, e.x, e.y) > range + e.r) continue;
      if (Math.abs(angleDiff(p.angle, Math.atan2(e.y - p.y, e.x - p.x))) > arc / 2) continue;
      dealPlayerDamage(e, b.dmg, { knock: 160, fromX: p.x, fromY: p.y });
    }
    // Harvest the closest node in the swing.
    let best = null, bd = Infinity;
    for (const n of nodesNear(p.x, p.y, range + 20)) {
      const d = dist(p.x, p.y, n.x, n.y);
      if (d > range + n.r || Math.abs(angleDiff(p.angle, Math.atan2(n.y - p.y, n.x - p.x))) > arc / 2) continue;
      if (d < bd) { bd = d; best = n; }
    }
    if (best) harvestNode(best, b.dmg * s.dmgMul);
    addEffect(swingEffect(p, range, arc));
    return;
  }
  const count = 1 + s.extraProj, spread = 0.14;
  for (let i = 0; i < count; i++) {
    const a = p.angle + (i - (count - 1) / 2) * spread;
    if (b.type === 'bolt') {
      G.projectiles.push({ kind: 'bolt', team: 'player', x: p.x, y: p.y, vx: Math.cos(a) * b.speed, vy: Math.sin(a) * b.speed,
        r: 6, life: 0.9, dmg: b.dmg, pierce: s.pierce, hits: new Set(), harvest: true, color: '#c4a8ff', trail: '#9f7bff', light: 70 });
    } else {
      G.projectiles.push({ kind: 'arrow', team: 'player', x: p.x, y: p.y, vx: Math.cos(a) * b.speed, vy: Math.sin(a) * b.speed,
        r: 5, life: 0.7, dmg: b.dmg, pierce: s.pierce, hits: new Set(), harvest: true });
    }
  }
}

function nodesNear(x, y, r) {
  const out = [];
  const x0 = tileOf(x - r), x1 = tileOf(x + r), y0 = tileOf(y - r), y1 = tileOf(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!inMap(tx, ty)) continue;
    const n = G.gridNode[idx(tx, ty)];
    if (n) out.push(n);
  }
  return out;
}

const SPELLS = {
  // ------------------------------ Mobility ------------------------------
  roll(p) {
    const mv = p.moveInput();
    const a = mv.x || mv.y ? Math.atan2(mv.y, mv.x) : p.angle;
    p.startDash(a, 560, 0.26, { kind: 'roll', invuln: true });
  },

  blink(p, tx, ty) {
    const a = Math.atan2(ty - p.y, tx - p.x);
    for (let d = Math.min(240, dist(p.x, p.y, tx, ty)); d > 10; d -= 10) {
      const nx = p.x + Math.cos(a) * d, ny = p.y + Math.sin(a) * d;
      if (circleBlocked(nx, ny, p.r, true)) continue;
      spawnParticles(p.x, p.y, 18, '#9fe7ff', 140, 0.5, 3);
      p.x = nx; p.y = ny;
      p.invuln = Math.max(p.invuln, 0.25);
      spawnParticles(p.x, p.y, 18, '#c4a8ff', 140, 0.5, 3);
      addEffect(ringEffect(p.x, p.y, 40, '#9fe7ff', 0.3));
      return true;
    }
    return false;
  },

  // ------------------------------ Warrior -------------------------------
  charge(p, tx, ty) {
    p.startDash(Math.atan2(ty - p.y, tx - p.x), 820, 0.32, { kind: 'charge', dmg: 34, stun: 0.9, invuln: true });
  },

  whirlwind(p) {
    p.whirl = p.stats.flags.has('endless') ? 2.6 : 1.6;
    p.whirlTick = 0;
  },

  battlecry(p) {
    const r = 190 * p.stats.aoe;
    p.heal(p.stats.maxHp * 0.3);
    p.buffs.cry = 8;
    for (const e of enemiesInRadius(p.x, p.y, r)) dealPlayerDamage(e, 20, { knock: 520, fromX: p.x, fromY: p.y });
    addEffect(ringEffect(p.x, p.y, r, '#f2c879', 0.5));
    shake(7);
  },

  // ------------------------------ Mage ----------------------------------
  fireball(p) {
    const a = p.angle, s = p.stats;
    G.projectiles.push({
      kind: 'fireball', team: 'player', x: p.x, y: p.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520,
      r: 9, life: 1.2, dmg: 42, pierce: 0, hits: new Set(), color: '#ff8a3a', trail: '#ffb347', light: 130,
      onHit(pr) {
        explode(pr.x, pr.y, 90 * s.aoe, pr.dmg, { team: 'player', burn: 10, color: '#ff8a3a', knock: 120 });
        pr.life = 0;
        shake(4);
      },
    });
  },

  frostnova(p) {
    const s = p.stats, r = 170 * s.aoe;
    for (const e of enemiesInRadius(p.x, p.y, r)) {
      e.freeze = Math.max(e.freeze, (e.def.boss ? 0.8 : 2) + s.freezeBonus);
      dealPlayerDamage(e, 18, { color: '#a8e0ff' });
    }
    addEffect(ringEffect(p.x, p.y, r, '#a8e0ff', 0.5));
    spawnParticles(p.x, p.y, 40, '#d8f4ff', r * 2.5, 0.6, 3);
  },

  meteor(p, tx, ty) {
    const s = p.stats, c = castPoint(p, tx, ty, 600);
    addEffect(meteorEffect(c.x, c.y, 0.9, 170 * s.aoe, 160));
    if (s.flags.has('twin')) {
      for (let i = 0; i < 2; i++) {
        const a = rand(0, TAU), d = rand(90, 150);
        addEffect(meteorEffect(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, 1.25 + i * 0.35, 130 * s.aoe, 110));
      }
    }
  },

  // ------------------------------ Ranger --------------------------------
  volley(p) {
    const barrage = p.stats.flags.has('barrage');
    const n = barrage ? 13 : 7, spread = barrage ? 1.2 : 0.9;
    for (let i = 0; i < n; i++) {
      const a = p.angle + (i / (n - 1) - 0.5) * spread;
      G.projectiles.push({ kind: 'arrow', team: 'player', x: p.x, y: p.y, vx: Math.cos(a) * 820, vy: Math.sin(a) * 820,
        r: 5, life: 0.6, dmg: 14, pierce: p.stats.pierce + (barrage ? 2 : 0), hits: new Set(), knock: 120 });
    }
  },

  snare(p, tx, ty) {
    const c = castPoint(p, tx, ty, 320);
    const traps = G.effects.filter(f => f.kind === 'snare' && !f.done);
    if (traps.length >= 4) traps[0].done = true;
    addEffect(snareEffect(c.x, c.y, p.stats.flags.has('bigtrap')));
  },

  rain(p, tx, ty) {
    const c = castPoint(p, tx, ty, 650);
    addEffect(rainEffect(c.x, c.y, 150 * p.stats.aoe, 4));
  },
};

// ----------------------------- Effects ------------------------------------

function swingEffect(p, range, arc) {
  return {
    t: 0, life: 0.16, layer: 'top',
    update(dt) { this.t += dt; return this.t < this.life; },
    draw(ctx) {
      const k = this.t / this.life;
      ctx.save();
      ctx.globalAlpha = 0.45 * (1 - k);
      ctx.fillStyle = '#fff1d0';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, range, p.angle - arc / 2, p.angle - arc / 2 + arc * Math.min(1, k * 1.6));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}

function ringEffect(x, y, r, color, life) {
  return {
    t: 0, life, layer: 'top',
    update(dt) { this.t += dt; return this.t < this.life; },
    draw(ctx) {
      const k = this.t / this.life;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = color; ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(x, y, r * (0.3 + 0.7 * k), 0, TAU); ctx.stroke();
      ctx.restore();
    },
  };
}

function blastEffect(x, y, r, color) {
  return {
    t: 0, life: 0.35, layer: 'top',
    update(dt) { this.t += dt; return this.t < this.life; },
    draw(ctx) {
      const k = this.t / this.life;
      ctx.save();
      ctx.globalAlpha = 0.55 * (1 - k);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, r * (0.4 + 0.6 * k), 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.8 * (1 - k);
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath(); ctx.arc(x, y, r * 0.35 * (1 - k), 0, TAU); ctx.fill();
      ctx.restore();
    },
    light() { return { x, y, r: r * 2.2 * (1 - this.t / this.life) }; },
  };
}

function telegraphEffect(ent, r, life, color) {
  return {
    t: 0, life, layer: 'ground',
    update(dt) { this.t += dt; return this.t < this.life && !ent.dead; },
    draw(ctx) {
      const k = this.t / this.life;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(ent.x, ent.y, r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(ent.x, ent.y, r * k, 0, TAU); ctx.fill();
      ctx.restore();
    },
  };
}

function meteorEffect(x, y, delay, r, dmg) {
  return {
    t: 0, layer: 'top', done: false,
    update(dt) {
      this.t += dt;
      if (this.t >= delay && !this.done) {
        this.done = true;
        explode(x, y, r, dmg, { team: 'player', burn: 12, color: '#ff6a2a', knock: 260 });
        shake(14);
        addEffect(scorchEffect(x, y, r * 0.8));
      }
      return !this.done;
    },
    draw(ctx) {
      const k = Math.min(1, this.t / delay);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,110,50,0.85)'; ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,90,30,0.15)';
      ctx.beginPath(); ctx.arc(x, y, r * k, 0, TAU); ctx.fill();
      const mx = x - (1 - k) * 260, my = y - (1 - k) * 620;
      ctx.strokeStyle = 'rgba(255,170,80,0.6)'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(mx - 50, my - 120); ctx.lineTo(mx, my); ctx.stroke();
      ctx.fillStyle = '#ffcc66';
      ctx.beginPath(); ctx.arc(mx, my, 16, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff4c0';
      ctx.beginPath(); ctx.arc(mx, my, 8, 0, TAU); ctx.fill();
      ctx.restore();
    },
    light() {
      const k = Math.min(1, this.t / delay);
      return { x: x - (1 - k) * 260, y: y - (1 - k) * 620, r: 160 };
    },
  };
}

function scorchEffect(x, y, r) {
  return {
    t: 0, life: 6, layer: 'ground',
    update(dt) { this.t += dt; return this.t < this.life; },
    draw(ctx) {
      ctx.save();
      ctx.globalAlpha = 0.45 * (1 - this.t / this.life);
      ctx.fillStyle = '#1b120c';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.restore();
    },
  };
}

function snareEffect(x, y, big) {
  return {
    kind: 'snare', t: 0, life: 45, layer: 'ground', done: false,
    update(dt) {
      this.t += dt;
      if (this.done || this.t > this.life) return false;
      for (const e of G.enemies) {
        if (e.dead || dist(x, y, e.x, e.y) > e.r + 18) continue;
        this.done = true;
        for (const o of enemiesInRadius(x, y, 80)) o.root = Math.max(o.root, o.def.boss ? 0.6 : 1.8);
        addEffect(poisonCloud(x, y, big ? 135 : 90, big ? 8 : 4));
        spawnParticles(x, y, 20, '#9be35b', 150, 0.6, 4);
        break;
      }
      return !this.done;
    },
    draw(ctx) {
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = '#a7c86a'; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.stroke();
      ctx.fillStyle = `rgba(155,227,91,${0.5 + Math.sin(G.time * 5) * 0.3})`;
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
      ctx.restore();
    },
  };
}

function poisonCloud(x, y, r, life) {
  return {
    t: 0, tick: 0, layer: 'top',
    update(dt) {
      this.t += dt; this.tick -= dt;
      if (this.tick <= 0) {
        this.tick = 0.5;
        for (const e of enemiesInRadius(x, y, r)) dealPlayerDamage(e, 8, { noCrit: true, color: '#9be35b', small: true });
      }
      if (Math.random() < 0.5) {
        const a = rand(0, TAU), d = rand(0, r);
        spawnParticles(x + Math.cos(a) * d, y + Math.sin(a) * d, 1, 'rgba(140,210,80,0.6)', 15, 1, 8);
      }
      return this.t < life;
    },
    draw(ctx) {
      const fade = Math.min(1, (life - this.t) / 0.6, this.t / 0.3);
      ctx.save();
      ctx.globalAlpha = 0.3 * fade;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, '#9be35b'); g.addColorStop(1, 'rgba(90,150,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.restore();
    },
  };
}

function rainEffect(x, y, r, life) {
  return {
    t: 0, tick: 0, layer: 'top', drops: [],
    update(dt) {
      this.t += dt; this.tick -= dt;
      if (this.tick <= 0 && this.t < life) {
        this.tick = 0.15;
        for (const e of enemiesInRadius(x, y, r)) dealPlayerDamage(e, 5, { small: true });
      }
      if (this.t < life) {
        for (let i = 0; i < 4; i++) {
          const a = rand(0, TAU), d = Math.sqrt(Math.random()) * r;
          this.drops.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, t: 0 });
        }
      }
      for (const dr of this.drops) dr.t += dt;
      this.drops = this.drops.filter(dr => dr.t < 0.25);
      return this.t < life || this.drops.length > 0;
    },
    draw(ctx) {
      ctx.save();
      ctx.strokeStyle = 'rgba(217,232,106,0.35)'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#efe6c4'; ctx.lineWidth = 1.5;
      for (const dr of this.drops) {
        const k = dr.t / 0.25, h = (1 - k) * 80;
        ctx.beginPath(); ctx.moveTo(dr.x - 6, dr.y - h - 14); ctx.lineTo(dr.x, dr.y - h); ctx.stroke();
      }
      ctx.restore();
    },
  };
}
