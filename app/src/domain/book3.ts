// 책 상자의 3D 자세(순수, UI 스레드 워클릿에서도 쓴다).
// 책 좌표: 세운 책(책등이 앞)을 기준으로 x = 두께 T(왼쪽 뒤표지 → 오른쪽 앞표지), y = 세로 H(아래 → 위), z = 표지 폭 W(앞 책등 → 뒤 책배).
// 방향(합성 순서 고정): ① 책 세로축으로 yaw(+90 = 앞표지가 앞으로 오고 책등은 왼쪽) → ② 앞뒤축으로 roll(+ = 시계 방향, 오른쪽으로 기울기)
//   → ③ 선반의 수직축으로 spin(+ = 오른쪽 끝이 벽 쪽으로 물러남, 위에서 보아 반시계). 기대기(roll)·자세(yaw/roll)·비스듬히 놓기(spin)는 따로 다룬다.
//   세움 = (roll 기대기 각, yaw 0), 눕힘 = (roll -90: 책등이 앞, 앞표지가 위, 뒤표지가 받침, 머리가 왼쪽), 표지 전시 = (roll 0, yaw 90: 앞표지가 앞, 아래 면이 받침).
// 선반 공간(월드): x 오른쪽, y 위, z 벽 쪽. 월드 점 = R·책좌표 + t.
// 워클릿은 만들어질 때 쓰는 함수를 붙잡으므로, 쓰이는 함수를 먼저 정의한다.
import type { Placed } from './box';
import type { Pose } from './types';

export type Vec3 = { x: number; y: number; z: number };
export type Dims = { T: number; H: number; W: number };
export type Book3 = { id: string; dims: Dims; roll: number; yaw: number; t: Vec3; spin?: number };

export function rot(roll: number, yaw: number, v: Vec3, spin = 0): Vec3 {
  'worklet';
  if (spin) {
    const r = rot(roll, yaw, v, 0);
    const c = (spin * Math.PI) / 180;
    const cs = Math.cos(c);
    const sn = Math.sin(c);
    return { x: r.x * cs - r.z * sn, y: r.y, z: r.x * sn + r.z * cs };
  }
  const b = (yaw * Math.PI) / 180;
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const x1 = v.x * cb + v.z * sb;
  const z1 = -v.x * sb + v.z * cb;
  const a = (-roll * Math.PI) / 180; // 시계 방향 + → 수학 각은 -
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return { x: x1 * ca - v.y * sa, y: x1 * sa + v.y * ca, z: z1 };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  'worklet';
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  'worklet';
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function toWorld(b: Book3, v: Vec3): Vec3 {
  'worklet';
  return add(rot(b.roll, b.yaw, v, b.spin ?? 0), b.t);
}

// 꼭짓점 번호 = xi + 2*yi + 4*zi (xi: 0이면 x=0, 1이면 x=T …)
export function cornerLocal(d: Dims, i: number): Vec3 {
  'worklet';
  return { x: i & 1 ? d.T : 0, y: i & 2 ? d.H : 0, z: i & 4 ? d.W : 0 };
}

export function corners(b: Book3): Vec3[] {
  'worklet';
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) out.push(toWorld(b, cornerLocal(b.dims, i)));
  return out;
}

// 면: 책 좌표의 바깥 법선, 꼭짓점 네 개, 그림을 붙일 때의 원점·가로(U)·세로(V) 축(그림 픽셀 → 책 좌표)
export type FaceId = 'spine' | 'cover' | 'back' | 'head' | 'tail' | 'fore';
export const FACE_IDS: FaceId[] = ['spine', 'cover', 'back', 'head', 'tail', 'fore'];

export function faceNormal(f: FaceId): Vec3 {
  'worklet';
  if (f === 'spine') return { x: 0, y: 0, z: -1 };
  if (f === 'cover') return { x: 1, y: 0, z: 0 };
  if (f === 'back') return { x: -1, y: 0, z: 0 };
  if (f === 'head') return { x: 0, y: 1, z: 0 };
  if (f === 'tail') return { x: 0, y: -1, z: 0 };
  return { x: 0, y: 0, z: 1 };
}

export function faceCorners(f: FaceId): number[] {
  'worklet';
  if (f === 'spine') return [0, 1, 3, 2];
  if (f === 'cover') return [1, 5, 7, 3];
  if (f === 'back') return [0, 2, 6, 4];
  if (f === 'head') return [2, 3, 7, 6];
  if (f === 'tail') return [0, 4, 5, 1];
  return [4, 6, 7, 5];
}

// 그림 좌표계(원점 = 그림 왼쪽 위, U = 그림 가로 끝까지, V = 그림 세로 끝까지). 책등: 두께×세로, 앞표지: 표지 폭×세로(책등 쪽이 왼쪽).
export function faceFrame(d: Dims, f: 'spine' | 'cover'): { O: Vec3; U: Vec3; V: Vec3; w: number; h: number } {
  'worklet';
  if (f === 'spine') return { O: { x: 0, y: d.H, z: 0 }, U: { x: d.T, y: 0, z: 0 }, V: { x: 0, y: -d.H, z: 0 }, w: d.T, h: d.H };
  return { O: { x: d.T, y: d.H, z: 0 }, U: { x: 0, y: 0, z: d.W }, V: { x: 0, y: -d.H, z: 0 }, w: d.W, h: d.H };
}

// 카메라(직교 + 사선): 깊이 1이 화면 오른쪽 kx, 위 ky. 보이는 면 = 법선이 (kx, ky, -1) 쪽을 향함.
export type Cam = { kx: number; ky: number };

export function facing(cam: Cam, b: Book3, f: FaceId) {
  'worklet';
  const n = rot(b.roll, b.yaw, faceNormal(f), b.spin ?? 0);
  const l = Math.hypot(cam.kx, cam.ky, 1);
  return (n.x * cam.kx + n.y * cam.ky - n.z) / l;
}

// 광원(램버트): 밝기 = ambient + diffuse·(n·L), [min, max]로 제한
export type Light = { dir: Vec3; ambient: number; diffuse: number; min: number; max: number };

export function brightness(light: Light, b: Book3, f: FaceId) {
  'worklet';
  const n = rot(b.roll, b.yaw, faceNormal(f), b.spin ?? 0);
  const d = light.dir;
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  const k = light.ambient + light.diffuse * ((n.x * d.x + n.y * d.y + n.z * d.z) / l);
  return Math.max(light.min, Math.min(light.max, k));
}

// ---------- 놓인 상자(Placed, 정지 자세) ↔ 3D 자세 ----------

export function dimsOf(p: Placed): Dims {
  if (p.pose === 'spine') return { T: p.size.w, H: p.size.h, W: p.size.d };
  if (p.pose === 'front') return { T: p.size.d, H: p.size.h, W: p.size.w };
  return { T: p.size.h, H: p.size.w, W: p.size.d };
}

export function orientOf(pose: Pose, angle: number) {
  'worklet';
  if (pose === 'horizontal') return { roll: -90, yaw: 0 };
  if (pose === 'front') return { roll: 0, yaw: 90 };
  return { roll: angle, yaw: 0 };
}

// 회전 기준점(책 좌표): 기울기·눕히기는 기우는 쪽 바닥 모서리, 표지로 돌기는 바닥 가운데(세로 중심축)
export function pivotLocal(d: Dims, roll: number): Vec3 {
  'worklet';
  return roll > 0 ? { x: d.T, y: 0, z: 0 } : { x: 0, y: 0, z: 0 };
}

export const axisLocal = (d: Dims): Vec3 => {
  'worklet';
  return { x: d.T / 2, y: 0, z: d.W / 2 };
};

// 놓인 상자의 원점 정의: (x, y, z) = 선반 공간에서 책이 차지하는 축 정렬 상자(AABB)의 최솟값 모서리.
// 예외: 기댄 세운 책은 x가 "똑바로 섰을 때 왼쪽 면"이고, 기우는 쪽 바닥 모서리(발)가 제자리에 있다.
export function fromPlaced(p: Placed): Book3 {
  const dims = dimsOf(p);
  const o = orientOf(p.pose, p.angle);
  const spin = p.pose === 'horizontal' ? p.spin ?? 0 : 0;
  const b: Book3 = { id: p.bookId, dims, roll: o.roll, yaw: o.yaw, spin, t: { x: 0, y: 0, z: 0 } };
  if (p.pose === 'spine' && p.angle) {
    const foot = { x: p.angle > 0 ? p.x + p.size.w : p.x, y: p.y, z: p.z };
    b.t = sub3(foot, rot(o.roll, o.yaw, pivotLocal(dims, o.roll)));
    return b;
  }
  const c = corners(b);
  const min = { x: Math.min(...c.map((q) => q.x)), y: Math.min(...c.map((q) => q.y)), z: Math.min(...c.map((q) => q.z)) };
  b.t = { x: p.x - min.x, y: p.y - min.y, z: p.z - min.z };
  return b;
}

// 선반 위(XZ 평면)에서 본 바닥·윗면 다각형: 받침·쌓기 판정용
export function footprintXZ(b: Book3): { x: number; z: number }[] {
  const c = corners(b);
  const lo = Math.min(...c.map((q) => q.y));
  const hi = Math.max(...c.map((q) => q.y));
  const base = c.filter((q) => q.y < lo + 0.5);
  const top = c.filter((q) => q.y > hi - 0.5);
  const pts = (base.length >= 3 ? base : top).map((q) => ({ x: q.x, z: q.z }));
  return hullXZ(pts);
}
export function topXZ(b: Book3): { x: number; z: number }[] {
  const c = corners(b);
  const hi = Math.max(...c.map((q) => q.y));
  return hullXZ(c.filter((q) => q.y > hi - 0.5).map((q) => ({ x: q.x, z: q.z })));
}
export function topY(b: Book3) {
  return Math.max(...corners(b).map((q) => q.y));
}
function hullXZ(pts: { x: number; z: number }[]) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: typeof p = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: typeof p = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
// 볼록 다각형 inner가 outer 안에 있는지(tol만큼 삐져나오는 것은 허용)
export function containsXZ(outer: { x: number; z: number }[], inner: { x: number; z: number }[], tol = 0.3) {
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez) || 1;
    for (const q of inner) {
      const cr = (ex * (q.z - a.z) - ez * (q.x - a.x)) / len; // 반시계 다각형이면 안쪽이 +
      if (cr < -tol) return false;
    }
  }
  return true;
}

// ---------- 3D 충돌(분리축, 상자 두 개) ----------

function dot(a: Vec3, b: Vec3) {
  'worklet';
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  'worklet';
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function obb(b: Book3) {
  'worklet';
  const d = b.dims;
  const c = toWorld(b, { x: d.T / 2, y: d.H / 2, z: d.W / 2 });
  return {
    c,
    ax: [rot(b.roll, b.yaw, { x: 1, y: 0, z: 0 }, b.spin ?? 0), rot(b.roll, b.yaw, { x: 0, y: 1, z: 0 }, b.spin ?? 0), rot(b.roll, b.yaw, { x: 0, y: 0, z: 1 }, b.spin ?? 0)],
    h: [d.T / 2, d.H / 2, d.W / 2],
  };
}

// 두 상자 사이 간격(분리축 중 가장 큰 틈, 음수면 그만큼 파고듦). 맞닿음은 0 근처.
export function gap(a: Book3, b: Book3) {
  'worklet';
  const A = obb(a);
  const B = obb(b);
  const axes: Vec3[] = [A.ax[0], A.ax[1], A.ax[2], B.ax[0], B.ax[1], B.ax[2]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const c = cross(A.ax[i], B.ax[j]);
      const l = Math.hypot(c.x, c.y, c.z);
      if (l > 1e-6) axes.push({ x: c.x / l, y: c.y / l, z: c.z / l });
    }
  const d = sub3(B.c, A.c);
  let best = -Infinity;
  for (const n of axes) {
    const ra = A.h[0] * Math.abs(dot(A.ax[0], n)) + A.h[1] * Math.abs(dot(A.ax[1], n)) + A.h[2] * Math.abs(dot(A.ax[2], n));
    const rb = B.h[0] * Math.abs(dot(B.ax[0], n)) + B.h[1] * Math.abs(dot(B.ax[1], n)) + B.h[2] * Math.abs(dot(B.ax[2], n));
    const g = Math.abs(dot(d, n)) - ra - rb;
    if (g > best) best = g;
  }
  return best;
}

// 선반 판 위(y ≥ 0)에 있는지, 가장 낮은 점
export function lowest(b: Book3) {
  'worklet';
  const c = corners(b);
  let m = Infinity;
  for (const q of c) m = Math.min(m, q.y);
  return m;
}

export function xRange(b: Book3) {
  'worklet';
  const c = corners(b);
  let lo = Infinity;
  let hi = -Infinity;
  for (const q of c) {
    lo = Math.min(lo, q.x);
    hi = Math.max(hi, q.x);
  }
  return { lo, hi };
}

// 가로 시점: 선반 가운데보다 왼쪽 책은 오른쪽 옆면이, 오른쪽 책은 왼쪽 옆면이, 가운데 책은 거의 정면만 보인다.
// 책 가운데 x(선반 공간)에 따라 카메라 kx를 바꾼다(줄의 ky는 그대로). 책이 움직이면 보이는 옆면도 따라 바뀐다.
export const VIEW_MID = 183; // 선반 사용 폭의 가운데(DU)
// 지시서(3D 배치) 7.1: 직교 카메라에서 화면 좌우 위치만으로 보이는 옆면을 뒤집지 않는다 → 기본은 끔(모든 책이 같은 쪽 옆면).
export const VIEW_BY_POSITION = false;
export function viewCam(base: Cam, b: Book3): Cam {
  'worklet';
  if (!VIEW_BY_POSITION) return base;
  const c = toWorld(b, { x: b.dims.T / 2, y: b.dims.H / 2, z: b.dims.W / 2 });
  const v = Math.max(-1, Math.min(1, (c.x - VIEW_MID) / VIEW_MID));
  return { kx: -Math.abs(base.kx) * v, ky: base.ky };
}
