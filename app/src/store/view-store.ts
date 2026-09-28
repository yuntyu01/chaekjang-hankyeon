// 보기 설정(책 배치와 따로 저장): 내려다보는 각.
import { useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';

import { setViewPitch, VIEW_PITCH_MIN } from '@/domain/geometry';

const KEY = 'view-settings:v1';
type State = { pitch: number; loaded: boolean };
let state: State = { pitch: VIEW_PITCH_MIN, loaded: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const viewStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  async load() {
    try {
      const raw = await Storage.getItem(KEY);
      const saved = raw ? (JSON.parse(raw) as { pitch?: number }) : null;
      if (saved?.pitch !== undefined) set({ pitch: setViewPitch(saved.pitch) });
    } catch {
      // 읽기 실패: 기본 시점
    }
    set({ loaded: true });
  },
  setPitch(deg: number) {
    const pitch = setViewPitch(deg);
    set({ pitch });
    void Storage.setItem(KEY, JSON.stringify({ pitch })).catch(() => {});
  },
};

export function useViewStore() {
  return useSyncExternalStore(viewStore.subscribe, viewStore.get);
}
