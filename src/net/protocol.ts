// Messages between the browser and the game server (JSON over a WebSocket at /ws).
// A server hosts many rooms; each room is one co-op run for up to MAX_PLAYERS.

import type { Rarity } from '../data/items';
import type { ClassId, SpellId } from '../data/types';
import type { Command } from '../sim/commands';
import type { Intent } from '../sim/player';
import type { Snapshot } from './snapshot';

export const WS_PATH = '/ws';
/** Bumped when messages change, so an old browser tab is told to refresh instead of misbehaving. */
export const PROTOCOL = 5;

/** Someone in a room (ids are connection ids, not in-game player ids). */
export interface LobbyMember { id: number; name: string; cls: ClassId; host: boolean; playing: boolean; online: boolean }

/** A finished (or won) run, as the leaderboard keeps it. `size`: most players it had at once. */
export interface RunResult {
  size: number; players: { name: string; cls: ClassId }[]; nights: number; won: boolean; kills: number;
  /** Seconds of play. */
  time: number;
  online: boolean;
}
export interface ScoreEntry extends RunResult { id: string; date: number }

/** A public room, as listed in the room browser. */
export interface RoomInfo { code: string; host: string; players: number; running: boolean; day: number }

export type ClientMsg =
  /** First message. `token` resumes an earlier session (after a dropped connection). */
  | { t: 'hello'; v: number; name: string; token?: string }
  | { t: 'list' }
  /** `heir`: the starting weapon the player unlocked for this class in earlier runs. */
  | { t: 'create'; public: boolean; cls: ClassId; heir?: Rarity | null }
  | { t: 'join'; code: string; cls: ClassId; heir?: Rarity | null }
  | { t: 'pick'; cls: ClassId; heir?: Rarity | null }
  /** Host: start a run with everyone in the room. Others: join the run in progress. */
  | { t: 'start' }
  /** Our intent; `seq` counts up so the server can say which input it has applied. */
  | { t: 'input'; seq: number; intent: Omit<Intent, 'casts'>; casts: SpellId[] }
  | { t: 'cmd'; cmd: Command }
  /** Leave the run, back to the room. */
  | { t: 'leave' }
  /** Leave the room, back to the room browser. */
  | { t: 'leaveRoom' }
  | { t: 'ping'; at: number };

export type ServerMsg =
  | { t: 'welcome'; you: number; token: string }
  | { t: 'rooms'; rooms: RoomInfo[] }
  /** The room we're in changed (or we just joined it). */
  | { t: 'room'; code: string; public: boolean; members: LobbyMember[]; running: boolean; full: boolean }
  /** We're no longer in a room. */
  | { t: 'noRoom' }
  /** We're in a run: build the world from `seed`; we control player `player`. */
  | { t: 'start'; seed: number; player: number }
  /** `ack`: the last input of ours the server had applied when it took this snapshot. */
  | { t: 'snap'; s: Snapshot; ack: number }
  | { t: 'pong'; at: number }
  /** The run was recorded on the leaderboard for its party size. */
  | { t: 'ranked'; size: number; rank: number | null; id: string }
  | { t: 'error'; msg: string; fatal?: boolean };
