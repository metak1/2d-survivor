// Saving and loading a run. The world is rebuilt from its seed (terrain, dungeon layouts), then
// everything that changed is laid over it: buildings, resource nodes, players and their gear,
// companions, monsters, loot, camps, dungeons, the day/night cycle and the economy.
// Things that last a moment (projectiles, spell zones, a dash in progress) aren't saved.
//
// Solo runs are saved in the browser (ui/saves.ts); online runs on the server (server/saves.ts).

import { BUILDINGS } from '../data/buildings';
import { NODES } from '../data/enemies';
import type { ClassId } from '../data/types';
import { Ally } from './ally';
import { Enemy } from './enemy';
import { Game } from './game';
import { Player } from './player';
import { idx, tierStats, type Building, type ResourceNode } from './world';

/** Bumped when the save format changes in a way older saves can't be read. */
export const SAVE_VERSION = 1;

type Plain = Record<string, unknown>;

/** What's shown in a list of saves, without loading them. */
export interface SaveMeta {
  day: number;
  phase: Game['phase'];
  nights: number;
  won: boolean;
  players: { name: string; cls: ClassId; level: number }[];
  savedAt: number;
}

export interface SaveData {
  v: number;
  seed: number;
  meta: SaveMeta;
  game: Plain;
  world: { buildings: Plain[]; nodes: Plain[]; start: Plain };
  players: PlayerSave[];
  enemies: Plain[];
  allies: Plain[];
  dungeons: Plain[];
  /** Where the run is on the leaderboard, so the entry keeps being updated after a resume. */
  extra?: { lb?: { id: string; key: string } | null };
}

/** A player and their companions: also how a character waits for its owner to come back online. */
export interface PlayerSave { player: Plain; allies: Plain[] }

/** Fields that point at other objects or are rebuilt on load (constructors and recompute set them). */
const SKIP = new Set(['g', 'def', 'stats', 'owner', 'src', 'taunter', 'bombardTarget', 'look', 'intent', 'later', 'queued', 'dash', 'charge']);

/** Copies an object's own data, turning Sets into arrays (marked so they come back as Sets). */
function plain(o: object): Plain {
  const out: Plain = {};
  for (const [k, v] of Object.entries(o)) {
    if (SKIP.has(k) || typeof v === 'function' || v instanceof Map) continue;
    out[k] = v instanceof Set ? { $set: [...v] } : v;
  }
  return JSON.parse(JSON.stringify(out));
}

/** Puts saved data back onto a freshly constructed object. */
function restore(target: object, data: Plain): void {
  const t = target as Record<string, unknown>;
  for (const [k, v] of Object.entries(data)) {
    t[k] = v && typeof v === 'object' && '$set' in (v as Plain) ? new Set((v as { $set: unknown[] }).$set) : v;
  }
}

const GAME_FIELDS = ['idCounter', 'time', 'day', 'phase', 'phaseTime', 'phaseLen', 'won', 'wonAt', 'holdNight', 'peakParty',
  'hearthLevel', 'res', 'stats', 'spawnQueue', 'spawnAngles', 'nightPlan', 'bloodMoon', 'bloodMoonNext', 'hearthAlert',
  'camps', 'npcs', 'pickups', 'shopBought', 'wares', 'loot'] as const;

export function saveMeta(g: Game, players = g.players.map(p => ({ name: p.name, cls: p.cls, level: p.level }))): SaveMeta {
  return { day: g.day, phase: g.phase, nights: g.stats.nights, won: g.won, players, savedAt: Date.now() };
}

export function savePlayer(g: Game, p: Player): PlayerSave {
  return { player: plain(p), allies: g.allies.filter(a => a.owner === p).map(a => plain(a)) };
}

/** Saves a run. `reserved`: characters whose players are away (online), kept with the run. */
export function saveGame(g: Game, reserved: PlayerSave[] = []): SaveData {
  const game: Plain = {};
  const gr = g as unknown as Record<string, unknown>;
  for (const k of GAME_FIELDS) game[k] = gr[k] instanceof Set ? { $set: [...(gr[k] as Set<unknown>)] } : gr[k];
  const players = [...g.players.map(p => savePlayer(g, p)), ...reserved];
  return {
    v: SAVE_VERSION,
    seed: g.seed,
    meta: saveMeta(g, players.map(s => ({ name: s.player.name as string, cls: s.player.cls as ClassId, level: s.player.level as number }))),
    game: JSON.parse(JSON.stringify(game)),
    world: {
      buildings: g.world.buildings.map(b => plain(b)),
      nodes: g.world.nodes.map(n => plain(n)),
      start: { ...g.world.start },
    },
    players,
    enemies: g.enemies.filter(e => !e.dead).map(e => plain(e)),
    allies: [],
    dungeons: g.dungeons.map(d => ({ id: d.id, depth: d.depth, cleared: d.cleared, reopen: d.reopen, populated: d.populated })),
  };
}

/** Rebuilds a run from a save. Players come back as they were; online, the room hands them out. */
export function loadGame(s: SaveData): Game {
  if (s.v !== SAVE_VERSION) throw new Error('This save is from an older version of the game');
  const g = new Game(s.seed);
  const w = g.world;
  // The constructor's own camps, guards and nodes give way to the saved ones.
  g.enemies = [];
  g.camps = [];
  for (const n of [...w.nodes]) w.removeNode(n);
  for (const b of [...w.buildings]) {
    for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) w.bld[idx(x, y)] = null;
  }
  w.buildings.length = 0;

  for (const k of GAME_FIELDS) {
    const v = s.game[k];
    (g as unknown as Record<string, unknown>)[k] = v && typeof v === 'object' && '$set' in (v as Plain) ? new Set((v as { $set: unknown[] }).$set) : v;
  }
  w.start = s.world.start as typeof w.start;

  for (const data of s.world.buildings) {
    const type = data.type as Building['type'];
    const b = { ...data, def: BUILDINGS[type], stats: tierStats(type, data.tier as number) } as unknown as Building;
    for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) w.bld[idx(x, y)] = b;
    w.buildings.push(b);
    if (b.type === 'hearth') w.hearth = b;
  }
  for (const data of s.world.nodes) {
    const n = { ...data, def: NODES[data.type as ResourceNode['type']] } as unknown as ResourceNode;
    w.nodes.push(n);
    w.node[idx(n.tx, n.ty)] = n;
  }
  w.changed();

  for (const d of s.dungeons) {
    const dg = g.dungeons.find(x => x.id === d.id);
    if (dg) Object.assign(dg, d);
  }
  for (const ps of s.players) restorePlayer(g, ps);
  for (const data of s.enemies) {
    const e = new Enemy(g, data.type as Enemy['type'], data.x as number, data.y as number, 1);
    restore(e, data);
    g.enemies.push(e);
  }
  g.updateTeam();
  return g;
}

/** Puts a saved character (and their companions) into a game. */
export function restorePlayer(g: Game, ps: PlayerSave): Player {
  const d = ps.player;
  const p = new Player(g, d.cls as ClassId, d.name as string, d.slot as number);
  restore(p, d);
  p.offline = false;
  g.players.push(p);
  g.peakParty = Math.max(g.peakParty, g.players.length);
  for (const a of ps.allies) {
    const ally = new Ally(g, p, a.kind as Ally['kind'], a.x as number, a.y as number);
    restore(ally, a);
    g.allies.push(ally);
  }
  // Stats come from talents and gear; recalculating them mustn't top up the saved health.
  p.recalc();
  p.hp = d.hp as number;
  return p;
}
