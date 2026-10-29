import { useLayoutEffect, useState } from 'react';

export function createScreenTasks() {
  let mounted = true;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancel = (key: string) => {
    const timer = timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(key);
  };
  return {
    active: () => mounted,
    mount: () => { mounted = true; },
    cancel,
    later(key: string, run: () => void, delay: number) {
      cancel(key);
      if (!mounted) return;
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        if (mounted) run();
      }, delay));
    },
    dispose() {
      mounted = false;
      for (const key of timers.keys()) cancel(key);
    },
  };
}
export function useScreenTasks() {
  const [tasks] = useState(createScreenTasks);
  useLayoutEffect(() => { tasks.mount(); return () => tasks.dispose(); }, [tasks]);
  return tasks;
}
