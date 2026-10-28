// Cache completed art only up to this many variants. Mounted components keep
// their own references; eviction must not dispose pictures still being drawn.
export function createArtCache<T>(capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Art cache capacity must be a positive integer');
  const completed = new Map<string, T>();
  const pending = new Map<string, Promise<T>>();
  return {
    peek(key: string): T | undefined { return completed.get(key); },
    load(key: string, build: () => Promise<T>): Promise<T> {
      if (completed.has(key)) {
        const value = completed.get(key)!;
        completed.delete(key);
        completed.set(key, value);
        return Promise.resolve(value);
      }
      const existing = pending.get(key);
      if (existing) return existing;
      const work = Promise.resolve().then(build).then((value) => {
        completed.set(key, value);
        while (completed.size > capacity) completed.delete(completed.keys().next().value!);
        return value;
      }).finally(() => { pending.delete(key); });
      pending.set(key, work);
      return work;
    },
  };
}
