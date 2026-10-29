// Purely visual layers: particles, floating damage text, transient blasts/rings/swings,
// spell zones and projectiles. Everything here is driven by sim events or read from sim state.

import Phaser from 'phaser';
import { TAU, rand } from '../core/math';
import type { Game } from '../sim/game';
import type { GameEvents, Vfx } from '../sim/events';
import type { Zone } from '../sim/zones';
import { AIM_MAX, type Player } from '../sim/player';

const DEPTH_ZONES_GROUND = 20;
const DEPTH_TOP = 60000;
export const DEPTH_TEXT = 900000;

const color = (css: string) => Phaser.Display.Color.ValueToColor(css);

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; col: number; alpha: number; size: number }
interface FloatText { obj: Phaser.GameObjects.Text; life: number; max: number }
type ActiveVfx = Vfx & { t: number; life: number };
interface RainDrop { x: number; y: number; t: number }

export class FxView {
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private textPool: Phaser.GameObjects.Text[] = [];
  private vfx: ActiveVfx[] = [];
  private rain = new Map<number, RainDrop[]>();
  private clouds = new Map<number, Phaser.GameObjects.Image>();
  private projectiles = new Map<number, Phaser.GameObjects.Image>();
  private groundG: Phaser.GameObjects.Graphics;
  private topG: Phaser.GameObjects.Graphics;
  private particleG: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene, private g: Game) {
    this.groundG = scene.add.graphics().setDepth(DEPTH_ZONES_GROUND);
    this.topG = scene.add.graphics().setDepth(DEPTH_TOP);
    this.particleG = scene.add.graphics().setDepth(DEPTH_TOP + 1);
  }

  addParticles(e: GameEvents['particles']): void {
    if (this.particles.length > 1400) return;
    const c = color(e.color);
    for (let i = 0; i < e.n; i++) {
      const a = Math.random() * TAU, s = Math.random() * e.speed, life = e.life * rand(0.6, 1);
      this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life,
        col: c.color, alpha: c.alphaGL, size: e.size * rand(0.6, 1.2) });
    }
  }

  addText(e: GameEvents['text']): void {
    if (this.texts.length > 150) this.recycle(this.texts.shift()!);
    const obj = this.textPool.pop() ?? this.scene.add.text(0, 0, '', {
      fontFamily: 'system-ui, sans-serif', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(DEPTH_TEXT);
    obj.setText(e.text).setColor(e.color).setFontSize(e.size).setPosition(e.x, e.y).setAlpha(1).setVisible(true);
    const life = e.life ?? 0.8;
    this.texts.push({ obj, life, max: life });
  }

  private recycle(t: FloatText): void {
    t.obj.setVisible(false);
    this.textPool.push(t.obj);
  }

  addVfx(v: Vfx): void {
    const life = v.kind === 'ring' ? v.life : v.kind === 'blast' ? 0.35 : v.kind === 'swing' ? 0.16 : v.kind === 'chain' ? 0.22 : 6;
    this.vfx.push({ ...v, t: 0, life });
  }

  /** Lights cast by transient effects (blasts, falling meteors). */
  lights(out: { x: number; y: number; r: number }[]): void {
    for (const v of this.vfx) if (v.kind === 'blast') out.push({ x: v.x, y: v.y, r: v.r * 2.2 * (1 - v.t / v.life) });
    for (const z of this.g.zones) {
      if (z.kind === 'field' && (z.burn || z.holy)) out.push({ x: z.x, y: z.y, r: z.r * 1.6 });
      if (z.kind !== 'meteor') continue;
      const k = Math.min(1, z.t / z.delay);
      out.push({ x: z.x - (1 - k) * 260, y: z.y - (1 - k) * 620, r: 160 });
    }
  }

  update(dt: number): void {
    this.updateParticles(dt);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.obj.y -= 32 * dt;
      t.obj.setAlpha(Math.min(1, (t.life / t.max) * 2));
      if (t.life <= 0) { this.recycle(t); this.texts.splice(i, 1); }
    }
    for (const v of this.vfx) v.t += dt;
    this.vfx = this.vfx.filter(v => v.t < v.life);

    this.groundG.clear();
    this.topG.clear();
    this.drawVfx();
    this.drawZones(dt);
    this.syncProjectiles();
  }

  private updateParticles(dt: number): void {
    const ps = this.particles, gr = this.particleG;
    gr.clear();
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt;
      gr.fillStyle(p.col, p.alpha * (p.life / p.max));
      gr.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
    }
  }

  private drawVfx(): void {
    for (const v of this.vfx) {
      const k = v.t / v.life;
      switch (v.kind) {
        case 'ring':
          this.topG.lineStyle(6 * (1 - k) + 1, color(v.color).color, 1 - k);
          this.topG.strokeCircle(v.x, v.y, v.r * (0.3 + 0.7 * k));
          break;
        case 'blast':
          this.topG.fillStyle(color(v.color).color, 0.55 * (1 - k));
          this.topG.fillCircle(v.x, v.y, v.r * (0.4 + 0.6 * k));
          this.topG.fillStyle(0xfff6d0, 0.8 * (1 - k));
          this.topG.fillCircle(v.x, v.y, v.r * 0.35 * (1 - k));
          break;
        case 'swing':
          this.topG.fillStyle(0xfff1d0, 0.45 * (1 - k));
          this.topG.slice(v.x, v.y, v.range, v.angle - v.arc / 2, v.angle - v.arc / 2 + v.arc * Math.min(1, k * 1.6));
          this.topG.fillPath();
          break;
        case 'scorch':
          this.groundG.fillStyle(0x1b120c, 0.45 * (1 - k));
          this.groundG.fillCircle(v.x, v.y, v.r);
          break;
        case 'chain': {
          // Jagged lightning between each pair of points, redrawn with fresh jitter every frame.
          const c = color(v.color).color;
          for (const [w, a] of [[5, 0.35], [2, 1]] as const) {
            this.topG.lineStyle(w, w > 2 ? 0x5aa8ff : c, a * (1 - k));
            this.topG.beginPath();
            this.topG.moveTo(v.points[0].x, v.points[0].y);
            for (let i = 1; i < v.points.length; i++) {
              const p0 = v.points[i - 1], p1 = v.points[i];
              for (let s = 1; s <= 3; s++) {
                const t = s / 4;
                this.topG.lineTo(p0.x + (p1.x - p0.x) * t + rand(-7, 7), p0.y + (p1.y - p0.y) * t + rand(-7, 7));
              }
              this.topG.lineTo(p1.x, p1.y);
            }
            this.topG.strokePath();
          }
          break;
        }
      }
    }
    const shimmer = 0.5 + Math.sin(this.g.time * 8) * 0.2;
    for (const p of this.g.players) {
      if (p.dead) continue;
      if (p.altHeld) this.drawAlt(p);
      // Absorb shields (Glacial Barrier, Arcane Ward, Holy Ward).
      if (p.barrier > 0) this.topG.lineStyle(2, 0xa8e0ff, shimmer).strokeCircle(p.x, p.y - 4, 24);
      // Whirlwind blades around a warrior.
      if (p.whirl > 0) {
        const r = p.whirlRadius(), base = this.g.time * 18;
        this.topG.lineStyle(4, 0xf2c879, 0.55);
        for (let i = 0; i < 3; i++) {
          this.topG.beginPath();
          this.topG.arc(p.x, p.y, r * (0.55 + i * 0.2), base + i * 2, base + i * 2 + 1.6);
          this.topG.strokePath();
        }
      }
    }
    for (const a of this.g.allies) if (a.barrier > 0 && !a.dead) this.topG.lineStyle(2, 0xa8e0ff, shimmer).strokeCircle(a.x, a.y - 4, 22);
    // Buildings under Holy Ward.
    for (const b of this.g.world.buildings) {
      if (!b.ward || b.ward.until <= this.g.time) continue;
      const half = (b.size * 40) / 2 + 2;
      this.groundG.lineStyle(2, 0xffe27a, shimmer * Math.min(1, b.ward.until - this.g.time)).strokeRect(b.x - half, b.y - half, half * 2, half * 2);
    }
  }

  /** The held right-click ability: shield arc, beam, bow draw or healing link. */
  private drawAlt(p: Player): void {
    const T = this.topG, time = this.g.time;
    switch (p.def.alt.kind) {
      case 'block': {
        // A full ring with Tower Shield, else an arc in front.
        const tower = p.stats.flags.has('towershield');
        T.lineStyle(tower ? 3 : 4, 0xdfe7ee, 0.7);
        T.beginPath();
        if (tower) T.arc(p.x, p.y - 4, 28, 0, TAU);
        else T.arc(p.x, p.y - 4, 28, p.angle - 1, p.angle + 1);
        T.strokePath();
        break;
      }
      case 'beam': {
        if (!p.altEnd) break;
        const x0 = p.x + Math.cos(p.angle) * 14, y0 = p.y - 6 + Math.sin(p.angle) * 14, e = p.altEnd;
        T.lineStyle(12, 0x8a5cff, 0.25 + Math.sin(time * 30) * 0.08).lineBetween(x0, y0, e.x, e.y - 6);
        T.lineStyle(4, 0xd8c4ff, 0.85).lineBetween(x0, y0, e.x + rand(-2, 2), e.y - 6 + rand(-2, 2));
        T.fillStyle(0xe8dcff, 0.8).fillCircle(x0, y0, 5);
        break;
      }
      case 'aimed': {
        // A sight line that grows and brightens as the bow is drawn.
        const k = p.altT / AIM_MAX, len = 60 + 260 * k, full = k >= 1;
        T.lineStyle(full ? 3 : 2, full ? 0xffe27a : 0xe9f5c9, full ? 0.55 + Math.sin(time * 20) * 0.25 : 0.2 + 0.4 * k);
        T.lineBetween(p.x, p.y - 4, p.x + Math.cos(p.angle) * len, p.y - 4 + Math.sin(p.angle) * len);
        break;
      }
      case 'mend': {
        const pulse = 0.5 + Math.sin(time * 10) * 0.2;
        const at = p.altEnd ?? p;
        T.lineStyle(3, 0xffe27a, pulse).strokeCircle(at.x, at.y - 4, 20 + Math.sin(time * 6) * 3);
        T.fillStyle(0xffe27a, 0.12).fillCircle(at.x, at.y - 4, 20);
        if (p.altEnd) {
          T.lineStyle(8, 0xffe27a, 0.25).lineBetween(p.x, p.y - 8, at.x, at.y - 6);
          T.lineStyle(3, 0xfff2b0, pulse + 0.2).lineBetween(p.x, p.y - 8, at.x, at.y - 6);
        }
        break;
      }
    }
  }

  private drawZones(dt: number): void {
    const G = this.groundG, T = this.topG, time = this.g.time;
    const live = new Set<number>();
    for (const z of this.g.zones) {
      live.add(z.id);
      this.drawZone(z, G, T, time, dt);
    }
    for (const [id, img] of this.clouds) if (!live.has(id)) { img.destroy(); this.clouds.delete(id); }
    for (const id of this.rain.keys()) if (!live.has(id)) this.rain.delete(id);
  }

  private drawZone(z: Zone, G: Phaser.GameObjects.Graphics, T: Phaser.GameObjects.Graphics, time: number, dt: number): void {
    switch (z.kind) {
      case 'meteor': {
        const k = Math.min(1, z.t / z.delay);
        G.lineStyle(2, 0xff6e32, 0.85);
        G.strokeCircle(z.x, z.y, z.r);
        G.fillStyle(0xff5a1e, 0.15);
        G.fillCircle(z.x, z.y, z.r * k);
        const mx = z.x - (1 - k) * 260, my = z.y - (1 - k) * 620;
        T.lineStyle(10, 0xffaa50, 0.6);
        T.lineBetween(mx - 50, my - 120, mx, my);
        T.fillStyle(0xffcc66, 1).fillCircle(mx, my, 16);
        T.fillStyle(0xfff4c0, 1).fillCircle(mx, my, 8);
        break;
      }
      case 'snare': {
        G.lineStyle(2, 0xa7c86a, 1);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          G.lineBetween(z.x, z.y, z.x + Math.cos(a) * 14, z.y + Math.sin(a) * 14);
        }
        G.strokeCircle(z.x, z.y, 9);
        G.fillStyle(0x9be35b, 0.5 + Math.sin(time * 5) * 0.3).fillCircle(z.x, z.y, 4);
        break;
      }
      case 'cloud':
      case 'icefield': {
        let img = this.clouds.get(z.id);
        if (!img) {
          img = this.scene.add.image(z.x, z.y, z.kind === 'cloud' ? 'cloud' : 'ice')
            .setDepth(z.kind === 'cloud' ? DEPTH_TOP - 1 : DEPTH_ZONES_GROUND + 1);
          this.clouds.set(z.id, img);
        }
        const fade = Math.min(1, (z.life - z.t) / 0.6, z.t / 0.3);
        img.setDisplaySize(z.r * 2, z.r * 2).setAlpha((z.kind === 'cloud' ? 0.35 : 0.3) * fade);
        break;
      }
      case 'rain': {
        G.lineStyle(2, 0xd9e86a, 0.35);
        G.strokeCircle(z.x, z.y, z.r);
        let drops = this.rain.get(z.id);
        if (!drops) this.rain.set(z.id, (drops = []));
        if (z.t < z.life) {
          for (let i = 0; i < 4; i++) {
            const a = rand(0, TAU), d = Math.sqrt(Math.random()) * z.r;
            drops.push({ x: z.x + Math.cos(a) * d, y: z.y + Math.sin(a) * d, t: 0 });
          }
        }
        T.lineStyle(1.5, 0xefe6c4, 1);
        for (let i = drops.length - 1; i >= 0; i--) {
          const dr = drops[i];
          dr.t += dt;
          if (dr.t >= 0.25) { drops.splice(i, 1); continue; }
          const h = (1 - dr.t / 0.25) * 80;
          T.lineBetween(dr.x - 6, dr.y - h - 14, dr.x, dr.y - h);
        }
        break;
      }
      case 'hazard':
      case 'telegraph': {
        const k = z.t / z.life, c = color(z.color).color;
        G.lineStyle(2, c, 0.8).strokeCircle(z.x, z.y, z.r);
        G.fillStyle(c, 0.25).fillCircle(z.x, z.y, z.r * k);
        break;
      }
      case 'field': {
        const c = color(z.color).color, fade = Math.min(1, (z.life - z.t) / 0.5, z.t / 0.2);
        const pulse = 0.8 + Math.sin(time * 6 + z.id) * 0.2;
        G.fillStyle(c, 0.2 * fade * pulse).fillCircle(z.x, z.y, z.r);
        G.lineStyle(2, c, 0.45 * fade).strokeCircle(z.x, z.y, z.r);
        break;
      }
      case 'banner': {
        const fade = Math.min(1, (z.life - z.t) / 0.6);
        G.lineStyle(2, 0x8fb0d9, 0.35 * fade).strokeCircle(z.x, z.y, z.r);
        G.fillStyle(0x8fb0d9, 0.06 * fade).fillCircle(z.x, z.y, z.r);
        // Pole with a waving pennant.
        T.lineStyle(3, 0x5a4a3a, fade).lineBetween(z.x, z.y, z.x, z.y - 46);
        const wave = Math.sin(time * 5) * 3;
        T.fillStyle(0xd94a3a, fade).fillTriangle(z.x, z.y - 46, z.x + 24, z.y - 39 + wave, z.x, z.y - 32);
        T.fillStyle(0xf2c879, fade).fillCircle(z.x, z.y - 47, 2.5);
        break;
      }
    }
  }

  private syncProjectiles(): void {
    const live = new Set<number>();
    for (const pr of this.g.projectiles) {
      live.add(pr.id);
      let img = this.projectiles.get(pr.id);
      if (!img) {
        img = this.scene.add.image(pr.x, pr.y, `p_${pr.kind}`).setDepth(DEPTH_TOP - 2);
        const base = pr.kind === 'arrow' ? 1 : pr.kind === 'cannon' ? 1.6 : 2;
        img.setScale(base * (pr.scale ?? 1));
        this.projectiles.set(pr.id, img);
      }
      if (this.g.replica && pr.trail && Math.random() < 0.6) {
        this.addParticles({ x: pr.x, y: pr.y, n: 1, color: pr.trail, speed: 20, life: 0.3, size: pr.r * 0.6 });
      }
      if (pr.lob) {
        img.setPosition(pr.x, pr.y - pr.lob.h);
        if (pr.kind === 'cannon') img.setRotation(this.g.time * 8);
        this.groundG.fillStyle(0x000000, 0.25).fillEllipse(pr.x, pr.y, 12, 6);
      } else {
        img.setPosition(pr.x, pr.y).setRotation(Math.atan2(pr.vy, pr.vx));
      }
    }
    for (const [id, img] of this.projectiles) if (!live.has(id)) { img.destroy(); this.projectiles.delete(id); }
  }
}
