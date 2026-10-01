// 배치 전환 경로(순수, UI 스레드 워클릿에서도 쓴다). 한 동작 = 관련 책 전부의 3D 자세를 공통 진행률 t(0→1)로 푸는 경로.
// 입력은 "지금 화면에 보이는 자세"(움직이는 도중이면 그 보간값)와 목표 자세. 끝 모습만 맞추면 도중에 겹칠 수 있으므로
// 후보 경로를 t 전 구간에서 3D 충돌로 검사해(접촉에 가까운 구간은 촘촘히) 처음 통과하는 것을 쓴다. 통과하는 경로가 없으면 null.
//
// 기울이기: 기우는 쪽 바닥 모서리(발)를 축으로(pivot). 자세 바꾸기(표지로·눕히기): 도는 동안 책이 차지하는 가로 범위를 한쪽(또는 가운데)에
// 맞추고 가장 낮은 점을 받침에 댄 채 돈다(box). 도는 도중에는 대각선만큼 폭이 잠깐 커지므로, 옆 책이 그만큼 더 비켜 줬다가 끝에 붙는다.
// 높이가 바뀌는 이동(쌓인 책 내리기)은 L자로 나눠 대각선으로 다른 책을 가로지르지 않게 한다.
import { cornerLocal, corners, gap, lowest, pivotLocal, rot, sub3, toWorld, xRange, type Book3, type Vec3 } from './book3';
import { SHELF_DEPTH, SHELF_FRONT } from './geometry';

// kind 0 = pivot(기준점 a의 월드 위치를 w0→w1), 1 = box(가로 정렬 al의 x를 x0→x1, 가장 낮은 y를 b0→b1, 가장 앞 z를 z0→z1)
export type Seg = {
  kind: number;
  t0: number;
  t1: number;
  r0: number;
  r1: number;
  y0: number;
  y1: number;
  sp0: number; // 수직축 회전(눕힌 책을 비스듬히)
  sp1: number;
  pi0: number; // 벽에 기대기(뒤로 젖힘)
  pi1: number;
  a: Vec3;
  w0: Vec3;
  w1: Vec3;
  al: number;
  x0: number;
  x1: number;
  b0: number;
  b1: number;
  z0: number;
  z1: number;
};
// rest: 움직이지 않는 트랙의 자세(늘 같은 객체). bookAt이 그대로 돌려줘서, 이 책을 읽는 화면 계산이 매 프레임 다시 돌지 않는다.
export type Track = { id: string; dims: Book3['dims']; segs: Seg[]; moving: boolean; rest?: Book3 };
export type Plan = { tracks: Track[]; strategy: string };

const ZERO = { x: 0, y: 0, z: 0 };

function clamp01(v: number) {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 방향(roll, yaw)으로 돌린 상자(이동 전)의 범위
export function extent(dims: Book3['dims'], roll: number, yaw: number, spin = 0, pitch = 0) {
  'worklet';
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  for (let i = 0; i < 8; i++) {
    const p = rot(roll, yaw, cornerLocal(dims, i), spin, pitch);
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.z < z0) z0 = p.z;
  }
  return { x0, x1, y0, z0 };
}

export function bookAt(tr: Track, t: number): Book3 {
  'worklet';
  if (!tr.moving && tr.rest) return tr.rest;
  const segs = tr.segs;
  let s = segs[0];
  for (let i = 0; i < segs.length; i++) {
    s = segs[i];
    if (t <= segs[i].t1) break;
  }
  const u = s.t1 > s.t0 ? clamp01((t - s.t0) / (s.t1 - s.t0)) : t >= s.t1 ? 1 : 0;
  const roll = s.r0 + (s.r1 - s.r0) * u;
  const yaw = s.y0 + (s.y1 - s.y0) * u;
  const spin = s.sp0 + (s.sp1 - s.sp0) * u;
  const pitch = s.pi0 + (s.pi1 - s.pi0) * u;
  if (s.kind === 1) {
    const e = extent(tr.dims, roll, yaw, spin, pitch);
    const ax = s.x0 + (s.x1 - s.x0) * u;
    return {
      id: tr.id,
      dims: tr.dims,
      roll,
      yaw,
      spin,
      pitch,
      t: { x: ax - (e.x0 + (e.x1 - e.x0) * s.al), y: s.b0 + (s.b1 - s.b0) * u - e.y0, z: s.z0 + (s.z1 - s.z0) * u - e.z0 },
    };
  }
  const w = { x: s.w0.x + (s.w1.x - s.w0.x) * u, y: s.w0.y + (s.w1.y - s.w0.y) * u, z: s.w0.z + (s.w1.z - s.w0.z) * u };
  return { id: tr.id, dims: tr.dims, roll, yaw, spin, pitch, t: sub3(w, rot(roll, yaw, s.a, spin, pitch)) };
}

// ---------- 경로 조각 ----------

type State = Book3;

const blank = { al: 0, x0: 0, x1: 0, b0: 0, b1: 0, z0: 0, z1: 0 };

function pivotSeg(b0: State, b1: State, t0: number, t1: number, a: Vec3): Seg {
  return { kind: 0, t0, t1, r0: b0.roll, r1: b1.roll, y0: b0.yaw, y1: b1.yaw, sp0: b0.spin ?? 0, sp1: b1.spin ?? 0, pi0: b0.pitch ?? 0, pi1: b1.pitch ?? 0, a, w0: toWorld(b0, a), w1: toWorld(b1, a), ...blank };
}

function boxOf(b: State, al: number) {
  const e = extent(b.dims, b.roll, b.yaw, b.spin ?? 0, b.pitch ?? 0);
  return { x: b.t.x + e.x0 + (e.x1 - e.x0) * al, y: b.t.y + e.y0, z: b.t.z + e.z0 };
}

function boxSeg(b0: State, b1: State, t0: number, t1: number, al: number): Seg {
  const p = boxOf(b0, al);
  const q = boxOf(b1, al);
  return { kind: 1, t0, t1, r0: b0.roll, r1: b1.roll, y0: b0.yaw, y1: b1.yaw, sp0: b0.spin ?? 0, sp1: b1.spin ?? 0, pi0: b0.pitch ?? 0, pi1: b1.pitch ?? 0, a: ZERO, w0: ZERO, w1: ZERO, al, x0: p.x, x1: q.x, b0: p.y, b1: q.y, z0: p.z, z1: q.z };
}

// 방향 b.roll·b.yaw를 (roll, yaw)로 바꾸되 정렬 기준(al)의 가로 위치·바닥·앞면은 그대로
function reorient(b: State, roll: number, yaw: number, al: number, spin = 0): State {
  const p = boxOf(b, al);
  const e = extent(b.dims, roll, yaw, spin);
  return { id: b.id, dims: b.dims, roll, yaw, spin, t: { x: p.x - (e.x0 + (e.x1 - e.x0) * al), y: p.y - e.y0, z: p.z - e.z0 } };
}

// 같은 방향 두 자세를 잇는 이동. 높이가 바뀌면 L자(올라갈 때는 먼저 위로, 내려갈 때는 먼저 옆으로).
function moveSegs(b0: State, b1: State, t0: number, t1: number): Seg[] {
  if (Math.abs(b0.t.y - b1.t.y) < 0.01) return [pivotSeg(b0, b1, t0, t1, ZERO)];
  const tm = (t0 + t1) / 2;
  const up = b1.t.y > b0.t.y;
  const mid: State = { ...b0, t: up ? { x: b0.t.x, y: b1.t.y, z: b0.t.z } : { x: b1.t.x, y: b0.t.y, z: b1.t.z } };
  return [pivotSeg(b0, mid, t0, tm, ZERO), pivotSeg(mid, b1, tm, t1, ZERO)];
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
const sameRot = (a: State, b: State) => near(a.roll, b.roll) && near(a.yaw, b.yaw) && near(a.spin ?? 0, b.spin ?? 0) && near(a.pitch ?? 0, b.pitch ?? 0);
const onlyPitch = (a: State, b: State) => near(a.roll, b.roll) && near(a.yaw, b.yaw) && near(a.spin ?? 0, b.spin ?? 0) && !near(a.pitch ?? 0, b.pitch ?? 0);
// 벽에 기댈 때의 축: 뒤쪽 아래 모서리(표지 전시 책의 책 좌표 x = 0, y = 0) 가운데
const wallPivot = (b: State) => ({ x: 0, y: 0, z: b.dims.W / 2 });
const sameRY = (a: State, b: State) => near(a.roll, b.roll) && near(a.yaw, b.yaw);
const same = (a: State, b: State) => sameRot(a, b) && near(a.t.x, b.t.x) && near(a.t.y, b.t.y) && near(a.t.z, b.t.z);

const posed = (a: State, b: State) => !near(a.yaw, b.yaw) || Math.abs(a.roll) > 45 !== Math.abs(b.roll) > 45;
const shift = (b: State, dx: number): State => ({ ...b, t: { ...b.t, x: b.t.x + dx } });

// 기울기만 바뀌는 책(발을 축으로). 부호가 바뀌면 똑바로 선 자세를 거친다.
function leanSegs(from: State, to: State, t0: number, t1: number, order: 'sync' | 'moveFirst' | 'turnFirst'): Seg[] {
  if (sameRot(from, to)) return moveSegs(from, to, t0, t1);
  if (from.roll * to.roll < 0) {
    const mid = reorientPivot(from, 0, from.yaw, pivotLocal(from.dims, from.roll));
    const tm = (t0 + t1) / 2;
    return [...leanSegs(from, mid, t0, tm, 'turnFirst'), ...leanSegs(mid, to, tm, t1, order)];
  }
  const a = pivotLocal(from.dims, to.roll !== 0 ? to.roll : from.roll);
  if (order === 'sync') return [pivotSeg(from, to, t0, t1, a)];
  const tm = t0 + (t1 - t0) * 0.45;
  if (order === 'moveFirst') {
    // 축(발)이 목표 자리로 먼저 간다: 지금 자세 그대로 옮긴 한 자세를 첫 조각의 끝이자 둘째 조각의 시작으로 쓴다
    const wa = toWorld(from, a);
    const wb = toWorld(to, a);
    const pre: State = { ...from, t: { x: from.t.x + (wb.x - wa.x), y: from.t.y + (wb.y - wa.y), z: from.t.z + (wb.z - wa.z) } };
    return [...moveSegs(from, pre, t0, tm), pivotSeg(pre, to, tm, t1, a)];
  }
  const turned = reorientPivot(from, to.roll, to.yaw, a);
  return [pivotSeg(from, turned, t0, tm, a), ...moveSegs(turned, to, tm, t1)];
}

function reorientPivot(b: State, roll: number, yaw: number, a: Vec3): State {
  const w = toWorld(b, a);
  const spin = b.spin ?? 0;
  return { id: b.id, dims: b.dims, roll, yaw, spin, t: sub3(w, rot(roll, yaw, a, spin)) };
}

// 자세가 바뀌는 책. 기댄 책이면 먼저 세우고(발 축), 정렬 al로 돌며, order에 따라 이동을 앞/뒤/함께.
function poseSegs(from: State, to: State, t0: number, t1: number, al: number, order: string): Seg[] {
  const segs: Seg[] = [];
  let b = from;
  let t = t0;
  const span = t1 - t0;
  if (Math.abs(b.pitch ?? 0) > 1e-4) {
    // 벽에 기댄 표지 책은 먼저 뒤쪽 아래 모서리를 축으로 바로 세우고 돈다
    const c = wallPivot(b);
    const w = toWorld(b, c);
    const up: State = { ...b, pitch: 0, t: sub3(w, rot(b.roll, b.yaw, c, b.spin ?? 0, 0)) };
    segs.push(pivotSeg(b, up, t, t + span * 0.2, c));
    b = up;
    t += span * 0.2;
  }
  if (Math.abs(b.spin ?? 0) > 1e-4) {
    // 비스듬히 놓인 눕힌 책은 먼저 제자리(가운데 축)에서 바로 놓고 돈다
    const c = { x: b.dims.T / 2, y: 0, z: b.dims.W / 2 };
    const w = toWorld(b, c);
    const flat: State = { ...b, spin: 0, t: sub3(w, rot(b.roll, b.yaw, c, 0)) };
    segs.push(pivotSeg(b, flat, t, t + span * 0.2, c));
    b = flat;
    t += span * 0.2;
  }
  if (!near(b.roll, 0) && Math.abs(b.roll) < 45 && !near(from.yaw, to.yaw)) {
    const up = reorientPivot(b, 0, b.yaw, pivotLocal(b.dims, b.roll));
    segs.push(pivotSeg(b, up, t, t + span * 0.15, pivotLocal(b.dims, b.roll)));
    b = up;
    t += span * 0.15;
  }
  if (order === 'together') {
    segs.push(boxSeg(b, to, t, t1, al));
    return segs;
  }
  const tm = t + (t1 - t) * 0.4;
  if (order === 'moveFirst') {
    // 목표 자리에서 돌도록: 목표를 지금 방향으로 되돌린 자리로 먼저 옮긴다
    const pre = reorient(to, b.roll, b.yaw, al, 0);
    segs.push(...moveSegs(b, pre, t, tm), boxSeg(pre, to, tm, t1, al));
    return segs;
  }
  const turned = reorient(b, to.roll, to.yaw, al);
  const tn = t + (t1 - t) * 0.6;
  segs.push(boxSeg(b, turned, t, tn, al), ...moveSegs(turned, to, tn, t1));
  return segs;
}

type Candidate = { name: string; lean: 'sync' | 'moveFirst' | 'turnFirst'; turn: [number, number]; others: [number, number]; al: number; order: string; spread: number };

function hold(b: State): Seg[] {
  return [pivotSeg(b, b, 0, 1, ZERO)];
}

export function build(prev: State[], next: State[], c: Candidate): Track[] {
  const before = new Map(prev.map((p) => [p.id, p]));
  const posers = next.filter((b) => {
    const a = before.get(b.id);
    return a && posed(a, b);
  });
  const growing = posers.some((b) => {
    const a = before.get(b.id)!;
    const wa = xRange(a);
    const wb = xRange(b);
    return wb.hi - wb.lo > wa.hi - wa.lo + 0.5;
  });
  // 옆 책이 비킬 방향: 자세를 바꾸는 책의 지금 자리 기준
  const p0 = posers.length ? before.get(posers[0].id)! : null;
  const center = p0 ? (xRange(p0).lo + xRange(p0).hi) / 2 : 0;
  return next.map((to) => {
    const from = before.get(to.id);
    if (!from) return holdTrack(to);
    let segs: Seg[];
    if (posed(from, to)) segs = poseSegs(from, to, c.turn[0], c.turn[1], c.al, c.order);
    else if (onlyPitch(from, to)) {
      // 벽에 기대기·떼기: 뒤쪽 아래 모서리를 축으로 젖히며, 그 축은 바닥을 따라 새 자리로
      segs = [pivotSeg(from, to, c.turn[0], c.turn[1], wallPivot(to))];
    } else if (sameRY(from, to) && !sameRot(from, to)) {
      // 수직축으로만 돌기(눕힌 책을 비스듬히): 가운데를 축으로, 자리 이동은 함께
      const ctr = { x: to.dims.T / 2, y: to.dims.H / 2, z: to.dims.W / 2 };
      segs = [pivotSeg(from, to, c.turn[0], c.turn[1], ctr)];
    } else if (!sameRot(from, to)) segs = leanSegs(from, to, c.turn[0], c.turn[1], c.lean);
    else if (posers.length && c.spread > 0) {
      // 옆 책: 도는 동안 대각선만큼 더 비켜 줬다가 끝에 붙는다
      const side = (xRange(from).lo + xRange(from).hi) / 2 < center ? -1 : 1;
      const mid = shift(growing ? to : from, side * c.spread);
      segs = [...moveSegs(from, mid, 0, 0.3), ...moveSegs(mid, to, 0.75, 1)];
    } else if (same(from, to)) segs = hold(to);
    else segs = moveSegs(from, to, c.others[0], c.others[1]);
    const moving = !same(from, to) || (posers.length > 0 && c.spread > 0);
    // 멈춰 있는 책은 지금 보이던 자세 객체를 그대로(다시 짜도 이 책을 읽는 계산이 돌지 않게)
    return moving ? { id: to.id, dims: to.dims, segs, moving } : holdTrack(from);
  });
}

// 그 자리에 멈춰 있는 트랙(자세 객체를 그대로 돌려준다)
export function holdTrack(b: State): Track {
  return { id: b.id, dims: b.dims, segs: hold(b), moving: false, rest: b };
}

// 경로 전체를 세로로 dy만큼 옮긴 것(다른 줄 좌표로 볼 때: 줄 사이는 세로 거리만 다르다)
export function shiftTrack(tr: Track, dy: number): Track {
  const segs = tr.segs.map((s) => (s.kind === 1 ? { ...s, b0: s.b0 + dy, b1: s.b1 + dy } : { ...s, w0: { ...s.w0, y: s.w0.y + dy }, w1: { ...s.w1, y: s.w1.y + dy } }));
  return { ...tr, segs, rest: tr.rest ? { ...tr.rest, t: { ...tr.rest.t, y: tr.rest.t.y + dy } } : undefined };
}

// 다른 줄로 떠난 책이 떠난 줄에 남기는 그림자 경로(떠난 줄 좌표): 도착 줄 경로 tr을 세로로 옮겨 출발 자세가 떠날 때 자세 src와 같게 한다.
// k: 실제 시간 비율 u(0~1, 진행은 ease(u))에서 그 줄에 그림자가 더는 없는(gone) 첫 u. 끝까지 남으면 1.
// 출발 자세가 가로·깊이로 어긋나면(같은 책의 경로가 아니면) null.
export function awayTrack(tr: Track, src: Book3, ease: (u: number) => number, gone: (b: Book3) => boolean): { track: Track; k: number } | null {
  const start = bookAt(tr, 0);
  if (Math.abs(start.t.x - src.t.x) > 0.5 || Math.abs(start.t.z - src.t.z) > 0.5) return null;
  const track = shiftTrack(tr, src.t.y - start.t.y);
  for (let i = 1; i <= 48; i++) if (gone(bookAt(track, ease(i / 48)))) return { track, k: i / 48 };
  return { track, k: 1 };
}

// ---------- 앞으로 빼서 옮기기 ----------
// 다른 줄에서 들어오는 책, 또는 같은 줄에서 다른 경로가 모두 막혔을 때: 살짝 들고 → 선반 앞(판 앞 끝 밖)으로 빼고 →
// 그 앞에서 옮기며(자세를 바꿔야 하면 여기서 돈다) → 목표 자리 앞에서 밀어 넣고 → 내려놓는다.
// 빼낸 동안은 모든 책·선반 판보다 앞이라 부딪히지 않고, 바닥이 판 윗면보다 높아 판을 뚫지 않는다.
export const PULL_LIFT = 6; // 들어 올리는 높이(DU)
const PULL_MARGIN = 2; // 판 앞 끝과 빼낸 책 사이(DU)

function zRange(b: State) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const z = toWorld(b, cornerLocal(b.dims, i)).z;
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  }
  return { lo, hi };
}

// 돌리는 동안(방향 a → b 선형 보간) 깊이 폭의 최댓값
function sweepDepth(a: State, b: State) {
  let d = 0;
  for (let k = 0; k <= 8; k++) {
    const u = k / 8;
    const e = extent(a.dims, a.roll + (b.roll - a.roll) * u, a.yaw + (b.yaw - a.yaw) * u, (a.spin ?? 0) + ((b.spin ?? 0) - (a.spin ?? 0)) * u, (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * u);
    let z1 = -Infinity;
    for (let i = 0; i < 8; i++) z1 = Math.max(z1, rot(a.roll + (b.roll - a.roll) * u, a.yaw + (b.yaw - a.yaw) * u, cornerLocal(a.dims, i), (a.spin ?? 0) + ((b.spin ?? 0) - (a.spin ?? 0)) * u, (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * u).z);
    d = Math.max(d, z1 - e.z0);
  }
  return d;
}

const lifted = (b: State, dy: number): State => ({ ...b, t: { x: b.t.x, y: b.t.y + dy, z: b.t.z } });
// 가장 앞(z 최소)이 front에 오도록 앞으로 뺀 자세
const pulledTo = (b: State, front: number, dy: number): State => ({ ...b, t: { x: b.t.x, y: b.t.y + dy, z: b.t.z + (front - zRange(b).lo) } });

// lane: 몇 번째 차선(여러 권을 함께 뺄 때 서로 부딪히지 않게 앞뒤로 비켜 둔다)
export function pullSegs(from: State, to: State, t0: number, t1: number, lane = 0): Seg[] {
  const span = t1 - t0;
  const at = (u: number) => t0 + span * u;
  const turn = !sameRot(from, to);
  const depth = turn ? sweepDepth(from, to) : Math.max(zRange(from).hi - zRange(from).lo, zRange(to).hi - zRange(to).lo);
  const back = -SHELF_FRONT - PULL_MARGIN - lane * (depth + PULL_MARGIN);
  const front = back - depth;
  const up0 = lifted(from, PULL_LIFT);
  const out0 = pulledTo(from, front, PULL_LIFT);
  const out1 = pulledTo(to, front, PULL_LIFT);
  const up1 = lifted(to, PULL_LIFT);
  const mid: Seg = turn ? boxSeg(out0, out1, at(0.3), at(0.7), 0.5) : pivotSeg(out0, out1, at(0.3), at(0.7), ZERO);
  return [pivotSeg(from, up0, t0, at(0.1), ZERO), pivotSeg(up0, out0, at(0.1), at(0.3), ZERO), mid, pivotSeg(out1, up1, at(0.7), at(0.9), ZERO), pivotSeg(up1, to, at(0.9), t1, ZERO)];
}

export function candidates(growing: boolean, posing: boolean): Candidate[] {
  const all = [0, 1] as [number, number];
  if (!posing) {
    const base = { al: 0, order: 'together', spread: 0 };
    return [
      { name: 'A', lean: 'sync', turn: all, others: all, ...base },
      { name: 'B-room', lean: 'moveFirst', turn: [0.4, 1], others: [0, 0.5], ...base },
      { name: 'B-close', lean: 'turnFirst', turn: [0, 0.6], others: [0.5, 1], ...base },
      { name: 'C', lean: 'moveFirst', turn: all, others: [0.3, 0.7], ...base },
    ];
  }
  const out: Candidate[] = [];
  const others: [number, number] = growing ? [0, 0.35] : [0.65, 1];
  const turn: [number, number] = growing ? [0.25, 1] : [0, 0.75];
  for (const spread of [0, 4, 8])
    for (const al of [0, 1, 0.5])
      for (const order of ['together', 'moveFirst', 'turnFirst'])
        out.push({ name: `${order}-al${al}-s${spread}`, lean: 'sync', turn: spread ? [0.25, 0.8] : turn, others, al, order, spread });
  // 제자리에서 돌 수 없으면(쌓인 책 아래·빽빽한 선반) 대신하는 경로(pullPlan)가 들어 올려 앞으로 빼서 돌린다
  return out;
}

// ---------- 검사 ----------

const MARGIN = 0.25; // 이만큼 파고드는 것까지는 맞닿음·계산 오차로 본다
export const SAMPLES = 48;

// 처음 겹치는 곳(없으면 null). 균등 시점(바닥·선반 끝) + 책 쌍마다 구간 검사:
// 구간 양 끝의 틈에서 그 사이 두 책이 움직인 거리를 빼도 겹칠 수 없으면 통과, 아니면 반씩 나눠 더 본다(적응형).
export function firstOverlap(tracks: Track[], bounds?: { min: number; max: number }, deadline = Infinity) {
  const n = tracks.length;
  if (!tracks.some((t) => t.moving)) return null;
  const late = () => deadline < Infinity && Date.now() > deadline;
  const bodies = new Map<number, Book3[]>();
  const pts = new Map<number, Vec3[][]>();
  const at = (t: number) => {
    let v = bodies.get(t);
    if (!v) {
      v = tracks.map((tr) => bookAt(tr, t));
      bodies.set(t, v);
    }
    return v;
  };
  const cornersAt = (t: number) => {
    let v = pts.get(t);
    if (!v) {
      v = at(t).map((b) => corners(b));
      pts.set(t, v);
    }
    return v;
  };
  const disp = (i: number, a: number, b: number) => {
    if (!tracks[i].moving) return 0;
    const pa = cornersAt(a)[i];
    const pb = cornersAt(b)[i];
    let m = 0;
    for (let k = 0; k < 8; k++) m = Math.max(m, Math.hypot(pa[k].x - pb[k].x, pa[k].y - pb[k].y, pa[k].z - pb[k].z));
    return m * 1.1; // 회전하면 가운데가 현보다 조금 더 나간다
  };
  for (let k = 0; k <= SAMPLES; k++) {
    const t = k / SAMPLES;
    const bs = at(t);
    for (let i = 0; i < n; i++) {
      if (!tracks[i].moving) continue;
      if (lowest(bs[i]) < -0.05) return { t, a: tracks[i].id, b: 'floor' };
      if (bounds && Math.abs(bs[i].roll) < 45) {
        const r = xRange(bs[i]);
        // 판 앞 끝보다 앞으로 빼낸 책은 판 끝 범위와 상관없다(선반 앞 허공에서 옮긴다)
        let zhi = -Infinity;
        for (const c of cornersAt(t)[i]) zhi = Math.max(zhi, c.z);
        if (zhi > -SHELF_FRONT && (r.lo < bounds.min - 0.5 || r.hi > bounds.max + 0.5)) return { t, a: tracks[i].id, b: 'bounds' };
      }
      // 벽을 뚫거나, 판 윗면 높이에 있으면서 판 앞 끝 밖으로 나가(허공) 있으면 안 된다(빼낸 책은 들어 올려 판보다 높다)
      for (const c of cornersAt(t)[i]) {
        if (c.z > SHELF_DEPTH + 0.3) return { t, a: tracks[i].id, b: 'wall' };
        if (c.y < 0.5 && c.z < -SHELF_FRONT - 0.3) return { t, a: tracks[i].id, b: 'edge' };
      }
    }
  }
  const pairGap = (i: number, j: number, t: number) => gap(at(t)[i], at(t)[j]);
  const safe = (i: number, j: number, a: number, b: number, ga: number, gb: number, depth: number): number | null => {
    if (ga < -MARGIN) return a;
    if (gb < -MARGIN) return b;
    if (Math.min(ga, gb) - (disp(i, a, b) + disp(j, a, b)) / 2 >= -MARGIN || depth <= 0) return null;
    const m = (a + b) / 2;
    const gm = pairGap(i, j, m);
    return safe(i, j, a, m, ga, gm, depth - 1) ?? safe(i, j, m, b, gm, gb, depth - 1);
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (!tracks[i].moving && !tracks[j].moving) continue;
      if (late()) return { t: 0, a: tracks[i].id, b: 'timeout' };
      let prev = pairGap(i, j, 0);
      for (let k = 1; k <= SAMPLES; k++) {
        const t = k / SAMPLES;
        const g = pairGap(i, j, t);
        const hit = safe(i, j, (k - 1) / SAMPLES, t, prev, g, 6);
        if (hit !== null) return { t: hit, a: tracks[i].id, b: tracks[j].id };
        prev = g;
      }
    }
  return null;
}

// 경로 계획: 후보 경로를 차례로 검사해 처음 통과하는 것을 쓴다. 시간 안에 못 찾거나 모두 막히면 앞으로 빼서 옮기는 경로로
// 대신한다(순간 이동하거나 가능한 배치를 '자리 없음'으로 거절하지 않는다).
// arrive: 이 줄에 없던 책의 지금 자세(다른 줄에서 옮겨 오는 중이면 그 줄에서 보이던 자세를 이 줄 좌표로). 있으면 거기서 이어서 들어온다.
export type PlanOptions = { budgetMs?: number; arrive?: Record<string, State> };
export function planTransition(prev: State[], next: State[], bounds?: { min: number; max: number }, opts: PlanOptions = {}): Plan {
  const arrive = opts.arrive ?? {};
  const inPrev = new Set(prev.map((p) => p.id));
  const extra = next.filter((b) => !inPrev.has(b.id) && arrive[b.id]).map((b) => arrive[b.id]);
  const all = extra.length ? [...prev, ...extra] : prev;
  const before = new Map(all.map((p) => [p.id, p]));
  const changed = next.filter((b) => {
    const a = before.get(b.id);
    return a && !same(a, b);
  });
  if (!changed.length) return { tracks: build(all, next, candidates(false, false)[0]), strategy: 'still' };
  const deadline = Date.now() + (opts.budgetMs ?? 40);
  // 다른 줄에서 들어오는 책은 늘 앞으로 빼서 들어온다(판을 뚫고 지나가지 않게)
  const arriving = new Set(extra.map((b) => b.id));
  const withArrivals = (tracks: Track[]) =>
    arriving.size ? tracks.map((tr) => (arriving.has(tr.id) ? { id: tr.id, dims: tr.dims, segs: pullSegs(before.get(tr.id)!, next.find((b) => b.id === tr.id)!, 0, 1), moving: true } : tr)) : tracks;
  const posers = next.filter((b) => {
    const a = before.get(b.id);
    return a && !arriving.has(b.id) && posed(a, b);
  });
  const growing = posers.some((b) => {
    const a = before.get(b.id)!;
    return xRange(b).hi - xRange(b).lo > xRange(a).hi - xRange(a).lo + 0.5;
  });
  for (const c of candidates(growing, posers.length > 0)) {
    const tracks = withArrivals(build(all, next, c));
    const hit = firstOverlap(tracks, bounds, deadline);
    if (!hit) return { tracks, strategy: c.name };
    if (hit.b === 'timeout' || Date.now() > deadline) break;
  }
  return { tracks: pullPlan(all, next, arriving), strategy: 'pull' };
}

// 대신하는 경로(후보가 모두 막혔거나 시간이 다 됐을 때, 다른 줄에서 들어오는 책): 자리가 크게 바뀌는 책을 선반 앞으로 빼서 옮긴다.
// 빼낼 책 = 자세가 바뀌는 책, 다른 책을 건너가는 책, 다른 줄에서 오는 책 + 그 위에 쌓여 있던 책 + 빼거나 밀어 넣는 길(상자를 앞으로
// 늘인 곳)을 막는 책(잠깐 빼 두었다가 다시 넣는다). 앞쪽(쌓였으면 위쪽) 책부터 한 권씩 빼고(먼저 뺀 책이 더 먼 차선이라 뒤에 빼는 책이
// 지나가지 않는다), 모두 빠진 동안 선반 앞에서 옮기고 옆 책이 제자리에서 밀린 뒤, 뺀 순서의 반대로 밀어 넣는다.
type Box3 = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
function box3(b: State): Box3 {
  const r: Box3 = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let i = 0; i < 8; i++) {
    const c = toWorld(b, cornerLocal(b.dims, i));
    r.x0 = Math.min(r.x0, c.x);
    r.x1 = Math.max(r.x1, c.x);
    r.y0 = Math.min(r.y0, c.y);
    r.y1 = Math.max(r.y1, c.y);
    r.z0 = Math.min(r.z0, c.z);
    r.z1 = Math.max(r.z1, c.z);
  }
  return r;
}
const overlap1 = (a0: number, a1: number, b0: number, b1: number, m = 0.3) => a0 < b1 - m && b0 < a1 - m;
// 상자 b를 들어 올린 높이에서 선반 앞까지 늘인 길(빼는 길·밀어 넣는 길)에 o가 걸리는가
function inCorridor(b: State, o: Box3) {
  const r = box3(lifted(b, PULL_LIFT));
  return overlap1(r.x0, r.x1, o.x0, o.x1) && overlap1(r.y0, r.y1, o.y0, o.y1) && overlap1(-SHELF_FRONT - PULL_MARGIN, r.z0, o.z0, o.z1);
}
// o가 b 위에 얹혀 있는가(o 바닥 = b 윗면, 바닥 면이 겹친다)
function restsOn(o: State, b: State) {
  const ro = box3(o);
  const rb = box3(b);
  return Math.abs(ro.y0 - rb.y1) < 0.8 && overlap1(ro.x0, ro.x1, rb.x0, rb.x1) && overlap1(ro.z0, ro.z1, rb.z0, rb.z1);
}

function pullPlan(prev: State[], next: State[], arriving: Set<string>): Track[] {
  const before = new Map(prev.map((p) => [p.id, p]));
  const after = new Map(next.map((p) => [p.id, p]));
  const cx = (b: State) => {
    const r = xRange(b);
    return (r.lo + r.hi) / 2;
  };
  const movers = new Set<string>(arriving);
  const moved = next.filter((b) => before.has(b.id));
  for (const b of moved) if (posed(before.get(b.id)!, b)) movers.add(b.id);
  // 순서가 바뀌는 책: 앞뒤 자세의 가운데 x 순서가 다른 쌍에 든 책 중 더 많이 움직인 쪽
  for (let i = 0; i < moved.length; i++)
    for (let j = i + 1; j < moved.length; j++) {
      const a0 = cx(before.get(moved[i].id)!);
      const b0 = cx(before.get(moved[j].id)!);
      const a1 = cx(moved[i]);
      const b1 = cx(moved[j]);
      if ((a0 - b0) * (a1 - b1) >= 0) continue;
      movers.add(Math.abs(a1 - a0) >= Math.abs(b1 - b0) ? moved[i].id : moved[j].id);
    }
  // 위에 쌓여 있던 책과 길을 막는 책을 더한다(더할 것이 없을 때까지)
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of moved) {
      if (movers.has(b.id)) continue;
      const from = before.get(b.id)!;
      const fb = box3(from);
      const tb = box3(b);
      for (const id of movers) {
        const mf = before.get(id);
        const mt = after.get(id)!;
        const hit = (mf && !arriving.has(id) && (restsOn(from, mf) || inCorridor(mf, fb))) || inCorridor(mt, tb) || inCorridor(mt, fb);
        if (hit) {
          movers.add(b.id);
          grew = true;
          break;
        }
      }
    }
  }
  // 빼는 순서(넣는 순서는 그 반대). x가 y보다 먼저 빠져야 하는 경우:
  //   x가 y 위에 얹혀 있다 · x가 y의 빼는 길을 막는다 · (넣을 때) y가 x 위에 얹힌다 · x의 목표 자리가 y의 밀어 넣는 길에 있다(y가 먼저 들어가야 한다).
  // 이 제약으로 위상 정렬하고, 같으면 앞쪽(z가 작은) 책부터. 다른 줄에서 오는 책은 이미 이 줄 밖이라 빼는 길이 없다.
  const list = next.filter((b) => movers.has(b.id) && before.has(b.id));
  const firstOut = (x: State, y: State) => {
    const xf = before.get(x.id)!;
    const yf = before.get(y.id)!;
    const outX = !arriving.has(x.id);
    const outY = !arriving.has(y.id);
    return (outX && outY && (restsOn(xf, yf) || inCorridor(yf, box3(xf)))) || restsOn(y, x) || inCorridor(y, box3(x));
  };
  const zOf = (b: State) => (arriving.has(b.id) ? Infinity : box3(before.get(b.id)!).z0);
  const order: State[] = [];
  const left = [...list];
  while (left.length) {
    // 먼저 빠져야 할 책이 남아 있지 않은 것 중 가장 앞쪽(순환이면 가장 앞쪽 아무거나)
    const free = left.filter((y) => !left.some((x) => x !== y && firstOut(x, y)));
    const pool = free.length ? free : left;
    pool.sort((a, b) => zOf(a) - zOf(b));
    const pick = pool[0];
    order.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  // 차선: 마지막에 빼는 책이 판에 가장 가깝다. 도는 동안의 깊이까지 비워 둔다.
  const lanes = new Map<string, number>();
  let back = -SHELF_FRONT - PULL_MARGIN;
  for (let i = order.length - 1; i >= 0; i--) {
    const to = order[i];
    const from = before.get(to.id)!;
    const depth = !sameRot(from, to) ? sweepDepth(from, to) : Math.max(zRange(from).hi - zRange(from).lo, zRange(to).hi - zRange(to).lo);
    lanes.set(to.id, back - depth);
    back = back - depth - PULL_MARGIN;
  }
  const k = Math.max(1, order.length);
  const OUT = 0.4;
  const IN = 0.6;
  const slot = OUT / k;
  const tracks = new Map<string, Track>();
  order.forEach((to, j) => {
    const from = before.get(to.id)!;
    const front = lanes.get(to.id)!;
    const up0 = lifted(from, PULL_LIFT);
    const out0 = pulledTo(from, front, PULL_LIFT);
    const out1 = pulledTo(to, front, PULL_LIFT);
    const up1 = lifted(to, PULL_LIFT);
    const o0 = slot * j;
    const i0 = IN + slot * (k - 1 - j);
    const mid: Seg = !sameRot(from, to) ? boxSeg(out0, out1, OUT, IN, 0.5) : pivotSeg(out0, out1, OUT, IN, ZERO);
    const segs = [pivotSeg(from, up0, o0, o0 + slot * 0.3, ZERO), pivotSeg(up0, out0, o0 + slot * 0.3, o0 + slot, ZERO), mid, pivotSeg(out1, up1, i0, i0 + slot * 0.7, ZERO), pivotSeg(up1, to, i0 + slot * 0.7, i0 + slot, ZERO)];
    tracks.set(to.id, { id: to.id, dims: to.dims, segs, moving: true });
  });
  return next.map((to) => {
    const tr = tracks.get(to.id);
    if (tr) return tr;
    const from = before.get(to.id);
    if (!from || same(from, to)) return holdTrack(from ?? to);
    // 제자리에서 밀리는 책: 빼낸 책이 모두 선반 앞에 있는 동안
    return { id: to.id, dims: to.dims, segs: moveSegs(from, to, OUT, IN), moving: true };
  });
}
