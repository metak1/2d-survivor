// The in-game Phaser scene. Each frame it: handles global keys, turns input into our Intent,
// advances the simulation (solo) or sends the intent to the server (online), then syncs every
// view to the current state. The camera follows our player; everyone else is drawn the same way.

import Phaser from 'phaser';
import { STEP, WORLD_H, WORLD_W } from '../config';
import { BUILDINGS, BUILD_KEYS, BUILD_SLOTS } from '../data/buildings';
import { NPC_LOOKS } from '../data/events';
import type { SpellId, SpriteRef } from '../data/types';
import { Input } from '../core/input';
import { App, closeInventory, closeShop, closeTalents, command, me, openInventory, openShop, openTalents, pause, resume, setBuildMode } from '../app';
import { darkness } from '../sim/cycle';
import type { Game } from '../sim/game';
import { NO_INTENT, type Intent } from '../sim/player';
import { idx, tileOf } from '../sim/world';
import { UI } from '../ui/ui';
import { ActorView, type ActorState } from './ActorView';
import { FxView } from './FxView';
import { Lighting, type Light } from './Lighting';
import { Overlay } from './Overlay';
import { WorldView } from './WorldView';

export class GameScene extends Phaser.Scene {
  private g!: Game;
  private acc = 0;
  private worldView!: WorldView;
  private fx!: FxView;
  private lighting!: Lighting;
  private overlay!: Overlay;
  /** Views for players, monsters, allies and NPCs, keyed by entity id. */
  private actors = new Map<number, ActorView>();
  private camTarget!: Phaser.GameObjects.Zone;
  private unsubscribe: (() => void)[] = [];
  private pendingCasts = new Set<SpellId>();
  /** Online: our own basic-attack cooldown, so the swing animation plays without waiting for the server. */
  private localAtk = 0;

  constructor() { super('game'); }

  create(): void {
    this.g = App.game!;
    this.acc = 0;
    this.actors = new Map();
    this.pendingCasts.clear();
    const g = this.g, p = me();

    this.worldView = new WorldView(this, g);
    this.fx = new FxView(this, g);
    this.lighting = new Lighting(this);
    this.overlay = new Overlay(this, g);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H).setRoundPixels(true).setBackgroundColor('#0c120b');
    this.camTarget = this.add.zone(p.x, p.y, 1, 1);
    cam.startFollow(this.camTarget, true, 0.12, 0.12);

    // Events meant for one player carry `to`; the server only sends ours, solo filters here.
    const mine = (to?: number) => to === undefined || to === App.me;
    const ev = g.events;
    this.unsubscribe = [
      ev.on('particles', e => this.fx.addParticles(e)),
      ev.on('text', e => this.fx.addText(e)),
      ev.on('vfx', e => this.fx.addVfx(e)),
      ev.on('shake', e => { if (mine(e.to)) cam.shake(140, Math.min(0.012, e.n * 0.0007)); }),
      // Online, our own attack animations are played locally the moment we act (see localAnims).
      ev.on('anim', e => { if (!(App.net && e.id === App.me)) this.actors.get(e.id)?.playOnce(e.anim); }),
      ev.on('died', e => {
        const v = this.actors.get(e.id);
        if (!v) return;
        // Players stay as a corpse until they revive; everything else fades and goes.
        const player = g.playerById(e.id);
        v.die(!player);
        if (!player) this.actors.delete(e.id);
      }),
      ev.on('shop', e => { if (mine(e.to)) openShop(); }),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribe.forEach(u => u()));
  }

  private mouseWorld(): Phaser.Math.Vector2 {
    return this.cameras.main.getWorldPoint(Input.mx, Input.my);
  }

  update(_time: number, deltaMs: number): void {
    const g = this.g, dt = Math.min(deltaMs, 250) / 1000;
    if (!me()) return; // removed from the run (online); the client is going back to the lobby
    this.handleGlobalKeys();

    const playing = App.mode === 'playing';
    if (playing) {
      this.handleBuildInput();
      this.collectCasts();
    } else {
      this.pendingCasts.clear();
    }
    if (App.net) {
      // Online the server runs the game, even while our menus are open.
      const it = playing ? this.intent() : { ...NO_INTENT, casts: [] };
      if (playing) this.localAnims(it, dt);
      App.net.input(it, dt, playing);
      App.net.smooth(dt);
      this.renderFrame(dt);
    } else {
      if (playing) {
        this.acc += dt;
        while (this.acc >= STEP && !g.over) {
          me().intent = this.intent();
          g.step(STEP);
          this.acc -= STEP;
        }
      }
      this.renderFrame(playing ? dt : 0);
    }
    const view = this.cameras.main.worldView;
    UI.update(g, { x: view.x, y: view.y, w: view.width, h: view.height });
    Input.endFrame();
  }

  /**
   * Spell presses wait here until they're used. On displays faster than 60 Hz some frames run no
   * step at all, and a press read only on that frame would be lost.
   */
  private collectCasts(): void {
    const p = me();
    for (const sp of p.def.spells) if (Input.wasPressed(sp.key)) this.pendingCasts.add(sp.id);
    if (Input.wasPressed('Space')) this.pendingCasts.add(p.def.mobility.id);
  }

  /** Online: plays our swing and cast animations right away instead of a round trip later. */
  private localAnims(it: Intent, dt: number): void {
    const p = me(), view = this.actors.get(p.id);
    this.localAtk -= dt;
    if (!view || p.dead) return;
    if (it.attack && !it.alt && !p.dash && this.localAtk <= 0) {
      this.localAtk = p.def.basic.cd / p.stats.atkSpeed;
      view.playOnce('attack');
    }
    for (const id of it.casts) if (id !== p.def.mobility.id && !((p.cds[id] ?? 0) > 0)) view.playOnce('attack2');
  }

  private intent(): Intent {
    const m = this.mouseWorld();
    let mx = 0, my = 0;
    if (Input.isDown('KeyA') || Input.isDown('ArrowLeft')) mx -= 1;
    if (Input.isDown('KeyD') || Input.isDown('ArrowRight')) mx += 1;
    if (Input.isDown('KeyW') || Input.isDown('ArrowUp')) my -= 1;
    if (Input.isDown('KeyS') || Input.isDown('ArrowDown')) my += 1;
    const casts = [...this.pendingCasts];
    this.pendingCasts.clear();
    return { moveX: mx, moveY: my, aimX: Math.round(m.x), aimY: Math.round(m.y), attack: Input.down && !App.build.active,
      alt: Input.rdown && !App.build.active, casts };
  }

  private handleGlobalKeys(): void {
    const b = App.build;
    if (App.mode === 'over' || App.mode === 'victory' || App.mode === 'menu') return;
    if (Input.wasPressed('Escape') || Input.wasPressed('KeyP')) {
      if (App.mode === 'talents') closeTalents();
      else if (App.mode === 'inventory') closeInventory();
      else if (App.mode === 'shop') closeShop();
      else if (App.mode === 'paused') resume();
      else if (b.selected !== null && Input.wasPressed('Escape')) b.selected = null;
      else if (b.active && Input.wasPressed('Escape')) setBuildMode(false);
      else pause();
      return;
    }
    if (Input.wasPressed('KeyT')) {
      if (App.mode === 'talents') closeTalents(); else if (App.mode === 'playing') openTalents();
      return;
    }
    if (Input.wasPressed('KeyI')) {
      if (App.mode === 'inventory') closeInventory(); else if (App.mode === 'playing') openInventory();
      return;
    }
    if (App.mode === 'shop' && Input.wasPressed('KeyF')) return closeShop();
    if (App.mode !== 'playing') return;
    if (Input.wasPressed('KeyB')) setBuildMode(!b.active && !me().dead);
    if (Input.wasPressed('KeyN')) command({ c: 'callNight' });
    if (Input.wasPressed('KeyF')) command({ c: 'interact' });
    // Number keys outside build mode jump straight into build mode with that slot.
    if (!b.active) {
      BUILD_KEYS.forEach((k, i) => {
        if (!Input.wasPressed(k)) return;
        setBuildMode(true);
        b.sel = BUILD_SLOTS[i];
        Input.consume(k);
      });
    }
  }

  private handleBuildInput(): void {
    const g = this.g, b = App.build;
    if (!b.active || me().dead) return;
    if (Input.wheel) {
      const i = BUILD_SLOTS.indexOf(b.sel);
      b.sel = BUILD_SLOTS[(i + Input.wheel + BUILD_SLOTS.length) % BUILD_SLOTS.length];
    }
    BUILD_KEYS.forEach((k, i) => { if (Input.wasPressed(k)) { b.sel = BUILD_SLOTS[i]; b.selected = null; } });
    if (Input.rclicked) {
      if (b.selected !== null) b.selected = null; else setBuildMode(false);
      return;
    }
    if (b.selected !== null && !g.world.buildingById(b.selected)) b.selected = null;

    const m = this.mouseWorld(), tile = idx(tileOf(m.x), tileOf(m.y));
    if (!Input.down) { b.lastTile = -1; return; }
    const existing = g.world.buildingAt(tileOf(m.x), tileOf(m.y));
    if (Input.clicked) {
      b.lastTile = tile;
      // Clicking a building opens its menu; clicking empty ground builds (and closes the menu).
      if (existing) { b.selected = existing.id; return; }
      b.selected = null;
      command({ c: 'build', slot: b.sel, x: m.x, y: m.y });
      return;
    }
    // Walls can be painted by dragging across empty tiles.
    if (BUILDINGS[b.sel].wall && tile !== b.lastTile && !existing) {
      b.lastTile = tile;
      command({ c: 'build', slot: b.sel, x: m.x, y: m.y, quiet: true });
    }
  }

  private renderFrame(dt: number): void {
    const g = this.g, p = me(), now = g.time;
    this.camTarget.setPosition(p.x, p.y);

    this.worldView.sync();

    const seen = new Set<number>();
    const actor = (id: number, look: SpriteRef, s: ActorState) => {
      seen.add(id);
      let v = this.actors.get(id);
      if (!v) this.actors.set(id, (v = new ActorView(this, look, s.x, s.y)));
      v.sync(s);
      return v;
    };
    for (const q of g.players) {
      const v = actor(q.id, q.def.look, {
        x: q.x, y: q.y, moving: q.moving, faceLeft: Math.cos(q.angle) < 0, blocking: q.altHeld,
        flash: now - q.lastHit < 0.1, frozen: false,
        ghost: !!q.buffs.camo || (q.invuln > 0 && Math.floor(now * 20) % 2 === 0),
      });
      if (q.dead && !v.dead) v.die(false);
      if (!q.dead && v.dead) v.revive();
    }
    for (const e of g.enemies) {
      if (e.dead) continue; // killed after this step's cleanup; its death animation is already playing
      actor(e.id, e.def.look, {
        x: e.x, y: e.y, moving: e.moving, faceLeft: Math.cos(e.angle) < 0,
        flash: now - e.lastHit < 0.08, frozen: e.freeze > 0 || e.stun > 0,
      });
    }
    for (const a of g.allies) {
      if (a.dead) continue;
      actor(a.id, a.look, { x: a.x, y: a.y, moving: a.moving, faceLeft: Math.cos(a.angle) < 0, flash: now - a.lastHit < 0.08, frozen: false,
        ghost: a.kind === 'decoy' || a.kind === 'spectral' });
    }
    for (const n of g.npcs) {
      actor(n.id, NPC_LOOKS[n.kind], { x: n.x, y: n.y, moving: false, faceLeft: n.x > p.x, flash: false, frozen: false });
    }
    // Things that left (merchant at dusk, recruited traveller, a player who quit) just disappear.
    for (const [id, v] of this.actors) if (!seen.has(id) && (!v.dead || !g.playerById(id))) { v.destroy(); this.actors.delete(id); }

    this.fx.update(dt);

    const dk = darkness(g);
    this.lighting.draw(dk, this.collectLights(), now, g.bloodMoon || (g.phase === 'day' && g.bloodMoonNext) ? 0x2a0608 : 0x060a1e);
    this.overlay.draw(dk, App.build, this.mouseWorld());
  }

  private collectLights(): Light[] {
    const g = this.g, out: Light[] = [];
    for (const p of g.players) if (!p.dead) out.push({ x: p.x, y: p.y, r: p.def.light });
    for (const a of g.allies) out.push({ x: a.x, y: a.y, r: 120 });
    for (const b of g.world.buildings) {
      const light = b.stats.light;
      if (light) out.push({ x: b.x, y: b.y, r: light * (b.type === 'hearth' ? 0.8 + 0.2 * b.hp / b.maxHp : 1), warm: true });
    }
    for (const pr of g.projectiles) if (pr.light) out.push({ x: pr.x, y: pr.y - (pr.lob?.h ?? 0), r: pr.light });
    this.fx.lights(out);
    return out;
  }
}
