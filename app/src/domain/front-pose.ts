// 표지 전시 책의 자세(순수): 뒤로 젖힘(pitch) + 좌우 돌리기(spin)를 하나의 3D 상자로.
//  - pitch: 뒤쪽 아래 모서리를 축으로 머리를 벽 쪽으로(+). 그 모서리는 선반 위 제자리.
//  - spin : 똑바로 섰을 때 바닥 가운데를 지나는 수직축으로(+ = 오른쪽 끝이 벽 쪽, 표지가 오른쪽을 향함).
// 자리 값: qx = 수직축의 x, depth = 똑바로 섰을 때 앞면 z(뒤쪽 아래 모서리 = depth + 두께).
// 벽 접촉은 asin 공식이 아니라 회전한 상자의 꼭짓점 중 가장 벽 쪽(z 최대)으로 판정한다(두께·두 회전 모두 반영).
import { corners, frontBook3, type Dims, type Vec3 } from './book3';

export const FRONT_MAX_PITCH = 25; // 머리 손잡이로 젖힐 수 있는 최대 각(도). 앞뒤 막대의 자동 기대기는 WALL_LEAN_MAX(20°)까지
export const WALL_TOUCH = 0.3; // 이만큼(DU) 안이면 벽에 닿은 것으로 본다

export type FrontState = { depth: number; pitch: number; spin: number };

export { frontBook3 };

// 축(qx = 0, depth = 0) 기준 상자의 범위
export function frontExtent(dims: Dims, pitch = 0, spin = 0) {
  const cs = corners(frontBook3('', dims, 0, 0, pitch, spin));
  let x0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const c of cs) {
    x0 = Math.min(x0, c.x);
    x1 = Math.max(x1, c.x);
    y1 = Math.max(y1, c.y);
    z0 = Math.min(z0, c.z);
    z1 = Math.max(z1, c.z);
  }
  return { x0, x1, y1, z0, z1 };
}

// 가장 벽 쪽 꼭짓점의 z
export function wallReach(dims: Dims, s: FrontState) {
  return s.depth + frontExtent(dims, s.pitch, s.spin).z1;
}

// 이 바닥 자리·좌우 각에서 머리가 벽(wall)에 닿는 젖힘 각. 똑바로도 벽에 닿으면 0, 최대 각으로도 안 닿으면 null.
export function pitchForWall(dims: Dims, depth: number, spin: number, wall: number, max = FRONT_MAX_PITCH + 10): number | null {
  const reach = (p: number) => depth + frontExtent(dims, p, spin).z1;
  if (reach(0) >= wall) return 0;
  if (reach(max) < wall) return null;
  let lo = 0;
  let hi = max;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < wall) lo = mid;
    else hi = mid;
  }
  return hi;
}

// 머리 젖히기 한 걸음: 벽에 닿기 전에는 바닥 고정, 닿은 뒤 더 젖히면 윗부분은 벽에 대고 바닥을 앞으로,
// 벽에 닿은 채 세우면 바닥을 뒤로(벽 접촉 유지). 벽에서 떨어져 있으면 바닥 고정으로 세운다.
export function tiltStep(dims: Dims, cur: FrontState, pitch: number, wall: number): FrontState {
  const p = Math.max(0, Math.min(FRONT_MAX_PITCH, pitch));
  const touching = cur.pitch > 0 && wallReach(dims, cur) >= wall - WALL_TOUCH;
  const r = wallReach(dims, { ...cur, pitch: p });
  let depth = cur.depth;
  if (r > wall || (touching && p < cur.pitch)) depth += wall - r;
  return { depth, pitch: p, spin: cur.spin };
}

// 좌우 돌리기 한 걸음: 벽에 기대 있으면 벽 접촉을 유지하도록 바닥을 최소로 앞뒤, 아니면 벽을 뚫을 때만 앞으로.
export function spinStep(dims: Dims, cur: FrontState, spin: number, wall: number, max: number): FrontState {
  const s = Math.max(-max, Math.min(max, spin));
  const touching = cur.pitch > 0 && wallReach(dims, cur) >= wall - WALL_TOUCH;
  const r = wallReach(dims, { ...cur, spin: s });
  let depth = cur.depth;
  if (touching || r > wall) depth += wall - r;
  return { depth, pitch: cur.pitch, spin: s };
}

// 받침 없이 기운 자세인지(손을 놓으면 서야 한다)
export function unsupported(dims: Dims, s: FrontState, wall: number) {
  return s.pitch > 0.05 && wallReach(dims, s) < wall - WALL_TOUCH - 0.2;
}

export type { Vec3 };
