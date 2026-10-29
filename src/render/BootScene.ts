// Loads the sprite manifest written by `npm run import-assets`, then every sheet it lists,
// builds the character animations, and generates the procedural textures.

import Phaser from 'phaser';
import { FRAME_SIZE } from '../config';
import { CLASSES } from '../data/classes';
import { ENEMIES } from '../data/enemies';
import { NPC_LOOKS } from '../data/events';
import { App } from '../app';
import { UI } from '../ui/ui';
import { generateTextures, placeholderSheet } from './textures';

interface Manifest {
  frameSize: number;
  sprites: Record<string, { anims: Record<string, { file: string; frames: number }> }>;
}

export const ANIMS = ['idle', 'walk', 'attack', 'attack2', 'block', 'hurt', 'death'] as const;
export type AnimName = (typeof ANIMS)[number];

/** Animation durations in ms for one-shot animations; looping ones use frame rates. */
// Block (the pose for any held right-click ability) plays once and holds its last frame.
const DURATION: Partial<Record<AnimName, number>> = { attack: 380, attack2: 520, block: 220, hurt: 260, death: 700 };
const FPS: Partial<Record<AnimName, number>> = { idle: 7, walk: 11 };
const FALLBACK: Record<AnimName, AnimName[]> = {
  idle: ['idle'], walk: ['walk', 'idle'], attack: ['attack', 'idle'], attack2: ['attack2', 'attack', 'idle'],
  block: ['block', 'attack2', 'idle'], hurt: ['hurt', 'idle'], death: ['death', 'idle'],
};

export const animKey = (sprite: string, anim: AnimName) => `${sprite}:${anim}`;
const BASE = import.meta.env.BASE_URL;

export class BootScene extends Phaser.Scene {
  private manifest: Manifest | null = null;

  constructor() { super('boot'); }

  preload(): void {
    this.load.on('filecomplete-json-manifest', (_k: string, _t: string, data: Manifest) => {
      this.manifest = data;
      for (const [key, sp] of Object.entries(data.sprites)) {
        App.spriteFrames[key] = {};
        for (const [anim, a] of Object.entries(sp.anims)) {
          App.spriteFrames[key][anim] = a.frames;
          this.load.spritesheet(`${key}:${anim}:sheet`, BASE + 'assets/' + a.file, { frameWidth: data.frameSize, frameHeight: data.frameSize });
        }
      }
      this.load.image('p_arrow', BASE + 'assets/sprites/projectiles/arrow.png');
      this.load.image('p_cannon', BASE + 'assets/sprites/projectiles/cannonball.png');
    });
    this.load.on('loaderror', (file: Phaser.Loader.File) => console.warn('Asset failed to load:', file.key));
    this.load.json('manifest', BASE + 'assets/sprites/manifest.json');
    // The Raven icon sheet, for items lying on the ground.
    this.load.spritesheet('icons', BASE + 'assets/icons/raven32.png', { frameWidth: 32, frameHeight: 32 });
  }

  create(): void {
    generateTextures(this);
    this.createCharacterAnims();
    // Only leave the loading screen if nothing else has taken over meanwhile.
    if (App.mode !== 'loading') return;
    App.mode = 'menu';
    UI.showMenu();
  }

  private createCharacterAnims(): void {
    const looks = [
      ...Object.values(CLASSES).map(c => ({ sprite: c.look.sprite, color: c.color })),
      ...Object.values(ENEMIES).map(e => ({ sprite: e.look.sprite, color: e.color })),
      ...Object.values(NPC_LOOKS).map(l => ({ sprite: l.sprite, color: '#e8e0c8' })),
    ];
    App.missingSprites = [];
    for (const { sprite, color } of looks) {
      if (this.anims.exists(animKey(sprite, 'idle'))) continue;
      const has = (a: AnimName) => this.textures.exists(`${sprite}:${a}:sheet`);
      if (!has('idle')) {
        // Imported art missing: fall back to a coloured blob so the game stays playable.
        App.missingSprites.push(sprite);
        placeholderSheet(this, `${sprite}:idle:sheet`, color, FRAME_SIZE);
      }
      for (const anim of ANIMS) {
        // Missing optional animations reuse the closest one that exists.
        const src = FALLBACK[anim].find(has)!;
        const texture = `${sprite}:${src}:sheet`;
        const loop = anim === 'idle' || anim === 'walk';
        this.anims.create({
          key: animKey(sprite, anim),
          frames: this.anims.generateFrameNumbers(texture, {}),
          ...(loop ? { frameRate: FPS[anim] } : { duration: DURATION[anim] }),
          repeat: loop ? -1 : 0,
        });
      }
    }
    if (!this.manifest) console.warn('No sprite manifest found. Run `npm run import-assets` to import character art.');
  }
}
