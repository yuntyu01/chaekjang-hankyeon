import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ANIM } from '@/ui/perf';
import { PULL_MS, WAIT_MAX } from '@/ui/shelf/planner';
import { createRowHolds } from './row-holds';

export function useRowHolds(getBusyIds: () => readonly string[]) {
  const busyRef = useRef(getBusyIds);
  busyRef.current = getBusyIds;
  const [owner] = useState(() => createRowHolds(() => busyRef.current(), () => WAIT_MAX + PULL_MS * ANIM.slow + 600));
  const holds = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  // Consumers handling several pointer events before React commits need the
  // owner's current snapshot, rather than a ref to the previous render.
  const [holdsRef] = useState(() => ({ get current() { return owner.getSnapshot(); } }));
  useLayoutEffect(() => () => owner.cancelTimers(), [owner]);
  return { holds, holdsRef, holdRows: owner.holdRows, releaseLater: owner.releaseLater };
}
