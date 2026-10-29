// One co-op room: up to MAX_PLAYERS people, a lobby where they pick classes, and the run they play.
// The room runs the real Game at 60 steps a second from its members' inputs and sends each of
// them a snapshot 30 times a second. GameServer (server.ts) owns the connections and routes
// messages here.

import { MAX_PLAYERS, STEP } from '../src/config';
import { CLASS_IDS } from '../src/data/classes';
import type { Rarity } from '../src/data/items';
import type { ClassId, SpellId } from '../src/data/types';
import { applyCommand, parseCommand } from '../src/sim/commands';
import { Game } from '../src/sim/game';
import { NO_INTENT, type Intent } from '../src/sim/player';
import { encodeSnapshot, NET_EVENTS, type NetEvent } from '../src/net/snapshot';
import type { ClientMsg, LobbyMember, RoomInfo, ServerMsg } from '../src/net/protocol';
import { leaderboard } from './leaderboard';
import { nightProgress } from '../src/sim/cycle';

/** Steps between snapshots (60 / 2 = 30 a second). */
const SNAP_EVERY = 2;

/** A connected (or briefly disconnected) person. Owned by GameServer. */
export interface Client {
  id: number;
  token: string;
  name: string;
  cls: ClassId;
  /** Starting weapon this player unlocked for `cls` (reported by their browser). */
  heir: Rarity | null;
  room: Room | null;
  /** In-game player id, while in a run. */
  player: number | null;
  intent: Omit<Intent, 'casts'>;
  casts: SpellId[];
  /** Last input sequence number received (echoed in snapshots for client prediction). */
  seq: number;
  /** World version this client has the building and node lists for. */
  version: number;
  /** null while disconnected (they can resume within a grace period). */
  send: ((msg: ServerMsg) => void) | null;
}

const HEIRLOOMS: Rarity[] = ['magic', 'rare', 'epic'];
const cleanHeir = (v: unknown): Rarity | null => (HEIRLOOMS.includes(v as Rarity) ? (v as Rarity) : null);

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

/** Clamps an intent from the network to sane values. */
function cleanIntent(raw: unknown): Omit<Intent, 'casts'> {
  const i = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    moveX: num(i.moveX, -1, 1), moveY: num(i.moveY, -1, 1),
    aimX: num(i.aimX, -1e5, 1e5), aimY: num(i.aimY, -1e5, 1e5),
    attack: !!i.attack, alt: !!i.alt,
  };
}

export class Room {
  readonly members: Client[] = [];
  private game: Game | null = null;
  private events: NetEvent[] = [];
  private acc = 0;
  private steps = 0;
  private lastSnap = -1;
  /** Everyone who played in the current run, by player id, and its leaderboard entry once recorded. */
  private roster = new Map<number, { name: string; cls: ClassId }>();
  private entry: { id: string; key: string } | null = null;

  constructor(readonly code: string, readonly isPublic: boolean, private onEmpty: (r: Room) => void) {}

  /** The first member still connected leads the room. */
  get host(): Client | undefined { return this.members.find(c => c.send) ?? this.members[0]; }
  get full(): boolean { return this.members.length >= MAX_PLAYERS; }
  get running(): boolean { return !!this.game && !this.game.over; }
  get playerCount(): number { return this.game?.players.length ?? 0; }

  info(): RoomInfo {
    return { code: this.code, host: this.host?.name ?? '', players: this.members.length, running: this.running, day: this.game?.day ?? 0 };
  }

  add(c: Client, cls: ClassId, heir?: unknown): void {
    c.room = this;
    if (CLASS_IDS.includes(cls)) c.cls = cls;
    c.heir = cleanHeir(heir);
    this.members.push(c);
    this.broadcastRoom();
  }

  remove(c: Client): void {
    this.leaveRun(c);
    const i = this.members.indexOf(c);
    if (i >= 0) this.members.splice(i, 1);
    c.room = null;
    c.send?.({ t: 'noRoom' });
    if (!this.members.length) { this.game = null; this.onEmpty(this); return; }
    this.broadcastRoom();
  }

  /** A member's connection dropped: they keep their place (and character) for a while. */
  offline(c: Client): void {
    c.intent = { ...NO_INTENT };
    c.casts = [];
    const p = this.game?.playerById(c.player ?? -1);
    if (p) p.offline = true;
    if (this.game?.playerById(c.player ?? -1) && this.game.players.length > 1) this.game.fx.toast(`${c.name} lost connection…`);
    this.broadcastRoom();
  }

  /** A member reconnected: send them the room, and the run they're in. */
  resume(c: Client): void {
    const p = this.game?.playerById(c.player ?? -1);
    if (p) p.offline = false;
    this.broadcastRoom();
    if (this.game && c.player !== null && this.game.playerById(c.player)) {
      c.version = -1;
      c.send?.({ t: 'start', seed: this.game.seed, player: c.player });
      if (this.game.players.length > 1) this.game.fx.toast(`${c.name} is back.`);
    }
  }

  onMessage(c: Client, msg: ClientMsg): void {
    switch (msg.t) {
      case 'pick':
        if (CLASS_IDS.includes(msg.cls) && c.player === null) { c.cls = msg.cls; c.heir = cleanHeir(msg.heir); }
        this.broadcastRoom();
        break;
      case 'start':
        if (c.player !== null) return;
        if (!this.running) {
          if (c !== this.host) return c.send?.({ t: 'error', msg: 'Only the host can start the run' });
          this.startRun();
        } else {
          this.joinRun(c);
        }
        break;
      case 'input':
        if (typeof msg.seq === 'number') c.seq = msg.seq;
        c.intent = cleanIntent(msg.intent);
        if (Array.isArray(msg.casts)) {
          for (const id of msg.casts.slice(0, 8)) if (typeof id === 'string' && !c.casts.includes(id)) c.casts.push(id);
        }
        break;
      case 'cmd': {
        const g = this.game, p = g?.playerById(c.player ?? -1), cmd = parseCommand(msg.cmd);
        if (!g || !p || g.over || !cmd) return;
        const err = applyCommand(g, p, cmd);
        if (err) c.send?.({ t: 'error', msg: err });
        break;
      }
      case 'leave':
        this.leaveRun(c);
        this.broadcastRoom();
        break;
    }
  }

  // ----------------------------------------------------------------- runs

  private startRun(): void {
    const g = new Game();
    this.game = g;
    this.events = [];
    for (const name of NET_EVENTS) {
      g.events.on(name, payload => {
        // Single-dot particles are trails and embers; clients draw their own.
        if (name === 'particles' && (payload as { n: number }).n <= 1) return;
        this.events.push([name, payload]);
      });
    }
    g.events.on('victory', () => this.record());
    this.acc = 0;
    this.steps = 0;
    this.lastSnap = -1;
    this.roster.clear();
    this.entry = null;
    console.log(`[room ${this.code}] run started with ${this.members.filter(c => c.send).length} player(s)`);
    // Everyone still connected comes along, including people looking at the last run's results.
    for (const c of this.members) c.player = null;
    for (const c of this.members) if (c.send) this.joinRun(c);
    this.broadcastRoom();
  }

  private joinRun(c: Client): void {
    const g = this.game;
    if (!g || g.over || c.player !== null) return;
    if (g.players.length >= MAX_PLAYERS) return c.send?.({ t: 'error', msg: 'The run is full' });
    const p = g.addPlayer(c.cls, c.name, c.heir);
    this.roster.set(p.id, { name: p.name, cls: p.cls });
    c.player = p.id;
    c.version = -1;
    c.seq = 0;
    c.intent = { ...NO_INTENT };
    c.casts = [];
    if (g.players.length > 1) g.fx.toast(`${c.name} joined the defense!`);
    c.send?.({ t: 'start', seed: g.seed, player: p.id });
    this.broadcastRoom();
  }

  private leaveRun(c: Client): void {
    const g = this.game;
    if (!g || c.player === null) return;
    const p = g.playerById(c.player);
    c.player = null;
    if (p) {
      g.removePlayer(p.id);
      if (g.players.length) g.fx.toast(`${p.name} left the run.`);
    }
    // Nobody left playing: the run is over.
    if (!g.players.length) {
      if (!g.over) this.record();
      this.game = null;
    }
  }

  // ----------------------------------------------------------------- loop

  /** Advances the run by `dt` seconds of real time (called by the server's shared loop). */
  tick(dt: number): void {
    const g = this.game;
    if (!g || g.over) return;
    this.acc += Math.min(0.25, dt);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const c of this.members) {
        const p = c.player !== null ? g.playerById(c.player) : undefined;
        if (!p) continue;
        p.intent = { ...c.intent, casts: c.casts };
        c.casts = [];
      }
      g.step(STEP);
      if (++this.steps % SNAP_EVERY === 0 || g.over) this.broadcastSnapshot();
      if (g.over) {
        console.log(`[room ${this.code}] run ended after ${g.stats.nights} night(s)`);
        this.record();
        this.broadcastRoom();
        return;
      }
    }
  }

  private broadcastSnapshot(): void {
    const g = this.game!;
    const events = this.events;
    this.events = [];
    for (const c of this.members) {
      if (c.player === null || !c.send) continue;
      const mine = events.filter(([, p]) => {
        const to = (p as { to?: number } | undefined)?.to;
        return to === undefined || to === c.player;
      });
      c.send({ t: 'snap', s: encodeSnapshot(g, c.version, this.lastSnap, mine, c.player), ack: c.seq });
      c.version = g.world.version;
    }
    this.lastSnap = g.time;
  }

  /** Puts the run on the leaderboard (at the win, and again when it finally ends). */
  private record(): void {
    const g = this.game;
    if (!g || (!g.stats.nights && !g.won)) return;
    const players = [...this.roster.values()].slice(-MAX_PLAYERS);
    const res = leaderboard.submit({
      size: Math.max(1, Math.min(MAX_PLAYERS, g.peakParty)), players, nights: g.stats.nights, won: g.won,
      kills: g.stats.kills, time: Math.round(g.time), online: true, progress: nightProgress(g),
    }, this.entry?.id, this.entry?.key);
    this.entry = { id: res.id, key: res.key };
    for (const c of this.members) c.send?.({ t: 'ranked', size: g.peakParty, rank: res.rank, id: res.id });
  }

  // ----------------------------------------------------------------- lobby

  broadcastRoom(): void {
    const host = this.host;
    const members: LobbyMember[] = this.members.map(c => ({
      id: c.id, name: c.name, cls: c.cls, host: c === host, playing: c.player !== null, online: !!c.send,
    }));
    const msg: ServerMsg = { t: 'room', code: this.code, public: this.isPublic, members, running: this.running,
      full: this.running && this.playerCount >= MAX_PLAYERS };
    for (const c of this.members) c.send?.(msg);
  }

  /** Something went badly wrong in this room: tell everyone and close the run. */
  crash(err: unknown): void {
    console.error(`[room ${this.code}] crashed:`, err);
    this.game = null;
    for (const c of this.members) {
      c.player = null;
      c.send?.({ t: 'error', msg: 'The run hit an error on the server and had to stop. Sorry!' });
    }
    this.broadcastRoom();
  }
}
