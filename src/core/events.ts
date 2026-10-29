/** Minimal typed event emitter. M maps event names to payload types. */
export class Emitter<M extends object> {
  private handlers = new Map<keyof M, Set<(p: never) => void>>();

  on<K extends keyof M>(type: K, fn: (payload: M[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as (p: never) => void);
    return () => set!.delete(fn as (p: never) => void);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) (fn as (p: M[K]) => void)(payload);
  }

  clear(): void { this.handlers.clear(); }
}
