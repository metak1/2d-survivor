// Multiplayer state sync. The server encodes its Game into a Snapshot 30 times a second;
// each client applies snapshots to a local "replica" Game that is never stepped, so the renderer
// and UI read it exactly as they read a solo game. Buildings and resource nodes are only resent
// when they're added or removed (World.version); terrain comes from the shared seed.

import { TILE } from '../config';
import { hash2 } from '../core/math';
import { BUILDINGS } from '../data/buildings';
import { NODES } from '../data/enemies';
import type { BuildingId, ClassId, EnemyId, NodeId, SpellId } from '../data/types';
import type { GameEvents } from '../sim/events';
import { Ally, type AllyKind } from '../sim/ally';
import { Enemy } from '../sim/enemy';
import type { Game } from '../sim/game';
import { Player, type Buffs, type RunRecord } from '../sim/player';
import type { Projectile } from '../sim/projectiles';
import { computeStats } from '../sim/stats';
import { idx, tierStats, type Building, type ResourceNode } from '../sim/world';
import type { Zone } from '../sim/zones';
import type { Camp, Npc, Pickup } from '../sim/daylife';
import type { Interpolator } from './interp';
import type { Item, Loot } from '../sim/items';
import type { ItemSlot } from '../data/items';

export type EventName = keyof GameEvents;
export type NetEvent = [EventName, unknown];

/** Events forwarded to clients. Single-dot particles (trails, embers) are left to the client. */
export const NET_EVENTS: EventName[] = ['particles', 'text', 'shake', 'toast', 'banner', 'vfx', 'anim', 'died', 'levelUp',
  'scout', 'shop', 'forge', 'worldChanged', 'gameOver', 'victory'];

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface PlayerSnap {
  id: number; name: string; cls: ClassId; slot: number; x: number; y: number; hp: number; level: number; xp: number;
  points: number; talents: Record<string, number>; cds: Partial<Record<SpellId, number>>; buffs: Buffs; lust: number;
  barrier: number; angle: number; dead: boolean; respawn: number; lastHit: number; moving: boolean; invuln: number;
  whirl: number; alt: boolean; altT: number; altEnd: { x: number; y: number } | null; atk: number; dashing: boolean; offline: boolean;
  equip: Partial<Record<ItemSlot, Item>>;
  /** Only in the receiving player's own entry. */
  bag?: Item[];
  /** Run totals for the end screen: about once a second, and when the run is won or over. */
  run?: RunRecord;
  /** Discovered legendaries and Legendary Shards. */
  codex: string[]; shards: number;
}
interface EnemySnap {
  id: number; type: EnemyId; x: number; y: number; hp: number; maxHp: number; angle: number; moving: boolean;
  freeze: number; stun: number; root: number; shield: number; marked: number; lastHit: number;
}
interface AllySnap {
  id: number; owner: number; kind: AllyKind; x: number; y: number; hp: number; maxHp: number; dead: boolean;
  angle: number; moving: boolean; lastHit: number; barrier: number;
}
interface BuildingSnap { id: number; type: BuildingId; tier: number; tx: number; ty: number }
/** Per-snapshot building state: [id, hp, maxHp, angle, lastHit, wardUntil, wardMul]. */
type BuildingState = [number, number, number, number, number, number, number];
interface NodeSnap { id: number; type: NodeId; tx: number; ty: number; amount: number }

export interface Snapshot {
  time: number; day: number; phase: Game['phase']; phaseTime: number; phaseLen: number; over: boolean;
  won: boolean; wonAt: number; holdNight: boolean; peakParty: number;
  hearthLevel: number; res: Game['res']; stats: Game['stats']; bloodMoon: boolean; bloodMoonNext: boolean;
  queued: number; spawnAngles: number[]; plan: boolean; shopBought: string[];
  /** Night vote: who has voted, seconds left. */
  votes: number[]; voteT: number;
  loot: Loot[]; wares: Item[];
  /** Dungeon state (layouts come from the seed): [id, depth, cleared, reopen]. */
  dungeons: [number, number, boolean, number][];
  players: PlayerSnap[]; enemies: EnemySnap[]; allies: AllySnap[]; projectiles: Partial<Projectile>[]; zones: Zone[];
  camps: Camp[]; npcs: Npc[]; pickups: Pickup[];
  bstate: BuildingState[];
  /** Full lists, only when the world changed since the client last heard. */
  buildings?: BuildingSnap[];
  nodes?: NodeSnap[];
  /** Nodes hit since the last snapshot: [id, amount, lastHit]. */
  nodeHits: [number, number, number][];
  version: number;
  events: NetEvent[];
}

// ------------------------------------------------------------------ server side

/**
 * Builds a snapshot for one player. Pass the world version they already have, to skip unchanged
 * lists, and their player id, so only their own bag is sent.
 */
export function encodeSnapshot(g: Game, knownVersion: number, since: number, events: NetEvent[], forPlayer: number | null): Snapshot {
  const w = g.world;
  const full = knownVersion !== w.version;
  const withRun = g.over || (g.won && g.time - g.wonAt < 0.1) || Math.floor(g.time) !== Math.floor(since);
  return {
    time: g.time, day: g.day, phase: g.phase, phaseTime: r1(g.phaseTime), phaseLen: g.phaseLen, over: g.over,
    won: g.won, wonAt: g.wonAt, holdNight: g.holdNight, peakParty: g.peakParty,
    hearthLevel: g.hearthLevel, res: g.res, stats: g.stats, bloodMoon: g.bloodMoon, bloodMoonNext: g.bloodMoonNext,
    queued: g.spawnQueue.length, spawnAngles: g.spawnAngles, plan: !!g.nightPlan, shopBought: [...g.shopBought],
    votes: [...g.nightVotes], voteT: Math.ceil(g.voteT),
    loot: g.loot, wares: g.wares,
    dungeons: g.dungeons.map(d => [d.id, d.depth, d.cleared, d.reopen]),
    players: g.players.map(p => ({
      id: p.id, name: p.name, cls: p.cls, slot: p.slot, x: r1(p.x), y: r1(p.y), hp: r1(p.hp), level: p.level, xp: Math.floor(p.xp),
      points: p.points, talents: p.talents, cds: p.cds, buffs: p.buffs, lust: p.lustStacks, barrier: r1(p.barrier),
      angle: r2(p.angle), dead: p.dead, respawn: r1(p.respawn), lastHit: p.lastHit, moving: p.moving, invuln: r2(p.invuln),
      whirl: r2(p.whirl), alt: p.altHeld, altT: r2(p.altT), altEnd: p.altEnd, atk: r2(p.atkTimer), dashing: !!p.dash, offline: p.offline,
      equip: p.equip, bag: p.id === forPlayer ? p.bag : undefined, codex: [...p.codex], shards: p.shards,
      run: withRun ? { ...p.run, dmg: Math.round(p.run.dmg), heal: Math.round(p.run.heal), taken: Math.round(p.run.taken) } : undefined,
    })),
    enemies: g.enemies.filter(e => !e.dead).map(e => ({
      id: e.id, type: e.type, x: r1(e.x), y: r1(e.y), hp: Math.ceil(e.hp), maxHp: e.maxHp, angle: r2(e.angle), moving: e.moving,
      freeze: r2(e.freeze), stun: r2(e.stun), root: r2(e.root), shield: r2(e.shield), marked: r2(e.marked), lastHit: e.lastHit,
    })),
    allies: g.allies.map(a => ({
      id: a.id, owner: a.owner.id, kind: a.kind, x: r1(a.x), y: r1(a.y), hp: Math.ceil(a.hp), maxHp: a.maxHp, dead: a.dead,
      angle: r2(a.angle), moving: a.moving, lastHit: a.lastHit, barrier: r1(a.barrier),
    })),
    projectiles: g.projectiles.map(pr => ({
      id: pr.id, kind: pr.kind, team: pr.team, x: r1(pr.x), y: r1(pr.y), vx: Math.round(pr.vx), vy: Math.round(pr.vy),
      r: pr.r, scale: pr.scale, light: pr.light, trail: pr.trail, lob: pr.lob,
    })),
    // Zones are plain data, except a telegraph's link to the monster it follows.
    zones: g.zones.map(z => (z.kind === 'telegraph' ? { ...z, follow: undefined } : z) as Zone),
    camps: g.camps, npcs: g.npcs, pickups: g.pickups,
    bstate: w.buildings.map(b => [b.id, Math.ceil(b.hp), b.maxHp, r2(b.angle), b.lastHit, b.ward?.until ?? 0, b.ward?.mul ?? 1]),
    buildings: full ? w.buildings.map(b => ({ id: b.id, type: b.type, tier: b.tier, tx: b.tx, ty: b.ty })) : undefined,
    nodes: full ? w.nodes.map(n => ({ id: n.id, type: n.type, tx: n.tx, ty: n.ty, amount: n.amount })) : undefined,
    nodeHits: w.nodes.filter(n => n.lastHit > since).map(n => [n.id, n.amount, n.lastHit]),
    version: w.version,
    events,
  };
}

// ------------------------------------------------------------------ client side

/** Last talents and gear each replicated player's stats were computed from. */
const gearKeys = new WeakMap<Player, string>();

/** Where each projectile was in the latest snapshot, to place it at the drawing clock. */
const projBase = new WeakMap<Projectile, { t: number; x: number; y: number; lobT: number }>();

/**
 * Applies a snapshot to a replica. Positions go into the Interpolator (drawn slightly later, see
 * smooth). Our own player (`selfId`) keeps its predicted position, facing and walk state.
 * Returns where the server has our own player, for the Predictor.
 */
export function applySnapshot(g: Game, s: Snapshot, interp: Interpolator, selfId: number): { x: number; y: number } | null {
  g.day = s.day;
  g.phase = s.phase;
  g.phaseTime = s.phaseTime;
  g.phaseLen = s.phaseLen;
  g.over = s.over;
  g.won = s.won;
  g.wonAt = s.wonAt;
  g.holdNight = s.holdNight;
  g.peakParty = s.peakParty;
  g.hearthLevel = s.hearthLevel;
  g.res = s.res;
  g.stats = s.stats;
  g.bloodMoon = s.bloodMoon;
  g.bloodMoonNext = s.bloodMoonNext;
  g.spawnQueue = new Array(s.queued);
  g.spawnAngles = s.spawnAngles;
  g.nightPlan = s.plan ? { len: 0, angles: s.spawnAngles, queue: [], bloodMoon: s.bloodMoon } : null;
  g.shopBought = new Set(s.shopBought as never[]);
  g.nightVotes = new Set(s.votes);
  g.voteT = s.voteT;
  g.loot = s.loot;
  g.wares = s.wares;
  for (const [id, depth, cleared, reopen] of s.dungeons) {
    const d = g.dungeons.find(x => x.id === id);
    if (d) Object.assign(d, { depth, cleared, reopen });
  }
  g.camps = s.camps;
  g.npcs = s.npcs;
  g.pickups = s.pickups;

  const seen = new Set<number>();
  const aim = (id: number, x: number, y: number, o: { x: number; y: number }, fresh: boolean) => {
    seen.add(id);
    if (fresh) { o.x = x; o.y = y; }
    interp.push(id, s.time, x, y);
  };
  let self: { x: number; y: number } | null = null;

  // Players: talents only recompute stats when they changed.
  const players: Player[] = [];
  for (const ps of s.players) {
    let p = g.playerById(ps.id);
    const fresh = !p;
    if (!p) {
      p = new Player(g, ps.cls, ps.name, ps.slot);
      (p as { id: number }).id = ps.id;
    }
    // Stats only need recomputing when talents or gear changed.
    const gearKey = JSON.stringify([ps.talents, Object.values(ps.equip).map(i => i?.id)]);
    if (fresh || gearKey !== gearKeys.get(p)) {
      gearKeys.set(p, gearKey);
      p.talents = ps.talents;
      p.equip = ps.equip;
      p.stats = computeStats(p.cls, p.talents, p.worn);
    }
    if (ps.bag) p.bag = ps.bag;
    if (ps.run) p.run = ps.run;
    p.codex = new Set(ps.codex);
    p.shards = ps.shards;
    Object.assign(p, {
      hp: ps.hp, level: ps.level, xp: ps.xp, points: ps.points, cds: ps.cds, buffs: ps.buffs, lustStacks: ps.lust,
      barrier: ps.barrier, dead: ps.dead, respawn: ps.respawn, lastHit: ps.lastHit,
      invuln: ps.invuln, whirl: ps.whirl, altHeld: ps.alt, altT: ps.altT, altEnd: ps.altEnd, atkTimer: ps.atk, offline: ps.offline,
      // A stand-in so code that checks "is dashing" works; the dash itself runs on the server.
      dash: ps.dashing ? { vx: 0, vy: 0, t: 0, kind: 'roll', dmg: 0, stun: 0, hits: new Set(), trail: 0 } : null,
    });
    if (ps.id !== selfId || fresh) Object.assign(p, { angle: ps.angle, moving: ps.moving });
    aim(ps.id, ps.x, ps.y, p, fresh);
    if (ps.id === selfId) self = { x: ps.x, y: ps.y };
    players.push(p);
  }
  g.players = players;
  g.updateTeam();

  const enemies: Enemy[] = [];
  const known = new Map(g.enemies.map(e => [e.id, e]));
  for (const es of s.enemies) {
    let e = known.get(es.id);
    const fresh = !e;
    if (!e) {
      e = new Enemy(g, es.type, es.x, es.y, 1);
      (e as { id: number }).id = es.id;
    }
    Object.assign(e, {
      hp: es.hp, maxHp: es.maxHp, angle: es.angle, moving: es.moving, freeze: es.freeze, stun: es.stun, root: es.root,
      shield: es.shield, marked: es.marked, lastHit: es.lastHit,
    });
    aim(es.id, es.x, es.y, e, fresh);
    enemies.push(e);
  }
  g.enemies = enemies;

  const allies: Ally[] = [];
  const knownAllies = new Map(g.allies.map(a => [a.id, a]));
  for (const as of s.allies) {
    const owner = g.playerById(as.owner);
    if (!owner) continue;
    let a = knownAllies.get(as.id);
    const fresh = !a;
    if (!a) {
      a = new Ally(g, owner, as.kind, as.x, as.y);
      (a as { id: number }).id = as.id;
    }
    Object.assign(a, { hp: as.hp, maxHp: as.maxHp, dead: as.dead, angle: as.angle, moving: as.moving, lastHit: as.lastHit, barrier: as.barrier });
    aim(as.id, as.x, as.y, a, fresh);
    allies.push(a);
  }
  g.allies = allies;

  g.projectiles = s.projectiles.map(pr => {
    const p = { ...pr, hits: new Set(), life: 1, dmg: 0, pierce: 0 } as Projectile;
    projBase.set(p, { t: s.time, x: p.x, y: p.y, lobT: p.lob?.t ?? 0 });
    return p;
  });
  g.zones = s.zones;

  interp.retain(seen);
  applyWorld(g, s);
  return self;
}

function applyWorld(g: Game, s: Snapshot): void {
  const w = g.world;
  if (s.buildings) {
    const old = new Map(w.buildings.map(b => [b.id, b]));
    w.bld.fill(null);
    const list = s.buildings.map(bs => {
      const prev = old.get(bs.id);
      const def = BUILDINGS[bs.type], size = def.size || 1;
      const b: Building = prev && prev.tier === bs.tier ? prev : {
        id: bs.id, type: bs.type, def, tier: bs.tier, stats: tierStats(bs.type, bs.tier), tx: bs.tx, ty: bs.ty, size,
        x: (bs.tx + size / 2) * TILE, y: (bs.ty + size / 2) * TILE, hp: 1, maxHp: 1, timer: 0, angle: -Math.PI / 2,
        dead: false, paid: {}, lastHit: -1,
      };
      for (let y = b.ty; y < b.ty + size; y++) for (let x = b.tx; x < b.tx + size; x++) w.bld[idx(x, y)] = b;
      if (b.type === 'hearth') w.hearth = b;
      return b;
    });
    w.buildings.splice(0, w.buildings.length, ...list);
  }
  const byId = new Map(w.buildings.map(b => [b.id, b]));
  for (const [id, hp, maxHp, angle, lastHit, wardUntil, wardMul] of s.bstate) {
    const b = byId.get(id);
    if (!b) continue;
    b.hp = hp;
    b.maxHp = maxHp;
    b.angle = angle;
    b.lastHit = lastHit;
    b.ward = wardUntil ? { until: wardUntil, mul: wardMul } : undefined;
  }
  if (s.nodes) {
    w.node.fill(null);
    const list = s.nodes.map(ns => {
      const def = NODES[ns.type];
      // Same look as on the server: World.trySpawnNode derives it from the tile.
      const n: ResourceNode = { id: ns.id, type: ns.type, def, tx: ns.tx, ty: ns.ty, x: (ns.tx + 0.5) * TILE, y: (ns.ty + 0.5) * TILE,
        r: def.r, amount: ns.amount, seed: hash2(ns.tx * 31, ns.ty * 17), lastHit: -1 };
      w.node[idx(ns.tx, ns.ty)] = n;
      return n;
    });
    w.nodes.splice(0, w.nodes.length, ...list);
  }
  if (s.nodeHits.length) {
    const nodes = new Map(w.nodes.map(n => [n.id, n]));
    for (const [id, amount, lastHit] of s.nodeHits) {
      const n = nodes.get(id);
      if (n) { n.amount = amount; n.lastHit = lastHit; }
    }
  }
}

/**
 * Moves everything the server controls to where it was at the drawing clock: characters along
 * their recent snapshots, projectiles along their flight. Our own player is left to the Predictor.
 */
export function smooth(g: Game, interp: Interpolator, selfId: number, localNow: number): void {
  interp.advance(localNow);
  g.time = interp.renderTime;
  const place = (o: { id: number; x: number; y: number }) => {
    if (o.id === selfId) return;
    const at = interp.sample(o.id);
    if (at) { o.x = at.x; o.y = at.y; }
  };
  for (const p of g.players) place(p);
  for (const e of g.enemies) place(e);
  for (const a of g.allies) place(a);
  for (const pr of g.projectiles) {
    const base = projBase.get(pr);
    if (!base) continue;
    const age = g.time - base.t;
    if (pr.lob) {
      const L = pr.lob, q = Math.max(0, Math.min(1, (base.lobT + age) / L.dur));
      pr.x = L.sx + (L.tx - L.sx) * q;
      pr.y = L.sy + (L.ty - L.sy) * q;
      L.h = Math.sin(Math.PI * q) * (pr.kind === 'cannon' ? 110 : 70);
    } else {
      pr.x = base.x + pr.vx * age;
      pr.y = base.y + pr.vy * age;
    }
  }
}
