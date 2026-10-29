import type { Motion, SceneMotion } from '@/ui/shelf/scene';

// The component owns only currently rendered shelves. Departing animations can
// keep their own Motion references; pruning this cache must not mutate them.
export function retainSceneMotions(ids: readonly string[], previous: ReadonlyMap<string, Motion>, create: (id: string) => Motion) {
  const map = new Map<string, Motion>();
  const motions: SceneMotion[] = ids.map((shelfId) => {
    const m = map.get(shelfId) ?? previous.get(shelfId) ?? create(shelfId);
    map.set(shelfId, m);
    return { shelfId, m };
  });
  return { map, motions };
}
