import { MAP_W, TILE, WORLD_W } from '../config';
import { DUNGEONS } from '../data/dungeons';
import type { Game } from '../sim/game';
import { darkness } from '../sim/cycle';
import { dungeonById, entryLock, regionAt, type Dungeon } from '../sim/dungeons';
import { idx } from '../sim/world';
import { App } from '../app';

/** Draws the minimap; the static layer (nodes, buildings) is cached until the world changes. */
export class Minimap {
  private base = document.createElement('canvas');
  dirty = true;

  constructor(private canvas: HTMLCanvasElement) {}

  draw(g: Game, cam: { x: number; y: number; w: number; h: number }): void {
    const me = g.playerById(App.me), d = me && dungeonById(g, regionAt(g, me.x, me.y));
    if (d) return this.drawDungeon(g, d);
    const W = this.canvas.width, s = W / WORLD_W, ctx = this.canvas.getContext('2d')!;
    if (this.dirty) {
      this.base.width = this.base.height = W;
      const b = this.base.getContext('2d')!, ts = TILE * s;
      b.fillStyle = '#2c4426';
      b.fillRect(0, 0, W, W);
      for (const n of g.world.nodes) {
        b.fillStyle = n.type === 'tree' ? '#1d5a26' : n.type === 'rock' ? '#8a8f98' : '#f3d25a';
        b.fillRect(n.tx * ts, n.ty * ts, Math.max(1.5, ts), Math.max(1.5, ts));
      }
      for (const bl of g.world.buildings) {
        b.fillStyle = bl.type === 'hearth' ? '#ff9a3a' : bl.def.tower ? '#e8e8e8' : '#b08a5a';
        b.fillRect(bl.tx * ts, bl.ty * ts, Math.max(2, bl.size * ts), Math.max(2, bl.size * ts));
      }
      this.dirty = false;
    }
    ctx.drawImage(this.base, 0, 0);
    const dk = darkness(g);
    if (dk > 0) { ctx.fillStyle = `rgba(6,10,30,${dk * 0.5})`; ctx.fillRect(0, 0, W, W); }
    const dot = (x: number, y: number, r: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(x * s - r, y * s - r, r * 2, r * 2); };
    for (const c of g.camps) if (!c.opened) dot(c.x, c.y, 3, '#ffe27a');
    for (const dg of g.dungeons) {
      ctx.fillStyle = entryLock(g, dg) ? '#6a6d75' : DUNGEONS[dg.theme].color;
      ctx.beginPath(); ctx.moveTo(dg.x * s, dg.y * s - 5); ctx.lineTo(dg.x * s + 5, dg.y * s + 4); ctx.lineTo(dg.x * s - 5, dg.y * s + 4); ctx.fill();
    }
    for (const n of g.npcs) dot(n.x, n.y, 2.5, n.kind === 'merchant' ? '#ffe27a' : '#8fff9a');
    for (const p of g.pickups) dot(p.x, p.y, 2.5, '#e9d8b0');
    for (const e of g.enemies) {
      if (e.y >= g.dungeons[0]?.box.y) continue;
      if (e.def.guard) dot(e.x, e.y, 1.5, '#d9a03a');
      else dot(e.x, e.y, e.def.boss ? 3 : 1.5, e.def.boss ? '#ff9a3a' : '#ff4a3a');
    }
    for (const a of g.allies) dot(a.x, a.y, 2, '#8fd0ff');
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cam.x * s, cam.y * s, cam.w * s, cam.h * s);
    // Us in white, the rest of the party in their class colour.
    for (const p of g.players) {
      if (p.dead) continue;
      ctx.fillStyle = p.id === App.me ? '#ffffff' : p.def.color;
      ctx.beginPath(); ctx.arc(p.x * s, p.y * s, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** Inside a dungeon: its rooms, monsters, the way out and the party. */
  private drawDungeon(g: Game, d: Dungeon): void {
    const W = this.canvas.width, ctx = this.canvas.getContext('2d')!;
    const s = Math.min(W / d.box.w, W / d.box.h), ox = (W - d.box.w * s) / 2, oy = (W - d.box.h * s) / 2, ts = TILE * s;
    ctx.fillStyle = '#0c0c10';
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = '#3a3d47';
    const tx0 = d.box.x / TILE, ty0 = d.box.y / TILE;
    for (let ty = 0; ty < d.box.h / TILE; ty++) for (let tx = 0; tx < d.box.w / TILE; tx++) {
      if (tx0 + tx < MAP_W && !g.world.wall[idx(tx0 + tx, ty0 + ty)]) ctx.fillRect(ox + tx * ts, oy + ty * ts, ts + 0.5, ts + 0.5);
    }
    const at = (x: number, y: number) => [ox + (x - d.box.x) * s, oy + (y - d.box.y) * s] as const;
    const dot = (x: number, y: number, r: number, col: string) => { const [X, Y] = at(x, y); ctx.fillStyle = col; ctx.fillRect(X - r, Y - r, r * 2, r * 2); };
    dot(d.exit.x, d.exit.y, 3.5, '#a07aff');
    for (const e of g.enemies) if (regionAt(g, e.x, e.y) === d.id) dot(e.x, e.y, e.def.boss ? 4 : 2, e.def.boss ? '#ff9a3a' : '#ff4a3a');
    for (const a of g.allies) if (regionAt(g, a.x, a.y) === d.id) dot(a.x, a.y, 2, '#8fd0ff');
    for (const p of g.players) {
      if (p.dead || regionAt(g, p.x, p.y) !== d.id) continue;
      const [X, Y] = at(p.x, p.y);
      ctx.fillStyle = p.id === App.me ? '#ffffff' : p.def.color;
      ctx.beginPath(); ctx.arc(X, Y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = DUNGEONS[d.theme].color;
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(DUNGEONS[d.theme].name + (d.depth > 1 ? ` · ${d.depth}` : ''), 4, 12);
  }
}
