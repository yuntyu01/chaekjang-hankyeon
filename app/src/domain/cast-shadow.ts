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
