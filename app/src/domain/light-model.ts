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
//    면 밝기 = 반사율 × 그 면이 받는 빛. 받는 빛은 면마다 격자점에서 같은 계산으로 풀고 되풀이해(빛 격자, 여러 번 튕긴 빛) 보간한다:
//    책 사이 틈 안쪽·책이 선 판 둘레처럼 가리개 면도 가려진 곳은 그만큼 어둡다(접촉부로 갈수록 어두워짐). 밝은 판이 하늘보다 밝으면 오히려 밝아진다.
//    면 위에서 바뀌는 밝기는 그 면이 보이는 방향들의 코사인 가중 평균 방향이 닿는 점(대표 점)에서 읽는다. 다중 반사 경로 추적과 비교해 검증한다.
// 4) 반사광: 유전체의 프레넬 반사를 거칠기까지 넣어(환경 반사 근사 EnvBRDF, GGX 창빛 하이라이트). 확산 몫은 반사된 만큼 줄어든다.
// 워클릿은 만들어질 때 쓰는 함수를 붙잡으므로, 쓰이는 함수를 먼저 정의한다.
import palette from '@/ui/art/reference-bindings.generated.json';
import { camera, F0, light, materials, surfaces, type SurfaceMaterial } from '@/ui/lighting';

import { corners, type Book3 } from './book3';
import { rigOf } from './book-parts';
import { camAt, VIEW_PITCH_MIN, type Cam, type Vec3 } from './camera';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from './geometry';
import type { BindingMaterial } from './types';
import { CALIBRATION, CALIBRATION_INPUTS } from './light-calibration.generated';
import { grainPeak, MAT_UNIFORMS } from './surface-pattern';

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
// 재질마다 대표 자리의 반사광(장면 밝기, calibrate): 재질 색은 이것까지 넣은 '보이는 색'이다. 책은 장정 재질마다
export const SREF = { wall: grey(0), plank: grey(0), paper: grey(0), book: { paper: grey(0), cloth: grey(0), coated: grey(0) } as Record<BindingMaterial, C3> };
function setRadiance() {
  RAD.floor = cscale(ALBEDO.plank, irradiance({ x: 0, y: 1, z: 0 }));
  RAD.wall = cscale(ALBEDO.wall, irradiance({ x: 0, y: 0, z: -1 }));
  RAD.under = cscale(ALBEDO.plank, irradiance({ x: 0, y: -1, z: 0 }));
}
// 벽은 판보다 훨씬 넓고 높다(하늘 가림 계산에서 끝이 보이지 않을 만큼)
export const FAR = 1e4;
// 면 위의 점을 이웃 면 평면에서 띄우는 거리(DU, 약 0.06mm): 점이 그 평면 위에 있으면 그 면이 보이지 않는다(면의 앞쪽에서만 보인다).
// 끝없는 둘레 면(FAR)을 거의 수평으로 보는 각을 셰이더의 단정밀도로 계산할 수 있는 크기
export const TOUCH = 0.05;

// ---------- 카메라 톤 곡선(필름형) ----------
// 화면(표시 선형) 밝기 y = tone(x), x = 카메라 기준 장면 선형 밝기(노출을 곱한 값). 필름 특성 곡선처럼 발끝-직선-어깨(GT, Uchimura 2017 꼴),
// 채널마다(필름·ACES처럼 밝은 곳은 흰색 쪽으로 옅어지고, 어두운 곳은 장면 색의 채도가 드러난다):
//   직선(기울기 1): 가운데 밝기는 그대로. 발끝(TONE.toe 아래): 검정 쪽 기울기를 1 − TONE.k로 살짝 눌러 아주 어두운 곳이 조금 더 깊다(이어지는 곳은 기울기 1로 매끈).
//   어깨(TONE.shoulder 위): 1로 지수적으로 다가간다(기울기 1로 이어짐) — 하얗게 딱 잘리지 않는다.
// 모양은 카메라 설정(lighting camera). 역렌더링은 toneInv로 하므로 어느 모양이든 재질은 대표 자리에서 시안 색 그대로다
export const TONE = { toe: camera.toe, k: camera.toeK, shoulder: camera.shoulder };
export function tone(x: number) {
  'worklet';
  const { toe, k, shoulder: s } = TONE;
  if (x <= 0) return 0;
  if (x < toe) {
    const u = 1 - x / toe;
    return x - k * x * u * u;
  }
  if (x <= s) return x;
  return 1 - (1 - s) * Math.exp(-(x - s) / Math.max(1e-6, 1 - s));
}
export function toneInv(y: number) {
  'worklet';
  const { toe, k, shoulder: s } = TONE;
  if (y <= 0) return 0;
  if (y < toe) {
    // 발끝은 3차식이라 뉴턴 몇 번(단조 증가, 기울기 ≥ 1 − k)
    let x = y;
    for (let i = 0; i < 6; i++) {
      const u = 1 - x / toe;
      const f = x - k * x * u * u - y;
      const d = 1 - k * u * u + (2 * k * x * u) / toe;
      x -= f / d;
    }
    return x;
  }
  if (y <= s) return y;
  if (y >= 1) return FAR;
  return s - (1 - s) * Math.log((1 - y) / Math.max(1e-6, 1 - s));
}
// 노출 기준(카메라 이득, calibrate): 장면 밝기 = gain × 반사율 × 받는 빛 / EREF.wall. 반사율의 크기는 이 이득으로 정한다:
// 어느 재질(벽·판·속지)도 대표 자리에서 보이는 색(시안 색)보다 큰 반사율을 갖지 않는 가장 작은 이득(곡선의 어깨가 밝은 쪽을 눌러
// 장면 밝기가 화면 색보다 밝은 것, 줄 안 벽이 판·벽 사이에서 여러 번 튕긴 빛을 더 받는 것을 반사율이 1을 넘지 않게 흡수한다)
export const CAM = { gain: 1 };


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

// 둘레 면 번호: 벽, 판 윗면, 위 판 아랫면(빛 격자의 둘레 칸 순서), 하늘
export const ENV_WALL = 0;
export const ENV_FLOOR = 1;
export const ENV_CEIL = 2;
const SKY = -1;
// 점 p에서 방향 w로 처음 보이는 둘레 면(판 윗면, 위 판 아랫면, 그 사이 벽)의 밝기(없으면 하늘)와 거리, 어느 면인지
export function envHit(p: Vec3, w: Vec3, env: Env | null): { t: number; rad: C3; which: number } {
  'worklet';
  let best = Infinity;
  let rad = grey(skyRadiance(w));
  let which = SKY;
  if (!env) return { t: best, rad, which };
  if (w.y < -1e-6 && env.floor > -FAR) {
    const t = (env.floor - p.y) / w.y;
    if (t > 0 && inDepth(p.z + w.z * t)) {
      best = t;
      rad = RAD.floor;
      which = ENV_FLOOR;
    }
  }
  if (w.y > 1e-6 && env.ceil < FAR) {
    const t = (env.ceil - p.y) / w.y;
    if (t > 0 && t < best && inDepth(p.z + w.z * t)) {
      best = t;
      rad = RAD.under;
      which = ENV_CEIL;
    }
  }
  if (w.z > 1e-6) {
    const t = (SHELF_DEPTH - p.z) / w.z;
    const y = p.y + w.y * t;
    if (t > 0 && t < best && y >= env.floor && y <= env.ceil) {
      best = t;
      rad = RAD.wall;
      which = ENV_WALL;
    }
  }
  return { t: best, rad, which };
}

// 둘레 면들(볼록 사각형, 밝기, 바깥 법선, 면 번호): 벽(판 사이), 판 윗면, 위 판 아랫면
type EnvQuad = { poly: Vec3[]; rad: C3; n: Vec3; which: number };
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
  const out: EnvQuad[] = [{ poly: [{ x: -FAR, y: y0, z: SHELF_DEPTH }, { x: FAR, y: y0, z: SHELF_DEPTH }, { x: FAR, y: y1, z: SHELF_DEPTH }, { x: -FAR, y: y1, z: SHELF_DEPTH }], rad: RAD.wall, n: { x: 0, y: 0, z: -1 }, which: ENV_WALL }];
  if (env.floor > -FAR) out.push({ poly: plank(env.floor), rad: RAD.floor, n: { x: 0, y: 1, z: 0 }, which: ENV_FLOOR });
  if (env.ceil < FAR) out.push({ poly: plank(env.ceil), rad: RAD.under, n: { x: 0, y: -1, z: 0 }, which: ENV_CEIL });
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

// ---------- 빛 격자(되비침) ----------
// 가리개 면(책 면·판 윗면·위 판 아랫면·벽)이 되비치는 빛 = 반사율 × 그 면이 받는 빛. 그 면도 가려지므로(책 사이 틈 안쪽, 판과 벽이 만나는
// 모서리, 책이 선 판 윗면) 받는 빛은 면마다 격자점에서 같은 계산(하늘 가림 + 창빛, 창빛은 그림자 광선으로 가린다)으로 풀고 겹선형으로 보간한다.
// 격자점이 받는 빛도 가리개의 되비침으로 계산하므로 격자를 되풀이해 풀면 여러 번 튕긴 빛이 된다(solveGrid).
// 격자 없이(G 없음) 계산하면 가리개 면은 가림 없는 받는 빛(irradiance)으로 밝다(한 번 튕김, 격자 풀기의 첫 값).
// 격자점: 책 면은 두 방향 모두, 둘레 면은 판·벽이 만나는 방향(깊이·높이)으로 체비쇼프–로바토 점(면 가장자리 = 접촉부 쪽이 촘촘하다).
// 둘레 면의 가로는 판 범위를 고르게(책은 어디에나 놓인다), 그 밖은 끝 점 값. 책이 없으면 둘레는 가로로 같아 가로 점 하나다.
// 열린 쪽(맨 윗줄 위, 맨 아랫줄 판 밑)으로 끝없는 벽은 t ∈ [0, 1]을 판에서 떨어진 높이 L·t/(1 − t)로(L = 판 깊이, 줄 기하의 길이 척도).
// 받는 점에서 가리개 다각형이 보이는 방향들의 코사인 가중 평균 방향(M)이 그 면에 닿는 점에서 격자를 읽는다(면 밝기가 면 위에서 1차일 때의 대표 점).
export const GRID_N = 8;
export const ENV_NX = 6 * GRID_N;
export const ENV_NY = 16;
// 둘레 면을 가로로 나눠 읽는 구간 수(판 범위 안, envLoss)
export const ENV_COLS = 12;
// e: 격자점마다 받는 빛(선형 RGB). 책 상자 i의 면 f(= 축 k + 3·(s > 0)) 칸은 (i·6 + f)·N², 그 뒤에 둘레 면(벽, 판 윗면, 위 판 아랫면) 칸이 nx·ENV_NY씩
export type Grid = { e: C3[]; nBox: number; nx: number; env: Env };
const ENV_L = SHELF_FRONT + SHELF_DEPTH;
function chebT(i: number, n: number) {
  'worklet';
  return n < 2 ? 0 : (1 - Math.cos((Math.PI * i) / (n - 1))) / 2;
}
// t ∈ [0, 1] → 체비쇼프–로바토 칸 좌표(0 ~ n − 1)
function chebIndex(t: number, n: number) {
  'worklet';
  return ((n - 1) * Math.acos(1 - 2 * Math.max(0, Math.min(1, t)))) / Math.PI;
}
// 칸 좌표 (su, sv)의 겹선형 값(블록 시작 off, 가로 nu × 세로 nv, 가로가 빠르다)
function bilerp(e: C3[], off: number, nu: number, nv: number, su: number, sv: number): C3 {
  'worklet';
  const a = Math.max(0, Math.min(nu - 1, su));
  const b = Math.max(0, Math.min(nv - 1, sv));
  const i0 = Math.min(Math.floor(a), Math.max(0, nu - 2));
  const j0 = Math.min(Math.floor(b), Math.max(0, nv - 2));
  const i1 = Math.min(i0 + 1, nu - 1);
  const j1 = Math.min(j0 + 1, nv - 1);
  const fa = a - i0;
  const fb = b - j0;
  const q = (i: number, j: number) => e[off + j * nu + i];
  const out: C3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) out[c] = (q(i0, j0)[c] * (1 - fa) + q(i1, j0)[c] * fa) * (1 - fb) + (q(i0, j1)[c] * (1 - fa) + q(i1, j1)[c] * fa) * fb;
  return out;
}
// 둘레 면의 두 번째 방향 좌표 → t: 판 윗면·아랫면은 깊이(앞 끝 0 ~ 벽 1), 벽은 높이(판 윗면 0 ~ 위 판 아랫면 1, 열린 쪽은 끝없는 곳이 1)
function envT(env: Env, which: number, q: Vec3) {
  'worklet';
  if (which !== ENV_WALL) return (q.z + SHELF_FRONT) / ENV_L;
  if (env.floor > -FAR && env.ceil < FAR) return (q.y - env.floor) / (env.ceil - env.floor);
  const h = env.floor > -FAR ? q.y - env.floor : env.ceil - q.y;
  return h / (ENV_L + Math.max(0, h));
}
function envY(env: Env, t: number) {
  'worklet';
  if (env.floor > -FAR && env.ceil < FAR) return env.floor + (env.ceil - env.floor) * t;
  const h = t >= 1 ? FAR : (ENV_L * t) / (1 - t);
  return env.floor > -FAR ? env.floor + h : env.ceil - h;
}
function envU(G: Grid, x: number) {
  'worklet';
  return G.nx < 2 ? 0 : ((x - SHELF_X0) / (SHELF_X1 - SHELF_X0)) * (G.nx - 1);
}
// 둘레 면 which의 점 q가 받는 빛(격자)
function envGridE(G: Grid, which: number, q: Vec3): C3 {
  'worklet';
  const off = G.nBox * 6 * GRID_N * GRID_N + which * G.nx * ENV_NY;
  return bilerp(G.e, off, G.nx, ENV_NY, envU(G, q.x), chebIndex(envT(G.env, which, q), ENV_NY));
}
function envAlbedo(which: number) {
  'worklet';
  return which === ENV_WALL ? ALBEDO.wall : ALBEDO.plank;
}
// 상자 i(b)의 면(축 k, 방향 s) 위 점 q가 받는 빛(격자)
function boxGridE(G: Grid, i: number, b: Box, k: number, s: number, q: Vec3): C3 {
  'worklet';
  const ku = (k + 1) % 3;
  const kv = (k + 2) % 3;
  const hu = halfOf(b, ku);
  const hv = halfOf(b, kv);
  const d = { x: q.x - b.c.x, y: q.y - b.c.y, z: q.z - b.c.z };
  const tu = (dot3(d, axisOf(b, ku)) + hu) / (2 * hu);
  const tv = (dot3(d, axisOf(b, kv)) + hv) / (2 * hv);
  const off = (i * 6 + k + (s > 0 ? 3 : 0)) * GRID_N * GRID_N;
  return bilerp(G.e, off, GRID_N, GRID_N, chebIndex(tu, GRID_N), chebIndex(tv, GRID_N));
}
// 받는 점 p에서 코사인 가중 평균 방향 M으로 평면(점 O, 법선 nf)에 닿는 점(나란하면 null)
function repPoint(p: Vec3, M: Vec3, O: Vec3, nf: Vec3): Vec3 | null {
  'worklet';
  const den = dot3(M, nf);
  if (Math.abs(den) < 1e-12) return null;
  const t = ((O.x - p.x) * nf.x + (O.y - p.y) * nf.y + (O.z - p.z) * nf.z) / den;
  return { x: p.x + M.x * t, y: p.y + M.y * t, z: p.z + M.z * t };
}
// 둘레 면 which의 밝기: 격자가 있으면 대표 점에서, 없으면 가림 없는 받는 빛으로
const ENV_O = [
  { O: { x: 0, y: 0, z: SHELF_DEPTH }, n: { x: 0, y: 0, z: -1 } },
  { O: { x: 0, y: 0, z: 0 }, n: { x: 0, y: 1, z: 0 } },
  { O: { x: 0, y: 0, z: 0 }, n: { x: 0, y: -1, z: 0 } },
];
function envRad(G: Grid | undefined, which: number, p: Vec3, M: Vec3, fallback: C3): C3 {
  'worklet';
  if (!G) return fallback;
  const pl = ENV_O[which];
  const O = which === ENV_WALL ? pl.O : { x: 0, y: which === ENV_FLOOR ? G.env.floor : G.env.ceil, z: 0 };
  const q = repPoint(p, M, O, pl.n);
  if (!q) return fallback;
  const e = envGridE(G, which, q);
  const a = envAlbedo(which);
  return [a[0] * e[0], a[1] * e[1], a[2] * e[2]];
}

// 받는 점마다 둘레 면(which) 구간(가로: 판 범위 왼쪽 바깥 0, 판 범위 ENV_COLS칸, 오른쪽 바깥)마다 읽은 밝기
export type EnvCols = (C3 | undefined)[][];
function colOf(x: number, cols: number) {
  'worklet';
  if (!cols) return 0;
  if (x < SHELF_X0) return 0;
  if (x >= SHELF_X1) return cols + 1;
  return 1 + Math.min(cols - 1, Math.floor(((x - SHELF_X0) / (SHELF_X1 - SHELF_X0)) * cols));
}
function colRad(cols: EnvCols | undefined, G: Grid | undefined, which: number, p: Vec3, M: Vec3): C3 | undefined {
  'worklet';
  if (!cols || !G) return undefined;
  const pl = ENV_O[which];
  const O = which === ENV_WALL ? pl.O : { x: 0, y: which === ENV_FLOOR ? G.env.floor : G.env.ceil, z: 0 };
  const q = repPoint(p, M, O, pl.n);
  if (!q) return undefined;
  return cols[which]?.[colOf(q.x, G.nx > 1 ? ENV_COLS : 0)];
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
type Sector = { planes: Vec3[]; rad: C3; which: number };
function sectorsOf(p: Vec3, env: Env): Sector[] {
  'worklet';
  const floor = env.floor > -FAR;
  const ceil = env.ceil < FAR;
  // 판이 없으면 벽 구역은 바로 아래·바로 위까지
  const FW = floor ? edgePlane(p, env.floor, SHELF_DEPTH) : { x: 0, y: 0, z: -1 };
  const CW = ceil ? edgePlane(p, env.ceil, SHELF_DEPTH) : { x: 0, y: 0, z: 1 };
  const neg = (w: Vec3) => ({ x: -w.x, y: -w.y, z: -w.z });
  const out: Sector[] = [];
  if (floor) out.push({ planes: [FW, neg(edgePlane(p, env.floor, -SHELF_FRONT))], rad: RAD.floor, which: ENV_FLOOR });
  out.push({ planes: [CW, neg(FW)], rad: RAD.wall, which: ENV_WALL });
  if (ceil) out.push({ planes: [edgePlane(p, env.ceil, -SHELF_FRONT), neg(CW)], rad: RAD.under, which: ENV_CEIL });
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
// 가리개 다각형 P(p 기준, 반구로 자른 것)가 가린 방향들에서 그 뒤에 보였을 밝기의 적분(G: 빛 격자)
// cols: 같은 받는 점에서 둘레 면 구간마다 읽은 밝기(envLossCols). 가려진 부분도 그 구간 밝기로 빼야 둘레 면을 더한 몫과 정확히 상쇄된다
// (깊은 틈처럼 거의 다 가려진 곳에서 서로 다른 대표 점의 차이가 남지 않게)
function behindOf(p: Vec3, n: Vec3, P: Vec3[], total: VF, env: Env | null, G?: Grid, cols?: EnvCols): C3 {
  'worklet';
  if (!env) return grey(skyOf(total.F, total.M));
  let rest = total;
  const sum: C3 = [0, 0, 0];
  for (const s of sectorsOf(p, env)) {
    const q = sectorVF(P, n, s, total);
    if (q.F === 0) continue;
    const rad = colRad(cols, G, s.which, p, q.M) ?? envRad(G, s.which, p, q.M, s.rad);
    for (let c = 0; c < 3; c++) sum[c] += rad[c] * q.F;
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

// 상자 하나가 점 p(법선 n)에서 가리는 빛: p를 향한 면(많아야 셋)의 보이는 부분마다 (그 뒤에 보였을 밝기 − 면 밝기).
// G·bi: 빛 격자와 그 안에서 이 상자의 번호(면 밝기를 격자에서), 없으면 가림 없는 받는 빛
export function boxLoss(p: Vec3, n: Vec3, b: Box, env: Env | null, G?: Grid, bi = -1, cols?: EnvCols): C3 {
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
    const alb = faceAlbedo(b, k, s);
    const nf = { x: a.x * s, y: a.y * s, z: a.z * s };
    const open = cscale(alb, irradiance(nf));
    const fc = { x: b.c.x + nf.x * h, y: b.c.y + nf.y * h, z: b.c.z + nf.z * h };
    for (const r of rects) {
      const P = visiblePart(p, n, rectOn(b, k, s, r));
      const tot = moments(P, n);
      if (tot.F <= 0) continue;
      const behind = behindOf(p, n, P, tot, env, G, cols);
      let rad = open;
      const q = G && bi >= 0 ? repPoint(p, tot.M, fc, nf) : null;
      if (G && q) {
        const e = boxGridE(G, bi, b, k, s, q);
        rad = [alb[0] * e[0], alb[1] * e[1], alb[2] * e[2]];
      }
      for (let c = 0; c < 3; c++) loss[c] += behind[c] - tot.F * rad[c];
    }
  }
  return loss;
}

// 둘레가 점 p(법선 n)에서 가리는 빛(G: 빛 격자). 격자가 있으면 둘레 면(가로로 끝없다)을 판 범위의 ENV_COLS 구간과 그 양 바깥으로 나눠
// 구간마다 대표 점에서 읽는다(책 뒤 어두운 벽 값이 넓은 밝은 벽 전체에 쓰이지 않게). 책이 없으면(가로로 같다) 나누지 않는다
// 가림과 구간마다 읽은 밝기(가리개 뒤 계산이 같은 값을 쓴다)
export function envLossCols(p: Vec3, n: Vec3, env: Env | null, G?: Grid): { loss: C3; cols: EnvCols } {
  'worklet';
  const loss: C3 = [0, 0, 0];
  const out: EnvCols = [[], [], []];
  if (!env) return { loss, cols: out };
  const cols = G && G.nx > 1 ? ENV_COLS : 0;
  for (const q of envQuads(env)) {
    // 면의 앞쪽(빛을 받는 쪽)에서만 보인다: 판 윗면은 그 위에서, 위 판 아랫면은 그 아래에서
    if ((p.x - q.poly[0].x) * q.n.x + (p.y - q.poly[0].y) * q.n.y + (p.z - q.poly[0].z) * q.n.z <= 0) continue;
    for (let k = 0; k <= (cols ? cols + 1 : 0); k++) {
      let poly = q.poly;
      if (cols) {
        const xa = k === 0 ? -FAR : SHELF_X0 + ((SHELF_X1 - SHELF_X0) * (k - 1)) / cols;
        const xb = k === cols + 1 ? FAR : SHELF_X0 + ((SHELF_X1 - SHELF_X0) * k) / cols;
        poly = q.poly.map((v) => ({ x: v.x < 0 ? xa : xb, y: v.y, z: v.z }));
      }
      const vf = moments(visiblePart(p, n, poly), n);
      if (vf.F <= 0) continue;
      const sky = skyOf(vf.F, vf.M);
      const rad = envRad(G, q.which, p, vf.M, q.rad);
      out[q.which][k] = rad;
      for (let c = 0; c < 3; c++) loss[c] += sky - vf.F * rad[c];
    }
  }
  return { loss, cols: out };
}
export function envLoss(p: Vec3, n: Vec3, env: Env | null, G?: Grid): C3 {
  'worklet';
  return envLossCols(p, n, env, G).loss;
}

// 판이 창빛 원반을 가리는 몫: 원반을 판 앞 모서리(가로로 끝없는 직선)로 자른 넓이 비율(활꼴).
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
// 아래 판(점보다 h 아래, 판 앞 모서리까지 zf)이 창빛 원반의 수평선 아래쪽을 가리는 몫. 판 앞면·판 아래(h ≤ 0)는 그 판의 그늘이 아니다
export function keyBlockedBelow(h: number, zf: number) {
  'worklet';
  if (h <= 0) return 0;
  return segment((L_ELEV + Math.atan2(h, Math.max(1e-3, zf))) / light.radius);
}
// 둘레의 판이 점 p에서 창빛 원반을 가리는 몫: 위 판 앞 모서리 위쪽 활꼴 + 아래 판 앞 모서리 아래쪽 활꼴(원반이 수평선 아래로 내려온 만큼)
export function plankKeyBlocked(p: Vec3, env: Env | null) {
  'worklet';
  if (!env) return 0;
  let k = 0;
  if (env.ceil < FAR) k += keyBlocked(env.ceil - p.y, p.z + SHELF_FRONT);
  if (env.floor > -FAR) k += keyBlockedBelow(p.y - env.floor, p.z + SHELF_FRONT);
  return Math.min(1, k);
}

// ---------- 재질 표면(ui/lighting materials) ----------
// 멀리서 본(미세 높이가 모두 화소보다 작은) 거칠기: α² = r⁴ + 2·slope²(Toksvig). seen: 법선 무늬로 그리는 몫(1이면 거칠기에 넣지 않는다)
export function roughOf(m: SurfaceMaterial, seen = 0) {
  const a = m.roughness * m.roughness;
  const s2 = m.bump ? m.bump.slope * m.bump.slope : 0;
  return Math.sqrt(Math.sqrt(a * a + 2 * s2 * (1 - seen * seen)));
}
export const ROUGH = {
  paper: roughOf(materials.paper),
  cloth: roughOf(materials.cloth),
  coated: roughOf(materials.coated),
  pages: roughOf(materials.pages),
  wood: roughOf(materials.wood),
  paint: roughOf(materials.paint),
};
// 창빛 하이라이트를 넓히는 광원 원반(반각 방향 퍼짐 = 원반 반지름의 절반): α² += (반지름/2)²
const LR2 = (light.radius / 2) * (light.radius / 2);

// 환경 반사 몫(유전체 F0, 거칠기 r, n·v): 거칠기까지 넣은 프레넬 적분의 근사(Karis/Lazarov EnvBRDFApprox)
export function envBRDF(nv: number, r: number) {
  'worklet';
  const rx = 1 - r;
  const ry = 0.0425 - 0.0275 * r;
  const rz = 1.04 - 0.572 * r;
  const rw = -0.04 + 0.022 * r;
  const a004 = Math.min(rx * rx, Math.pow(2, -9.28 * Math.max(0, nv))) * rx + ry;
  return F0 * (-1.04 * a004 + rz) + (1.04 * a004 + rw);
}

// GGX 창빛 하이라이트(π·휘도 / 창빛 수직 세기): D·G·F / (4 n·v n·l) · n·l · π
export function ggxKey(n: Vec3, v: Vec3, r: number) {
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
  const a2 = r * r * r * r + LR2;
  const dd = nh * nh * (a2 - 1) + 1;
  const D = a2 / (Math.PI * dd * dd);
  const k = ((r + 1) * (r + 1)) / 8;
  const G = (nv / (nv * (1 - k) + k)) * (nl / (nl * (1 - k) + k));
  const m = 1 - vh;
  const F = F0 + (1 - F0) * m * m * m * m * m;
  return ((D * G * F) / (4 * nv * nl)) * nl * Math.PI;
}

// 방향 w로 처음 보이는 것의 밝기: 책 상자(가장 가까운 면) → 둘레 → 하늘(광선 적분 검사가 쓰는 장면)
// G: 빛 격자(닿은 점의 받는 빛을 격자에서), self: 상자 목록에서 뺄 것(받는 점의 책)
export function traceRadiance(p: Vec3, w: Vec3, env: Env | null, boxes: Box[], G?: Grid, self = -1): C3 {
  'worklet';
  const e = envHit(p, w, env);
  let best = e.t;
  let rad = e.rad;
  if (G && e.which >= 0) {
    const g = envGridE(G, e.which, { x: p.x + w.x * e.t, y: p.y + w.y * e.t, z: p.z + w.z * e.t });
    const a = envAlbedo(e.which);
    rad = [a[0] * g[0], a[1] * g[1], a[2] * g[2]];
  }
  for (let i = 0; i < boxes.length; i++) {
    if (i === self) continue;
    const b = boxes[i];
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
      const alb = faceAlbedo(b, nk, ns);
      if (G) {
        const g = boxGridE(G, i, b, nk, ns, { x: p.x + w.x * t0, y: p.y + w.y * t0, z: p.z + w.z * t0 });
        rad = [alb[0] * g[0], alb[1] * g[1], alb[2] * g[2]];
      } else rad = cscale(alb, irradiance({ x: na.x * ns, y: na.y * ns, z: na.z * ns }));
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

// 하늘 가림(둘레 + 책 상자): 받는 점 p·법선 n에서 가리개가 빼는 빛. G: 빛 격자(가리개 면 밝기), self: 상자 목록에서 뺄 것(받는 점의 책)
export function skyLossAt(p: Vec3, n: Vec3, env: Env | null, boxes: Box[], G?: Grid, self = -1): C3 {
  'worklet';
  const { loss, cols } = envLossCols(p, n, env, G);
  for (let i = 0; i < boxes.length; i++) {
    if (i === self) continue;
    const l = boxLoss(p, n, boxes[i], env, G, i, cols);
    for (let c = 0; c < 3; c++) loss[c] += l[c];
  }
  return loss;
}

// 한 점의 빛(RGB): 받는 빛 r(= E·(1 − 반사 몫) / eref, 재질 색에 곱할 비. eref: 그 재질의 대표 자리 빛 EREF)과
// 반사광 spec(선형, 장면 밝기에 더할 값: 카메라 기준 EREF.wall로 나누고 노출 기준 CAM.gain을 곱한다)
// p: 점, n: 법선, v: 점 → 눈 방향(없으면 반사광 0), env: 둘레(없으면 열린 방), boxes: 가리개 상자, key: 판(위·아래)이 창빛을 가리는 몫을 넣을지.
// 반사광은 거울 방향의 둘레·하늘과 GGX 창빛(이웃 책의 반사는 뺀다, 셰이더와 같다)
// 하늘 가림 loss를 알 때(미리 계산해 둔 값)의 빛: 직접 몫·반사광만 계산한다
// (기본값 식은 워클릿 클로저에 잡히지 않으므로 기본 재질은 본문에서 정한다)
// nf: 가림 loss를 계산한 면 법선(없으면 n). 법선이 기운 곳(둥근 모서리)은 면이 받는 빛의 비율(가림 없는 빛에 대한)을 그 법선의 가림 없는 빛에 곱한다
// rough: 표면 거칠기(없으면 무광 종이), kx: 책이 창빛 원반을 가리는 몫(위 판이 가리고 남은 빛에서)
export function lightWithLoss(p: Vec3, n: Vec3, v: Vec3 | null, env: Env | null, loss: C3, key = true, eref?: C3, nf?: Vec3, rough?: number, kx?: number): { r: C3; spec: C3 } {
  'worklet';
  const ref = eref ?? EREF.book;
  const ro = rough ?? ROUGH.paper;
  const kb = 1 - (1 - (key ? plankKeyBlocked(p, env) : 0)) * (1 - (kx ?? 0));
  const open = (m: Vec3) => light.ambient + light.skyUp * m.y + light.diffuse * Math.max(0, m.x * L_UNIT.x + m.y * L_UNIT.y + m.z * L_UNIT.z) * (1 - kb);
  const E0 = open(n);
  const E0f = nf ? open(nf) : E0;
  const k = E0 / Math.max(E0f, 1e-4);
  // 하늘 가림은 그 면이 받는 하늘 빛보다 클 수 없다(아주 좁은 틈에서 해석 값의 작은 오차가 넘을 때)
  const sky = light.ambient + light.skyUp * (nf ?? n).y;
  const lb = (c: number) => Math.min(loss[c], sky);
  const E: C3 = [Math.max(0, E0f - lb(0)) * k, Math.max(0, E0f - lb(1)) * k, Math.max(0, E0f - lb(2)) * k];
  // 반사광도 둘레가 가린 만큼 가려진다(거친 면은 반사 방향이 넓어 하늘이 보이는 몫 = 확산 몫): 좁은 틈 안은 반사광도 없다
  const vis = (c: number) => Math.max(0, Math.min(1, (sky - lb(c)) / Math.max(sky, 1e-4)));
  if (!v) return { r: [E[0] / ref[0], E[1] / ref[1], E[2] / ref[2]], spec: [0, 0, 0] };
  const nv = Math.max(0, n.x * v.x + n.y * v.y + n.z * v.z);
  const ks = envBRDF(nv, ro);
  const vn = 2 * (n.x * v.x + n.y * v.y + n.z * v.z);
  const rr = { x: vn * n.x - v.x, y: vn * n.y - v.y, z: vn * n.z - v.z };
  const env3 = envHit(p, rr, env).rad;
  const key3 = ggxKey(n, v, ro) * light.diffuse * (1 - kb);
  const cam = EREF.wall;
  const g = CAM.gain;
  return {
    r: [(E[0] * (1 - ks)) / ref[0], (E[1] * (1 - ks)) / ref[1], (E[2] * (1 - ks)) / ref[2]],
    spec: [((ks * env3[0] * vis(0) + key3) * g) / cam[0], ((ks * env3[1] * vis(1) + key3) * g) / cam[1], ((ks * env3[2] * vis(2) + key3) * g) / cam[2]],
  };
}

export function sceneLight(p: Vec3, n: Vec3, v: Vec3 | null, env: Env | null, boxes: Box[], key = true, eref?: C3, G?: Grid, self = -1, rough?: number) {
  'worklet';
  return lightWithLoss(p, n, v, env, skyLossAt(p, n, env, boxes, G, self), key, eref, undefined, rough);
}

// ---------- 그린 판 끝 너머, 판 두께 높이의 벽 ----------
// 가림 계산에서 판은 가로로 끝없이 이어지므로 판 두께 높이의 벽은 판 속이다. 그린 판 끝 너머로는 그 벽이 보이므로 띠의 위·아래 경계
// (판 윗면·아랫면 높이의 벽)가 받는 빛을 높이로 잇는다. 띠는 위·아래 두 줄 캔버스에 걸치므로 줄마다 제 쪽 절반을 맡는다:
// 제 쪽 경계(이 줄 계산 그대로) → 띠 가운데(mid) → 건너편 경계(far). mid는 두 경계를 책 없이 계산한 빛의 평균이라 두 줄이 같은 값을 쓴다
// (책 없이 둘레만이면 x로 같아 한 값). 줄 캔버스는 줄마다 제 줄 기준 카메라로 그려 같은 띠가 두 캔버스에서 조금 어긋나므로,
// 건너편 줄이 덮는 절반은 mid를 그대로 둔다(far = mid). 맨 아랫줄 판 밑은 같은 캔버스의 책 없는 판 밑 벽이라 far로 잇는다.
// 이 줄 쪽 경계 점은 판 면에서 줄 안으로 TOUCH 들인 곳
export type Band = { mid: C3; far: C3 };
// 가림이 없을 때 받는 빛(판이 창빛 원반을 가린 몫까지)
function openE(p: Vec3, n: Vec3, env: Env | null) {
  'worklet';
  return light.ambient + light.skyUp * n.y + light.diffuse * Math.max(0, dot3(n, L_UNIT)) * (1 - plankKeyBlocked(p, env));
}
// 책 없는 둘레의 빛 격자(높이로 옮겨도 같다: 판 사이 간격·열린 쪽마다 한 번만 푼다)
const FREE_GRIDS = new Map<string, C3[]>();
export function freeGrid(env: Env): Grid {
  const key = `${env.floor > -FAR},${env.ceil < FAR},${env.floor > -FAR && env.ceil < FAR ? env.ceil - env.floor : 0}`;
  let e = FREE_GRIDS.get(key);
  if (!e) {
    e = solveGrid(env, []).e;
    FREE_GRIDS.set(key, e);
  }
  return { e, nBox: 0, nx: 1, env };
}
// 줄 둘레만으로(책 없이, 그 둘레의 빛 격자로) 계산한 판 경계 벽의 받는 빛: 판 윗면 높이(atFloor) 또는 위 판 아랫면 높이
function edgeLight(env: Env, atFloor: boolean): C3 {
  const n = { x: 0, y: 0, z: -1 };
  const p = { x: (SHELF_X0 + SHELF_X1) / 2, y: atFloor ? env.floor + TOUCH : env.ceil - TOUCH, z: SHELF_DEPTH };
  const e = openE(p, n, env);
  const loss = envLoss(p, n, env, freeGrid(env));
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
export function bakeLoss(p: Vec3, n: Vec3, env: Env | null, boxes: Box[], band: [Band | null, Band | null] = [null, null], G?: Grid, self = -1): C3 {
  'worklet';
  if (env && n.z < -0.5 && p.z >= SHELF_DEPTH - 1e-6) {
    const lo = band[0] && env.floor > -FAR && p.y < env.floor && p.y > env.floor - SHELF_THICK;
    const hi = band[1] && env.ceil < FAR && p.y > env.ceil && p.y < env.ceil + SHELF_THICK;
    if (lo || hi) {
      const q = { x: p.x, y: lo ? env.floor + TOUCH : env.ceil - TOUCH, z: p.z };
      const t = Math.min(1, Math.abs(p.y - q.y) / SHELF_THICK);
      const eq = openE(q, n, env);
      const lq = skyLossAt(q, n, env, boxes, G, self);
      const b = (lo ? band[0] : band[1])!;
      const e = openE(p, n, env);
      return [0, 1, 2].map((c) => e - (t <= 0.5 ? (eq - lq[c]) * (1 - 2 * t) + b.mid[c] * 2 * t : b.mid[c] * (2 - 2 * t) + b.far[c] * (2 * t - 1))) as C3;
    }
  }
  return skyLossAt(p, n, env, boxes, G, self);
}

// 받는 면의 상대 어둠(0이면 그대로, 휘도): 가림 없을 때보다 빛이 빠진 비율
export function darkening(p: Vec3, n: Vec3, env: Env | null, boxes: Box[], key = true) {
  'worklet';
  const e = irradiance(n);
  if (e <= 1e-6) return 0;
  return 1 - lum(sceneLight(p, n, null, env, boxes, key, grey(1)).r) / e;
}

// ---------- 빛 격자 풀기 ----------
// 격자점 하나가 받는 빛 = 하늘 + 창빛(위 판이 원반을 가린 몫, 다른 책이 막는지는 원반 가운데로 쏜 그림자 광선) − 하늘 가림
// (가리개 면 밝기는 지난 격자 G). 격자점은 면 위에 있고 그 면의 상자(self)는 뺀다(볼록한 상자의 면은 제 상자에 가리지 않는다).
// 다른 책에 덮인 격자점(점에서 법선 쪽으로 조금 나간 곳이 그 책 안: 맞닿은 면, 책 밑 판)은 덮은 책이 없었다면 받았을 빛이다:
// 그 자리는 어디서도 보이지 않고 가리개 뒤에 보였을 것(behindOf)과 보간(드러난 이웃 점과 이어지게)에만 쓰인다.
// 판 속·벽 너머(책 꼬리가 놓인 판, 벽에 붙은 책배)는 어디서도 보이지 않아 0
const ABSENT = -2;
type GridNode = { P: Vec3; n: Vec3; self: number };
function insideBox(q: Vec3, b: Box) {
  'worklet';
  const d = { x: q.x - b.c.x, y: q.y - b.c.y, z: q.z - b.c.z };
  return Math.abs(dot3(d, b.ax)) < b.hx && Math.abs(dot3(d, b.ay)) < b.hy && Math.abs(dot3(d, b.az)) < b.hz;
}
function inShelf(q: Vec3, env: Env) {
  'worklet';
  if (q.z > SHELF_DEPTH) return true;
  return inDepth(q.z) && ((env.floor > -FAR && q.y < env.floor && q.y > env.floor - SHELF_THICK) || (env.ceil < FAR && q.y > env.ceil && q.y < env.ceil + SHELF_THICK));
}
// 점 p에서 방향 w로 가는 광선이 상자에 닿는가
function rayHitsBox(p: Vec3, w: Vec3, b: Box) {
  'worklet';
  let t0 = 1e-6;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const a = axisOf(b, k);
    const h = halfOf(b, k);
    const ol = (p.x - b.c.x) * a.x + (p.y - b.c.y) * a.y + (p.z - b.c.z) * a.z;
    const wl = dot3(w, a);
    if (Math.abs(wl) < 1e-12) {
      if (Math.abs(ol) > h) return false;
      continue;
    }
    const ta = (-h - ol) / wl;
    const tb = (h - ol) / wl;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  }
  return t0 <= t1;
}
function nodeE(nd: GridNode, env: Env, boxes: Box[], G?: Grid): C3 {
  'worklet';
  const { P, n, self } = nd;
  const q = { x: P.x + n.x * TOUCH, y: P.y + n.y * TOUCH, z: P.z + n.z * TOUCH };
  if (self === ABSENT || inShelf(q, env)) return [0, 0, 0];
  // 덮은 책은 뺀다
  const skip = boxes.map((b, i) => i === self || insideBox(q, b));
  const nl = dot3(n, L_UNIT);
  let key = 0;
  if (nl > 0) {
    key = light.diffuse * nl * (1 - plankKeyBlocked(P, env));
    for (let i = 0; i < boxes.length && key > 0; i++) if (!skip[i] && rayHitsBox(P, L_UNIT, boxes[i])) key = 0;
  }
  const E: C3 = [0, 0, 0];
  const { loss, cols } = envLossCols(P, n, env, G);
  for (let i = 0; i < boxes.length; i++) {
    if (skip[i]) continue;
    const l = boxLoss(P, n, boxes[i], env, G, i, cols);
    for (let c = 0; c < 3; c++) loss[c] += l[c];
  }
  const E0 = light.ambient + light.skyUp * n.y + key;
  for (let c = 0; c < 3; c++) E[c] = Math.max(0, E0 - loss[c]);
  return E;
}
// 격자점(빛 격자 칸 순서): 상자마다 면 f = 축 k + 3·(s > 0)의 N × N, 그 뒤 둘레 면(벽, 판 윗면, 위 판 아랫면)의 nx × ENV_NY.
// 면 가장자리 점은 면 안으로 TOUCH 들인다(이웃 면 평면 위의 점에서는 그 면이 보이지 않는다: 면의 앞쪽에서만 보인다)
function inset(t: number, len: number) {
  'worklet';
  const e = Math.min(0.5, TOUCH / Math.max(len, 1e-9));
  return Math.max(e, Math.min(1 - e, t));
}
function gridNodes(env: Env, boxes: Box[], nx: number): GridNode[] {
  'worklet';
  const out: GridNode[] = [];
  boxes.forEach((b, i) => {
    for (let f = 0; f < 6; f++) {
      const k = f % 3;
      const s = f < 3 ? -1 : 1;
      const a = axisOf(b, k);
      const h = halfOf(b, k);
      const nf = { x: a.x * s, y: a.y * s, z: a.z * s };
      const au = axisOf(b, (k + 1) % 3);
      const av = axisOf(b, (k + 2) % 3);
      const hu = halfOf(b, (k + 1) % 3);
      const hv = halfOf(b, (k + 2) % 3);
      for (let jb = 0; jb < GRID_N; jb++)
        for (let ia = 0; ia < GRID_N; ia++) {
          const u = -hu + 2 * hu * inset(chebT(ia, GRID_N), 2 * hu);
          const v = -hv + 2 * hv * inset(chebT(jb, GRID_N), 2 * hv);
          out.push({ P: { x: b.c.x + nf.x * h + au.x * u + av.x * v, y: b.c.y + nf.y * h + au.y * u + av.y * v, z: b.c.z + nf.z * h + au.z * u + av.z * v }, n: nf, self: i });
        }
    }
  });
  for (const which of [ENV_WALL, ENV_FLOOR, ENV_CEIL]) {
    const absent = (which === ENV_FLOOR && env.floor <= -FAR) || (which === ENV_CEIL && env.ceil >= FAR);
    for (let jb = 0; jb < ENV_NY; jb++) {
      const t = inset(chebT(jb, ENV_NY), which === ENV_WALL ? (env.floor > -FAR && env.ceil < FAR ? env.ceil - env.floor : ENV_L) : ENV_L);
      for (let ia = 0; ia < nx; ia++) {
        const x = nx < 2 ? (SHELF_X0 + SHELF_X1) / 2 : SHELF_X0 + ((SHELF_X1 - SHELF_X0) * ia) / (nx - 1);
        if (which === ENV_WALL) out.push({ P: { x, y: envY(env, t), z: SHELF_DEPTH }, n: { x: 0, y: 0, z: -1 }, self: -1 });
        else out.push({ P: { x, y: which === ENV_FLOOR ? env.floor : env.ceil, z: -SHELF_FRONT + ENV_L * t }, n: { x: 0, y: which === ENV_FLOOR ? 1 : -1, z: 0 }, self: absent ? ABSENT : -1 });
      }
    }
  }
  return out;
}
// 줄의 빛 격자: 가림 없는 밝기에서 시작해 passes번 되풀이(되풀이할 때마다 한 번 더 튕긴 빛까지). 책이 없으면 둘레는 가로로 같다(가로 점 하나).
// 되풀이 수: 다중 반사 경로 추적과 비교해 책 사이 틈 안쪽(가장 많이 튕기는 곳)까지 맞는 수(light-model 테스트)
export const GRID_PASSES = 6;
export function solveGrid(env: Env, boxes: Box[], passes = GRID_PASSES): Grid {
  'worklet';
  const nx = boxes.length ? ENV_NX : 1;
  const nodes = gridNodes(env, boxes, nx);
  let G: Grid | undefined;
  for (let k = 0; k < passes; k++) {
    const prev: Grid | undefined = G;
    G = { e: nodes.map((nd) => nodeE(nd, env, boxes, prev)), nBox: boxes.length, nx, env };
  }
  return G!;
}

// ---------- 화면 합성(감마 공간) ----------
// 화면 색(표시 선형) = tone(노출 × (toneInv(a) × r + spec)): a = 재질 색(대표 자리에서 보이는 색, 선형), r = 대표 자리 대비 받는 빛 비,
// spec = 반사광(장면 밝기). toneInv(a) × r = CAM.gain × 반사율 × 받는 빛 / EREF.wall(맞추기가 그렇게 반사율을 정한다). 대표 자리(r = 1, 반사광 없음, 노출 0)에서 재질 색 그대로다.
// 그리는 방식: 재질 그림(감마 sRGB) 위에 곱하기(이득 ≤ 1, 반사광 없이)·컬러 닷지(나머지 밝아짐과 반사광). 그림의 색이 a와 다른 곳(책 그림)은
// a의 이득을 그대로 쓴다(톤 곡선의 직선 부분에서는 같다, 어깨에서는 근사)
export const EXPOSURE = Math.pow(2, camera.exposure);
// sref: 그 재질이 대표 자리에서 받는 반사광(SREF): 재질 색은 반사광까지 넣은 '보이는 색'이라 확산 몫은 toneInv(a) − sref
export function toneTarget(a: number, r: number, spec = 0, sref = 0) {
  'worklet';
  return tone(EXPOSURE * (Math.max(0, toneInv(a) - sref) * Math.max(0, r) + spec));
}
// 곱하기가 내릴 화면 색(base): 확산 몫이되, 8비트 화면 버퍼에서 닷지가 올릴 수 있게 target의 1/4보다 낮추지 않는다
// (확산 몫이 0인 채널이 곱하기에서 0이 되면 닷지가 반사광을 더하지 못한다)
function toneBase(a: number, r: number, spec: number, sref: number) {
  'worklet';
  return Math.min(Math.max(a, 1e-4), Math.max(toneTarget(a, r, 0, sref), 0.25 * toneTarget(a, r, spec, sref)));
}
// 곱하기 값(감마 공간): 화면 색 × 이 값
export function toneMul(a: number, r: number, spec = 0, sref = 0) {
  'worklet';
  return Math.pow(Math.max(0, Math.min(1, toneBase(a, r, spec, sref) / Math.max(a, 1e-4))), 1 / GAMMA);
}
// 컬러 닷지 값: 곱한 뒤의 화면 색 / (1 − s)가 반사광까지 넣은 화면 색이 되게
export function toneDodge(a: number, r: number, spec = 0, sref = 0) {
  'worklet';
  const base = toneBase(a, r, spec, sref);
  const target = toneTarget(a, r, spec, sref);
  if (target <= base || target <= 0) return 0;
  return 1 - Math.pow(base / target, 1 / GAMMA);
}
// 진하기 d(선형, 빛이 d만큼 빠짐)를 검정 덮기 불투명도로: 화면 색 × (1 − d)^(1/γ)
export function shadowAlpha(d: number) {
  'worklet';
  return 1 - Math.pow(Math.max(0, Math.min(1, 1 - d)), 1 / GAMMA);
}

// ---------- 재질 반사율 맞추기(역렌더링) ----------
// 재질 색(시안의 색)은 그 재질이 대표 자리에서 보이는 색이다. 대표 자리는 기준 줄(판 사이 REF_SPACE, 예시 책장 가운데 줄)에서
// 빛 조건이 비슷한 열린 자리다: 벽 = 빈 줄 가운데 높이의 벽, 판 = 판 앞면 가운데, 책(장정·속지) = 홀로 선 책의 책등 가운데
// (속지도 시안에서 책 앞쪽 빛으로 그려진 색이다). 카메라(화이트 밸런스, 노출의 기준)는 벽 대표 자리에 맞춘다.
// 화면 색 = tone(gain × 반사율 × 받는 빛 / 카메라 빛)이라 실제 반사율 = toneInv(재질 색) × (카메라 빛 / 그 재질 대표 자리 빛) / gain이고,
// 되비침이 이 반사율로 다시 빛을 바꾸므로 바뀌지 않을 때까지 되풀이한다. 그러면 모든 재질이 대표 자리에서 시안 색 그대로, 다른 자리
// (가림·색 번짐·그림자)는 물리대로 보인다. 책이 찬 줄 안쪽처럼 대표 자리보다 가려진 곳은 물리대로 더 어둡다.
// (책이 찬 줄의 책 위 벽을 기준으로 하면 그 자리 빛이 대표 자리들의 1/3이라 종이·판 반사율이 0.3 안팎이 되어 물리적이지 않다)
// 빛 격자를 여러 번 풀어야 해서 미리 계산해 둔다: light-calibration.generated.ts(입력이 바뀌면 테스트가 알리고
// UPDATE_CALIBRATION=1로 light-calibration 테스트를 돌려 다시 만든다)
const REF_SPACE = 200;
const REF_BOOK_H = 150;
const REF_X = (SHELF_X0 + SHELF_X1) / 2;
const REF_ENV: Env = { floor: 0, ceil: REF_SPACE };
const REF_EYE = (() => {
  const e = camAt(VIEW_PITCH_MIN).eye!;
  return { x: e.x, y: e.y, z: e.z - e.dist };
})();
// 대표 자리의 확산 몫 빛(반사된 몫 ks 뺀 것): 재질 거칠기 rough로
function refNv(p: Vec3, n: Vec3) {
  const d = { x: REF_EYE.x - p.x, y: REF_EYE.y - p.y, z: REF_EYE.z - p.z };
  return Math.max(0, (n.x * d.x + n.y * d.y + n.z * d.z) / Math.hypot(d.x, d.y, d.z));
}
const REF_BOOK_P = { x: REF_X, y: REF_BOOK_H / 2, z: 0 };
const REF_FRONT = { x: 0, y: 0, z: -1 };
function anchorLight(p: Vec3, n: Vec3, G: Grid, rough: number): C3 {
  const kb = plankKeyBlocked(p, REF_ENV);
  const E0 = light.ambient + light.skyUp * n.y + light.diffuse * Math.max(0, n.x * L_UNIT.x + n.y * L_UNIT.y + n.z * L_UNIT.z) * (1 - kb);
  const loss = envLoss(p, n, REF_ENV, G);
  const ks = envBRDF(refNv(p, n), rough);
  return [(E0 - loss[0]) * (1 - ks), (E0 - loss[1]) * (1 - ks), (E0 - loss[2]) * (1 - ks)];
}
// 장정 재질의 대표 자리 빛: 재질이 다르면 대표 자리에서 반사되는 몫이 달라 확산 몫이 다르다(무광 종이 EREF.book 기준)
const REF_NV_BOOK = refNv(REF_BOOK_P, REF_FRONT);
export function bookEref(m?: BindingMaterial): C3 {
  'worklet';
  const k = (1 - envBRDF(REF_NV_BOOK, ROUGH[m ?? 'paper'])) / (1 - envBRDF(REF_NV_BOOK, ROUGH.paper));
  return [EREF.book[0] * k, EREF.book[1] * k, EREF.book[2] * k];
}
// 대표 자리의 반사광(이득 1일 때 장면 밝기): 눈(REF_EYE) 쪽으로 반사되는 둘레·하늘과 창빛(lightWithLoss와 같은 식)
function anchorSpec(p: Vec3, n: Vec3, G: Grid, rough: number): C3 {
  const d = { x: REF_EYE.x - p.x, y: REF_EYE.y - p.y, z: REF_EYE.z - p.z };
  const l = Math.hypot(d.x, d.y, d.z);
  const s = lightWithLoss(p, n, { x: d.x / l, y: d.y / l, z: d.z / l }, REF_ENV, envLoss(p, n, REF_ENV, G), true, undefined, undefined, rough).spec;
  return [s[0] / CAM.gain, s[1] / CAM.gain, s[2] / CAM.gain];
}
// 대표 자리 반사광(이득 1): 맞추기가 정한다
const SPEC0 = { wall: grey(0), plank: grey(0), paper: grey(0), book: { paper: grey(0), cloth: grey(0), coated: grey(0) } as Record<BindingMaterial, C3> };
export type Calibration = { gain: number; eref: { wall: C3; plank: C3; book: C3; paper: C3 }; albedo: { wall: C3; plank: C3; paper: C3 }; sref: typeof SREF };
// 재질 하나의 반사율: 화면 색 = tone(이득 g × 반사율 × 받는 빛 / 카메라 빛 + 반사광)에서 대표 자리(받는 빛 ref, 반사광 g·s0)가 재질 색 d.
// 반사율 = (toneInv(d) − g·s0) × 카메라 빛 / (ref × g). 반사광만으로 재질 색보다 밝은 채널은 0(그 방의 빛에서 그만큼 짙게 보일 수 없다)
function albedoOf(d: C3, ref: C3, s0: C3, g: number): C3 {
  const cam = EREF.wall;
  return [0, 1, 2].map((c) => Math.max(0, ((toneInv(d[c]) - g * s0[c]) * cam[c]) / (ref[c] * g))) as C3;
}
// 노출 기준(이득 gain): 모든 재질 색(벽·판·속지, 시안 장정 색 × 장정 재질)에서 반사율이 그 색(화면 색)을 넘지 않고
// 결의 가장 밝은 점(grainPeak)까지 1을 넘지 않는 가장 작은 이득. 어깨가 밝은 쪽을 누르므로 이득이 1이면 밝은 색은 반사율이 1을 넘는다.
// 반사율 ≤ d ⇔ g ≥ toneInv(d)·cam / (ref·d + s0·cam), 반사율 × 결 최대 f ≤ 1 ⇔ g ≥ toneInv(d)·cam·f / (ref + f·s0·cam)
const BOOK_MATS = ['paper', 'cloth', 'coated'] as const;
function setAlbedo() {
  const cam = EREF.wall;
  const peak = (name: keyof typeof materials) => grainPeak(MAT_UNIFORMS[name]);
  const all: [C3, C3, C3, number][] = [
    [DESIGN.wall, EREF.wall, SPEC0.wall, peak('paint')],
    [DESIGN.plank, EREF.plank, SPEC0.plank, peak('wood')],
    [DESIGN.paper, EREF.paper, SPEC0.paper, peak('pages')],
  ];
  for (const hex of Object.keys(palette)) for (const m of BOOK_MATS) all.push([linearOf(hex), bookEref(m), SPEC0.book[m], peak(m)]);
  CAM.gain = Math.max(
    ...all.flatMap(([d, ref, s0, f]) => [0, 1, 2].map((c) => Math.max((toneInv(d[c]) * cam[c]) / (ref[c] * d[c] + s0[c] * cam[c]), (toneInv(d[c]) * cam[c] * f) / (ref[c] + f * s0[c] * cam[c])))),
  );
  const g = CAM.gain;
  ALBEDO.wall = albedoOf(DESIGN.wall, EREF.wall, SPEC0.wall, g);
  ALBEDO.plank = albedoOf(DESIGN.plank, EREF.plank, SPEC0.plank, g);
  ALBEDO.paper = albedoOf(DESIGN.paper, EREF.paper, SPEC0.paper, g);
  const gs = (s0: C3): C3 => [s0[0] * g, s0[1] * g, s0[2] * g];
  SREF.wall = gs(SPEC0.wall);
  SREF.plank = gs(SPEC0.plank);
  SREF.paper = gs(SPEC0.paper);
  SREF.book = { paper: gs(SPEC0.book.paper), cloth: gs(SPEC0.book.cloth), coated: gs(SPEC0.book.coated) };
  setRadiance();
}
// 맞추기(테스트에서만). 반사율이 1e-4보다 덜 바뀌면 멈춘다
export function runCalibration(log?: (s: string) => void): Calibration {
  const front = { x: 0, y: 0, z: -1 };
  for (let i = 0; i < 20; i++) {
    const before = [ALBEDO.wall, ALBEDO.plank, ALBEDO.paper, EREF.book, SREF.wall, SREF.plank, SREF.paper, ...BOOK_MATS.map((m) => SREF.book[m])].flat();
    // 대표 자리의 둘레(빈 줄)도 여러 번 튕긴 빛으로(빛 격자)
    const G = solveGrid(REF_ENV, []);
    EREF.wall = anchorLight({ x: REF_X, y: REF_SPACE / 2, z: SHELF_DEPTH }, front, G, ROUGH.paint);
    EREF.plank = anchorLight({ x: REF_X, y: -SHELF_THICK / 2, z: -SHELF_FRONT }, front, G, ROUGH.wood);
    EREF.book = anchorLight(REF_BOOK_P, front, G, ROUGH.paper);
    EREF.paper = anchorLight(REF_BOOK_P, front, G, ROUGH.pages);
    SPEC0.wall = anchorSpec({ x: REF_X, y: REF_SPACE / 2, z: SHELF_DEPTH }, front, G, ROUGH.paint);
    SPEC0.plank = anchorSpec({ x: REF_X, y: -SHELF_THICK / 2, z: -SHELF_FRONT }, front, G, ROUGH.wood);
    SPEC0.paper = anchorSpec(REF_BOOK_P, front, G, ROUGH.pages);
    for (const m of BOOK_MATS) SPEC0.book[m] = anchorSpec(REF_BOOK_P, front, G, ROUGH[m]);
    setAlbedo();
    const after = [ALBEDO.wall, ALBEDO.plank, ALBEDO.paper, EREF.book, SREF.wall, SREF.plank, SREF.paper, ...BOOK_MATS.map((m) => SREF.book[m])].flat();
    const change = Math.max(...after.map((v, k) => Math.abs(v - before[k])));
    log?.(`calibration ${i}: change ${change.toExponential(2)}`);
    if (change < 1e-6) break;
  }
  return { gain: CAM.gain, eref: { wall: EREF.wall, plank: EREF.plank, book: EREF.book, paper: EREF.paper }, albedo: { wall: ALBEDO.wall, plank: ALBEDO.plank, paper: ALBEDO.paper }, sref: SREF };
}
// 맞추기 입력(이 값이 바뀌면 미리 계산한 값을 다시 만든다). method: 맞추기 방법을 바꾸면 올린다
const CALIBRATION_METHOD = 4;
export function calibrationInputs() {
  return JSON.stringify({ method: CALIBRATION_METHOD, light, F0, materials, surfaces, palette: Object.keys(palette), TONE, REF_SPACE, REF_BOOK_H, SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1, GRID_N, ENV_NY, ENV_COLS, GRID_PASSES, TOUCH, eye: REF_EYE });
}
export function applyCalibration(c: Calibration) {
  CAM.gain = c.gain;
  EREF.wall = c.eref.wall;
  EREF.plank = c.eref.plank;
  EREF.book = c.eref.book;
  EREF.paper = c.eref.paper;
  ALBEDO.wall = c.albedo.wall;
  ALBEDO.plank = c.albedo.plank;
  ALBEDO.paper = c.albedo.paper;
  SREF.wall = c.sref.wall;
  SREF.plank = c.sref.plank;
  SREF.paper = c.sref.paper;
  SREF.book = { ...c.sref.book };
  setRadiance();
  // 반사율은 1을 넘을 수 없다(받은 빛보다 많이 되비추는 면은 없다)
  for (const v of [ALBEDO.wall, ALBEDO.plank, ALBEDO.paper]) if (Math.max(...v) > 1) throw new Error(`light-model: albedo > 1 (${v.join(', ')})`);
}
// 처음 값: 미리 계산한 맞추기. 입력이 바뀌어 낡았으면(다시 만들기 전) 그린 색 그대로 한 번 맞춘 값(light-calibration 테스트가 알린다)
if (CALIBRATION && CALIBRATION_INPUTS === calibrationInputs()) applyCalibration(CALIBRATION);
else setAlbedo();

// 장정 재질의 대표 자리 반사광
export function bookSref(m?: BindingMaterial): C3 {
  'worklet';
  return SREF.book[m ?? 'paper'];
}
// 책 장정 색(시안 색) → 실제 반사율(되비침에 쓴다, albedoOf와 같은 식). m: 장정 재질(없으면 무광 종이)
export function bookAlbedo(hex: string, m?: BindingMaterial): C3 {
  'worklet';
  const c = linearOf(hex);
  const g = CAM.gain;
  const e = bookEref(m);
  const sr = bookSref(m);
  return [0, 1, 2].map((k) => (Math.max(0, toneInv(c[k]) - sr[k]) * EREF.wall[k]) / e[k] / g) as C3;
}
