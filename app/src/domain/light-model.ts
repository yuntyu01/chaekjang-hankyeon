// 빛 모델(순수, UI 스레드 워클릿에서도 쓴다). 화면의 모든 밝기·그림자·어둠·반사광을 장면 입력(ui/lighting)과 3D 형태에서 계산하는 원칙 하나.
// 같은 식을 화소마다 계산하는 셰이더는 ui/SceneLight(이 파일과 식·이름을 맞춘다).
//
// 1) 면이 받는 빛 E(n) = 하늘 ambient + skyUp·n.y + 창빛 diffuse·max(0, n·L)(램버트). 화면 밝기 = 재질 색 × E / E_REF.
// 2) 창빛 그림자: 가리개를 빛 방향으로 받는 면에 떨어뜨린 모양(cast-shadow). 가려진 곳은 창빛 몫만 빠진다(진하기 = 그 몫 / E(n)).
//    가장자리는 광원 크기만큼 번진다(반그림자 폭 = 2·tan(반지름)·빛 길이). 판처럼 긴 가리개는 광원 원반이 가려진 넓이로 계산한다.
// 3) 하늘 가림(주변광 차폐): 받는 점에서 가리개 면이 보이는 양(뷰 팩터 F, 램버트 윤곽 적분으로 정확히)만큼 그 방향의 빛이 바뀐다.
//    둘레(판 윗면·벽·윗선반 아랫면)는 하늘 앞에 있고, 책은 둘레나 하늘 앞에 있다:
//      둘레 면: F·(하늘 밝기 − 그 면 밝기),  책 면: F·(그 뒤에 보일 것의 밝기 − 책 면 밝기).
//    면 밝기 = 반사율 × 그 면이 받는 빛(가림 없이, 한 번 되비침). 밝은 판이 하늘보다 밝으면 오히려 밝아진다.
//    방향에 따라 바뀌는 밝기는 그 면이 보이는 방향들의 대표 방향(벡터 뷰 팩터의 방향)에서 읽는다.
// 4) 반사광: 유전체의 프레넬 반사를 거칠기까지 넣어(환경 반사 근사 EnvBRDF, GGX 창빛 하이라이트). 확산 몫은 반사된 만큼 줄어든다.
// 워클릿은 만들어질 때 쓰는 함수를 붙잡으므로, 쓰이는 함수를 먼저 정의한다.
import { light, material, surfaces } from '@/ui/lighting';

import { corners, type Book3 } from './book3';
import { rigOf } from './book-parts';
import type { Cam, Vec3 } from './camera';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from './geometry';

// 화면 감마(합성·색 → 반사율 모두 같은 값)
export const GAMMA = 2.2;
// 화면에서 구별되지 않는 밝기 차이(한 단계의 절반): 이보다 작은 그림자·가림은 계산하지 않는다
export const NEGLIGIBLE = 0.5 / 255;

const LL = Math.hypot(light.dir.x, light.dir.y, light.dir.z) || 1;
// 면 → 광원 단위 벡터
export const L_UNIT: Vec3 = { x: light.dir.x / LL, y: light.dir.y / LL, z: light.dir.z / LL };

// 면이 받는 빛(가리는 것 없을 때). n: 바깥 법선(단위)
export function irradiance(n: Vec3) {
  'worklet';
  const nl = n.x * L_UNIT.x + n.y * L_UNIT.y + n.z * L_UNIT.z;
  return light.ambient + light.skyUp * n.y + light.diffuse * Math.max(0, nl);
}
// 창빛 몫만
export function keyIrradiance(n: Vec3) {
  'worklet';
  return light.diffuse * Math.max(0, n.x * L_UNIT.x + n.y * L_UNIT.y + n.z * L_UNIT.z);
}
// 노출 기준: 가리는 것 없는 정면 면(법선 -z). 재질 색은 이 밝기에서의 색이다
export const E_REF = light.ambient + light.diffuse * Math.max(0, -L_UNIT.z);
// 하늘 밝기(방향 ω, π·휘도 단위: 코사인 적분이 irradiance의 하늘 몫과 같다). 가장 밝은 곳은 바로 위
export function skyRadiance(w: Vec3) {
  'worklet';
  return light.ambient + 1.5 * light.skyUp * w.y;
}
export const SKY_MAX = light.ambient + 1.5 * light.skyUp;

// 색(#RRGGBB) → 선형 RGB, 반사율(선형 밝기)
export function linearOf(hex: string): [number, number, number] {
  'worklet';
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  const lin = (v: number) => Math.pow(v / 255, GAMMA);
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}
export function albedoOf(hex: string) {
  'worklet';
  const [r, g, b] = linearOf(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// 둘레 면의 밝기(반사율 × 받는 빛): 판 윗면(위를 향함), 벽(앞을 향함), 윗선반 아랫면(아래를 향함)
export const PLANK_ALBEDO = albedoOf(surfaces.plank);
export const WALL_ALBEDO = albedoOf(surfaces.wall);
export const PAPER_ALBEDO = albedoOf(surfaces.paper);
export const RAD_FLOOR = PLANK_ALBEDO * irradiance({ x: 0, y: 1, z: 0 });
export const RAD_WALL = WALL_ALBEDO * irradiance({ x: 0, y: 0, z: -1 });
export const RAD_UNDER = PLANK_ALBEDO * irradiance({ x: 0, y: -1, z: 0 });
// 판 양 끝면(왼쪽 끝은 −x, 오른쪽 끝은 +x를 향함)
export const RAD_END_L = PLANK_ALBEDO * irradiance({ x: -1, y: 0, z: 0 });
export const RAD_END_R = PLANK_ALBEDO * irradiance({ x: 1, y: 0, z: 0 });
// 벽은 판보다 훨씬 넓고 높다(하늘 가림 계산에서 끝이 보이지 않을 만큼)
export const FAR = 1e4;

// ---------- 다각형이 보이는 양(정확한 적분) ----------
// 점 p 기준 볼록 다각형(꼭짓점은 p에서의 벡터)의
//   F = (1/π)∫ cosθ dω(뷰 팩터)와 M = (1/π)∫ ω cosθ dω(코사인 가중 1차 모멘트, M/F = 그 면이 보이는 방향들의 코사인 가중 평균).
// 하늘 밝기는 ω.y에 1차라 이 둘로 정확히 적분된다: (1/π)∫ L(ω) cosθ dω = ambient·F + 1.5·skyUp·M.y.
// 구면 다각형의 변(대원 호, 끝 단위 벡터 u0 → u1, 끼인각 θ, 호 평면 법선 m)마다:
//   램버트 윤곽 적분 ∫ cosθ dω = |Σ θ m·n| / 2,
//   구면 발산 정리((ω·a)(ω·n) − (a·n)/3은 2차 구면 조화 함수): ∫(ω·a)(ω·n)dω = (a·n)Ω/3 − (1/6)Σ[(ν·a)(n·W) + (ν·n)(a·W)],
//   W = ∫호 ω ds = u0 sinθ + q(1 − cosθ)(q: 호 평면에서 u0에 수직, u1 쪽), ν = 바깥 법선, Ω = 2π − Σ 꺾인 각(지라르).
export type VF = { F: number; M: Vec3 };
const NO_VF: VF = { F: 0, M: { x: 0, y: 0, z: 0 } };
export function moments(pts: Vec3[], n: Vec3): VF {
  'worklet';
  if (pts.length < 3) return NO_VF;
  const us = pts.map((q) => {
    const l = Math.hypot(q.x, q.y, q.z) || 1;
    return { x: q.x / l, y: q.y / l, z: q.z / l };
  });
  let f = 0;
  let turn = 0;
  let Sx = 0;
  let Sy = 0;
  let Sz = 0;
  const ms: Vec3[] = [];
  for (let i = 0; i < us.length; i++) {
    const u0 = us[i];
    const u1 = us[(i + 1) % us.length];
    const c = Math.max(-1, Math.min(1, u0.x * u1.x + u0.y * u1.y + u0.z * u1.z));
    const cx = u0.y * u1.z - u0.z * u1.y;
    const cy = u0.z * u1.x - u0.x * u1.z;
    const cz = u0.x * u1.y - u0.y * u1.x;
    const sn = Math.hypot(cx, cy, cz);
    if (sn < 1e-12) continue;
    const th = Math.atan2(sn, c);
    const m = { x: cx / sn, y: cy / sn, z: cz / sn };
    ms.push(m);
    f += th * (m.x * n.x + m.y * n.y + m.z * n.z);
    const k = (1 - c) / sn;
    const W = { x: u0.x * sn + (u1.x - c * u0.x) * k, y: u0.y * sn + (u1.y - c * u0.y) * k, z: u0.z * sn + (u1.z - c * u0.z) * k };
    const nW = n.x * W.x + n.y * W.y + n.z * W.z;
    const mn = m.x * n.x + m.y * n.y + m.z * n.z;
    Sx += m.x * nW + W.x * mn;
    Sy += m.y * nW + W.y * mn;
    Sz += m.z * nW + W.z * mn;
  }
  if (ms.length < 3) return NO_VF;
  for (let i = 0; i < ms.length; i++) {
    const a = ms[i];
    const b = ms[(i + 1) % ms.length];
    turn += Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
  }
  const omega = Math.max(0, 2 * Math.PI - turn);
  const sg = f < 0 ? -1 : 1;
  const k = 1 / Math.PI;
  return { F: Math.abs(f) / (2 * Math.PI), M: { x: k * ((n.x * omega) / 3 + (sg * Sx) / 6), y: k * ((n.y * omega) / 3 + (sg * Sy) / 6), z: k * ((n.z * omega) / 3 + (sg * Sz) / 6) } };
}

// 볼록 다각형을 평면 x·w ≥ off 쪽만 남긴다(서덜랜드–호지먼)
export function clipPoly(pts: Vec3[], w: Vec3, off: number): Vec3[] {
  'worklet';
  const out: Vec3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length];
    const b = pts[i];
    const da = a.x * w.x + a.y * w.y + a.z * w.z - off;
    const db = b.x * w.x + b.y * w.y + b.z * w.z - off;
    if (db >= 0) {
      if (da < 0) {
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      }
      out.push(b);
    } else if (da >= 0) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

// 받는 면 위쪽 반구(법선 n)로 자른 다각형(p 기준)
const HORIZON = 1e-4;
export function visiblePart(p: Vec3, n: Vec3, poly: Vec3[]): Vec3[] {
  'worklet';
  return clipPoly(
    poly.map((q) => ({ x: q.x - p.x, y: q.y - p.y, z: q.z - p.z })),
    n,
    HORIZON,
  );
}
export function polyVF(p: Vec3, n: Vec3, poly: Vec3[]): VF {
  'worklet';
  return moments(visiblePart(p, n, poly), n);
}

// 하늘 앞의 면(F, M)이 가린 하늘 빛(코사인 가중 적분, 정확)
export function skyOf(F: number, M: Vec3) {
  'worklet';
  return light.ambient * F + 1.5 * light.skyUp * M.y;
}

// ---------- 둘레(한 줄의 선반 공간) ----------
// floor: 판 윗면 높이(없으면 −FAR: 맨 아랫줄 판 밑 벽), ceil: 위 판 아랫면 높이(없으면 FAR: 맨 윗줄).
// 판은 x ∈ [SHELF_X0, SHELF_X1], z ∈ [−SHELF_FRONT, SHELF_DEPTH], 두께 SHELF_THICK(아래 판은 floor 아래로, 위 판은 ceil 위로),
// 벽은 z = SHELF_DEPTH(판 사이). 판은 상자라 판 양 끝면도 가린다(판 끝 너머 벽 띠에서 보인다).
// below·above: 아래 줄의 판 윗면 높이, 위 줄의 위 판 아랫면 높이(이 줄 좌표, 없으면 비움). 판 끝 너머의 점은 판 끝 평면(창)의
// 판 사이 틈마다 그 줄 안(판 윗면·아랫면)을 본다. 두 줄 넘어 떨어진 줄은 창 너머로 화면 한 단계(NEGLIGIBLE)보다 작게 보여 넣지 않는다
export type Env = { floor: number; ceil: number; below?: number; above?: number };

// 판 끝 너머에서 보이는 줄의 틈(판 윗면, 위 판 아랫면): 아래 줄, 이 줄, 위 줄
export function gapsOf(env: Env): [number, number][] {
  'worklet';
  const out: [number, number][] = [];
  if (env.below !== undefined && env.floor > -FAR) out.push([env.below, env.floor - SHELF_THICK]);
  out.push([env.floor, env.ceil]);
  if (env.above !== undefined && env.ceil < FAR) out.push([env.ceil + SHELF_THICK, env.above]);
  return out;
}
// 판 상자(아래 높이, 위 높이): 틈들의 아래·위 판
export function slabsOf(env: Env): [number, number][] {
  'worklet';
  const out: [number, number][] = [];
  const gs = gapsOf(env);
  for (const [f] of gs) if (f > -FAR) out.push([f - SHELF_THICK, f]);
  const top = gs[gs.length - 1][1];
  if (top < FAR) out.push([top, top + SHELF_THICK]);
  return out;
}
// 판 끝 평면(창) x = X를 지나는 높이가 Y 이상(위쪽) 또는 이하인 방향의 반공간(x·w ≥ 0). 받는 점 p는 창 바깥
function windowPlane(p: Vec3, X: number, Y: number, up: boolean): Vec3 {
  'worklet';
  const dx = X - p.x;
  const sg = (dx > 0 ? 1 : -1) * (up ? 1 : -1);
  return { x: -sg * (Y - p.y), y: sg * dx, z: 0 };
}
const inPlank = (x: number, z: number) => {
  'worklet';
  return x >= SHELF_X0 && x <= SHELF_X1 && z >= -SHELF_FRONT && z <= SHELF_DEPTH;
};
// 한 줄 안(판 윗면 floor, 위 판 아랫면 ceil, 그 사이 벽)에서 광선이 처음 닿는 곳
function rowHit(p: Vec3, w: Vec3, floor: number, ceil: number, best: number, rad: number) {
  'worklet';
  if (w.y < -1e-6 && floor > -FAR) {
    const t = (floor - p.y) / w.y;
    if (t > 0 && t < best && inPlank(p.x + w.x * t, p.z + w.z * t)) {
      best = t;
      rad = RAD_FLOOR;
    }
  }
  if (w.y > 1e-6 && ceil < FAR) {
    const t = (ceil - p.y) / w.y;
    if (t > 0 && t < best && inPlank(p.x + w.x * t, p.z + w.z * t)) {
      best = t;
      rad = RAD_UNDER;
    }
  }
  if (w.z > 1e-6) {
    const t = (SHELF_DEPTH - p.z) / w.z;
    const y = p.y + w.y * t;
    if (t > 0 && t < best && y >= floor && y <= ceil) {
      best = t;
      rad = RAD_WALL;
    }
  }
  return { t: best, rad };
}

// 점 p에서 방향 w로 처음 보이는 둘레 면의 밝기(없으면 하늘)와 거리
export function envHit(p: Vec3, w: Vec3, env: Env | null): { t: number; rad: number } {
  'worklet';
  const sky = skyRadiance(w);
  if (!env) return { t: Infinity, rad: sky };
  if (p.x >= SHELF_X0 && p.x <= SHELF_X1) return rowHit(p, w, env.floor, env.ceil, Infinity, sky);
  // 판 끝 너머: 이 줄 높이의 벽은 바로 닿고, 판 쪽 방향은 판 끝 평면(창)을 지나는 높이로 정한다: 판 상자면 그 끝면, 틈이면 그 줄 안
  let hit = { t: Infinity, rad: sky };
  if (w.z > 1e-6) {
    const t = (SHELF_DEPTH - p.z) / w.z;
    const y = p.y + w.y * t;
    if (t > 0 && y >= env.floor && y <= env.ceil) hit = { t, rad: RAD_WALL };
  }
  const X = p.x < SHELF_X0 ? SHELF_X0 : SHELF_X1;
  if ((X - p.x) * w.x <= 1e-9) return hit;
  const t = (X - p.x) / w.x;
  const y = p.y + w.y * t;
  const z = p.z + w.z * t;
  if (z < -SHELF_FRONT || z > SHELF_DEPTH || t >= hit.t) return hit;
  for (const [y0, y1] of slabsOf(env)) if (y >= y0 && y <= y1) return { t, rad: w.x > 0 ? RAD_END_L : RAD_END_R };
  for (const [f, c] of gapsOf(env)) if (y > f && y < c) return rowHit(p, w, f, c, hit.t, hit.rad);
  return hit;
}

// 둘레 면들(볼록 사각형, 밝기, 바깥 법선). clip: 판 끝 너머의 점에서 그 면이 보이는 창의 틈(아래·위 높이), 없으면 창을 지나지 않는다
type EnvQuad = { poly: Vec3[]; rad: number; n: Vec3; gap?: [number, number] };
export function envQuads(env: Env, p: Vec3): EnvQuad[] {
  'worklet';
  const out: EnvQuad[] = [];
  const plank = (y: number) => [
    { x: SHELF_X0, y, z: -SHELF_FRONT },
    { x: SHELF_X1, y, z: -SHELF_FRONT },
    { x: SHELF_X1, y, z: SHELF_DEPTH },
    { x: SHELF_X0, y, z: SHELF_DEPTH },
  ];
  const y0 = Math.max(env.floor, -FAR);
  const y1 = Math.min(env.ceil, FAR);
  out.push({ poly: [{ x: -FAR, y: y0, z: SHELF_DEPTH }, { x: FAR, y: y0, z: SHELF_DEPTH }, { x: FAR, y: y1, z: SHELF_DEPTH }, { x: -FAR, y: y1, z: SHELF_DEPTH }], rad: RAD_WALL, n: { x: 0, y: 0, z: -1 } });
  if (p.x >= SHELF_X0 && p.x <= SHELF_X1) {
    if (env.floor > -FAR) out.push({ poly: plank(env.floor), rad: RAD_FLOOR, n: { x: 0, y: 1, z: 0 } });
    if (env.ceil < FAR) out.push({ poly: plank(env.ceil), rad: RAD_UNDER, n: { x: 0, y: -1, z: 0 } });
    return out;
  }
  // 판 끝 너머: 틈마다 그 줄의 판 윗면·아랫면(창의 그 틈으로), 판 상자마다 가까운 끝면
  for (const g of gapsOf(env)) {
    if (g[0] > -FAR) out.push({ poly: plank(g[0]), rad: RAD_FLOOR, n: { x: 0, y: 1, z: 0 }, gap: g });
    if (g[1] < FAR) out.push({ poly: plank(g[1]), rad: RAD_UNDER, n: { x: 0, y: -1, z: 0 }, gap: g });
  }
  const left = p.x < SHELF_X0;
  const X = left ? SHELF_X0 : SHELF_X1;
  for (const [ya, yb] of slabsOf(env))
    out.push({ poly: [{ x: X, y: ya, z: -SHELF_FRONT }, { x: X, y: ya, z: SHELF_DEPTH }, { x: X, y: yb, z: SHELF_DEPTH }, { x: X, y: yb, z: -SHELF_FRONT }], rad: left ? RAD_END_L : RAD_END_R, n: { x: left ? -1 : 1, y: 0, z: 0 } });
  return out;
}

// ---------- 책 상자(가리개) ----------
// 가운데 c, 축 단위 벡터(두께·세로·깊이), 반 길이, 면 반사율, 덮개(covers).
// 면 반사율: 표지 두 장·책등 = 장정 색(tone), 머리·꼬리 = 속지와 판 끝 테두리의 넓이 비(head), 책배 = 같은 비(fore).
// 덮개: 이 상자의 한 면(축 k, 방향 s)을 평행하게 마주 보는 이웃 면(간격 g). 나란히 선 책·쌓인 책은 서로 옆면을 가린다:
// 그 이웃 면 너머의 점에서 보면 이 면 중 이웃 면이 가리는 부분(이웃 면 사각형을 보는 점에서 이 면 평면으로 넓혀 투영한 곳)은 안 보인다.
// u·v: 이 면 평면의 두 축((k+1)%3, (k+2)%3) 좌표(상자 가운데 기준)로 이웃 면 사각형의 범위.
export type Cover = { k: number; s: number; g: number; u0: number; u1: number; v0: number; v1: number };
// side: 이 줄 책 0, 위 줄 책 +1, 아래 줄 책 −1. 다른 줄 책은 판에 가려 판 끝 너머의 점에서만 판 위·아래 틈으로 보인다(throughOpening)
export type Box = { c: Vec3; ax: Vec3; ay: Vec3; az: Vec3; hx: number; hy: number; hz: number; tone: number; head: number; fore: number; covers: Cover[]; side: number };

function axisOf(b: Box, k: number) {
  'worklet';
  return k === 0 ? b.ax : k === 1 ? b.ay : b.az;
}
function halfOf(b: Box, k: number) {
  'worklet';
  return k === 0 ? b.hx : k === 1 ? b.hy : b.hz;
}
const dot3 = (a: Vec3, b: Vec3) => {
  'worklet';
  return a.x * b.x + a.y * b.y + a.z * b.z;
};

// 축 k 방향 s 면의 반사율
export function faceAlbedo(b: Box, k: number, s: number) {
  'worklet';
  return k === 0 ? b.tone : k === 1 ? b.head : s < 0 ? b.tone : b.fore;
}

// tone: 장정 재질 반사율. 속지 면은 판 끝 테두리(두께 bd, 책등 띠 sp)를 뺀 넓이만큼 종이. side: 어느 줄 책인지(Box)
export function boxOf(b: Book3, tone: number, side = 0): Box {
  'worklet';
  const cs = corners(b);
  const d = b.dims;
  const { bd, sp } = rigOf(d);
  const pages = Math.max(0, d.T - 2 * bd) / d.T;
  const head = pages * (Math.max(0, d.W - sp) / d.W);
  const axis = (q: Vec3, l: number) => ({ x: (q.x - cs[0].x) / l, y: (q.y - cs[0].y) / l, z: (q.z - cs[0].z) / l });
  return {
    c: { x: (cs[0].x + cs[7].x) / 2, y: (cs[0].y + cs[7].y) / 2, z: (cs[0].z + cs[7].z) / 2 },
    ax: axis(cs[1], d.T),
    ay: axis(cs[2], d.H),
    az: axis(cs[4], d.W),
    hx: d.T / 2,
    hy: d.H / 2,
    hz: d.W / 2,
    tone,
    head: tone + (PAPER_ALBEDO - tone) * head,
    fore: tone + (PAPER_ALBEDO - tone) * pages,
    covers: [],
    side,
  };
}

// 상자마다 덮개(평행하게 마주 보는 가장 가까운 이웃 면). 덮인 넓이가 큰 순으로 COVER_MAX개(나란히 선 책은 양옆 둘)
export const COVER_MAX = 2;
const PARALLEL = 1 - 1e-6;
export function withCovers(list: Box[]): Box[] {
  'worklet';
  return list.map((bi, i) => {
    const found: (Cover & { area: number })[] = [];
    for (let k = 0; k < 3; k++) {
      const ak = axisOf(bi, k);
      const ku = (k + 1) % 3;
      const kv = (k + 2) % 3;
      const au = axisOf(bi, ku);
      const av = axisOf(bi, kv);
      for (const s of [-1, 1]) {
        let best: (Cover & { area: number }) | null = null;
        for (let j = 0; j < list.length; j++) {
          if (j === i) continue;
          const bj = list[j];
          // 이웃 상자의 축이 이 상자 축과 모두 평행해야 한다(면끼리 평행)
          let kj = -1;
          let hu = 0;
          let hv = 0;
          for (let q = 0; q < 3; q++) {
            const aq = axisOf(bj, q);
            if (Math.abs(dot3(aq, ak)) > PARALLEL) kj = q;
            else if (Math.abs(dot3(aq, au)) > PARALLEL) hu = halfOf(bj, q);
            else if (Math.abs(dot3(aq, av)) > PARALLEL) hv = halfOf(bj, q);
          }
          if (kj < 0 || hu === 0 || hv === 0) continue;
          const dc = { x: bj.c.x - bi.c.x, y: bj.c.y - bi.c.y, z: bj.c.z - bi.c.z };
          // 이 면에서 바깥(s·ak)으로 이웃 상자의 가까운 면까지
          const g = s * dot3(dc, ak) - halfOf(bi, k) - halfOf(bj, kj);
          if (g < -1e-3) continue;
          const du = dot3(dc, au);
          const dv = dot3(dc, av);
          const u0 = Math.max(-halfOf(bi, ku), du - hu);
          const u1 = Math.min(halfOf(bi, ku), du + hu);
          const v0 = Math.max(-halfOf(bi, kv), dv - hv);
          const v1 = Math.min(halfOf(bi, kv), dv + hv);
          if (u1 <= u0 || v1 <= v0) continue;
          const area = (u1 - u0) * (v1 - v0);
          if (!best || g < best.g - 1e-6 || (Math.abs(g - best.g) <= 1e-6 && area > best.area)) best = { k, s, g: Math.max(0, g), u0, u1, v0, v1, area };
        }
        if (best) found.push(best);
      }
    }
    found.sort((a, b) => b.area - a.area);
    return { ...bi, covers: found.slice(0, COVER_MAX).map(({ area: _a, ...c }) => c) };
  });
}

// 셰이더 유니폼 묶음(상자마다 float4 여덟: (c, 장정 반사율), (축 x, 반 길이), (축 y, …), (축 z, …),
// 덮개 둘(면 번호 k + 3·(s > 0), 간격 g)·(u0, u1, v0, v1) → (k0, g0, k1, g1), (u0, u1, v0, v1)₀, (…)₁, (머리·책배 반사율, 0, 0)). ids: 상자 순서의 책 id
// 셰이더 유니폼 벡터 수(GLES 3.0 최소 224) 안에 들도록 줄당 BOX_MAX권
export const BOX_MAX = 20;
export const BOX_VEC = 8;
export type BoxBuf = { list: Box[]; ids: string[]; v: number[] };
export function packBoxes(list: Box[], ids: string[]): BoxBuf {
  'worklet';
  const v: number[] = new Array(BOX_MAX * BOX_VEC * 4).fill(0);
  const n = Math.min(BOX_MAX, list.length);
  for (let i = 0; i < n; i++) {
    const b = list[i];
    const o = i * BOX_VEC * 4;
    v[o] = b.c.x; v[o + 1] = b.c.y; v[o + 2] = b.c.z; v[o + 3] = b.tone;
    v[o + 4] = b.ax.x; v[o + 5] = b.ax.y; v[o + 6] = b.ax.z; v[o + 7] = b.hx;
    v[o + 8] = b.ay.x; v[o + 9] = b.ay.y; v[o + 10] = b.ay.z; v[o + 11] = b.hy;
    v[o + 12] = b.az.x; v[o + 13] = b.az.y; v[o + 14] = b.az.z; v[o + 15] = b.hz;
    // 덮개 없음 = 면 번호 −1
    v[o + 16] = -1; v[o + 18] = -1;
    b.covers.slice(0, COVER_MAX).forEach((c, j) => {
      v[o + 16 + j * 2] = c.k + (c.s > 0 ? 3 : 0);
      v[o + 17 + j * 2] = c.g;
      const r = o + 20 + j * 4;
      v[r] = c.u0; v[r + 1] = c.u1; v[r + 2] = c.v0; v[r + 3] = c.v1;
    });
    v[o + 28] = b.head;
    v[o + 29] = b.fore;
    v[o + 30] = b.side;
  }
  return { list: list.slice(0, n), ids: ids.slice(0, n), v };
}
export const NO_BOXES: BoxBuf = packBoxes([], []);
// 상자 목록에서 한 권(self 번째)을 뺀 것: 그 책이 받는 빛을 계산할 때
export function othersOf(bx: BoxBuf, self: number): Box[] {
  'worklet';
  return self < 0 ? bx.list : bx.list.filter((_, i) => i !== self);
}

// ---------- 가리개 뒤에 보였을 것 ----------
// 책 면이 가린 방향들에서, 책이 없었다면 보였을 밝기의 적분. 받는 점 p에서 둘레의 모서리를 지나는 평면들이 방향을 구역으로 나눈다:
// 판 윗면(앞 모서리 ~ 벽 모서리, 판 양 끝 사이), 벽(아래 모서리 ~ 위 모서리), 위 판 아랫면(벽 모서리 ~ 앞 모서리, 판 양 끝 사이), 나머지는 하늘.
// 구역마다 반공간 몇 개의 교집합이라 가리개 다각형을 차례로 잘라 정확히 적분한다(둘레 사각형 envQuads와 같은 범위).
// 반공간은 x·w ≥ 0. 판 앞·뒤 모서리(x축에 평행, 높이 ey, 깊이 ez)를 지나는 평면: 그 모서리보다 아래쪽(x축을 도는 각이 작은 쪽)
function edgePlane(p: Vec3, ey: number, ez: number): Vec3 {
  'worklet';
  return { x: 0, y: -(ez - p.z), z: ey - p.y };
}
// 높이 Y인 판 평면에 닿는 점의 x가 X 이상(ge) 또는 이하인 쪽(그 판 쪽으로 가는 방향에서)
function endPlane(p: Vec3, Y: number, X: number, ge: boolean): Vec3 {
  'worklet';
  const dy = Y - p.y;
  const sg = (dy > 0 ? 1 : -1) * (ge ? 1 : -1);
  return { x: sg * dy, y: -sg * (X - p.x), z: 0 };
}
type Sector = { planes: Vec3[]; rad: number };
function sectorsOf(p: Vec3, env: Env): Sector[] {
  'worklet';
  const floor = env.floor > -FAR;
  const ceil = env.ceil < FAR;
  // 판이 없으면 벽 구역은 바로 아래·바로 위까지
  const FW = floor ? edgePlane(p, env.floor, SHELF_DEPTH) : { x: 0, y: 0, z: -1 };
  const CW = ceil ? edgePlane(p, env.ceil, SHELF_DEPTH) : { x: 0, y: 0, z: 1 };
  const neg = (w: Vec3) => ({ x: -w.x, y: -w.y, z: -w.z });
  const out: Sector[] = [];
  if (floor) out.push({ planes: [FW, neg(edgePlane(p, env.floor, -SHELF_FRONT)), endPlane(p, env.floor, SHELF_X0, true), endPlane(p, env.floor, SHELF_X1, false)], rad: RAD_FLOOR });
  out.push({ planes: [CW, neg(FW)], rad: RAD_WALL });
  if (ceil) out.push({ planes: [edgePlane(p, env.ceil, -SHELF_FRONT), neg(CW), endPlane(p, env.ceil, SHELF_X0, true), endPlane(p, env.ceil, SHELF_X1, false)], rad: RAD_UNDER });
  return out;
}
// 다각형이 반공간 x·w ≥ 0 안(1), 밖(−1), 걸침(0)
function sideOf(P: Vec3[], w: Vec3) {
  'worklet';
  let pos = false;
  let neg = false;
  for (const q of P) {
    const d = q.x * w.x + q.y * w.y + q.z * w.z;
    if (d > 1e-9) pos = true;
    else if (d < -1e-9) neg = true;
  }
  return pos && neg ? 0 : neg ? -1 : 1;
}
const subVF = (a: VF, b: VF): VF => {
  'worklet';
  return { F: a.F - b.F, M: { x: a.M.x - b.M.x, y: a.M.y - b.M.y, z: a.M.z - b.M.z } };
};
// 구역(반공간들의 교집합) 안의 몫
function sectorVF(P: Vec3[], n: Vec3, s: Sector, total: VF): VF {
  'worklet';
  let Q = P;
  let cut = false;
  for (const w of s.planes) {
    const sd = sideOf(Q, w);
    if (sd < 0) return NO_VF;
    if (sd === 0) {
      Q = clipPoly(Q, w, 0);
      cut = true;
      if (Q.length < 3) return NO_VF;
    }
  }
  return cut ? moments(Q, n) : total;
}
// side 줄(0 이 줄, ±1 위·아래 줄)의 둘레: 다른 줄 책 뒤에 보였을 것은 그 줄 안이다
function rowOf(env: Env | null, side: number): Env | null {
  'worklet';
  if (!env || side === 0) return env;
  if (side > 0) return { floor: env.ceil + SHELF_THICK, ceil: env.above ?? FAR };
  return { floor: env.below ?? -FAR, ceil: env.floor - SHELF_THICK };
}
// 가리개 다각형 P(p 기준, 반구로 자른 것)가 가린 방향들에서 그 뒤에 보였을 밝기의 적분(env: 가리개가 있는 줄의 둘레)
function behindOf(p: Vec3, n: Vec3, P: Vec3[], total: VF, env: Env | null) {
  'worklet';
  if (!env) return skyOf(total.F, total.M);
  let rest = total;
  let sum = 0;
  for (const s of sectorsOf(p, env)) {
    const q = sectorVF(P, n, s, total);
    if (q.F === 0) continue;
    sum += s.rad * q.F;
    rest = subVF(rest, q);
  }
  return sum + skyOf(rest.F, rest.M);
}

// 상자 면 위 사각형(축 k 방향 s 면, 면 평면 좌표 u ∈ [u0, u1], v ∈ [v0, v1])의 꼭짓점
function rectOn(b: Box, k: number, s: number, r: number[]): Vec3[] {
  'worklet';
  const a = axisOf(b, k);
  const au = axisOf(b, (k + 1) % 3);
  const av = axisOf(b, (k + 2) % 3);
  const h = halfOf(b, k) * s;
  const P = (u: number, v: number) => ({ x: b.c.x + a.x * h + au.x * u + av.x * v, y: b.c.y + a.y * h + au.y * u + av.y * v, z: b.c.z + a.z * h + au.z * u + av.z * v });
  return [P(r[0], r[2]), P(r[1], r[2]), P(r[1], r[3]), P(r[0], r[3])];
}
// 사각형 r에서 사각형 h를 뺀 띠들(많아야 넷)
function rectMinus(r: number[], h: number[]): number[][] {
  'worklet';
  const u0 = Math.max(r[0], h[0]);
  const u1 = Math.min(r[1], h[1]);
  const v0 = Math.max(r[2], h[2]);
  const v1 = Math.min(r[3], h[3]);
  if (u1 <= u0 || v1 <= v0) return [r];
  const out: number[][] = [];
  if (u0 > r[0]) out.push([r[0], u0, r[2], r[3]]);
  if (u1 < r[1]) out.push([u1, r[1], r[2], r[3]]);
  if (v0 > r[2]) out.push([u0, u1, r[2], v0]);
  if (v1 < r[3]) out.push([u0, u1, v1, r[3]]);
  return out;
}

// 판 끝 너머(x < SHELF_X0 또는 > SHELF_X1)의 점에서는 판 끝 평면을 지나는 높이로 무엇이 보이는지 정해진다(그 밖은 판 끝면이 가린다):
// 이 줄 책(side 0)은 아래 판 윗면 ~ 위 판 아랫면 사이로, 위 줄 책(+1)은 위 판 윗면 위로, 아래 줄 책(−1)은 아래 판 아랫면 아래로.
// 판 끝 안쪽의 점에서 다른 줄 책은 판에 다 가린다(null)
function throughOpening(p: Vec3, P: Vec3[], env: Env | null, side: number): Vec3[] | null {
  'worklet';
  const inside = p.x >= SHELF_X0 && p.x <= SHELF_X1;
  if (!env) return P;
  if (inside) return side === 0 ? P : null;
  if (P.length < 3) return P;
  const dx = (p.x < SHELF_X0 ? SHELF_X0 : SHELF_X1) - p.x;
  const sg = dx > 0 ? 1 : -1;
  // 판 끝 평면을 지나는 높이 ≥ Y, ≤ Y
  const above = (Y: number) => ({ x: -sg * (Y - p.y), y: sg * dx, z: 0 });
  const below = (Y: number) => ({ x: sg * (Y - p.y), y: -sg * dx, z: 0 });
  const hasF = env.floor > -FAR;
  const hasC = env.ceil < FAR;
  if (side > 0) return hasC ? clipPoly(P, above(env.ceil + SHELF_THICK), 0) : null;
  if (side < 0) return hasF ? clipPoly(P, below(env.floor - SHELF_THICK), 0) : null;
  let Q = P;
  if (hasF) Q = clipPoly(Q, above(env.floor), 0);
  if (hasC && Q.length >= 3) Q = clipPoly(Q, below(env.ceil), 0);
  return Q;
}

// 상자 하나가 점 p(법선 n)에서 가리는 빛: p를 향한 면(많아야 셋)의 보이는 부분마다 (그 뒤에 보였을 밝기 − 면 밝기)
export function boxLoss(p: Vec3, n: Vec3, b: Box, env: Env | null) {
  'worklet';
  const dc = { x: b.c.x - p.x, y: b.c.y - p.y, z: b.c.z - p.z };
  // 받는 면 평면 뒤에 통째로 있는 상자는 보이지 않는다(상자 꼭짓점 중 가장 앞선 것)
  if (dot3(dc, n) + b.hx * Math.abs(dot3(b.ax, n)) + b.hy * Math.abs(dot3(b.ay, n)) + b.hz * Math.abs(dot3(b.az, n)) <= 0) return 0;
  let loss = 0;
  for (let k = 0; k < 3; k++) {
    const a = axisOf(b, k);
    const h = halfOf(b, k);
    const dk = -dot3(dc, a);
    if (Math.abs(dk) <= h) continue;
    const s = dk > 0 ? 1 : -1;
    const ku = (k + 1) % 3;
    const kv = (k + 2) % 3;
    const hu = halfOf(b, ku);
    const hv = halfOf(b, kv);
    let rects: number[][] = [[-hu, hu, -hv, hv]];
    // 마주 보는 이웃 면이 가리는 부분(보는 점이 그 이웃 면 너머에 있을 때): 이웃 면 사각형을 보는 점에서 이 면 평면으로 넓혀 투영한 곳
    const D = s * dk - h;
    for (const c of b.covers) {
      if (c.k !== k || c.s !== s || D <= c.g) continue;
      const m = D / (D - c.g);
      const pu = -dot3(dc, axisOf(b, ku));
      const pv = -dot3(dc, axisOf(b, kv));
      const hid = [pu + (c.u0 - pu) * m, pu + (c.u1 - pu) * m, pv + (c.v0 - pv) * m, pv + (c.v1 - pv) * m];
      rects = rects.flatMap((r) => rectMinus(r, hid));
    }
    const rad = faceAlbedo(b, k, s) * irradiance({ x: a.x * s, y: a.y * s, z: a.z * s });
    for (const r of rects) {
      const P = throughOpening(p, visiblePart(p, n, rectOn(b, k, s, r)), env, b.side);
      if (!P) return loss;
      const tot = moments(P, n);
      if (tot.F <= 0) continue;
      loss += behindOf(p, n, P, tot, rowOf(env, b.side)) - tot.F * rad;
    }
  }
  return loss;
}

// 둘레가 점 p(법선 n)에서 가리는 빛
export function envLoss(p: Vec3, n: Vec3, env: Env | null) {
  'worklet';
  if (!env) return 0;
  let loss = 0;
  const X = p.x < SHELF_X0 ? SHELF_X0 : SHELF_X1;
  for (const q of envQuads(env, p)) {
    // 면의 앞쪽(빛을 받는 쪽)에서만 보인다: 판 윗면은 그 위에서, 위 판 아랫면은 그 아래에서
    if ((p.x - q.poly[0].x) * q.n.x + (p.y - q.poly[0].y) * q.n.y + (p.z - q.poly[0].z) * q.n.z <= 0) continue;
    let P = visiblePart(p, n, q.poly);
    if (q.gap) {
      if (q.gap[0] > -FAR) P = clipPoly(P, windowPlane(p, X, q.gap[0], true), 0);
      if (q.gap[1] < FAR && P.length >= 3) P = clipPoly(P, windowPlane(p, X, q.gap[1], false), 0);
    }
    const vf = moments(P, n);
    if (vf.F > 0) loss += skyOf(vf.F, vf.M) - vf.F * q.rad;
  }
  return loss;
}

// 위 판이 창빛 원반을 가리는 몫. 원반을 직선 하나로 자른 넓이 비율(활꼴) 둘의 곱(세로: 판 앞 모서리, 가로: 판 양 끝).
// 받는 점에서 판 앞 모서리까지 위로 d, 앞으로 zf일 때 앙각 atan(d / zf)보다 높은 쪽이 막히고,
// 가로로는 그 모서리 높이에서 판(x ∈ [SHELF_X0, SHELF_X1])을 지나는 방향만 막힌다.
export const L_ELEV = Math.atan2(L_UNIT.y, -L_UNIT.z);
export const L_AZIM = Math.atan2(L_UNIT.x, -L_UNIT.z);
// 원반 가운데에서 반지름 단위로 u 떨어진 직선 너머의 넓이 비율
function segment(u: number) {
  'worklet';
  if (u <= -1) return 1;
  if (u >= 1) return 0;
  return (Math.acos(u) - u * Math.sqrt(1 - u * u)) / Math.PI;
}
export function keyBlocked(d: number, zf: number) {
  'worklet';
  if (d <= 0) return 1;
  return segment((Math.atan2(d, Math.max(1e-3, zf)) - L_ELEV) / light.radius);
}
export function keyBlockedX(x: number, zf: number) {
  'worklet';
  const z = Math.max(1e-3, zf);
  return segment((Math.atan2(SHELF_X0 - x, z) - L_AZIM) / light.radius) - segment((Math.atan2(SHELF_X1 - x, z) - L_AZIM) / light.radius);
}
// 판 끝 너머의 점은 판 높이에 따라 아래·위 판 상자가 창빛 원반의 일부를 옆에서 가린다: 원반을 넓이가 같은 방향 KEY_SAMPLES개로 나눠
// 방향마다 두 판 상자에 막히는지 센다(수치 적분, 표본 수 = 해상도). 판 사이(판 끝 안쪽)는 위 판 앞 모서리 하나라 위 식이 정확하다
export const KEY_SAMPLES = 32;
// 원반 가운데 L_UNIT, 둘레 반지름 각 light.radius: 해바라기 배치(넓이 균일). i번째 방향 = L + (U cos(i·golden) + V sin(i·golden))·tan(radius)·√((i + ½)/N)
export const KEY_BASIS = (() => {
  const t = Math.abs(L_UNIT.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const ux = L_UNIT.y * t.z - L_UNIT.z * t.y;
  const uy = L_UNIT.z * t.x - L_UNIT.x * t.z;
  const uz = L_UNIT.x * t.y - L_UNIT.y * t.x;
  const ul = Math.hypot(ux, uy, uz);
  const U = { x: ux / ul, y: uy / ul, z: uz / ul };
  const V = { x: L_UNIT.y * U.z - L_UNIT.z * U.y, y: L_UNIT.z * U.x - L_UNIT.x * U.z, z: L_UNIT.x * U.y - L_UNIT.y * U.x };
  return { U, V, golden: Math.PI * (3 - Math.sqrt(5)), tan: Math.tan(light.radius) };
})();
export const KEY_DIRS: Vec3[] = Array.from({ length: KEY_SAMPLES }, (_, i) => {
  const { U, V, golden, tan } = KEY_BASIS;
  const r = tan * Math.sqrt((i + 0.5) / KEY_SAMPLES);
  const a = i * golden;
  const d = { x: L_UNIT.x + (U.x * Math.cos(a) + V.x * Math.sin(a)) * r, y: L_UNIT.y + (U.y * Math.cos(a) + V.y * Math.sin(a)) * r, z: L_UNIT.z + (U.z * Math.cos(a) + V.z * Math.sin(a)) * r };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
});
// 광선 p + t·w(t > 0)가 판 상자(높이 y0 ~ y1)에 닿는가
function hitsSlab(p: Vec3, w: Vec3, y0: number, y1: number) {
  'worklet';
  let t0 = 1e-6;
  let t1 = Infinity;
  const axis = (o: number, d: number, lo: number, hi: number) => {
    if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
    return true;
  };
  if (!axis(p.x, w.x, SHELF_X0, SHELF_X1) || !axis(p.y, w.y, y0, y1) || !axis(p.z, w.z, -SHELF_FRONT, SHELF_DEPTH)) return false;
  return t0 <= t1;
}
// 둘레의 판이 점 p에서 창빛 원반을 가리는 몫
export function plankKeyBlocked(p: Vec3, env: Env | null) {
  'worklet';
  if (!env) return 0;
  if (p.x >= SHELF_X0 && p.x <= SHELF_X1) {
    if (env.ceil >= FAR) return 0;
    const zf = p.z + SHELF_FRONT;
    return keyBlocked(env.ceil - p.y, zf) * keyBlockedX(p.x, zf);
  }
  let hit = 0;
  for (const w of KEY_DIRS) {
    if ((env.floor > -FAR && hitsSlab(p, w, env.floor - SHELF_THICK, env.floor)) || (env.ceil < FAR && hitsSlab(p, w, env.ceil, env.ceil + SHELF_THICK))) hit++;
  }
  return hit / KEY_SAMPLES;
}

// 환경 반사 몫(유전체 F0, 거칠기, n·v): 거칠기까지 넣은 프레넬 적분의 근사(Karis/Lazarov EnvBRDFApprox)
export function envBRDF(nv: number) {
  'worklet';
  const r = material.roughness;
  const rx = 1 - r;
  const ry = 0.0425 - 0.0275 * r;
  const rz = 1.04 - 0.572 * r;
  const rw = -0.04 + 0.022 * r;
  const a004 = Math.min(rx * rx, Math.pow(2, -9.28 * Math.max(0, nv))) * rx + ry;
  return material.f0 * (-1.04 * a004 + rz) + (1.04 * a004 + rw);
}

// GGX 창빛 하이라이트(π·휘도 / 창빛 수직 세기): D·G·F / (4 n·v n·l) · n·l · π
export function ggxKey(n: Vec3, v: Vec3) {
  'worklet';
  const nl = n.x * L_UNIT.x + n.y * L_UNIT.y + n.z * L_UNIT.z;
  const nv = n.x * v.x + n.y * v.y + n.z * v.z;
  if (nl <= 0 || nv <= 0) return 0;
  const hx = v.x + L_UNIT.x;
  const hy = v.y + L_UNIT.y;
  const hz = v.z + L_UNIT.z;
  const hl = Math.hypot(hx, hy, hz) || 1;
  const nh = Math.max(0, (n.x * hx + n.y * hy + n.z * hz) / hl);
  const vh = Math.max(0, (v.x * hx + v.y * hy + v.z * hz) / hl);
  const a = material.roughness * material.roughness;
  const a2 = a * a;
  const dd = nh * nh * (a2 - 1) + 1;
  const D = a2 / (Math.PI * dd * dd);
  const k = ((material.roughness + 1) * (material.roughness + 1)) / 8;
  const G = (nv / (nv * (1 - k) + k)) * (nl / (nl * (1 - k) + k));
  const m = 1 - vh;
  const F = material.f0 + (1 - material.f0) * m * m * m * m * m;
  return ((D * G * F) / (4 * nv * nl)) * nl * Math.PI;
}

// 방향 w로 처음 보이는 것의 밝기: 책 상자(가장 가까운 면) → 둘레 → 하늘(광선 적분 검사가 쓰는 장면)
export function traceRadiance(p: Vec3, w: Vec3, env: Env | null, boxes: Box[]) {
  'worklet';
  const e = envHit(p, w, env);
  let best = e.t;
  let rad = e.rad;
  for (const b of boxes) {
    const o = { x: p.x - b.c.x, y: p.y - b.c.y, z: p.z - b.c.z };
    let t0 = -Infinity;
    let t1 = Infinity;
    let na: Vec3 = b.ax;
    let nk = 0;
    let ns = 1;
    for (let k = 0; k < 3; k++) {
      const a = axisOf(b, k);
      const h = halfOf(b, k);
      const ol = o.x * a.x + o.y * a.y + o.z * a.z;
      const wl = w.x * a.x + w.y * a.y + w.z * a.z;
      if (Math.abs(wl) < 1e-9) {
        if (Math.abs(ol) > h) t0 = Infinity;
        continue;
      }
      const ta = (-h - ol) / wl;
      const tb = (h - ol) / wl;
      const lo = Math.min(ta, tb);
      if (lo > t0) {
        t0 = lo;
        na = a;
        nk = k;
        ns = wl > 0 ? -1 : 1;
      }
      t1 = Math.min(t1, Math.max(ta, tb));
    }
    if (t0 > 1e-4 && t0 <= t1 && t0 < best) {
      best = t0;
      rad = faceAlbedo(b, nk, ns) * irradiance({ x: na.x * ns, y: na.y * ns, z: na.z * ns });
    }
  }
  return rad;
}

// 점 p에서 눈으로 가는 단위 벡터(원근 카메라는 눈 위치, 사선 카메라는 시선 방향)
export function toEye(cam: Cam, p: Vec3): Vec3 {
  'worklet';
  const e = cam.eye;
  const d = e ? { x: e.x - p.x, y: e.y - p.y, z: e.z - e.dist - p.z } : { x: cam.kx, y: cam.ky, z: -1 };
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return { x: d.x / l, y: d.y / l, z: d.z / l };
}

// 하늘 가림(둘레 + 책 상자): 받는 점 p·법선 n에서 가리개가 빼는 빛
export function skyLossAt(p: Vec3, n: Vec3, env: Env | null, boxes: Box[]) {
  'worklet';
  let loss = envLoss(p, n, env);
  for (const b of boxes) loss += boxLoss(p, n, b, env);
  return loss;
}

// 한 점의 빛: 받는 빛 r(= E·(1 − 반사 몫) / E_REF, 재질 색에 곱할 비)과 반사광 spec(선형, 재질 색에 더할 값)
// p: 점, n: 법선, v: 점 → 눈 방향(없으면 반사광 0), env: 둘레(없으면 열린 방), boxes: 가리개 상자, key: 위 판이 창빛을 가리는 몫을 넣을지.
// 반사광은 거울 방향의 둘레·하늘과 GGX 창빛(이웃 책의 반사는 뺀다, 셰이더와 같다)
// 하늘 가림 loss를 알 때(미리 계산해 둔 값)의 빛: 직접 몫·반사광만 계산한다
export function lightWithLoss(p: Vec3, n: Vec3, v: Vec3 | null, env: Env | null, loss: number, key = true) {
  'worklet';
  const kb = key ? plankKeyBlocked(p, env) : 0;
  const nl = Math.max(0, n.x * L_UNIT.x + n.y * L_UNIT.y + n.z * L_UNIT.z);
  const E = light.ambient + light.skyUp * n.y + light.diffuse * nl * (1 - kb) - loss;
  if (!v) return { r: Math.max(0, E) / E_REF, spec: 0 };
  const nv = Math.max(0, n.x * v.x + n.y * v.y + n.z * v.z);
  const ks = envBRDF(nv);
  const vn = 2 * (n.x * v.x + n.y * v.y + n.z * v.z);
  const rr = { x: vn * n.x - v.x, y: vn * n.y - v.y, z: vn * n.z - v.z };
  const spec = (ks * envHit(p, rr, env).rad + ggxKey(n, v) * light.diffuse * (1 - kb)) / E_REF;
  return { r: (Math.max(0, E) * (1 - ks)) / E_REF, spec };
}

export function sceneLight(p: Vec3, n: Vec3, v: Vec3 | null, env: Env | null, boxes: Box[], key = true) {
  'worklet';
  return lightWithLoss(p, n, v, env, skyLossAt(p, n, env, boxes), key);
}

// 받는 면의 상대 어둠(0이면 그대로): 가림 없을 때보다 빛이 빠진 비율
export function darkening(p: Vec3, n: Vec3, env: Env | null, boxes: Box[], key = true) {
  'worklet';
  const e = irradiance(n);
  if (e <= 1e-6) return 0;
  return 1 - (sceneLight(p, n, null, env, boxes, key).r * E_REF) / e;
}

// ---------- 화면 합성(감마 공간) ----------
// 곱하기: 선형 밝기 비 r ≤ 1을 화면 색에 곱한 것과 같게. 컬러 닷지 s: 화면 색 / (1 − s)
export function gammaMul(r: number) {
  'worklet';
  return Math.pow(Math.max(0, Math.min(1, r)), 1 / GAMMA);
}
// 재질 반사율 albedo인 면에서 (곱하기 뒤) 선형 albedo·r + spec이 되도록 하는 닷지 값(r > 1의 밝아짐과 반사광)
export function gammaDodge(r: number, spec = 0, albedo = 1) {
  'worklet';
  const base = albedo * Math.min(1, Math.max(0, r));
  const target = albedo * Math.max(0, r) + spec;
  if (target <= base || target <= 0) return 0;
  return 1 - Math.pow(base / target, 1 / GAMMA);
}
// 진하기 d(선형, 빛이 d만큼 빠짐)를 검정 덮기 불투명도로: 화면 색 × (1 − d)^(1/γ)
export function shadowAlpha(d: number) {
  'worklet';
  return 1 - Math.pow(Math.max(0, Math.min(1, 1 - d)), 1 / GAMMA);
}
export function grayOf(v: number) {
  'worklet';
  const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${c}, ${c}, ${c})`;
}
