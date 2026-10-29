'use strict';
// ---------------------------------------------------------------------------
// Player, monsters, projectiles, particles and the damage pipeline.
// ---------------------------------------------------------------------------

function computeStats(p) {
  const s = { ...BASE_STATS, flags: new Set() };
  s.maxHp = p.def.hp;
  s.regen = p.def.regen;
  for (const tree of TALENTS[p.cls]) {
    for (const t of tree.talents) {
      const rank = p.talents[t.id] || 0;
      if (!rank) continue;
      if (t.mods) for (const k in t.mods) s[k] += t.mods[k] * rank;
      if (t.flag) s.flags.add(t.flag);
    }
  }
  if (s.flags.has('sentry')) s.towerSpeed += 0.3;
  s.cdr = Math.min(0.6, s.cdr);
  s.armor = Math.min(0.6, s.armor);
  return s;
}

class Player {
  constructor(cls) {
    this.cls = cls;
    this.def = CLASSES[cls];
    this.r = 14;
    this.x = G.hearth.x;
    this.y = G.hearth.y + 90;
    this.level = 1; this.xp = 0; this.points = 0; this.talents = {};
    this.cds = {}; this.buffs = {};
    this.angle = 0; this.atkTimer = 0; this.swingT = 0;
    this.dash = null; this.whirl = 0; this.whirlTick = 0;
    this.invuln = 0; this.hitFlash = 0; this.walk = 0;
    this.dead = false; this.respawn = 0;
    this.stats = null;
    this.recalc();
    this.hp = this.stats.maxHp;
  }

  recalc() {
    const oldMax = this.stats ? this.stats.maxHp : null;
    this.stats = computeStats(this);
    if (oldMax !== null) this.hp += Math.max(0, this.stats.maxHp - oldMax);
    this.hp = Math.min(this.hp, this.stats.maxHp);
  }

  get xpNext() { return Math.floor(20 + this.level * 14 + this.level * this.level * 1.5); }

  gainXp(n) {
    this.xp += n;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.points++;
      this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * 0.25);
      floatText(this.x, this.y - 30, 'LEVEL UP!', '#ffe27a', 20, 1.6);
      spawnParticles(this.x, this.y, 30, '#ffe27a', 200, 0.8, 3);
      addEffect(ringEffect(this.x, this.y, 90, '#ffe27a', 0.5));
      UI.toast(`Level ${this.level}! Talent point available — press ${Input.label('KeyT')}`);
    }
  }

  heal(n, silent) {
    if (this.dead || n <= 0) return;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    if (!silent && this.hp - before >= 1) floatText(this.x, this.y - 24, `+${Math.round(this.hp - before)}`, '#6dff8a', 14);
  }

  hurt(dmg, src) {
    if (this.dead || this.invuln > 0) return;
    const s = this.stats;
    dmg *= 1 - s.armor;
    if (this.buffs.cry && s.flags.has('unbreakable')) dmg *= 0.5;
    this.hp -= dmg;
    this.hitFlash = 0.12;
    floatText(this.x, this.y - 22, Math.round(dmg), '#ff5a5a', 15);
    shake(Math.min(8, 2 + dmg * 0.2));
    if (src && src instanceof Enemy && s.thorns > 0 && !src.dead) damageEnemy(src, s.thorns, { color: '#9be36b' });
    if (this.hp <= 0) this.die();
  }

  die() {
    this.dead = true;
    this.hp = 0;
    this.respawn = 8;
    this.dash = null; this.whirl = 0;
    spawnParticles(this.x, this.y, 40, this.def.color, 220, 1, 4);
    shake(12);
    G.stats.deaths++;
    UI.toast('You have fallen! The Hearth will revive you…');
  }

  revive() {
    this.dead = false;
    this.hp = this.stats.maxHp;
    this.x = G.hearth.x; this.y = G.hearth.y + 70;
    collideWorld(this, true);
    this.invuln = 2.5;
    addEffect(ringEffect(this.x, this.y, 80, '#ffd27a', 0.6));
  }

  startDash(angle, speed, time, opts) {
    this.dash = { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, t: time, hits: new Set(), ...opts };
    if (opts.invuln) this.invuln = Math.max(this.invuln, time + 0.05);
  }

  moveInput() {
    let ix = 0, iy = 0;
    if (Input.isDown('KeyA') || Input.isDown('ArrowLeft')) ix -= 1;
    if (Input.isDown('KeyD') || Input.isDown('ArrowRight')) ix += 1;
    if (Input.isDown('KeyW') || Input.isDown('ArrowUp')) iy -= 1;
    if (Input.isDown('KeyS') || Input.isDown('ArrowDown')) iy += 1;
    const l = Math.hypot(ix, iy);
    return l ? { x: ix / l, y: iy / l } : { x: 0, y: 0 };
  }

  update(dt) {
    if (this.dead) {
      this.respawn -= dt;
      if (this.respawn <= 0) this.revive();
      return;
    }
    const s = this.stats;
    for (const k in this.cds) this.cds[k] = Math.max(0, this.cds[k] - dt);
    for (const k in this.buffs) { this.buffs[k] -= dt; if (this.buffs[k] <= 0) delete this.buffs[k]; }
    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.atkTimer -= dt;
    this.swingT = Math.max(0, this.swingT - dt);

    let regen = s.regen;
    if (dist(this.x, this.y, G.hearth.x, G.hearth.y) < 200) regen += 4;
    this.hp = Math.min(s.maxHp, this.hp + regen * dt);

    const m = mouseWorld();
    this.angle = Math.atan2(m.y - this.y, m.x - this.x);

    // Movement / dashing
    if (this.dash) {
      const d = this.dash;
      this.x += d.vx * dt; this.y += d.vy * dt;
      d.t -= dt;
      if (d.kind === 'charge') {
        for (const e of G.enemies) {
          if (d.hits.has(e) || dist(e.x, e.y, this.x, this.y) > e.r + this.r + 10) continue;
          d.hits.add(e);
          dealPlayerDamage(e, d.dmg, { knock: 260, fromX: this.x, fromY: this.y });
          e.stun = Math.max(e.stun, d.stun);
        }
        if (Math.random() < 0.8) spawnParticles(this.x, this.y, 1, '#f2c879', 40, 0.3, 3);
      } else {
        spawnParticles(this.x, this.y + 8, 1, 'rgba(220,220,200,0.6)', 30, 0.3, 4);
      }
      const hitWall = collideWorld(this, true);
      if (d.t <= 0 || (hitWall && d.kind === 'charge')) {
        if (d.kind === 'charge' && s.flags.has('seismic')) {
          explode(this.x, this.y, 120 * s.aoe, 55, { team: 'player', color: '#f2a65a', knock: 300 });
        }
        this.dash = null;
      }
    } else {
      const mv = this.moveInput();
      const speed = this.def.speed * s.moveMul;
      this.x += mv.x * speed * dt;
      this.y += mv.y * speed * dt;
      if (mv.x || mv.y) this.walk += dt; else this.walk = 0;
      collideWorld(this, true);
    }

    // Whirlwind
    if (this.whirl > 0) {
      this.whirl -= dt;
      this.whirlTick -= dt;
      if (this.whirlTick <= 0) {
        this.whirlTick = 0.25;
        const r = (s.flags.has('endless') ? 135 : 105) * s.aoe;
        for (const e of enemiesInRadius(this.x, this.y, r)) dealPlayerDamage(e, 14, { knock: 140, fromX: this.x, fromY: this.y });
      }
    }

    // Basic attack (not while placing buildings)
    if (Input.down && !G.buildMode && this.atkTimer <= 0 && !this.dash) {
      this.atkTimer = this.def.basic.cd / s.atkSpeed;
      basicAttack(this);
    }

    for (const sp of this.def.spells) if (Input.wasPressed(sp.key)) this.cast(sp);
    if (Input.wasPressed('Space')) this.cast(this.def.mobility);
  }

  cast(sp) {
    if ((this.cds[sp.id] || 0) > 0 || this.dash) return;
    const m = mouseWorld();
    if (SPELLS[sp.id](this, m.x, m.y) === false) return;
    this.cds[sp.id] = sp.cd * (1 - this.stats.cdr);
  }

  cooldownFrac(sp) {
    const rem = this.cds[sp.id] || 0;
    return rem <= 0 ? 0 : rem / (sp.cd * (1 - this.stats.cdr));
  }

  draw(ctx) {
    if (this.dead) return;
    const d = this.def, a = this.angle;
    const bob = Math.sin(this.walk * 14) * 1.6;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + 12, 14, 6, 0, 0, TAU); ctx.fill();

    if (this.whirl > 0) {
      const r = (this.stats.flags.has('endless') ? 135 : 105) * this.stats.aoe;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(G.time * 18);
      ctx.strokeStyle = 'rgba(242,200,121,0.55)';
      ctx.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(0, 0, r * (0.55 + i * 0.2), i * 2, i * 2 + 1.6); ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save();
    if (this.invuln > 0 && Math.floor(G.time * 20) % 2 === 0) ctx.globalAlpha = 0.55;
    ctx.translate(this.x, this.y + bob);

    // Body
    ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : d.color;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, TAU); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
    if (this.buffs.cry) {
      ctx.strokeStyle = `rgba(255,190,80,${0.5 + Math.sin(G.time * 10) * 0.3})`;
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, this.r + 5, 0, TAU); ctx.stroke();
    }
    // Head / facing
    ctx.fillStyle = d.accent;
    ctx.beginPath(); ctx.arc(Math.cos(a) * 4, Math.sin(a) * 4, 6, 0, TAU); ctx.fill();

    // Weapon
    let wa = a;
    if (this.cls === 'warrior' && this.swingT > 0) {
      const k = 1 - this.swingT / 0.16, arc = this.def.basic.arc * this.stats.arcMul;
      wa = a - arc / 2 + arc * k;
    }
    if (this.whirl > 0) wa = G.time * 18;
    ctx.rotate(wa);
    if (this.cls === 'warrior') {
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(10, -2, 7, 4);
      ctx.fillStyle = '#d7dde4'; ctx.fillRect(17, -2.5, 22, 5);
      ctx.fillStyle = '#f2c879'; ctx.fillRect(15, -6, 3, 12);
    } else if (this.cls === 'mage') {
      ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(4, 9); ctx.lineTo(26, 9); ctx.stroke();
      const g = 0.6 + Math.sin(G.time * 6) * 0.3;
      ctx.fillStyle = `rgba(160,230,255,${g})`;
      ctx.beginPath(); ctx.arc(28, 9, 5, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = '#8a5f33'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(8, 0, 14, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = 'rgba(240,240,220,0.8)'; ctx.lineWidth = 1;
      const pull = this.atkTimer > 0 ? 0 : 4;
      ctx.beginPath(); ctx.moveTo(8 + Math.cos(-1.2) * 14, Math.sin(-1.2) * 14);
      ctx.lineTo(8 - pull, 0); ctx.lineTo(8 + Math.cos(1.2) * 14, Math.sin(1.2) * 14); ctx.stroke();
    }
    ctx.restore();
  }
}

let enemyId = 0;
class Enemy {
  constructor(type, x, y, night) {
    const d = ENEMIES[type];
    this.id = enemyId++;
    this.type = type; this.def = d;
    this.x = x; this.y = y; this.r = d.r;
    const hpMul = 1 + 0.2 * (night - 1) + (night > 8 ? 0.1 * (night - 8) : 0);
    this.maxHp = this.hp = Math.round(d.hp * hpMul);
    this.dmgMul = 1 + 0.08 * (night - 1);
    this.speed = d.speed * rand(0.9, 1.1);
    this.atk = rand(0, d.atkCd);
    this.angle = 0;
    this.kx = 0; this.ky = 0;
    this.freeze = 0; this.stun = 0; this.root = 0; this.slow = 0; this.slowAmt = 0;
    this.dots = [];
    this.hitFlash = 0; this.lunge = 0; this.wob = rand(0, TAU);
    this.dead = false;
    this.special = d.boss ? 6 : 0; this.slamT = 0;
  }

  update(dt) {
    const d = this.def, p = G.player;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.lunge = Math.max(0, this.lunge - dt);

    for (let i = this.dots.length - 1; i >= 0; i--) {
      const dot = this.dots[i];
      dot.t -= dt; dot.tick -= dt;
      if (dot.tick <= 0) {
        dot.tick = 0.5;
        damageEnemy(this, dot.dps * 0.5, { color: dot.color, small: true });
        if (Math.random() < 0.7) spawnParticles(this.x, this.y, 2, dot.color, 50, 0.5, 3);
      }
      if (dot.t <= 0) this.dots.splice(i, 1);
    }
    if (this.dead) return;

    // Sunlight burns monsters left over at dawn.
    if (G.phase === 'day') {
      damageEnemy(this, this.maxHp * 0.35 * dt, { silent: true, noReward: true });
      if (Math.random() < 0.3) spawnParticles(this.x, this.y, 1, '#ffb347', 60, 0.6, 3);
      if (this.dead) return;
    }

    if (this.kx || this.ky) {
      this.x += this.kx * dt; this.y += this.ky * dt;
      const f = Math.max(0, 1 - 9 * dt);
      this.kx *= f; this.ky *= f;
      if (Math.abs(this.kx) + Math.abs(this.ky) < 5) this.kx = this.ky = 0;
    }

    this.freeze = Math.max(0, this.freeze - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.root = Math.max(0, this.root - dt);
    this.slow = Math.max(0, this.slow - dt);
    if (this.freeze > 0 || this.stun > 0) { collideWorld(this, false); return; }

    this.atk -= dt;
    const pd = p.dead ? Infinity : dist(this.x, this.y, p.x, p.y);
    const aggro = d.buildingHunter ? 90 : d.boss ? 480 : 300;

    if (d.boss) this.bossLogic(dt, pd);

    let tx, ty, flowBld = null;
    if (pd < aggro) { tx = p.x; ty = p.y; }
    else { const st = flowStep(this); tx = st.x; ty = st.y; flowBld = st.bld; }

    let spd = this.speed * (this.slow > 0 ? 1 - this.slowAmt : 1);
    if (this.root > 0 || this.slamT > 0) spd = 0;
    const shooting = d.ranged && pd < d.range;
    if (shooting) {
      spd *= 0.15;
      if (this.atk <= 0) {
        this.atk = d.atkCd;
        const a = Math.atan2(p.y - this.y, p.x - this.x);
        G.projectiles.push({
          kind: 'spit', team: 'enemy', x: this.x, y: this.y, r: 6, life: 1.6,
          vx: Math.cos(a) * d.projSpeed, vy: Math.sin(a) * d.projSpeed, dmg: d.dmg * this.dmgMul, src: this,
        });
      }
    }

    const dx = tx - this.x, dy = ty - this.y, dl = Math.hypot(dx, dy);
    if (dl > 1) {
      this.angle = Math.atan2(dy, dx);
      const step = Math.min(dl, spd * dt);
      this.x += (dx / dl) * step;
      this.y += (dy / dl) * step;
    }
    if (!p.dead) {
      const pdd = dist(this.x, this.y, p.x, p.y), rr = this.r + p.r;
      if (pdd < rr && pdd > 0.01) {
        this.x = p.x + ((this.x - p.x) / pdd) * rr;
        this.y = p.y + ((this.y - p.y) / pdd) * rr;
      }
    }
    const hit = collideWorld(this, false);

    if (shooting || this.atk > 0) return;
    if (pd < this.r + p.r + d.reach + 2) {
      this.atk = d.atkCd; this.lunge = 0.15;
      p.hurt(d.dmg * this.dmgMul, this);
      return;
    }
    let target = hit;
    if (!target && flowBld && distToBuilding(this, flowBld) < this.r + d.reach + 4) target = flowBld;
    if (!target && distToBuilding(this, G.hearth) < this.r + d.reach + 4) target = G.hearth;
    if (target) {
      this.atk = d.atkCd; this.lunge = 0.15;
      damageBuilding(target, d.dmg * this.dmgMul * (d.bldMul || 1));
      spawnParticles(target.x, target.y, 3, '#c9a77a', 80, 0.3, 3);
    }
  }

  bossLogic(dt, pd) {
    this.special -= dt;
    if (this.slamT > 0) {
      this.slamT -= dt;
      if (this.slamT <= 0) {
        const r = 150;
        explode(this.x, this.y, r, 0, { team: 'none', color: '#c24a8a' });
        if (!G.player.dead && dist(this.x, this.y, G.player.x, G.player.y) < r + G.player.r) G.player.hurt(35 * this.dmgMul, this);
        for (const b of [...G.buildings]) if (distToBuilding(this, b) < r) damageBuilding(b, 80 * this.dmgMul);
        shake(14);
      }
      return;
    }
    if (this.special <= 0) {
      this.special = 7;
      if (pd < 170) {
        this.slamT = 0.8;
        addEffect(telegraphEffect(this, 150, 0.8, '#ff4fa0'));
      } else {
        for (let i = 0; i < 3; i++) {
          const a = rand(0, TAU);
          const e = new Enemy('zombie', this.x + Math.cos(a) * 50, this.y + Math.sin(a) * 50, G.day);
          G.enemies.push(e);
          spawnParticles(e.x, e.y, 10, '#6a2448', 120, 0.5, 4);
        }
      }
    }
  }

  drawPos() {
    const wob = Math.sin(G.time * 9 + this.wob) * 1.3;
    return {
      x: this.x + Math.cos(this.angle) * this.lunge * 40,
      y: this.y + Math.sin(this.angle) * this.lunge * 40 + wob * 0.5,
    };
  }

  // Drawn again on top of the night overlay so monsters' eyes glow in the dark.
  drawEyes(ctx) {
    const { x, y } = this.drawPos(), c = Math.cos(this.angle), s = Math.sin(this.angle);
    const ex = this.r * 0.5, ey = this.r * 0.38, er = Math.max(2, this.r * 0.15);
    ctx.fillStyle = this.def.boss ? '#ff3fa0' : '#ff4a3a';
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.arc(x + c * ex - s * ey * side, y + s * ex + c * ey * side, er, 0, TAU); ctx.fill();
    }
  }

  draw(ctx) {
    const d = this.def;
    const { x, y } = this.drawPos();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + this.r * 0.8, this.r, this.r * 0.45, 0, 0, TAU); ctx.fill();

    let col = d.color;
    if (this.freeze > 0) col = '#a8e0ff';
    if (this.hitFlash > 0) col = '#ffffff';

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.angle);
    if (d.boss) {
      ctx.fillStyle = '#2a0d1d';
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(4, s * this.r * 0.6); ctx.lineTo(this.r + 14, s * (this.r + 10)); ctx.lineTo(this.r * 0.6, s * this.r * 0.15); ctx.fill();
      }
    }
    if (this.type === 'runner') {
      ctx.fillStyle = '#5c2f7a';
      ctx.beginPath(); ctx.moveTo(-this.r - 8, 0); ctx.lineTo(-2, -this.r); ctx.lineTo(-2, this.r); ctx.fill();
    }
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, TAU); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    if (this.type === 'spitter') {
      ctx.fillStyle = '#e3ef6a';
      ctx.beginPath(); ctx.arc(-this.r * 0.4, 0, this.r * 0.55, 0, TAU); ctx.fill();
    }
    if (this.type === 'brute') {
      ctx.fillStyle = '#5e3c26';
      ctx.fillRect(-this.r * 0.6, -this.r * 0.9, this.r * 0.5, this.r * 1.8);
      ctx.fillStyle = '#c8c8c8';
      ctx.beginPath(); ctx.arc(this.r * 0.7, this.r * 0.75, 6, 0, TAU); ctx.arc(this.r * 0.7, -this.r * 0.75, 6, 0, TAU); ctx.fill();
    }
    // Glowing eyes
    ctx.fillStyle = d.boss ? '#ff3fa0' : '#ff4a3a';
    const ex = this.r * 0.5, ey = this.r * 0.38, er = Math.max(2, this.r * 0.15);
    ctx.beginPath(); ctx.arc(ex, -ey, er, 0, TAU); ctx.arc(ex, ey, er, 0, TAU); ctx.fill();
    ctx.restore();

    if (this.root > 0) {
      ctx.strokeStyle = '#6fbf4a'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 3 + i * 2, i, i + 2.4); ctx.stroke(); }
    }
    if (this.stun > 0) {
      ctx.fillStyle = '#ffe27a';
      for (let i = 0; i < 3; i++) {
        const a = G.time * 6 + (i * TAU) / 3;
        ctx.beginPath(); ctx.arc(this.x + Math.cos(a) * 10, this.y - this.r - 6 + Math.sin(a) * 3, 2.5, 0, TAU); ctx.fill();
      }
    }
    if (this.hp < this.maxHp) {
      const w = d.boss ? 80 : this.r * 2.2, h = d.boss ? 7 : 4;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(this.x - w / 2 - 1, this.y - this.r - 12 - 1, w + 2, h + 2);
      ctx.fillStyle = d.boss ? '#ff3fa0' : '#e04848';
      ctx.fillRect(this.x - w / 2, this.y - this.r - 12, w * Math.max(0, this.hp / this.maxHp), h);
    }
  }
}

// ----------------------------- Combat -------------------------------------

function enemiesInRadius(x, y, r) {
  const out = [];
  for (const e of G.enemies) if (!e.dead && dist(x, y, e.x, e.y) < r + e.r) out.push(e);
  return out;
}

function damageEnemy(e, amount, o = {}) {
  if (e.dead || amount <= 0) return 0;
  if (e.freeze > 0 && G.player.stats.flags.has('shatter')) amount *= 1.5;
  const dealt = Math.min(e.hp, amount);
  e.hp -= amount;
  if (!o.silent) {
    e.hitFlash = 0.08;
    floatText(e.x + rand(-6, 6), e.y - e.r, Math.round(amount), o.crit ? '#ffd84a' : (o.color || '#ffffff'),
      o.crit ? 19 : o.small ? 11 : 13);
  }
  if (o.knock && !e.def.boss) {
    const a = Math.atan2(e.y - o.fromY, e.x - o.fromX);
    const k = o.knock * (e.r > 18 ? 0.35 : 1);
    e.kx += Math.cos(a) * k; e.ky += Math.sin(a) * k;
  }
  if (e.hp <= 0) killEnemy(e, o.noReward);
  return dealt;
}

// Damage from the player: applies damage multipliers, buffs, crits and lifesteal.
function dealPlayerDamage(e, base, o = {}) {
  const p = G.player, s = p.stats;
  const mul = s.dmgMul * (p.buffs.cry ? 1.4 : 1);
  const crit = !o.noCrit && Math.random() < s.crit;
  const dealt = damageEnemy(e, base * mul * (crit ? 2 : 1), { ...o, crit });
  if (s.lifesteal > 0 && dealt > 0) p.heal(dealt * s.lifesteal, true);
  return dealt;
}

function applyDot(e, dps, t, color) {
  const existing = e.dots.find(d => d.color === color);
  if (existing) { existing.t = Math.max(existing.t, t); existing.dps = Math.max(existing.dps, dps); return; }
  e.dots.push({ dps, t, tick: 0.5, color });
}

function killEnemy(e, noReward) {
  if (e.dead) return;
  e.dead = true;
  spawnParticles(e.x, e.y, e.def.boss ? 60 : 12, e.def.color, e.def.boss ? 300 : 150, 0.7, e.def.boss ? 6 : 4);
  if (noReward) return;
  G.stats.kills++;
  G.res.gold += e.def.gold;
  G.player.gainXp(e.def.xp);
  if (e.def.boss) {
    shake(20);
    UI.toast('The Night Horror is slain!');
    G.res.wood += 60; G.res.stone += 40;
  }
}

// Generic area blast. team: 'player' (crits + talents), 'tower', or 'none' (visual only).
function explode(x, y, r, dmg, o = {}) {
  if (dmg > 0 && o.team !== 'none') {
    for (const e of enemiesInRadius(x, y, r)) {
      const opts = { knock: o.knock || 0, fromX: x, fromY: y, color: o.dmgColor };
      if (o.team === 'player') dealPlayerDamage(e, dmg, opts);
      else damageEnemy(e, dmg, opts);
      if (o.burn && !e.dead) applyDot(e, o.burn, 3, '#ff8a3a');
    }
  }
  addEffect(blastEffect(x, y, r, o.color || '#ff9a3a'));
  spawnParticles(x, y, Math.min(40, 10 + r / 6), o.color || '#ff9a3a', r * 2.2, 0.5, 4);
}

// ----------------------------- Projectiles --------------------------------

function updateProjectiles(dt) {
  const list = G.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const pr = list[i];
    if (pr.kind === 'lob') {
      pr.t += dt;
      const k = Math.min(1, pr.t / pr.dur);
      pr.x = lerp(pr.sx, pr.tx, k); pr.y = lerp(pr.sy, pr.ty, k);
      pr.h = Math.sin(Math.PI * k) * 70;
      if (Math.random() < 0.5) spawnParticles(pr.x, pr.y - pr.h, 1, '#ffb04a', 30, 0.3, 3);
      if (k >= 1) {
        explode(pr.x, pr.y, pr.splash, pr.dmg, { team: 'tower', burn: 6 });
        list.splice(i, 1);
      }
      continue;
    }

    pr.x += pr.vx * dt; pr.y += pr.vy * dt;
    pr.life -= dt;
    let dead = pr.life <= 0 || pr.x < 0 || pr.y < 0 || pr.x > WORLD_W || pr.y > WORLD_H;
    if (pr.trail && Math.random() < 0.6) spawnParticles(pr.x, pr.y, 1, pr.trail, 20, 0.3, pr.r * 0.6);

    if (!dead && pr.team !== 'enemy') {
      for (const e of G.enemies) {
        if (e.dead || pr.hits.has(e) || dist(pr.x, pr.y, e.x, e.y) > pr.r + e.r) continue;
        pr.hits.add(e);
        if (pr.onHit) pr.onHit(pr, e);
        else if (pr.team === 'player') dealPlayerDamage(e, pr.dmg, { knock: pr.knock || 60, fromX: pr.x - pr.vx, fromY: pr.y - pr.vy });
        else damageEnemy(e, pr.dmg, { knock: 40, fromX: pr.x - pr.vx, fromY: pr.y - pr.vy, color: '#ffe0b0' });
        if (pr.pierce-- <= 0) { dead = true; break; }
      }
      if (!dead) {
        const n = G.gridNode[idx(tileOf(pr.x), tileOf(pr.y))];
        if (n && dist(pr.x, pr.y, n.x, n.y) < n.r + pr.r) {
          if (pr.team === 'player' && pr.harvest) harvestNode(n, pr.dmg);
          if (pr.onHit) pr.onHit(pr, null);
          dead = true;
        }
      }
    } else if (!dead) {
      const p = G.player;
      if (!p.dead && dist(pr.x, pr.y, p.x, p.y) < pr.r + p.r) {
        p.hurt(pr.dmg, pr.src);
        dead = true;
      } else {
        const tx = tileOf(pr.x), ty = tileOf(pr.y);
        if (inMap(tx, ty)) {
          const b = G.gridBld[idx(tx, ty)];
          if (b && b.def.solid) { damageBuilding(b, pr.dmg); dead = true; }
          else if (G.gridNode[idx(tx, ty)]) dead = true;
        }
      }
      if (dead) spawnParticles(pr.x, pr.y, 6, '#c8e04a', 80, 0.3, 3);
    }
    if (dead) list.splice(i, 1);
  }
}

function drawProjectile(ctx, pr) {
  if (pr.kind === 'arrow') {
    const a = Math.atan2(pr.vy, pr.vx);
    ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(a);
    ctx.strokeStyle = '#e8d8b0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(4, 0); ctx.stroke();
    ctx.fillStyle = '#cfd6dd';
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(2, -3); ctx.lineTo(2, 3); ctx.fill();
    ctx.restore();
  } else if (pr.kind === 'lob') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(pr.x, pr.y, 6, 3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffb347';
    ctx.beginPath(); ctx.arc(pr.x, pr.y - pr.h, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff2b0';
    ctx.beginPath(); ctx.arc(pr.x, pr.y - pr.h, 3, 0, TAU); ctx.fill();
  } else {
    ctx.fillStyle = pr.color || '#c8e04a';
    ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r * 0.45, 0, TAU); ctx.fill();
  }
}

// ----------------------------- Particles & text ---------------------------

function spawnParticles(x, y, n, color, speed, life, size) {
  if (G.particles.length > 1400) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = Math.random() * speed;
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * rand(0.6, 1), max: life, color, size: size * rand(0.6, 1.2) });
  }
}

function floatText(x, y, text, color, size = 13, life = 0.8) {
  if (G.texts.length > 160) G.texts.shift();
  G.texts.push({ x, y, text: String(text), color, size, life, max: life });
}

function updateParticles(dt) {
  const ps = G.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt;
  }
  const ts = G.texts;
  for (let i = ts.length - 1; i >= 0; i--) {
    const t = ts[i];
    t.life -= dt; t.y -= 32 * dt;
    if (t.life <= 0) ts.splice(i, 1);
  }
}

function shake(n) { G.shakeAmt = Math.max(G.shakeAmt, n); }
