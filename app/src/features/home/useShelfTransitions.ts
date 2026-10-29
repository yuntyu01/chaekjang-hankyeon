import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FallDirections } from '@/domain/shelf-scene';
import { DROP_MS } from '@/domain/transition';
import type { ShelfLayout } from '@/domain/types';
import { ANIM } from '@/ui/perf';
import { displayedPoses, PULL_MS, WAIT_MAX, type Drops } from '@/ui/shelf/planner';
import type { SceneMotion } from '@/ui/shelf/scene';
import type { RowGeom } from '@/ui/shelf/metrics';
import type { RowHolds } from './row-holds';
import { advanceShelfTransitions, initialShelfTransitions, nextTransitionExpiry } from './shelf-transitions';

type Options = {
  shown: ShelfLayout;
  scale: number;
  rowOf: ReadonlyMap<string, RowGeom>;
  motions: SceneMotion[];
  reduceMotion: boolean;
  dragActive: boolean;
  dragMembers: readonly string[];
  fallDirections: FallDirections;
  fallIds: readonly string[];
  holds: RowHolds;
  editing: boolean;
  editId: string | null;
  popId: string | null;
};

// Owns only display continuity (arrivals, fading falls and transit residency).
// Layout commands and gesture state belong to their respective controllers.
export function useShelfTransitions(options: Options) {
  const { shown, holds, dragMembers, editing, editId, popId } = options;
  const committed = useRef(initialShelfTransitions(shown));
  const [expiryTick, setExpiryTick] = useState(0);
  const next = useMemo(() => {
    const poses = new Map<string, ReturnType<typeof displayedPoses>>();
    return advanceShelfTransitions(committed.current, {
      layout: shown,
      now: Date.now(),
      transitMs: WAIT_MAX + PULL_MS * ANIM.slow + 400,
      fallMs: DROP_MS * ANIM.slow * 1.5 + 300,
      scale: options.scale,
      baselineOf: (id) => options.rowOf.get(id)?.baseline,
      poseOf: (shelfId, bookId) => {
        if (!poses.has(shelfId)) {
          const motion = options.motions.find((entry) => entry.shelfId === shelfId);
          poses.set(shelfId, motion ? displayedPoses(motion.m) : {});
        }
        return poses.get(shelfId)?.[bookId];
      },
      fallDirections: options.fallDirections,
      fallIds: options.fallIds,
      dragActive: options.dragActive,
      reduceMotion: options.reduceMotion,
    });
    // Capture displayed poses only when the layout changes. Reading the current
    // animation on unrelated renders would restart the same transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, expiryTick]);
  useLayoutEffect(() => { committed.current = next; }, [next]);
  useEffect(() => {
    const until = nextTransitionExpiry(next);
    if (until === undefined) return;
    const timer = setTimeout(() => setExpiryTick((tick) => tick + 1), Math.max(50, until - Date.now()));
    return () => clearTimeout(timer);
  }, [next]);

  const leaving = useMemo(() => next.leaving.filter((move) => !holds[move.id]?.includes(move.from)), [next.leaving, holds]);
  const transitIds = useMemo(() => {
    const ids = new Set([...next.transit.keys(), ...dragMembers, ...Object.keys(holds)]);
    if (editing && editId) ids.add(editId);
    if (popId) ids.add(popId);
    return [...ids].sort();
  }, [next.transit, dragMembers, holds, editing, editId, popId]);
  const drops = useMemo(() => {
    const result: Record<string, Drops> = {};
    for (const [id, drop] of next.falling) (result[drop.shelfId] ??= {})[id] = { from: drop.from, d: drop.d };
    return result;
  }, [next.falling]);
  return { arrivals: next.arrivals, leaving, transitIds, drops };
}
