// 표지 전시 책의 자세(순수): 뒤로 젖힘(pitch) + 좌우 돌리기(spin)를 하나의 3D 상자로.
//  - pitch: 뒤쪽 아래 모서리를 축으로 머리를 벽 쪽으로(+). 그 모서리는 선반 위 제자리.
//  - spin : 똑바로 섰을 때 바닥 가운데를 지나는 수직축으로(+ = 오른쪽 끝이 벽 쪽, 표지가 오른쪽을 향함).
// 자리 값: qx = 수직축의 x, depth = 똑바로 섰을 때 앞면 z(뒤쪽 아래 모서리 = depth + 두께).
// 벽 접촉은 asin 공식이 아니라 회전한 상자의 꼭짓점 중 가장 벽 쪽(z 최대)으로 판정한다(두께·두 회전 모두 반영).
import { corners, frontBook3, type Book3, type Dims, type Vec3 } from './book3';
import { hull } from './hull';
import { contact2, penetration2, statics2, tipAngle, wallLeanRest, type Contact, type Leaner2, type LeanStatics, type Vec2 } from './statics';

export const FRONT_MAX_PITCH = 25; // 손으로 새로 젖히는 범위. 중력으로 넘어지는 자세는 90°까지.
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
  const p = Math.max(0, Math.min(Math.max(FRONT_MAX_PITCH, cur.pitch), pitch));
  const touching = cur.pitch > 0 && wallReach(dims, cur) >= wall - WALL_TOUCH;
  const r = wallReach(dims, { ...cur, pitch: p });
  let depth = cur.depth;
  if (r > wall || (touching && p < cur.pitch)) depth += wall - r;
  return { depth, pitch: p, spin: cur.spin };
}

// 좌우 돌리기 한 걸음: 벽에 기대 있으면 벽 접촉을 유지하도록 바닥을 최소로 앞뒤, 아니면 벽을 뚫을 때만 앞으로.
// front: 선반 앞 끝 z. 돌려서 앞 끝 밖으로 나가는 쪽이 있으면 그만큼 뒤로(벽과 똑같이)
export function spinStep(dims: Dims, cur: FrontState, spin: number, wall: number, max: number, front = -Infinity): FrontState {
  const s = Math.max(-max, Math.min(max, spin));
  const touching = cur.pitch > 0 && wallReach(dims, cur) >= wall - WALL_TOUCH;
  const r = wallReach(dims, { ...cur, spin: s });
  let depth = cur.depth;
  if (touching || r > wall) depth += wall - r;
  const z0 = depth + frontExtent(dims, cur.pitch, s).z0;
  if (z0 < front) depth += front - z0;
  return { depth, pitch: cur.pitch, spin: s };
}

// 벽에서 떨어져 손으로만 받치고 있는 자세인지.
export function unsupported(dims: Dims, s: FrontState, wall: number) {
  return s.pitch > 0.05 && wallReach(dims, s) < wall - WALL_TOUCH - 0.2;
}

// 손을 놓았을 때 머무는 젖힘(statics.ts, 뒤쪽 아래 모서리가 축): 넘어짐 한계 이하면 벽에 닿아 있어도 다시 서고,
// 그보다 젖힌 책은 벽에 닿을 때까지 넘어간다(가는 길의 받침과 거기서 버티는지는 layout-engine frontRelease가 본다).
// 벽에 기댄 각이 바닥 마찰이 버티는 한계를 넘으면 바닥이 앞으로 미끄러져 눕는다(90).
export function releasedPitch(dims: Dims, s: FrontState, wall: number) {
  if (s.pitch >= 89.95) return 90;
  if (s.pitch <= tipAngle(dims.T, dims.H)) return 0;
  const p = unsupported(dims, s, wall) ? pitchForWall(dims, s.depth, s.spin, wall, 90) ?? 90 : s.pitch;
  return wallLeanRest(dims.T, dims.H, p);
}

// ---------- 뒤로 넘어져 책(받침)에 기댈 때: 젖힘 축에 수직인 세로 평면(statics.ts 2D 핵심) ----------
// 평면 좌표: 가로 = z(벽 쪽 +, 넘어지는 쪽), 세로 = y. 좌우 돌리기는 받침을 돌리기 축(Q, 수직) 둘레로 되돌려 이 평면에 놓는 것으로만
// 반영한다(어림: 접촉면이 평면 밖으로 기운 만큼의 힘(x 성분)과 돌림, 앞으로 미끄러질 때 돌린 방향이 아닌 z로 가는 것은 무시한다).

// 젖힌 책의 2D 값: 축 = 뒤쪽 아래 모서리(depth + T, 0), 기우는 쪽 윗모서리 = 뒤쪽 위 모서리, 무게 = 부피. poly: 옆에서 본 직사각형(반시계)
export function frontLeaner2(dims: Dims, s: FrontState): Leaner2 & { poly: Vec2[] } {
  const r = (s.pitch * Math.PI) / 180;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  const F = { x: s.depth + dims.T, y: 0 };
  // 축에서 (앞쪽 -두께 방향 a, 위 b)인 점을 젖힘만큼 돌린 자리
  const at = (a: number, b: number): Vec2 => ({ x: F.x + a * c + b * sn, y: F.y - a * sn + b * c });
  const top = at(0, dims.H);
  return { pivot: F, top, dir: 1, g: at(-dims.T / 2, dims.H / 2), m: dims.T * dims.H * dims.W, poly: [F, top, at(-dims.T, dims.H), at(-dims.T, 0)] };
}

// 받침 상자를 이 책의 평면에 놓은 볼록 외곽: 돌리기 축(qx, depth + T/2) 둘레로 -spin 되돌린 틀에서 이 책 폭(|x| ≤ W/2) 안에 든
// 부분만 잘라(꼭짓점 + 모서리가 폭 경계를 지나는 점) (z, y)로 눌러 담는다. 되돌린 틀에서 이 책은 x로 곧게 뻗은 기둥이라 겹침은 3D와 같다.
export function frontSupport2(dims: Dims, s: FrontState, qx: number, support: Book3): Vec2[] {
  const r = (s.spin * Math.PI) / 180;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  const qz = s.depth + dims.T / 2;
  const w = dims.W / 2;
  const cs = corners(support).map((p) => ({ x: (p.x - qx) * c + (p.z - qz) * sn, z: qz - (p.x - qx) * sn + (p.z - qz) * c, y: p.y }));
  const pts: Vec2[] = [];
  for (const q of cs) if (Math.abs(q.x) <= w) pts.push({ x: q.z, y: q.y });
  // 모서리 12개(꼭짓점 번호가 한 비트만 다른 쌍)가 폭 경계 x = ±W/2를 지나는 점
  for (let i = 0; i < 8; i++)
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const a = cs[i];
      const b = cs[i | bit];
      for (const e of [-w, w])
        if ((a.x - e) * (b.x - e) < 0) {
          const t = (e - a.x) / (b.x - a.x);
          pts.push({ x: a.z + t * (b.z - a.z), y: a.y + t * (b.y - a.y) });
        }
    }
  return hull(pts);
}

// 받침 외곽 S에 닿은 젖힌 책의 힘 평형(마찰 0 접촉, 바닥 마찰): 'tip'이면 받침을 밀지 않고(다시 선다), 'slip'이면 바닥이 앞으로 미끄러진다
export function frontLean(dims: Dims, s: FrontState, S: Vec2[]): LeanStatics & { contact: Contact } {
  const l = frontLeaner2(dims, s);
  const contact = contact2(l, S);
  return { ...statics2(l, contact), contact };
}

// 바닥 축(depth) 고정으로 s.pitch → target 넘어질 때 처음 닿는 외곽(1° 걸음 + 이분). 닿기 직전 각과 그 외곽 번호, 없으면 null.
// 처음부터 파고들어 있으면 그 자리(s.pitch)
export function frontFall2(dims: Dims, s: FrontState, target: number, hulls: Vec2[][], tol = 0.01): { pitch: number; index: number } | null {
  const hitAt = (pitch: number) => {
    const poly = frontLeaner2(dims, { ...s, pitch }).poly;
    return hulls.findIndex((h) => penetration2(poly, h) > tol);
  };
  const first = hitAt(s.pitch);
  if (first >= 0) return { pitch: s.pitch, index: first };
  const count = Math.ceil(Math.abs(target - s.pitch));
  let prev = s.pitch;
  for (let i = 1; i <= count; i++) {
    const pitch = s.pitch + ((target - s.pitch) * i) / count;
    if (hitAt(pitch) >= 0) {
      let lo = prev;
      let hi = pitch;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (hitAt(mid) >= 0) hi = mid;
        else lo = mid;
      }
      return { pitch: lo, index: hitAt(hi) };
    }
    prev = pitch;
  }
  return null;
}

export type { Vec3 };
