// 그림자 모양 계산(순수). 빛은 왼쪽 위: 윤곽을 오른쪽 아래로 옮긴 모양과 원래 윤곽을 이은 볼록 껍질.
import type { Point } from './shelf-scene';

// 볼록 껍질(모노톤 체인)
export function hull(points: Point[]): Point[] {
  'worklet';
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
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

// 빛 반대쪽(dx, dy)으로 옮긴 윤곽과 원래 윤곽을 이은 모양: 비스듬히 가로지르는 그림자
// blur(표준편차)를 주면 시작 윤곽도 빛 반대쪽으로 조금 민다. 흐림이 빛 쪽(왼쪽·위)으로 새어
// 책 둘레에 후광처럼 번지지 않게 한다(시안: 그림자는 오른쪽 아래로만 떨어진다).
export function castShape(poly: Point[], dx: number, dy: number, blur = 0) {
  'worklet';
  const lx = Math.min(dx, 2 * blur);
  const ly = Math.min(dy, blur);
  return hull([...poly.map((p) => ({ x: p.x + lx, y: p.y + ly })), ...poly.map((p) => ({ x: p.x + dx, y: p.y + dy }))]);
}

export function rgba(hex: string, alpha: number) {
  'worklet';
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}
