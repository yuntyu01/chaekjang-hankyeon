// 배치 전환 경로(순수, UI 스레드 워클릿에서도 쓴다). 한 동작 = 관련 책 전부의 3D 자세를 공통 진행률 t(0→1)로 푸는 경로.
// 입력은 "지금 화면에 보이는 자세"(움직이는 도중이면 그 보간값)와 목표 자세. 끝 모습만 맞추면 도중에 겹칠 수 있으므로
// 후보 경로를 t 전 구간에서 3D 충돌로 검사해(접촉에 가까운 구간은 촘촘히) 처음 통과하는 것을 쓴다. 통과하는 경로가 없으면 null.
//
// 기울이기: 기우는 쪽 바닥 모서리(발)를 축으로(pivot). 자세 바꾸기(표지로·눕히기): 도는 동안 책이 차지하는 가로 범위를 한쪽(또는 가운데)에
// 맞추고 가장 낮은 점을 받침에 댄 채 돈다(box). 도는 도중에는 대각선만큼 폭이 잠깐 커지므로, 옆 책이 그만큼 더 비켜 줬다가 끝에 붙는다.
// 높이가 바뀌는 이동(쌓인 책 내리기)은 L자로 나눠 대각선으로 다른 책을 가로지르지 않게 한다.
import { cornerLocal, corners, gap, lowest, pivotLocal, rot, sub3, toWorld, xRange, type Book3, type Vec3 } from './book3';

// kind 0 = pivot(기준점 a의 월드 위치를 w0→w1), 1 = box(가로 정렬 al의 x를 x0→x1, 가장 낮은 y를 b0→b1, 가장 앞 z를 z0→z1)
export type Seg = {
  kind: number;
  t0: number;
  t1: number;
  r0: number;
  r1: number;
  y0: number;
  y1: number;
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
export type Track = { id: string; dims: Book3['dims']; segs: Seg[]; moving: boolean };
export type Plan = { tracks: Track[]; strategy: string };

const ZERO = { x: 0, y: 0, z: 0 };

function clamp01(v: number) {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 방향(roll, yaw)으로 돌린 상자(이동 전)의 범위
export function extent(dims: Book3['dims'], roll: number, yaw: number) {
  'worklet';
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  for (let i = 0; i < 8; i++) {
    const p = rot(roll, yaw, cornerLocal(dims, i));
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.z < z0) z0 = p.z;
  }
  return { x0, x1, y0, z0 };
}

export function bookAt(tr: Track, t: number): Book3 {
  'worklet';
  const segs = tr.segs;
  let s = segs[0];
  for (let i = 0; i < segs.length; i++) {
    s = segs[i];
    if (t <= segs[i].t1) break;
  }
  const u = s.t1 > s.t0 ? clamp01((t - s.t0) / (s.t1 - s.t0)) : t >= s.t1 ? 1 : 0;
  const roll = s.r0 + (s.r1 - s.r0) * u;
  const yaw = s.y0 + (s.y1 - s.y0) * u;
  if (s.kind === 1) {
    const e = extent(tr.dims, roll, yaw);
    const ax = s.x0 + (s.x1 - s.x0) * u;
    return {
      id: tr.id,
      dims: tr.dims,
      roll,
      yaw,
      t: { x: ax - (e.x0 + (e.x1 - e.x0) * s.al), y: s.b0 + (s.b1 - s.b0) * u - e.y0, z: s.z0 + (s.z1 - s.z0) * u - e.z0 },
    };
  }
  const w = { x: s.w0.x + (s.w1.x - s.w0.x) * u, y: s.w0.y + (s.w1.y - s.w0.y) * u, z: s.w0.z + (s.w1.z - s.w0.z) * u };
  return { id: tr.id, dims: tr.dims, roll, yaw, t: sub3(w, rot(roll, yaw, s.a)) };
}

// ---------- 경로 조각 ----------

type State = Book3;

const blank = { al: 0, x0: 0, x1: 0, b0: 0, b1: 0, z0: 0, z1: 0 };

function pivotSeg(b0: State, b1: State, t0: number, t1: number, a: Vec3): Seg {
  return { kind: 0, t0, t1, r0: b0.roll, r1: b1.roll, y0: b0.yaw, y1: b1.yaw, a, w0: toWorld(b0, a), w1: toWorld(b1, a), ...blank };
}

function boxOf(b: State, al: number) {
  const e = extent(b.dims, b.roll, b.yaw);
  return { x: b.t.x + e.x0 + (e.x1 - e.x0) * al, y: b.t.y + e.y0, z: b.t.z + e.z0 };
}

function boxSeg(b0: State, b1: State, t0: number, t1: number, al: number): Seg {
  const p = boxOf(b0, al);
  const q = boxOf(b1, al);
  return { kind: 1, t0, t1, r0: b0.roll, r1: b1.roll, y0: b0.yaw, y1: b1.yaw, a: ZERO, w0: ZERO, w1: ZERO, al, x0: p.x, x1: q.x, b0: p.y, b1: q.y, z0: p.z, z1: q.z };
}

// 방향 b.roll·b.yaw를 (roll, yaw)로 바꾸되 정렬 기준(al)의 가로 위치·바닥·앞면은 그대로
function reorient(b: State, roll: number, yaw: number, al: number): State {
  const p = boxOf(b, al);
  const e = extent(b.dims, roll, yaw);
  return { id: b.id, dims: b.dims, roll, yaw, t: { x: p.x - (e.x0 + (e.x1 - e.x0) * al), y: p.y - e.y0, z: p.z - e.z0 } };
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
const sameRot = (a: State, b: State) => near(a.roll, b.roll) && near(a.yaw, b.yaw);
const same = (a: State, b: State) => sameRot(a, b) && near(a.t.x, b.t.x) && near(a.t.y, b.t.y) && near(a.t.z, b.t.z);
function depthOf(b: State) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const z = rot(b.roll, b.yaw, cornerLocal(b.dims, i)).z;
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  }
  return hi - lo;
}

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
    const pre = shift(from, toWorld(to, a).x - toWorld(from, a).x);
    return [...moveSegs(from, { ...pre, t: { ...pre.t, y: to.t.y + (pre.t.y - from.t.y), z: pre.t.z } }, t0, tm), pivotSeg(pre, to, tm, t1, a)];
  }
  const turned = reorientPivot(from, to.roll, to.yaw, a);
  return [pivotSeg(from, turned, t0, tm, a), ...moveSegs(turned, to, tm, t1)];
}

function reorientPivot(b: State, roll: number, yaw: number, a: Vec3): State {
  const w = toWorld(b, a);
  return { id: b.id, dims: b.dims, roll, yaw, t: sub3(w, rot(roll, yaw, a)) };
}

// 자세가 바뀌는 책. 기댄 책이면 먼저 세우고(발 축), 정렬 al로 돌며, order에 따라 이동을 앞/뒤/함께.
function poseSegs(from: State, to: State, t0: number, t1: number, al: number, order: string): Seg[] {
  const segs: Seg[] = [];
  let b = from;
  let t = t0;
  const span = t1 - t0;
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
  if (order === 'pull') {
    // 앞으로 빼내고(다른 책보다 앞, 깊이가 겹치지 않게) → 그 앞에서 돌며 옮기고 → 밀어 넣는다
    const pulled = (x: State): State => ({ ...x, t: { ...x.t, z: x.t.z - (boxOf(x, 0).z + depthOf(x) + 1) } });
    const A = pulled(b);
    const B = pulled(to);
    const ta = t + (t1 - t) * 0.22;
    const tb = t + (t1 - t) * 0.78;
    segs.push(pivotSeg(b, A, t, ta, ZERO), boxSeg(A, B, ta, tb, al), pivotSeg(B, to, tb, t1, ZERO));
    return segs;
  }
  const tm = t + (t1 - t) * 0.4;
  if (order === 'moveFirst') {
    // 목표 자리에서 돌도록: 목표를 지금 방향으로 되돌린 자리로 먼저 옮긴다
    const pre = reorient(to, b.roll, b.yaw, al);
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
    if (!from) return { id: to.id, dims: to.dims, segs: hold(to), moving: false };
    let segs: Seg[];
    if (posed(from, to)) segs = poseSegs(from, to, c.turn[0], c.turn[1], c.al, c.order);
    else if (!sameRot(from, to)) segs = leanSegs(from, to, c.turn[0], c.turn[1], c.lean);
    else if (posers.length && c.spread > 0) {
      // 옆 책: 도는 동안 대각선만큼 더 비켜 줬다가 끝에 붙는다
      const side = (xRange(from).lo + xRange(from).hi) / 2 < center ? -1 : 1;
      const mid = shift(growing ? to : from, side * c.spread);
      segs = [...moveSegs(from, mid, 0, 0.3), ...moveSegs(mid, to, 0.75, 1)];
    } else if (same(from, to)) segs = hold(to);
    else segs = moveSegs(from, to, c.others[0], c.others[1]);
    return { id: to.id, dims: to.dims, segs, moving: !same(from, to) || (posers.length > 0 && c.spread > 0) };
  });
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
  // 제자리에서 돌 수 없을 때(쌓인 책 아래·빽빽한 선반): 앞으로 빼내서 돌린다
  for (const g of [growing, !growing])
    for (const al of [0.5, 0, 1]) {
      out.push({ name: `pull-al${al}`, lean: 'sync', turn: g ? [0.1, 1] : [0, 0.85], others: g ? [0, 0.35] : [0.6, 1], al, order: 'pull', spread: 0 });
      out.push({ name: `pull-late-al${al}`, lean: 'sync', turn: g ? [0, 0.9] : [0, 0.6], others: g ? [0.1, 0.5] : [0.55, 1], al, order: 'pull', spread: 0 });
    }
  return out;
}

// ---------- 검사 ----------

const MARGIN = 0.25; // 이만큼 파고드는 것까지는 맞닿음·계산 오차로 본다
export const SAMPLES = 48;

// 처음 겹치는 곳(없으면 null). 균등 시점(바닥·선반 끝) + 책 쌍마다 구간 검사:
// 구간 양 끝의 틈에서 그 사이 두 책이 움직인 거리를 빼도 겹칠 수 없으면 통과, 아니면 반씩 나눠 더 본다(적응형).
export function firstOverlap(tracks: Track[], bounds?: { min: number; max: number }) {
  const n = tracks.length;
  if (!tracks.some((t) => t.moving)) return null;
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
        if (r.lo < bounds.min - 0.5 || r.hi > bounds.max + 0.5) return { t, a: tracks[i].id, b: 'bounds' };
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

// 경로 계획. 아무 후보도 통과하지 못하면 null(자세를 바꾸지 말고 안내).
export function planTransition(prev: State[], next: State[], bounds?: { min: number; max: number }): Plan | null {
  const before = new Map(prev.map((p) => [p.id, p]));
  const changed = next.filter((b) => {
    const a = before.get(b.id);
    return a && !same(a, b);
  });
  if (!changed.length) return { tracks: build(prev, next, candidates(false, false)[0]), strategy: 'still' };
  const posers = next.filter((b) => {
    const a = before.get(b.id);
    return a && posed(a, b);
  });
  const growing = posers.some((b) => {
    const a = before.get(b.id)!;
    return xRange(b).hi - xRange(b).lo > xRange(a).hi - xRange(a).lo + 0.5;
  });
  for (const c of candidates(growing, posers.length > 0)) {
    const tracks = build(prev, next, c);
    if (!firstOverlap(tracks, bounds)) return { tracks, strategy: c.name };
  }
  return null;
}
