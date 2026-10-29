// Things drawn above the night overlay so they stay readable: monster eyes, health bars and
// status marks, interaction markers, the build placement ghost, and screen-edge arrows.

import Phaser from 'phaser';
import { ART_SCALE, BUILD_RANGE, TILE, WORLD_H, WORLD_W } from '../config';
import { BUILDINGS } from '../data/buildings';
import type { BuildSlot } from '../data/types';
import type { Game } from '../sim/game';
import { App, me } from '../app';
import { RARITIES } from '../data/items';
import { itemIcon, itemName } from '../sim/items';
import { campCleared, nearestInteractable } from '../sim/daylife';
import { idx, inMap, tileOf } from '../sim/world';
import { DEPTH_DARKNESS } from './Lighting';
import { buildingKey, gateKey, wallKey } from './textures';

export class Overlay {
  private eyes: Phaser.GameObjects.Graphics;
  private bars: Phaser.GameObjects.Graphics;
  private ghostG: Phaser.GameObjects.Graphics;
  private ghostImg: Phaser.GameObjects.Image;
  private markers: Phaser.GameObjects.Text[] = [];
  /** Name tags over the other players. */
  private names = new Map<number, Phaser.GameObjects.Text>();
  /** Items on the ground: icon and label per loot id, glow drawn in lootG. */
  private loot = new Map<number, { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text }>();
  private lootG: Phaser.GameObjects.Graphics;
  private edge: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene, private g: Game) {
    this.eyes = scene.add.graphics().setDepth(DEPTH_DARKNESS + 2);
    this.bars = scene.add.graphics().setDepth(DEPTH_DARKNESS + 3);
    this.ghostG = scene.add.graphics().setDepth(DEPTH_DARKNESS + 4);
    this.ghostImg = scene.add.image(0, 0, wallKey(0, 0)).setScale(ART_SCALE).setAlpha(0.6).setDepth(DEPTH_DARKNESS + 5).setVisible(false);
    this.edge = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH_DARKNESS + 10);
    this.lootG = scene.add.graphics().setDepth(DEPTH_DARKNESS + 1);
  }

  draw(darkness: number, build: { active: boolean; sel: BuildSlot; selected: number | null }, mouse: { x: number; y: number }): void {
    this.drawEyes(darkness);
    this.drawBars();
    this.drawMarkers();
    this.drawNames();
    this.drawLoot();
    this.drawGhost(build, mouse);
    this.drawEdgeArrows();
  }

  private drawEyes(darkness: number): void {
    const gr = this.eyes;
    gr.clear();
    if (darkness < 0.15) return;
    for (const e of this.g.enemies) {
      if (e.freeze > 0 || e.def.guard) continue;
      const face = Math.cos(e.angle) < 0 ? -1 : 1;
      const s = e.def.look.scale, hx = e.x + face * 3 * s, hy = e.y - 4.5 * s + (e.def.look.offsetY ?? 0);
      gr.fillStyle(e.def.boss ? 0xff9a3a : 0xff3a2a, Math.min(1, darkness * 1.1));
      gr.fillRect(hx - s, hy - s * 0.5, s * 1.2, s);
      gr.fillRect(hx + face * s * 1.6 - s * 0.6, hy - s * 0.5, s * 1.2, s);
    }
  }

  private drawBars(): void {
    const gr = this.bars, g = this.g;
    gr.clear();
    const bar = (x: number, y: number, w: number, h: number, f: number, col: number) => {
      gr.fillStyle(0x000000, 0.6).fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
      gr.fillStyle(col, 1).fillRect(x - w / 2, y, w * Math.max(0, f), h);
    };
    for (const e of g.enemies) {
      const top = e.y - e.def.look.scale * 11 - 6 + (e.def.look.offsetY ?? 0);
      if (e.hp < e.maxHp) {
        const big = !!e.def.boss || !!e.def.guard;
        bar(e.x, top, big ? 60 : e.r * 2.2, big ? 6 : 4, e.hp / e.maxHp, e.def.boss ? 0xff7a2a : e.def.guard ? 0xd9a03a : 0xe04848);
      }
      if (e.shield > 0) { gr.lineStyle(2, 0xb58cff, 0.8).strokeCircle(e.x, e.y, e.r + 6); }
      if (e.marked > 0) { gr.lineStyle(1.5, 0xff5a4a, 0.9).strokeCircle(e.x, top - 6, 4); gr.lineBetween(e.x - 6, top - 6, e.x + 6, top - 6); }
      if (e.stun > 0) {
        gr.fillStyle(0xffe27a, 1);
        for (let i = 0; i < 3; i++) {
          const a = g.time * 6 + (i * Math.PI * 2) / 3;
          gr.fillCircle(e.x + Math.cos(a) * 10, top - 4 + Math.sin(a) * 3, 2.5);
        }
      }
      if (e.root > 0) {
        gr.lineStyle(2, 0x6fbf4a, 1);
        for (let i = 0; i < 3; i++) { gr.beginPath(); gr.arc(e.x, e.y + 6, e.r + 3 + i * 2, i, i + 2.4); gr.strokePath(); }
      }
    }
    for (const a of g.allies) if (a.hp < a.maxHp) bar(a.x, a.y - 34, 26, 4, a.hp / a.maxHp, 0x6fcf86);
    // Party members' health (ours is in the HUD).
    for (const p of g.players) if (p.id !== App.me && !p.dead) bar(p.x, p.y - 44, 32, 4, p.hp / p.maxHp, 0x6fcf86);
    for (const b of g.world.buildings) {
      if (b.hp >= b.maxHp || b.type === 'hearth') continue;
      const f = b.hp / b.maxHp;
      bar(b.x, b.ty * TILE - 7, b.size * TILE - 6, 4, f, f > 0.5 ? 0x7bd36b : f > 0.25 ? 0xe0c24a : 0xe05a4a);
    }
  }

  /** Bobbing "!" over things you can interact with; the closest one also shows its key prompt in the HUD. */
  private drawMarkers(): void {
    const g = this.g, near = nearestInteractable(g, me());
    const spots: { id: number; x: number; y: number; col: string }[] = [];
    for (const n of g.npcs) spots.push({ id: n.id, x: n.x, y: n.y - 46, col: n.kind === 'merchant' ? '#ffe27a' : '#8fff9a' });
    for (const c of g.camps) if (!c.opened) spots.push({ id: c.id, x: c.x, y: c.y - 30, col: campCleared(g, c) ? '#ffe27a' : '#9a9a9a' });
    for (const p of g.pickups) spots.push({ id: p.id, x: p.x, y: p.y - 28, col: '#e9d8b0' });
    while (this.markers.length < spots.length) {
      this.markers.push(this.scene.add.text(0, 0, '!', { fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: '22px', stroke: '#000', strokeThickness: 4 })
        .setOrigin(0.5, 1).setDepth(DEPTH_DARKNESS + 6));
    }
    this.markers.forEach((m, i) => {
      const s = spots[i];
      if (!s) return void m.setVisible(false);
      const bob = Math.sin(g.time * 4 + i) * 3;
      m.setVisible(true).setPosition(s.x, s.y + bob).setColor(s.col).setScale(near?.id === s.id ? 1.3 : 1);
    });
  }

  /**
   * Items on the ground, above the night so they can be found: a glow in the rarity colour, a
   * light beam for epic and legendary, and the name for good items (or anything we're near).
   */
  private drawLoot(): void {
    const g = this.g, gr = this.lootG, p = me(), time = g.time, seen = new Set<number>();
    const hasIcons = this.scene.textures.exists('icons');
    gr.clear();
    for (const l of g.loot) {
      seen.add(l.id);
      const r = RARITIES[l.item.rarity], col = Phaser.Display.Color.HexStringToColor(r.color).color;
      const bob = Math.sin(time * 3 + l.id) * 2, good = l.item.rarity !== 'common' && l.item.rarity !== 'magic';
      gr.fillStyle(col, 0.22).fillEllipse(l.x, l.y + 8, 30, 12);
      gr.lineStyle(1.5, col, 0.8).strokeEllipse(l.x, l.y + 8, 30, 12);
      if (l.item.rarity === 'epic' || l.item.rarity === 'legendary') {
        const a = 0.18 + Math.sin(time * 4 + l.id) * 0.06;
        gr.fillStyle(col, a).fillRect(l.x - 5, l.y - 90, 10, 96);
        gr.fillStyle(col, a * 0.6).fillRect(l.x - 10, l.y - 60, 20, 66);
      }
      let v = this.loot.get(l.id);
      if (!v) {
        const img = this.scene.add.image(l.x, l.y, hasIcons ? 'icons' : '__WHITE', hasIcons ? itemIcon(l.item, p.cls) : undefined)
          .setDepth(DEPTH_DARKNESS + 2);
        if (!hasIcons) img.setDisplaySize(12, 12).setTint(col);
        const label = this.scene.add.text(l.x, l.y, itemName(l.item, p.cls), { fontFamily: 'system-ui, sans-serif', fontStyle: 'bold',
          fontSize: '11px', color: r.color, stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(DEPTH_DARKNESS + 6);
        this.loot.set(l.id, (v = { img, label }));
      }
      v.img.setPosition(l.x, l.y - 4 + bob);
      const near = !p.dead && Math.hypot(p.x - l.x, p.y - l.y) < 140;
      v.label.setPosition(l.x, l.y - 22 + bob).setVisible(good || near);
    }
    for (const [id, v] of this.loot) if (!seen.has(id)) { v.img.destroy(); v.label.destroy(); this.loot.delete(id); }
  }

  private drawNames(): void {
    const seen = new Set<number>();
    for (const p of this.g.players) {
      if (p.id === App.me) continue;
      seen.add(p.id);
      let t = this.names.get(p.id);
      if (!t) {
        t = this.scene.add.text(0, 0, p.name, { fontFamily: 'system-ui, sans-serif', fontStyle: 'bold', fontSize: '12px',
          color: p.def.color, stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(DEPTH_DARKNESS + 6);
        this.names.set(p.id, t);
      }
      t.setPosition(p.x, p.y - 48).setAlpha(p.dead ? 0.5 : 1);
    }
    for (const [id, t] of this.names) if (!seen.has(id)) { t.destroy(); this.names.delete(id); }
  }

  private drawGhost(build: { active: boolean; sel: BuildSlot; selected: number | null }, m: { x: number; y: number }): void {
    const gr = this.ghostG, p = me(), w = this.g.world;
    gr.clear();
    this.ghostImg.setVisible(false);
    if (!build.active || p.dead) return;

    gr.lineStyle(2, 0xffffff, 0.12).strokeCircle(p.x, p.y, BUILD_RANGE);
    const sel = build.selected !== null ? w.buildingById(build.selected) : undefined;
    if (sel) gr.lineStyle(2, 0xffe27a, 1).strokeRect(sel.tx * TILE, sel.ty * TILE, sel.size * TILE, sel.size * TILE);

    const tx = tileOf(m.x), ty = tileOf(m.y);
    if (!inMap(tx, ty)) return;
    const hovered = w.bld[idx(tx, ty)];
    if (hovered) {
      // Clicking an existing building opens its menu instead of placing.
      gr.lineStyle(2, 0x9fd8ff, 0.9).strokeRect(hovered.tx * TILE, hovered.ty * TILE, hovered.size * TILE, hovered.size * TILE);
      return;
    }
    const def = BUILDINGS[build.sel], size = def.size || 1;
    const ok = !w.placementError(p, build.sel, tx, ty);
    const col = ok ? 0x78ff8c : 0xff5a5a;
    gr.fillStyle(col, 0.25).fillRect(tx * TILE, ty * TILE, TILE * size, TILE * size);
    gr.lineStyle(2, col, 0.9).strokeRect(tx * TILE + 1, ty * TILE + 1, TILE * size - 2, TILE * size - 2);
    const r = def.tower?.range ?? def.aura?.r;
    if (r) gr.lineStyle(1, 0xffffff, 0.3).strokeCircle((tx + 0.5) * TILE, (ty + 0.5) * TILE, r);
    const key = build.sel === 'wall' ? wallKey(0, 0) : build.sel === 'gate' ? gateKey(0) : buildingKey(build.sel, 0);
    this.ghostImg.setTexture(key).setPosition((tx + 0.5) * TILE, (ty + 0.5) * TILE).setVisible(true);
  }

  private drawEdgeArrows(): void {
    const gr = this.edge, g = this.g;
    gr.clear();
    const targets: { x: number; y: number; col: number; s: number }[] = [];
    if (g.phase === 'night') {
      for (const a of g.spawnAngles) {
        targets.push({ x: WORLD_W / 2 + Math.cos(a) * 1000, y: WORLD_H / 2 + Math.sin(a) * 1000, col: 0xff5a4a, s: 1 });
      }
      for (const e of g.enemies) if (e.def.boss && e.y < WORLD_H) targets.push({ x: e.x, y: e.y, col: 0xff9a3a, s: 1.4 });
    } else {
      // By day, point at visitors and supply drops so they're not missed.
      for (const n of g.npcs) targets.push({ x: n.x, y: n.y, col: n.kind === 'merchant' ? 0xffe27a : 0x8fff9a, s: 1 });
      for (const p of g.pickups) targets.push({ x: p.x, y: p.y, col: 0xe9d8b0, s: 1 });
    }
    const cam = this.scene.cameras.main, vw = cam.width, vh = cam.height, cx = vw / 2, cy = vh / 2, pad = 34;
    const pulse = 0.6 + Math.sin(g.time * 6) * 0.3;
    for (const t of targets) {
      const sx = t.x - cam.worldView.x, sy = t.y - cam.worldView.y;
      if (sx > 0 && sy > 0 && sx < vw && sy < vh) continue;
      const a = Math.atan2(sy - cy, sx - cx);
      const k = Math.min((vw / 2 - pad) / Math.abs(Math.cos(a) || 1e-6), (vh / 2 - pad) / Math.abs(Math.sin(a) || 1e-6));
      const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
      const pt = (dx: number, dy: number) => ({ x: x + Math.cos(a) * dx - Math.sin(a) * dy, y: y + Math.sin(a) * dx + Math.cos(a) * dy });
      const p1 = pt(14 * t.s, 0), p2 = pt(-8 * t.s, -10 * t.s), p3 = pt(-8 * t.s, 10 * t.s);
      gr.fillStyle(t.col, pulse).fillTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    }
  }
}
