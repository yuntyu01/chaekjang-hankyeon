// 책 상자 모델(순수). 책 한 권 = 상자 하나이고, 자세(책등·표지·눕힘)는 같은 상자를 돌린 것이다.
// 선반 공간: x = 선반 판 안쪽 왼쪽에서 오른쪽(DU), y = 선반 바닥에서 위(DU), z = 책 줄 앞선에서 벽 쪽(DU).
// 카메라는 앱 전체에 하나: 직교 투영 + 고정 사선(깊이 1DU가 화면에서 오른쪽 kx, 위로 ky). 줄·가로 위치로 바뀌지 않는다.
// 역할: 그리기는 투영(project/faces), 충돌·기대기는 선반 공간(collide/solveLean), 터치는 투영 외곽(silhouette).
import { project, viewAt, type Cam } from './camera';
import { bookHeight, bookThickness, frontWidth } from './geometry';
import { fromPlaced, gap } from './book3';
import { firstContact } from './lean';
import type { Point } from './shelf-scene';
import type { Book, Pose } from './types';

export type Camera = Cam;
export type { Vec3 } from './camera';
export { project };

// 선반 공간에서 상자가 차지하는 크기: w = 가로(x), h = 높이(y), d = 깊이(z)
export type BoxSize = { w: number; h: number; d: number };

export function boxSize(book: Book, pose: Pose): BoxSize {
  const T = bookThickness(book); // 두께
  const H = bookHeight(book); // 세로
  const W = frontWidth(book); // 표지 너비
  switch (pose) {
    case 'spine':
      return { w: T, h: H, d: W };
    case 'front':
      return { w: W, h: H, d: T };
    case 'horizontal':
      return { w: H, h: T, d: W };
  }
}

// 수직축으로 돌린 눕힌 책의 축 정렬 폭·깊이
export function aabbW(p: Placed) {
  'worklet';
  if (!p.spin) return p.size.w;
  const r = (p.spin * Math.PI) / 180;
  return Math.abs(p.size.w * Math.cos(r)) + Math.abs(p.size.d * Math.sin(r));
}
export function aabbD(p: Placed) {
  'worklet';
  if (!p.spin) return p.size.d;
  const r = (p.spin * Math.PI) / 180;
  return Math.abs(p.size.w * Math.sin(r)) + Math.abs(p.size.d * Math.cos(r));
}

// 볼록 껍질(모노톤 체인)
export function hull(points: Point[]): Point[] {
  'worklet';
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// 워클릿은 만들어질 때 쓰는 함수를 붙잡으므로, 쓰이는 함수(hull·rad·at)를 먼저 정의한다.
// 놓인 상자. angle(도): +면 오른쪽으로 기울어 오른쪽 아래 모서리가 축, -면 왼쪽 아래 모서리가 축(세운 책만).
export type Placed = {
  bookId: string;
  pose: Pose;
  size: BoxSize;
  x: number; // 똑바로 섰을 때 왼쪽 면
  y: number; // 밑면
  z: number; // 앞면
  angle: number;
  spin?: number; // 눕힌 책의 수직축 회전(도). size는 돌리기 전 치수, x·z는 돌린 뒤 축 정렬 상자의 최솟값
  pitch?: number; // 표지 책이 벽에 기댄 각도(도). z는 똑바로 섰을 때의 앞면(뒤쪽 아래 모서리 = z + 두께)
};

function rad(d: number) {
  'worklet';
  return (d * Math.PI) / 180;
}

// 앞면 윤곽(선반 공간 x-y, y 위로). 반시계 순서: 왼아래 → 오른아래 → 오른위 → 왼위.
export function frontPoly(p: Placed): Point[] {
  'worklet';
  const { h } = p.size;
  const w = aabbW(p);
  const base: Point[] = [
    { x: p.x, y: p.y },
    { x: p.x + w, y: p.y },
    { x: p.x + w, y: p.y + h },
    { x: p.x, y: p.y + h },
  ];
  if (!p.angle) return base;
  const pivot = p.angle > 0 ? base[1] : base[0];
  const t = rad(-p.angle); // 오른쪽으로 기울기 = 시계 방향
  const c = Math.cos(t);
  const s = Math.sin(t);
  return base.map((q) => ({ x: pivot.x + (q.x - pivot.x) * c - (q.y - pivot.y) * s, y: pivot.y + (q.x - pivot.x) * s + (q.y - pivot.y) * c }));
}

function at(q: Point, z: number): { x: number; y: number; z: number } {
  'worklet';
  return { x: q.x, y: q.y, z };
}

// 상자 꼭짓점 8개를 투영한 볼록 외곽(터치·그림자용)
export function silhouette(cam: Camera, p: Placed): Point[] {
  'worklet';
  const f = frontPoly(p);
  const d = aabbD(p);
  const pts = [...f.map((q) => project(cam, at(q, p.z))), ...f.map((q) => project(cam, at(q, p.z + d)))];
  return hull(pts);
}

// 면 종류: 앞면, 그리고 앞면 네 변에서 뒤로 뻗은 면. local은 기울기 전 방향(right = +x 면, top = +y 면).
export type FaceKind = 'right' | 'top' | 'left' | 'bottom';
export type Face = { kind: FaceKind; poly: Point[]; front: [Point, Point] };

// 카메라에 보이는 옆면·윗면(장면 좌표). 바깥 법선 n이 깊이 방향 (kx, ky)과 같은 쪽을 향하면 보인다.
export function visibleFaces(cam: Camera, p: Placed): { front: Point[]; sides: Face[] } {
  'worklet';
  const f = frontPoly(p);
  const kinds: FaceKind[] = ['bottom', 'right', 'top', 'left']; // 변 i: f[i] → f[i+1]
  const sides: Face[] = [];
  for (let i = 0; i < 4; i++) {
    const a = f[i];
    const b = f[(i + 1) % 4];
    const nx = b.y - a.y; // 반시계 다각형의 바깥 법선
    const ny = -(b.x - a.x);
    const k = viewAt(cam, at(a, p.z));
    if (nx * k.kx + ny * k.ky <= 1e-9) continue;
    const A = project(cam, at(a, p.z));
    const B = project(cam, at(b, p.z));
    const Bb = project(cam, at(b, p.z + p.size.d));
    const Ab = project(cam, at(a, p.z + p.size.d));
    sides.push({ kind: kinds[i], poly: [A, B, Bb, Ab], front: [A, B] });
  }
  return { front: f.map((q) => project(cam, at(q, p.z))), sides };
}

// 선반 공간 충돌: 깊이 구간이 겹치고 앞면 윤곽이 겹칠 때만(깊이가 다르면 화면에서 겹쳐도 닿지 않는다)
const EPS = 0.05;
export function zOverlap(a: Placed, b: Placed) {
  'worklet';
  return a.z < b.z + aabbD(b) - EPS && b.z < a.z + aabbD(a) - EPS;
}
// 공통 허용 오차(DU ≈ 1.3mm × 값): 이보다 얕게 파고드는 것은 맞닿음·계산 오차로 본다.
export const TOLERANCE = 0.25;
// 접촉 탐색(기대기 각도를 찾을 때)의 기준: 더 얕게 잡아 멈춘 자리가 허용 오차 안에 들어오게 한다
export const CONTACT = 0.05;

// 선반 공간 충돌: 두 책의 실제 회전 상자(OBB) 분리축 검사. 정면에서 겹쳐 보여도 깊이가 떨어져 있으면 충돌이 아니다.
export function collide(a: Placed, b: Placed, margin = TOLERANCE) {
  return gap(fromPlaced(a), fromPlaced(b)) < -margin;
}

// 기대기: 선반 공간에서 옆 상자에 처음 닿는 각도(0.5도 탐색 + 이분 탐색, lean.ts). 깊이가 겹치는 상자만 장애물.
// bounds: 선반 판 좌우 끝(x). 닿을 곳이 없거나 판 밖이면 바로 선다.
// 기대기: 기우는 쪽 바닥 모서리를 축으로 돌리며(0.5도 탐색 → 첫 접촉 주변 이분 탐색) 주변 책의 실제 3D 상자와 처음 닿는 각도.
// 화면에서 나란해도 깊이가 달라 실제로 닿지 않는 책은 받침이 되지 못한다. 받칠 곳이 없거나 선반 밖이면 바로 선다.
// (정역학 안정성 해석이 아니라, 바닥 접촉 + 이웃 접촉이 모두 있는 배치만 허용하는 정적 배치 규칙)
export function solveLean(p: Placed, dir: -1 | 1, others: Placed[], bounds: { min: number; max: number }) {
  const obstacles = others.filter((o) => o.bookId !== p.bookId).map((o) => ({ id: o.bookId, b: fromPlaced(o) }));
  const at = (deg: number) => fromPlaced({ ...p, angle: dir * deg });
  const hits = (deg: number) => {
    const me = at(deg);
    return obstacles.some((o) => gap(me, o.b) < -CONTACT);
  };
  const c = firstContact(hits);
  if (!c.found) return { angle: 0, supported: false, on: undefined };
  const poly = frontPoly({ ...p, angle: dir * c.angle });
  if (poly.some((q) => q.x < bounds.min - 0.01 || q.x > bounds.max + 0.01)) return { angle: 0, supported: false, on: undefined };
  const more = at(c.angle + 0.6);
  const on = c.angle > 0 ? obstacles.find((o) => gap(more, o.b) < -CONTACT)?.id : undefined;
  return { angle: dir * c.angle, supported: true, on };
}
