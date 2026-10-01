// 줄의 경로 계획(JS 스레드). 배치가 바뀌면 "지금 보이는 자세"에서 새 배치로 가는 경로를 짜서 줄의 트랙으로 넘긴다.
// - 지금 보이는 자세는 JS 쪽 사본(트랙 + 시작 시각·길이)으로 계산한다(UI 값을 거꾸로 읽지 않는다).
// - 여러 줄의 트랙 바꾸기는 한 번에 UI로 보낸다: 다른 줄로 옮겨 가는 책이 한 프레임이라도 두 권이거나 비어 보이지 않게.
// - 다른 줄에서 들어오는 책은 그 줄에서 보이던 자세(이 줄 좌표로 옮긴 것)에서 이어서 들어온다(순간 이동 없음).
//   이런 배치는 도착 줄 캔버스에 그 책이 올라간 뒤에 적용한다(그동안 이동 캔버스가 제자리의 책을 그린다, ShelfScene).
import { useLayoutEffect } from 'react';
import { Easing, makeMutable, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { fromPlaced, type Book3 } from '@/domain/book3';
import { PLANK_BOUNDS, type BookFrame } from '@/domain/shelf-scene';
import { bookAt, holdTrack, planTransition } from '@/domain/transition';
import { ANIM } from '@/ui/perf';

import { presentSV, type Motion, type Tracks } from './scene';

export const MOTION_MS = 230; // 기울이기·밀림·끌기 미리보기
export const POSE_MS = 420; // 자세 바꾸기(표지로·눕히기)
export const PULL_MS = 560; // 앞으로 빼서 옮기기(다른 줄로, 막혀서 돌아가기)

// ---------- JS 쪽 사본 ----------
// target: 트랙이 향하는 배치(프레임 키). 같은 배치로 다시 짜지 않고, 조작이 끝나면 확정 배치로 맞췄는지 여기로 안다.
// ease: 멈춰 있다가 떠나면 천천히 출발(inOut), 가는 도중 목표가 바뀌면 지금 속도를 잃지 않게 바로 출발(out).
// start: UI에서 실제로 움직이기 시작한 시각(적용을 미뤘으면 적용될 때까지 Infinity = 아직 출발 전).
type Ease = 'inOut' | 'out';
type Mirror = { tracks: Tracks; start: number; dur: number; ease: Ease; target: string | null; key: number };
const mirrors = new WeakMap<Motion, Mirror>();

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

export function mirrorOf(m: Motion): Mirror {
  let mr = mirrors.get(m);
  if (!mr) {
    mr = { tracks: m.tracks.value, start: 0, dur: 0, ease: 'inOut', target: null, key: 0 };
    mirrors.set(m, mr);
  }
  return mr;
}

function progress(mr: Mirror) {
  if (!mr.dur) return 1;
  const u = Math.max(0, Math.min(1, (Date.now() - mr.start) / mr.dur));
  return mr.ease === 'out' ? easeOutCubic(u) : easeInOutCubic(u);
}

const moving = (mr: Mirror) => !!mr.dur && Date.now() - mr.start < mr.dur;

// 지금 화면에 보이는 자세(JS 계산). 조작을 시작하거나 경로를 다시 짤 때의 출발점.
export function displayedPoses(m: Motion): Record<string, Book3> {
  const mr = mirrorOf(m);
  const t = progress(mr);
  const out: Record<string, Book3> = {};
  for (const [id, tr] of Object.entries(mr.tracks)) out[id] = bookAt(tr, t);
  return out;
}

// ---------- 한 번에 UI로 ----------
// 여러 줄의 트랙 바꾸기는 한 번에 UI로 보낸다. 다른 줄로 옮겨 가는 책이 있으면(waits) 도착한 줄 캔버스에 그 책이 올라갈 때까지
// 적용을 미룬다: 캔버스에 책을 올리는 일(React 반영과 캔버스 다시 기록)은 JS에서 늦게 끝나고 그동안 UI가 멈출 수 있어,
// 먼저 움직이기 시작하면 이동 경로가 멈춘 사이에 지나가 버린다(순간 이동처럼 보임). 그동안 책은 제자리에 있다(이동 캔버스가 그린다).
type Apply = { m: Motion; shelfId: string; rec: Tracks; animate: boolean; dur: number; out: boolean; key: number };
export type Wait = { id: string; shelfId: string };
type Pending = { list: Apply[]; waits: Wait[]; since: number };
let batch: Apply[] = [];
let batchWaits: Wait[] = [];
let nextKey = 1;
const byKey = new Map<number, Motion>();
const pendingSV = makeMutable<Pending | null>(null);
const WAIT_MAX = 1200; // 이만큼 기다려도 올라가지 않으면 그냥 움직인다(ms)

export function queueApply(m: Motion, shelfId: string, rec: Tracks, animate: boolean, dur: number, target: string | null, waits: Wait[] = []) {
  const mr = mirrorOf(m);
  const out = animate && moving(mr);
  const key = nextKey++;
  mr.tracks = rec;
  mr.start = Date.now();
  mr.dur = animate ? dur : 0;
  mr.ease = out ? 'out' : 'inOut';
  mr.target = target;
  mr.key = key;
  byKey.set(key, m);
  batch = batch.filter((a) => a.shelfId !== shelfId);
  batch.push({ m, shelfId, rec, animate, dur, out, key });
  batchWaits.push(...waits);
}

// UI에서 실제로 적용한 시각을 JS 사본에 맞춘다
function applied(keys: number[], at: number) {
  for (const k of keys) {
    const m = byKey.get(k);
    byKey.delete(k);
    if (!m) continue;
    const mr = mirrorOf(m);
    if (mr.key === k) mr.start = at;
  }
}

function applyNow(list: Apply[]) {
  'worklet';
  for (const a of list) {
    a.m.tracks.value = a.rec;
    a.m.t.value = a.animate ? 0 : 1;
    if (a.animate) a.m.t.value = withTiming(1, { duration: a.dur, easing: a.out ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic) });
  }
  scheduleOnRN(
    applied,
    list.map((a) => a.key),
    Date.now(),
  );
}

// 미뤄 둔 적용: 기다리는 책이 모두 도착한 줄 캔버스에 올라갔으면(또는 너무 오래 기다렸으면) 적용한다.
// 줄 캔버스의 책이 올라갈 때마다(ShelfMotion RowBook) 부른다.
export function tryApplyPending(force = false) {
  'worklet';
  const p = pendingSV.value;
  if (!p) return;
  let ready = true;
  for (const w of p.waits) if (presentSV.value[w.id] !== w.shelfId) ready = false;
  if (!ready && !force && Date.now() - p.since < WAIT_MAX) return;
  pendingSV.value = null;
  applyNow(p.list);
}

export function flushApply() {
  if (!batch.length) return;
  const list = batch;
  const waits = batchWaits;
  batch = [];
  batchWaits = [];
  // 미루는 적용은 UI에서 적용될 때까지 출발 전으로 둔다
  if (waits.length) for (const a of list) if (mirrorOf(a.m).key === a.key) mirrorOf(a.m).start = Infinity;
  scheduleOnUI(() => {
    'worklet';
    const p = pendingSV.value;
    if (!p && !waits.length) {
      applyNow(list);
      return;
    }
    // 미뤄 둔 것이 있으면 합친다(같은 줄은 새것이 이긴다). 기다림은 새 배치의 것(가장 최근 배치의 도착)
    const merged: Apply[] = [];
    if (p) for (const a of p.list) if (!list.some((b) => b.shelfId === a.shelfId)) merged.push(a);
    for (const a of list) merged.push(a);
    pendingSV.value = { list: merged, waits: waits.length ? waits : p ? p.waits : [], since: p ? p.since : Date.now() };
    tryApplyPending();
  });
  if (waits.length)
    setTimeout(() => {
      scheduleOnUI(() => {
        'worklet';
        tryApplyPending(true);
      });
    }, WAIT_MAX + 50);
}

// ---------- 계획 ----------
export type PlanStats = { strategy: string; ms: number; log: number[] | null };
// 측정 번들: log가 배열이면 계획마다 걸린 시간(ms)을 쌓는다
export const lastPlan: PlanStats = { strategy: '', ms: 0, log: null };

// 목표 자세(next)로 가는 경로를 짜서 줄에 넣는다. arrive: 다른 줄에서 들어오는 책의 지금 자세(이 줄 좌표).
// budgetMs: 경로 검사에 쓸 시간(넘기면 앞으로 빼서 옮기는 경로). 끌기처럼 자주 바뀌면 짧게.
export function planInto(m: Motion, shelfId: string, next: Book3[], target: string, opts: { reduceMotion: boolean; arrive?: Record<string, Book3>; budgetMs?: number }) {
  // 다른 줄에서 들어오는 책은 이 줄 캔버스에 올라간 뒤에 움직인다
  const waits: Wait[] = next.filter((b) => opts.arrive?.[b.id]).map((b) => ({ id: b.id, shelfId }));
  if (opts.reduceMotion) {
    queueApply(m, shelfId, Object.fromEntries(next.map((b) => [b.id, holdTrack(b)])), false, 0, target, waits);
    return;
  }
  const t0 = Date.now();
  const prev = Object.values(displayedPoses(m));
  const plan = planTransition(prev, next, PLANK_BOUNDS, { budgetMs: opts.budgetMs, arrive: opts.arrive });
  lastPlan.strategy = plan.strategy;
  lastPlan.ms = Date.now() - t0;
  lastPlan.log?.push(lastPlan.ms);
  const animate = plan.strategy !== 'still';
  const pull = plan.strategy === 'pull' || (!!opts.arrive && next.some((b) => opts.arrive![b.id]));
  const posing = /al|pull/.test(plan.strategy);
  const dur = (pull ? PULL_MS : posing ? POSE_MS : MOTION_MS) * ANIM.slow;
  queueApply(m, shelfId, Object.fromEntries(plan.tracks.map((tr) => [tr.id, tr])), animate, dur, target, waits);
}

const keyOf = (frames: BookFrame[]) => frames.map((f) => f.bookId + JSON.stringify(f.box)).join('|');

// 줄 하나: 프레임(확정 또는 미리보기 배치의 3D 상자)이 바뀌었고 트랙이 향하는 배치와 다르면 경로를 짠다.
// 트랙 적용은 HomeScreen이 모아서 한 번에(flushApply). 막대·손잡이 조작 중에는 확정 배치가 그대로라 여기서 끼어들지 않는다.
export function useRowPlanner(m: Motion, shelfId: string, frames: BookFrame[], reduceMotion: boolean, arrive: Record<string, Book3> | undefined, budgetMs: number) {
  const key = keyOf(frames);
  useLayoutEffect(() => {
    const mr = mirrorOf(m);
    // 처음: 줄을 만들 때 넣은 트랙 그대로(저장본을 불러와 처음 그릴 때 날아오지 않게)
    if (mr.target === null) mr.target = key;
    if (key === mr.target) return;
    planInto(m, shelfId, frames.map((f) => fromPlaced(f.box)), key, { reduceMotion, arrive, budgetMs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduceMotion]);
}

// 조작 중 미리보기(손잡이·앞뒤·돌리기 막대): React를 거치지 않고 이 줄의 경로만 바로 바꾼다.
// 멈춘 곳에서 조금씩 바뀌면 그대로 따라가고(짧은 이어 주기), 자세가 크게 바뀌면(벽에 기대기·떼기) 경로를 짠다.
export function previewInto(m: Motion, shelfId: string, frames: BookFrame[], reduceMotion: boolean) {
  const next = frames.map((f) => fromPlaced(f.box));
  const key = keyOf(frames);
  const now = displayedPoses(m);
  const jump = next.some((b) => {
    const a = now[b.id];
    return !!a && (Math.abs((a.pitch ?? 0) - (b.pitch ?? 0)) > 2 || Math.abs(a.roll - b.roll) > 2 || Math.abs(a.yaw - b.yaw) > 2);
  });
  if (jump && !reduceMotion) planInto(m, shelfId, next, key, { reduceMotion, budgetMs: 24 });
  else queueApply(m, shelfId, Object.fromEntries(next.map((b) => [b.id, holdTrack(b)])), false, 0, key);
  flushApply();
}

// 조작이 끝났을 때: 확정된(또는 되돌린) 배치로 경로를 짜서 맞춘다(미리보기 자세가 남지 않게). 이미 그 배치면 그대로.
export function settleInto(m: Motion, shelfId: string, frames: BookFrame[], reduceMotion: boolean) {
  const key = keyOf(frames);
  if (mirrorOf(m).target === key) return;
  planInto(m, shelfId, frames.map((f) => fromPlaced(f.box)), key, { reduceMotion, budgetMs: 60 });
  flushApply();
}
