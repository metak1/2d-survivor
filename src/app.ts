// Client-side application state: which screen is up, the current Game, which player is ours, and
// build-mode selection. Solo play runs the Game here; online play mirrors the server's Game
// (see net/client.ts). The simulation knows nothing about any of this.

import type Phaser from 'phaser';
import type { BuildSlot, ClassId } from './data/types';
import { applyCommand, type Command } from './sim/commands';
import { Game } from './sim/game';
import type { Player } from './sim/player';
import type { NetClient } from './net/client';
import { UI } from './ui/ui';
import { heirloomFor } from './profile';

/** hub: the online room browser; lobby: inside an online room, between runs. */
/** victory: the run was just won (solo pauses there; online it keeps going behind the screen). */
export type Mode = 'loading' | 'menu' | 'hub' | 'lobby' | 'playing' | 'paused' | 'talents' | 'inventory' | 'shop' | 'victory' | 'over';

export interface BuildState {
  active: boolean;
  sel: BuildSlot;
  lastTile: number;
  /** Building whose upgrade/repair/demolish menu is open. */
  selected: number | null;
}

const freshBuild = (): BuildState => ({ active: false, sel: 'wall', lastTile: -1, selected: null });

export const App = {
  mode: 'loading' as Mode,
  game: null as Game | null,
  cls: 'warrior' as ClassId,
  /** Name shown to other players. */
  name: '',
  /** Our player's id in `game`. */
  me: 0,
  /** Connection to the game server while playing online. */
  net: null as NetClient | null,
  build: freshBuild(),
  phaser: null as Phaser.Game | null,
  /** Characters whose sprite sheets weren't found (drawn as placeholders). */
  missingSprites: [] as string[],
  /** Frame count per sprite and animation, from the import manifest (used by menu portraits). */
  spriteFrames: {} as Record<string, Record<string, number>>,
};

/** Our player. */
export const me = (): Player => App.game!.playerById(App.me)!;

export const online = () => !!App.net;

/** Sends a command for our player: applied here in solo play, sent to the server online. */
export function command(cmd: Command): void {
  if (App.net) return App.net.command(cmd);
  const err = applyCommand(App.game!, me(), cmd);
  if (err) UI.toast(err);
}

export function startGame(cls: ClassId): void {
  App.cls = cls;
  App.net?.close();
  App.net = null;
  const g = new Game();
  App.me = g.addPlayer(cls, App.name || 'You', heirloomFor(cls)).id;
  begin(g);
}

/** Online: the server put us in a run and the first snapshot has arrived. */
export function startRemote(g: Game, player: number): void {
  App.me = player;
  begin(g);
}

function begin(g: Game): void {
  App.game = g;
  App.mode = 'playing';
  App.build = freshBuild();
  UI.startGame(g);
  App.phaser!.scene.start('game');
}

/** Leaves the run: back to the class menu (solo) or the room lobby (online). */
export function toMenu(): void {
  App.phaser!.scene.stop('game');
  App.game = null;
  if (App.net) {
    App.net.leave();
    App.mode = 'lobby';
    UI.showLobby();
    return;
  }
  App.mode = 'menu';
  UI.showMenu();
}

/** Solo: pauses the game. Online the run keeps going; this just opens the menu. */
export function pause(): void {
  if (App.mode !== 'playing') return;
  App.mode = 'paused';
  UI.showPause();
}

export function resume(): void {
  if (App.mode !== 'paused') return;
  App.mode = 'playing';
  UI.hideScreens();
}

export function openTalents(): void {
  if (App.mode !== 'playing') return;
  App.mode = 'talents';
  UI.showTalents();
}

export function closeTalents(): void {
  if (App.mode !== 'talents') return;
  App.mode = 'playing';
  UI.hideScreens();
}

export function openInventory(): void {
  if (App.mode !== 'playing') return;
  App.mode = 'inventory';
  UI.showInventory();
}

export function closeInventory(): void {
  if (App.mode !== 'inventory') return;
  App.mode = 'playing';
  UI.hideScreens();
}

export function openShop(): void {
  if (App.mode !== 'playing') return;
  App.mode = 'shop';
  UI.showShop();
}

export function closeShop(): void {
  if (App.mode !== 'shop') return;
  App.mode = 'playing';
  UI.hideScreens();
}

export function setBuildMode(on: boolean): void {
  App.build.active = on;
  if (!on) App.build.selected = null;
}
