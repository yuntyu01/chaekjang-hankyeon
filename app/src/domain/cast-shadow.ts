// 실제 그림자(순수, 워클릿): 광원 방향으로 3D 점을 받는 면(평면)에 떨어뜨린다. 화면으로는 책과 같은 project()로 옮긴다.
// 받는 면: 벽(z = SHELF_DEPTH, 책 기준선 뒤 160mm = 앞 끝에서 230mm), 선반 윗면(y = 0).
// 광원은 면 밝기(램버트)와 같은 방향이다(domain/light-model). 면광원이라 가리는 물체에서 멀수록 번진다.
import { light, physShadow } from "@/ui/lighting";

import { corners, type Book3, type Vec3 } from "./book3";
import { SHELF_DEPTH } from "./geometry";

// 빛이 나아가는 방향(광원 → 물체). light.dir(물체 → 광원)의 반대, 길이 1.
export function travelOf(dir: Vec3): Vec3 {
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  return { x: -dir.x / l, y: -dir.y / l, z: -dir.z / l };
}

// 벽 평면(z = wall)으로. 빛이 벽 쪽으로 가야 한다(D.z > 0). 이미 벽 뒤의 점은 그대로.
export function onWall(p: Vec3, D: Vec3, wall: number): Vec3 {
  "worklet";
  const t = Math.max(0, (wall - p.z) / D.z);
  return { x: p.x + D.x * t, y: p.y + D.y * t, z: wall };
}

// 수평면(y = y0)으로. 빛이 아래로 가야 한다(D.y < 0). 이미 면 아래의 점은 그대로.
export function onFloor(p: Vec3, D: Vec3, y0: number): Vec3 {
  "worklet";
  const t = Math.max(0, (y0 - p.y) / D.y);
  return { x: p.x + D.x * t, y: y0, z: p.z + D.z * t };
}

// 상자 꼭짓점 번호(xi + 2*yi + 4*zi)의 12개 변
export const BOX_EDGES = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

// 가리는 상자(occ, 꼭짓점 8개)가 받는 면(점 p0, 바깥 법선 n)에 드리우는 그림자: 면보다 빛 쪽에 있는 부분(빛 길이 0 < t ≤ tMax)만
// 빛 방향 LIGHT로 면 평면에 떨어뜨린 점들(볼록 외곽을 취하면 그림자 모양). dist/tFar = 그 부분의 가장 가까운·먼 빛 길이, near/far = 그 점.
// tMax로 가까운 부분만 떼어 내면 가리개에 가까워 또렷하고 진한 층을 따로 그릴 수 있다(먼 가장자리는 흐리게).
// near·far: 빛 길이가 가장 짧은(긴) 쪽 가장자리의 가운데(한 점이 아니라). 긴 가리개(선반 판)는 가장자리 전체가 같은 빛 길이라
// 한 점을 고르면 판 끝으로 잡혀 그라데이션이 엉뚱한 방향으로 간다.
export function shadowOnPlane(
  occ: Vec3[],
  p0: Vec3,
  n: Vec3,
  LIGHT: Vec3,
  tMax = Infinity,
  tMin = 0,
): {
  pts: Vec3[];
  dist: number;
  near: Vec3 | null;
  far: Vec3 | null;
  tFar: number;
} {
  "worklet";
  const nd = n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z;
  const out: Vec3[] = [];
  const ts: number[] = [];
  let dist = Infinity;
  let tFar = -Infinity;
  let near: Vec3 | null = null;
  let far: Vec3 | null = null;
  if (nd > -1e-4) return { pts: out, dist: 0, near, far, tFar: 0 };
  // 빛 길이 tMin < t ≤ tMax 인 부분만(구간): 가리개를 빛 길이로 자른 판 조각들은 겹치지 않는다
  const lo = Math.max(0.05, tMin * -nd);
  const hi = tMax * -nd;
  const h = occ.map(
    (c) => n.x * (c.x - p0.x) + n.y * (c.y - p0.y) + n.z * (c.z - p0.z),
  ); // 면 바깥(빛 쪽) 거리
  const put = (c: Vec3, hc: number) => {
    const t = hc / -nd;
    const q = {
      x: c.x + LIGHT.x * t,
      y: c.y + LIGHT.y * t,
      z: c.z + LIGHT.z * t,
    };
    if (t < dist) dist = t;
    if (t > tFar) tFar = t;
    out.push(q);
    ts.push(t);
  };
  for (let i = 0; i < 8; i++) if (h[i] > lo && h[i] <= hi) put(occ[i], h[i]);
  for (const [i, j] of BOX_EDGES) {
    for (const lim of [lo, hi]) {
      if (!Number.isFinite(lim) || (h[i] - lim) * (h[j] - lim) >= 0) continue;
      const u = (lim - h[i]) / (h[j] - h[i]);
      put(
        {
          x: occ[i].x + (occ[j].x - occ[i].x) * u,
          y: occ[i].y + (occ[j].y - occ[i].y) * u,
          z: occ[i].z + (occ[j].z - occ[i].z) * u,
        },
        lim,
      );
    }
  }
  if (out.length < 3)
    return { pts: [], dist: 0, near: null, far: null, tFar: 0 };
  // 가까운·먼 가장자리의 가운데(빛 길이 차이가 작은 점들 평균)
  const tol = Math.max(0.3, (tFar - dist) * 0.02);
  const mid = (pick: (t: number) => boolean) => {
    let x = 0;
    let y = 0;
    let z = 0;
    let k = 0;
    for (let i = 0; i < out.length; i++) {
      if (!pick(ts[i])) continue;
      x += out[i].x;
      y += out[i].y;
      z += out[i].z;
      k++;
    }
    return k ? { x: x / k, y: y / k, z: z / k } : null;
  };
  near = mid((t) => t <= dist + tol);
  far = mid((t) => t >= tFar - tol);
  // 가까운 가장자리가 선(긴 가리개)이면 먼 점을 그 선에 수직인 방향으로 옮긴다: 그라데이션이 가장자리에서 멀어지는 거리만 따르게
  // (비스듬한 축이면 같은 거리의 점도 가장자리를 따라 진하기가 달라진다)
  if (near && far) {
    // 가까운 점들의 주축(분산이 가장 큰 방향): 긴 가리개면 그 가장자리 방향이다(가장 먼 두 점은 판 두께만큼 비스듬하다)
    const nn = near as Vec3;
    let cxx = 0,
      cxy = 0,
      cxz = 0,
      cyy = 0,
      cyz = 0,
      czz = 0,
      k = 0;
    for (let i = 0; i < out.length; i++) {
      if (ts[i] > dist + tol) continue;
      const dx = out[i].x - nn.x;
      const dy = out[i].y - nn.y;
      const dz = out[i].z - nn.z;
      cxx += dx * dx;
      cxy += dx * dy;
      cxz += dx * dz;
      cyy += dy * dy;
      cyz += dy * dz;
      czz += dz * dz;
      k++;
    }
    if (k >= 2 && cxx + cyy + czz > 1) {
      let e = { x: 1, y: 0.3, z: 0.2 };
      for (let it = 0; it < 12; it++) {
        const v = {
          x: cxx * e.x + cxy * e.y + cxz * e.z,
          y: cxy * e.x + cyy * e.y + cyz * e.z,
          z: cxz * e.x + cyz * e.y + czz * e.z,
        };
        const l = Math.hypot(v.x, v.y, v.z) || 1;
        e = { x: v.x / l, y: v.y / l, z: v.z / l };
      }
      const ff = far as Vec3;
      const d = { x: ff.x - nn.x, y: ff.y - nn.y, z: ff.z - nn.z };
      const kk = d.x * e.x + d.y * e.y + d.z * e.z;
      far = {
        x: nn.x + d.x - kk * e.x,
        y: nn.y + d.y - kk * e.y,
        z: nn.z + d.z - kk * e.z,
      };
    }
  }
  return { pts: out, dist, near, far, tFar };
}

// ---------- 책 → 벽·선반 윗면 그림자(창빛) ----------
// 책 상자를 빛 길이 구간(physShadow.bands)으로 잘라 구간마다 받는 면(벽 z = SHELF_DEPTH, 선반 윗면 y = 0)에 떨어뜨린다(3D 점, 카메라와 무관).
// 구간 조각은 겹치지 않고, 구간 가운데 거리의 반그림자 폭으로 번진다. 진하기는 받는 면이 정한다(light-model: 창빛 몫 / 그 면이 받는 빛).
// 벽과 선반 윗면이 만나는 선으로 가는 빛줄기는 두 면까지 빛 길이가 같아 같은 구간에 든다(이음에서 이어진다).
const BOOK_LIGHT = travelOf(light.dir);
// pts: 받는 면 위 점, sigma: 흐림 시그마(캔버스 px), w: 광원 원반 중 가려지는 몫(가리개가 반그림자보다 좁으면 1보다 작다)
export type BookCast = { pts: Vec3[]; sigma: number; w: number } | null;

// 상자에서 빛 길이 f가 (lo, hi]인 부분(볼록 상자 ∩ 두 평면 사이)의 꼭짓점: 그 사이 꼭짓점 + 12개 변이 lo·hi를 지나는 점
function bandPart(cs: Vec3[], f: number[], lo: number, hi: number): Vec3[] {
  "worklet";
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) if (f[i] >= lo && f[i] <= hi) out.push(cs[i]);
  for (const [i, j] of BOX_EDGES) {
    for (const L of [lo, hi]) {
      if ((f[i] - L) * (f[j] - L) >= 0) continue;
      const t = (L - f[i]) / (f[j] - f[i]);
      out.push({ x: cs[i].x + (cs[j].x - cs[i].x) * t, y: cs[i].y + (cs[j].y - cs[i].y) * t, z: cs[i].z + (cs[j].z - cs[i].z) * t });
    }
  }
  return out;
}

// 반그림자 폭 w(DU)를 가우스 흐림 시그마로: 원반 광원의 반그림자는 폭 w의 경사이고, 가운데 기울기가 같은 가우스는 σ = w / √(2π)
export function penumbraSigma(w: number) {
  "worklet";
  return w / Math.sqrt(2 * Math.PI);
}

// 광원 원반 중 가리개가 가리는 몫: 가리개의 짧은 두 변이 반그림자 폭 pen보다 좁으면 그 비율만큼만 가린다
// (붙은 곳은 진하고 멀수록 빨리 옅어진다)
export function thinOccluder(d: { T: number; H: number; W: number }, pen: number) {
  "worklet";
  const ds = [d.T, d.H, d.W].sort((p, q) => p - q);
  const w = Math.max(1e-3, pen);
  return Math.min(1, ds[0] / w) * Math.min(1, ds[1] / w);
}

// k번째 구간의 책 그림자(벽 wall = true, 선반 윗면 false). s: 캔버스 배율
export function bookCast(b: Book3, s: number, k: number, wall: boolean): BookCast {
  "worklet";
  const B = physShadow.bands;
  const lo = k === 0 ? 0 : B[k - 1];
  const hi = B[k];
  const D = BOOK_LIGHT;
  const cs = corners(b);
  const f = cs.map((c) => (wall ? Math.max(0, (SHELF_DEPTH - c.z) / D.z) : Math.max(0, c.y / -D.y)));
  let f0 = Infinity;
  let f1 = -Infinity;
  for (const v of f) {
    f0 = Math.min(f0, v);
    f1 = Math.max(f1, v);
  }
  if (f1 <= lo || f0 > hi) return null;
  const part = bandPart(cs, f, lo, hi);
  if (part.length < 3) return null;
  const pts: Vec3[] = part.map((c) => (wall ? onWall(c, D, SHELF_DEPTH) : onFloor(c, D, 0)));
  const pen = physShadow.spread * ((Math.max(lo, f0) + Math.min(hi, f1)) / 2);
  return { pts, sigma: penumbraSigma(pen) * s, w: thinOccluder(b.dims, pen) };
}
