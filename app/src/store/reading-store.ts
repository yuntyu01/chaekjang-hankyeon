// 진행 중 독서(타이머). 화면·애니메이션과 분리된 시간 기록: 시각(벽시계)만 저장하고 경과는 계산한다.
// - 읽은 시간은 쌓이는 방식(accumulatedMs + 지금 달리는 구간). 일시정지 시간은 빠진다.
// - 소리만 듣기는 독서 시간으로 기록하지 않는다(여기에 세션을 만들지 않는다. 소리 재생은 audio 쪽이 따로).
//
// 강제 종료 복구 기준(앱이 꺼진 정확한 시각은 알 수 없다고 본다):
// - 달리는 동안 5초마다, 그리고 백그라운드로 갈 때 '마지막 확인 시각'(lastBeat)을 저장한다.
// - 다시 켰을 때 달리는 상태로 남아 있으면 앱이 꺼진 것이다. 센 시간 = 누적 + (마지막 확인 시각 − 이번 구간 시작).
//   마지막 확인 뒤 ~ 다시 켠 때(꺼져 있던 시간 포함)는 넣지 않는다(최대 5초 + 백그라운드에서 타이머가 멈춘 동안은 덜 셀 수 있다).
//   그 값으로 일시정지 상태로 바꿔 저장하고(interruptedAt = 마지막 확인 시각) 사용자가 고를 때까지 표시를 유지한다.
//   고르기 전에 또 꺼져도 달리는 구간이 없으므로 다시 더해지지 않는다.
// - 일시정지 중에 꺼지면 누적 시간 그대로 일시정지로 돌아온다(복구 창 없음).
// - 끝내기: 기록할 값(초안)을 저장소에도 남긴다. 저장·버리기 전에 꺼지면 다음 실행에서 다시 확인하게 한다.
//   저장은 이 타이머의 id로 하므로 두 번 눌러도 같은 기록 하나만 남는다.
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
  lastBeat: number; // 마지막으로 앱이 살아 있음을 저장한 시각(ms)
  interruptedAt?: number; // 강제 종료에서 복구했고 아직 고르지 않았다(= 그때의 마지막 확인 시각)
};

// 강제 종료 뒤 복구: 마지막 확인 시각까지 센 시간과 그 뒤 지난 시간
export type Interrupted = { active: Active; countedMs: number; lastBeat: number; gapMs: number };

// 끝낸 뒤 종료 화면이 저장·버리기를 정할 값(id = 타이머 id = 저장할 세션 id)
export type FinishDraft = { id: string; myBookId?: string; startedAt: string; endedAt: string; durationMs: number };

const KEY = 'active-reading:v1';
const PENDING_KEY = 'finished-reading:v1';
const BEAT_MS = 5000;

// ---------- 순수 규칙(테스트 대상) ----------

export const elapsedMs = (a: Active, now = Date.now()) => a.accumulatedMs + (a.runningSince !== null ? Math.max(0, now - a.runningSince) : 0);

// 저장본을 다시 읽을 때
export function recoverOnLoad(saved: Active | null, now: number): { active: Active | null; interrupted: Interrupted | null } {
  if (!saved) return { active: null, interrupted: null };
  if (saved.runningSince !== null && saved.runningSince !== undefined) {
    const lastBeat = Math.max(saved.runningSince, saved.lastBeat);
    const countedMs = saved.accumulatedMs + (lastBeat - saved.runningSince);
    const active: Active = { ...saved, accumulatedMs: countedMs, runningSince: null, lastBeat, interruptedAt: lastBeat };
    return { active, interrupted: { active, countedMs, lastBeat, gapMs: Math.max(0, now - lastBeat) } };
  }
  if (saved.interruptedAt !== undefined) return { active: saved, interrupted: { active: saved, countedMs: saved.accumulatedMs, lastBeat: saved.interruptedAt, gapMs: Math.max(0, now - saved.interruptedAt) } };
  return { active: saved, interrupted: null };
}

// 끝내기: endAt을 주면 그 시각에 끝낸 것으로(달리는 중일 때만 의미가 있다)
export function finishActive(a: Active, now: number, endAt?: number): FinishDraft {
  const t = endAt ?? now;
  const running = a.runningSince !== null;
  const durationMs = running ? a.accumulatedMs + Math.max(0, t - a.runningSince!) : a.accumulatedMs;
  const end = running ? t : (a.interruptedAt ?? Math.max(a.lastBeat, Date.parse(a.startedAt)));
  return { id: a.id, myBookId: a.myBookId, startedAt: a.startedAt, endedAt: new Date(end).toISOString(), durationMs };
}

// ---------- 상태 ----------

type State = { active: Active | null; interrupted: Interrupted | null; pending: FinishDraft | null; pendingRestored: boolean; loaded: boolean };
let state: State = { active: null, interrupted: null, pending: null, pendingRestored: false, loaded: false };
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
function savePending() {
  const p = state.pending;
  void (p ? Storage.setItem(PENDING_KEY, JSON.stringify(p)) : Storage.removeItem(PENDING_KEY)).catch(() => {});
}

function tick() {
  const a = state.active;
  if (!a || a.runningSince === null) return;
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

export const readingStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  async load() {
    try {
      const raw = await Storage.getItem(KEY);
      const r = recoverOnLoad(raw ? (JSON.parse(raw) as Active) : null, Date.now());
      const rawP = await Storage.getItem(PENDING_KEY);
      const pending = rawP ? (JSON.parse(rawP) as FinishDraft) : null;
      set({ active: r.active, interrupted: r.interrupted, pending, pendingRestored: !!pending, loaded: true });
      if (r.interrupted) save();
    } catch {
      set({ loaded: true });
    }
  },

  start(myBookId?: string) {
    const t = Date.now();
    set({ active: { id: newId('ss'), myBookId, startedAt: new Date(t).toISOString(), accumulatedMs: 0, runningSince: t, lastBeat: t }, interrupted: null });
    save();
    startBeat();
  },
  pause() {
    const a = state.active;
    if (!a || a.runningSince === null) return;
    const t = Date.now();
    set({ active: { ...a, accumulatedMs: elapsedMs(a, t), runningSince: null, lastBeat: t } });
    save();
    stopBeat();
  },
  resume() {
    const a = state.active;
    if (!a || a.runningSince !== null) return;
    const t = Date.now();
    set({ active: { ...a, runningSince: t, lastBeat: t, interruptedAt: undefined }, interrupted: null });
    save();
    startBeat();
  },
  setBook(myBookId?: string) {
    const a = state.active;
    if (!a) return;
    set({ active: { ...a, myBookId } });
    save();
  },
  // 복구 창을 닫기(일시정지로 둠. 표시(interruptedAt)는 남겨 다음 실행에서 다시 묻는다)
  dismissInterrupted() {
    set({ interrupted: null });
  },
  // 끝내기: 초안을 만들어 저장하고 진행 중 상태를 지운다(저장·버리기는 종료 화면이 정한다). 두 번 불러도 한 번만.
  finish(endAt?: number) {
    const a = state.active;
    if (!a) return null;
    stopBeat();
    const pending = finishActive(a, Date.now(), endAt);
    set({ active: null, interrupted: null, pending, pendingRestored: false });
    save();
    savePending();
    return pending;
  },
  setPendingBook(myBookId?: string) {
    if (!state.pending) return;
    set({ pending: { ...state.pending, myBookId } });
    savePending();
  },
  clearPending() {
    set({ pending: null, pendingRestored: false });
    savePending();
  },
  ackPendingRestored() {
    set({ pendingRestored: false });
  },
};

export function useReading() {
  return useSyncExternalStore(readingStore.subscribe, readingStore.get);
}
