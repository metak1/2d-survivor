// Animated sprite for a character (player or monster). Plays walk/idle from movement,
// one-shot attack/death animations on events, and tints for hits and freezes.

import Phaser from 'phaser';
import type { SpriteRef } from '../data/types';
import { animKey, type AnimName } from './BootScene';

export const DEPTH_ACTORS = 1000; // + world y, so things lower on screen draw in front

export interface ActorState {
  x: number;
  y: number;
  moving: boolean;
  faceLeft: boolean;
  flash: boolean;
  frozen: boolean;
  ghost?: boolean;
  /** Holding a right-click ability: shows the block pose instead of idle/walk. */
  blocking?: boolean;
}

export class ActorView {
  readonly sprite: Phaser.GameObjects.Sprite;
  dead = false;
  private busy = false;

  constructor(private scene: Phaser.Scene, private look: SpriteRef, x: number, y: number) {
    this.sprite = scene.add.sprite(x, y, `${look.sprite}:idle:sheet`).setScale(look.scale);
    this.sprite.play(animKey(look.sprite, 'idle'));
    this.sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => { if (!this.dead) this.busy = false; });
  }

  private key(a: AnimName): string { return animKey(this.look.sprite, a); }

  playOnce(anim: 'attack' | 'attack2' | 'hurt'): void {
    if (this.dead) return;
    this.busy = true;
    this.sprite.play(this.key(anim));
  }

  sync(s: ActorState): void {
    const sp = this.sprite;
    sp.setPosition(s.x, s.y + (this.look.offsetY ?? 0));
    sp.setDepth(DEPTH_ACTORS + s.y);
    if (this.dead) return;
    sp.setFlipX(s.faceLeft);
    if (!this.busy) {
      const k = this.key(s.blocking ? 'block' : s.moving ? 'walk' : 'idle');
      if (sp.anims.currentAnim?.key !== k) sp.play(k);
    }
    if (s.frozen) sp.anims.pause(); else if (sp.anims.isPaused) sp.anims.resume();
    if (s.flash) sp.setTintFill(0xffffff);
    else if (s.frozen) sp.setTint(0x9fdcff);
    else sp.clearTint();
    sp.setAlpha(s.ghost ? 0.55 : 1);
  }

  /** Plays the death animation. Monsters fade out and are destroyed; the player stays as a corpse. */
  die(destroy: boolean): void {
    if (this.dead) return;
    this.dead = true;
    this.busy = true;
    const sp = this.sprite;
    sp.clearTint();
    sp.anims.resume();
    sp.play(this.key('death'));
    sp.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.scene.tweens.add({
        targets: sp, alpha: destroy ? 0 : 0.35, delay: destroy ? 400 : 0, duration: 600,
        onComplete: () => { if (destroy) sp.destroy(); },
      });
    });
  }

  revive(): void {
    this.dead = false;
    this.busy = false;
    this.scene.tweens.killTweensOf(this.sprite);
    this.sprite.setAlpha(1);
  }

  destroy(): void { this.sprite.destroy(); }
}
