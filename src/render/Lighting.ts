// Night overlay: a screen-sized render texture filled with darkness, with soft holes erased
// around every light source, plus additive warm glows around fires.

import Phaser from 'phaser';

export const DEPTH_DARKNESS = 800000;

export interface Light { x: number; y: number; r: number; warm?: boolean }

export class Lighting {
  private rt: Phaser.GameObjects.RenderTexture;
  private stamp: Phaser.GameObjects.Image;
  private glows: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene) {
    const { width, height } = scene.scale;
    this.rt = scene.add.renderTexture(0, 0, width, height).setOrigin(0).setScrollFactor(0).setDepth(DEPTH_DARKNESS);
    this.stamp = scene.make.image({ key: 'light', add: false });
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.resize, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, this.resize, this));
  }

  private resize(size: Phaser.Structs.Size): void {
    this.rt.resize(size.width, size.height);
  }

  /** `tint` is the colour of the night (deep blue normally, red under a Blood Moon). */
  draw(darkness: number, lights: Light[], time: number, tint = 0x060a1e): void {
    const cam = this.scene.cameras.main;
    for (const gl of this.glows) gl.setVisible(false);
    if (darkness <= 0.01) { this.rt.setVisible(false); return; }
    this.rt.setVisible(true).clear().fill(tint, darkness);

    const W = this.rt.width, H = this.rt.height, size = this.stamp.width;
    let gi = 0;
    for (const l of lights) {
      const flick = l.warm ? 1 + Math.sin(time * 11 + l.x) * 0.025 : 1;
      const r = l.r * flick, sx = l.x - cam.worldView.x, sy = l.y - cam.worldView.y;
      if (sx + r < 0 || sy + r < 0 || sx - r > W || sy - r > H) continue;
      this.stamp.setScale((r * 2) / size);
      this.rt.erase(this.stamp, sx, sy);
      if (l.warm) {
        let gl = this.glows[gi];
        if (!gl) {
          gl = this.scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_DARKNESS + 1);
          this.glows.push(gl);
        }
        gi++;
        gl.setVisible(true).setPosition(l.x, l.y).setDisplaySize(r, r).setAlpha(0.16 * darkness);
      }
    }
  }
}
