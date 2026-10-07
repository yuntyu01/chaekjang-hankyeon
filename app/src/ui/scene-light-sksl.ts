// 화소마다의 빛 셰이더 소스(SkSL). domain/light-model과 같은 식·같은 이름이다(그쪽 주석이 식의 출처).
// 순수 문자열이라 테스트가 CanvasKit으로 컴파일하고 같은 점의 값을 JS 모델과 비교한다(__tests__/scene-light-shader.test.ts).
// 두 가지:
//   bake: 하늘 가림(둘레·책 상자가 가린 하늘, 시점과 상관없다)을 면 좌표 그림에 굽는다. 무거운 몫은 모두 여기(책이 멈췄을 때만 돈다).
//   lit: 구운 그림(tex)을 읽고 나머지(하늘·창빛 직접 몫, 둥근 모서리 법선, 반사광)를 화소마다. 곱하기·컬러 닷지 두 가지로 컴파일한다.
import { EDGE_R, GROOVE, SPINE_CURVE } from '@/domain/book-parts';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from '@/domain/geometry';
import { ALBEDO, BOX_MAX, BOX_VEC, DESIGN, EREF, FAR, GAMMA, KEY_BASIS, KEY_SAMPLES, L_AZIM, L_ELEV, L_UNIT, RAD, type C3 } from '@/domain/light-model';
import type { Affine, Cam, Vec3 } from '@/domain/camera';
import { light, material } from '@/ui/lighting';

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
// 잘린 다각형 꼭짓점 최대 수: 사각형 4 + 반구 1 + 구역 평면 넷 4
const NV = 10;

// 하늘 가림 그림: 선형 RGB 채널마다 (가림 + LOSS_OFF) / LOSS_SCALE. 밝은 판이 되비춰 밝아지면 가림이 음수다.
// 그림 칸 값이 색 변환되지 않도록 굽는 표면은 화면 표면과 같은 색 공간이다(SceneLight bakeAtlas). 8비트 한 단계 = 받는 빛 약 0.6%
export const LOSS_OFF = 0.25;
export const LOSS_SCALE = 1.5;

// 상수·둘레(두 셰이더 공통). env: 둘레(있음, 판 윗면 높이, 위 판 아랫면 높이), 없는 판은 ∓FAR
function header() {
  return `
  uniform float3 env;
  uniform float2 env2;      // 이웃 줄(아래 줄 판 윗면, 위 줄 위 판 아랫면), 없으면 ∓FAR

  const float PI = 3.14159265;
  const float AMB = ${f(light.ambient)};
  const float SKYUP = ${f(light.skyUp)};
  const float DIFF = ${f(light.diffuse)};
  const float3 LU = ${v3(L_UNIT)};
  // 카메라 기준 빛(벽 대표 자리, 반사광을 화면 값으로)
  const float3 ECAM = ${c3(EREF.wall)};
  const float LELEV = ${f(L_ELEV)};
  const float LAZIM = ${f(L_AZIM)};
  const float LRAD = ${f(light.radius)};
  const float F0 = ${f(material.f0)};
  const float ROUGH = ${f(material.roughness)};
  const float X0 = ${f(SHELF_X0)};
  const float X1 = ${f(SHELF_X1)};
  const float FRONT = ${f(SHELF_FRONT)};
  const float DEPTH = ${f(SHELF_DEPTH)};
  const float THICK = ${f(SHELF_THICK)};
  const float FARV = ${f(FAR)};
  // 둘레 면 밝기(선형 RGB: 반사율 × 받는 빛)와 속지 반사율(되비침), 속지 색(그림이 칠하는 색)
  const float3 RADF = ${c3(RAD.floor)};
  const float3 RADU = ${c3(RAD.under)};
  const float3 RADW = ${c3(RAD.wall)};
  const float3 RADL = ${c3(RAD.endL)};
  const float3 RADR = ${c3(RAD.endR)};
  const float3 PAPER = ${c3(ALBEDO.paper)};
  const float3 PAPER_COLOR = ${c3(DESIGN.paper)};
  const float EDGER = ${f(EDGE_R)};
  const float IG = ${f(1 / GAMMA)};
  const float LOSS_OFF = ${f(LOSS_OFF)};
  const float LOSS_SCALE = ${f(LOSS_SCALE)};
  const float HORIZON = 1e-4;

  float skyRad(float3 w) { return AMB + 1.5 * SKYUP * w.y; }
  float irr(float3 n) { return AMB + SKYUP * n.y + DIFF * max(0.0, dot(n, LU)); }
  // 하늘 앞의 면(F, M)이 가린 하늘 빛
  float skyOf(float4 q) { return AMB * q.x + 1.5 * SKYUP * q.z; }

  bool inPlank(float3 q) { return q.x >= X0 && q.x <= X1 && q.z >= -FRONT && q.z <= DEPTH; }
  // 한 줄 안(판 윗면 f, 위 판 아랫면 c, 그 사이 벽)에서 광선이 처음 닿는 곳(거리, 밝기 RGB)
  float4 rowHit(float3 p, float3 w, float f, float c, float4 hit) {
    if (w.y < -1e-6 && f > -FARV) {
      float t = (f - p.y) / w.y;
      if (t > 0.0 && t < hit.x && inPlank(p + w * t)) hit = float4(t, RADF);
    }
    if (w.y > 1e-6 && c < FARV) {
      float t = (c - p.y) / w.y;
      if (t > 0.0 && t < hit.x && inPlank(p + w * t)) hit = float4(t, RADU);
    }
    if (w.z > 1e-6) {
      float t = (DEPTH - p.z) / w.z;
      float y = p.y + w.y * t;
      if (t > 0.0 && t < hit.x && y >= f && y <= c) hit = float4(t, RADW);
    }
    return hit;
  }
  // 판 끝 너머에서 보이는 틈 g(0 아래 줄, 1 이 줄, 2 위 줄)의 (판 윗면, 위 판 아랫면), 없으면 x > y
  float2 gapOf(int g) {
    if (g == 1) return env.yz;
    if (g == 0) return env2.x > -FARV && env.y > -FARV ? float2(env2.x, env.y - THICK) : float2(1.0, 0.0);
    return env2.y < FARV && env.z < FARV ? float2(env.z + THICK, env2.y) : float2(1.0, 0.0);
  }
  // 판 상자 s(0 이 줄 판, 1 위 판, 2 아래 줄 판, 3 위 줄 위 판)의 (아래, 위) 높이, 없으면 x > y
  float2 slabOf(int s) {
    if (s == 0) return env.y > -FARV ? float2(env.y - THICK, env.y) : float2(1.0, 0.0);
    if (s == 1) return env.z < FARV ? float2(env.z, env.z + THICK) : float2(1.0, 0.0);
    if (s == 2) return env2.x > -FARV && env.y > -FARV ? float2(env2.x - THICK, env2.x) : float2(1.0, 0.0);
    return env2.y < FARV && env.z < FARV ? float2(env2.y, env2.y + THICK) : float2(1.0, 0.0);
  }
  // 점 p에서 방향 w로 처음 보이는 둘레 면(거리, 밝기 RGB). 없으면 하늘(light-model envHit)
  float4 envHit(float3 p, float3 w) {
    float4 sky = float4(1e9, float3(skyRad(w)));
    if (env.x < 0.5) return sky;
    if (p.x >= X0 && p.x <= X1) return rowHit(p, w, env.y, env.z, sky);
    // 판 끝 너머: 이 줄 높이의 벽은 바로, 판 쪽은 판 끝 평면(창)을 지나는 높이로(판 상자면 끝면, 틈이면 그 줄 안)
    float4 hit = sky;
    if (w.z > 1e-6) {
      float t = (DEPTH - p.z) / w.z;
      float y = p.y + w.y * t;
      if (t > 0.0 && y >= env.y && y <= env.z) hit = float4(t, RADW);
    }
    float X = p.x < X0 ? X0 : X1;
    if ((X - p.x) * w.x <= 1e-9) return hit;
    float t = (X - p.x) / w.x;
    float3 q = p + w * t;
    if (q.z < -FRONT || q.z > DEPTH || t >= hit.x) return hit;
    for (int s = 0; s < 4; s++) {
      float2 sl = slabOf(s);
      if (q.y >= sl.x && q.y <= sl.y) return float4(t, w.x > 0.0 ? RADL : RADR);
    }
    for (int g = 0; g < 3; g++) {
      float2 gp = gapOf(g);
      if (q.y > gp.x && q.y < gp.y) return rowHit(p, w, gp.x, gp.y, hit);
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

// 둘레가 가린 하늘(light-model envLoss). GPU 컴파일러는 함수를 모두 펼치므로 무거운 몸체는 한 번만 나오게 반복문으로 쓴다
function envCode() {
  return `
  // 판 끝 평면(창) x = X를 지나는 높이가 Y 이상(up) 또는 이하인 방향의 반공간(x·w ≥ 0, light-model windowPlane)
  float3 windowPlane(float3 p, float X, float Y, bool up) {
    float dx = X - p.x;
    float sg = (dx > 0.0 ? 1.0 : -1.0) * (up ? 1.0 : -1.0);
    return float3(-sg * (Y - p.y), sg * dx, 0.0);
  }
  // 둘레 사각형 k(light-model envQuads): 0 벽(이 줄 높이), 판 끝 안쪽은 1 판 윗면·2 위 판 아랫면,
  // 판 끝 너머는 3~8 틈(아래 줄·이 줄·위 줄)마다 판 윗면·위 판 아랫면(그 틈으로, gap), 9~12 판 상자의 가까운 끝면.
  // 면의 앞쪽(빛을 받는 쪽)에서만 보인다. 받는 점 p 기준 꼭짓점과 밝기, 없으면 false
  bool envQuad(int k, float3 p, out float3 a, out float3 b, out float3 c, out float3 d, out float3 rad, out float2 gap) {
    float zf = -FRONT - p.z;
    float z = DEPTH - p.z;
    a = float3(0.0); b = float3(0.0); c = float3(0.0); d = float3(0.0); rad = float3(0.0); gap = float2(1.0, 0.0);
    bool inside = p.x >= X0 && p.x <= X1;
    if (k == 0) {
      float y0 = max(env.y, -FARV) - p.y;
      float y1 = min(env.z, FARV) - p.y;
      if (z <= 0.0) return false;
      a = float3(-FARV, y0, z); b = float3(FARV, y0, z); c = float3(FARV, y1, z); d = float3(-FARV, y1, z);
      rad = RADW;
      return true;
    }
    float Y = 0.0;
    bool top = true;
    if (k < 3) {
      if (!inside) return false;
      top = k == 1;
      Y = top ? env.y : env.z;
      if (top ? Y <= -FARV : Y >= FARV) return false;
    } else if (k < 9) {
      if (inside) return false;
      gap = gapOf((k - 3) / 2);
      if (gap.x >= gap.y) return false;
      top = (k - 3) - ((k - 3) / 2) * 2 == 0;
      Y = top ? gap.x : gap.y;
      if (top ? Y <= -FARV : Y >= FARV) return false;
    } else {
      if (inside) return false;
      float2 sl = slabOf(k - 9);
      if (sl.x >= sl.y) return false;
      bool left = p.x < X0;
      float x = (left ? X0 : X1) - p.x;
      a = float3(x, sl.x - p.y, zf); b = float3(x, sl.x - p.y, z); c = float3(x, sl.y - p.y, z); d = float3(x, sl.y - p.y, zf);
      rad = left ? RADL : RADR;
      return true;
    }
    // 판 윗면은 그 위에서, 아랫면은 그 아래에서
    if (top ? p.y <= Y : p.y >= Y) return false;
    float y = Y - p.y;
    a = float3(X0 - p.x, y, zf); b = float3(X1 - p.x, y, zf); c = float3(X1 - p.x, y, z); d = float3(X0 - p.x, y, z);
    rad = top ? RADF : RADU;
    return true;
  }
  float3 envLoss(float3 p, float3 n) {
    if (env.x < 0.5) return float3(0.0);
    float3 loss = float3(0.0);
    float X = p.x < X0 ? X0 : X1;
    for (int k = 0; k < 13; k++) {
      float3 a; float3 b; float3 c; float3 d; float3 rad; float2 gap;
      if (envQuad(k, p, a, b, c, d, rad, gap)) {
        float3 v[${NV}];
        for (int j = 0; j < ${NV}; j++) v[j] = float3(0.0);
        v[0] = a; v[1] = b; v[2] = c; v[3] = d;
        int cnt = 4;
        // 반구, 그리고 틈으로 보는 면은 그 틈(창의 두 높이 사이)
        bool lo = gap.x < gap.y && gap.x > -FARV;
        bool hi = gap.x < gap.y && gap.y < FARV;
        for (int j = 0; j < 3; j++) {
          bool on = j == 0 || (j == 1 ? lo : hi);
          if (on && cnt >= 3) clipPoly(v, cnt, j == 0 ? n : windowPlane(p, X, j == 1 ? gap.x : gap.y, j == 1), j == 0 ? HORIZON : 0.0);
        }
        float4 q = moments(v, cnt, n);
        if (q.x > 0.0) loss += float3(skyOf(q)) - rad * q.x;
      }
    }
    return loss;
  }
`;
}

// 책 상자가 가린 하늘(light-model boxLoss): 굽기 셰이더만. 상자 × 면 × 띠 × 구역을 반복문으로(몸체는 한 번씩)
function boxCode() {
  return `
  uniform float4 box[${BOX_MAX * BOX_VEC}];
  uniform float nBox;
  uniform float selfIdx;    // 이 면의 책(상자 목록에서 뺀다), 없으면 −1

  // ---------- 가리개 뒤에 보였을 것(light-model behindOf) ----------
  float3 edgePlane(float3 p, float ey, float ez) { return float3(0.0, -(ez - p.z), ey - p.y); }
  float3 endPlane(float3 p, float Y, float X, float ge) {
    float dy = Y - p.y;
    float sg = (dy > 0.0 ? 1.0 : -1.0) * ge;
    return float3(sg * dy, -sg * (X - p.x), 0.0);
  }
  // 구역(반공간 nw개의 교집합) 안의 몫. 다각형이 반공간 안에 통째로 있으면 자르지 않는다
  float4 sectorVF(float3 P[${NV}], int cnt, float3 n, float3 w0, float3 w1, float3 w2, float3 w3, float nw, float4 total) {
    float3 Q[${NV}];
    for (int k = 0; k < ${NV}; k++) Q[k] = P[k];
    int qc = cnt;
    bool cut = false;
    for (int j = 0; j < 4; j++) {
      if (float(j) >= nw) break;
      float3 w = j == 0 ? w0 : (j == 1 ? w1 : (j == 2 ? w2 : w3));
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
  // 구역 셋: 판 윗면(앞·뒤 모서리, 판 양 끝 사이), 벽(아래·위 모서리 사이), 위 판 아랫면. 나머지는 하늘
  // gf·gc: 가리개가 있는 줄의 판 윗면·위 판 아랫면(다른 줄 책 뒤에 보였을 것은 그 줄 안)
  float3 behindOf(float3 p, float3 n, float3 P[${NV}], int cnt, float4 total, float gf, float gc) {
    if (env.x < 0.5) return float3(skyOf(total));
    bool hasF = gf > -FARV;
    bool hasC = gc < FARV;
    float3 FW = hasF ? edgePlane(p, gf, DEPTH) : float3(0.0, 0.0, -1.0);
    float3 CW = hasC ? edgePlane(p, gc, DEPTH) : float3(0.0, 0.0, 1.0);
    float4 rest = total;
    float3 sum = float3(0.0);
    for (int si = 0; si < 3; si++) {
      bool on = si == 0 ? hasF : (si == 1 ? true : hasC);
      if (on) {
        float Y = si == 0 ? gf : gc;
        float3 w0 = si == 0 ? FW : (si == 1 ? CW : edgePlane(p, gc, -FRONT));
        float3 w1 = si == 0 ? -edgePlane(p, gf, -FRONT) : (si == 1 ? -FW : -CW);
        float3 w2 = endPlane(p, Y, X0, 1.0);
        float3 w3 = endPlane(p, Y, X1, -1.0);
        float4 q = sectorVF(P, cnt, n, w0, w1, w2, w3, si == 1 ? 2.0 : 4.0, total);
        sum += (si == 0 ? RADF : (si == 1 ? RADW : RADU)) * q.x;
        rest -= q;
      }
    }
    return sum + float3(skyOf(rest));
  }

  // ---------- 책 상자가 가린 하늘(light-model boxLoss) ----------
  // 면 위 사각형 r(u0, u1, v0, v1) 하나: 보이는 부분의 (뒤에 보였을 밝기 − 면 밝기). side: 어느 줄 책인지(0 이 줄, ±1 위·아래 줄)
  float3 stripLoss(float3 p, float3 n, float3 fc, float3 au, float3 av, float4 r, float3 rad, float side) {
    if (r.y <= r.x || r.w <= r.z) return float3(0.0);
    float3 o = fc - p;
    float3 v[${NV}];
    for (int k = 0; k < ${NV}; k++) v[k] = float3(0.0);
    v[0] = o + au * r.x + av * r.z;
    v[1] = o + au * r.y + av * r.z;
    v[2] = o + au * r.y + av * r.w;
    v[3] = o + au * r.x + av * r.w;
    int cnt = 4;
    // 자르는 평면: 받는 점의 반구, 그리고 판 끝 너머의 점에서는 판 끝 평면을 지나는 높이(light-model throughOpening)
    float dx = (p.x < X0 ? X0 : X1) - p.x;
    float sg = dx > 0.0 ? 1.0 : -1.0;
    bool beyond = env.x > 0.5 && (p.x < X0 || p.x > X1);
    float3 c1 = side > 0.5 ? float3(-sg * (env.z + THICK - p.y), sg * dx, 0.0) : (side < -0.5 ? float3(sg * (env.y - THICK - p.y), -sg * dx, 0.0) : float3(-sg * (env.y - p.y), sg * dx, 0.0));
    float3 c2 = float3(sg * (env.z - p.y), -sg * dx, 0.0);
    bool on1 = beyond && (abs(side) > 0.5 || env.y > -FARV);
    bool on2 = beyond && abs(side) < 0.5 && env.z < FARV;
    for (int j = 0; j < 3; j++) {
      bool on = j == 0 || (j == 1 ? on1 : on2);
      if (on && cnt >= 3) clipPoly(v, cnt, j == 0 ? n : (j == 1 ? c1 : c2), j == 0 ? HORIZON : 0.0);
    }
    float4 q = moments(v, cnt, n);
    if (q.x <= 0.0) return float3(0.0);
    float2 g = side > 0.5 ? float2(env.z + THICK, env2.y) : (side < -0.5 ? float2(env2.x, env.y - THICK) : env.yz);
    return behindOf(p, n, v, cnt, q, g.x, g.y) - q.x * rad;
  }
  // 축 k 방향 s 면의 반사율(light-model faceAlbedo): 표지·책등 = 장정(tone), 머리·꼬리·책배 = 장정과 속지를 속지 넓이 비(fr.x 머리, fr.y 책배)로
  float3 faceAlbedo(float3 tone, float2 fr, float k, float s) { return k < 0.5 ? tone : (k < 1.5 ? mix(tone, PAPER, fr.x) : (s < 0.0 ? tone : mix(tone, PAPER, fr.y))); }
  // 상자 면(축 a, 반 길이 h, 면 번호 k) 하나. 마주 보는 이웃 면(덮개)이 가리는 부분은 뺀 띠 넷으로
  float3 faceLoss(float3 p, float3 n, float3 c, float3 a, float h, float3 au, float hu, float3 av, float hv, float3 tone, float2 fr, float k, float4 cc, float4 r0, float4 r1, float side) {
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
    float3 fc = c + a * (s * h);
    float3 rad = faceAlbedo(tone, fr, k, s) * irr(a * s);
    float3 loss = float3(0.0);
    for (int j = 0; j < 4; j++) loss += stripLoss(p, n, fc, au, av, j == 0 ? S0 : (j == 1 ? S1 : (j == 2 ? S2 : S3)), rad, side);
    return loss;
  }
  float3 boxesLoss(float3 p, float3 n) {
    float3 loss = float3(0.0);
    for (int i = 0; i < ${BOX_MAX}; i++) {
      if (float(i) >= nBox) break;
      if (abs(float(i) - selfIdx) > 0.5) {
        float4 b0 = box[i * ${BOX_VEC}];
        float4 b1 = box[i * ${BOX_VEC} + 1];
        float4 b2 = box[i * ${BOX_VEC} + 2];
        float4 b3 = box[i * ${BOX_VEC} + 3];
        float4 cc = box[i * ${BOX_VEC} + 4];
        float4 r0 = box[i * ${BOX_VEC} + 5];
        float4 r1 = box[i * ${BOX_VEC} + 6];
        float4 b7 = box[i * ${BOX_VEC} + 7];
        float4 b8 = box[i * ${BOX_VEC} + 8];
        float3 tone = float3(b0.w, b7.xy);
        float2 fr = float2(b7.w, b8.x);
        // 받는 면 평면 뒤에 통째로 있는 상자, 판 끝 안쪽에서 본 다른 줄 책(판이 가린다)은 보이지 않는다
        float front = dot(b0.xyz - p, n) + b1.w * abs(dot(b1.xyz, n)) + b2.w * abs(dot(b2.xyz, n)) + b3.w * abs(dot(b3.xyz, n));
        bool hidden = abs(b7.z) > 0.5 && (env.x < 0.5 || (p.x >= X0 && p.x <= X1));
        if (front > 0.0 && !hidden) {
          // 면 축 k와 그 면 위의 두 축(k + 1, k + 2)
          for (int k = 0; k < 3; k++) {
            float4 A = k == 0 ? b1 : (k == 1 ? b2 : b3);
            float4 U = k == 0 ? b2 : (k == 1 ? b3 : b1);
            float4 V = k == 0 ? b3 : (k == 1 ? b1 : b2);
            loss += faceLoss(p, n, b0.xyz, A.xyz, A.w, U.xyz, U.w, V.xyz, V.w, tone, fr, float(k), cc, r0, r1, b7.z);
          }
        }
      }
    }
    return loss;
  }
`;
}

// 하늘 가림 굽기: 그림 칸 p(칸 가운데)의 줄 공간 점 O + p.x·Ux + p.y·Vy, 면 법선 tN에서. 출력 채널마다 (가림 + LOSS_OFF) / LOSS_SCALE
export function bakeSource() {
  return `
  uniform float3 O;
  uniform float3 Ux;
  uniform float3 Vy;
  uniform float3 tN;
${header()}
${polyCode()}
${envCode()}
${boxCode()}
  half4 main(float2 p) {
    float3 P = O + p.x * Ux + p.y * Vy;
    float3 g = clamp((envLoss(P, tN) + boxesLoss(P, tN) + LOSS_OFF) / LOSS_SCALE, 0.0, 1.0);
    return half4(half3(g), 1.0);
  }
`;
}

// 화소 빛(하늘·창빛 직접 몫 − 하늘 가림, 반사광)을 곱하기·닷지 값으로(두 그리는 셰이더 공통). cam4 유니폼(눈)이 있어야 한다
// mode: 0 곱하기 비, 1 컬러 닷지 값, 2 두 겹을 합친 이득 g = m / (1 − s)(재질 색 × g, 1에서 자른다: 단색 재질을 한 번에 칠할 때)
function shadeCode(mode: 0 | 1 | 2) {
  return `
  const float DODGE = ${mode}.0;
  // 위 판이 창빛 원반을 가리는 몫(light-model plankKeyBlocked): 세로·가로 활꼴 비율의 곱
  float segment(float u) {
    if (u <= -1.0) return 1.0;
    if (u >= 1.0) return 0.0;
    return (acos(u) - u * sqrt(1.0 - u * u)) / PI;
  }
  // 광선 p + t·w가 판 상자(높이 y0 ~ y1)에 닿는가(light-model hitsSlab)
  bool hitsSlab(float3 p, float3 w, float y0, float y1) {
    float3 lo = float3(X0, y0, -FRONT);
    float3 hi = float3(X1, y1, DEPTH);
    float3 inv = 1.0 / (abs(w) + 1e-12) * sign(w + 1e-15);
    float3 ta = (lo - p) * inv;
    float3 tb = (hi - p) * inv;
    float3 mn = min(ta, tb);
    float3 mx = max(ta, tb);
    float t0 = max(1e-6, max(mn.x, max(mn.y, mn.z)));
    float t1 = min(mx.x, min(mx.y, mx.z));
    return t0 <= t1;
  }
  float plankKey(float3 p) {
    if (keyOn < 0.5 || env.x < 0.5) return 0.0;
    if (p.x >= X0 && p.x <= X1) {
      if (env.z >= FARV) return 0.0;
      float zf = max(0.001, p.z + FRONT);
      float d = env.z - p.y;
      float ky = d <= 0.0 ? 1.0 : segment((atan(d, zf) - LELEV) / LRAD);
      float kx = segment((atan(X0 - p.x, zf) - LAZIM) / LRAD) - segment((atan(X1 - p.x, zf) - LAZIM) / LRAD);
      return ky * kx;
    }
    // 판 끝 너머: 원반을 넓이가 같은 방향 ${KEY_SAMPLES}개로(light-model KEY_DIRS, 해바라기 배치)
    float hit = 0.0;
    for (int i = 0; i < ${KEY_SAMPLES}; i++) {
      float r = ${f(KEY_BASIS.tan)} * sqrt((float(i) + 0.5) / ${KEY_SAMPLES}.0);
      float a = float(i) * ${f(KEY_BASIS.golden)};
      float3 w = normalize(LU + (${v3(KEY_BASIS.U)} * cos(a) + ${v3(KEY_BASIS.V)} * sin(a)) * r);
      if ((env.y > -FARV && hitsSlab(p, w, env.y - THICK, env.y)) || (env.z < FARV && hitsSlab(p, w, env.z, env.z + THICK))) hit += 1.0;
    }
    return hit / ${KEY_SAMPLES}.0;
  }
  float envBRDF(float nv) {
    float rx = 1.0 - ROUGH;
    float ry = 0.0425 - 0.0275 * ROUGH;
    float rz = 1.04 - 0.572 * ROUGH;
    float rw = -0.04 + 0.022 * ROUGH;
    float a004 = min(rx * rx, exp2(-9.28 * max(0.0, nv))) * rx + ry;
    return F0 * (-1.04 * a004 + rz) + (1.04 * a004 + rw);
  }
  float ggxKey(float3 n, float3 v) {
    float nl = dot(n, LU);
    float nv = dot(n, v);
    if (nl <= 0.0 || nv <= 0.0) return 0.0;
    float3 hh = normalize(v + LU);
    float nh = max(0.0, dot(n, hh));
    float vh = max(0.0, dot(v, hh));
    float a = ROUGH * ROUGH;
    float a2 = a * a;
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float k = (ROUGH + 1.0) * (ROUGH + 1.0) / 8.0;
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
  half4 shade(float3 P, float3 n, float3 v, float3 loss, float3 a, float3 eref) {
    float kb = plankKey(P);
    float3 E = max(float3(0.0), AMB + SKYUP * n.y + DIFF * max(0.0, dot(n, LU)) * (1.0 - kb) - loss);
    float ks = envBRDF(max(0.0, dot(n, v)));
    float3 r = E * (1.0 - ks) / eref;
    float3 m = pow(min(float3(1.0), r), float3(IG));
    if (DODGE < 0.5) return half4(half3(m), 1.0);
    float3 spec = (ks * envHit(P, reflect(-v, n)).yzw + ggxKey(n, v) * DIFF * (1.0 - kb)) / ECAM;
    float3 base = a * min(float3(1.0), r);
    float3 target = a * r + spec;
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
  ${mode === 2 ? 'uniform float3 base;     // 재질 색(감마 sRGB)' : ''}
  uniform float3 O;
  uniform float3 Ux;
  uniform float3 Vy;
  uniform float3 Hw;
  uniform float3 tN;        // 평면 바깥 법선
  uniform float4 bev0;      // 모서리 둥글기(평면 안에서 모서리 쪽 단위 벡터, 모서리의 그 축 좌표). 없으면 0
  uniform float4 bev1;
  uniform float4 cam4;      // 눈(x, y, 기준면 z, 거리): 눈 위치 = (x, y, z − 거리)
  uniform float keyOn;      // 위 판이 창빛을 가리는 몫을 넣을지
  uniform float3 albedo;    // 재질 색(선형 RGB, 닷지: 반사광을 감마 공간에 더할 때)
  uniform float3 eref;      // 그 재질의 대표 자리 빛(light-model EREF)
  uniform float liveEnv;    // 1: 구운 값 대신 둘레가 가린 하늘을 그 자리에서
${header()}
${polyCode()}
${envCode()}
${shadeCode(mode)}
  half4 main(float2 p) {
    float3 P = (O + p.x * Ux + p.y * Vy) / dot(Hw, float3(p, 1.0));
    float b0 = slope(arc(bev0.w - dot(P, bev0.xyz), EDGER));
    float b1 = slope(arc(bev1.w - dot(P, bev1.xyz), EDGER));
    float3 n = normalize(tN + bev0.xyz * b0 + bev1.xyz * b1);
    float3 loss = liveEnv > 0.5 ? envLoss(P, tN) : float3(tex.eval(p).rgb) * LOSS_SCALE - LOSS_OFF;
    half4 g = shade(P, n, normalize(float3(cam4.x, cam4.y, cam4.z - cam4.w) - P), loss, albedo, eref);
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
${header()}
${polyCode()}
${envCode()}
${shadeCode(dodge ? 1 : 0)}
  const float CURVE = ${f(SPINE_CURVE)};
  const float3 EREF_BOOK = ${c3(EREF.book)};
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
    if (t0 > t1 || t1 <= 0.0) return half4(DODGE < 0.5 ? 1.0 : 0.0, DODGE < 0.5 ? 1.0 : 0.0, DODGE < 0.5 ? 1.0 : 0.0, 1.0);
    float3 L = ol + dl * t0;
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
        if (wall) a = albedo;
        page = !wall;
      }
    }
    float3 P = bO + toRow(Lp);
    float3 nw3 = normalize(toRow(n));
    // 하늘 가림: 그 면의 구운 칸(면 평면 점의 칸 좌표), 없으면 둘레만 그 자리에서(면 법선)
    float4 R = float4(0.0);
    for (int i = 0; i < 6; i++) { if (i == fi) R = rect[i]; }
    float3 loss = R.z > 0.0 ? float3(tex.eval(float2(R.x + u / pw * R.z, R.y + v / ph * R.w)).rgb) * LOSS_SCALE - LOSS_OFF : envLoss(bO + toRow(L), toRow(nl));
    float3 view = cam4.w > 0.0 ? normalize(E - P) : normalize(-d);
    return shade(P, nw3, view, loss, a, page ? EREF_PAPER : EREF_BOOK);
  }
`;
}
