// The simulation root. Owns all game state and advances it in fixed steps. It has no knowledge
// of Phaser or the DOM: each step it reads every player's Intent and reports what happened
// through `events`. Solo play runs it in the browser; multiplayer runs it on the server.

import { FIRST_DAY_LEN } from '../config';
import { RES_EMOJI } from '../data/enemies';
import { CAMPS, type ShopEffect } from '../data/events';
import type { BuildSlot, ClassId, Cost, ResKey } from '../data/types';
import { MAX_PLAYERS, PARTY_SCALE } from '../config';
import type { Rarity } from '../data/items';
import { Emitter } from '../core/events';
import type { GameEvents } from './events';
import { World, tileOf, type Building } from './world';
import { generateWorld } from './worldgen';
import { Player } from './player';
import type { Enemy } from './enemy';
import type { Ally } from './ally';
import type { Projectile } from './projectiles';
import { updateProjectiles } from './projectiles';
import { updateZone, type Zone } from './zones';
import { updateDefenses } from './defenses';
import { startNight, updateCycle, type NightPlan, type SpawnEntry } from './cycle';
import { buy, interact, spawnCamp, updateDaylife, type Camp, type Npc, type Pickup } from './daylife';
import { generateDungeons, type Dungeon } from './dungeons';
import { makeItem, noteFind, updateLoot, type Item, type Loot } from './items';

export type Phase = 'day' | 'night';

/** Seconds a vote to start the night early stays open. */
export const NIGHT_VOTE_TIME = 30;

/** Tower and Hearth talents work for the whole team: the best value of each, and every flag. */
export interface TeamStats { towerDmg: number; towerSpeed: number; towerRange: number; flags: Set<string> }

export class Game {
  readonly events = new Emitter<GameEvents>();
  private idCounter = 1;

  time = 0;
  day = 1;
  phase: Phase = 'day';
  phaseTime = 0;
  phaseLen = FIRST_DAY_LEN;
  over = false;
  /** The final night was survived. The run may go on (endless) until the Hearth falls. */
  won = false;
  /** Game time of the win, for the leaderboard. */
  wonAt = 0;
  /** The final night's boss is still alive past the night's end, so dawn waits. */
  holdNight = false;
  /** Hearth health alerts already sent to players in dungeons tonight. */
  hearthAlert = 0;
  /** Most players the run has had at once (its leaderboard bracket). */
  peakParty = 0;
  hearthLevel = 1;
  /** A client's mirror of a server game (online play): never stepped, filled from snapshots. */
  replica = false;

  res: Record<ResKey, number> = { wood: 60, stone: 25, gold: 0 };
  stats = { kills: 0, built: 0, gathered: 0, deaths: 0, nights: 0 };

  readonly world: World;
  players: Player[] = [];
  team: TeamStats = { towerDmg: 1, towerSpeed: 1, towerRange: 1, flags: new Set() };
  enemies: Enemy[] = [];
  allies: Ally[] = [];
  projectiles: Projectile[] = [];
  zones: Zone[] = [];

  spawnQueue: SpawnEntry[] = [];
  spawnAngles: number[] = [];
  nightPlan: NightPlan | null = null;
  bloodMoon = false;
  bloodMoonNext = false;
  /** Players who voted to start the night early, and seconds before the vote lapses. */
  nightVotes = new Set<number>();
  voteT = 0;

  camps: Camp[] = [];
  npcs: Npc[] = [];
  pickups: Pickup[] = [];
  /** Merchant items already bought this visit. */
  shopBought = new Set<ShopEffect>();
  /** Equipment the merchant is selling this visit. */
  wares: Item[] = [];
  /** Items lying on the ground. */
  loot: Loot[] = [];
  /** Dungeon entrances and interiors (layouts from the seed). */
  dungeons: Dungeon[] = [];

  private flowTimer = 0;

  /** Shorthands for visual feedback; all of it goes out as events. */
  readonly fx = {
    particles: (x: number, y: number, n: number, color: string, speed: number, life: number, size: number) =>
      this.events.emit('particles', { x, y, n, color, speed, life, size }),
    text: (x: number, y: number, text: string, color: string, size = 13, life?: number) =>
      this.events.emit('text', { x, y, text, color, size, life }),
    /** Screen shake; `to` limits it to one player's screen. */
    shake: (n: number, to?: number) => this.events.emit('shake', { n, to }),
    /** A message; `to` limits it to one player. */
    toast: (msg: string, to?: number) => this.events.emit('toast', { msg, to }),
  };

  constructor(readonly seed = (Math.random() * 1e9) | 0) {
    this.world = new World(this);
    generateWorld(this.world, seed);
    this.dungeons = generateDungeons(this, seed);
    for (let i = 0; i < CAMPS.initial; i++) spawnCamp(this);
    // What dawn regrowth refills toward: the map as it starts.
    for (const n of this.world.nodes) this.world.start[n.type]++;
    this.world.computeFlow();
  }

  nextId(): number { return this.idCounter++; }

  /** `heirloom`: rarity of the starting weapon this player unlocked in earlier runs. */
  addPlayer(cls: ClassId, name: string, heirloom?: Rarity | null): Player {
    if (this.players.length >= MAX_PLAYERS) throw new Error('Game is full');
    const p = new Player(this, cls, name, this.players.length);
    this.players.push(p);
    this.peakParty = Math.max(this.peakParty, this.players.length);
    if (heirloom) {
      p.equip.weapon = makeItem(this, 1, heirloom, 'weapon');
      noteFind(p, p.equip.weapon);
      p.recalc();
    }
    this.updateTeam();
    return p;
  }

  /** How much bigger nights (and bosses) are for the current party. */
  get partyMul(): number {
    return 1 + PARTY_SCALE * (Math.max(1, this.players.length) - 1);
  }

  /** A player left: they and their companions go. */
  removePlayer(id: number): void {
    this.players = this.players.filter(p => p.id !== id);
    this.allies = this.allies.filter(a => a.owner.id !== id);
    this.updateTeam();
  }

  playerById(id: number | undefined): Player | undefined {
    return this.players.find(p => p.id === id);
  }

  /** The player who owns something (a zone, a projectile), falling back to any player. */
  owner(id: number | undefined): Player {
    return this.playerById(id) ?? this.players[0];
  }

  /** Recomputes team-wide tower and Hearth bonuses (after talents change or players join). */
  updateTeam(): void {
    const t: TeamStats = { towerDmg: 1, towerSpeed: 1, towerRange: 1, flags: new Set() };
    for (const p of this.players) {
      const s = p.stats;
      t.towerDmg = Math.max(t.towerDmg, s.towerDmg);
      t.towerSpeed = Math.max(t.towerSpeed, s.towerSpeed);
      t.towerRange = Math.max(t.towerRange, s.towerRange);
      for (const f of s.flags) t.flags.add(f);
    }
    this.team = t;
  }

  step(dt: number): void {
    if (this.over) return;
    this.time += dt;
    updateCycle(this, dt);
    this.updateNightVote(dt);

    this.flowTimer -= dt;
    if (this.world.flowDirty || this.flowTimer <= 0) {
      this.world.computeFlow();
      this.flowTimer = 1;
    }

    for (const p of this.players) p.update(dt, p.intent);
    updateDaylife(this, dt);
    updateLoot(this, dt);
    for (const e of this.enemies) e.update(dt);
    this.separateEnemies();
    this.enemies = this.enemies.filter(e => !e.dead);

    updateDefenses(this, dt);
    updateProjectiles(this, dt);
    // Zones can spawn zones (a snare's cloud, a meteor's crater), so don't rebuild the list mid-update.
    const done = new Set<Zone>();
    for (const z of [...this.zones]) if (!updateZone(this, z, dt)) done.add(z);
    this.zones = this.zones.filter(z => !done.has(z));
  }

  endGame(): void {
    if (this.over) return;
    this.over = true;
    this.events.emit('gameOver', undefined);
  }

  /** Monsters attacking tonight (camp guards don't count). */
  get waveRemaining(): number {
    return this.enemies.filter(e => !e.def.guard && !e.dungeon).length + this.spawnQueue.length;
  }

  // ----------------------------- Economy ----------------------------------

  canAfford(cost: Cost): boolean {
    return (Object.keys(cost) as ResKey[]).every(k => this.res[k] >= cost[k]!);
  }

  pay(cost: Cost): void {
    for (const k of Object.keys(cost) as ResKey[]) this.res[k] -= cost[k]!;
  }

  // ----------------------------- Commands ---------------------------------
  // Called by the client between steps. Problems are reported as floating text.

  /** Players who get a say in starting the night (connected ones). */
  get voters(): Player[] { return this.players.filter(p => !p.offline); }

  /**
   * `p` wants the night to start early. Alone it starts at once; with others it's a vote that
   * passes when every connected player agrees. Asking again withdraws the vote.
   */
  callNight(p: Player): void {
    if (this.phase !== 'day' || this.over) return;
    const voters = this.voters;
    if (voters.length <= 1) return startNight(this, true);
    if (this.nightVotes.has(p.id)) {
      this.nightVotes.delete(p.id);
      this.fx.toast(`${p.name} withdrew their vote to start the night.`);
      if (!this.nightVotes.size) this.voteT = 0;
      return;
    }
    this.nightVotes.add(p.id);
    this.voteT = NIGHT_VOTE_TIME;
    if (this.voteReady()) return;
    const n = voters.filter(q => this.nightVotes.has(q.id)).length;
    this.fx.toast(n === 1
      ? `${p.name} wants to start the night (1/${voters.length}). Press N to agree.`
      : `${p.name} agreed to start the night (${n}/${voters.length}).`);
  }

  /** Starts the night if every connected player has voted for it. */
  private voteReady(): boolean {
    const voters = this.voters;
    if (!this.nightVotes.size || !voters.every(q => this.nightVotes.has(q.id))) return false;
    this.nightVotes.clear();
    this.voteT = 0;
    if (voters.length > 1) this.fx.toast('Everyone agreed: the night begins!');
    startNight(this, true);
    return true;
  }

  private updateNightVote(dt: number): void {
    if (!this.nightVotes.size) return;
    // Forget votes from players who left.
    for (const id of this.nightVotes) if (!this.playerById(id)) this.nightVotes.delete(id);
    if (this.phase !== 'day') { this.nightVotes.clear(); return; }
    // Someone who hadn't voted may have left or dropped: the rest may all agree now.
    if (this.voteReady()) return;
    if ((this.voteT -= dt) <= 0) {
      this.nightVotes.clear();
      this.fx.toast('The vote to start the night ran out.');
    }
  }

  interact(p: Player): void { interact(this, p); }

  buy(p: Player, item: ShopEffect): string | null { return buy(this, p, item); }

  build(p: Player, type: BuildSlot, wx: number, wy: number, feedback = true): boolean {
    const tx = tileOf(wx), ty = tileOf(wy);
    const err = this.world.placementError(p, type, tx, ty);
    if (err) {
      if (feedback) this.fx.text(wx, wy, err, '#ff8080', 13);
      return false;
    }
    this.world.place(type, tx, ty, p);
    return true;
  }

  upgrade(p: Player, b: Building): void {
    const err = this.world.upgradeError(p, b);
    if (err) return this.fx.text(b.x, b.y - 20, err, '#ff8080', 13);
    this.world.upgrade(p, b);
  }

  repair(b: Building): void {
    if (b.type === 'hearth') return this.fx.text(b.x, b.y - 20, 'The Hearth mends itself by day', '#ff8080', 13);
    if (b.hp >= b.maxHp) return this.fx.text(b.x, b.y - 20, 'Already intact', '#cccccc', 12);
    const c = this.world.repairCost(b);
    if (!this.canAfford(c)) return this.fx.text(b.x, b.y - 20, `Need ${c.wood} ${RES_EMOJI.wood}`, '#ff8080', 13);
    this.pay(c);
    b.hp = b.maxHp;
    this.fx.text(b.x, b.y - 20, 'Repaired', '#8fff9a', 13);
    this.fx.particles(b.x, b.y, 8, '#8fff9a', 80, 0.4, 3);
  }

  demolish(b: Building): void {
    if (b.type === 'hearth') return this.fx.text(b.x, b.y - 20, "Can't demolish the Hearth", '#ff8080', 13);
    const refund = this.world.demolishRefund(b);
    for (const k of Object.keys(refund) as ResKey[]) this.res[k] += refund[k]!;
    this.world.destroy(b);
    const label = (Object.keys(refund) as ResKey[]).map(k => `+${refund[k]} ${RES_EMOJI[k]}`).join(' ');
    if (label) this.fx.text(b.x, b.y - 20, label, '#e9f5c9', 13);
  }

  /** Soft push between monsters, weighted so big ones shove small ones aside. */
  private separateEnemies(): void {
    const cell = 64, grid = new Map<number, Enemy[]>();
    for (const e of this.enemies) {
      const k = ((e.x / cell) | 0) + ((e.y / cell) | 0) * 1024;
      let a = grid.get(k);
      if (!a) grid.set(k, (a = []));
      a.push(e);
    }
    for (const e of this.enemies) {
      const cx = (e.x / cell) | 0, cy = (e.y / cell) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const a = grid.get(cx + ox + (cy + oy) * 1024);
        if (!a) continue;
        for (const o of a) {
          if (o.id <= e.id || !!o.def.flying !== !!e.def.flying) continue;
          const dx = e.x - o.x, dy = e.y - o.y, rr = e.r + o.r, d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-4) continue;
          const d = Math.sqrt(d2), push = (rr - d) * 0.5, nx = dx / d, ny = dy / d;
          const me = e.r * e.r, mo = o.r * o.r, tot = me + mo;
          e.x += nx * push * (mo / tot); e.y += ny * push * (mo / tot);
          o.x -= nx * push * (me / tot); o.y -= ny * push * (me / tot);
        }
      }
    }
  }
}
