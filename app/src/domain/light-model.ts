// 빛 모델(순수, UI 스레드 워클릿에서도 쓴다). 화면의 모든 밝기·그림자·어둠·반사광을 장면 입력(ui/lighting)과 3D 형태에서 계산하는 원칙 하나.
// 같은 식을 화소마다 계산하는 셰이더는 ui/SceneLight(이 파일과 식·이름을 맞춘다).
//
// 1) 면이 받는 빛 E(n) = 하늘 ambient + skyUp·n.y + 창빛 diffuse·max(0, n·L)(램버트). 하늘·창빛은 흰빛이고, 밝기는 선형 RGB 채널마다
//    계산한다: 되비친 빛은 그 면의 반사율(색)을 띠어 가까운 면을 물들인다(색 번짐).
//    재질 색(시안 색)은 그 재질이 대표 자리에서 보이는 색이다(역렌더링, 맨 아래 calibrate): 화면 밝기 = 재질 색 × E / EREF[재질].
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
import { camAt, VIEW_PITCH_MIN, type Cam, type Vec3 } from './camera';
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
// 하늘 밝기(방향 ω, π·휘도 단위: 코사인 적분이 irradiance의 하늘 몫과 같다). 가장 밝은 곳은 바로 위
export function skyRadiance(w: Vec3) {
  'worklet';
  return light.ambient + 1.5 * light.skyUp * w.y;
}
export const SKY_MAX = light.ambient + 1.5 * light.skyUp;

// 색(#RRGGBB) → 선형 RGB(반사율)
export function linearOf(hex: string): [number, number, number] {
  'worklet';
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  const lin = (v: number) => Math.pow(v / 255, GAMMA);
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}
// 선형 RGB(빛·반사율·밝기). 휘도(가중 합)는 한 값이 필요한 곳(그림자 진하기 등)에서 쓴다
export type C3 = [number, number, number];
export function lum(c: C3) {
  'worklet';
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function grey(v: number): C3 {
  'worklet';
  return [v, v, v];
}
function cscale(c: C3, k: number): C3 {
  'worklet';
  return [c[0] * k, c[1] * k, c[2] * k];
}
function cmix(a: C3, b: C3, t: number): C3 {
  'worklet';
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// 재질 색(시안에서 보이는 색, 선형 RGB: 그림이 칠하는 색)과 실제 반사율(ALBEDO, 맨 아래 calibrate가 정한다).
// 둘레 면의 밝기(RAD: 반사율 × 받는 빛) = 판 윗면(위를 향함), 벽(앞을 향함), 윗선반 아랫면(아래를 향함)
export const DESIGN = { plank: linearOf(surfaces.plank), wall: linearOf(surfaces.wall), paper: linearOf(surfaces.paper) };
export const ALBEDO = { plank: DESIGN.plank, wall: DESIGN.wall, paper: DESIGN.paper };
export const RAD = { floor: grey(0), wall: grey(0), under: grey(0) };
// 재질마다 대표 자리에서 받는 빛(선형 RGB, calibrate): 화면 밝기 비 = 받는 빛 / EREF[재질]. 카메라(노출·화이트 밸런스)는 벽(EREF.wall)
export const EREF = { wall: grey(1), plank: grey(1), book: grey(1), paper: grey(1) };
function setRadiance() {
  RAD.floor = cscale(ALBEDO.plank, irradiance({ x: 0, y: 1, z: 0 }));
  RAD.wall = cscale(ALBEDO.wall, irradiance({ x: 0, y: 0, z: -1 }));
  RAD.under = cscale(ALBEDO.plank, irradiance({ x: 0, y: -1, z: 0 }));
}
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
// 판은 z ∈ [−SHELF_FRONT, SHELF_DEPTH], 두께 SHELF_THICK(아래 판은 floor 아래로, 위 판은 ceil 위로), 벽은 z = SHELF_DEPTH(판 사이).
// 가림 계산에서 판은 벽처럼 가로로 끝없이 이어진다(화면 밖까지): 줄 끝도 줄 가운데와 같은 빛을 받는다(판 끝 너머 벽 띠가 열린 방을 보고
// 하얗게 번지지 않는다). 그래서 한 줄 안의 점은 그 줄만 본다(이웃 줄은 판이 다 가린다).
export type Env = { floor: number; ceil: number };

const inDepth = (z: number) => {
  'worklet';
  return z >= -SHELF_FRONT && z <= SHELF_DEPTH;
};

// 점 p에서 방향 w로 처음 보이는 둘레 면(판 윗면, 위 판 아랫면, 그 사이 벽)의 밝기(없으면 하늘)와 거리
export function envHit(p: Vec3, w: Vec3, env: Env | null): { t: number; rad: C3 } {
  'worklet';
  let best = Infinity;
  let rad = grey(skyRadiance(w));
  if (!env) return { t: best, rad };
  if (w.y < -1e-6 && env.floor > -FAR) {
    const t = (env.floor - p.y) / w.y;
    if (t > 0 && inDepth(p.z + w.z * t)) {
      best = t;
      rad = RAD.floor;
    }
  }
  if (w.y > 1e-6 && env.ceil < FAR) {
    const t = (env.ceil - p.y) / w.y;
    if (t > 0 && t < best && inDepth(p.z + w.z * t)) {
      best = t;
      rad = RAD.under;
    }
  }
  if (w.z > 1e-6) {
    const t = (SHELF_DEPTH - p.z) / w.z;
    const y = p.y + w.y * t;
    if (t > 0 && t < best && y >= env.floor && y <= env.ceil) {
      best = t;
      rad = RAD.wall;
    }
  }
  return { t: best, rad };
}

// 둘레 면들(볼록 사각형, 밝기, 바깥 법선): 벽(판 사이), 판 윗면, 위 판 아랫면
type EnvQuad = { poly: Vec3[]; rad: C3; n: Vec3 };
export function envQuads(env: Env): EnvQuad[] {
  'worklet';
  const plank = (y: number) => [
    { x: -FAR, y, z: -SHELF_FRONT },
    { x: FAR, y, z: -SHELF_FRONT },
    { x: FAR, y, z: SHELF_DEPTH },
    { x: -FAR, y, z: SHELF_DEPTH },
  ];
  const y0 = Math.max(env.floor, -FAR);
  const y1 = Math.min(env.ceil, FAR);
  const out: EnvQuad[] = [{ poly: [{ x: -FAR, y: y0, z: SHELF_DEPTH }, { x: FAR, y: y0, z: SHELF_DEPTH }, { x: FAR, y: y1, z: SHELF_DEPTH }, { x: -FAR, y: y1, z: SHELF_DEPTH }], rad: RAD.wall, n: { x: 0, y: 0, z: -1 } }];
  if (env.floor > -FAR) out.push({ poly: plank(env.floor), rad: RAD.floor, n: { x: 0, y: 1, z: 0 } });
  if (env.ceil < FAR) out.push({ poly: plank(env.ceil), rad: RAD.under, n: { x: 0, y: -1, z: 0 } });
  return out;
}

// ---------- 책 상자(가리개) ----------
// 가운데 c, 축 단위 벡터(두께·세로·깊이), 반 길이, 면 반사율, 덮개(covers).
// 면 반사율: 표지 두 장·책등 = 장정 색(tone), 머리·꼬리·책배 = 장정 색과 속지 색을 그 면에서 속지가 차지하는 넓이 비(head·fore)로 섞은 것.
// 덮개: 이 상자의 한 면(축 k, 방향 s)을 평행하게 마주 보는 이웃 면(간격 g). 나란히 선 책·쌓인 책은 서로 옆면을 가린다:
// 그 이웃 면 너머의 점에서 보면 이 면 중 이웃 면이 가리는 부분(이웃 면 사각형을 보는 점에서 이 면 평면으로 넓혀 투영한 곳)은 안 보인다.
// u·v: 이 면 평면의 두 축((k+1)%3, (k+2)%3) 좌표(상자 가운데 기준)로 이웃 면 사각형의 범위.
export type Cover = { k: number; s: number; g: number; u0: number; u1: number; v0: number; v1: number };
export type Box = { c: Vec3; ax: Vec3; ay: Vec3; az: Vec3; hx: number; hy: number; hz: number; tone: C3; head: number; fore: number; covers: Cover[] };

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

// 축 k 방향 s 면의 반사율(RGB)
export function faceAlbedo(b: Box, k: number, s: number): C3 {
  'worklet';
  return k === 0 ? b.tone : k === 1 ? cmix(b.tone, ALBEDO.paper, b.head) : s < 0 ? b.tone : cmix(b.tone, ALBEDO.paper, b.fore);
}

// tone: 장정 재질 반사율(RGB). 속지 면은 판 끝 테두리(두께 bd, 책등 띠 sp)를 뺀 넓이만큼 종이
export function boxOf(b: Book3, tone: C3): Box {
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
    head,
    fore: pages,
    covers: [],
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

// 셰이더 유니폼 묶음(상자마다 float4 여덟: (c, 장정 R), (축 x, 반 길이), (축 y, …), (축 z, …),
// 덮개 둘(면 번호 k + 3·(s > 0), 간격 g)·(u0, u1, v0, v1) → (k0, g0, k1, g1), (u0, u1, v0, v1)₀, (…)₁, (장정 G, 장정 B, 머리 속지 비, 책배 속지 비)).
// ids: 상자 순서의 책 id
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
    v[o] = b.c.x; v[o + 1] = b.c.y; v[o + 2] = b.c.z; v[o + 3] = b.tone[0];
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
    v[o + 28] = b.tone[1];
    v[o + 29] = b.tone[2];
    v[o + 30] = b.head;
    v[o + 31] = b.fore;
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
// 판 윗면(앞 모서리 ~ 벽 모서리), 벽(아래 모서리 ~ 위 모서리), 위 판 아랫면(벽 모서리 ~ 앞 모서리), 나머지는 하늘.
// 구역마다 반공간 두 개의 교집합이라 가리개 다각형을 차례로 잘라 정확히 적분한다(둘레 사각형 envQuads와 같은 범위).
// 반공간은 x·w ≥ 0. 판 앞·뒤 모서리(x축에 평행, 높이 ey, 깊이 ez)를 지나는 평면: 그 모서리보다 아래쪽(x축을 도는 각이 작은 쪽)
function edgePlane(p: Vec3, ey: number, ez: number): Vec3 {
  'worklet';
  return { x: 0, y: -(ez - p.z), z: ey - p.y };
}
type Sector = { planes: Vec3[]; rad: C3 };
function sectorsOf(p: Vec3, env: Env): Sector[] {
  'worklet';
  const floor = env.floor > -FAR;
  const ceil = env.ceil < FAR;
  // 판이 없으면 벽 구역은 바로 아래·바로 위까지
  const FW = floor ? edgePlane(p, env.floor, SHELF_DEPTH) : { x: 0, y: 0, z: -1 };
  const CW = ceil ? edgePlane(p, env.ceil, SHELF_DEPTH) : { x: 0, y: 0, z: 1 };
  const neg = (w: Vec3) => ({ x: -w.x, y: -w.y, z: -w.z });
  const out: Sector[] = [];
  if (floor) out.push({ planes: [FW, neg(edgePlane(p, env.floor, -SHELF_FRONT))], rad: RAD.floor });
  out.push({ planes: [CW, neg(FW)], rad: RAD.wall });
  if (ceil) out.push({ planes: [edgePlane(p, env.ceil, -SHELF_FRONT), neg(CW)], rad: RAD.under });
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
// 가리개 다각형 P(p 기준, 반구로 자른 것)가 가린 방향들에서 그 뒤에 보였을 밝기의 적분
function behindOf(p: Vec3, n: Vec3, P: Vec3[], total: VF, env: Env | null): C3 {
  'worklet';
  if (!env) return grey(skyOf(total.F, total.M));
  let rest = total;
  const sum: C3 = [0, 0, 0];
  for (const s of sectorsOf(p, env)) {
    const q = sectorVF(P, n, s, total);
    if (q.F === 0) continue;
    for (let c = 0; c < 3; c++) sum[c] += s.rad[c] * q.F;
    rest = subVF(rest, q);
  }
  const sky = skyOf(rest.F, rest.M);
  return [sum[0] + sky, sum[1] + sky, sum[2] + sky];
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

// 상자 하나가 점 p(법선 n)에서 가리는 빛: p를 향한 면(많아야 셋)의 보이는 부분마다 (그 뒤에 보였을 밝기 − 면 밝기)
export function boxLoss(p: Vec3, n: Vec3, b: Box, env: Env | null): C3 {
  'worklet';
  const dc = { x: b.c.x - p.x, y: b.c.y - p.y, z: b.c.z - p.z };
  // 받는 면 평면 뒤에 통째로 있는 상자는 보이지 않는다(상자 꼭짓점 중 가장 앞선 것)
  if (dot3(dc, n) + b.hx * Math.abs(dot3(b.ax, n)) + b.hy * Math.abs(dot3(b.ay, n)) + b.hz * Math.abs(dot3(b.az, n)) <= 0) return [0, 0, 0];
  const loss: C3 = [0, 0, 0];
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
    const rad = cscale(faceAlbedo(b, k, s), irradiance({ x: a.x * s, y: a.y * s, z: a.z * s }));
    for (const r of rects) {
      const P = visiblePart(p, n, rectOn(b, k, s, r));
      const tot = moments(P, n);
      if (tot.F <= 0) continue;
      const behind = behindOf(p, n, P, tot, env);
      for (let c = 0; c < 3; c++) loss[c] += behind[c] - tot.F * rad[c];
    }
  }
  return loss;
}

// 둘레가 점 p(법선 n)에서 가리는 빛
export function envLoss(p: Vec3, n: Vec3, env: Env | null): C3 {
  'worklet';
  const loss: C3 = [0, 0, 0];
  if (!env) return loss;
  for (const q of envQuads(env)) {
    // 면의 앞쪽(빛을 받는 쪽)에서만 보인다: 판 윗면은 그 위에서, 위 판 아랫면은 그 아래에서
    if ((p.x - q.poly[0].x) * q.n.x + (p.y - q.poly[0].y) * q.n.y + (p.z - q.poly[0].z) * q.n.z <= 0) continue;
    const vf = moments(visiblePart(p, n, q.poly), n);
    if (vf.F <= 0) continue;
    const sky = skyOf(vf.F, vf.M);
    for (let c = 0; c < 3; c++) loss[c] += sky - vf.F * q.rad[c];
  }
  return loss;
}

// 위 판이 창빛 원반을 가리는 몫: 원반을 판 앞 모서리(가로로 끝없는 직선)로 자른 넓이 비율(활꼴).
// 받는 점에서 판 앞 모서리까지 위로 d, 앞으로 zf일 때 앙각 atan(d / zf)보다 높은 쪽이 막힌다.
export const L_ELEV = Math.atan2(L_UNIT.y, -L_UNIT.z);
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
// 둘레의 판이 점 p에서 창빛 원반을 가리는 몫(창빛은 위에서 오므로 위 판만 가린다)
export function plankKeyBlocked(p: Vec3, env: Env | null) {
  'worklet';
  if (!env || env.ceil >= FAR) return 0;
  return keyBlocked(env.ceil - p.y, p.z + SHELF_FRONT);
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
export function traceRadiance(p: Vec3, w: Vec3, env: Env | null, boxes: Box[]): C3 {
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
      rad = cscale(faceAlbedo(b, nk, ns), irradiance({ x: na.x * ns, y: na.y * ns, z: na.z * ns }));
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
export function skyLossAt(p: Vec3, n: Vec3, env: Env | null, boxes: Box[]): C3 {
  'worklet';
  const loss = envLoss(p, n, env);
  for (const b of boxes) {
    const l = boxLoss(p, n, b, env);
    for (let c = 0; c < 3; c++) loss[c] += l[c];
  }
  return loss;
}

// 한 점의 빛(RGB): 받는 빛 r(= E·(1 − 반사 몫) / eref, 재질 색에 곱할 비. eref: 그 재질의 대표 자리 빛 EREF)과
// 반사광 spec(선형, 화면 색에 더할 값: 카메라 기준 EREF.wall로 나눈다)
// p: 점, n: 법선, v: 점 → 눈 방향(없으면 반사광 0), env: 둘레(없으면 열린 방), boxes: 가리개 상자, key: 위 판이 창빛을 가리는 몫을 넣을지.
// 반사광은 거울 방향의 둘레·하늘과 GGX 창빛(이웃 책의 반사는 뺀다, 셰이더와 같다)
// 하늘 가림 loss를 알 때(미리 계산해 둔 값)의 빛: 직접 몫·반사광만 계산한다
// (기본값 식은 워클릿 클로저에 잡히지 않으므로 기본 재질은 본문에서 정한다)
export function lightWithLoss(p: Vec3, n: Vec3, v: Vec3 | null, env: Env | null, loss: C3, key = true, eref?: C3): { r: C3; spec: C3 } {
  'worklet';
  const ref = eref ?? EREF.book;
  const kb = key ? plankKeyBlocked(p, env) : 0;
  const nl = Math.max(0, n.x * L_UNIT.x + n.y * L_UNIT.y + n.z * L_UNIT.z);
  const E0 = light.ambient + light.skyUp * n.y + light.diffuse * nl * (1 - kb);
  const E: C3 = [Math.max(0, E0 - loss[0]), Math.max(0, E0 - loss[1]), Math.max(0, E0 - loss[2])];
  if (!v) return { r: [E[0] / ref[0], E[1] / ref[1], E[2] / ref[2]], spec: [0, 0, 0] };
  const nv = Math.max(0, n.x * v.x + n.y * v.y + n.z * v.z);
  const ks = envBRDF(nv);
  const vn = 2 * (n.x * v.x + n.y * v.y + n.z * v.z);
  const rr = { x: vn * n.x - v.x, y: vn * n.y - v.y, z: vn * n.z - v.z };
  const env3 = envHit(p, rr, env).rad;
  const key3 = ggxKey(n, v) * light.diffuse * (1 - kb);
  const cam = EREF.wall;
  return {
    r: [(E[0] * (1 - ks)) / ref[0], (E[1] * (1 - ks)) / ref[1], (E[2] * (1 - ks)) / ref[2]],
    spec: [(ks * env3[0] + key3) / cam[0], (ks * env3[1] + key3) / cam[1], (ks * env3[2] + key3) / cam[2]],
  };
}

export function sceneLight(p: Vec3, n: Vec3, v: Vec3 | null, env: Env | null, boxes: Box[], key = true, eref?: C3) {
  'worklet';
  return lightWithLoss(p, n, v, env, skyLossAt(p, n, env, boxes), key, eref);
}

// ---------- 그린 판 끝 너머, 판 두께 높이의 벽 ----------
// 가림 계산에서 판은 가로로 끝없이 이어지므로 판 두께 높이의 벽은 판 속이다. 그린 판 끝 너머로는 그 벽이 보이므로 띠의 위·아래 경계
// (판 윗면·아랫면 높이의 벽)가 받는 빛을 높이로 잇는다. 띠는 위·아래 두 줄 캔버스에 걸치므로 줄마다 제 쪽 절반을 맡는다:
// 제 쪽 경계(이 줄 계산 그대로) → 띠 가운데(mid) → 건너편 경계(far). mid는 두 경계를 책 없이 계산한 빛의 평균이라 두 줄이 같은 값을 쓴다
// (책 없이 둘레만이면 x로 같아 한 값). 줄 캔버스는 줄마다 제 줄 기준 카메라로 그려 같은 띠가 두 캔버스에서 조금 어긋나므로,
// 건너편 줄이 덮는 절반은 mid를 그대로 둔다(far = mid). 맨 아랫줄 판 밑은 같은 캔버스의 책 없는 판 밑 벽이라 far로 잇는다.
// 이 줄 쪽 경계 점은 판 면에서 줄 안으로 BAND_IN 들인 곳(판 면 위의 점에서는 그 판이 보이지 않는다: 면의 앞쪽에서만 보인다)
export const BAND_IN = 1e-2;
export type Band = { mid: C3; far: C3 };
// 가림이 없을 때 받는 빛(위 판이 창빛 원반을 가린 몫까지)
function openE(p: Vec3, n: Vec3, env: Env | null) {
  'worklet';
  return light.ambient + light.skyUp * n.y + light.diffuse * Math.max(0, dot3(n, L_UNIT)) * (1 - plankKeyBlocked(p, env));
}
// 줄 둘레만으로(책 없이) 계산한 판 경계 벽의 받는 빛: 판 윗면 높이(atFloor) 또는 위 판 아랫면 높이
function edgeLight(env: Env, atFloor: boolean): C3 {
  const n = { x: 0, y: 0, z: -1 };
  const p = { x: (SHELF_X0 + SHELF_X1) / 2, y: atFloor ? env.floor + BAND_IN : env.ceil - BAND_IN, z: SHELF_DEPTH };
  const e = openE(p, n, env);
  const loss = envLoss(p, n, env);
  return [e - loss[0], e - loss[1], e - loss[2]];
}
// 이 줄(env)의 아래 판 띠(up = false, other: 아래 줄 둘레) 또는 위 판 띠(up = true, other: 위 줄 둘레)
export function bandOf(env: Env, other: Env, up: boolean): Band {
  const own = edgeLight(env, !up);
  const far = edgeLight(other, up);
  return { mid: [0, 1, 2].map((c) => (own[c] + far[c]) / 2) as C3, far };
}
// 굽는 값(하늘 가림): 받는 점 p(법선 n)의 가림. 판 두께 높이의 벽 점은 띠를 이은 빛이 되게 하는 가림(같은 자리의 openE − 이은 빛).
// band: 아래 판 띠·위 판 띠(없으면 null)
export function bakeLoss(p: Vec3, n: Vec3, env: Env | null, boxes: Box[], band: [Band | null, Band | null] = [null, null]): C3 {
  'worklet';
  if (env && n.z < -0.5 && p.z >= SHELF_DEPTH - 1e-6) {
    const lo = band[0] && env.floor > -FAR && p.y < env.floor && p.y > env.floor - SHELF_THICK;
    const hi = band[1] && env.ceil < FAR && p.y > env.ceil && p.y < env.ceil + SHELF_THICK;
    if (lo || hi) {
      const q = { x: p.x, y: lo ? env.floor + BAND_IN : env.ceil - BAND_IN, z: p.z };
      const t = Math.min(1, Math.abs(p.y - q.y) / SHELF_THICK);
      const eq = openE(q, n, env);
      const lq = skyLossAt(q, n, env, boxes);
      const b = (lo ? band[0] : band[1])!;
      const e = openE(p, n, env);
      return [0, 1, 2].map((c) => e - (t <= 0.5 ? (eq - lq[c]) * (1 - 2 * t) + b.mid[c] * 2 * t : b.mid[c] * (2 - 2 * t) + b.far[c] * (2 * t - 1))) as C3;
    }
  }
  return skyLossAt(p, n, env, boxes);
}

// 받는 면의 상대 어둠(0이면 그대로, 휘도): 가림 없을 때보다 빛이 빠진 비율
export function darkening(p: Vec3, n: Vec3, env: Env | null, boxes: Box[], key = true) {
  'worklet';
  const e = irradiance(n);
  if (e <= 1e-6) return 0;
  return 1 - lum(sceneLight(p, n, null, env, boxes, key, grey(1)).r) / e;
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

// ---------- 재질 반사율 맞추기(역렌더링) ----------
// 재질 색(시안의 색)은 그 재질이 대표 자리에서 보이는 색이다: 벽 = 빈 줄 가운데 높이의 벽, 판 = 판 앞면 가운데,
// 책(장정·속지) = 홀로 선 책의 책등 가운데(기준 줄: 판 사이 200DU, 예시 책장 가운데 줄. 속지도 시안에서 책 앞쪽 빛으로 그려진 색이다:
// 머리는 위 판 바로 아래라 그 빛으로는 반사율이 1을 넘는다). 카메라(노출·화이트 밸런스)는 벽 대표 자리에 맞춘다. 실제 반사율 = 재질 색 × (벽 대표 자리 빛 / 그 재질 대표 자리 빛)이고, 되비침이 이 반사율로 다시 빛을 바꾸므로
// 몇 번 되풀이해 맞춘다. 그러면 모든 재질이 대표 자리에서 시안 색 그대로, 다른 자리(가림·색 번짐·그림자)는 물리대로 보인다.
const REF_SPACE = 200;
const REF_BOOK_H = 150;
const REF_X = (SHELF_X0 + SHELF_X1) / 2;
const REF_ENV: Env = { floor: 0, ceil: REF_SPACE };
const REF_EYE = (() => {
  const e = camAt(VIEW_PITCH_MIN).eye!;
  return { x: e.x, y: e.y, z: e.z - e.dist };
})();
function anchorLight(p: Vec3, n: Vec3): C3 {
  const kb = plankKeyBlocked(p, REF_ENV);
  const E0 = light.ambient + light.skyUp * n.y + light.diffuse * Math.max(0, n.x * L_UNIT.x + n.y * L_UNIT.y + n.z * L_UNIT.z) * (1 - kb);
  const loss = envLoss(p, n, REF_ENV);
  const d = { x: REF_EYE.x - p.x, y: REF_EYE.y - p.y, z: REF_EYE.z - p.z };
  const l = Math.hypot(d.x, d.y, d.z);
  const ks = envBRDF(Math.max(0, (n.x * d.x + n.y * d.y + n.z * d.z) / l));
  return [(E0 - loss[0]) * (1 - ks), (E0 - loss[1]) * (1 - ks), (E0 - loss[2]) * (1 - ks)];
}
function calibrate() {
  const front = { x: 0, y: 0, z: -1 };
  for (let i = 0; i < 8; i++) {
    setRadiance();
    EREF.wall = anchorLight({ x: REF_X, y: REF_SPACE / 2, z: SHELF_DEPTH }, front);
    EREF.plank = anchorLight({ x: REF_X, y: -SHELF_THICK / 2, z: -SHELF_FRONT }, front);
    EREF.book = anchorLight({ x: REF_X, y: REF_BOOK_H / 2, z: 0 }, front);
    EREF.paper = EREF.book;
    const gain = (m: C3, ref: C3): C3 => [m[0] * (EREF.wall[0] / ref[0]), m[1] * (EREF.wall[1] / ref[1]), m[2] * (EREF.wall[2] / ref[2])];
    ALBEDO.wall = DESIGN.wall;
    ALBEDO.plank = gain(DESIGN.plank, EREF.plank);
    ALBEDO.paper = gain(DESIGN.paper, EREF.paper);
  }
  setRadiance();
  // 반사율은 1을 넘을 수 없다(받은 빛보다 많이 되비추는 면은 없다)
  for (const c of [ALBEDO.wall, ALBEDO.plank, ALBEDO.paper]) if (Math.max(...c) > 1) throw new Error(`light-model: albedo > 1 (${c.join(', ')})`);
}
calibrate();

// 책 장정 색(시안 색) → 실제 반사율(되비침에 쓴다)
export function bookAlbedo(hex: string): C3 {
  'worklet';
  const c = linearOf(hex);
  return [(c[0] * EREF.wall[0]) / EREF.book[0], (c[1] * EREF.wall[1]) / EREF.book[1], (c[2] * EREF.wall[2]) / EREF.book[2]];
}
