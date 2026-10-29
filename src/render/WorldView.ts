// Ground tilemap, resource nodes, buildings, treasure chests and supply crates, kept in sync
// with the simulation by entity id.

import Phaser from 'phaser';
import { ART_SCALE, GRID_H, MAP_W, TILE } from '../config';
import type { Game } from '../sim/game';
import type { Building, ResourceNode } from '../sim/world';
import { entryLock } from '../sim/dungeons';
import { DEPTH_ACTORS } from './ActorView';
import { buildingKey, gateKey, GROUND_TILE, wallKey } from './textures';

const DEPTH_GROUND = 0;
const DEPTH_FLOOR = 10; // flat buildings like spike traps

interface BuildingView {
  tier: number;
  parts: Phaser.GameObjects.GameObject[];
  base: Phaser.GameObjects.Image;
  head?: Phaser.GameObjects.Image;
  hearthFlame?: Phaser.GameObjects.Sprite;
}

/** Texture for a building's current tier (and, for walls, which neighbours it joins). */
export function buildingTexture(g: Game, b: Building): string {
  if (b.type === 'wall') return wallKey(b.tier, g.world.wallMask(b));
  if (b.type === 'gate') return gateKey(b.tier);
  return buildingKey(b.type, b.tier);
}

export class WorldView {
  private nodes = new Map<number, Phaser.GameObjects.Image>();
  private buildings = new Map<number, BuildingView>();
  private props = new Map<number, Phaser.GameObjects.Image>();

  constructor(private scene: Phaser.Scene, private g: Game) {
    const data: number[][] = [];
    for (let y = 0; y < GRID_H; y++) {
      const row: number[] = [];
      for (let x = 0; x < MAP_W; x++) row.push(g.world.ground[y * MAP_W + x]);
      data.push(row);
    }
    const map = scene.make.tilemap({ data, tileWidth: GROUND_TILE, tileHeight: GROUND_TILE });
    const tiles = map.addTilesetImage('ground', 'ground', GROUND_TILE, GROUND_TILE, 0, 0)!;
    map.createLayer(0, tiles, 0, 0)!.setScale(TILE / GROUND_TILE).setDepth(DEPTH_GROUND);

    // Dungeons: the way out, and torches on the chamber walls (both fixed, from the layout).
    for (const d of g.dungeons) {
      const portal = scene.add.image(d.exit.x, d.exit.y, 'portal').setScale(ART_SCALE * 1.2).setDepth(DEPTH_FLOOR);
      scene.tweens.add({ targets: portal, angle: 360, duration: 6000, repeat: -1 });
      scene.tweens.add({ targets: portal, scale: ART_SCALE * 1.4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      for (const t of d.torches) {
        scene.add.sprite(t.x, t.y + 8, 'flame').setOrigin(0.5, 1).setScale(ART_SCALE * 0.9).setDepth(DEPTH_ACTORS + t.y)
          .play({ key: 'flame', startFrame: Math.floor(Math.random() * 4) });
      }
    }
  }

  sync(): void {
    this.syncNodes();
    this.syncBuildings();
    this.syncProps();
  }

  private syncNodes(): void {
    const g = this.g, now = g.time, seen = new Set<number>();
    for (const n of g.world.nodes) {
      seen.add(n.id);
      let img = this.nodes.get(n.id);
      if (!img) this.nodes.set(n.id, (img = this.createNode(n)));
      // Shrinks as it's harvested; rich regrowth on later days looks a little bigger.
      const k = 0.75 + 0.25 * Math.min(1.6, n.amount / n.def.amount);
      const shaking = now - n.lastHit < 0.18;
      img.setScale(ART_SCALE * k).setX(n.x + (shaking ? Math.sin(now * 80) * 2.5 : 0));
    }
    for (const [id, img] of this.nodes) if (!seen.has(id)) { img.destroy(); this.nodes.delete(id); }
  }

  private syncBuildings(): void {
    const g = this.g, now = g.time, seen = new Set<number>();
    for (const b of g.world.buildings) {
      seen.add(b.id);
      let v = this.buildings.get(b.id);
      if (v && v.tier !== b.tier) { this.destroyView(v); v = undefined; }
      if (!v) this.buildings.set(b.id, (v = this.createBuilding(b)));
      if (b.def.wall) v.base.setTexture(buildingTexture(g, b));
      if (now - b.lastHit < 0.12) v.base.setTintFill(0xffffff); else v.base.clearTint();
      if (v.head) v.head.setRotation(b.angle);
      if (v.hearthFlame) v.hearthFlame.setScale(ART_SCALE * (0.9 + 0.25 * b.tier + 0.6 * b.hp / b.maxHp));
    }
    for (const [id, v] of this.buildings) if (!seen.has(id)) { this.destroyView(v); this.buildings.delete(id); }
  }

  /** Treasure chests at camps and supply crates from day events. */
  private syncProps(): void {
    const g = this.g, seen = new Set<number>();
    const show = (id: number, x: number, y: number, key: string) => {
      seen.add(id);
      let img = this.props.get(id);
      if (!img) {
        img = this.scene.add.image(x, y, key).setScale(ART_SCALE).setDepth(DEPTH_ACTORS + y);
        this.props.set(id, img);
      }
      img.setTexture(key);
    };
    for (const c of g.camps) show(c.id, c.x, c.y, c.opened ? 'chest_open' : 'chest');
    for (const p of g.pickups) show(p.id, p.x, p.y, 'crate');
    for (const d of g.dungeons) show(d.id, d.x, d.y, `cave_${d.theme}${entryLock(g, d) ? '_sealed' : ''}`);
    for (const [id, img] of this.props) if (!seen.has(id)) { img.destroy(); this.props.delete(id); }
  }

  private destroyView(v: BuildingView): void {
    for (const p of v.parts) p.destroy();
  }

  private createNode(n: ResourceNode): Phaser.GameObjects.Image {
    const key = n.type === 'tree' ? `tree${n.seed < 0.5 ? 0 : 1}` : n.type;
    return this.scene.add.image(n.x, n.y, key)
      .setOrigin(0.5, n.type === 'tree' ? 0.78 : 0.6)
      .setFlipX(n.seed > 0.7)
      .setDepth(DEPTH_ACTORS + n.y);
  }

  private createBuilding(b: Building): BuildingView {
    const s = this.scene, depth = b.def.solid || b.type === 'torch' ? DEPTH_ACTORS + b.y : DEPTH_FLOOR;
    const base = s.add.image(b.x, b.y, buildingTexture(this.g, b)).setScale(ART_SCALE).setDepth(depth);
    const v: BuildingView = { tier: b.tier, parts: [base], base };
    const flame = (x: number, y: number, scale: number) => {
      const f = s.add.sprite(x, y, 'flame').setOrigin(0.5, 1).setScale(scale).setDepth(depth + 0.5);
      f.play({ key: 'flame', startFrame: Math.floor(Math.random() * 4) });
      v.parts.push(f);
      return f;
    };
    const floaty = (key: string, y: number, rise: number) => {
      const c = s.add.image(b.x, y, key).setScale(ART_SCALE).setDepth(depth + 0.5);
      s.tweens.add({ targets: c, y: y - rise, alpha: 0.75, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      v.parts.push(c);
      return c;
    };
    switch (b.type) {
      case 'arrowtower': {
        const heavy = b.tier >= 2;
        v.head = s.add.image(b.x, b.y, heavy ? 'head_ballista' : 'head_arrow')
          .setScale(ART_SCALE * (b.tier === 1 ? 1.15 : 1)).setOrigin(0.3, 0.5).setDepth(depth + 0.5);
        v.parts.push(v.head);
        break;
      }
      case 'firetower':
        flame(b.x, b.y + 6, ART_SCALE * (1 + b.tier * 0.25));
        break;
      case 'frostspire':
        floaty('frost_crystal', b.y - 6, 5).setScale(ART_SCALE * (1 + b.tier * 0.2));
        break;
      case 'stormtotem':
        floaty('storm_orb', b.y - 16, 3).setScale(ART_SCALE * (1 + b.tier * 0.25));
        break;
      case 'torch':
        base.setOrigin(0.5, 0.75);
        flame(b.x, b.y - 10, ART_SCALE * 0.7);
        break;
      case 'shrine':
        floaty('shrine_crystal', b.y - 4, 5);
        break;
      case 'hearth':
        v.hearthFlame = flame(b.x, b.y + 12, ART_SCALE * 1.7);
        break;
    }
    return v;
  }
}
