// 환경음(ASMR) 재생. 독서 타이머와 따로 움직인다(소리만 들어도 독서 시간은 쌓이지 않는다).
// 음원(assets/sounds)은 Freesound 녹음을 모노 22kHz로 줄이고 이음매를 섞은 반복용 WAV(출처는 assets/sounds/provenance.json).
// 실제 재생 여부는 플레이어 상태(playing)로만 표시한다.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { settingsStore, type SceneId } from '@/store/settings-store';

export const SCENES: { id: SceneId; name: string; sound: string; source: number }[] = [
  { id: 'rain', name: '밤의 창가', sound: '빗소리', source: require('../../assets/sounds/rain.wav') },
  { id: 'fire', name: '벽난로', sound: '장작 타는 소리', source: require('../../assets/sounds/fire.wav') },
];
export const TEMP_ASSETS = false; // 최종 음원·장면이 들어오면 false

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

// 실제 출력 음량 = 음소거면 0, 아니면 설정 음량. 플레이어의 muted 속성은 쓰지 않는다:
// expo-audio(Android)의 muted 설정은 비동기로 반영되는 previousVolume을 바로 읽어서, volume 다음에 muted를 넣으면
// 방금 넣은 음량 대신 그 전 음량으로 되돌아간다(2026-11 에뮬: 화면 60%인데 출력 0dB=100%). 음소거 전 음량은 설정(settings.volume)이 지킨다
export const outputVolume = (s: { volume: number; muted: boolean }) => (s.muted ? 0 : Math.min(1, Math.max(0, s.volume)));
function applyVolume() {
  if (!player) return;
  player.volume = outputVolume(settingsStore.get());
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
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: Platform.OS === 'android' ? 'doNotMix' : 'mixWithOthers' });
        modeSet = true;
      }
      if (state.scene !== scene || !player) {
        // 이전 장면 소리를 먼저 멈춘다(remove만 하면 네이티브 플레이어가 바로 서지 않아 두 소리가 겹친다, 2026-11 에뮬 확인)
        player?.pause();
        player?.setActiveForLockScreen(false);
        sub?.remove();
        player?.remove();
        const src = SCENES.find((x) => x.id === scene)!.source;
        player = createAudioPlayer(src);
        player.loop = true;
        if (Platform.OS === 'android') player.setActiveForLockScreen(true, { title: SCENES.find(x => x.id === scene)?.sound ?? '환경음', artist: '책장 한켠' });
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
  // 소리 크기 슬라이더를 끄는 동안: 저장하지 않고 지금 나는 소리에만 바로 반영(손을 떼면 설정에 저장 → applyVolume)
  preview(volume: number) {
    if (!player) return;
    player.volume = outputVolume({ volume, muted: false });
  },
  stop() {
    player?.pause();
    player?.setActiveForLockScreen(false);
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
