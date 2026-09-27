// 책 기대기(정역학, 물리 엔진 없음). 세운 책을 바닥 모서리를 축으로 쓰러뜨려
// 옆 책(또는 쌓인 책·표지 책)의 실제 윤곽에 처음 닿는 각도에서 멈춘다.
// 닿는 곳이 없거나(MAX_LEAN까지) 선반 밖으로 나가면 쓰러질 수 없으니 바로 선다.
import type { Point } from './shelf-scene';

// 도. 물리 기준이 아니라 보기 좋은 배치를 위한 디자인 규칙(대부분은 이보다 작게 기댄다).
export const MAX_LEAN = 15;

function hullOf(points: Point[]): Point[] {
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

// 볼록 다각형 충돌(분리축). margin만큼 겹쳐야 충돌로 본다(맞닿음은 허용).
export function overlaps(a: Point[], b: Point[], margin = 0.05) {
  'worklet';
  const A = hullOf(a);
  const B = hullOf(b);
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = -(q.y - p.y);
      const ny = q.x - p.x;
      const len = Math.hypot(nx, ny) || 1;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of A) {
        const d = (v.x * nx + v.y * ny) / len;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of B) {
        const d = (v.x * nx + v.y * ny) / len;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA < minB + margin || maxB < minA + margin) return false;
    }
  }
  return true;
}

export type LeanResult = { angle: number; supported: boolean };

// hits(deg)가 처음 참이 되는 직전 각도(0.5도 간격으로 찾고 이분법으로 좁힘). MAX_LEAN까지 없으면 found=false.
export function firstContact(hits: (deg: number) => boolean) {
  if (hits(0.3)) return { angle: 0, found: true };
  const step = 0.5;
  let lo = 0;
  let hi = -1;
  for (let d = step; d <= MAX_LEAN + 1e-9; d += step) {
    if (hits(d)) {
      hi = d;
      break;
    }
    lo = d;
  }
  if (hi < 0) return { angle: 0, found: false };
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (hits(mid)) hi = mid;
    else lo = mid;
  }
  return { angle: lo, found: true };
}

// polyAt(angle): 그 각도(양수, 도)로 기울였을 때 책 윤곽. obstacles: 기대는 쪽의 다른 책 윤곽들.
// bounds: 선반 판 좌우 끝(이 밖으로 나가면 쓰러질 곳이 없다).
export function contactAngle(
  polyAt: (deg: number) => Point[],
  obstacles: Point[][],
  bounds: { min: number; max: number },
): LeanResult {
  const c = firstContact((d) => obstacles.some((o) => overlaps(polyAt(d), o)));
  if (!c.found) return { angle: 0, supported: false }; // 기댈 곳이 없다
  const outside = polyAt(c.angle).some((p) => p.x < bounds.min - 0.01 || p.x > bounds.max + 0.01);
  if (outside) return { angle: 0, supported: false }; // 선반 밖으로 나간다
  return { angle: c.angle, supported: true };
}
