import { CLASSES } from '../data/classes';
import { MAX_TALENT_POINTS } from '../config';
import { TALENTS } from '../data/talents';
import type { ClassDef, ClassId, SpellDef, SpellId, Stats } from '../data/types';
import type { AllyKind } from './ally';
import type { ItemSlot } from '../data/items';
import type { Item } from './items';

export interface RunRecord { dmg: number; heal: number; taken: number; kills: number; deaths: number; best: Item | null }
import { angleDiff, dist } from '../core/math';
import { canLearn, canUnlearn, computeStats, legendBonus } from './stats';
import { applyDot, BLEED_COLOR, BURN_COLOR, burnMul, damageEnemy, dealPlayerDamage, enemiesInRadius, explode } from './combat';
import { basicAttack, castSpell, channelBeam, channelMend, fireAimedShot, fireArrowFan } from './spells';
import { guardianSpirit, hasCompanions, syncSummons } from './ally';
import type { Enemy } from './enemy';
import type { Game } from './game';

/** What the player wants to do this step. Built by the client from keyboard/mouse. */
export interface Intent {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  attack: boolean;
  /** Holding the class's right-click ability. */
  alt: boolean;
  casts: SpellId[];
}

export const NO_INTENT: Intent = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, alt: false, casts: [] };

/** Seconds for a full Aimed Shot draw. */
export const AIM_MAX = 1.2;

/** Seconds a blocked spell press keeps retrying (longer than a Roll or Charge lasts). */
const CAST_BUFFER = 0.5;

interface Dash {
  vx: number;
  vy: number;
  t: number;
  kind: 'roll' | 'charge';
  dmg: number;
  stun: number;
  hits: Set<number>;
  /** Distance since the last Ravager flame was dropped. */
  trail: number;
}

/** Timed effects on the player, in seconds left. */
export interface Buffs {
  /** Battle Cry. */
  cry?: number;
  /** Shield Wall after a Roll. */
  wall?: number;
  /** Camouflage after a Roll. */
  camo?: number;
  /** Bloodlust stacks expire together. */
  lust?: number;
  /** Revenge: the next Cleave hits harder. */
  revenge?: number;
  /** Apotheosis: Holy Nova recharges in 1s. */
  apo?: number;
  /** Ascension: empowered Smite. */
  ascend?: number;
}

export class Player {
  readonly id: number;
  readonly def: ClassDef;
  readonly r = 14;
  x: number;
  y: number;
  hp: number;
  stats: Stats;
  level = 1;
  xp = 0;
  points = 0;
  talents: Record<string, number> = {};
  /** What we're wearing, and what we're carrying (up to BAG_SIZE). */
  equip: Partial<Record<ItemSlot, Item>> = {};
  bag: Item[] = [];
  /** Online: the account playing this character (it gets it back when it returns to a saved run). */
  account?: string;
  /** Legendaries discovered this run (craftable at the forge), and Legendary Shards to spend there. */
  codex = new Set<string>();
  shards = 0;
  /** What this player did this run, for the end screen. */
  run: RunRecord = { dmg: 0, heal: 0, taken: 0, kills: 0, deaths: 0, best: null };
  /** Aegis of Dawn recharge. */
  private dawnT = 0;
  cds: Partial<Record<SpellId, number>> = {};
  buffs: Buffs = {};
  lustStacks = 0;
  /** Damage absorbed before health (Glacial Barrier, Arcane Ward). */
  barrier = 0;
  barrierT = 0;
  /** Heal-over-time per second, and seconds left (Prayer of Mending). */
  hot = 0;
  hotT = 0;
  angle = 0;
  atkTimer = 0;
  /** Basic attacks made, for "every Nth attack" talents. */
  swings = 0;
  dash: Dash | null = null;
  /** Spells pressed while blocked (dashing, nearly off cooldown), retried for a short window. */
  private queued = new Map<SpellId, number>();
  /** Actions scheduled a little later (second Volley wave). */
  private later: { t: number; fn: () => void }[] = [];
  whirl = 0;
  whirlTick = 0;
  /** The right-click ability is held. */
  altHeld = false;
  /** Seconds it has been held (Aimed Shot draw). */
  altT = 0;
  altTick = 0;
  /** Mend healing not yet shown as a number. */
  mendAcc = 0;
  /** Where a beam or mend ends this step, for drawing (null: none, or Mend on yourself). */
  altEnd: { x: number; y: number } | null = null;
  invuln = 0;
  dead = false;
  respawn = 0;
  lastHit = -1;
  moving = false;
  moveDir = { x: 0, y: 0 };
  /** Seconds spent standing still (Bastion). */
  stillT = 0;
  /** Arrow of Ruin recharge. */
  ruinT = 0;
  critCdT = 0;
  rampageT = 0;
  private auraT = 0;
  /** Online: their connection dropped (they don't block a night vote). */
  offline = false;
  /** Once-per-night talents already used tonight (Defiance, Phoenix). */
  readonly nightUsed = new Set<string>();

  /** What this player wants to do; set by the client (or the server) before each step. */
  intent: Intent = { ...NO_INTENT, casts: [] };
  /** Talent summons lost tonight (replaced at dawn), and recruits lost since dawn (Salvation). */
  fallenSummons: Partial<Record<AllyKind, number>> = {};
  fallenRecruits = 0;

  constructor(private g: Game, readonly cls: ClassId, readonly name: string, readonly slot: number) {
    this.id = g.nextId();
    this.def = CLASSES[cls];
    const spawn = this.spawnPoint();
    this.x = spawn.x;
    this.y = spawn.y;
    this.stats = computeStats(cls, this.talents, this.worn);
    this.hp = this.stats.maxHp;
  }

  get maxHp(): number { return this.stats.maxHp; }

  get provoke(): number | undefined { return this.def.provoke; }

  /** Items being worn. */
  get worn(): Item[] { return Object.values(this.equip).filter((i): i is Item => !!i); }

  /** Players spread out in a row below the Hearth. */
  private spawnPoint(): { x: number; y: number } {
    const h = this.g.world.hearth;
    return { x: h.x + (this.slot - 1.5) * 40, y: h.y + 80 };
  }

  recalc(): void {
    const oldMax = this.stats.maxHp;
    this.stats = computeStats(this.cls, this.talents, this.worn);
    this.hp = Math.min(this.stats.maxHp, this.hp + Math.max(0, this.stats.maxHp - oldMax));
    syncSummons(this.g, this, false);
    this.g.updateTeam();
  }

  learnTalent(treeIndex: number, nodeId: string, option = 0): boolean {
    const tree = TALENTS[this.cls][treeIndex];
    const node = tree?.nodes.find(n => n.id === nodeId);
    if (!node || !node.options[option] || !canLearn(tree, node, option, this.talents, this.points)) return false;
    const t = node.options[option];
    this.talents[t.id] = (this.talents[t.id] || 0) + 1;
    this.points--;
    this.recalc();
    return true;
  }

  /** Why talents can't be refunded right now, or null. */
  get respecBlocked(): string | null {
    return this.g.phase === 'night' ? 'Talents can only be refunded during the day' : null;
  }

  /** Refunds one rank, if nothing learned below depends on it. */
  unlearnTalent(treeIndex: number, optionId: string): boolean {
    const tree = TALENTS[this.cls][treeIndex];
    if (!tree || this.respecBlocked || !canUnlearn(tree, optionId, this.talents)) return false;
    if (--this.talents[optionId] <= 0) delete this.talents[optionId];
    this.points++;
    this.recalc();
    return true;
  }

  /** Refunds every talent in a tree (or all trees). */
  resetTalents(treeIndex?: number): void {
    if (this.respecBlocked) return;
    TALENTS[this.cls].forEach((tree, i) => {
      if (treeIndex !== undefined && i !== treeIndex) return;
      for (const node of tree.nodes) for (const t of node.options) {
        this.points += this.talents[t.id] || 0;
        delete this.talents[t.id];
      }
    });
    this.recalc();
  }

  get xpNext(): number { return Math.floor(20 + this.level * 14 + this.level * this.level * 1.5); }

  /** Talent points spent, and earned in all (spent plus unspent; at most MAX_TALENT_POINTS). */
  get spentPoints(): number { return Object.values(this.talents).reduce((s, r) => s + r, 0); }
  get earnedPoints(): number { return this.points + this.spentPoints; }
  get canGainPoint(): boolean { return this.earnedPoints < MAX_TALENT_POINTS; }

  /** Gives a talent point unless the run's limit is reached. */
  grantPoint(): boolean {
    if (!this.canGainPoint) return false;
    this.points++;
    return true;
  }

  gainXp(n: number): void {
    this.xp += n;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      const point = this.grantPoint();
      this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * 0.25);
      this.g.fx.text(this.x, this.y - 30, 'LEVEL UP!', '#ffe27a', 20, 1.6);
      this.g.fx.particles(this.x, this.y, 30, '#ffe27a', 200, 0.8, 3);
      this.g.events.emit('vfx', { kind: 'ring', x: this.x, y: this.y, r: 90, color: '#ffe27a', life: 0.5 });
      this.g.events.emit('levelUp', { level: this.level, to: this.id, point });
    }
  }

  heal(n: number, silent = false): void {
    if (this.dead || n <= 0) return;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    if (!silent && this.hp - before >= 1) this.g.fx.text(this.x, this.y - 24, `+${Math.round(this.hp - before)}`, '#6dff8a', 14);
  }

  shield(amount: number, t: number): void {
    this.barrier = Math.max(this.barrier, amount);
    this.barrierT = Math.max(this.barrierT, t);
  }

  hurt(dmg: number, src?: Enemy): void {
    if (this.dead || this.invuln > 0) return;
    const g = this.g, s = this.stats, f = s.flags;
    if (f.has('evasion') && Math.random() < 0.08 * s.ranks.evasion + 0.02 * legendBonus(s, 'windwalkers')) {
      g.fx.text(this.x, this.y - 22, 'Dodge', '#d8f0c8', 13);
      return;
    }
    const blocked = this.blocks(src);
    if (blocked) dmg *= 1 - this.blockReduce;
    dmg *= 1 - s.armor;
    if (this.buffs.cry && f.has('unbreakable')) dmg *= 0.5;
    if (this.buffs.wall) dmg *= 0.6;
    if (f.has('devotion')) dmg *= 1 - 0.06 * s.ranks.devotion;
    if (this.whirl > 0 && f.has('ironwhirl')) dmg *= 0.5;
    if (f.has('laststand') && this.hp < s.maxHp * 0.3) dmg *= 0.6;
    if (f.has('survivalist') && this.hp < s.maxHp * 0.5) dmg *= 0.85;
    if (f.has('bastion') && this.stillT >= 1) dmg *= 0.7;
    const absorbed = Math.min(this.barrier, dmg);
    this.barrier -= absorbed;
    dmg -= absorbed;

    this.run.taken += Math.max(0, Math.min(dmg, this.hp));
    this.hp -= dmg;
    this.lastHit = g.time;
    if (f.has('revenge')) this.buffs.revenge = 5;
    g.fx.text(this.x, this.y - 22, String(Math.round(dmg)), blocked ? '#c8d2dc' : absorbed > 0 && dmg < 1 ? '#a8e0ff' : '#ff5a5a', 15);
    if (blocked) g.fx.particles(this.x + Math.cos(this.angle) * 18, this.y + Math.sin(this.angle) * 18, 4, '#e8eef4', 90, 0.25, 3);
    g.fx.shake(Math.min(8, 2 + dmg * 0.2), this.id);
    if (src && !src.dead) {
      if (blocked && f.has('riposte') && dist(this.x, this.y, src.x, src.y) < 120) {
        dealPlayerDamage(g, this, src, 25, { knock: 220, fromX: this.x, fromY: this.y, tag: 'other' });
        if (!src.def.boss) src.stun = Math.max(src.stun, 0.6);
      }
      if (s.thorns > 0 && !src.dead) damageEnemy(g, src, s.thorns, { color: '#9be36b' });
      if (f.has('spiked') && !src.dead) applyDot(src, 8, 3, BLEED_COLOR);
      if (f.has('fireward') && !src.dead) applyDot(src, 10 * burnMul(this), 3, BURN_COLOR);
    }
    if (this.hp > 0) return;
    if (f.has('cheatdeath') && !this.nightUsed.has('cheatdeath')) {
      this.nightUsed.add('cheatdeath');
      this.hp = s.maxHp * 0.3;
      this.invuln = 1;
      g.fx.text(this.x, this.y - 34, 'DEFIANCE!', '#ffe27a', 18, 1.4);
      g.events.emit('vfx', { kind: 'ring', x: this.x, y: this.y, r: 70, color: '#ffe27a', life: 0.5 });
      return;
    }
    if (f.has('phoenix') && !this.nightUsed.has('phoenix')) {
      this.nightUsed.add('phoenix');
      this.hp = s.maxHp * (0.5 + 0.1 * legendBonus(s, 'phoenix'));
      this.invuln = 1.5;
      explode(g, this.x, this.y, 170 * s.aoe, 120, { team: 'player', owner: this.id, color: '#ff8a3a', knock: 400, burn: 14, tag: 'other' });
      g.fx.text(this.x, this.y - 34, 'PHOENIX!', '#ffb347', 18, 1.4);
      g.fx.shake(14);
      return;
    }
    if (guardianSpirit(g, this, this)) return;
    this.die();
  }

  private die(): void {
    this.dead = true;
    this.hp = 0;
    this.respawn = 8;
    this.altHeld = false;
    this.altT = 0;
    this.dash = null;
    this.whirl = 0;
    this.buffs = {};
    this.barrier = 0;
    this.g.fx.particles(this.x, this.y, 40, this.def.color, 220, 1, 4);
    this.g.fx.shake(12, this.id);
    this.g.stats.deaths++;
    this.run.deaths++;
    this.g.events.emit('died', { id: this.id });
    this.g.fx.toast('You have fallen! The Hearth will revive you…', this.id);
    if (this.g.players.length > 1) this.g.fx.toast(`${this.name} has fallen!`);
  }

  private revive(): void {
    const spawn = this.spawnPoint();
    this.dead = false;
    this.hp = this.stats.maxHp;
    this.x = spawn.x;
    this.y = spawn.y;
    this.g.world.collide(this, true);
    this.invuln = 2.5;
    this.g.events.emit('vfx', { kind: 'ring', x: this.x, y: this.y, r: 80, color: '#ffd27a', life: 0.6 });
  }

  startDash(angle: number, speed: number, time: number, kind: Dash['kind'], dmg = 0, stun = 0): void {
    this.dash = { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, t: time, kind, dmg, stun, hits: new Set(), trail: 0 };
    this.invuln = Math.max(this.invuln, time + 0.05);
  }

  whirlRadius(): number { return (this.stats.flags.has('endless') ? 135 : 105) * this.stats.aoe; }

  get blocking(): boolean { return this.altHeld && this.def.alt.kind === 'block'; }

  /** Walking speed right now (online clients use it to predict their own movement). */
  get moveSpeed(): number {
    const f = this.stats.flags;
    const guard = !this.altHeld ? 1 : this.blocking && f.has('towershield') ? 0.85 : this.def.alt.move;
    return this.def.speed * this.stats.moveMul * guard * (f.has('lonewolf') && !hasCompanions(this.g, this) ? 1.1 : 1);
  }

  /** Share of damage Shield Block stops. */
  get blockReduce(): number {
    return Math.min(0.8, (this.def.alt.reduce ?? 0) + 0.1 * (this.stats.ranks.shieldmastery || 0));
  }

  /** Whether Shield Block stops a hit from this source (only frontal hits, unless Tower Shield). */
  private blocks(src?: Enemy): boolean {
    if (!this.blocking) return false;
    if (this.stats.flags.has('towershield')) return true;
    return !!src && Math.abs(angleDiff(this.angle, Math.atan2(src.y - this.y, src.x - this.x))) < 1;
  }

  /** Takes time off every spell cooldown (Mortal Momentum, Chronomancy). */
  reduceCooldowns(t: number): void {
    for (const k of Object.keys(this.cds) as SpellId[]) this.cds[k] = Math.max(0, this.cds[k]! - t);
  }

  schedule(t: number, fn: () => void): void { this.later.push({ t, fn }); }

  update(dt: number, it: Intent): void {
    const g = this.g;
    if (this.dead) {
      this.queued.clear();
      this.later = [];
      this.respawn -= dt;
      if (this.respawn <= 0) this.revive();
      return;
    }
    const s = this.stats, f = s.flags;
    this.reduceCooldowns(dt);
    for (const k of Object.keys(this.buffs) as (keyof Buffs)[]) {
      if ((this.buffs[k]! -= dt) <= 0) delete this.buffs[k];
    }
    if (!this.buffs.lust) this.lustStacks = 0;
    if ((this.barrierT -= dt) <= 0) this.barrier = 0;
    this.invuln = Math.max(0, this.invuln - dt);
    this.atkTimer -= dt;
    this.critCdT -= dt;
    this.rampageT -= dt;
    this.ruinT -= dt;

    let regen = s.regen;
    if (dist(this.x, this.y, g.world.hearth.x, g.world.hearth.y) < 200) regen += 4;
    if (f.has('survivalist') && this.hp < s.maxHp * 0.5) regen += 3;
    if (f.has('innerlight')) regen += s.maxHp * 0.01;
    if (this.hotT > 0) { this.hotT -= dt; regen += this.hot; }
    this.hp = Math.min(s.maxHp, this.hp + regen * dt);

    this.angle = Math.atan2(it.aimY - this.y, it.aimX - this.x);
    const len = Math.hypot(it.moveX, it.moveY);
    this.moveDir = len ? { x: it.moveX / len, y: it.moveY / len } : { x: 0, y: 0 };

    const wasHeld = this.altHeld;
    this.altHeld = it.alt && !this.dash && this.whirl <= 0;
    if (this.dash) this.updateDash(dt);
    else {
      const speed = this.moveSpeed;
      this.x += this.moveDir.x * speed * dt;
      this.y += this.moveDir.y * speed * dt;
      this.moving = len > 0;
      g.world.collide(this, true);
    }
    this.stillT = this.moving || this.dash ? 0 : this.stillT + dt;
    if (f.has('bastion') && this.stillT >= 1) {
      for (const e of enemiesInRadius(g, this.x, this.y, 220)) if (!e.def.guard) e.taunt = Math.max(e.taunt, 0.5);
    }
    if (f.has('item_dawn') && (this.dawnT -= dt) <= 0) {
      this.dawnT = 12;
      this.shield(s.maxHp * (0.15 + 0.025 * legendBonus(s, 'aegis')), 6);
    }
    if (f.has('infernoaura') && (this.auraT -= dt) <= 0) {
      this.auraT = 0.5;
      for (const e of enemiesInRadius(g, this.x, this.y, 130 * s.aoe)) applyDot(e, 10 * burnMul(this), 1.5, BURN_COLOR);
    }

    if (this.whirl > 0) this.updateWhirl(dt);
    this.updateAlt(dt, it, wasHeld);

    if (it.attack && this.atkTimer <= 0 && !this.dash && !this.altHeld) {
      this.atkTimer = this.def.basic.cd / s.atkSpeed;
      basicAttack(g, this);
      g.events.emit('anim', { id: this.id, anim: 'attack' });
    }

    for (const id of it.casts) this.queued.set(id, CAST_BUFFER);
    for (const [id, t] of this.queued) {
      const sp: SpellDef | undefined = id === this.def.mobility.id ? this.def.mobility : this.def.spells.find(x => x.id === id);
      if (!sp || this.cast(sp, it.aimX, it.aimY) || t - dt <= 0) this.queued.delete(id);
      else this.queued.set(id, t - dt);
    }

    for (const l of this.later) l.t -= dt;
    const due = this.later.filter(l => l.t <= 0);
    this.later = this.later.filter(l => l.t > 0);
    for (const l of due) l.fn();
  }

  private updateWhirl(dt: number): void {
    const g = this.g, f = this.stats.flags;
    this.whirl -= dt;
    this.whirlTick -= dt;
    if (this.whirlTick > 0) return;
    this.whirlTick = 0.25;
    const vortex = f.has('vortex'), storm = f.has('bladestorm');
    for (const e of enemiesInRadius(g, this.x, this.y, this.whirlRadius())) {
      dealPlayerDamage(g, this, e, storm ? 19.6 : 14, vortex ? { tag: 'whirl' } : { knock: 140, fromX: this.x, fromY: this.y, tag: 'whirl' });
      if (e.dead) continue;
      if (storm) applyDot(e, 6 * this.bleedMul, 3, BLEED_COLOR);
      if (vortex && !e.def.boss) {
        const a = Math.atan2(this.y - e.y, this.x - e.x);
        e.kx += Math.cos(a) * 170;
        e.ky += Math.sin(a) * 170;
      }
    }
  }

  /** Right-click abilities other than Shield Block (which works inside hurt()). */
  private updateAlt(dt: number, it: Intent, wasHeld: boolean): void {
    const g = this.g, kind = this.def.alt.kind;
    this.altEnd = null;
    if (kind === 'aimed') {
      // Rolling drops the draw without firing.
      if (this.dash) { this.altT = 0; return; }
      if (this.altHeld) { this.altT = Math.min(AIM_MAX, this.altT + dt); return; }
      // Released (not interrupted by a roll): loose the arrow.
      if (wasHeld && !it.alt && this.altT >= 0.15) {
        fireAimedShot(g, this, this.altT / AIM_MAX);
        g.events.emit('anim', { id: this.id, anim: 'attack' });
      }
      this.altT = 0;
      return;
    }
    if (!this.altHeld) { this.altT = 0; return; }
    this.altT += dt;
    if (kind === 'beam') channelBeam(g, this, dt);
    else if (kind === 'mend') channelMend(g, this, dt, it.aimX, it.aimY);
  }

  /** Deep Wounds makes bleeds hit harder. */
  get bleedMul(): number { return 1 + 0.5 * (this.stats.ranks.deepwounds || 0); }

  private updateDash(dt: number): void {
    const g = this.g, d = this.dash!, s = this.stats, f = s.flags;
    this.x += d.vx * dt;
    this.y += d.vy * dt;
    d.t -= dt;
    this.moving = true;
    if (d.kind === 'charge' || f.has('rollbash')) {
      for (const e of g.enemies) {
        if (e.dead || d.hits.has(e.id) || dist(e.x, e.y, this.x, this.y) > e.r + this.r + 10) continue;
        d.hits.add(e.id);
        if (d.kind === 'roll') {
          dealPlayerDamage(g, this, e, 10, { knock: 320, fromX: this.x, fromY: this.y, tag: 'other' });
          if (!e.def.boss) e.stun = Math.max(e.stun, 0.8);
          continue;
        }
        // Juggernaut shoves enemies along the charge instead of off to the sides.
        const shove = f.has('juggernaut')
          ? { knock: 650, fromX: this.x - d.vx * 0.1, fromY: this.y - d.vy * 0.1 }
          : { knock: 260, fromX: this.x, fromY: this.y };
        dealPlayerDamage(g, this, e, d.dmg, { ...shove, tag: 'charge' });
        e.stun = Math.max(e.stun, d.stun);
        if (f.has('smash')) e.marked = Math.max(e.marked, 6);
      }
    }
    if (d.kind === 'charge') {
      if (f.has('ravager') && (d.trail += Math.hypot(d.vx, d.vy) * dt) > 45) {
        d.trail = 0;
        g.zones.push({ id: g.nextId(), owner: this.id, kind: 'field', x: this.x, y: this.y, t: 0, r: 34, life: 3, tick: 0, dps: 18, burn: 6, color: '#ff8a3a' });
      }
      if (Math.random() < 0.8) g.fx.particles(this.x, this.y, 1, '#f2c879', 40, 0.3, 3);
    } else {
      g.fx.particles(this.x, this.y + 8, 1, 'rgba(220,220,200,0.6)', 30, 0.3, 4);
    }
    const hitWall = g.world.collide(this, true);
    if (d.t <= 0 || (hitWall && d.kind === 'charge')) {
      if (d.kind === 'charge' && f.has('seismic')) {
        const after = s.ranks.aftershock || 0;
        explode(g, this.x, this.y, 120 * s.aoe * (1 + 0.4 * after), 55,
          { team: 'player', owner: this.id, color: '#f2a65a', knock: 300, stun: after ? 0.6 * after : undefined, tag: 'charge' });
      }
      this.dash = null;
    }
  }

  /** Cooldown of a spell after talents. */
  spellCd(sp: SpellDef): number {
    const f = this.stats.flags;
    let mul = 1;
    if (sp.id === 'battlecry' && f.has('indomitable')) mul *= 0.5;
    if (sp.id === 'frostnova' && f.has('coldsnap')) mul *= 0.7;
    if (sp.id === 'blink' && f.has('displacement')) mul *= 0.6;
    if (sp.id === 'blink' && f.has('presence')) mul *= 1.5;
    if (sp.id === 'volley' && f.has('quickdraw')) mul *= 0.65;
    if (sp.id === 'snare' && f.has('trapmaster')) mul *= 0.6;
    if (sp.id === 'holynova' && f.has('flashnova')) mul *= 0.65;
    const cd = sp.cd * mul * (1 - this.stats.cdr);
    return sp.id === 'holynova' && this.buffs.apo ? Math.min(cd, 1) : cd;
  }

  /** Returns true once the spell went off. */
  private cast(sp: SpellDef, tx: number, ty: number): boolean {
    if ((this.cds[sp.id] || 0) > 0 || this.dash) return false;
    if (!castSpell(this.g, this, sp.id, tx, ty)) return false;
    this.cds[sp.id] = this.spellCd(sp);
    if (sp.id === 'blink' && this.stats.flags.has('presence')) this.cds.fireball = this.cds.frostnova = 0;
    if (sp.id === 'roll') this.afterRoll();
    if (sp.id !== this.def.mobility.id) this.g.events.emit('anim', { id: this.id, anim: 'attack2' });
    return true;
  }

  private afterRoll(): void {
    const f = this.stats.flags;
    if (f.has('shieldwall')) this.buffs.wall = 2.3;
    if (f.has('camo')) {
      this.buffs.camo = 1.5;
      this.g.fx.particles(this.x, this.y, 16, '#6fcf86', 90, 0.5, 4);
    }
    if (f.has('strafe')) fireArrowFan(this.g, this, this.angle + Math.PI, 5, 0.8, 12);
  }

  /** 0 when ready, 1 right after casting. */
  cooldownFrac(sp: SpellDef): number {
    const rem = this.cds[sp.id] || 0;
    return rem <= 0 ? 0 : Math.min(1, rem / this.spellCd(sp));
  }
}
