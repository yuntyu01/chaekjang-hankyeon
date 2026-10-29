import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { SharedValue } from 'react-native-reanimated';
import type { Drag } from './shelf-interaction';
import { warmSV } from '@/ui/shelf/scene';

type Options = {
  dragRef: RefObject<Drag | null>;
  active: SharedValue<boolean>;
  cancelPreview: () => void;
  setAutoScroll: (active: boolean) => void;
  releaseLater: (ids: string[]) => void;
  updateDrag: (drag: Drag | null) => void;
  onStop: () => void;
};
export function useShelfDragLifecycle(options: Options) {
  const current = useRef(options);
  current.current = options;
  const mounted = useRef(true);
  const lastDragEnd = useRef(0);
  const stop = useCallback((render: boolean) => {
    const o = current.current;
    const drag = o.dragRef.current;
    o.active.value = false;
    o.cancelPreview();
    o.setAutoScroll(false);
    warmSV.value = null;
    if (!drag) return;
    lastDragEnd.current = Date.now();
    if (render) {
      o.releaseLater(drag.members);
      o.updateDrag(null);
      o.onStop();
    } else o.dragRef.current = null;
  }, []);
  const finishDrag = useCallback(() => stop(mounted.current), [stop]);
  useFocusEffect(useCallback(() => () => { if (mounted.current) stop(true); }, [stop]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && mounted.current) stop(true);
    });
    return () => sub.remove();
  }, [stop]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(false); };
  }, [stop]);
  return { finishDrag, lastDragEnd };
}
