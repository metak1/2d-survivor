import { FULL_H, WORLD_W } from '../config';
import { CHAMPION_REWARD, ENEMIES, type ChampionTrait } from '../data/enemies';
import type { EnemyDef, EnemyId } from '../data/types';
import { clamp, dist, rand, TAU } from '../core/math';
import { damageEnemy, enemiesInRadius, enemyDmgMul, explode, nearestFriendly, type Friendly } from './combat';
import { distToBuilding, type Building } from './world';
import { regionAt } from './dungeons';
import type { Game } from './game';
import type { Player } from './player';

export interface Dot { dps: number; t: number; tick: number; color: string }

export class Enemy {
  readonly id: number;
  readonly def: EnemyDef;
  r: number;
  hp: number;
  maxHp: number;
  dmgMul: number;
  speed: number;
  atk: number;
  angle = 0;
  kx = 0;
  ky = 0;
  freeze = 0;
  stun = 0;
  root = 0;
  slow = 0;
  slowAmt = 0;
  /** Seconds of 50% damage reduction granted by a shaman. */
  shield = 0;
  /** Seconds of +25% damage taken (Hunter's Mark). */
  marked = 0;
  /** Seconds it must chase `taunter` (Challenging Roar, Bastion). */
  taunt = 0;
  taunter: Player | null = null;
  dots: Dot[] = [];
  dead = false;
  lastHit = -1;
  moving = false;
  /** Camp guards and dungeon monsters return here when the player leaves. */
  home: { x: number; y: number } | null = null;
  /** Id of the dungeon it lives in (0: the overworld). It ignores the sun and the Hearth. */
  dungeon = 0;
  /** Champion trait, if it is one. */
  champ: ChampionTrait | null = null;
  /** A shielded champion's ward: absorbs damage before health. */
  ward = 0;
  /** Gold and XP multiplier (strength beyond the horde cap, champions). */
  reward = 1;
  /** Strength from budget beyond the horde cap (1: none). */
  power = 1;
  /** Seconds until a boss's delayed blast (Flame Golem's slam, the Lich's frost nova) goes off. */
  slamT = 0;
  private slam = { r: 0, dmg: 0, bld: 0, color: '' };
  /** Boss ability timer and rotation. */
  private bossT = 6;
  private bossStep = 0;
  private enraged = false;
  /** Minotaur Warlord: winding up a charge, and the charge itself. */
  private windup = 0;
  private charge: { vx: number; vy: number; t: number; hit: Set<object> } | null = null;
  private special: number;
  private retarget = 0;
  private bombardTarget: Building | null = null;

  constructor(private g: Game, readonly type: EnemyId, public x: number, public y: number, night: number) {
    const d = ENEMIES[type];
    this.id = g.nextId();
    this.def = d;
    this.r = d.r;
    const hpMul = 1 + 0.2 * (night - 1) + (night > 8 ? 0.1 * (night - 8) : 0);
    // Bosses get tougher with every extra player in the party.
    this.maxHp = this.hp = Math.round(d.hp * hpMul * (d.boss ? g.partyMul : 1));
    this.dmgMul = 1 + 0.08 * (night - 1);
    this.speed = d.speed * rand(0.9, 1.1);
    this.atk = rand(0, d.atkCd);
    this.special = d.boss ? 6 : d.shaman ? rand(1, d.shaman.cd) : d.siege ? rand(0.5, d.siege.cd) : 0;
  }

  update(dt: number): void {
    const g = this.g, d = this.def;
    this.moving = false;

    for (let i = this.dots.length - 1; i >= 0; i--) {
      const dot = this.dots[i];
      dot.t -= dt;
      dot.tick -= dt;
      if (dot.tick <= 0) {
        dot.tick = 0.5;
        damageEnemy(g, this, dot.dps * 0.5, { color: dot.color, small: true });
        if (Math.random() < 0.7) g.fx.particles(this.x, this.y, 2, dot.color, 50, 0.5, 3);
      }
      if (dot.t <= 0) this.dots.splice(i, 1);
    }
    if (this.dead) return;

    // Sunlight burns night monsters left over at dawn. Camp guards don't mind it.
    if (g.phase === 'day' && !d.guard && !this.dungeon) {
      damageEnemy(g, this, this.maxHp * 0.35 * dt, { silent: true, noReward: true });
      if (Math.random() < 0.3) g.fx.particles(this.x, this.y, 1, '#ffb347', 60, 0.6, 3);
      if (this.dead) return;
    }

    if (this.kx || this.ky) {
      this.x += this.kx * dt;
      this.y += this.ky * dt;
      const f = Math.max(0, 1 - 9 * dt);
      this.kx *= f;
      this.ky *= f;
      if (Math.abs(this.kx) + Math.abs(this.ky) < 5) this.kx = this.ky = 0;
    }

    this.freeze = Math.max(0, this.freeze - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.root = Math.max(0, this.root - dt);
    this.slow = Math.max(0, this.slow - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.marked = Math.max(0, this.marked - dt);
    this.taunt = Math.max(0, this.taunt - dt);
    if (this.freeze > 0 || this.stun > 0) {
      if (!d.flying) g.world.collide(this, false);
      return;
    }

    this.atk -= dt;
    let { f: foe, d: fd } = nearestFriendly(g, this.x, this.y);
    if (this.taunt > 0 && this.taunter && !this.taunter.dead) {
      foe = this.taunter;
      fd = dist(this.x, this.y, foe.x, foe.y);
    }
    // Walls between the overworld and the dungeons (and between dungeons) can't be seen through.
    if (foe && regionAt(g, foe.x, foe.y) !== this.dungeon) { foe = null; fd = Infinity; }
    if (d.boss && this.bossLogic(dt, foe, fd)) return;
    if (d.shaman) this.shamanLogic(dt);

    if (d.guard) return this.guardLogic(dt, foe, fd);
    if (d.flying) return this.flyLogic(dt, foe, fd);
    this.groundLogic(dt, foe, fd);
  }

  /** A champion died: splitting ones break in two, explosive ones blow up. */
  championDeath(): void {
    const g = this.g;
    if (this.champ === 'explosive') {
      explode(g, this.x, this.y, 95, 45 * this.dmgMul, { team: 'enemy', color: '#ffb347' });
      g.fx.shake(5);
    } else if (this.champ === 'splitting') {
      for (let i = 0; i < 2; i++) {
        const a = rand(0, TAU), e = new Enemy(g, this.type, this.x + Math.cos(a) * 18, this.y + Math.sin(a) * 18, g.day);
        e.maxHp = e.hp = Math.round(this.maxHp * 0.3);
        e.dmgMul = this.dmgMul * 0.7;
        e.reward = this.reward / 6;
        e.dungeon = this.dungeon;
        e.home = this.home;
        g.enemies.push(e);
      }
      g.fx.particles(this.x, this.y, 14, '#9be36b', 140, 0.5, 4);
    }
  }

  /** Night monsters past the horde cap: as strong as several, and worth as much. */
  empower(power: number): void {
    if (power <= 1) return;
    this.power = power;
    this.maxHp = this.hp = Math.round(this.maxHp * power);
    this.dmgMul *= Math.sqrt(power);
    this.reward *= power;
  }

  makeChampion(trait: ChampionTrait): void {
    this.champ = trait;
    this.maxHp = this.hp = Math.round(this.maxHp * 1.5);
    this.reward *= CHAMPION_REWARD;
    if (trait === 'shielded') this.ward = this.maxHp * 0.5;
    if (trait === 'swift') this.speed *= 1.45;
  }

  /** Forces it to chase a player for `t` seconds. */
  tauntBy(p: Player, t: number): void {
    this.taunt = Math.max(this.taunt, t);
    this.taunter = p;
  }

  private get moveSpeed(): number {
    let spd = this.speed * (this.slow > 0 ? 1 - this.slowAmt : 1);
    if (this.root > 0 || this.slamT > 0 || this.windup > 0) spd = 0;
    return spd;
  }

  private stepToward(tx: number, ty: number, spd: number, dt: number, face = true): void {
    const dx = tx - this.x, dy = ty - this.y, dl = Math.hypot(dx, dy);
    if (dl < 1 || spd <= 0) return;
    if (face) this.angle = Math.atan2(dy, dx);
    const step = Math.min(dl, spd * dt);
    this.x += (dx / dl) * step;
    this.y += (dy / dl) * step;
    this.moving = true;
  }

  /** Keeps monsters from standing inside the player or allies. */
  private pushOutOfFriendlies(): void {
    for (const f of [...this.g.players, ...this.g.allies]) {
      if (f.dead) continue;
      const dd = dist(this.x, this.y, f.x, f.y), rr = this.r + f.r;
      if (dd < rr && dd > 0.01) {
        this.x = f.x + ((this.x - f.x) / dd) * rr;
        this.y = f.y + ((this.y - f.y) / dd) * rr;
      }
    }
  }

  private strike(foe: Friendly): void {
    this.atk = this.def.atkCd;
    this.angle = Math.atan2(foe.y - this.y, foe.x - this.x);
    this.g.events.emit('anim', { id: this.id, anim: 'attack' });
    foe.hurt(this.def.dmg * this.dmgMul * enemyDmgMul(this.g, this), this);
    if (this.champ === 'vampiric') this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.08);
  }

  private groundLogic(dt: number, foe: Friendly | null, fd: number): void {
    const g = this.g, d = this.def, w = g.world;
    // Building hunters ignore people unless they're in the way, or a Warrior provokes them
    // (Lava Slimes still go for the walls: blowing up on a melee class would be brutal).
    const provoke = d.buildingHunter && !d.sapper ? foe?.provoke ?? 0 : 0;
    const aggro = d.buildingHunter ? Math.max(90, provoke) : d.boss ? 480 : 300;
    let spd = this.moveSpeed;

    let tx: number, ty: number, flowBld: Building | null = null;
    if (this.dungeon) {
      // Dungeon packs wake when someone comes close or a packmate is hit, chase a while, then go home.
      const home = this.home!;
      const awake = foe && (fd < 280 || this.taunt > 0 || g.time - this.lastHit < 3) && dist(foe.x, foe.y, home.x, home.y) < 760;
      if (!awake) foe = null;
      if (foe) { tx = foe.x; ty = foe.y; }
      else {
        tx = home.x; ty = home.y;
        if (dist(this.x, this.y, home.x, home.y) < 16) { spd = 0; this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.05 * dt); }
      }
    } else if (foe && (fd < aggro || this.taunt > 0)) { tx = foe.x; ty = foe.y; }
    else { const st = w.flowStep(this.x, this.y); tx = st.x; ty = st.y; flowBld = st.bld; }

    // Shamans hang back behind the horde.
    if (d.shaman && foe && fd < 230) { tx = this.x + (this.x - foe.x); ty = this.y + (this.y - foe.y); }

    if (d.siege && this.siegeLogic(dt)) spd = 0;

    const shooting = !!d.ranged && !!foe && fd < d.range!;
    if (shooting && foe) {
      spd *= 0.15;
      if (this.atk <= 0) {
        this.atk = d.atkCd;
        const a = Math.atan2(foe.y - this.y, foe.x - this.x);
        this.angle = a;
        g.events.emit('anim', { id: this.id, anim: 'attack' });
        g.projectiles.push({
          id: g.nextId(), kind: 'spit', team: 'enemy', x: this.x, y: this.y, r: 6, life: 1.6,
          vx: Math.cos(a) * d.projSpeed!, vy: Math.sin(a) * d.projSpeed!, dmg: d.dmg * this.dmgMul * enemyDmgMul(g, this),
          pierce: 0, hits: new Set(), src: this,
        });
      }
    }

    this.stepToward(tx, ty, spd, dt, !shooting && !this.bombardTarget);
    this.pushOutOfFriendlies();
    const hit = w.collide(this, false);

    if (d.sapper) {
      const touching = hit
        || (flowBld && distToBuilding(this, flowBld) < this.r + d.reach + 4)
        || distToBuilding(this, w.hearth) < this.r + d.reach + 4
        || (foe && fd < this.r + foe.r + 6);
      if (touching) this.detonate();
      return;
    }

    if (shooting || this.atk > 0) return;
    if (foe && fd < this.r + foe.r + d.reach + 2) return this.strike(foe);
    let target = hit;
    if (!target && flowBld && distToBuilding(this, flowBld) < this.r + d.reach + 4) target = flowBld;
    if (!target && distToBuilding(this, w.hearth) < this.r + d.reach + 4) target = w.hearth;
    if (target) {
      this.atk = d.atkCd;
      this.angle = Math.atan2(target.y - this.y, target.x - this.x);
      g.events.emit('anim', { id: this.id, anim: 'attack' });
      w.damage(target, d.dmg * this.dmgMul * (d.bldMul || 1) * enemyDmgMul(g, this));
      if (this.champ === 'vampiric') this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.08);
      g.fx.particles(target.x, target.y, 3, '#c9a77a', 80, 0.3, 3);
    }
  }

  /** Bats fly straight over walls at the nearest friendly, or the Hearth when no one is close. */
  private flyLogic(dt: number, foe: Friendly | null, fd: number): void {
    const g = this.g, d = this.def, h = g.world.hearth;
    const target = foe && fd < 700 ? foe : null;
    this.stepToward(target ? target.x : h.x, target ? target.y : h.y, this.moveSpeed, dt);
    this.x = clamp(this.x, this.r, WORLD_W - this.r);
    this.y = clamp(this.y, this.r, FULL_H - this.r);
    if (this.atk > 0) return;
    if (target && fd < this.r + target.r + d.reach + 2) this.strike(target);
    else if (!target && distToBuilding(this, h) < this.r + d.reach + 4) {
      this.atk = d.atkCd;
      g.events.emit('anim', { id: this.id, anim: 'attack' });
      g.world.damage(h, d.dmg * this.dmgMul);
    }
  }

  /** Camp guards stay near their chest, chase intruders a short way, then go back and heal. */
  private guardLogic(dt: number, foe: Friendly | null, fd: number): void {
    const home = this.home ?? { x: this.x, y: this.y };
    const intruder = foe && fd < 260 && dist(foe.x, foe.y, home.x, home.y) < 460 ? foe : null;
    if (intruder) {
      this.stepToward(intruder.x, intruder.y, this.moveSpeed, dt);
    } else if (dist(this.x, this.y, home.x, home.y) > 12) {
      this.stepToward(home.x, home.y, this.moveSpeed, dt);
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.08 * dt);
    } else {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.08 * dt);
      return;
    }
    this.pushOutOfFriendlies();
    this.g.world.collide(this, false);
    if (intruder && this.atk <= 0 && fd < this.r + intruder.r + this.def.reach + 2) this.strike(intruder);
  }

  /** Siege knights stop and shell the nearest building in range. Returns true while bombarding. */
  private siegeLogic(dt: number): boolean {
    const g = this.g, s = this.def.siege!;
    this.retarget -= dt;
    if (this.retarget <= 0 || this.bombardTarget?.dead) {
      this.retarget = 0.5;
      let best: Building | null = null, bd = s.range;
      for (const b of g.world.buildings) {
        if (!b.def.solid) continue;
        const dd = distToBuilding(this, b);
        if (dd < bd) { bd = dd; best = b; }
      }
      this.bombardTarget = best;
    }
    const t = this.bombardTarget;
    if (!t) return false;
    this.angle = Math.atan2(t.y - this.y, t.x - this.x);
    this.special -= dt;
    if (this.special <= 0) {
      this.special = s.cd;
      g.events.emit('anim', { id: this.id, anim: 'attack' });
      g.projectiles.push({
        id: g.nextId(), kind: 'cannon', team: 'enemy', x: this.x, y: this.y, vx: 0, vy: 0, r: 8, life: 2, dmg: 0,
        pierce: 0, hits: new Set(),
        lob: { sx: this.x, sy: this.y - 10, tx: t.x + rand(-10, 10), ty: t.y + rand(-10, 10), t: 0, dur: 1.1, h: 0 },
        blast: { team: 'enemy', r: s.r, dmg: s.dmg * this.dmgMul, color: '#8a8aa0' },
      });
    }
    return true;
  }

  private shamanLogic(dt: number): void {
    const g = this.g, s = this.def.shaman!;
    this.special -= dt;
    if (this.special > 0) return;
    this.special = s.cd;
    const allies = enemiesInRadius(g, this.x, this.y, s.r);
    if (allies.length < 2) return;
    for (const e of allies) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * s.heal);
      e.shield = 4;
    }
    g.events.emit('anim', { id: this.id, anim: 'attack2' });
    g.events.emit('vfx', { kind: 'ring', x: this.x, y: this.y, r: s.r, color: '#b58cff', life: 0.6 });
    g.fx.particles(this.x, this.y, 16, '#c8a8ff', 120, 0.6, 3);
  }

  private detonate(): void {
    const g = this.g, s = this.def.sapper!;
    explode(g, this.x, this.y, s.r, s.dmg * this.dmgMul, { team: 'enemy', color: '#ff6a2a' });
    g.fx.shake(6);
    damageEnemy(g, this, this.hp + 1, { silent: true, noReward: true });
  }

  // ----------------------------------------------------------------- bosses

  /** Runs the boss's abilities. Returns true when it moved itself this step (a charge). */
  private bossLogic(dt: number, foe: Friendly | null, fd: number): boolean {
    const g = this.g;
    if (this.charge) return this.charging(dt);
    // A dungeon boss sleeps until someone reaches its chamber.
    if (this.dungeon && (!foe || fd > 520)) return false;
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) this.charge = { vx: Math.cos(this.angle) * 600, vy: Math.sin(this.angle) * 600, t: 0.6, hit: new Set() };
      return true;
    }
    if (this.slamT > 0) {
      this.slamT -= dt;
      if (this.slamT <= 0) this.landSlam();
      return false;
    }
    // Below 40% health a boss fights faster.
    if (!this.enraged && this.hp < this.maxHp * 0.4) {
      this.enraged = true;
      this.speed *= 1.2;
      g.fx.toast(`The ${this.def.name} is enraged!`);
      g.fx.text(this.x, this.y - this.r - 20, 'ENRAGED', '#ff5a3a', 18, 1.4);
    }
    this.bossT -= dt;
    if (this.bossT > 0) return false;
    const kind = this.def.bossKind ?? 'golem';
    this.bossT = (kind === 'lich' ? 5 : 6.5) * (this.enraged ? 0.65 : 1);
    const step = this.bossStep++;
    if (kind === 'warlord') this.warlordAbility(step, foe, fd);
    else if (kind === 'lich') this.lichAbility(step);
    else this.golemAbility(step, fd);
    return false;
  }

  /** Charges at a player some way off (stomps one up close), and calls wolves every third time. */
  private warlordAbility(step: number, foe: Friendly | null, fd: number): void {
    const g = this.g;
    if (foe && fd < 130 && step % 3 !== 2) {
      g.events.emit('anim', { id: this.id, anim: 'attack2' });
      this.startSlam(130, 28, 40, '#c0703a', 0.7);
      return;
    }
    if (foe && fd < 560 && step % 3 !== 2) {
      this.windup = 0.8;
      this.angle = Math.atan2(foe.y - this.y, foe.x - this.x);
      g.events.emit('anim', { id: this.id, anim: 'attack2' });
      g.zones.push({ id: g.nextId(), kind: 'telegraph', x: this.x, y: this.y, r: this.r + 26, t: 0, life: 0.8, follow: this, color: '#ff9a3a' });
      return;
    }
    g.fx.text(this.x, this.y - this.r - 20, 'ROAR', '#ffb36a', 18, 1.2);
    g.events.emit('vfx', { kind: 'ring', x: this.x, y: this.y, r: 160, color: '#ffb36a', life: 0.6 });
    this.summon(this.def.bossSummon ?? 'runner', 3 + Math.floor(g.day / 5), this.def.color);
  }

  /** A charge: tramples friends it runs through and smashes into buildings. */
  private charging(dt: number): boolean {
    const g = this.g, c = this.charge!;
    c.t -= dt;
    this.x = clamp(this.x + c.vx * dt, this.r, WORLD_W - this.r);
    this.y = clamp(this.y + c.vy * dt, this.r, FULL_H - this.r);
    this.moving = true;
    for (const f of [...g.players, ...g.allies]) {
      if (f.dead || c.hit.has(f) || dist(this.x, this.y, f.x, f.y) > this.r + f.r + 6) continue;
      c.hit.add(f);
      f.hurt(30 * this.dmgMul, this);
    }
    if (Math.random() < 0.6) g.fx.particles(this.x, this.y + this.r * 0.6, 2, '#b89a70', 80, 0.4, 4);
    const wall = g.world.collide(this, false);
    if (wall && !c.hit.has(wall)) {
      c.hit.add(wall);
      g.world.damage(wall, (wall.type === 'hearth' ? 60 : 180) * this.dmgMul);
      g.fx.shake(10);
      this.charge = null;
      this.stun = 1.2; // dazed by the impact
      return true;
    }
    if (c.t <= 0) this.charge = null;
    return true;
  }

  /** Raises skeletons, casts a frost nova, or looses a ring of shadow bolts. */
  private lichAbility(step: number): void {
    const g = this.g;
    g.events.emit('anim', { id: this.id, anim: 'attack2' });
    switch (step % 3) {
      case 0:
        this.summon(this.def.bossSummon ?? 'zombie', 4 + Math.floor(g.day / 4), '#9a7cff');
        if (g.day >= 10) this.summon('spitter', 2, '#9a7cff');
        break;
      case 1:
        this.startSlam(200, 26, 0, '#9ad8ff', 1.1);
        break;
      default: {
        const n = this.enraged ? 14 : 10, off = rand(0, TAU);
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * TAU;
          g.projectiles.push({
            id: g.nextId(), kind: 'spit', team: 'enemy', x: this.x, y: this.y, r: 7, life: 2.2,
            vx: Math.cos(a) * 230, vy: Math.sin(a) * 230, dmg: 14 * this.dmgMul, pierce: 0, hits: new Set(), src: this,
          });
        }
        g.events.emit('vfx', { kind: 'ring', x: this.x, y: this.y, r: 60, color: '#b58cff', life: 0.4 });
      }
    }
  }

  /** Rains fire on every player every other time; otherwise slams anyone close, or calls up monsters. */
  private golemAbility(step: number, fd: number): void {
    const g = this.g;
    if (step % 2 === 1) {
      for (const p of g.players) {
        if (p.dead || dist(this.x, this.y, p.x, p.y) > 1100 || regionAt(g, p.x, p.y) !== this.dungeon) continue;
        for (let i = 0; i < (this.enraged ? 4 : 3); i++) {
          const x = p.x + (i ? rand(-110, 110) : 0), y = p.y + (i ? rand(-110, 110) : 0);
          g.zones.push({ id: g.nextId(), kind: 'hazard', x, y, t: 0, r: 70, life: 1.3 + i * 0.25, dmg: 30 * this.dmgMul, color: '#ff6a2a' });
        }
      }
      g.fx.text(this.x, this.y - this.r - 20, 'FIRE RAIN', '#ff8a3a', 16, 1.2);
      return;
    }
    if (fd < 170) {
      g.events.emit('anim', { id: this.id, anim: 'attack2' });
      this.startSlam(150, 35, 50, '#ff7a2a', 0.8);
      return;
    }
    this.summon(this.def.bossSummon ?? 'zombie', 4, this.def.color);
  }

  private startSlam(r: number, dmg: number, bld: number, color: string, delay: number): void {
    this.slam = { r, dmg, bld, color };
    this.slamT = delay;
    this.g.zones.push({ id: this.g.nextId(), kind: 'telegraph', x: this.x, y: this.y, r, t: 0, life: delay, follow: this, color });
  }

  private landSlam(): void {
    const g = this.g, s = this.slam;
    explode(g, this.x, this.y, s.r, 0, { team: 'none', color: s.color });
    for (const f of [...g.players, ...g.allies]) if (!f.dead && dist(this.x, this.y, f.x, f.y) < s.r + f.r) f.hurt(s.dmg * this.dmgMul, this);
    if (s.bld) for (const b of [...g.world.buildings]) if (distToBuilding(this, b) < s.r) g.world.damage(b, s.bld * this.dmgMul);
    g.fx.shake(14);
  }

  private summon(type: EnemyId, n: number, color: string): void {
    const g = this.g;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const e = new Enemy(g, type, this.x + Math.cos(a) * 60, this.y + Math.sin(a) * 60, g.day);
      if (this.dungeon) { e.dungeon = this.dungeon; e.home = { x: this.x, y: this.y }; }
      g.world.collide(e, false);
      g.enemies.push(e);
      g.fx.particles(e.x, e.y, 10, color, 120, 0.5, 4);
    }
  }
}
