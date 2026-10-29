export type RowHolds = Readonly<Record<string, string[]>>;

// Owns the temporary canvas residency of books moving between rows. There is
// one expiry per book, so a later drag/undo replaces an earlier release.
export function createRowHolds(getBusyIds: () => readonly string[], delay: () => number) {
  let snapshot: RowHolds = {};
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();
  const publish = (next: RowHolds) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const cancel = (id: string) => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    holdRows(ids: string[], rows: string[]) {
      if (!ids.length) return;
      const next = { ...snapshot };
      for (const id of ids) {
        cancel(id);
        next[id] = [...new Set([...(next[id] ?? []), ...rows])];
      }
      publish(next);
    },
    releaseLater(ids: string[]) {
      for (const id of ids) {
        cancel(id);
        if (!snapshot[id]) continue;
        timers.set(id, setTimeout(() => {
          timers.delete(id);
          if (getBusyIds().includes(id) || !snapshot[id]) return;
          const next = { ...snapshot };
          delete next[id];
          publish(next);
        }, delay()));
      }
    },
    cancelTimers() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
