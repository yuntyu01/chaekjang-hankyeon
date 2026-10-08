// 화소마다의 빛 셰이더 소스(SkSL). domain/light-model과 같은 식·같은 이름이다(그쪽 주석이 식의 출처).
// 순수 문자열이라 테스트가 CanvasKit으로 컴파일하고 같은 점의 값을 JS 모델과 비교한다(__tests__/scene-light-shader.test.ts).
// 두 가지:
//   bake: 하늘 가림(둘레·책 상자가 가린 하늘, 시점과 상관없다)을 면 좌표 그림에 굽는다. 무거운 몫은 모두 여기(책이 멈췄을 때만 돈다).
//   lit: 구운 그림(tex)을 읽고 나머지(하늘·창빛 직접 몫, 둥근 모서리 법선, 반사광)를 화소마다. 곱하기·컬러 닷지 두 가지로 컴파일한다.
import { EDGE_R, GROOVE, SPINE_CURVE } from '@/domain/book-parts';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from '@/domain/geometry';
import { ALBEDO, BOX_MAX, BOX_VEC, DESIGN, ENV_COLS, ENV_NY, CAM, EREF, EXPOSURE, FAR, GAMMA, GRID_N, KEY_C, KEY_DIRS, L_ELEV, L_UNIT, RAD, SKY_C, TONE, TOUCH, type C3 } from '@/domain/light-model';
import type { Affine, Cam, Vec3 } from '@/domain/camera';
import { F0, light } from '@/ui/lighting';

// 평면: 한 점 O, 바깥 법선 n, 둥근 모서리(평면 안에서 모서리 쪽 단위 벡터 T와 모서리의 그 축 좌표 at)
export type Plane = { O: Vec3; n: Vec3; edges?: { T: Vec3; at: number }[] };

// 캔버스 px (X, Y) → 평면 위 점: 눈 E에서 화면 점 S(X, Y)로 가는 광선이 평면(점 O, 법선 n)과 만나는 곳.
// P = E + (S − E) / w, w = n·(S − E) / n·(O − E)는 X·Y에 1차라 P = N(X, Y) / w(X, Y)(N도 1차)로 셰이더에 넘긴다.
// 수가 작게 유지된다(w ≈ 1): 눈 거리(약 4900)를 화소마다 빼고 더하지 않는다.
export function planeFrame(c: Cam, px: Affine, pl: Plane) {
  'worklet';
  const e = c.eye!;
  const E = { x: e.x, y: e.y, z: e.z - e.dist };
  const n = pl.n;
  const num = n.x * (pl.O.x - E.x) + n.y * (pl.O.y - E.y) + n.z * (pl.O.z - E.z);
  // 화면 점 S = ((X − tx)/s, −(Y − ty)/s, e.z)
  const w = (X: number, Y: number) => (n.x * ((X - px.tx) / px.s - E.x) + n.y * (-(Y - px.ty) / px.s - E.y) + n.z * (e.z - E.z)) / num;
  const N = (X: number, Y: number) => {
    const k = w(X, Y);
    return [E.x * k + (X - px.tx) / px.s - E.x, E.y * k - (Y - px.ty) / px.s - E.y, E.z * k + e.z - E.z];
  };
  const o = N(0, 0);
  const ux = N(1, 0);
  const vy = N(0, 1);
  const w0 = w(0, 0);
  return {
    O: o,
    Ux: [ux[0] - o[0], ux[1] - o[1], ux[2] - o[2]],
    Vy: [vy[0] - o[0], vy[1] - o[1], vy[2] - o[2]],
    Hw: [w(1, 0) - w0, w(0, 1) - w0, w0],
  };
}

const f = (v: number) => (Number.isFinite(v) ? v.toPrecision(9) : '1e9');
const v3 = (v: { x: number; y: number; z: number }) => `float3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;
const c3 = (c: C3) => `float3(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;
// 잘린 다각형 꼭짓점 최대 수: 사각형 4 + 반구 1 + 구역 평면 둘 2(볼록 다각형은 평면 하나에 꼭짓점이 많아야 하나 는다)
const NV = 7;

// 하늘 가림 그림: 선형 RGB 채널마다 남은 하늘 빛 R = sky − 가림(sky = 그 면이 받는 하늘 빛 AMB + SKYUP·n.y, n = 구운 면 법선)을
// 0을 가운데(그림 값 LOSS_G0)로 양쪽 제곱근 곡선에 담는다: R ≥ 0이면 g = G0 + (1 − G0)·√(R/RP), R < 0이면 g = G0 − G0·√(−R/RN).
// 받는 빛이 작은 그늘일수록 단계가 촘촘하다(R 0.02에서 한 단계 0.0018, 하늘 그대로 0.3에서 0.0069. 가림을 그대로 담으면 어디서나 0.0075라
// 깊은 그늘에서 띠·동심원이 보인다). R이 음수인 곳: 겹친 가리개를 두 번 센 회색 오차(shade가 세 채널에서 똑같이 뺀다), 판 두께 높이 벽 띠
// (그 점은 판 속이라 창빛이 다 가려진 것으로 보지만 띠 빛은 위아래 경계 빛을 이어 창빛 몫까지 받는다: 가림이 창빛 몫만큼 하늘보다 크거나 작다).
// RP = 하늘 + 밝은 판의 되비침(0.25 안) + 띠의 창빛, RN = 모두 가려진 앞면의 빛 − 가장 작은 하늘.
// 굽는 값에 칸마다 다른 반 단계 안의 디더를 더해 남은 양자화를 고른 잡음으로 흩는다.
// 그림 칸 값이 색 변환되지 않도록 굽는 표면은 화면 표면과 같은 색 공간이다(SceneLight bakeAtlas)
export const LOSS_G0 = 0.3;
const SKY_MAXC = Math.max(...SKY_C);
const KEY_MAXC = Math.max(...KEY_C);
export const LOSS_RP = SKY_MAXC * (light.ambient + light.skyUp) + KEY_MAXC * light.diffuse + 0.25;
export const LOSS_RN = KEY_MAXC * light.diffuse + 2 * SKY_MAXC * light.skyUp;
// 가림 L(면이 받는 하늘 빛 sky) ↔ 그림 값 g
export function lossEncode(L: number, sky: number) {
  const R = sky - L;
  return R >= 0 ? LOSS_G0 + (1 - LOSS_G0) * Math.sqrt(Math.min(1, R / LOSS_RP)) : LOSS_G0 - LOSS_G0 * Math.sqrt(Math.min(1, -R / LOSS_RN));
}
export function lossDecode(g: number, sky: number) {
  const a = (g - LOSS_G0) / (1 - LOSS_G0);
  const b = (LOSS_G0 - g) / LOSS_G0;
  return sky - (g >= LOSS_G0 ? LOSS_RP * a * a : -LOSS_RN * b * b);
}
// 그 자리 그림 값 한 단계의 가림 크기(곡선 기울기 × 1/255 + 곡률 몫)
export function lossStep(L: number, sky: number) {
  const g = lossEncode(L, sky);
  const pos = g >= LOSS_G0;
  const k = pos ? LOSS_RP / ((1 - LOSS_G0) * (1 - LOSS_G0)) : LOSS_RN / (LOSS_G0 * LOSS_G0);
  return (2 * k * Math.abs(g - LOSS_G0) + k / 255) / 255;
}
// 빛 격자 그림(light-model Grid): 칸 값 = 받는 빛 / GRID_SCALE(선형 RGB). 가로 6·GRID_N칸: 상자 i의 면 f(축 k + 3·(s > 0))는
// (f·N, i·N)부터 N × N, 그 아래(nBox·N부터) 둘레 면(벽, 판 윗면, 위 판 아랫면)이 ENV_NX × ENV_NY씩(책이 없으면 가로 한 칸)
export const GRID_SCALE = 1.5;

// 상수·둘레(두 셰이더 공통). env: 둘레(있음, 판 윗면 높이, 위 판 아랫면 높이), 없는 판은 ∓FAR
function header() {
  return `
  uniform float3 env;

  const float PI = 3.14159265;
  const float AMB = ${f(light.ambient)};
  const float SKYUP = ${f(light.skyUp)};
  const float DIFF = ${f(light.diffuse)};
  const float3 LU = ${v3(L_UNIT)};
  // 카메라 기준 빛(벽 대표 자리 빛 / 노출 기준 CAM.gain, 반사광을 장면 밝기로)
  const float3 ECAM = ${c3(EREF.wall.map((v) => v / CAM.gain) as C3)};
  const float LELEV = ${f(L_ELEV)};
  const float LRAD = ${f(light.radius)};
  const float F0 = ${f(F0)};
  // 창빛 원반이 하이라이트를 넓히는 몫(light-model ggxKey): α² += (반지름/2)²
  const float LR2 = ${f((light.radius / 2) * (light.radius / 2))};
  const float FRONT = ${f(SHELF_FRONT)};
  const float DEPTH = ${f(SHELF_DEPTH)};
  const float THICK = ${f(SHELF_THICK)};
  const float X0 = ${f(SHELF_X0)};
  const float X1 = ${f(SHELF_X1)};
  const int ENV_COLS = ${ENV_COLS};
  const float FARV = ${f(FAR)};
  // 둘레 면 밝기(선형 RGB: 반사율 × 받는 빛)와 속지 반사율(되비침), 속지 색(그림이 칠하는 색)
  const float3 RADF = ${c3(RAD.floor)};
  const float3 RADU = ${c3(RAD.under)};
  const float3 RADW = ${c3(RAD.wall)};
  const float3 PAPER = ${c3(ALBEDO.paper)};
  const float3 PAPER_COLOR = ${c3(DESIGN.paper)};
  const float EDGER = ${f(EDGE_R)};
  const float IG = ${f(1 / GAMMA)};
  const float LOSS_G0 = ${f(LOSS_G0)};
  const float LOSS_RP = ${f(LOSS_RP)};
  const float LOSS_RN = ${f(LOSS_RN)};
  // 하늘 가림 그림 값 ↔ 가림(면이 받는 하늘 빛 sky, lossEncode·lossDecode)
  float3 lossDec(float3 g, float3 sky) {
    float3 a = (g - LOSS_G0) / (1.0 - LOSS_G0);
    float3 b = (LOSS_G0 - g) / LOSS_G0;
    return sky - mix(-LOSS_RN * b * b, LOSS_RP * a * a, step(LOSS_G0, g));
  }
  float3 lossEnc(float3 L, float3 sky) {
    float3 R = sky - L;
    float3 pos = LOSS_G0 + (1.0 - LOSS_G0) * sqrt(clamp(R / LOSS_RP, 0.0, 1.0));
    float3 neg = LOSS_G0 - LOSS_G0 * sqrt(clamp(-R / LOSS_RN, 0.0, 1.0));
    return mix(neg, pos, step(0.0, R));
  }
  const float HORIZON = 1e-4;

  // 빛 색(light-model SKY_C 방 확산광, KEY_C 창빛)
  const float3 SKYC = ${c3(SKY_C)};
  const float3 KEYC = ${c3(KEY_C)};
  float3 skyRad(float3 w) { return SKYC * (AMB + 1.5 * SKYUP * w.y); }
  // 면이 하늘(방)에서 받는 빛
  float3 skyIrr(float3 n) { return SKYC * (AMB + SKYUP * n.y); }
  float3 irr(float3 n) { return skyIrr(n) + KEYC * (DIFF * max(0.0, dot(n, LU))); }
  // 하늘 앞의 면(F, M)이 가린 하늘 빛
  float3 skyOf(float4 q) { return SKYC * (AMB * q.x + 1.5 * SKYUP * q.z); }

  bool inDepth(float z) { return z >= -FRONT && z <= DEPTH; }
  // 판이 창빛 원반을 가리는 몫: 판 앞 모서리로 자른 활꼴 넓이 비율
  float segment(float u) {
    if (u <= -1.0) return 1.0;
    if (u >= 1.0) return 0.0;
    return (acos(u) - u * sqrt(1.0 - u * u)) / PI;
  }
  // 위 판 앞 모서리 위쪽 활꼴 + 아래 판 앞 모서리 아래쪽 활꼴(light-model plankKeyBlocked)
  float plankKeyOf(float3 p) {
    if (env.x < 0.5) return 0.0;
    float k = 0.0;
    if (env.z < FARV) {
      float d = env.z - p.y;
      k += d <= 0.0 ? 1.0 : segment((atan(d, max(0.001, p.z + FRONT)) - LELEV) / LRAD);
    }
    if (env.y > -FARV) {
      float h = p.y - env.y;
      k += h <= 0.0 ? 0.0 : segment((LELEV + atan(h, max(0.001, p.z + FRONT))) / LRAD);
    }
    return min(1.0, k);
  }
  // 가림이 없을 때 받는 빛(light-model openE)
  float3 openE(float3 p, float3 n) { return skyIrr(n) + KEYC * (DIFF * max(0.0, dot(n, LU)) * (1.0 - plankKeyOf(p))); }
  // 점 p에서 방향 w로 처음 보이는 둘레 면(판 윗면, 위 판 아랫면, 그 사이 벽)의 거리와 밝기 RGB, 없으면 하늘(light-model envHit).
  // 판은 가림 계산에서 가로로 끝없이 이어진다
  float4 envHit(float3 p, float3 w) {
    float4 hit = float4(1e9, skyRad(w));
    if (env.x < 0.5) return hit;
    if (w.y < -1e-6 && env.y > -FARV) {
      float t = (env.y - p.y) / w.y;
      if (t > 0.0 && inDepth(p.z + w.z * t)) hit = float4(t, RADF);
    }
    if (w.y > 1e-6 && env.z < FARV) {
      float t = (env.z - p.y) / w.y;
      if (t > 0.0 && t < hit.x && inDepth(p.z + w.z * t)) hit = float4(t, RADU);
    }
    if (w.z > 1e-6) {
      float t = (DEPTH - p.z) / w.z;
      float y = p.y + w.y * t;
      if (t > 0.0 && t < hit.x && y >= env.y && y <= env.z) hit = float4(t, RADW);
    }
    return hit;
  }
`;
}

// 볼록 다각형 잘라 내기와 (F, M) 적분(하늘 가림 계산 공통)
function polyCode() {
  return `
  // ---------- 볼록 다각형(받는 점 기준 꼭짓점 배열 v, 개수 cnt) ----------
  void push(inout float3 o[${NV}], inout int oc, float3 x) {
    ${Array.from({ length: NV }, (_, i) => `${i ? 'else ' : ''}if (oc == ${i}) o[${i}] = x;`).join(' ')}
    oc++;
  }
  // x·w ≥ off 쪽만 남긴다(서덜랜드–호지먼)
  void clipPoly(inout float3 v[${NV}], inout int cnt, float3 w, float off) {
    float3 o[${NV}];
    for (int k = 0; k < ${NV}; k++) o[k] = float3(0.0);
    int oc = 0;
    float3 a = v[0];
    for (int k = 0; k < ${NV}; k++) { if (k == cnt - 1) a = v[k]; }
    for (int k = 0; k < ${NV}; k++) {
      if (k >= cnt) break;
      float3 b = v[k];
      float da = dot(a, w) - off;
      float db = dot(b, w) - off;
      if (db >= 0.0) {
        if (da < 0.0) push(o, oc, a + (b - a) * (da / (da - db)));
        push(o, oc, b);
      } else if (da >= 0.0) {
        push(o, oc, a + (b - a) * (da / (da - db)));
      }
      a = b;
    }
    for (int k = 0; k < ${NV}; k++) v[k] = o[k];
    cnt = oc;
  }
  // 반공간 x·w ≥ 0 안(1), 밖(−1), 걸침(0)
  float sideOf(float3 v[${NV}], int cnt, float3 w) {
    bool pos = false;
    bool neg = false;
    for (int k = 0; k < ${NV}; k++) {
      if (k >= cnt) break;
      float d = dot(v[k], w);
      if (d > 1e-9) pos = true;
      else if (d < -1e-9) neg = true;
    }
    return pos && neg ? 0.0 : (neg ? -1.0 : 1.0);
  }
  // (F, M): F = (1/π)∫cosθ dω, M = (1/π)∫ω cosθ dω (light-model moments)
  float4 moments(float3 v[${NV}], int cnt, float3 n) {
    if (cnt < 3) return float4(0.0);
    float3 a = v[0];
    for (int k = 0; k < ${NV}; k++) { if (k == cnt - 1) a = v[k]; }
    float3 u0 = normalize(a);
    float fsum = 0.0;
    float turn = 0.0;
    float3 S = float3(0.0);
    float3 mFirst = float3(0.0);
    float3 mPrev = float3(0.0);
    float edges = 0.0;
    for (int k = 0; k < ${NV}; k++) {
      if (k >= cnt) break;
      float3 u1 = normalize(v[k]);
      float c = clamp(dot(u0, u1), -1.0, 1.0);
      float3 cr = cross(u0, u1);
      float sn = length(cr);
      if (sn > 1e-7) {
        float th = atan(sn, c);
        float3 m = cr / sn;
        fsum += th * dot(m, n);
        float3 W = u0 * sn + (u1 - c * u0) * ((1.0 - c) / sn);
        S += m * dot(n, W) + W * dot(m, n);
        if (edges > 0.5) turn += acos(clamp(dot(mPrev, m), -1.0, 1.0));
        else mFirst = m;
        mPrev = m;
        edges += 1.0;
      }
      u0 = u1;
    }
    if (edges < 2.5) return float4(0.0);
    turn += acos(clamp(dot(mPrev, mFirst), -1.0, 1.0));
    float omega = max(0.0, 2.0 * PI - turn);
    float sg = fsum < 0.0 ? -1.0 : 1.0;
    float3 M = (n * omega / 3.0 + S * (sg / 6.0)) / PI;
    return float4(abs(fsum) / (2.0 * PI), M);
  }

`;
}

// 둘레가 가린 하늘(light-model envLoss). GPU 컴파일러는 함수를 모두 펼치므로 무거운 몸체는 한 번만 나오게 반복문으로 쓴다.
// grid: 빛 격자를 읽는 셰이더(굽기·격자 풀기, gridCode 뒤에 둔다). 둘레 면 밝기를 격자의 대표 점에서, 둘레 면을 가로 구간으로 나눠
function envCode(grid: boolean) {
  return `
  // 둘레 사각형 k(light-model envQuads): 0 벽(이 줄 높이), 1 판 윗면, 2 위 판 아랫면(판은 가로로 끝없이), 가로 xa ~ xb.
  // 면의 앞쪽(빛을 받는 쪽)에서만 보인다. 받는 점 p 기준 꼭짓점과 밝기, 없으면 false
  bool envQuad(int k, float3 p, float xa, float xb, out float3 a, out float3 b, out float3 c, out float3 d, out float3 rad) {
    float zf = -FRONT - p.z;
    float z = DEPTH - p.z;
    xa -= p.x;
    xb -= p.x;
    a = float3(0.0); b = float3(0.0); c = float3(0.0); d = float3(0.0); rad = float3(0.0);
    if (k == 0) {
      float y0 = max(env.y, -FARV) - p.y;
      float y1 = min(env.z, FARV) - p.y;
      if (z <= 0.0) return false;
      a = float3(xa, y0, z); b = float3(xb, y0, z); c = float3(xb, y1, z); d = float3(xa, y1, z);
      rad = RADW;
      return true;
    }
    bool top = k == 1;
    float Y = top ? env.y : env.z;
    if (top ? Y <= -FARV : Y >= FARV) return false;
    // 판 윗면은 그 위에서, 아랫면은 그 아래에서
    if (top ? p.y <= Y : p.y >= Y) return false;
    float y = Y - p.y;
    a = float3(xa, y, zf); b = float3(xb, y, zf); c = float3(xb, y, z); d = float3(xa, y, z);
    rad = top ? RADF : RADU;
    return true;
  }
  float3 envLoss(float3 p, float3 n) {
    ${grid ? 'clearCols();' : ''}
    if (env.x < 0.5) return float3(0.0);
    float3 loss = float3(0.0);
    ${grid ? 'int ncol = gridOn > 0.5 && gridNx > 1.5 ? ENV_COLS + 2 : 1;' : 'int ncol = 1;'}
    for (int k = 0; k < 3; k++) {
      for (int j = 0; j < ${grid ? 'ENV_COLS + 2' : '1'}; j++) {
        if (j >= ncol) break;
        float xa = j == 0 ? -FARV : X0 + (X1 - X0) * float(j - 1) / float(ENV_COLS);
        float xb = j == ncol - 1 ? FARV : X0 + (X1 - X0) * float(j) / float(ENV_COLS);
        float3 a; float3 b; float3 c; float3 d; float3 rad;
        if (envQuad(k, p, xa, xb, a, b, c, d, rad)) {
          float3 v[${NV}];
          for (int i = 0; i < ${NV}; i++) v[i] = float3(0.0);
          v[0] = a; v[1] = b; v[2] = c; v[3] = d;
          int cnt = 4;
          clipPoly(v, cnt, n, HORIZON);
          float4 q = moments(v, cnt, n);
          ${grid ? 'if (q.x > 0.0) { float3 r = envRad(k, p, q, rad); putCol(k * NCOL + j, r); loss += skyOf(q) - r * q.x; }' : 'if (q.x > 0.0) loss += skyOf(q) - rad * q.x;'}
        }
      }
    }
    return loss;
  }
`;
}

// 빛 격자 읽기(light-model envGridE·boxGridE·envRad): 굽기·격자 풀기 셰이더만. 상자 유니폼(boxUniforms) 뒤에 둔다
function gridCode() {
  return `
  uniform shader grid;      // 빛 격자 그림(GRID_SCALE), gridOn < 0.5면 읽지 않는다(가리개는 가림 없는 받는 빛: 격자 풀기 첫 번)
  uniform float gridOn;
  uniform float gridNx;     // 둘레 면 가로 칸 수(책이 없으면 1)
  const float GN = ${GRID_N}.0;
  const float ENY = ${ENV_NY}.0;
  const float GSCALE = ${f(GRID_SCALE)};
  const float ENVL = ${f(SHELF_FRONT + SHELF_DEPTH)};
  const float3 ALB_WALL = ${c3(ALBEDO.wall)};
  const float3 ALB_PLANK = ${c3(ALBEDO.plank)};
  float chebIndex(float t, float n) { return (n - 1.0) * acos(1.0 - 2.0 * clamp(t, 0.0, 1.0)) / PI; }
  // 블록 (bx, by)의 칸 좌표 (su, sv) 겹선형 값(칸 가운데 사이를 그림의 선형 읽기로)
  float3 gridAt(float bx, float by, float su, float sv, float nu, float nv) {
    return float3(grid.eval(float2(bx + clamp(su, 0.0, nu - 1.0) + 0.5, by + clamp(sv, 0.0, nv - 1.0) + 0.5)).rgb) * GSCALE;
  }
  // 둘레 면 which의 두 번째 방향 t(light-model envT)
  float envT(int which, float3 q) {
    if (which != 0) return (q.z + FRONT) / ENVL;
    if (env.y > -FARV && env.z < FARV) return (q.y - env.y) / (env.z - env.y);
    float h = env.y > -FARV ? q.y - env.y : env.z - q.y;
    return h / (ENVL + max(0.0, h));
  }
  float3 envGridE(int which, float3 q) {
    float su = gridNx < 1.5 ? 0.0 : (q.x - X0) / (X1 - X0) * (gridNx - 1.0);
    return gridAt(0.0, nBox * GN + float(which) * ENY, su, chebIndex(envT(which, q), ENY), gridNx, ENY);
  }
  // 둘레 면 which 평면 위, 받는 점 p에서 코사인 가중 평균 방향(q.yzw)이 닿는 점(나란하면 x = FARV 밖)
  float3 envRep(int which, float3 p, float4 q, out bool ok) {
    float3 nf = which == 0 ? float3(0.0, 0.0, -1.0) : (which == 1 ? float3(0.0, 1.0, 0.0) : float3(0.0, -1.0, 0.0));
    float3 O = which == 0 ? float3(0.0, 0.0, DEPTH) : float3(0.0, which == 1 ? env.y : env.z, 0.0);
    float den = dot(q.yzw, nf);
    ok = abs(den) >= 1e-12;
    return ok ? p + q.yzw * (dot(O - p, nf) / den) : p;
  }
  // 둘레 면 which의 밝기: 격자가 있으면 대표 점에서
  float3 envRad(int which, float3 p, float4 q, float3 fallback) {
    if (gridOn < 0.5) return fallback;
    bool ok;
    float3 X = envRep(which, p, q, ok);
    if (!ok) return fallback;
    return (which == 0 ? ALB_WALL : ALB_PLANK) * envGridE(which, X);
  }
  // 받는 점마다 둘레 면 구간 밝기(light-model envLossCols): 가리개 뒤에 가려진 부분도 같은 구간 밝기로 뺀다(둘레 면 몫과 정확히 상쇄)
  const int NCOL = ENV_COLS + 2;
  float3 colRad[3 * NCOL];
  bool colSet[3 * NCOL];
  void clearCols() { for (int i = 0; i < 3 * NCOL; i++) { colRad[i] = float3(0.0); colSet[i] = false; } }
  void putCol(int i, float3 v) { for (int k = 0; k < 3 * NCOL; k++) { if (k == i) { colRad[k] = v; colSet[k] = true; } } }
  int colOf(float x) {
    if (gridNx < 1.5) return 0;
    if (x < X0) return 0;
    if (x >= X1) return ENV_COLS + 1;
    return 1 + int(min(float(ENV_COLS - 1), floor((x - X0) / (X1 - X0) * float(ENV_COLS))));
  }
  // 가려진 부분(구역 which의 조각 q)의 밝기: 그 대표 점이 든 구간 밝기, 없으면 envRad
  float3 behindRad(int which, float3 p, float4 q, float3 fallback) {
    if (gridOn < 0.5) return fallback;
    bool ok;
    float3 X = envRep(which, p, q, ok);
    if (!ok) return fallback;
    int i = which * NCOL + colOf(X.x);
    for (int k = 0; k < 3 * NCOL; k++) { if (k == i && colSet[k]) return colRad[k]; }
    return (which == 0 ? ALB_WALL : ALB_PLANK) * envGridE(which, X);
  }
  // 상자 i(가운데 c, 면 위 두 축 au·av와 반 길이)의 면 f 위 점 X가 받는 빛
  float3 boxGridE(float i, float f, float3 c, float3 au, float hu, float3 av, float hv, float3 X) {
    float3 d = X - c;
    float su = chebIndex((dot(d, au) + hu) / (2.0 * hu), GN);
    float sv = chebIndex((dot(d, av) + hv) / (2.0 * hv), GN);
    return gridAt(f * GN, i * GN, su, sv, GN, GN);
  }
`;
}

// 책 상자 유니폼(굽기·격자 풀기 셰이더)
function boxUniforms() {
  return `
  uniform float4 box[${BOX_MAX * BOX_VEC}];
  uniform float nBox;
`;
}

// 책 상자가 가린 하늘(light-model boxLoss): 굽기·격자 풀기 셰이더만(gridCode 뒤). 상자 × 면 × 띠 × 구역을 반복문으로(몸체는 한 번씩)
function boxCode() {
  return `
  // ---------- 가리개 뒤에 보였을 것(light-model behindOf) ----------
  float3 edgePlane(float3 p, float ey, float ez) { return float3(0.0, -(ez - p.z), ey - p.y); }
  // 구역(반공간 둘의 교집합) 안의 몫. 다각형이 반공간 안에 통째로 있으면 자르지 않는다
  float4 sectorVF(float3 P[${NV}], int cnt, float3 n, float3 w0, float3 w1, float4 total) {
    float3 Q[${NV}];
    for (int k = 0; k < ${NV}; k++) Q[k] = P[k];
    int qc = cnt;
    bool cut = false;
    for (int j = 0; j < 2; j++) {
      float3 w = j == 0 ? w0 : w1;
      float sd = sideOf(Q, qc, w);
      if (sd < -0.5) return float4(0.0);
      if (sd < 0.5) {
        clipPoly(Q, qc, w, 0.0);
        cut = true;
        if (qc < 3) return float4(0.0);
      }
    }
    return cut ? moments(Q, qc, n) : total;
  }
  // 구역 셋: 판 윗면(앞·뒤 모서리 사이), 벽(아래·위 모서리 사이), 위 판 아랫면. 나머지는 하늘. 구역 밝기는 빛 격자의 대표 점에서
  float3 behindOf(float3 p, float3 n, float3 P[${NV}], int cnt, float4 total) {
    if (env.x < 0.5) return skyOf(total);
    bool hasF = env.y > -FARV;
    bool hasC = env.z < FARV;
    float3 FW = hasF ? edgePlane(p, env.y, DEPTH) : float3(0.0, 0.0, -1.0);
    float3 CW = hasC ? edgePlane(p, env.z, DEPTH) : float3(0.0, 0.0, 1.0);
    float4 rest = total;
    float3 sum = float3(0.0);
    for (int si = 0; si < 3; si++) {
      bool on = si == 0 ? hasF : (si == 1 ? true : hasC);
      if (on) {
        float3 w0 = si == 0 ? FW : (si == 1 ? CW : edgePlane(p, env.z, -FRONT));
        float3 w1 = si == 0 ? -edgePlane(p, env.y, -FRONT) : (si == 1 ? -FW : -CW);
        float4 q = sectorVF(P, cnt, n, w0, w1, total);
        if (q.x > 0.0) {
          // 구역 번호 → 둘레 면 번호(0 벽, 1 판 윗면, 2 위 판 아랫면)
          int which = si == 0 ? 1 : (si == 1 ? 0 : 2);
          sum += behindRad(which, p, q, si == 0 ? RADF : (si == 1 ? RADW : RADU)) * q.x;
          rest -= q;
        }
      }
    }
    return sum + skyOf(rest);
  }

  // ---------- 책 상자가 가린 하늘(light-model boxLoss) ----------
  // 면 위 사각형 r(u0, u1, v0, v1) 하나: 보이는 부분의 (뒤에 보였을 밝기 − 면 밝기). 면 밝기: 빛 격자가 있으면 대표 점에서(반사율 alb × 받는 빛),
  // 없으면 open(가림 없는 받는 빛). gi = (상자 번호, 면 번호 f), fc·nf: 면 가운데·바깥 법선, c·hu·hv: 상자 가운데·면 위 반 길이
  float3 stripLoss(float3 p, float3 n, float3 fc, float3 nf, float3 au, float hu, float3 av, float hv, float3 c, float4 r, float3 open, float3 alb, float2 gi) {
    if (r.y <= r.x || r.w <= r.z) return float3(0.0);
    float3 o = fc - p;
    float3 v[${NV}];
    for (int k = 0; k < ${NV}; k++) v[k] = float3(0.0);
    v[0] = o + au * r.x + av * r.z;
    v[1] = o + au * r.y + av * r.z;
    v[2] = o + au * r.y + av * r.w;
    v[3] = o + au * r.x + av * r.w;
    int cnt = 4;
    clipPoly(v, cnt, n, HORIZON);
    float4 q = moments(v, cnt, n);
    if (q.x <= 0.0) return float3(0.0);
    float3 rad = open;
    float den = dot(q.yzw, nf);
    if (gridOn > 0.5 && abs(den) > 1e-12) rad = alb * boxGridE(gi.x, gi.y, c, au, hu, av, hv, p + q.yzw * (dot(o, nf) / den));
    return behindOf(p, n, v, cnt, q) - q.x * rad;
  }
  // 축 k 방향 s 면의 반사율(light-model faceAlbedo): 표지·책등 = 장정(tone), 머리·꼬리·책배 = 장정과 속지를 속지 넓이 비(fr.x 머리, fr.y 책배)로
  float3 faceAlbedo(float3 tone, float2 fr, float k, float s) { return k < 0.5 ? tone : (k < 1.5 ? mix(tone, PAPER, fr.x) : (s < 0.0 ? tone : mix(tone, PAPER, fr.y))); }
  // 상자 bi의 면(축 a, 반 길이 h, 면 번호 k) 하나. 마주 보는 이웃 면(덮개)이 가리는 부분은 뺀 띠 넷으로
  float3 faceLoss(float3 p, float3 n, float bi, float3 c, float3 a, float h, float3 au, float hu, float3 av, float hv, float3 tone, float2 fr, float k, float4 cc, float4 r0, float4 r1) {
    float dk = dot(p - c, a);
    if (abs(dk) <= h) return float3(0.0);
    float s = dk > 0.0 ? 1.0 : -1.0;
    float code = k + (s > 0.0 ? 3.0 : 0.0);
    float4 R = float4(-hu, hu, -hv, hv);
    float4 E = float4(0.0, -1.0, 0.0, -1.0);
    float4 S0 = R;
    float4 S1 = E;
    float4 S2 = E;
    float4 S3 = E;
    float g = -1.0;
    float4 cr = R;
    if (abs(cc.x - code) < 0.5) { g = cc.y; cr = r0; }
    else if (abs(cc.z - code) < 0.5) { g = cc.w; cr = r1; }
    float D = s * dk - h;
    if (g >= 0.0 && D > g) {
      float m = D / (D - g);
      float pu = dot(p - c, au);
      float pv = dot(p - c, av);
      float u0 = max(R.x, pu + (cr.x - pu) * m);
      float u1 = min(R.y, pu + (cr.y - pu) * m);
      float v0 = max(R.z, pv + (cr.z - pv) * m);
      float v1 = min(R.w, pv + (cr.w - pv) * m);
      if (u1 > u0 && v1 > v0) {
        S0 = u0 > R.x ? float4(R.x, u0, R.z, R.w) : E;
        S1 = u1 < R.y ? float4(u1, R.y, R.z, R.w) : E;
        S2 = v0 > R.z ? float4(u0, u1, R.z, v0) : E;
        S3 = v1 < R.w ? float4(u0, u1, v1, R.w) : E;
      }
    }
    float3 nf = a * s;
    float3 fc = c + nf * h;
    float3 alb = faceAlbedo(tone, fr, k, s);
    float3 open = alb * irr(nf);
    float3 loss = float3(0.0);
    for (int j = 0; j < 4; j++) loss += stripLoss(p, n, fc, nf, au, hu, av, hv, c, j == 0 ? S0 : (j == 1 ? S1 : (j == 2 ? S2 : S3)), open, alb, float2(bi, code));
    return loss;
  }
  // 상자들이 가린 하늘. 뺄 상자: self(받는 점의 책), skipA·skipB(격자점을 덮은 책), 없으면 −1
  float3 boxesLoss(float3 p, float3 n, float self, float skipA, float skipB) {
    float3 loss = float3(0.0);
    for (int i = 0; i < ${BOX_MAX}; i++) {
      if (float(i) >= nBox) break;
      float fi = float(i);
      if (abs(fi - self) > 0.5 && abs(fi - skipA) > 0.5 && abs(fi - skipB) > 0.5) {
        float4 b0 = box[i * ${BOX_VEC}];
        float4 b1 = box[i * ${BOX_VEC} + 1];
        float4 b2 = box[i * ${BOX_VEC} + 2];
        float4 b3 = box[i * ${BOX_VEC} + 3];
        float4 cc = box[i * ${BOX_VEC} + 4];
        float4 r0 = box[i * ${BOX_VEC} + 5];
        float4 r1 = box[i * ${BOX_VEC} + 6];
        float4 b7 = box[i * ${BOX_VEC} + 7];
        float3 tone = float3(b0.w, b7.xy);
        float2 fr = b7.zw;
        // 받는 면 평면 뒤에 통째로 있는 상자는 보이지 않는다
        float front = dot(b0.xyz - p, n) + b1.w * abs(dot(b1.xyz, n)) + b2.w * abs(dot(b2.xyz, n)) + b3.w * abs(dot(b3.xyz, n));
        if (front > 0.0) {
          // 면 축 k와 그 면 위의 두 축(k + 1, k + 2)
          for (int k = 0; k < 3; k++) {
            float4 A = k == 0 ? b1 : (k == 1 ? b2 : b3);
            float4 U = k == 0 ? b2 : (k == 1 ? b3 : b1);
            float4 V = k == 0 ? b3 : (k == 1 ? b1 : b2);
            loss += faceLoss(p, n, fi, b0.xyz, A.xyz, A.w, U.xyz, U.w, V.xyz, V.w, tone, fr, float(k), cc, r0, r1);
          }
        }
      }
    }
    return loss;
  }
`;
}

// 하늘 가림 굽기: 그림 칸 p(칸 가운데)의 줄 공간 점 O + p.x·Ux + p.y·Vy, 면 법선 tN에서. 출력 채널마다 lossEncode + 디더
export function bakeSource() {
  return `
  uniform float3 O;
  uniform float3 Ux;
  uniform float3 Vy;
  uniform float3 tN;
  uniform float4 bandLo;    // 그린 판 끝 너머 아래 판 두께 높이 띠(light-model bandOf): 띠 가운데 빛(rgb), 띠가 있으면 w = 1
  uniform float3 bandLoFar; // 그 띠의 건너편 경계 빛
  uniform float4 bandHi;    // 위 판 두께 높이 띠
  uniform float3 bandHiFar;
  uniform float selfIdx;    // 이 면의 책(상자 목록에서 뺀다), 없으면 −1
${header()}
${polyCode()}
${boxUniforms()}
${gridCode()}
${envCode(true)}
${boxCode()}
  half4 main(float2 p) {
    float3 P = O + p.x * Ux + p.y * Vy;
    // 판 두께 높이의 벽 점(light-model bakeLoss): 이 줄 쪽 경계 점에서 계산해 띠 가운데 빛, 건너편 경계 빛과 높이로 잇는다
    bool wall = env.x > 0.5 && tN.z < -0.5 && P.z >= DEPTH - 1e-3;
    bool lo = wall && bandLo.w > 0.5 && env.y > -FARV && P.y < env.y && P.y > env.y - THICK;
    bool hi = wall && bandHi.w > 0.5 && env.z < FARV && P.y > env.z && P.y < env.z + THICK;
    float3 Q = lo ? float3(P.x, env.y + ${f(TOUCH)}, P.z) : (hi ? float3(P.x, env.z - ${f(TOUCH)}, P.z) : P);
    // 둘레 먼저(구간 밝기를 채운다), 그다음 책 상자
    float3 L = envLoss(Q, tN);
    L += boxesLoss(Q, tN, selfIdx, -1.0, -1.0);
    if (lo || hi) {
      float t = min(1.0, abs(P.y - Q.y) / THICK);
      float3 mid = lo ? bandLo.rgb : bandHi.rgb;
      float3 E = t <= 0.5 ? mix(openE(Q, tN) - L, mid, 2.0 * t) : mix(mid, lo ? bandLoFar : bandHiFar, 2.0 * t - 1.0);
      L = openE(P, tN) - E;
    }
    float3 g = lossEnc(L, skyIrr(tN));
    // 디더: 칸마다 다른 −½~½ 단계(8비트로 담을 때 띠 대신 고른 잡음)
    float3 q = fract(float3(floor(p).x, floor(p).y, floor(p).x) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    float h = fract((q.x + q.y) * q.z) - 0.5;
    return half4(half3(clamp(g + h / 255.0, 0.0, 1.0)), 1.0);
  }
`;
}

// 빛 격자 풀기 한 번(light-model solveGrid의 한 되풀이, nodeE): 그림 칸 하나 = 격자점 하나(GRID_SCALE로 받는 빛).
// 지난 격자(grid, gridOn)로 가리개 면 밝기를 읽는다(첫 번은 가림 없는 받는 빛)
export function gridSource() {
  return `
${header()}
${polyCode()}
${boxUniforms()}
${gridCode()}
${envCode(true)}
${boxCode()}
  const float TOUCH = ${f(TOUCH)};
  // 면 가장자리 점은 면 안으로 TOUCH 들인다(light-model inset)
  float inset(float t, float len) {
    float e = min(0.5, TOUCH / max(len, 1e-9));
    return clamp(t, e, 1.0 - e);
  }
  float chebT(float i, float n) { return n < 1.5 ? 0.0 : (1.0 - cos(PI * i / (n - 1.0))) / 2.0; }
  bool insideBox(float3 q, float3 c, float4 A, float4 B, float4 C) {
    float3 d = q - c;
    return abs(dot(d, A.xyz)) < A.w && abs(dot(d, B.xyz)) < B.w && abs(dot(d, C.xyz)) < C.w;
  }
  // 점 p에서 방향 w로 가는 광선이 상자에 닿는가
  bool rayHits(float3 p, float3 w, float3 c, float4 A, float4 B, float4 C) {
    float3 o = p - c;
    float3 ol = float3(dot(o, A.xyz), dot(o, B.xyz), dot(o, C.xyz));
    float3 wl = float3(dot(w, A.xyz), dot(w, B.xyz), dot(w, C.xyz));
    float3 h = float3(A.w, B.w, C.w);
    float3 inv = 1.0 / (abs(wl) + 1e-12) * sign(wl + 1e-15);
    float3 ta = (-h - ol) * inv;
    float3 tb = (h - ol) * inv;
    float3 mn = min(ta, tb);
    float3 mx = max(ta, tb);
    return max(1e-6, max(mn.x, max(mn.y, mn.z))) <= min(mx.x, min(mx.y, mx.z));
  }
  // 방향 w로 창빛이 책(제 상자·덮은 책 빼고)에 막히지 않으면 1
  float keyFree(float3 P, float3 w, float self, float skipA, float skipB) {
    for (int i = 0; i < ${BOX_MAX}; i++) {
      if (float(i) >= nBox) break;
      float fi = float(i);
      if (abs(fi - self) > 0.5 && abs(fi - skipA) > 0.5 && abs(fi - skipB) > 0.5 && rayHits(P, w, box[i * ${BOX_VEC}].xyz, box[i * ${BOX_VEC} + 1], box[i * ${BOX_VEC} + 2], box[i * ${BOX_VEC} + 3])) return 0.0;
    }
    return 1.0;
  }
  half4 main(float2 pc) {
    float ix = floor(pc.x);
    float iy = floor(pc.y);
    float3 P = float3(0.0);
    float3 n = float3(0.0, 0.0, -1.0);
    float self = -1.0;
    bool absent = false;
    if (iy < nBox * GN) {
      // 상자 bi의 면 f, 칸 (a, b)
      float bi = floor(iy / GN);
      float f = floor(ix / GN);
      float a = ix - f * GN;
      float b = iy - bi * GN;
      float k = f < 3.0 ? f : f - 3.0;
      float s = f < 3.0 ? -1.0 : 1.0;
      self = bi;
      for (int i = 0; i < ${BOX_MAX}; i++) {
        if (float(i) == bi) {
          float4 b0 = box[i * ${BOX_VEC}];
          float4 b1 = box[i * ${BOX_VEC} + 1];
          float4 b2 = box[i * ${BOX_VEC} + 2];
          float4 b3 = box[i * ${BOX_VEC} + 3];
          float4 A = k < 0.5 ? b1 : (k < 1.5 ? b2 : b3);
          float4 U = k < 0.5 ? b2 : (k < 1.5 ? b3 : b1);
          float4 V = k < 0.5 ? b3 : (k < 1.5 ? b1 : b2);
          float u = -U.w + 2.0 * U.w * inset(chebT(a, GN), 2.0 * U.w);
          float v = -V.w + 2.0 * V.w * inset(chebT(b, GN), 2.0 * V.w);
          n = A.xyz * s;
          P = b0.xyz + n * A.w + U.xyz * u + V.xyz * v;
        }
      }
    } else {
      // 둘레 면 which, 칸 (a, b)
      float r = iy - nBox * GN;
      int which = int(floor(r / ENY));
      float a = ix;
      float b = r - float(which) * ENY;
      float x = gridNx < 1.5 ? (X0 + X1) / 2.0 : X0 + (X1 - X0) * a / (gridNx - 1.0);
      absent = a >= gridNx || (which == 1 && env.y <= -FARV) || (which == 2 && env.z >= FARV);
      if (which == 0) {
        bool closed = env.y > -FARV && env.z < FARV;
        float t = inset(chebT(b, ENY), closed ? env.z - env.y : ENVL);
        float hgt = t >= 1.0 ? FARV : ENVL * t / (1.0 - t);
        float y = closed ? env.y + (env.z - env.y) * t : (env.y > -FARV ? env.y + hgt : env.z - hgt);
        P = float3(x, y, DEPTH);
        n = float3(0.0, 0.0, -1.0);
      } else {
        float t = inset(chebT(b, ENY), ENVL);
        P = float3(x, which == 1 ? env.y : env.z, -FRONT + ENVL * t);
        n = float3(0.0, which == 1 ? 1.0 : -1.0, 0.0);
      }
    }
    float3 q = P + n * TOUCH;
    // 판 속·벽 너머(어디서도 보이지 않는다)
    bool shelf = q.z > DEPTH || (inDepth(q.z) && ((env.y > -FARV && q.y < env.y && q.y > env.y - THICK) || (env.z < FARV && q.y > env.z && q.y < env.z + THICK)));
    if (absent || shelf) return half4(0.0, 0.0, 0.0, 1.0);
    // 덮은 책(많아야 둘)은 뺀다: 덮은 책이 없었다면 받았을 빛
    float skipA = -1.0;
    float skipB = -1.0;
    for (int i = 0; i < ${BOX_MAX}; i++) {
      if (float(i) >= nBox) break;
      if (abs(float(i) - self) > 0.5 && insideBox(q, box[i * ${BOX_VEC}].xyz, box[i * ${BOX_VEC} + 1], box[i * ${BOX_VEC} + 2], box[i * ${BOX_VEC} + 3])) {
        if (skipA < 0.0) skipA = float(i); else skipB = float(i);
      }
    }
    float nl = dot(n, LU);
    float key = 0.0;
    if (nl > 0.0) {
      // 판은 원반을 자른 활꼴, 책은 원반 위 방향들(light-model KEY_DIRS) 가운데 막힌 몫
      float kfree = ${KEY_DIRS.map((w) => `keyFree(P, ${v3(w)}, self, skipA, skipB)`).join(' + ')};
      key = DIFF * nl * (1.0 - plankKeyOf(P)) * kfree / ${f(KEY_DIRS.length)};
    }
    float3 lossE = envLoss(P, n);
    float3 E = max(float3(0.0), skyIrr(n) + KEYC * key - lossE - boxesLoss(P, n, self, skipA, skipB));
    return half4(half3(clamp(E / GSCALE, 0.0, 1.0)), 1.0);
  }
`;
}

// 화소 빛(하늘·창빛 직접 몫 − 하늘 가림, 반사광)을 곱하기·닷지 값으로(두 그리는 셰이더 공통). cam4 유니폼(눈)이 있어야 한다
// mode: 0 곱하기 비, 1 컬러 닷지 값, 2 두 겹을 합친 이득 g = m / (1 − s)(재질 색 × g, 1에서 자른다: 단색 재질을 한 번에 칠할 때)
// 재질 무늬(domain/surface-pattern matSample과 같은 식): 면 좌표 uv(DU), 화소가 덮는 면 길이 fp = (fu, fv)(DU).
// 반환: (미세 높이 기울기 su, sv, 반사율 배수 f, 거칠기 r). 화소 2개보다 작은 무늬는 평균으로 줄이고 그 높이 몫은 거칠기에 더한다(Toksvig)
function materialCode() {
  return `
  float hash12(float2 p) {
    float3 p3 = fract(float3(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float3 vnoise(float2 x) {
    float2 i = floor(x);
    float2 fr = x - i;
    float2 w = fr * fr * (3.0 - 2.0 * fr);
    float2 dw = 6.0 * fr * (1.0 - fr);
    float a = hash12(i) * 2.0 - 1.0;
    float b = hash12(i + float2(1.0, 0.0)) * 2.0 - 1.0;
    float c = hash12(i + float2(0.0, 1.0)) * 2.0 - 1.0;
    float d = hash12(i + float2(1.0, 1.0)) * 2.0 - 1.0;
    float k = a - b - c + d;
    return float3(a + (b - a) * w.x + (c - a) * w.y + k * w.x * w.y, dw.x * (b - a + k * w.y), dw.y * (c - a + k * w.x));
  }
  float seenOf(float size, float fp) { return smoothstep(0.0, 1.0, clamp((size / max(fp, 1e-9) - 2.0) / 2.0, 0.0, 1.0)); }
  float pulseInt(float x, float q) { return floor(x) * q + clamp(fract(x) - (1.0 - q), 0.0, q); }
  float pulseCover(float x, float q, float w) {
    if (w < 1e-6) return fract(x) >= 1.0 - q ? 1.0 : 0.0;
    return (pulseInt(x + w * 0.5, q) - pulseInt(x - w * 0.5, q)) / w;
  }
  float4 matSample(float2 uv, float2 fp, float2 mR, float4 mB, float4 mG, float2 mS) {
    float u = uv.x;
    float v = uv.y;
    float su = 0.0;
    float sv = 0.0;
    float seen = 0.0;
    if (mB.z > 0.0) {
      if (mB.w > 0.5) {
        float k = 2.0 * PI * mB.x;
        seen = seenOf(0.5 / mB.x, fp.x) * seenOf(0.5 / mB.y, fp.y);
        su = mB.z * cos(k * u) * sin(k * v) * seen;
        sv = mB.z * sin(k * u) * cos(k * v) * seen;
      } else {
        seen = seenOf(1.0 / mB.x, fp.x) * seenOf(1.0 / mB.y, fp.y);
        float3 g = vnoise(float2(u * mB.x, v * mB.y));
        su = mB.z * g.y * mB.x * seen;
        sv = mB.z * g.z * mB.y * seen;
      }
    }
    float a = mR.x * mR.x;
    float r = sqrt(sqrt(a * a + 2.0 * mR.y * mR.y * (1.0 - seen * seen)));
    float fm = max(fp.x, fp.y);
    float f = 1.0;
    float s1 = mS.x;
    float s2 = mS.y;
    if (mG.x > 0.5 && mG.x < 1.5) {
      f += mG.y * vnoise(float2(u, v) / s1).x * seenOf(s1, fm) + mG.z * vnoise(float2(u / s2 + 17.0, v / s2 + 31.0)).x * seenOf(s2, fm);
    } else if (mG.x > 1.5 && mG.x < 2.5) {
      float k = 2.0 * PI / s1;
      f += mG.y * cos(k * u) * cos(k * v) * seenOf(s1 * 0.5, fm) + mG.z * vnoise(float2(u / s2 + 17.0, v / s2 + 31.0)).x * seenOf(s2, fm);
    } else if (mG.x > 2.5 && mG.x < 3.5) {
      f += mG.y * (hash12(float2(floor(u / s1), 7.0)) * 2.0 - 1.0) * seenOf(s1, fp.x);
      float w = 1.5 * s1;
      float k0 = floor(u / s2);
      float cover = 0.0;
      for (int j = -1; j <= 1; j++) {
        float kk = k0 + float(j);
        float b = (kk + 0.5 + 0.35 * (hash12(float2(kk, 3.0)) * 2.0 - 1.0)) * s2;
        cover += max(0.0, min(b + w * 0.5, u + fp.x * 0.5) - max(b - w * 0.5, u - fp.x * 0.5));
      }
      f -= mG.z * (min(1.0, cover / max(fp.x, 1e-6)) - w / s2);
    } else if (mG.x > 3.5) {
      float warp = vnoise(float2(u / (40.0 * s1), v / (4.0 * s1) + 5.0)).x * 1.5;
      f -= mG.y * (pulseCover(v / s1 + warp, 0.25, fp.y / s1) - 0.25);
      f += mG.z * vnoise(float2(u / s2 + 11.0, v * 6.0 / s2)).x * seenOf(s2 / 6.0, fp.y);
    }
    return float4(su, sv, f, r);
  }
`;
}

function shadeCode(mode: 0 | 1 | 2) {
  return `
  const float DODGE = ${mode}.0;
  float plankKey(float3 p) { return keyOn < 0.5 ? 0.0 : plankKeyOf(p); }
  // 카메라: 노출과 필름형 톤 곡선(light-model tone·toneInv)
  const float EXPO = ${f(EXPOSURE)};
  const float TTOE = ${f(TONE.toe)};
  const float TK = ${f(TONE.k)};
  const float TSH = ${f(TONE.shoulder)};
  float toneF(float x) {
    if (x <= 0.0) return 0.0;
    if (x < TTOE) { float u = 1.0 - x / TTOE; return x - TK * x * u * u; }
    if (x <= TSH) return x;
    return 1.0 - (1.0 - TSH) * exp(-(x - TSH) / max(1e-6, 1.0 - TSH));
  }
  float toneInv(float y) {
    if (y <= 0.0) return 0.0;
    if (y < TTOE) {
      float x = y;
      for (int i = 0; i < 6; i++) {
        float u = 1.0 - x / TTOE;
        x -= (x - TK * x * u * u - y) / (1.0 - TK * u * u + 2.0 * TK * x * u / TTOE);
      }
      return x;
    }
    if (y <= TSH) return y;
    if (y >= 1.0) return FARV;
    return TSH - (1.0 - TSH) * log((1.0 - y) / max(1e-6, 1.0 - TSH));
  }
  float envBRDF(float nv, float rough) {
    float rx = 1.0 - rough;
    float ry = 0.0425 - 0.0275 * rough;
    float rz = 1.04 - 0.572 * rough;
    float rw = -0.04 + 0.022 * rough;
    float a004 = min(rx * rx, exp2(-9.28 * max(0.0, nv))) * rx + ry;
    return F0 * (-1.04 * a004 + rz) + (1.04 * a004 + rw);
  }
  float ggxKey(float3 n, float3 v, float rough) {
    float nl = dot(n, LU);
    float nv = dot(n, v);
    if (nl <= 0.0 || nv <= 0.0) return 0.0;
    float3 hh = normalize(v + LU);
    float nh = max(0.0, dot(n, hh));
    float vh = max(0.0, dot(v, hh));
    float a2 = rough * rough * rough * rough + LR2;
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float k = (rough + 1.0) * (rough + 1.0) / 8.0;
    float G = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
    float m = 1.0 - vh;
    float F = F0 + (1.0 - F0) * m * m * m * m * m;
    return D * G * F / (4.0 * nv * nl) * nl * PI;
  }
  // 원호 모서리: 모서리에서 거리 dist(반지름 r)인 곳의 법선 평면 성분
  float arc(float dist, float r) {
    return r > 0.0 ? clamp(1.0 - dist / r, 0.0, 1.0) : 0.0;
  }
  float slope(float t) { return t / sqrt(max(1e-4, 1.0 - t * t)); }
  // 점 P(법선 n, 재질 색 a, 하늘 가림 loss: 선형 RGB)의 빛. 눈 쪽 방향 v, eref: 그 재질의 대표 자리 빛. 채널마다 계산한다
  // 받는 빛 = 하늘·천장·창빛(위 판이 가린 창빛 몫 빼고) − 하늘 가림. 반사광 = 거울 방향의 둘레·하늘(이웃 책의 반사는 뺀다) + GGX 창빛
  // rough: 표면 거칠기(재질, 그리지 못한 미세 높이 몫 포함), alb: 반사율 결(배수, 평균 1),
  // kx: 책이 창빛 원반을 가리는 몫(위 판이 가리고 남은 빛에서, 벽 그림자 그림),
  // sref: 그 재질이 대표 자리에서 받는 반사광(장면 밝기, light-model SREF): 재질 색 a는 반사광까지 넣은 '보이는 색'이라 확산 몫은 toneInv(a) − sref
  half4 shade(float3 P, float3 n, float3 nf, float3 v, float3 loss, float3 a, float3 eref, float rough, float alb, float kx, float3 sref) {
    float kb = 1.0 - (1.0 - plankKey(P)) * (1.0 - kx);
    // 가림(loss)은 면 법선 nf에서 구운 값: 둥근 모서리·구멍 벽처럼 법선이 기운 곳은 면이 받는 빛의 비율로(light-model lightWithLoss)
    float3 e0 = skyIrr(n) + KEYC * (DIFF * max(0.0, dot(n, LU)) * (1.0 - kb));
    float3 e0f = skyIrr(nf) + KEYC * (DIFF * max(0.0, dot(nf, LU)) * (1.0 - kb));
    // 하늘 가림은 그 면이 받는 하늘 빛보다 클 수 없다(light-model lightWithLoss): 아주 좁은 틈에서 해석 값이 넘는 것은 겹친 가리개가 같은 하늘을
    // 두 번 센 오차라 하늘 색이다. 넘친 몫(하늘 빛에 대한 비)만큼 하늘 빛을 세 채널에서 똑같이 빼 되비친 빛의 채널 차이는 그대로 둔다
    float3 sky = skyIrr(nf);
    float3 ov = (loss - sky) / max(sky, float3(1e-4));
    float3 lossB = loss - max(0.0, max(ov.x, max(ov.y, ov.z))) * sky;
    float3 E = e0 * max(float3(0.0), e0f - lossB) / max(e0f, float3(1e-4));
    // 반사광도 둘레가 가린 만큼 가려진다(거친 면은 반사 방향이 넓어 하늘이 보이는 몫 = 확산 몫과 같다): 좁은 틈 안은 반사광도 없다
    float3 vis = clamp((sky - lossB) / max(sky, float3(1e-4)), 0.0, 1.0);
    float ks = envBRDF(max(0.0, dot(n, v)), rough);
    float3 r = E * (1.0 - ks) * alb / eref;
    // 화면 색 = tone(노출 × ((toneInv(a) − sref) × r + 반사광))(light-model toneTarget). 곱하기·닷지 두 겹으로 그 색이 되게:
    // 곱하기가 화면 색을 base까지 내리고 닷지가 target까지 올린다. base는 확산 몫(반사광 없이)이되, 8비트 화면 버퍼에서 닷지가 올릴 수 있게
    // target의 1/4보다 낮추지 않는다(확산 몫이 0인 채널은 곱하기에서 0이 되면 닷지가 반사광을 더하지 못한다)
    float3 am = max(a, float3(1e-4));
    float3 sa = max(float3(0.0), float3(toneInv(am.x), toneInv(am.y), toneInv(am.z)) - sref) * r * EXPO;
    float3 spec = (ks * envHit(P, reflect(-v, n)).yzw * vis + KEYC * (ggxKey(n, v, rough) * DIFF * (1.0 - kb))) / ECAM;
    float3 st = sa + spec * EXPO;
    float3 t0 = float3(toneF(sa.x), toneF(sa.y), toneF(sa.z));
    float3 target = float3(toneF(st.x), toneF(st.y), toneF(st.z));
    float3 base = min(am, max(t0, 0.25 * target));
    float3 m = pow(min(float3(1.0), base / am), float3(IG));
    if (DODGE < 0.5) return half4(half3(m), 1.0);
    float3 s = float3(0.0);
    for (int c = 0; c < 3; c++) {
      float b = c == 0 ? base.x : (c == 1 ? base.y : base.z);
      float t = c == 0 ? target.x : (c == 1 ? target.y : target.z);
      float sc = t > b && t > 0.0 ? 1.0 - pow(b / t, IG) : 0.0;
      if (c == 0) s.x = sc; else if (c == 1) s.y = sc; else s.z = sc;
    }
    // 한 번에 칠하기(DODGE 2): 곱하기·닷지 두 겹과 같은 이득
    if (DODGE > 1.5) return half4(half3(m / max(float3(1e-4), 1.0 - s)), 1.0);
    return half4(half3(s), 1.0);
  }
`;
}

// 평면(벽·판): 캔버스 px p → 평면 위 점 P = (O + p.x·Ux + p.y·Vy) / (Hw·(p, 1)), 법선은 판 모서리 둥글기까지.
// 하늘 가림은 구운 그림(tex: 캔버스 px로 읽히게 행렬을 붙인 것), 없으면(liveEnv) 둘레만 그 자리에서
// mode 2(단색 재질 base를 한 번에): 출력 = base × 이득(채널마다 1에서 자름). 곱하기·닷지 두 겹(대상 색 읽기)이 필요 없다
export function litSource(dodge: boolean | 'direct') {
  const mode = dodge === 'direct' ? 2 : dodge ? 1 : 0;
  return `
  uniform shader tex;
  uniform shader keyTex;    // 책이 이 면에서 창빛 원반을 가리는 몫(알파, 평면 좌표 그림: 그림 px = (P·kU, P·kV) + kO)
  ${mode === 2 ? 'uniform float3 base;     // 재질 색(감마 sRGB)' : ''}
  uniform float3 O;
  uniform float3 Ux;
  uniform float3 Vy;
  uniform float3 Hw;
  uniform float3 tN;        // 평면 바깥 법선
  uniform float4 bev0;      // 모서리 둥글기(평면 안에서 모서리 쪽 단위 벡터, 모서리의 그 축 좌표). 없으면 0
  uniform float4 bev1;
  uniform float4 cam4;      // 눈(x, y, 기준면 z, 거리): 눈 위치 = (x, y, z − 거리)
  uniform float keyOn;      // 판(위·아래)이 창빛을 가리는 몫을 넣을지
  uniform float3 albedo;    // 재질 색(선형 RGB, 닷지: 반사광을 감마 공간에 더할 때)
  uniform float3 eref;      // 그 재질의 대표 자리 빛(light-model EREF)
  uniform float3 sref;      // 그 재질의 대표 자리 반사광(light-model SREF)
  uniform float liveEnv;    // 1: 구운 값 대신 둘레가 가린 하늘을 그 자리에서
  uniform float3 kU;
  uniform float3 kV;
  uniform float2 kO;
  uniform float2 mR;        // 재질(domain/surface-pattern matUniforms): 거칠기·기울기 RMS, 미세 높이, 결, 결 크기, 무늬 자리 어긋남
  uniform float4 mB;
  uniform float4 mG;
  uniform float2 mS;
  uniform float2 mSeed;
${header()}
${polyCode()}
${envCode(false)}
${materialCode()}
${shadeCode(mode)}
  half4 main(float2 p) {
    float w = dot(Hw, float3(p, 1.0));
    float3 P = (O + p.x * Ux + p.y * Vy) / w;
    // 화소 한 칸이 평면에서 덮는 길이(사상의 미분): 재질 무늬를 화소 크기로 거른다
    float3 JX = (Ux - P * Hw.x) / w;
    float3 JY = (Vy - P * Hw.y) / w;
    float b0 = slope(arc(bev0.w - dot(P, bev0.xyz), EDGER));
    float b1 = slope(arc(bev1.w - dot(P, bev1.xyz), EDGER));
    float3 n = normalize(tN + bev0.xyz * b0 + bev1.xyz * b1);
    // 면 좌표: u = 판 길이 방향(x), v = 면 안의 다른 방향
    float3 Au = float3(1.0, 0.0, 0.0);
    float3 Av = normalize(cross(tN, Au));
    float2 fp = float2(max(abs(dot(JX, Au)), abs(dot(JY, Au))), max(abs(dot(JX, Av)), abs(dot(JY, Av))));
    float4 ms = matSample(float2(dot(P, Au), dot(P, Av)) + mSeed, fp, mR, mB, mG, mS);
    n = normalize(n - ms.x * Au - ms.y * Av);
    float3 loss = liveEnv > 0.5 ? envLoss(P, tN) : lossDec(float3(tex.eval(p).rgb), skyIrr(tN));
    half4 g = shade(P, n, tN, normalize(float3(cam4.x, cam4.y, cam4.z - cam4.w) - P), loss, albedo, eref, ms.w, ms.z, float(keyTex.eval(float2(dot(P, kU), dot(P, kV)) + kO).a), sref);
    ${mode === 2 ? 'return half4(half3(min(base * float3(g.rgb), float3(1.0))), 1.0);' : 'return g;'}
  }
`;
}

// 책 한 권(상자)을 화소마다 광선으로: 눈에서 캔버스 화소로 가는 광선이 처음 닿는 면(책등·표지·뒤표지·머리·꼬리·책배)과 그 점,
// 면의 법선(둥근 모서리·책등 곡면·제본 홈), 종이 단면 면은 속지가 들어간 구멍 안으로 이어 닿는 곳(속지 면 또는 판 안쪽 벽).
// 하늘 가림은 그 면의 구운 칸(rect, 줄 아틀라스 그림 px, 면 평면 좌표로 읽는다), 없으면 둘레만 그 자리에서.
// 면 좌표(book-parts lightPanel과 같은 틀): 가로 u, 세로 v(DU), 면 번호 0 책등 1 표지 2 뒤표지 3 머리 4 꼬리 5 책배
export function bookSource(dodge: boolean) {
  return `
  uniform shader tex;       // 줄 아틀라스(그림 px 그대로 읽는다)
  uniform shader keyTex;    // 이 책 면이 받는 창빛 그림자(다른 책이 창빛 원반을 가리는 몫, 알파): 면마다 칸(kRect)
  uniform float4 kRect[6];  // 면마다 그림자 칸: (칸 원점 x, y, 배율 px/DU, 있으면 1)
  uniform float4 cam4;      // 눈(x, y, 기준면 z, 거리). 거리 ≤ 0이면 사선 카메라(kx, ky = cam4.xy)
  uniform float3 pxa;       // 캔버스 px = 화면 점 × s + (tx, ty): (s, tx, ty)
  uniform float3 bO;        // 책 좌표 원점(줄 공간)과 축(단위): 책 좌표 (x 두께, y 높이, z 깊이)
  uniform float3 bX;
  uniform float3 bY;
  uniform float3 bZ;
  uniform float3 dims;      // T, H, W
  uniform float3 rig;       // 판 두께 bd, 책등 띠 sp, 속지가 들어간 깊이 sq(book-parts rigOf)
  uniform float4 rect[6];   // 면마다 아틀라스 칸 (0, 0) 자리와 칸 수(x, y, w, h). w ≤ 0이면 구운 값 없음
  uniform float keyOn;
  uniform float3 albedo;    // 장정 색(선형 RGB)
  uniform float3 erefB;     // 장정 재질의 대표 자리 빛·반사광(light-model bookEref·bookSref), 속지 단면의 대표 자리 반사광
  uniform float3 srefB;
  uniform float3 srefP;
  uniform float2 mR;        // 장정 재질(domain/surface-pattern matUniforms): 거칠기·기울기 RMS, 미세 높이, 결, 결 크기, 책마다 무늬 자리 어긋남
  uniform float4 mB;
  uniform float4 mG;
  uniform float2 mS;
  uniform float2 mSeed;
  uniform float2 pR;        // 속지 단면 재질(materials.pages, 같은 꼴)
  uniform float4 pB;
  uniform float4 pG;
  uniform float2 pS;
${header()}
${polyCode()}
${envCode(false)}
${materialCode()}
${shadeCode(dodge ? 1 : 0)}
  const float CURVE = ${f(SPINE_CURVE)};
  const float3 EREF_PAPER = ${c3(EREF.paper)};
  const float4 GRV = float4(${f(GROOVE.at)}, ${f(GROOVE.width)}, ${f(GROOVE.slope)}, 0.0);
  float3 toRow(float3 l) { return bX * l.x + bY * l.y + bZ * l.z; }

  half4 main(float2 p) {
    float3 E;
    float3 d;
    if (cam4.w > 0.0) {
      E = float3(cam4.x, cam4.y, cam4.z - cam4.w);
      d = float3((p.x - pxa.y) / pxa.x, -(p.y - pxa.z) / pxa.x, cam4.z) - E;
    } else {
      // 사선 카메라: 화면 점 (X, Y)는 x + z·kx = X, y + z·ky = Y인 선
      d = float3(-cam4.x, -cam4.y, 1.0);
      E = float3((p.x - pxa.y) / pxa.x, -(p.y - pxa.z) / pxa.x, 0.0) - d * ${f(FAR)};
    }
    float3 o = E - bO;
    float3 ol = float3(dot(o, bX), dot(o, bY), dot(o, bZ));
    float3 dl = float3(dot(d, bX), dot(d, bY), dot(d, bZ));
    float3 inv = 1.0 / (abs(dl) + 1e-12) * sign(dl + 1e-15);
    float3 ta = -ol * inv;
    float3 tb = (dims - ol) * inv;
    float3 mn = min(ta, tb);
    float3 mx = max(ta, tb);
    float t0 = max(mn.x, max(mn.y, mn.z));
    float t1 = min(mx.x, min(mx.y, mx.z));
    if (t0 > t1 || t1 <= 0.0) {
      // 윤곽 가장자리 화소(앤티에일리어싱으로 반쯤 덮인 칸)의 가운데가 상자를 살짝 비껴가면: 한 화소 반만큼 넓힌 상자에 닿은 점을 상자 면 위로
      // 당겨 그 화소가 덮는 가장자리 면의 빛으로 칠한다(빛을 바꾸지 않으면 빛 없는 재질 그림이 점선처럼 드러난다)
      float e = 1.5 / pxa.x;
      ta = (-e - ol) * inv;
      tb = (dims + e - ol) * inv;
      mn = min(ta, tb);
      mx = max(ta, tb);
      t0 = max(mn.x, max(mn.y, mn.z));
      t1 = min(mx.x, min(mx.y, mx.z));
      if (t0 > t1 || t1 <= 0.0) return half4(DODGE < 0.5 ? 1.0 : 0.0, DODGE < 0.5 ? 1.0 : 0.0, DODGE < 0.5 ? 1.0 : 0.0, 1.0);
    }
    float3 L = clamp(ol + dl * t0, float3(0.0), dims);
    float T = dims.x;
    float H = dims.y;
    float W = dims.z;
    // 들어간 면과 그 면 좌표(u, v), 면 크기, 바깥 법선·가로·세로 축(책 좌표)
    int fi = 0;
    float u = 0.0; float v = 0.0; float pw = 1.0; float ph = 1.0;
    float3 nl = float3(0.0, 0.0, -1.0); float3 ul = float3(1.0, 0.0, 0.0); float3 vl = float3(0.0, -1.0, 0.0);
    if (mn.x >= mn.y && mn.x >= mn.z) {
      if (dl.x < 0.0) { fi = 1; u = L.z; v = H - L.y; pw = W; ph = H; nl = float3(1.0, 0.0, 0.0); ul = float3(0.0, 0.0, 1.0); }
      else { fi = 2; u = W - L.z; v = H - L.y; pw = W; ph = H; nl = float3(-1.0, 0.0, 0.0); ul = float3(0.0, 0.0, -1.0); }
    } else if (mn.y >= mn.z) {
      fi = dl.y < 0.0 ? 3 : 4;
      u = L.x; v = L.z; pw = T; ph = W;
      nl = float3(0.0, dl.y < 0.0 ? 1.0 : -1.0, 0.0); ul = float3(1.0, 0.0, 0.0); vl = float3(0.0, 0.0, 1.0);
    } else {
      if (dl.z > 0.0) { fi = 0; u = L.x; v = H - L.y; pw = T; ph = H; }
      else { fi = 5; u = L.x; v = H - L.y; pw = T; ph = H; nl = float3(0.0, 0.0, 1.0); }
    }
    float3 a = albedo;
    float3 n = nl;
    float3 Lp = L;
    bool page = false;
    // 닿은 평면(법선 nh, 광선 매개변수 th)과 그 평면의 무늬 축(Au, Av)
    float th = t0;
    float3 nh = nl;
    float3 Au = ul;
    float3 Av = vl;
    if (fi < 3) {
      // 책 면: 둥근 모서리(반지름 EDGER, 면이 좁으면 그 절반), 책등 곡면, 표지·뒤표지 제본 홈
      float rx = min(pw / 2.0, EDGER);
      float ry = min(ph / 2.0, EDGER);
      float tx = arc(pw - u, rx) - arc(u, rx);
      float ty = arc(ph - v, ry) - arc(v, ry);
      float nz = sqrt(max(1e-4, 1.0 - tx * tx - ty * ty));
      float sx = tx / nz;
      if (fi == 0) sx += tan(CURVE * (u / pw * 2.0 - 1.0));
      else {
        float hd = ((fi == 1 ? u : pw - u) - GRV.x) / GRV.y;
        sx += (fi == 1 ? 1.0 : -1.0) * GRV.z * hd * exp(-hd * hd);
      }
      n = normalize(sx * ul + (ty / nz) * vl + nl);
    } else {
      // 종이 단면 면: 열린 칸(판·책등 띠 안쪽) 안이면 광선을 속지 쪽으로 이어 속지 면(깊이 sq) 또는 판 안쪽 벽에
      float u0 = rig.x;
      float u1 = T - rig.x;
      float v0 = fi == 5 ? 0.0 : rig.y;
      float v1 = fi == 5 ? H : W;
      // 판 끝 면(테두리)과 속지는 두께 방향 x를 가로로
      Au = float3(1.0, 0.0, 0.0);
      if (u >= u0 && u <= u1 && v >= v0 && v <= v1) {
        a = PAPER_COLOR;
        float down = -dot(dl, nl);
        float du = dot(dl, ul);
        float dv = dot(dl, vl);
        float tw = rig.z / max(down, 1e-9);
        float3 nw = nl;
        bool wall = false;
        if (du < 0.0) { float t = (u0 - u) / du; if (t < tw) { tw = t; nw = ul; wall = true; } }
        if (du > 0.0) { float t = (u1 - u) / du; if (t < tw) { tw = t; nw = -ul; wall = true; } }
        if (fi != 5 && dv < 0.0) { float t = (v0 - v) / dv; if (t < tw) { tw = t; nw = vl; wall = true; } }
        Lp = L + dl * tw;
        n = nw;
        th = t0 + tw;
        nh = nw;
        if (wall) {
          a = albedo;
          Au = normalize(cross(nw, nl));
          Av = nl;
        }
        page = !wall;
      }
    }
    // 화소 한 칸이 닿은 평면에서 덮는 길이(광선-평면 교차의 미분, 책 좌표): 재질 무늬를 화소 크기로 거른다
    float3 dpx = float3(bX.x, bY.x, bZ.x) / pxa.x;
    float3 dpy = -float3(bX.y, bY.y, bZ.y) / pxa.x;
    float tk = cam4.w > 0.0 ? th : 1.0;
    float dn = dot(nh, dl);
    float3 JX = tk * (dpx - dl * dot(nh, dpx) / dn);
    float3 JY = tk * (dpy - dl * dot(nh, dpy) / dn);
    float2 fp = float2(max(abs(dot(JX, Au)), abs(dot(JY, Au))), max(abs(dot(JX, Av)), abs(dot(JY, Av))));
    float2 uv = float2(dot(Lp, Au), dot(Lp, Av)) + mSeed;
    float4 ms = page ? matSample(uv, fp, pR, pB, pG, pS) : matSample(uv, fp, mR, mB, mG, mS);
    n = normalize(n - ms.x * Au - ms.y * Av);
    float3 P = bO + toRow(Lp);
    float3 nw3 = normalize(toRow(n));
    // 하늘 가림: 그 면의 구운 칸(면 평면 점의 칸 좌표), 없으면 둘레만 그 자리에서(면 법선)
    float4 R = float4(0.0);
    for (int i = 0; i < 6; i++) { if (i == fi) R = rect[i]; }
    float3 loss = R.z > 0.0 ? lossDec(float3(tex.eval(float2(R.x + u / pw * R.z, R.y + v / ph * R.w)).rgb), skyIrr(toRow(nl))) : envLoss(bO + toRow(L), toRow(nl));
    float3 view = cam4.w > 0.0 ? normalize(E - P) : normalize(-d);
    float4 K = float4(0.0);
    for (int i = 0; i < 6; i++) { if (i == fi) K = kRect[i]; }
    float kx = K.w > 0.5 ? float(keyTex.eval(K.xy + float2(u, v) * K.z).a) : 0.0;
    return shade(P, nw3, normalize(toRow(nl)), view, loss, a, page ? EREF_PAPER : erefB, ms.w, ms.z, kx, page ? srefP : srefB);
  }
`;
}

// 갈피(종이 탭): 책 머리에서 위로 나온 평평한 종이(책등과 같은 법선 nrm). 탭 그림 좌표(뿌리가 원점, px, 아래로 +)의 점을
// 탭 평면 점(뿌리 root + 가로 axR · x + 위 axU · 높이)으로 옮겨 화소마다 같은 빛(재질 무늬·반사광)을 계산한다.
// 하늘 가림(loss)은 탭 가운데 한 점의 값(탭은 작아 가림이 거의 고르다)
export function tabSource(dodge: boolean) {
  return `
  uniform float3 pxa;       // 캔버스 배율 (s, 0, 0)
  uniform float3 root;      // 뿌리(줄 공간)
  uniform float3 axR;       // 탭 가로(책 두께 방향)·위(책 높이 방향)·법선
  uniform float3 axU;
  uniform float3 nrm;
  uniform float3 loss;
  uniform float4 cam4;
  uniform float keyOn;
  uniform float3 albedo;
  uniform float3 eref;
  uniform float3 sref;
  uniform float2 mR;
  uniform float4 mB;
  uniform float4 mG;
  uniform float2 mS;
  uniform float2 mSeed;
${header()}
${materialCode()}
${shadeCode(dodge ? 1 : 0)}
  half4 main(float2 p) {
    // 탭 좌표(DU): 가로 x, 아래로 y(그림 좌표 그대로: 셰이더는 그리는 Group의 좌표를 받는다)
    float2 l = p / pxa.x;
    float3 P = root + axR * l.x - axU * l.y;
    float fp = 1.0 / pxa.x;
    float4 ms = matSample(float2(l.x, -l.y) + mSeed, float2(fp, fp), mR, mB, mG, mS);
    float3 n = normalize(nrm - ms.x * axR - ms.y * axU);
    float3 view = cam4.w > 0.0 ? normalize(float3(cam4.x, cam4.y, cam4.z - cam4.w) - P) : float3(0.0, 0.0, -1.0);
    return shade(P, n, nrm, view, loss, albedo, eref, ms.w, ms.z, 0.0, sref);
  }
`;
}
