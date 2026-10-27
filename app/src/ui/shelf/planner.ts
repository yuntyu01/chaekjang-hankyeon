// 줄의 경로 계획(JS 스레드). 배치가 바뀌면 "지금 보이는 자세"에서 새 배치로 가는 경로를 짜서 줄의 트랙으로 넘긴다.
// - 지금 보이는 자세는 JS 쪽 사본(트랙 + 시작 시각·길이)으로 계산한다(UI 값을 거꾸로 읽지 않는다).
// - 여러 줄의 트랙 바꾸기는 한 번에 UI로 보낸다: 다른 줄로 옮겨 가는 책이 한 프레임이라도 두 권이거나 비어 보이지 않게.
// - 다른 줄에서 들어오는 책은 그 줄에서 보이던 자세(이 줄 좌표로 옮긴 것)에서 이어서 들어온다(순간 이동 없음).
//   이런 배치는 도착 줄 캔버스에 그 책이 올라간 뒤에 적용한다(그동안 이동 캔버스가 제자리의 책을 그린다, ShelfScene).
// - 다른 줄로 떠나는 책은 원래 줄에 그 책의 실제 경로(원래 줄 좌표, away)를 남긴다: 원래 줄은 이동 캔버스가 그 책을 그리지 못하는 동안
//   그 경로로 책을 그리고, 그 책이 드리우던 그림자를 그 경로로 옅게 한다. 그 책이 있는 줄이 경로를 다시 짜면(손가락이 도착 줄에서
//   계속 움직일 때 등) 원래 줄에 남은 경로도 같은 새 경로로 옮겨 잇는다(예전에는 거둬서 그림자가 한 프레임에 사라졌다).
import { useLayoutEffect } from 'react';
import { Easing, makeMutable, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { fromPlaced, type Book3 } from '@/domain/book3';
import { castsIn } from '@/domain/cast-shadow';
import { SHELF_THICK } from '@/domain/geometry';
import { PLANK_BOUNDS, type BookFrame } from '@/domain/shelf-scene';
import { awayShift, awayTrack, bookAt, DROP_MS, dropTrack, fadeBeforePass, gravityPlan, holdTrack, offBetween, planTransition, retime, retimeDrop, safeOffsets, shiftTrack, withOff, type Off, type Track } from '@/domain/transition';
import { ANIM, TL, tl, tlOn, tlu } from '@/ui/perf';

import { awayAt, easeOf, outsideRow, presentSV, type AwayEntry, type Aways, type Motion, type Tracks } from './scene';

export const MOTION_MS = 230; // 기울이기·밀림·끌기 미리보기
export const POSE_MS = 420; // 자세 바꾸기(표지로·눕히기)
export const PULL_MS = 560; // 앞으로 빼서 옮기기(다른 줄로, 막혀서 돌아가기)

// ---------- JS 쪽 사본 ----------
// target: 트랙이 향하는 배치(프레임 키). 같은 배치로 다시 짜지 않고, 조작이 끝나면 확정 배치로 맞췄는지 여기로 안다.
// ease: 멈춰 있다가 떠나면 천천히 출발(inOut), 가는 도중 목표가 바뀌면 지금 속도를 잃지 않게 바로 출발(out).
//   넘어지는 책이 있는 경로는 줄 시계를 고르게(lin) 돌리고 감속은 경로 조각마다 맡긴다(transition gravityPlan).
// start: UI에서 실제로 움직이기 시작한 시각(적용을 미뤘으면 적용될 때까지 Infinity = 아직 출발 전).
type Ease = 'inOut' | 'out' | 'lin';
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
  return mr.ease === 'lin' ? u : mr.ease === 'out' ? easeOutCubic(u) : easeInOutCubic(u);
}

// 지금 움직이는 중인가(출발 전 = start Infinity는 아직 멈춰 있다: 그때 다시 짜면 천천히 출발한다)
const moving = (mr: Mirror) => Number.isFinite(mr.start) && !!mr.dur && Date.now() - mr.start < mr.dur;

// 지금 화면에 보이는 자세(JS 계산). 조작을 시작하거나 경로를 다시 짤 때의 출발점.
export function displayedPoses(m: Motion): Record<string, Book3> {
  const mr = mirrorOf(m);
  const t = progress(mr);
  const out: Record<string, Book3> = {};
  for (const [id, tr] of Object.entries(mr.tracks)) out[id] = bookAt(tr, t);
  return out;
}

// 넘어지는 도중 다시 짤 때(끌기 미리보기가 바뀔 때 등) 목표가 그대로인 책은 지금 경로를 그대로 이어 간다: 지금(JS 어림 진행)부터 남은
// 경로를 새 경로 기준 시간(넘어지는 경로 = POSE_MS)으로 옮긴다. 줄 시계가 고르게 흐르는 경로(넘어지는 경로)끼리라 빠르기도 그대로 이어진다.
// 넘어지는 조각(점점 빨라짐·맞아서 넘어짐)이 아직 남은 책만. 예전 경로가 고르게 흐르지 않았으면(감속 시계) 없다.
const samePose = (a: Book3, b: Book3) =>
  [a.t.x - b.t.x, a.t.y - b.t.y, a.t.z - b.t.z, a.roll - b.roll, a.yaw - b.yaw, (a.spin ?? 0) - (b.spin ?? 0), (a.pitch ?? 0) - (b.pitch ?? 0)].every((d) => Math.abs(d) < 1e-3);
export function fallingKeep(m: Motion, next: Book3[]): Record<string, Track> | undefined {
  const mr = mirrorOf(m);
  if (mr.ease !== 'lin' || !moving(mr)) return undefined;
  const tc = progress(mr);
  const unit = POSE_MS * ANIM.slow;
  let out: Record<string, Track> | undefined;
  for (const b of next) {
    const tr = mr.tracks[b.id];
    if (!tr?.moving || !tr.segs.some((s) => (s.e === 1 || s.e === 3) && s.t1 > tc && Math.abs(s.r1 - s.r0) > 0.05)) continue;
    if (!samePose(bookAt(tr, 1), b)) continue;
    out = { ...(out ?? {}), [b.id]: retime(tr, tc, mr.dur / unit) };
  }
  return out;
}

// ---------- 한 번에 UI로 ----------
// 여러 줄의 트랙 바꾸기는 한 번에 UI로 보낸다. 다른 줄로 옮겨 가는 책이 있으면(waits) 도착한 줄 캔버스에 그 책이 올라갈 때까지
// 적용을 미룬다: 캔버스에 책을 올리는 일(React 반영과 캔버스 다시 기록)은 JS에서 늦게 끝나고 그동안 UI가 멈출 수 있어,
// 먼저 움직이기 시작하면 이동 경로가 멈춘 사이에 지나가 버린다(순간 이동처럼 보임). 그동안 책은 제자리에 있다(이동 캔버스가 그린다).
// left: 이 줄을 떠나는 책의 떠날 때 자세(이 줄 좌표). space: 이 줄 공간 높이(줄 계획에서 온 것만).
type Apply = {
  m: Motion;
  shelfId: string;
  rec: Tracks;
  animate: boolean;
  dur: number;
  out: boolean;
  fall: boolean;
  key: number;
  space?: number;
  left?: Record<string, Book3>;
};
export type Wait = { id: string; shelfId: string };
// 다른 줄에 남는 경로 하나를 새로 두거나 옮겨 잇거나(tr) 거둔다(tr null). space: 그 줄 공간 높이.
// 남길지와 그림자가 없어지는 진행(k)은 UI가 정한다: 지금 보이는 자세에서 이어 붙인 경로(이어 주기)로 재야 화면과 맞는다(JS 어림과 다를 수 있다).
// 시각(t0)도 UI가 그 책이 있는 줄의 경로와 함께 출발할 때 정한다.
type AwayUpd = { m: Motion; shelfId: string; id: string; tr: Track | null; dur: number; out: boolean; space: number };
// waited: 도착 줄 캔버스에 책이 올라가기를 실제로 기다렸다(올라간 첫 그림 프레임이 지난 뒤 출발한다).
// seq: 기다림을 새로 건 묶음 번호(대기 시간 초과 타이머가 자기 묶음에만 작동하게). since: 그 기다림을 건 시각.
type Pending = { list: Apply[]; waits: Wait[]; since: number; waited: boolean; ups: AwayUpd[]; seq: number };
let batch: Apply[] = [];
let batchWaits: Wait[] = [];
let nextKey = 1;
let pendSeq = 0;
const byKey = new Map<number, Motion>();
const pendingSV = makeMutable<Pending | null>(null);
export const WAIT_MAX = 1200; // 이만큼 기다려도 올라가지 않으면 그냥 움직인다(ms)
// 떠난 책 → 그 책의 남는 경로를 둔 줄들(JS 쪽 기록). dy: 그 책이 지금 있는 줄 좌표 → 그 줄 좌표(세로만 다르다), space: 그 줄 공간 높이.
// 한 책이 연달아 여러 줄을 지나면(A → B → C) 앞서 떠난 줄들도 지금 경로로 옮겨 잇는다(버린 경로를 따라 그림자가 남지 않게).
type AwayRow = { m: Motion; shelfId: string; dy: number; space: number };
const awayRows = new Map<string, AwayRow[]>();
// UI에서 아직 적용되지 않은(미뤄 둔 묶음에 합쳐진) 적용들: 이 동안 다시 짜는 경로는 출발 전 자세에서 시작한다(JS 사본이 UI에서
// 돌지 않은 경로를 따라 앞서가 적용 순간 책이 튀지 않게)
const openKeys = new Set<number>();

export function queueApply(m: Motion, shelfId: string, rec: Tracks, animate: boolean, dur: number, target: string | null, waits: Wait[] = [], space?: number, fall = false) {
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
  mr.ease = fall && animate ? 'lin' : out ? 'out' : 'inOut';
  mr.target = target;
  mr.key = key;
  byKey.set(key, m);
  batch = batch.filter((a) => a.shelfId !== shelfId);
  batch.push({ m, shelfId, rec, animate, dur, out, fall: fall && animate, key, space, left });
  batchWaits.push(...waits);
}

const easeFn = (out: boolean) => (out ? easeOutCubic : easeInOutCubic);
// 그 줄에 그림자가 더는 없다: 판에 다 가렸다(scene shadeIn과 같은 판정. 떠나는 책이 위로 가면 위 판, 아래로 가면 판 윗면)
const goneIn = (space: number) => (b: Book3) => !castsIn(b, space);

// 다른 줄에 남는 경로(away)를 이 묶음에 맞춘다. 책마다:
// - 새로 다른 줄로 떠났으면(기다림 = 도착 줄) 원래 줄에 남는 경로를 둔다: 도착 줄 경로를 원래 줄 좌표로(세로만 다르다),
//   도착 줄과 같은 시각·같은 감속으로, 판에 다 가려 원래 줄에 그림자가 더는 없는 곳(k)까지.
// - 그 책이 있는 줄의 경로를 다시 짰으면(같은 줄에서 목표가 바뀌거나, 또 다른 줄로 떠났으면) 다른 줄들에 남은 경로를 새 경로로 옮겨 잇는다.
//   그 책이 돌아온 줄은 그 줄 트랙이 맡으므로 거둔다.
// - 경로 없이 바로 옮긴 책(동작 줄이기 등)은 남길 경로가 없다: 앞서 남긴 경로도 거둔다(책과 함께 그림자도 그 순간 옮겨 간다).
// 남길지(그 줄에 그림자가 아직 있는지)와 k는 UI가 정한다(AwayUpd). 여기 기록(awayRows)은 다음에 옮겨 이을 줄을 고르는 데만 쓴다.
function awaysOf(list: Apply[], waits: Wait[]): AwayUpd[] {
  const ups: AwayUpd[] = [];
  const ids = new Set<string>([...waits.map((w) => w.id), ...awayRows.keys()]);
  for (const id of ids) {
    const to = list.find((a) => a.rec[id]);
    if (!to) continue; // 그 책이 있는 줄은 이 묶음에서 다시 짜지 않았다(남은 경로는 그대로 간다)
    let rows = (awayRows.get(id) ?? []).filter((r) => r.m !== to.m);
    const drop = (rs: AwayRow[]) => {
      for (const r of rs) ups.push({ m: r.m, shelfId: r.shelfId, id, tr: null, dur: 0, out: false, space: r.space });
    };
    if (!to.animate) {
      drop(rows);
      awayRows.delete(id);
      continue;
    }
    const fresh = waits.some((w) => w.id === id && w.shelfId === to.shelfId);
    const from = fresh ? list.find((a) => a.m !== to.m && a.left?.[id]) : undefined;
    if (from && from.space !== undefined) {
      const a = awayTrack(to.rec[id], from.left![id], easeFn(to.out), goneIn(from.space), from.space + SHELF_THICK);
      if (a) {
        rows = rows.filter((r) => r.m !== from.m).map((r) => ({ ...r, dy: r.dy + a.dy }));
        ups.push({ m: from.m, shelfId: from.shelfId, id, tr: a.track, dur: to.dur, out: to.out, space: from.space });
        rows.push({ m: from.m, shelfId: from.shelfId, dy: a.dy, space: from.space });
      } else {
        // 떠날 때 자세와 새 경로가 이어지지 않으면(같은 책의 경로가 아니면) 줄 사이 거리를 알 수 없어 앞서 남긴 경로도 모두 거둔다
        drop(rows);
        rows = [];
      }
    }
    const kept: AwayRow[] = [];
    for (const r of rows) {
      if (from && r.m === from.m) {
        kept.push(r);
        continue;
      }
      ups.push({ m: r.m, shelfId: r.shelfId, id, tr: shiftTrack(to.rec[id], r.dy), dur: to.dur, out: to.out, space: r.space });
      // 새 경로 출발점이 이미 그 줄 그림자 범위 밖이면(JS 어림) 다음부터는 옮겨 잇지 않는다(UI 쪽 남은 경로는 UI가 정한 k까지 간다)
      if (awayShift(to.rec[id], r.dy, easeFn(to.out), goneIn(r.space))) kept.push(r);
    }
    if (kept.length) awayRows.set(id, kept);
    else awayRows.delete(id);
  }
  return ups;
}

// UI에서 실제로 적용한 시각을 JS 사본에 맞춘다. 미뤄 둔 묶음이 적용되면(그 묶음의 열쇠가 하나라도 오면) 대기 구간을 닫는다.
function applied(keys: number[], at: number) {
  if (TL.on) tl(`applied ${keys.join(',')} late=${Date.now() - at}`);
  if (keys.some((k) => openKeys.has(k))) openKeys.clear();
  for (const k of keys) {
    const m = byKey.get(k);
    byKey.delete(k);
    if (!m) continue;
    const mr = mirrorOf(m);
    if (mr.key === k) mr.start = at;
  }
}

// 남는 경로가 있는 동안 줄 시계(awayT, ms)를 실제 시간으로 흐르게 한다: 가장 늦게 끝나는 남는 경로의 끝까지 직선으로.
function runClock(m: Motion) {
  'worklet';
  const now = m.awayT.value;
  let end = now;
  const aw = m.away.value;
  for (const id in aw) {
    const e = aw[id];
    if (e.t0 === Infinity || !(e.dur > 0)) continue;
    end = Math.max(end, e.t0 + e.dur * e.k);
  }
  if (end > now) m.awayT.value = withTiming(end, { duration: end - now, easing: Easing.linear });
}

// 남는 경로에서 그 줄에 그림자가 더는 없는 첫 진행(실제 시간 비율 u, 1/48 단위). 출발점부터 없으면 0, 끝까지 있으면 1.
function goneAt(tr: Track, out: boolean, space: number) {
  'worklet';
  if (!castsIn(bookAt(tr, 0), space)) return 0;
  for (let i = 1; i <= 48; i++) if (!castsIn(bookAt(tr, easeOf(out, i / 48)), space)) return i / 48;
  return 1;
}

// 측정 번들: 이어 주기 크기(위치 DU / 각도 °)가 0.5를 넘으면 '위치/각도' 문자열, 아니면 ''
function offText(o: Off) {
  'worklet';
  const d = Math.max(Math.abs(o.x), Math.abs(o.y), Math.abs(o.z));
  const r = Math.max(Math.abs(o.roll), Math.abs(o.yaw), Math.abs(o.spin), Math.abs(o.pitch));
  return d > 0.5 || r > 0.5 ? `${d.toFixed(1)}/${r.toFixed(1)}` : '';
}

// late: 도착 줄 캔버스에 막 올라간 책을 기다린 적용. 새로 올라간 책은 첫 그림을 내는 프레임에 계산이 몰려(파생 값 시작) 그 프레임이
// 길어지므로, 트랙은 바로 넣어 출발 자세에 두고 진행은 그 프레임이 지난 뒤(두 프레임 뒤) 시작한다. 그 사이 더 새 경로가 들어오면 건너뛴다.
// ups: 다른 줄에 남는 경로(새로 두기·옮겨 잇기·거두기)를 이 적용과 같은 때 바꾼다. 남는 경로의 진행은 그 책이 있는 줄의 경로와 함께 출발한다.
// 새 경로는 지금 보이는 자세(UI)에서 잇는다: JS가 어림한 출발점과 다르면 그 차이를 경로 앞부분에 더한다(Track.off).
// 바로 바꾸는 적용(animate false: 손가락이 자세를 직접 정하는 조작 등)은 그대로 바꾼다.
function applyNow(list: Apply[], late = false, ups: AwayUpd[] = []) {
  'worklet';
  // 1) 바꾸기 전에 지금 보이는 자세와의 차이를 잰다. 막 다른 줄로 떠나는 책은 떠나는 줄에서 보이던 자세에서 잇는다(도착 줄 경로와
  //    남는 경로가 같은 차이: 남는 경로는 도착 줄 경로를 세로로 옮긴 것)
  //    남길지와 그림자가 없어지는 진행(k)도 이어 붙인 경로로 정한다. 그 줄에 그 책이 없으면(트랙도 남은 경로도) 새로 만들지 않는다.
  const carry: Record<string, Off> = {};
  const upTr: (Track | null)[] = [];
  const upK: number[] = [];
  let log = '';
  for (const u of ups) {
    let tr = u.tr;
    let k = 0;
    if (tr) {
      const src = u.m.tracks.value[u.id];
      const e = u.m.away.value[u.id];
      const from = src ? bookAt(src, u.m.t.value) : e ? awayAt(e, u.m.awayT.value) : null;
      if (!from) tr = null;
      else {
        const d = offBetween(from, bookAt(tr, 0));
        if (d) {
          tr = withOff(tr, d);
          if (src) carry[u.id] = d;
          if (tlOn.value && offText(d)) log += ` away:${u.id}@${u.shelfId}:${offText(d)}`;
        }
        k = goneAt(tr, u.out, u.space);
        if (k <= 0) tr = null;
      }
    }
    upTr.push(tr);
    upK.push(k);
  }
  const recs: Tracks[] = [];
  for (const a of list) {
    let rec = a.rec;
    if (a.animate) {
      const old = a.m.tracks.value;
      const t = a.m.t.value;
      for (const id in a.rec) {
        const nt = a.rec[id];
        const o = old[id];
        const d = o ? (o === nt ? null : offBetween(bookAt(o, t), bookAt(nt, 0))) : (carry[id] ?? null);
        if (!d) continue;
        if (rec === a.rec) rec = { ...a.rec };
        rec[id] = withOff(nt, d);
        if (tlOn.value && offText(d)) log += ` ${id}@${a.shelfId}:${offText(d)}(t=${t.toFixed(3)})`;
      }
      // 이어 주기를 더한 앞부분도 책끼리 겹치지 않게(겹치면 줄이거나 버린다)
      if (rec !== a.rec) rec = safeOffsets(rec, a.rec);
    }
    recs.push(rec);
  }
  if (tlOn.value) {
    tlu(
      `apply ${list.map((a) => `${a.shelfId}${a.animate ? `:${Math.round(a.dur)}` : ''}#${a.key}`).join(',')}${late ? ' late' : ''}${ups.length ? ` away ${ups.map((u) => `${u.id}@${u.shelfId}${u.tr ? '' : '-'}`).join(',')}` : ''}`,
    );
    if (log) tlu(`bridge${log}`);
  }
  // 2) 바꾼다
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const rec = recs[i];
    a.m.tracks.value = rec;
    a.m.t.value = a.animate ? 0 : 1;
    // 이 줄로 돌아온 책은 이 줄 트랙이 맡는다(남는 경로를 지운다). 다른 책의 남는 경로는 그대로 둔다(이 줄을 다시 짜도 이어진다)
    const aw = a.m.away.value;
    let back = false;
    for (const id in aw) if (rec[id]) back = true;
    if (back) {
      const keep: Aways = {};
      for (const id in aw) if (!rec[id]) keep[id] = aw[id];
      a.m.away.value = keep;
    }
  }
  // 남는 경로: 출발 전(t0 = Infinity)으로 두고, 진행은 run()에서 그 책이 있는 줄의 경로와 같은 때 출발한다
  const placed: { m: Motion; id: string; e: AwayEntry }[] = [];
  for (let i = 0; i < ups.length; i++) {
    const u = ups[i];
    const tr = upTr[i];
    const cur = u.m.away.value;
    if (!tr) {
      if (!cur[u.id]) continue;
      const next: Aways = {};
      for (const id in cur) if (id !== u.id) next[id] = cur[id];
      u.m.away.value = next;
      continue;
    }
    const e: AwayEntry = { tr, t0: Infinity, dur: u.dur, out: u.out, k: upK[i] };
    u.m.away.value = { ...cur, [u.id]: e };
    placed.push({ m: u.m, id: u.id, e });
  }
  const run = () => {
    const keys: number[] = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.m.tracks.value !== recs[i]) continue;
      keys.push(a.key);
      const ease = a.fall ? Easing.linear : a.out ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic);
      if (a.animate) a.m.t.value = withTiming(1, { duration: a.dur, easing: ease });
      if (tlOn.value && a.animate) {
        let ids = '';
        for (const id in recs[i]) if (recs[i][id].moving) ids += `${ids ? ',' : ''}${id}`;
        tlu(`path-start ${a.shelfId}:${Math.round(a.dur)} ${ids}`);
      }
    }
    // 남는 경로의 시각: 지금 줄 시계 값에서 출발(그 책이 있는 줄의 경로와 같은 프레임). 더 새 적용이 바꿔 놓았으면 건드리지 않는다.
    const clocks: Motion[] = [];
    for (const p of placed) {
      const cur = p.m.away.value;
      if (cur[p.id] !== p.e) continue;
      p.m.away.value = { ...cur, [p.id]: { ...p.e, t0: p.m.awayT.value } };
      if (clocks.indexOf(p.m) < 0) clocks.push(p.m);
    }
    for (const m of clocks) runClock(m);
    if (late && tlOn.value) tlu('apply-run');
    // 경로가 실제로 출발한 시각(Date.now 기준)을 JS 사본에 알린다. 프레임 처리 중에 적용하면 Reanimated는 그 프레임 시각을 출발로
    // 잡으므로(긴 프레임이면 지금보다 한참 앞) 그만큼 당긴다. 이 차이를 모르면 JS 어림이 UI보다 늦어 다시 짤 때마다 크게 어긋났다.
    const g = globalThis as unknown as { __frameTimestamp?: number; _getAnimationTimestamp?: () => number };
    const nowA = g._getAnimationTimestamp ? g._getAnimationTimestamp() : 0;
    const startA = g.__frameTimestamp || nowA;
    scheduleOnRN(applied, keys, Date.now() - Math.max(0, nowA - startA));
  };
  if (!late) run();
  else requestAnimationFrame(() => requestAnimationFrame(run));
}

// 미뤄 둔 적용: 기다리는 책이 모두 도착한 줄 캔버스에 올라갔으면(또는 너무 오래 기다렸으면) 적용한다.
// 줄 캔버스의 책이 올라갈 때마다(ShelfMotion RowBook) 부른다. seq: 대기 시간 초과 타이머가 부를 때 자기 묶음 번호(다른 묶음이면 무시).
export function tryApplyPending(force = false, seq = 0) {
  'worklet';
  const p = pendingSV.value;
  if (!p) return;
  if (force && seq && p.seq !== seq) return;
  let ready = true;
  for (const w of p.waits) if (!presentSV.value[w.id]?.[w.shelfId]) ready = false;
  if (!ready && !force && Date.now() - p.since < WAIT_MAX) {
    if (!p.waited) pendingSV.value = { ...p, waited: true };
    return;
  }
  if (!ready) tlu('pending-timeout');
  pendingSV.value = null;
  // 실제로 기다린 끝에 막 올라간 책이면 첫 그림 프레임이 지난 뒤 출발한다(이미 올라가 있었으면 바로)
  applyNow(p.list, ready && p.waited, p.ups);
}

export function flushApply() {
  if (!batch.length) return;
  const list = batch;
  const waits = batchWaits;
  batch = [];
  batchWaits = [];
  const ups = awaysOf(list, waits);
  if (TL.on) tl(`flush ${list.map((a) => a.shelfId).join(',')} waits=${waits.map((w) => `${w.id}@${w.shelfId}`).join(',')}`);
  // 미루는 적용은 UI에서 적용될 때까지 출발 전으로 둔다. 미뤄 둔 묶음이 있는 동안 더 짜는 경로도(UI에서 그 묶음에 합쳐진다) 같다.
  if (waits.length || openKeys.size)
    for (const a of list) {
      openKeys.add(a.key);
      if (mirrorOf(a.m).key === a.key) mirrorOf(a.m).start = Infinity;
    }
  const seq = waits.length ? ++pendSeq : 0;
  scheduleOnUI(() => {
    'worklet';
    const p = pendingSV.value;
    if (!p && !waits.length) {
      applyNow(list, false, ups);
      return;
    }
    // 미뤄 둔 것이 있으면 합친다(같은 줄은 새것이 이긴다). 기다림은 새 배치의 것(가장 최근 배치의 도착).
    // 새 기다림을 건 묶음이면 기다린 시각·번호도 새로(앞 묶음의 타이머가 이 묶음을 미리 적용하지 않게)
    const merged: Apply[] = [];
    if (p) for (const a of p.list) if (!list.some((b) => b.shelfId === a.shelfId)) merged.push(a);
    for (const a of list) merged.push(a);
    const fresh = waits.length > 0;
    pendingSV.value = {
      list: merged,
      waits: fresh ? waits : p ? p.waits : [],
      since: fresh || !p ? Date.now() : p.since,
      waited: fresh || !p ? false : p.waited,
      ups: p ? [...p.ups, ...ups] : ups,
      seq: fresh ? seq : p ? p.seq : 0,
    };
    if (tlOn.value) tlu(`pending ${merged.map((a) => a.shelfId).join(',')}`);
    tryApplyPending();
  });
  if (waits.length)
    setTimeout(() => {
      scheduleOnUI(() => {
        'worklet';
        tryApplyPending(true, seq);
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
// 바뀌어(놓는 순간, 손가락이 계속 움직일 때) 다시 짜도 판 앞을 지나는 길을 그대로 쓰고, 이미 떠 있는 책은 다시 들어 올리지 않는다
// (곧장 가면 옆 줄 책·판을 뚫고 지나가 가려지거나 튀고, 다시 들면 다시 짤 때마다 올라간다).
// roofed: 위에 줄이 있다(윗선반 판 아랫면 = space). 도는 책이 판을 뚫지 않게 경로 검사에 넣는다.
// drops: 이 배치에서 받침을 잃고 선반에서 떨어져 서랍으로 간 책(떨어지는 쪽 d: ±1 옆으로 넘어짐, 0 표지 책이 선반 앞 끝 너머로).
// 지금 보이는 자세에서 떨어지며 옅어져 사라진다(dropTrack).
export type Drops = Record<string, { from: Book3; d: -1 | 0 | 1 }>;
export function planInto(m: Motion, shelfId: string, next: Book3[], target: string, opts: { reduceMotion: boolean; arrive?: Record<string, Book3>; budgetMs?: number; space?: number; roofed?: boolean; drops?: Drops }) {
  // 다른 줄에서 들어오는 책은 이 줄 캔버스에 올라간 뒤에 움직인다
  const waits: Wait[] = next.filter((b) => opts.arrive?.[b.id]).map((b) => ({ id: b.id, shelfId }));
  if (opts.reduceMotion) {
    queueApply(m, shelfId, Object.fromEntries(next.map((b) => [b.id, holdTrack(b)])), false, 0, target, waits, opts.space);
    return;
  }
  const t0 = Date.now();
  // 측정 번들: JS 사본이 어림한 진행(p)과 출발 뒤 지난 시간(age, 출발 전이면 -1)
  const mr0 = mirrorOf(m);
  const est = TL.on ? ` p=${progress(mr0).toFixed(3)} age=${Number.isFinite(mr0.start) ? t0 - mr0.start : -1}` : '';
  const shown = displayedPoses(m);
  let arrive = opts.arrive;
  if (opts.space !== undefined) {
    for (const b of next) {
      const p = shown[b.id];
      if (p && !arrive?.[b.id] && outsideRow(p, opts.space)) arrive = { ...(arrive ?? {}), [b.id]: p };
    }
  }
  const prev = Object.values(shown);
  // 줄 간격(판 윗면 사이): 받침에 놓인 책인지 볼 때 쓴다(모든 줄이 같은 3D 간격)
  const pitch = opts.space !== undefined ? opts.space + SHELF_THICK : undefined;
  const ceil = opts.roofed ? opts.space : undefined;
  // 줄 사이로 옮기는 책·다른 줄에 남는 경로가 있는 책과 같은 경로면 남는 경로가 줄 시계 감속을 따라가므로 줄 시계를 고르게 돌리지 않는다
  const away = next.some((b) => awayRows.has(b.id));
  const keep = away ? undefined : fallingKeep(m, next);
  // 계획 시간(budgetMs)은 경로 짜기와 넘어지는 경로 다시 검사가 함께 쓴다
  const deadline = t0 + (opts.budgetMs ?? 40);
  const plan = planTransition(prev, next, PLANK_BOUNDS, { budgetMs: opts.budgetMs, arrive, pitch, ceil, keep });
  // 떨어져 서랍으로 가는 책(이 줄 배치에는 없다): 지금 보이는 자세에서 떨어지며 사라진다. 다른 책 경로 검사에는 넣지 않는다(곧 사라진다).
  // 이미 떨어지는 중인 책(going)은 다시 짜도 지금 경로를 이어 간다(넘어지던 빠르기·진하기 그대로). 다 사라진 책(경로가 이미 빠진 책 포함)은
  // 다시 그리지 않는다: 이 줄에 지금 보이는(떨어지는 경로가 없는) 책만 새로 떨어진다(fresh)
  const going = fadingIds(m, next);
  const fresh = Object.entries(opts.drops ?? {}).filter(([id]) => shown[id] && !next.some((b) => b.id === id) && mr0.tracks[id]?.drop === undefined);
  const dropping = going.length + fresh.length > 0;
  lastPlan.strategy = plan.strategy;
  lastPlan.ms = Date.now() - t0;
  lastPlan.log?.push(lastPlan.ms);
  if (TL.on) tl(`plan ${shelfId} ${plan.strategy} ${lastPlan.ms}ms waits=${waits.length}${arrive !== opts.arrive ? ' arriving' : ''}${keep ? ` keep=${Object.keys(keep).join(',')}` : ''}${est}`);
  const animate = plan.strategy !== 'still' || dropping;
  const pull = plan.strategy === 'pull' || (!!arrive && next.some((b) => arrive![b.id]));
  const posing = /al|pull|fall/.test(plan.strategy);
  // 넘어지는 책이 차례로 넘어지면(도미노) 경로가 그만큼 길다(plan.len)
  const dur = (pull ? PULL_MS : posing ? POSE_MS : MOTION_MS) * (plan.len ?? 1) * ANIM.slow;
  // 넘어지는 책(받침을 잃음, 놓은 각이 넘어짐 한계 아래)은 점점 빨라지다 닿는 순간 멈춘다. 받침을 잃고 눕는 책이 있는 경로는
  // planTransition이 이미 그렇게 짜서 검사했다(plan.fall). 그 밖의 경로는 남은 계획 시간으로 다시 검사한다(gravityPlan).
  // 서랍으로 떨어지는 책이 있으면 넘어지는 조각이 없어도 고른 시계로 돌린다: 감속 시계면 그 책이 천천히 서 있다가 한두 프레임에 눕는다
  const fall = !animate || away ? null : plan.fall ? plan : !pull ? gravityPlan(plan, PLANK_BOUNDS, { budgetMs: Math.max(0, deadline - Date.now()), ceil, always: dropping }) : null;
  if (fall && TL.on) tl(`plan ${shelfId} fall`);
  // 떨어지는 책은 DROP_MS 동안 넘어지고 옅어진다. 고른 시계면 줄 시계를 그만큼 늘리고 다른 책 경로는 앞부분에 둔다(실제 빠르기 그대로)
  const rowDur = !dropping ? dur : Math.max(dur, (fall ? DROP_MS : POSE_MS) * ANIM.slow);
  const tracks = fall && rowDur > dur ? squeezed(fall.tracks, dur / rowDur) : (fall ?? plan).tracks;
  // 떨어지는 책은 옆 책들의 경로(같은 진행의 자세)와 견준다: 그때 비켜 있는 책은 막지 않고, 지나가는 책이 오기 전에 사라진다
  const drops = [...continued(m, going, rowDur).map((tr) => fadeBeforePass(tr, tracks)), ...fresh.map(([id, dr]) => dropTrack(shown[id], dr.d, tracks, rowDur / ANIM.slow))];
  queueApply(m, shelfId, Object.fromEntries([...tracks, ...drops].map((tr) => [tr.id, tr])), animate, rowDur, target, waits, opts.space, !!fall);
}

// 경로를 줄 시계 앞부분 [0, k]로 줄인다(줄 시계가 1/k배 길어져도 실제 빠르기 그대로)
const squeezed = (tracks: Track[], k: number) => tracks.map((tr) => (tr.moving ? { ...tr, segs: tr.segs.map((s) => ({ ...s, t0: s.t0 * k, t1: s.t1 * k })) } : tr));

// 떨어지며 옅어지는 중인 책(next에 없고 아직 보인다)
function fadingIds(m: Motion, next: Book3[]): string[] {
  const mr = mirrorOf(m);
  const tc = progress(mr);
  return Object.keys(mr.tracks).filter((id) => {
    const tr = mr.tracks[id];
    return !!tr.fade && tr.drop !== undefined && !next.some((b) => b.id === id) && (bookAt(tr, tc).alpha ?? 1) > 0.01;
  });
}
// 그 책들의 남은 경로를 새 줄 시계(길이 dur)로 이어 간다(지금 자세·빠르기·진하기 그대로)
function continued(m: Motion, ids: string[], dur: number): Track[] {
  const mr = mirrorOf(m);
  const tc = progress(mr);
  return ids.map((id) => retimeDrop(mr.tracks[id], tc, mr.dur / dur));
}

const keyOf = (frames: BookFrame[]) => frames.map((f) => f.bookId + JSON.stringify(f.box)).join('|');

// 줄 하나: 프레임(확정 또는 미리보기 배치의 3D 상자)이 바뀌었고 트랙이 향하는 배치와 다르면 경로를 짠다.
// 트랙 적용은 HomeScreen이 모아서 한 번에(flushApply). 막대·손잡이 조작 중에는 확정 배치가 그대로라 여기서 끼어들지 않는다.
export function useRowPlanner(m: Motion, shelfId: string, frames: BookFrame[], reduceMotion: boolean, arrive: Record<string, Book3> | undefined, budgetMs: number, space: number, roofed = false, drops?: Drops) {
  const key = keyOf(frames);
  useLayoutEffect(() => {
    const mr = mirrorOf(m);
    // 처음: 줄을 만들 때 넣은 트랙 그대로(저장본을 불러와 처음 그릴 때 날아오지 않게)
    if (mr.target === null) mr.target = key;
    if (key === mr.target) return;
    planInto(m, shelfId, frames.map((f) => fromPlaced(f.box)), key, { reduceMotion, arrive, budgetMs, space, roofed, drops });
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
  else {
    // 떨어지며 옅어지는 중인 책은 그대로 이어 간다(바로 그 자세로 맞추는 미리보기에서도 사라지는 모습이 끊기지 않게)
    const dur = DROP_MS * ANIM.slow;
    const drops = reduceMotion ? [] : continued(m, fadingIds(m, next), dur);
    queueApply(m, shelfId, Object.fromEntries([...next.map((b) => [b.id, holdTrack(b)] as const), ...drops.map((tr) => [tr.id, tr] as const)]), drops.length > 0, drops.length ? dur : 0, key, [], undefined, drops.length > 0);
  }
  flushApply();
}

// 조작이 끝났을 때: 확정된(또는 되돌린) 배치로 경로를 짜서 맞춘다(미리보기 자세가 남지 않게). 이미 그 배치면 그대로.
// drops: 그 조작으로 이 줄에서 서랍으로 떨어진 책(줄 경로는 여기서 정해지고 홈이 다시 짜지 않으므로 여기서 함께 떨어뜨린다)
export function settleInto(m: Motion, shelfId: string, frames: BookFrame[], reduceMotion: boolean, drops?: Drops) {
  const key = keyOf(frames);
  if (mirrorOf(m).target === key) return;
  planInto(m, shelfId, frames.map((f) => fromPlaced(f.box)), key, { reduceMotion, budgetMs: 60, drops });
  flushApply();
}
