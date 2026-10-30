// 사용자 설정(기기 로컬). 책장 시점(보기 각)은 view-store가 따로 저장한다.
import { useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';

export type SceneId = 'rain' | 'fire';

export type Settings = {
  sound: boolean; // 효과음
  haptics: boolean; // 진동
  reduceMotion: 'system' | 'on' | 'off'; // 동작 줄이기: 기기 설정을 따르거나 앱에서 켜고 끈다
  goalMin: number | null; // 독서 목표 시간(선택). 없으면 쌓이는 방식만
  scene: SceneId;
  volume: number; // 0~1
  muted: boolean;
};

const KEY = 'app-settings:v1';
export const DEFAULT_SETTINGS: Settings = { sound: true, haptics: true, reduceMotion: 'system', goalMin: null, scene: 'rain', volume: 0.6, muted: false };

// 예전에 있던 장면('room' 등)이 저장·백업에 남아 있으면 빗소리로 돌린다
const fixScene = <T extends Partial<Settings>>(s: T): T => (s.scene === undefined || s.scene === 'rain' || s.scene === 'fire' ? s : { ...s, scene: 'rain' });

let state: Settings & { loaded: boolean } = { ...DEFAULT_SETTINGS, loaded: false };
const listeners = new Set<() => void>();

export const settingsStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  async load() {
    try {
      const raw = await Storage.getItem(KEY);
      if (raw) state = { ...DEFAULT_SETTINGS, ...fixScene(JSON.parse(raw) as Partial<Settings>), loaded: true };
      else state = { ...state, loaded: true };
    } catch {
      state = { ...state, loaded: true };
    }
    listeners.forEach((l) => l());
  },
  set(patch: Partial<Settings>) {
    state = { ...state, ...fixScene(patch) };
    listeners.forEach((l) => l());
    const { loaded: _l, ...save } = state;
    void Storage.setItem(KEY, JSON.stringify(save)).catch(() => {});
  },
  // 백업 복원용
  raw(): Settings {
    const { loaded: _l, ...s } = state;
    return s;
  },
};

export function useSettings() {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
}
