// 보기 설정(책 배치와 따로 저장): 내려다보는 각. 화면 카메라(HomeScreen camSV)가 이 값을 따른다(배치·줄 간격은 읽지 않는다).
import { useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';

import { clampPitch, VIEW_PITCH_MIN } from '@/domain/camera';

import { VIEW_SETTINGS_KEY } from './view-settings-key';

const KEY = VIEW_SETTINGS_KEY;
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
      if (saved?.pitch !== undefined) set({ pitch: clampPitch(saved.pitch) });
    } catch {
      // 읽기 실패: 기본 시점
    }
    set({ loaded: true });
  },
  setPitch(deg: number) {
    const pitch = clampPitch(deg);
    set({ pitch });
    void Storage.setItem(KEY, JSON.stringify({ pitch })).catch(() => {});
  },
};

export function useViewStore() {
  return useSyncExternalStore(viewStore.subscribe, viewStore.get);
}
