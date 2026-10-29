// The multiplayer game server: accepts WebSocket connections at /ws, keeps sessions (so a dropped
// connection can resume its character), lists and creates rooms, and runs every room's game from
// one shared loop. Used by the Vite dev server (vite.config.ts) and server/main.ts.

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL, WS_PATH, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import { NO_INTENT } from '../src/sim/player';
import { Room, type Client } from './room';

const MAX_CLIENTS = Number(process.env.MAX_CLIENTS) || 400;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 100;
/** Seconds a dropped player keeps their place before they're removed. */
const RESUME_GRACE = 60;
/** Messages per second before a connection is ignored, and before it's cut off. Clients send up to
 * 60 inputs a second, plus pings and commands (painting a wall sends one per tile). */
const RATE_SOFT = 240, RATE_HARD = 600;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Testing aid: delay every message each way by this many ms, to feel how the game plays far away. */
const SIMULATE_LAG = Number(process.env.SIMULATE_LAG_MS) || 0;

interface Conn {
  ws: WebSocket;
  client: Client | null;
  alive: boolean;
  msgs: number;
  windowStart: number;
}

export class GameServer {
  private clients = new Map<number, Client>();
  private byToken = new Map<string, Client>();
  /** When each disconnected client dropped (ms). */
  private gone = new Map<Client, number>();
  private rooms = new Map<string, Room>();
  private conns = new Set<Conn>();
  private nextId = 1;
  private last = performance.now();
  private readonly started = Date.now();

  constructor() {
    setInterval(() => this.tick(), 1000 / 120);
    setInterval(() => this.heartbeat(), 10_000);
    setInterval(() => this.sweep(), 5_000);
  }

  stats() {
    return {
      rooms: this.rooms.size,
      running: [...this.rooms.values()].filter(r => r.running).length,
      players: [...this.rooms.values()].reduce((n, r) => n + r.playerCount, 0),
      connections: this.conns.size,
      uptime: Math.round((Date.now() - this.started) / 1000),
    };
  }

  connect(ws: WebSocket): void {
    if (this.conns.size >= MAX_CLIENTS) { ws.close(1013, 'Server full'); return; }
    const conn: Conn = { ws, client: null, alive: true, msgs: 0, windowStart: Date.now() };
    this.conns.add(conn);
    ws.on('pong', () => { conn.alive = true; });
    ws.on('message', data => {
      if (SIMULATE_LAG) { setTimeout(() => this.receive(conn, data), SIMULATE_LAG); return; }
      this.receive(conn, data);
    });
    ws.on('close', () => this.disconnect(conn));
    ws.on('error', () => ws.terminate());
  }

  private receive(conn: Conn, data: unknown): void {
    if (!this.rateOk(conn)) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    try { this.onMessage(conn, msg); } catch (err) { console.error('message handling failed:', err); }
  }

  private rateOk(conn: Conn): boolean {
    const now = Date.now();
    if (now - conn.windowStart > 1000) { conn.windowStart = now; conn.msgs = 0; }
    if (++conn.msgs > RATE_HARD) { conn.ws.close(1008, 'Too many messages'); return false; }
    return conn.msgs <= RATE_SOFT;
  }

  private sender(ws: WebSocket) {
    const send = (data: string) => { if (ws.readyState === ws.OPEN) ws.send(data); };
    return (msg: ServerMsg) => {
      const data = JSON.stringify(msg);
      if (SIMULATE_LAG) setTimeout(() => send(data), SIMULATE_LAG); else send(data);
    };
  }

  private onMessage(conn: Conn, msg: ClientMsg): void {
    if (msg.t === 'hello') return this.hello(conn, msg);
    const c = conn.client;
    if (!c) return; // must say hello first
    switch (msg.t) {
      case 'ping': c.send?.({ t: 'pong', at: msg.at }); break;
      case 'list': c.send?.({ t: 'rooms', rooms: [...this.rooms.values()].filter(r => r.isPublic && !r.full).map(r => r.info()) }); break;
      case 'create': {
        if (this.rooms.size >= MAX_ROOMS) return c.send?.({ t: 'error', msg: 'The server has too many rooms right now. Try again later.' });
        c.room?.remove(c);
        const room = new Room(this.newCode(), !!msg.public, r => this.closeRoom(r));
        this.rooms.set(room.code, room);
        console.log(`[room ${room.code}] created by ${c.name} (${room.isPublic ? 'public' : 'private'})`);
        room.add(c, msg.cls, msg.heir);
        break;
      }
      case 'join': {
        const code = String(msg.code ?? '').trim().toUpperCase();
        const room = this.rooms.get(code);
        if (!room) return c.send?.({ t: 'error', msg: `No room with code ${code || '…'}` });
        if (room === c.room) return room.resume(c);
        if (room.full) return c.send?.({ t: 'error', msg: 'That room is full' });
        c.room?.remove(c);
        room.add(c, msg.cls, msg.heir);
        break;
      }
      case 'leaveRoom': c.room?.remove(c); break;
      default: c.room?.onMessage(c, msg);
    }
  }

  private hello(conn: Conn, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    const send = this.sender(conn.ws);
    if (msg.v !== PROTOCOL) {
      send({ t: 'error', msg: 'This page is out of date. Refresh to get the latest version.', fatal: true });
      return;
    }
    if (conn.client) return;
    const name = String(msg.name ?? '').trim().slice(0, 16) || 'Player';
    // Resuming a session whose connection dropped: take back the same character.
    const old = typeof msg.token === 'string' ? this.byToken.get(msg.token) : undefined;
    if (old && !old.send) {
      this.gone.delete(old);
      old.send = send;
      conn.client = old;
      send({ t: 'welcome', you: old.id, token: old.token });
      if (old.room) old.room.resume(old); else send({ t: 'noRoom' });
      return;
    }
    const c: Client = { id: this.nextId++, token: randomBytes(16).toString('hex'), name, cls: 'warrior', heir: null, room: null, player: null,
      intent: { ...NO_INTENT }, casts: [], seq: 0, version: -1, send };
    this.clients.set(c.id, c);
    this.byToken.set(c.token, c);
    conn.client = c;
    send({ t: 'welcome', you: c.id, token: c.token });
  }

  private disconnect(conn: Conn): void {
    this.conns.delete(conn);
    const c = conn.client;
    if (!c || !c.send) return;
    c.send = null;
    // Keep their place for a while so a flaky connection can come back.
    this.gone.set(c, Date.now());
    c.room?.offline(c);
  }

  /** Removes people whose grace period ran out. */
  private sweep(): void {
    const now = Date.now();
    for (const [c, at] of this.gone) {
      if (now - at < RESUME_GRACE * 1000) continue;
      this.gone.delete(c);
      c.room?.remove(c);
      this.clients.delete(c.id);
      this.byToken.delete(c.token);
    }
  }

  /** Drops connections that stopped answering pings (closed laptop, dead Wi-Fi). */
  private heartbeat(): void {
    for (const conn of this.conns) {
      if (!conn.alive) { conn.ws.terminate(); continue; }
      conn.alive = false;
      conn.ws.ping();
    }
  }

  private tick(): void {
    const now = performance.now(), dt = (now - this.last) / 1000;
    this.last = now;
    for (const room of this.rooms.values()) {
      // One room failing must not take the others down.
      try { room.tick(dt); } catch (err) { room.crash(err); }
    }
  }

  private closeRoom(r: Room): void {
    this.rooms.delete(r.code);
    console.log(`[room ${r.code}] closed`);
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}

export { handleApi } from './leaderboard';

/** Serves the game on an HTTP server's WebSocket upgrades at /ws (other upgrades are left alone). */
export function attachGameServer(http: Server): GameServer {
  const server = new GameServer();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true, maxPayload: 32 * 1024 });
  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url?.startsWith(WS_PATH)) return;
    wss.handleUpgrade(req, socket, head, ws => server.connect(ws));
  });
  return server;
}
