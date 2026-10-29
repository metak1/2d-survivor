// Client-side prediction for our own character online. We move it the moment a key is pressed,
// remembering each move with the number of the input that caused it. When a snapshot arrives it
// says where the server has us and which input it had applied (`ack`); we start from there and
// re-apply the moves it hasn't seen yet. The difference is eased in over a few frames rather
// than all at once when the snapshot lands, so corrections don't show as stutter; big jumps
// (a Blink, a respawn) snap.

import type { Game } from '../sim/game';
import type { Intent, Player } from '../sim/player';

interface Move { seq: number; dx: number; dy: number }

export class Predictor {
  /** Number of the input we're sending now. */
  seq = 0;
  private moves: Move[] = [];
  /** Correction still to apply, eased in by ease(). */
  private corr = { x: 0, y: 0 };

  /** Moves our player locally for one frame of `it`. */
  step(g: Game, p: Player, it: Intent, dt: number): void {
    p.angle = Math.atan2(it.aimY - p.y, it.aimX - p.x);
    const len = Math.hypot(it.moveX, it.moveY);
    p.moving = len > 0 && !p.dead;
    // Dashes are fast and server-driven: follow the server through them.
    if (!len || p.dead || p.dash) return;
    const x0 = p.x, y0 = p.y, speed = p.moveSpeed * dt;
    p.x += (it.moveX / len) * speed;
    p.y += (it.moveY / len) * speed;
    g.world.collide(p, true);
    this.moves.push({ seq: this.seq, dx: p.x - x0, dy: p.y - y0 });
    if (this.moves.length > 240) this.moves.shift();
  }

  /** A snapshot put us at (sx, sy) having applied input `ack`. */
  reconcile(p: Player, sx: number, sy: number, ack: number): void {
    this.moves = this.moves.filter(m => m.seq > ack);
    let x = sx, y = sy;
    for (const m of this.moves) { x += m.dx; y += m.dy; }
    const ex = x - p.x, ey = y - p.y, err = Math.hypot(ex, ey);
    if (err > 200 || p.dead) {
      p.x = x;
      p.y = y;
      this.corr = { x: 0, y: 0 };
    } else {
      // Under a pixel isn't worth moving for.
      this.corr = err < 1 ? { x: 0, y: 0 } : { x: ex, y: ey };
    }
  }

  /** Applies part of the pending correction; call every frame. Faster while dashing. */
  ease(p: Player, dt: number): void {
    if (!this.corr.x && !this.corr.y) return;
    const k = Math.min(1, dt * (p.dash ? 25 : 10));
    const dx = this.corr.x * k, dy = this.corr.y * k;
    p.x += dx;
    p.y += dy;
    this.corr.x -= dx;
    this.corr.y -= dy;
  }

  reset(): void {
    this.seq = 0;
    this.moves = [];
    this.corr = { x: 0, y: 0 };
  }
}
