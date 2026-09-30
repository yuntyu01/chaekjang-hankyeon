// 진행 중 독서(타이머). 화면·애니메이션과 분리된 시간 기록: 시각(벽시계)만 저장하고 경과는 계산한다.
// - 읽은 시간은 쌓이는 방식(accumulatedMs + 지금 달리는 구간). 일시정지 시간은 빠진다.
// - 소리만 듣기는 독서 시간으로 기록하지 않는다(여기에 세션을 만들지 않는다. 소리 재생은 audio 쪽이 따로).
// - 달리는 동안 몇 초마다 '살아 있음'(lastBeat)을 저장한다. 앱이 강제로 꺼졌다 다시 켜지면(달리는 상태로 남아 있으면)
//   꺼져 있던 시간을 독서로 확정하지 않고, 마지막 확인 시각까지만 세어 '이어 읽기' 또는 '그때 끝내기'를 고르게 한다.
// - 앱이 백그라운드로 가도(화면을 끄고 종이책을 읽는 경우) 프로세스가 살아 있으면 계속 센다.
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import Storage from 'expo-sqlite/kv-store';

import { newId } from '@/domain/library';

export type Active = {
  id: string;
  myBookId?: string;
  startedAt: string; // ISO, 처음 시작
  accumulatedMs: number; // 끝난 달린 구간 합
  runningSince: number | null; // 지금 달리는 구간 시작(ms). null이면 일시정지
  lastBeat: number; // 달리는 동안 마지막으로 앱이 살아 있던 시각(ms)
};

// 강제 종료 뒤 복구: 마지막 확인 시각까지 센 시간과 꺼져 있던 시간
export type Interrupted = { active: Active; countedMs: number; lastBeat: number; gapMs: number };

const KEY = 'active-reading:v1';
const BEAT_MS = 5000;

// 끝낸 뒤 종료 화면이 저장·버리기를 정할 값(메모리에만: 종료 화면을 나가면 사라진다)
export type FinishDraft = { myBookId?: string; startedAt: string; endedAt: string; durationMs: number };

type State = { active: Active | null; interrupted: Interrupted | null; pending: FinishDraft | null; loaded: boolean };
let state: State = { active: null, interrupted: null, pending: null, loaded: false };
const listeners = new Set<() => void>();
let beat: ReturnType<typeof setInterval> | null = null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function save() {
  const a = state.active;
  void (a ? Storage.setItem(KEY, JSON.stringify(a)) : Storage.removeItem(KEY)).catch(() => {});
}

function tick() {
  const a = state.active;
  if (!a?.runningSince) return;
  state = { ...state, active: { ...a, lastBeat: Date.now() } };
  save(); // 화면은 다시 그리지 않는다(경과는 화면이 스스로 계산)
}

function startBeat() {
  if (!beat) beat = setInterval(tick, BEAT_MS);
}
function stopBeat() {
  if (beat) clearInterval(beat);
  beat = null;
}

AppState.addEventListener('change', (s) => {
  if (s !== 'active') tick(); // 백그라운드로 갈 때 마지막 확인 시각을 남긴다
});

export const elapsedMs = (a: Active, now = Date.now()) => a.accumulatedMs + (a.runningSince ? Math.max(0, now - a.runningSince) : 0);

export const readingStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  async load() {
    try {
      const raw = await Storage.getItem(KEY);
      const a = raw ? (JSON.parse(raw) as Active) : null;
      if (a && a.runningSince) {
        // 달리는 상태로 남아 있다 = 앱이 꺼졌다. 마지막 확인 시각까지만 센다.
        const lastBeat = Math.max(a.runningSince, a.lastBeat);
        const countedMs = a.accumulatedMs + (lastBeat - a.runningSince);
        const paused: Active = { ...a, accumulatedMs: countedMs, runningSince: null };
        set({ active: paused, interrupted: { active: paused, countedMs, lastBeat, gapMs: Date.now() - lastBeat }, loaded: true });
        save();
        return;
      }
      set({ active: a, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  start(myBookId?: string) {
    const t = Date.now();
    set({ active: { id: newId('act'), myBookId, startedAt: new Date(t).toISOString(), accumulatedMs: 0, runningSince: t, lastBeat: t }, interrupted: null });
    save();
    startBeat();
  },
  pause() {
    const a = state.active;
    if (!a?.runningSince) return;
    const t = Date.now();
    set({ active: { ...a, accumulatedMs: elapsedMs(a, t), runningSince: null, lastBeat: t } });
    save();
    stopBeat();
  },
  resume() {
    const a = state.active;
    if (!a || a.runningSince) return;
    const t = Date.now();
    set({ active: { ...a, runningSince: t, lastBeat: t }, interrupted: null });
    save();
    startBeat();
  },
  setBook(myBookId?: string) {
    const a = state.active;
    if (!a) return;
    set({ active: { ...a, myBookId } });
    save();
  },
  // 복구 창에서 고른 뒤 닫기(이어 읽기는 resume, 끝내기는 finish)
  dismissInterrupted() {
    set({ interrupted: null });
  },
  // 끝내기: 기록할 값을 돌려주고 진행 중 상태를 지운다(저장·버리기는 종료 화면이 정한다)
  finish(endAt?: number) {
    const a = state.active;
    if (!a) return null;
    const t = endAt ?? Date.now();
    const durationMs = a.runningSince ? a.accumulatedMs + Math.max(0, t - a.runningSince) : a.accumulatedMs;
    const endedAt = new Date(a.runningSince ? t : Math.max(a.lastBeat, Date.parse(a.startedAt))).toISOString();
    stopBeat();
    const pending: FinishDraft = { myBookId: a.myBookId, startedAt: a.startedAt, endedAt, durationMs };
    set({ active: null, interrupted: null, pending });
    save();
    return pending;
  },
  setPendingBook(myBookId?: string) {
    if (state.pending) set({ pending: { ...state.pending, myBookId } });
  },
  clearPending() {
    set({ pending: null });
  },
};

export function useReading() {
  return useSyncExternalStore(readingStore.subscribe, readingStore.get);
}
