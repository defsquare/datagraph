/**
 * Minimal typed event emitter. `Events` maps event names to their payload
 * type, e.g. `{ select: GraphNode; followRef: RefEdge }`.
 */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<(payload: any) => void>>();

  /** Subscribes `callback` to `event`; returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, callback: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback as (payload: any) => void);
    return () => this.off(event, callback);
  }

  /** Unsubscribes `callback` from `event`. */
  off<K extends keyof Events>(event: K, callback: (payload: Events[K]) => void): void {
    this.listeners.get(event)?.delete(callback as (payload: any) => void);
  }

  /** Synchronously invokes every listener registered for `event`. */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const callback of this.listeners.get(event) ?? []) callback(payload);
  }

  /** Removes every listener for every event. */
  clear(): void {
    this.listeners.clear();
  }
}
