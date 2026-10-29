// 실제 그림자(순수, 워클릿): 광원 방향으로 3D 점을 받는 면(평면)에 떨어뜨린다. 화면으로는 책과 같은 project()로 옮긴다.
// 받는 면: 벽(z = SHELF_DEPTH, 책 기준선 뒤 160mm = 앞 끝에서 230mm), 선반 윗면(y = 0).
// 광원은 면 밝기(램버트)와 같은 방향이다(domain/light-model). 면광원이라 가리는 물체에서 멀수록 번진다.
import { light, physShadow } from "@/scene-config/lighting";

import { add, corners, rot, type Book3, type Vec3 } from "./book3";
import { SHELF_DEPTH, SHELF_FRONT } from "./geometry";

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
  gradient = true,
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
    if (gradient) ts.push(t);
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
  // 구간별 그림자 렌더링은 거리만 쓰므로 기울기 추정·공분산 계산을 생략한다.
  if (!gradient) return { pts: out, dist, near: null, far: null, tFar };
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

// 볼록 다면체(꼭짓점 cs)에서 f가 (lo, hi]인 부분의 꼭짓점: 그 사이 꼭짓점 + 변이 lo·hi를 지나는 점.
// 상자(꼭짓점 8개)는 12개 변으로, 판에 가려 잘린 조각은 모든 두 점 쌍으로(실제 변이 아닌 쌍의 점도 다면체 안이라 볼록 외곽은 같다)
function bandPart(cs: Vec3[], f: number[], lo: number, hi: number, box = true): Vec3[] {
  "worklet";
  const out: Vec3[] = [];
  for (let i = 0; i < cs.length; i++) if (f[i] >= lo && f[i] <= hi) out.push(cs[i]);
  const cut = (i: number, j: number) => {
    for (const L of [lo, hi]) {
      if ((f[i] - L) * (f[j] - L) >= 0) continue;
      const t = (L - f[i]) / (f[j] - f[i]);
      out.push({ x: cs[i].x + (cs[j].x - cs[i].x) * t, y: cs[i].y + (cs[j].y - cs[i].y) * t, z: cs[i].z + (cs[j].z - cs[i].z) * t });
    }
  };
  if (box) for (const [i, j] of BOX_EDGES) cut(i, j);
  else for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) cut(i, j);
  return out;
}

// ---------- 판에 가린 부분 ----------
// 빛줄기는 아래·벽 쪽으로 간다. 선반 앞(z < -SHELF_FRONT)에 있는 점의 빛줄기는 판 앞 끝(z = -SHELF_FRONT)을 지날 때
// 높이가 entryY만큼으로 내려가 있다(판 안쪽 점은 제 높이). 이 높이가 위 판 아랫면(줄 공간 높이 ceil)보다 위면 위 판이 막아
// 이 줄의 벽·판 윗면·책에 닿지 않는다. 다른 줄로 옮겨 가는 책이 판 앞을 지나는 동안 그림자가 판에 가린 만큼만 남아 이어서 늘고 준다.
export const CEIL_K = -BOOK_LIGHT.y / BOOK_LIGHT.z;
// 빛줄기가 1DU 내려가는 동안 가로로 가는 거리(빛이 왼쪽에서 와서 오른쪽으로 간다)
export const DROP_K = BOOK_LIGHT.x / -BOOK_LIGHT.y;

// 벽 위 그림자(벽 평면 x-y의 볼록 다각형)를 판에 가려지지 않고 벽에 닿는 부분으로 나눈다: 판 윗면(y = 0) 위, 그리고 판 윗면 아래는
// 판 끝 너머(판 양 끝 옆 벽)만. 오른쪽 끝 너머는 빛줄기가 y = 0을 지날 때 이미 판 끝 밖이어야 판 윗면에 막히지 않는다(빛이 오른쪽으로 가므로
// 그만큼 비스듬한 경계). 왼쪽 끝 너머는 판 끝 왼쪽 벽(빛줄기가 판에 닿기 전).
export function wallParts(poly: { x: number; y: number }[], x0: number, x1: number): { x: number; y: number }[][] {
  "worklet";
  const clip = (P: { x: number; y: number }[], f: (q: { x: number; y: number }) => number) => {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      const fa = f(a);
      const fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {
        const t = fa / (fa - fb);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out;
  };
  const top = clip(poly, (q) => q.y);
  const below = clip(poly, (q) => -q.y);
  const right = below.length >= 3 ? clip(below, (q) => q.x - x1 - DROP_K * -q.y) : [];
  const left = below.length >= 3 ? clip(below, (q) => x0 - q.x) : [];
  return [top, right, left].filter((q) => q.length >= 3);
}
export function entryY(c: Vec3) {
  "worklet";
  return c.y + CEIL_K * Math.min(0, c.z + SHELF_FRONT);
}

// 볼록 다면체 꼭짓점 cs에서 f(c) ≤ lim(keepBelow) 또는 ≥ lim인 부분의 꼭짓점(모든 두 점 쌍이 lim을 지나는 점 포함)
function clipPts(cs: Vec3[], f: (c: Vec3) => number, lim: number, keepBelow: boolean): Vec3[] {
  "worklet";
  const v = cs.map((c) => (keepBelow ? lim - f(c) : f(c) - lim));
  const out: Vec3[] = [];
  for (let i = 0; i < cs.length; i++) if (v[i] >= 0) out.push(cs[i]);
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      if (v[i] * v[j] >= 0) continue;
      const t = v[i] / (v[i] - v[j]);
      out.push({ x: cs[i].x + (cs[j].x - cs[i].x) * t, y: cs[i].y + (cs[j].y - cs[i].y) * t, z: cs[i].z + (cs[j].z - cs[i].z) * t });
    }
  return out;
}

// 이 줄(판 윗면 y = 0 ~ 위 판 아랫면 ceil)에 그림자를 드리울 수 있는가: 판 윗면보다 위인 부분이 있고, 판 앞 끝을 지나는 빛줄기 높이가
// 위 판 아래인 부분이 있다(bookCast가 같은 경계로 자른다: 그 경계에서 그림자는 0이라 이 판정으로 빼도 튀지 않는다)
export function castsIn(b: Book3, ceil: number) {
  "worklet";
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of corners(b)) {
    lo = Math.min(lo, entryY(c));
    hi = Math.max(hi, c.y);
  }
  return hi > 0 && lo < ceil;
}

// 책 면이 받는 그림자의 가리개로 쓸 상자: 위 판이 막는 부분(entryY > ceil)을 뺀 상자. 상자로 남기려고 높이가 가장 많이 바뀌는 책 축을 따라
// 네 변 모두 ceil 아래가 되는 만큼만 남긴다(조금 덜 남아 그림자가 조금 옅을 수는 있어도 판을 뚫고 드리우지 않는다). 다 가리면 null
export function underCeil(b: Book3, ceil: number): Book3 | null {
  "worklet";
  if (!(ceil < Infinity)) return b;
  const cs = corners(b);
  const g = cs.map(entryY);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of g) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (hi <= ceil) return b;
  if (lo >= ceil) return null;
  const bits = [1, 2, 4];
  let axis = 0;
  let best = -1;
  for (let a = 0; a < 3; a++) {
    let sum = 0;
    for (let i = 0; i < 8; i++) if (!(i & bits[a])) sum += Math.abs(g[i | bits[a]] - g[i]);
    if (sum > best) {
      best = sum;
      axis = a;
    }
  }
  let u0 = 0;
  let u1 = 1;
  for (let i = 0; i < 8; i++) {
    if (i & bits[axis]) continue;
    const g0 = g[i];
    const g1 = g[i | bits[axis]];
    if (g1 > g0) {
      if (g1 > ceil) u1 = Math.min(u1, Math.max(0, (ceil - g0) / (g1 - g0)));
    } else if (g0 > ceil) u0 = Math.max(u0, g0 === g1 ? 1 : Math.min(1, (g0 - ceil) / (g0 - g1)));
  }
  if (u1 - u0 <= 1e-3) return null;
  const d = b.dims;
  const L = axis === 0 ? d.T : axis === 1 ? d.H : d.W;
  const off = { x: axis === 0 ? u0 * L : 0, y: axis === 1 ? u0 * L : 0, z: axis === 2 ? u0 * L : 0 };
  const n = (u1 - u0) * L;
  return { ...b, dims: { T: axis === 0 ? n : d.T, H: axis === 1 ? n : d.H, W: axis === 2 ? n : d.W }, t: add(rot(b.roll, b.yaw, off, b.spin ?? 0, b.pitch ?? 0), b.t) };
}

// 반그림자 폭 w(DU)를 가우스 흐림 시그마로: 원반 광원의 반그림자는 폭 w의 경사이고, 가운데 기울기가 같은 가우스는 σ = w / √(2π)
export function penumbraSigma(w: number) {
  "worklet";
  return w / Math.sqrt(2 * Math.PI);
}

// 빛에서 본 가리개의 폭: 빛 방향에 수직인 두 축(가로 SEEN_U, 그에 수직 SEEN_V)으로 상자 꼭짓점을 잰 범위(좁은 쪽, 넓은 쪽).
// 예전에는 상자의 짧은 두 변을 썼는데, 표지가 앞으로 보이는 책은 얇은 두께가 빛 방향(깊이)이라 빛에서는 넓게 보이는데도 얇은 것으로 쳐
// 벽 그림자가 절반쯤(깊이 −53에서 0.47) 옅었다
const SEEN_U = (() => {
  const D = BOOK_LIGHT;
  const u = { x: D.z, y: 0, z: -D.x };
  const l = Math.hypot(u.x, u.z) || 1;
  return { x: u.x / l, y: 0, z: u.z / l };
})();
const SEEN_V = (() => {
  const D = BOOK_LIGHT;
  const u = SEEN_U;
  const v = { x: D.y * u.z - D.z * u.y, y: D.z * u.x - D.x * u.z, z: D.x * u.y - D.y * u.x };
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();
export function seenSize(cs: Vec3[]): [number, number] {
  "worklet";
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const c of cs) {
    const u = c.x * SEEN_U.x + c.y * SEEN_U.y + c.z * SEEN_U.z;
    const v = c.x * SEEN_V.x + c.y * SEEN_V.y + c.z * SEEN_V.z;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const a = u1 - u0;
  const b = v1 - v0;
  return a < b ? [a, b] : [b, a];
}

// 광원 원반 중 가리개가 가리는 몫: 빛에서 본 가리개의 두 폭(seen, seenSize)이 반그림자 폭 pen보다 좁으면 그 비율만큼만 가린다
// (붙은 곳은 진하고 멀수록 빨리 옅어진다)
export function thinOccluder(seen: [number, number], pen: number) {
  "worklet";
  const w = Math.max(1e-3, pen);
  return Math.min(1, seen[0] / w) * Math.min(1, seen[1] / w);
}

// k번째 구간의 책 그림자(벽 wall = true, 선반 윗면 false). s: 캔버스 배율.
// ceil: 위 판 아랫면 높이(위에 줄이 없으면 Infinity). 판에 가린 부분은 빼고 떨어뜨린다: 선반 윗면에는 판 윗면 위의 부분만
// (벽은 판 윗면 아래로 떨어지는 부분이 벽 그림 밖이라 저절로 빠진다), 위에 줄이 있으면 빛줄기가 위 판 아래로 들어오는 부분만(entryY)
export function bookCast(b: Book3, s: number, k: number, wall: boolean, ceil = Infinity): BookCast {
  "worklet";
  const B = physShadow.bands;
  const lo = k === 0 ? 0 : B[k - 1];
  const hi = B[k];
  const D = BOOK_LIGHT;
  const full = corners(b);
  let cs = full;
  let box = true;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const c of cs) {
    y0 = Math.min(y0, c.y);
    y1 = Math.max(y1, c.y);
  }
  if (!wall && y0 < -0.05) {
    cs = clipPts(cs, (c) => c.y, 0, false);
    box = false;
  }
  if (ceil < Infinity && y1 > ceil) {
    cs = clipPts(cs, entryY, ceil, true);
    box = false;
  }
  if (cs.length < 3) return null;
  const f = cs.map((c) => (wall ? Math.max(0, (SHELF_DEPTH - c.z) / D.z) : Math.max(0, c.y / -D.y)));
  let f0 = Infinity;
  let f1 = -Infinity;
  for (const v of f) {
    f0 = Math.min(f0, v);
    f1 = Math.max(f1, v);
  }
  if (f1 <= lo || f0 > hi) return null;
  const part = bandPart(cs, f, lo, hi, box);
  if (part.length < 3) return null;
  const pts: Vec3[] = part.map((c) => (wall ? onWall(c, D, SHELF_DEPTH) : onFloor(c, D, 0)));
  const pen = physShadow.spread * ((Math.max(lo, f0) + Math.min(hi, f1)) / 2);
  // 가리는 몫은 그 구간에서 가장 가까운 곳의 반그림자로(그림자 가운데의 진하기는 가장 가까운 부분이 정한다). 구간 가운데로 재면
  // 책이 구간 경계를 넘을 때 몫이 한 번에 바뀌어(반지름 16°면 0.5) 벽 그림자가 튀었다
  return { pts, sigma: penumbraSigma(pen) * s, w: thinOccluder(seenSize(full), physShadow.spread * Math.max(lo, f0)) };
}

// k번째 구간의 책 그림자: 판 앞면(z = −SHELF_FRONT, 판 윗면 y = 0 ~ 아랫면 −SHELF_THICK). 빛이 벽 쪽(+z)으로 가므로 판 앞 끝보다 앞인
// 부분(선반 앞으로 빼낸 책, 다른 줄로 옮겨 가는 책)만 드리운다. 판 윗면 위로 지나는 빛줄기는 앞면 그림 밖이라 저절로 빠진다(판 윗면 몫은 bookCast)
export function frontCast(b: Book3, s: number, k: number): BookCast {
  "worklet";
  const B = physShadow.bands;
  const lo = k === 0 ? 0 : B[k - 1];
  const hi = B[k];
  const D = BOOK_LIGHT;
  const full = corners(b);
  let cs = full;
  let box = true;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const c of cs) {
    z0 = Math.min(z0, c.z);
    z1 = Math.max(z1, c.z);
  }
  if (z0 >= -SHELF_FRONT - 0.05) return null;
  if (z1 > -SHELF_FRONT) {
    cs = clipPts(cs, (c) => c.z, -SHELF_FRONT, true);
    box = false;
  }
  if (cs.length < 3) return null;
  const f = cs.map((c) => Math.max(0, (-SHELF_FRONT - c.z) / D.z));
  let f0 = Infinity;
  let f1 = -Infinity;
  for (const v of f) {
    f0 = Math.min(f0, v);
    f1 = Math.max(f1, v);
  }
  if (f1 <= lo || f0 > hi) return null;
  const part = bandPart(cs, f, lo, hi, box);
  if (part.length < 3) return null;
  const pts: Vec3[] = part.map((c) => onWall(c, D, -SHELF_FRONT));
  const pen = physShadow.spread * ((Math.max(lo, f0) + Math.min(hi, f1)) / 2);
  return { pts, sigma: penumbraSigma(pen) * s, w: thinOccluder(seenSize(full), physShadow.spread * Math.max(lo, f0)) };
}

// 판 앞 끝보다 앞에 나와 있는가(판 앞면에 그림자를 드리울 수 있다)
export function aheadOfPlank(b: Book3) {
  "worklet";
  for (const c of corners(b)) if (c.z < -SHELF_FRONT - 0.05) return true;
  return false;
}
