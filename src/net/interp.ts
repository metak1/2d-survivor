// Smooth motion for everything the server moves. Snapshots arrive about 30 times a second, and
// not evenly. Instead of chasing the newest one, each character is drawn slightly in the past
// (INTERP_DELAY), on the straight line between the two snapshots around that moment, so it moves
// at a steady speed. Our own character isn't drawn this way: it's predicted (predict.ts).

/** How far behind the server the world is drawn, in seconds. A bit more than the snapshot gap. */
const INTERP_DELAY = 0.09;
/** How long to keep moving along the last direction when a snapshot is late. */
const MAX_EXTRAPOLATE = 0.12;

interface Sample { t: number; x: number; y: number }

export class Interpolator {
  /** Recent positions per entity id, oldest first. */
  private hist = new Map<number, Sample[]>();
  /** Server time minus local time, smoothed. */
  private offset: number | null = null;
  /** Server time the world is being drawn at. */
  renderTime = 0;

  /** Notes the server time of a snapshot that just arrived. */
  sync(serverTime: number, localNow: number): void {
    const o = serverTime - localNow;
    if (this.offset === null || Math.abs(o - this.offset) > 0.5) this.offset = o;
    else this.offset += (o - this.offset) * 0.1;
  }

  push(id: number, t: number, x: number, y: number): void {
    let h = this.hist.get(id);
    if (!h) this.hist.set(id, (h = []));
    if (h.length && h[h.length - 1].t >= t) return;
    h.push({ t, x, y });
    if (h.length > 12) h.shift();
  }

  /** Advances the drawing clock; call once a frame before sampling. */
  advance(localNow: number): void {
    if (this.offset !== null) this.renderTime = localNow + this.offset - INTERP_DELAY;
  }

  /** Where an entity is at the drawing clock, or null if we've never seen it. */
  sample(id: number): { x: number; y: number } | null {
    const h = this.hist.get(id);
    if (!h?.length) return null;
    const t = this.renderTime;
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (t < a.t) continue;
      if (t <= b.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        // A teleport or respawn snaps instead of sliding across the map.
        if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 150) return k < 0.5 ? a : b;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
      break;
    }
    // Newer than anything we have: keep going a little in the last direction.
    const b = h[h.length - 1], a = h[h.length - 2];
    if (!a) return b;
    const over = Math.min(MAX_EXTRAPOLATE, t - b.t), k = over / (b.t - a.t || 1);
    // Big jumps (teleports, respawns) shouldn't be extrapolated.
    if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 150) return b;
    return { x: b.x + (b.x - a.x) * k, y: b.y + (b.y - a.y) * k };
  }

  /** Forgets entities that are no longer in the game. */
  retain(ids: Set<number>): void {
    for (const id of this.hist.keys()) if (!ids.has(id)) this.hist.delete(id);
  }
}
