import type { Book3 } from '@/domain/book3';
import type { FallDirections } from '@/domain/shelf-scene';
import type { ShelfLayout } from '@/domain/types';

type Departing = { id: string; from: string };
type Falling = { shelfId: string; from: Book3; d: -1 | 0 | 1; until: number };
export type ShelfTransitions = {
  layout: ShelfLayout;
  arrivals: Record<string, Record<string, Book3>>;
  leaving: Departing[];
  transit: ReadonlyMap<string, number>;
  falling: ReadonlyMap<string, Falling>;
};

export function initialShelfTransitions(layout: ShelfLayout): ShelfTransitions {
  return { layout, arrivals: {}, leaving: [], transit: new Map(), falling: new Map() };
}

type Input = {
  layout: ShelfLayout;
  now: number;
  transitMs: number;
  fallMs: number;
  scale: number;
  baselineOf: (shelfId: string) => number | undefined;
  poseOf: (shelfId: string, bookId: string) => Book3 | undefined;
  fallDirections: FallDirections;
  fallIds: readonly string[];
  dragActive: boolean;
  reduceMotion: boolean;
};

// A render can be retried or abandoned. Derive a new snapshot without changing
// the last committed one; callers commit only after the screen has committed.
export function advanceShelfTransitions(previous: ShelfTransitions, input: Input): ShelfTransitions {
  const { layout, now } = input;
  const transit = new Map([...previous.transit].filter(([, until]) => until > now));
  const falling = new Map([...previous.falling].filter(([, fall]) => fall.until > now));
  if (previous.layout === layout) {
    return transit.size === previous.transit.size && falling.size === previous.falling.size
      ? previous : { ...previous, transit, falling };
  }
  const nextPlacements = new Map(layout.placements.map((p) => [p.bookId, p]));
  const beforePlacements = new Map(previous.layout.placements.map((p) => [p.bookId, p]));
  const drawer = new Set(layout.drawer);
  const fallIds = new Set(input.fallIds);
  for (const id of falling.keys()) if (nextPlacements.has(id)) falling.delete(id);
  if (!input.reduceMotion) for (const q of previous.layout.placements) {
    if (nextPlacements.has(q.bookId) || !drawer.has(q.bookId)) continue;
    if (!input.dragActive && !fallIds.has(q.bookId)) continue;
    const pose = input.poseOf(q.shelfId, q.bookId);
    if (!pose) continue;
    const d = q.pose === 'front' ? 0 : input.fallDirections[q.bookId] ?? ((Math.sign(pose.roll) || Math.sign(q.tilt) || 1) as -1 | 1);
    falling.set(q.bookId, { shelfId: q.shelfId, from: pose, d, until: now + input.fallMs });
  }
  const arrivals: ShelfTransitions['arrivals'] = {};
  const leaving: Departing[] = [];
  for (const p of layout.placements) {
    const q = beforePlacements.get(p.bookId);
    if (!q || q.shelfId === p.shelfId) continue;
    const src = input.baselineOf(q.shelfId);
    const dst = input.baselineOf(p.shelfId);
    if (src === undefined || dst === undefined) continue;
    const pose = input.poseOf(q.shelfId, p.bookId);
    if (!pose) continue;
    const dy = (dst - src) / input.scale;
    (arrivals[p.shelfId] ??= {})[p.bookId] = { ...pose, t: { ...pose.t, y: pose.t.y + dy } };
    leaving.push({ id: p.bookId, from: q.shelfId });
    transit.set(p.bookId, now + input.transitMs);
  }
  return { layout, arrivals, leaving, transit, falling };
}

export function nextTransitionExpiry(state: ShelfTransitions): number | undefined {
  let next = Infinity;
  for (const until of state.transit.values()) next = Math.min(next, until);
  for (const fall of state.falling.values()) next = Math.min(next, fall.until);
  return next === Infinity ? undefined : next;
}
