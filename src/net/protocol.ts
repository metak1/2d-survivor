// Messages between the browser and the game server (JSON over a WebSocket at /ws).
// A server hosts many rooms; each room is one co-op run for up to MAX_PLAYERS.

import type { Rarity } from '../data/items';
import type { ClassId, SpellId } from '../data/types';
import type { Command } from '../sim/commands';
import type { Intent } from '../sim/player';
import type { Snapshot } from './snapshot';
import type { SaveMeta } from '../sim/save';

export const WS_PATH = '/ws';
/** Bumped when messages change, so an old browser tab is told to refresh instead of misbehaving. */
export const PROTOCOL = 9;

/** Someone in a room (ids are connection ids, not in-game player ids). */
export interface LobbyMember { id: number; name: string; cls: ClassId; host: boolean; playing: boolean; online: boolean }

export const PASSWORD_MIN = 6;
export const PASSWORD_HINT = `Passwords need at least ${PASSWORD_MIN} characters.`;

/** Heirloom progress for one class (see profile.ts). */
export interface ClassProgress { best: number; wins: number }
/** What an account remembers between runs. */
export interface Progress { classes: Partial<Record<ClassId, ClassProgress>>; best: { nights: number; kills: number; cls: string } | null }
export interface Settings { name: string }
/** An account as the browser sees it. */
export interface AccountView { id: string; username: string; progress: Progress; settings: Settings }

/** A finished (or won) run, as the leaderboard keeps it. `size`: most players it had at once. */
export interface RunResult {
  /** `account`: the player's account id (set by the server). */
  size: number; players: { name: string; cls: ClassId; account?: string }[]; nights: number; won: boolean; kills: number;
  /** Seconds of play. */
  time: number;
  online: boolean;
  /** How far into the night it fell on it got (0 to 0.99): ranks runs that survived as many nights. */
  progress?: number;
}
export interface ScoreEntry extends RunResult { id: string; date: number }

/** A public room, as listed in the room browser. */
export interface RoomInfo { code: string; host: string; players: number; running: boolean; day: number }

export type ClientMsg =
  /** First message. `auth`: the account session (online play needs one). `token` resumes a dropped connection. */
  | { t: 'hello'; v: number; auth?: string; token?: string }
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
  /** Our account's saved online runs. */
  | { t: 'saves' }
  /** Take a saved run off our list. */
  | { t: 'forgetSave'; id: string }
  /** Host: resume a saved run with everyone in the room. */
  | { t: 'resume'; id: string }
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
  | { t: 'saveList'; saves: { id: string; meta: SaveMeta }[] }
  /** The run was recorded on the leaderboard for its party size. */
  | { t: 'ranked'; size: number; rank: number | null; id: string }
  | { t: 'error'; msg: string; fatal?: boolean };
