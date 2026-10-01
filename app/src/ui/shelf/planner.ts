// 줄의 경로 계획(JS 스레드). 배치가 바뀌면 "지금 보이는 자세"에서 새 배치로 가는 경로를 짜서 줄의 트랙으로 넘긴다.
// - 지금 보이는 자세는 JS 쪽 사본(트랙 + 시작 시각·길이)으로 계산한다(UI 값을 거꾸로 읽지 않는다).
// - 여러 줄의 트랙 바꾸기는 한 번에 UI로 보낸다: 다른 줄로 옮겨 가는 책이 한 프레임이라도 두 권이거나 비어 보이지 않게.
// - 다른 줄에서 들어오는 책은 그 줄에서 보이던 자세(이 줄 좌표로 옮긴 것)에서 이어서 들어온다(순간 이동 없음).
//   이런 배치는 도착 줄 캔버스에 그 책이 올라간 뒤에 적용한다(그동안 이동 캔버스가 제자리의 책을 그린다, ShelfScene).
// - 다른 줄로 떠나는 책은 원래 줄이 그 책의 실제 경로(원래 줄 좌표, away)로 자기 공간을 벗어날 때까지 계속 그리고, 그동안 이동
//   캔버스가 같은 자세로 위에 겹친다(어느 캔버스가 한 프레임 늦어도 빈 프레임이 없다). 그 책의 그림자도 그 경로를 따라 옅어진다.
import { useLayoutEffect } from 'react';
import { Easing, makeMutable, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { fromPlaced, type Book3 } from '@/domain/book3';
import { PLANK_BOUNDS, type BookFrame } from '@/domain/shelf-scene';
import { awayTrack, bookAt, holdTrack, planTransition } from '@/domain/transition';
import { ANIM, TL, tl, tlOn, tlu } from '@/ui/perf';

import { OUT_SHADE_MAX, outsideDist, outsideRow, presentSV, type Motion, type Tracks } from './scene';

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
// left: 이 줄을 떠나는 책의 떠날 때 자세(이 줄 좌표). away: 다른 줄로 떠난 책의 경로를 이 줄 좌표로 옮긴 것과 그 진행(실제 시간 비율 k까지, dur 동안).
// space: 이 줄 공간 높이(줄 계획에서 온 것만).
type Apply = {
  m: Motion;
  shelfId: string;
  rec: Tracks;
  animate: boolean;
  dur: number;
  out: boolean;
  key: number;
  space?: number;
  left?: Record<string, Book3>;
  away?: { tracks: Tracks; dur: number; k: number; out: boolean };
};
export type Wait = { id: string; shelfId: string };
// 다른 줄에 남겨 둔 떠난 책 경로를 거둔다(그 책이 가는 줄에서 경로를 다시 짰을 때: 남은 경로가 새 경로와 어긋나 두 권으로 보이지 않게)
type Clear = { m: Motion; id: string };
// waited: 도착 줄 캔버스에 책이 올라가기를 실제로 기다렸다(올라간 첫 그림 프레임이 지난 뒤 출발한다)
type Pending = { list: Apply[]; waits: Wait[]; since: number; waited: boolean; clears: Clear[] };
let batch: Apply[] = [];
let batchWaits: Wait[] = [];
let nextKey = 1;
const byKey = new Map<number, Motion>();
const pendingSV = makeMutable<Pending | null>(null);
const WAIT_MAX = 1200; // 이만큼 기다려도 올라가지 않으면 그냥 움직인다(ms)
// 떠난 책 → 그 책의 남은 경로를 둔 줄(JS 쪽 기록)
const awayRows = new Map<string, Motion>();

export function queueApply(m: Motion, shelfId: string, rec: Tracks, animate: boolean, dur: number, target: string | null, waits: Wait[] = [], space?: number) {
  const mr = mirrorOf(m);
  const out = animate && moving(mr);
  const key = nextKey++;
  // 이 줄을 떠나는 책의 지금 자세(같은 묶음에서 이 줄을 다시 짜면 처음 떠날 때 자세를 둔다)
  const now = progress(mr);
  let left: Record<string, Book3> | undefined = batch.find((a) => a.shelfId === shelfId)?.left;
  for (const [id, tr] of Object.entries(mr.tracks)) if (!rec[id] && !left?.[id]) left = { ...(left ?? {}), [id]: bookAt(tr, now) };
  mr.tracks = rec;
  mr.start = Date.now();
  mr.dur = animate ? dur : 0;
  mr.ease = out ? 'out' : 'inOut';
  mr.target = target;
  mr.key = key;
  byKey.set(key, m);
  batch = batch.filter((a) => a.shelfId !== shelfId);
  batch.push({ m, shelfId, rec, animate, dur, out, key, space, left });
  batchWaits.push(...waits);
}

const easeOf = (out: boolean) => (out ? easeOutCubic : easeInOutCubic);

// 다른 줄로 옮겨 가는 책(기다림 = 도착 줄)마다, 같은 묶음에 원래 줄이 있으면 원래 줄에 남는 경로를 붙인다:
// 도착 줄 경로를 원래 줄 좌표로(세로만 다르다), 도착 줄과 같은 시각·같은 감속으로. 원래 줄은 그 책이 자기 공간 안에 있는 동안
// 이 경로로 계속 그리고(이동 캔버스의 첫 그림이 늦어도 빈 프레임이 없게), 그 책이 드리우던 그림자를 이 경로로 옅게 한다.
// 원래 줄 공간 밖 OUT_SHADE_MAX를 넘는 곳(더는 그림도 그림자도 없는 곳)까지만 움직인다(그 뒤로는 그 줄 계산을 다시 돌리지 않게).
// 이어서 이 묶음에서 경로를 다시 짠 책이 다른 줄에 남은 경로를 갖고 있으면 거둔다.
function awaysOf(list: Apply[], waits: Wait[]): Clear[] {
  const fresh = new Set<string>();
  for (const w of waits) {
    const to = list.find((a) => a.shelfId === w.shelfId);
    const from = list.find((a) => a.shelfId !== w.shelfId && a.left?.[w.id]);
    const tr = to?.rec[w.id];
    const space = from?.space;
    if (!to || !from || !tr || space === undefined || !to.animate) continue;
    const a = awayTrack(tr, from.left![w.id], easeOf(to.out), (b) => outsideDist(b, space) > OUT_SHADE_MAX);
    if (!a) continue;
    from.away = { tracks: { ...(from.away?.tracks ?? {}), [w.id]: a.track }, dur: to.dur, k: a.k, out: to.out };
    awayRows.set(w.id, from.m);
    fresh.add(w.id);
  }
  const clears: Clear[] = [];
  for (const [id, m] of awayRows) {
    if (fresh.has(id)) continue;
    // 남은 경로를 둔 줄을 새로 짜면(이 묶음에) 그 줄의 남은 경로는 어차피 비워진다
    if (list.some((a) => a.m === m)) {
      awayRows.delete(id);
      continue;
    }
    if (list.some((a) => a.rec[id])) {
      clears.push({ m, id });
      awayRows.delete(id);
    }
  }
  return clears;
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

// late: 도착 줄 캔버스에 막 올라간 책을 기다린 적용. 새로 올라간 책은 첫 그림을 내는 프레임에 계산이 몰려(파생 값 시작) 그 프레임이
// 길어지므로, 트랙은 바로 넣어 출발 자세에 두고 진행은 그 프레임이 지난 뒤(두 프레임 뒤) 시작한다. 그 사이 더 새 경로가 들어오면 건너뛴다.
// clears: 다른 줄에 남겨 둔 떠난 책 경로를 이 적용과 같은 때 거둔다.
function applyNow(list: Apply[], late = false, clears: Clear[] = []) {
  'worklet';
  if (tlOn.value) tlu(`apply ${list.map((a) => `${a.shelfId}${a.animate ? `:${Math.round(a.dur)}` : ''}${a.away ? '+away' : ''}`).join(',')}${late ? ' late' : ''}${clears.length ? ` clear ${clears.map((c) => c.id).join(',')}` : ''}`);
  for (const a of list) {
    a.m.tracks.value = a.rec;
    a.m.t.value = a.animate ? 0 : 1;
    // 다른 줄로 떠난 책이 이 줄에 남기는 경로(이 줄을 새로 짜면 비운다)
    if (a.away) {
      a.m.away.value = a.away.tracks;
      a.m.awayT.value = 0;
    } else if (Object.keys(a.m.away.value).length) a.m.away.value = {};
  }
  for (const c of clears) {
    const cur = c.m.away.value;
    if (!cur[c.id]) continue;
    const next = { ...cur };
    delete next[c.id];
    c.m.away.value = next;
  }
  const run = () => {
    const keys: number[] = [];
    for (const a of list) {
      if (a.m.tracks.value !== a.rec) continue;
      keys.push(a.key);
      const ease = a.out ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic);
      if (a.animate) a.m.t.value = withTiming(1, { duration: a.dur, easing: ease });
      // 남은 경로는 도착 줄 진행과 같은 시각·같은 감속으로, 더는 그림도 그림자도 없는 곳(k)까지만
      const aw = a.away;
      if (aw) {
        const base = aw.out ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic);
        const k = aw.k;
        const end = base(k);
        a.m.awayT.value = withTiming(end, {
          duration: aw.dur * k,
          easing: (u: number) => {
            'worklet';
            return end > 0 ? base(u * k) / end : 1;
          },
        });
      }
    }
    if (late && tlOn.value) tlu('apply-run');
    scheduleOnRN(applied, keys, Date.now());
  };
  if (!late) run();
  else requestAnimationFrame(() => requestAnimationFrame(run));
}

// 미뤄 둔 적용: 기다리는 책이 모두 도착한 줄 캔버스에 올라갔으면(또는 너무 오래 기다렸으면) 적용한다.
// 줄 캔버스의 책이 올라갈 때마다(ShelfMotion RowBook) 부른다.
export function tryApplyPending(force = false) {
  'worklet';
  const p = pendingSV.value;
  if (!p) return;
  let ready = true;
  for (const w of p.waits) if (!presentSV.value[w.id]?.[w.shelfId]) ready = false;
  if (!ready && !force && Date.now() - p.since < WAIT_MAX) {
    if (!p.waited) pendingSV.value = { ...p, waited: true };
    return;
  }
  if (!ready) tlu('pending-timeout');
  pendingSV.value = null;
  // 실제로 기다린 끝에 막 올라간 책이면 첫 그림 프레임이 지난 뒤 출발한다(이미 올라가 있었으면 바로)
  applyNow(p.list, ready && p.waited, p.clears);
}

export function flushApply() {
  if (!batch.length) return;
  const list = batch;
  const waits = batchWaits;
  batch = [];
  batchWaits = [];
  const clears = awaysOf(list, waits);
  if (TL.on) tl(`flush ${list.map((a) => a.shelfId).join(',')} waits=${waits.map((w) => `${w.id}@${w.shelfId}`).join(',')}`);
  // 미루는 적용은 UI에서 적용될 때까지 출발 전으로 둔다
  if (waits.length) for (const a of list) if (mirrorOf(a.m).key === a.key) mirrorOf(a.m).start = Infinity;
  scheduleOnUI(() => {
    'worklet';
    const p = pendingSV.value;
    if (!p && !waits.length) {
      applyNow(list, false, clears);
      return;
    }
    // 미뤄 둔 것이 있으면 합친다(같은 줄은 새것이 이긴다). 기다림은 새 배치의 것(가장 최근 배치의 도착)
    const merged: Apply[] = [];
    if (p) for (const a of p.list) if (!list.some((b) => b.shelfId === a.shelfId)) merged.push(a);
    for (const a of list) merged.push(a);
    pendingSV.value = { list: merged, waits: waits.length ? waits : p ? p.waits : [], since: p ? p.since : Date.now(), waited: p ? p.waited : false, clears: p ? [...p.clears, ...clears] : clears };
    if (tlOn.value) tlu(`pending ${merged.map((a) => a.shelfId).join(',')}`);
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
// space: 이 줄 공간 높이. 지금 줄 공간 밖에 있는 책(다른 줄에서 넘어오는 중)은 들어오는 책으로 다시 계획한다: 가는 도중 목표가
// 바뀌어(놓는 순간 등) 다시 짜도 판 앞을 지나는 길을 그대로 쓴다(곧장 가면 윗줄 책·판 뒤를 지나 가려지거나 튄다).
export function planInto(m: Motion, shelfId: string, next: Book3[], target: string, opts: { reduceMotion: boolean; arrive?: Record<string, Book3>; budgetMs?: number; space?: number }) {
  // 다른 줄에서 들어오는 책은 이 줄 캔버스에 올라간 뒤에 움직인다
  const waits: Wait[] = next.filter((b) => opts.arrive?.[b.id]).map((b) => ({ id: b.id, shelfId }));
  if (opts.reduceMotion) {
    queueApply(m, shelfId, Object.fromEntries(next.map((b) => [b.id, holdTrack(b)])), false, 0, target, waits, opts.space);
    return;
  }
  const t0 = Date.now();
  const shown = displayedPoses(m);
  let arrive = opts.arrive;
  if (opts.space !== undefined) {
    for (const b of next) {
      const p = shown[b.id];
      if (p && !arrive?.[b.id] && outsideRow(p, opts.space)) arrive = { ...(arrive ?? {}), [b.id]: p };
    }
  }
  const prev = Object.values(shown);
  const plan = planTransition(prev, next, PLANK_BOUNDS, { budgetMs: opts.budgetMs, arrive });
  lastPlan.strategy = plan.strategy;
  lastPlan.ms = Date.now() - t0;
  lastPlan.log?.push(lastPlan.ms);
  if (TL.on) tl(`plan ${shelfId} ${plan.strategy} ${lastPlan.ms}ms waits=${waits.length}${arrive !== opts.arrive ? ' arriving' : ''}`);
  const animate = plan.strategy !== 'still';
  const pull = plan.strategy === 'pull' || (!!arrive && next.some((b) => arrive![b.id]));
  const posing = /al|pull/.test(plan.strategy);
  const dur = (pull ? PULL_MS : posing ? POSE_MS : MOTION_MS) * ANIM.slow;
  queueApply(m, shelfId, Object.fromEntries(plan.tracks.map((tr) => [tr.id, tr])), animate, dur, target, waits, opts.space);
}

const keyOf = (frames: BookFrame[]) => frames.map((f) => f.bookId + JSON.stringify(f.box)).join('|');

// 줄 하나: 프레임(확정 또는 미리보기 배치의 3D 상자)이 바뀌었고 트랙이 향하는 배치와 다르면 경로를 짠다.
// 트랙 적용은 HomeScreen이 모아서 한 번에(flushApply). 막대·손잡이 조작 중에는 확정 배치가 그대로라 여기서 끼어들지 않는다.
export function useRowPlanner(m: Motion, shelfId: string, frames: BookFrame[], reduceMotion: boolean, arrive: Record<string, Book3> | undefined, budgetMs: number, space: number) {
  const key = keyOf(frames);
  useLayoutEffect(() => {
    const mr = mirrorOf(m);
    // 처음: 줄을 만들 때 넣은 트랙 그대로(저장본을 불러와 처음 그릴 때 날아오지 않게)
    if (mr.target === null) mr.target = key;
    if (key === mr.target) return;
    planInto(m, shelfId, frames.map((f) => fromPlaced(f.box)), key, { reduceMotion, arrive, budgetMs, space });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduceMotion]);
}

// 조작 중 미리보기(손잡이·앞뒤·돌리기 막대): React를 거치지 않고 이 줄의 경로만 바로 바꾼다.
// 멈춘 곳에서 조금씩 바뀌면 그대로 따라가고(짧은 이어 주기), 자세가 크게 바뀌면(벽에 기대기·떼기) 경로를 짠다.
// follow: 손가락이 각도를 직접 정하는 조작(손잡이·돌리기 막대)은 늘 그 자리로 바로(경로를 다시 짜면 매번 처음부터 천천히 출발해 뒤처진다)
export function previewInto(m: Motion, shelfId: string, frames: BookFrame[], reduceMotion: boolean, follow = false) {
  const next = frames.map((f) => fromPlaced(f.box));
  const key = keyOf(frames);
  const now = displayedPoses(m);
  const jump =
    !follow &&
    next.some((b) => {
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
