/** Binary min-heap of (key, value) pairs, used by the pathfinding flow field. */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  /** Key of the most recently popped item. */
  lastKey = 0;

  get size(): number { return this.keys.length; }

  push(k: number, v: number): void {
    const K = this.keys, V = this.vals;
    let i = K.length;
    K.push(k); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = k; V[i] = v;
  }

  pop(): number {
    const K = this.keys, V = this.vals;
    const top = V[0];
    this.lastKey = K[0];
    const k = K.pop()!, v = V.pop()!;
    const n = K.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && K[r] < K[l] ? r : l;
        if (K[c] >= k) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = k; V[i] = v;
    }
    return top;
  }
}
