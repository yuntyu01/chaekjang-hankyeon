// 환경음(ASMR) 재생. 독서 타이머와 따로 움직인다(소리만 들어도 독서 시간은 쌓이지 않는다).
// 지금 음원은 교체용 임시 합성음(assets/sounds). 실제 재생 여부는 플레이어 상태(playing)로만 표시한다.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useSyncExternalStore } from 'react';

import { settingsStore, type SceneId } from '@/store/settings-store';

export const SCENES: { id: SceneId; name: string; sound: string; source: number }[] = [
  { id: 'rain', name: '밤의 창가', sound: '빗소리', source: require('../../assets/sounds/rain.wav') },
  { id: 'fire', name: '벽난로', sound: '장작 타는 소리', source: require('../../assets/sounds/fire.wav') },
  { id: 'room', name: '조용한 방', sound: '생활 소리', source: require('../../assets/sounds/room.wav') },
];
export const TEMP_ASSETS = true; // 최종 음원·장면이 들어오면 false

type State = { scene: SceneId | null; playing: boolean; error: string | null };
let state: State = { scene: null, playing: false, error: null };
const listeners = new Set<() => void>();
let player: AudioPlayer | null = null;
let sub: { remove: () => void } | null = null;
let modeSet = false;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function applyVolume() {
  if (!player) return;
  const s = settingsStore.get();
  player.volume = s.volume;
  player.muted = s.muted;
}
settingsStore.subscribe(applyVolume);

export const ambient = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  async play(scene: SceneId) {
    try {
      if (!modeSet) {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'mixWithOthers' });
        modeSet = true;
      }
      if (state.scene !== scene || !player) {
        sub?.remove();
        player?.remove();
        const src = SCENES.find((x) => x.id === scene)!.source;
        player = createAudioPlayer(src);
        player.loop = true;
        sub = player.addListener('playbackStatusUpdate', (st) => {
          if (st.playing !== state.playing) set({ playing: st.playing });
        });
        set({ scene });
      }
      applyVolume();
      player.play();
      set({ error: null });
    } catch (e) {
      set({ error: `소리를 재생하지 못했어요. ${String((e as Error)?.message ?? e)}`, playing: false });
    }
  },
  pause() {
    player?.pause();
  },
  stop() {
    player?.pause();
    sub?.remove();
    player?.remove();
    sub = null;
    player = null;
    set({ scene: null, playing: false });
  },
};

export function useAmbient() {
  return useSyncExternalStore(ambient.subscribe, ambient.get);
}
