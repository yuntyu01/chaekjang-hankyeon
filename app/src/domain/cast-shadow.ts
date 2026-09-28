// 실제 그림자(순수, 워클릿): 광원 방향으로 3D 점을 받는 면(평면)에 떨어뜨린다. 화면으로는 책과 같은 project()로 옮긴다.
// 받는 면: 벽(z = SHELF_DEPTH, 책 기준선 뒤 160mm = 앞 끝에서 230mm), 선반 윗면(y = 0).
// 광원은 면 밝기(램버트)와 같은 방향이다. 부드러운 면광원이라 가리는 물체에서 멀수록 옅고 흐려진다(fadeOf).
import type { Vec3 } from './book3';

// 빛이 나아가는 방향(광원 → 물체). light.dir(물체 → 광원)의 반대, 길이 1.
export function travelOf(dir: Vec3): Vec3 {
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  return { x: -dir.x / l, y: -dir.y / l, z: -dir.z / l };
}

// 벽 평면(z = wall)으로. 빛이 벽 쪽으로 가야 한다(D.z > 0). 이미 벽 뒤의 점은 그대로.
export function onWall(p: Vec3, D: Vec3, wall: number): Vec3 {
  'worklet';
  const t = Math.max(0, (wall - p.z) / D.z);
  return { x: p.x + D.x * t, y: p.y + D.y * t, z: wall };
}

// 수평면(y = y0)으로. 빛이 아래로 가야 한다(D.y < 0). 이미 면 아래의 점은 그대로.
export function onFloor(p: Vec3, D: Vec3, y0: number): Vec3 {
  'worklet';
  const t = Math.max(0, (y0 - p.y) / D.y);
  return { x: p.x + D.x * t, y: y0, z: p.z + D.z * t };
}

// 가리는 물체와 받는 면 사이 거리(빛 방향으로 잰 길이)
export function rayLength(p: Vec3, q: Vec3) {
  'worklet';
  return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
}

// 면광원: 거리 d에서 그림자 진하기 비율(가까우면 1, 멀수록 지수로 옅어짐)
export function fadeOf(d: number, len: number) {
  'worklet';
  return Math.exp(-Math.max(0, d) / len);
}

// 상자 꼭짓점 번호(xi + 2*yi + 4*zi)의 12개 변
export const BOX_EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];

// 가리는 상자(occ, 꼭짓점 8개)가 받는 면(점 p0, 바깥 법선 n)에 드리우는 그림자: 면보다 빛 쪽에 있는 부분(빛 길이 0 < t ≤ tMax)만
// 빛 방향 LIGHT로 면 평면에 떨어뜨린 점들(볼록 외곽을 취하면 그림자 모양). dist/tFar = 그 부분의 가장 가까운·먼 빛 길이, near/far = 그 점.
// tMax로 가까운 부분만 떼어 내면 가리개에 가까워 또렷하고 진한 층을 따로 그릴 수 있다(먼 가장자리는 흐리게).
export function shadowOnPlane(occ: Vec3[], p0: Vec3, n: Vec3, LIGHT: Vec3, tMax = Infinity): { pts: Vec3[]; dist: number; near: Vec3 | null; far: Vec3 | null; tFar: number } {
  'worklet';
  const nd = n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z;
  const out: Vec3[] = [];
  let dist = Infinity;
  let tFar = -Infinity;
  let near: Vec3 | null = null;
  let far: Vec3 | null = null;
  if (nd > -1e-4) return { pts: out, dist: 0, near, far, tFar: 0 };
  const lo = 0.05;
  const hi = tMax * -nd;
  const h = occ.map((c) => n.x * (c.x - p0.x) + n.y * (c.y - p0.y) + n.z * (c.z - p0.z)); // 면 바깥(빛 쪽) 거리
  const put = (c: Vec3, hc: number) => {
    const t = hc / -nd;
    const q = { x: c.x + LIGHT.x * t, y: c.y + LIGHT.y * t, z: c.z + LIGHT.z * t };
    if (t < dist) {
      dist = t;
      near = q;
    }
    if (t > tFar) {
      tFar = t;
      far = q;
    }
    out.push(q);
  };
  for (let i = 0; i < 8; i++) if (h[i] > lo && h[i] <= hi) put(occ[i], h[i]);
  for (const [i, j] of BOX_EDGES) {
    for (const lim of [lo, hi]) {
      if (!Number.isFinite(lim) || (h[i] - lim) * (h[j] - lim) >= 0) continue;
      const u = (lim - h[i]) / (h[j] - h[i]);
      put({ x: occ[i].x + (occ[j].x - occ[i].x) * u, y: occ[i].y + (occ[j].y - occ[i].y) * u, z: occ[i].z + (occ[j].z - occ[i].z) * u }, lim);
    }
  }
  if (out.length < 3) return { pts: [], dist: 0, near: null, far: null, tFar: 0 };
  return { pts: out, dist, near, far, tFar };
}
