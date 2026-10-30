// The browser side of multiplayer: the connection to the game server, the room browser and room
// lobby state, our mirror of the server's Game, prediction for our own character, and reconnects.
// If the connection drops, it reconnects with our session token and the server gives us back our
// character.

import type { ClassId, SpellId } from '../data/types';
import { App, startRemote, toMenu } from '../app';
import type { Command } from '../sim/commands';
import { Game } from '../sim/game';
import type { Intent } from '../sim/player';
import { UI } from '../ui/ui';
import { Predictor } from './predict';
import { heirloomFor } from '../profile';
import { sessionToken } from './account';
import type { SaveMeta } from '../sim/save';
import { PROTOCOL, WS_PATH, type ClientMsg, type LobbyMember, type RoomInfo, type ServerMsg } from './protocol';
import { Interpolator } from './interp';
import { applySnapshot, smooth } from './snapshot';

/** While standing still, inputs are only resent this often. */
const IDLE_INPUT_EVERY = 0.2;
/** While moving or acting, inputs go out at most this often (fast monitors would flood the server). */
const ACTIVE_INPUT_EVERY = 1 / 60;
const TOKEN_KEY = 'nightfall_session';
const MAX_RETRIES = 8;

export interface RoomState { code: string; public: boolean; members: LobbyMember[]; running: boolean; full: boolean }

export class NetClient {
  you = 0;
  rooms: RoomInfo[] = [];
  room: RoomState | null = null;
  /** Round-trip time to the server in ms (null until measured). */
  ping: number | null = null;
  reconnecting = false;
  private ws: WebSocket | null = null;
  private game: Game | null = null;
  private player = 0;
  private started = false;
  private interp = new Interpolator();
  private predictor = new Predictor();
  private idleT = 0;
  private lastInput = '';
  private closing = false;
  private welcomed = false;
  private attempts = 0;
  private pingTimer = 0;

  /** Connects to the server that served this page (signed in). Resolves once the server says hello. */
  connect(): Promise<void> {
    this.closing = false;
    return new Promise((resolve, reject) => {
      const ws = this.open();
      ws.addEventListener('message', ev => { if ((JSON.parse(ev.data) as ServerMsg).t === 'welcome') resolve(); });
      ws.addEventListener('close', () => { if (!this.welcomed) reject(new Error('Could not reach the game server')); });
    });
  }

  private open(): WebSocket {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`);
    this.ws = ws;
    ws.onopen = () => {
      let token: string | undefined;
      try { token = sessionStorage.getItem(TOKEN_KEY) ?? undefined; } catch { /* storage unavailable */ }
      this.send({ t: 'hello', v: PROTOCOL, auth: sessionToken() ?? undefined, token });
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
    };
    ws.onmessage = ev => this.onMessage(JSON.parse(ev.data) as ServerMsg);
    ws.onclose = () => this.onClose(ws);
    return ws;
  }

  close(): void {
    this.closing = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }

  get isHost(): boolean { return !!this.room?.members.find(m => m.id === this.you)?.host; }

  list(): void { this.send({ t: 'list' }); }
  create(isPublic: boolean): void { this.send({ t: 'create', public: isPublic, cls: App.cls, heir: heirloomFor(App.cls) }); }
  join(code: string): void { this.send({ t: 'join', code, cls: App.cls, heir: heirloomFor(App.cls) }); }
  pick(cls: ClassId): void { this.send({ t: 'pick', cls, heir: heirloomFor(cls) }); }
  /** Host: start the run. Others: join the run in progress. */
  start(): void { this.send({ t: 'start' }); }
  command(cmd: Command): void { this.send({ t: 'cmd', cmd }); }
  leaveRoom(): void { this.send({ t: 'leaveRoom' }); }

  /** Our account's saved online runs (asked for in the lobby). */
  saveList: { id: string; meta: SaveMeta }[] | null = null;
  savesAskedAt = 0;
  askSaves(): void {
    this.savesAskedAt = Date.now();
    this.send({ t: 'saves' });
  }
  forgetSave(id: string): void {
    this.saveList = this.saveList?.filter(s => s.id !== id) ?? null;
    this.send({ t: 'forgetSave', id });
  }
  /** Host: resume a saved run with everyone in the room. */
  resume(id: string): void { this.send({ t: 'resume', id }); }

  /** Leave the run (back to the room lobby). */
  leave(): void {
    this.send({ t: 'leave' });
    this.game = null;
    this.started = false;
  }

  /**
   * Called every frame while in a run. Moves our character right away (prediction) and sends our
   * intent: every frame while moving or acting, a few times a second while idle.
   */
  input(intent: Intent, dt: number, playing: boolean): void {
    const g = this.game, p = g?.playerById(this.player);
    if (!g || !p) return;
    if (playing) this.predictor.step(g, p, intent, dt);
    const { casts, ...rest } = intent;
    const key = JSON.stringify(rest);
    const active = casts.length > 0 || rest.moveX !== 0 || rest.moveY !== 0 || rest.attack || rest.alt;
    this.idleT -= dt;
    if (!casts.length) {
      if (!active && key === this.lastInput && this.idleT > 0) return;
      if (active && this.idleT > IDLE_INPUT_EVERY - ACTIVE_INPUT_EVERY) return;
    }
    this.idleT = IDLE_INPUT_EVERY;
    this.lastInput = key;
    this.send({ t: 'input', seq: ++this.predictor.seq, intent: rest, casts: casts as SpellId[] });
  }

  /** Places everything the server moves at the drawing clock; eases our own corrections in. */
  smooth(dt: number): void {
    if (!this.game) return;
    smooth(this.game, this.interp, this.player, performance.now() / 1000);
    const p = this.game.playerById(this.player);
    if (p) this.predictor.ease(p, dt);
  }

  private send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.you = msg.you;
        this.welcomed = true;
        this.attempts = 0;
        try { sessionStorage.setItem(TOKEN_KEY, msg.token); } catch { /* storage unavailable */ }
        if (this.reconnecting) { this.reconnecting = false; UI.toast('Reconnected.'); }
        break;
      case 'rooms':
        this.rooms = msg.rooms;
        if (App.mode === 'hub') UI.showHub();
        break;
      case 'room': {
        this.room = msg;
        const mine = msg.members.find(m => m.id === this.you);
        // The run we were in ended for us (the server dropped us from it): back to the room.
        if (App.game && mine && !mine.playing && App.mode !== 'over') {
          this.game = null;
          this.started = false;
          toMenu();
          return;
        }
        if (!App.game) UI.showLobby();
        break;
      }
      case 'noRoom':
        this.room = null;
        this.game = null;
        this.started = false;
        if (App.game) App.phaser!.scene.stop('game');
        App.game = null;
        UI.showHub();
        break;
      case 'start': {
        const g = new Game(msg.seed);
        g.replica = true;
        this.game = g;
        this.player = msg.player;
        this.started = false;
        this.interp = new Interpolator();
        this.predictor.reset();
        break;
      }
      case 'snap': {
        const g = this.game;
        if (!g) return;
        this.interp.sync(msg.s.time, performance.now() / 1000);
        const at = applySnapshot(g, msg.s, this.interp, this.player);
        const p = g.playerById(this.player);
        if (p && at) this.predictor.reconcile(p, at.x, at.y, msg.ack);
        // Start drawing once our own player exists in the mirrored game.
        if (!this.started && p) {
          this.started = true;
          startRemote(g, this.player);
        }
        for (const [name, payload] of msg.s.events) g.events.emit(name, payload as never);
        break;
      }
      case 'pong':
        this.ping = Math.round(performance.now() - msg.at);
        break;
      case 'saveList':
        this.saveList = msg.saves;
        if (App.mode === 'lobby') UI.showLobby();
        break;
      case 'ranked':
        UI.setRank({ size: msg.size, rank: msg.rank, id: msg.id });
        break;
      case 'error':
        if (msg.fatal) {
          this.closing = true;
          this.ws?.close();
          this.giveUp(msg.msg);
          return;
        }
        UI.toast(msg.msg);
        if (App.mode === 'hub') UI.onlineError(msg.msg);
        break;
    }
  }

  /** The connection dropped: keep trying to get it back; the server holds our place for a minute. */
  private onClose(ws: WebSocket): void {
    if (ws !== this.ws) return;
    clearInterval(this.pingTimer);
    this.ping = null;
    if (this.closing || !this.welcomed) return;
    if (!this.reconnecting) UI.toast('Connection lost. Reconnecting…');
    this.reconnecting = true;
    if (this.attempts >= MAX_RETRIES) return this.giveUp('Lost the connection to the game server.');
    const delay = Math.min(8000, 500 * 2 ** this.attempts++);
    window.setTimeout(() => { if (!this.closing) this.open(); }, delay);
  }

  private giveUp(why: string): void {
    this.closing = true;
    this.reconnecting = false;
    App.net = null;
    if (App.game) {
      App.phaser!.scene.stop('game');
      App.game = null;
    }
    UI.showMenu();
    UI.onlineError(why);
  }
}
