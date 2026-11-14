#version 460 core
// 이 파일은 tool/gen_shaders.sh 가 만든다. 손으로 고치지 말 것(출처: ../app/src/ui/scene-light-sksl.ts)
#include <flutter/runtime_effect.glsl>

precision highp float;
layout(location = 0) out vec4 fragColor;


  uniform sampler2D tex;
  uniform vec2 texSize;   // 그림 칸 수(SkSL 화소 좌표를 0~1로 바꾼다)
  uniform mat3 texMat;    // 그리는 좌표 → 그림 칸(SkSL에서는 자식 그림에 붙인 행렬)
  uniform float texDecal; // 1이면 그림 밖은 비워 둔다(SkSL TileMode.Decal)
  uniform sampler2D keyTex;
  uniform vec2 keyTexSize;   // 그림 칸 수(SkSL 화소 좌표를 0~1로 바꾼다)
  uniform mat3 keyTexMat;    // 그리는 좌표 → 그림 칸(SkSL에서는 자식 그림에 붙인 행렬)
  uniform float keyTexDecal; // 1이면 그림 밖은 비워 둔다(SkSL TileMode.Decal)    // 책이 이 면에서 창빛 원반을 가리는 몫(알파, 평면 좌표 그림: 그림 px = (P·kU, P·kV) + kO)
  uniform sampler2D tex2;
  uniform vec2 tex2Size;   // 그림 칸 수(SkSL 화소 좌표를 0~1로 바꾼다)
  uniform mat3 tex2Mat;    // 그리는 좌표 → 그림 칸(SkSL에서는 자식 그림에 붙인 행렬)
  uniform float tex2Decal; // 1이면 그림 밖은 비워 둔다(SkSL TileMode.Decal)      // 앞 굽기(움직이기 전 자리의 하늘 가림, tex와 같은 캔버스 px로 읽힌다)
  uniform float mixT;       // 새 굽기 몫(1이면 tex만)
  uniform vec3 base;      // 재질 색(감마 sRGB): 겹 2(한 번에)만 쓴다
  uniform vec3 O;
  uniform vec3 Ux;
  uniform vec3 Vy;
  uniform vec3 Hw;
  uniform vec3 tN;        // 평면 바깥 법선
  uniform vec4 bev0;      // 모서리 둥글기(평면 안에서 모서리 쪽 단위 벡터, 모서리의 그 축 좌표). 없으면 0
  uniform vec4 bev1;
  uniform float endR;       // 판 앞면 양 끝 세로 모서리 둥글기(0이면 없다)
  uniform vec4 rim;       // 평평한 벽의 구멍(x0, x1, y0, y1): 구멍 앞 끝 둥근 테. x0 > x1이면 없다
  uniform float rimCeil;    // 이 줄 위 면 높이: 테도 안쪽 면처럼 그 아래에서 어두워진다(light-model sideCeilF)
  uniform float kS;         // 재질의 표면 반사 몫 배수(materials specular)
  uniform vec4 softBox;   // 안쪽 모서리 번짐: 면 좌표의 둥근 사각형(a0, a1, b0, b1)
  uniform vec2 softR;     // 그 반지름, 번짐 폭(폭 0이면 번지지 않는다)
  uniform vec4 cam4;      // 눈(x, y, 기준면 z, 거리): 눈 위치 = (x, y, z − 거리)
  uniform float keyOn;      // 판(위·아래)이 창빛을 가리는 몫을 넣을지
  uniform vec3 albedo;    // 재질 색(선형 RGB, 닷지: 반사광을 감마 공간에 더할 때)
  uniform vec3 eref;      // 그 재질의 대표 자리 빛(light-model EREF)
  uniform vec3 sref;      // 그 재질의 대표 자리 반사광(light-model SREF)
  uniform float liveEnv;    // 1: 구운 값 대신 둘레가 가린 하늘을 그 자리에서
  uniform vec3 kU;
  uniform vec3 kV;
  uniform vec2 kO;
  uniform vec2 mR;        // 재질(domain/surface-pattern matUniforms): 거칠기·기울기 RMS, 미세 높이, 결, 결 크기, 무늬 자리 어긋남
  uniform vec4 mB;
  uniform vec4 mG;
  uniform vec2 mS;
  uniform vec2 mSeed;

  uniform vec3 env;

  const float PI = 3.14159265;
  const float AMB = 0.620000000;
  const vec3 SKYTILT = vec3(0.00000000, 0.250000000, -0.120000000);
  const float DIFF = 0.500000000;
  // 방 빛 하늘 가림 세기(light.occlusion, 모든 곳 같은 비율)
  const float OCC = 0.150000000;
  const vec3 LU = vec3(-0.102940441, 0.173648178, -0.979412873);
  // 맞추기 값(스킨마다 다르다: 스토어에서 색을 고르면 셰이더를 다시 만들지 않고 값만 바꾼다, light-model lightSet().u)
  // 카메라 기준 빛(벽 대표 자리 빛 / 노출 기준 CAM.gain, 반사광을 장면 밝기로)
  uniform vec3 ECAM;
  const float LELEV = 0.175474740;
  const float LRAD = 0.104719755;
  const float LAZ = -0.104719755;
  const float F0 = 0.0400000000;
  // 창빛 원반이 하이라이트를 넓히는 몫(light-model ggxKey): α² += (반지름/2)²
  const float LR2 = 0.00274155678;
  const float FRONT = 53.3750000;
  const float DEPTH = 122.000000;
  const float THICK = 14.4875000;
  const float X0 = 0.00000000;
  const float X1 = 366.000000;
  // 움푹 파인 책장(light-model Env side): env.x > 1.5이면 틀 안쪽 면이 양옆(X0, X1)을 막는다. FFRONT: 구멍 앞 끝
  const float FFRONT = 56.4250000;
  const int ENV_COLS = 18;
  const float FARV = 10000.0000;
  // 둘레 면 밝기(선형 RGB: 반사율 × 받는 빛)와 속지 반사율(되비침): 맞추기 값. 속지 색(그림이 칠하는 색)은 스킨과 상관없다
  uniform vec3 RADF;
  uniform vec3 RADU;
  uniform vec3 RADW;
  uniform vec3 RADE;
  uniform vec3 RADSL;
  uniform vec3 RADSR;
  uniform vec3 PAPER;
  const vec3 PAPER_COLOR = vec3(0.883179738, 0.859173570, 0.796916543);
  const float EDGER = 3.05000000;
  const float SEAMR = 5.33750000;
  const float PLANKR = 2.28750000;
  const float IG = 0.454545455;
  const float LOSS_G0 = 0.300000000;
  const float LOSS_RP = 1.64730849;
  const float LOSS_RN = 6.64385095;
  // 하늘 가림 그림 값 ↔ 가림(면이 받는 하늘 빛 sky, lossEncode·lossDecode)
  vec3 lossDec(vec3 g, vec3 sky) {
    vec3 a = (g - LOSS_G0) / (1.0 - LOSS_G0);
    vec3 b = (LOSS_G0 - g) / LOSS_G0;
    return sky - mix(-LOSS_RN * b * b, LOSS_RP * a * a, step(LOSS_G0, g));
  }
  vec3 lossEnc(vec3 L, vec3 sky) {
    vec3 R = sky - L;
    vec3 pos = LOSS_G0 + (1.0 - LOSS_G0) * sqrt(clamp(R / LOSS_RP, 0.0, 1.0));
    vec3 neg = LOSS_G0 - LOSS_G0 * sqrt(clamp(-R / LOSS_RN, 0.0, 1.0));
    return mix(neg, pos, step(0.0, R));
  }
  const float HORIZON = 1e-4;

  // 빛 색(light-model SKY_C 방 확산광, KEY_C 창빛)
  const vec3 SKYC = vec3(1.00000000, 1.00000000, 1.00000000);
  const vec3 KEYC = vec3(1.00000000, 1.00000000, 1.00000000);
  vec3 skyRad(vec3 w) { return SKYC * (AMB + 1.5 * dot(SKYTILT, w)); }
  // 위 앞쪽 넓은 조명(반사광 전용, light-model overheadGlow)
  float overheadGlow(vec3 w) { return 3.20000000 * smoothstep(0.15, 0.8, w.y) * (1.0 - smoothstep(-0.6, -0.1, w.z)); }
  // 면이 하늘(방)에서 받는 빛
  vec3 skyIrr(vec3 n) { return SKYC * (AMB + dot(SKYTILT, n)); }
  vec3 irr(vec3 n) { return skyIrr(n) + KEYC * (DIFF * max(0.0, dot(n, LU))); }
  // 하늘 앞의 면(F, M)이 가린 하늘 빛
  vec3 skyOf(vec4 q) { return SKYC * (AMB * q.x + 1.5 * dot(SKYTILT, q.yzw)); }

  bool inDepth(float z) { return z >= -FRONT && z <= DEPTH; }
  // 판이 창빛 원반을 가리는 몫: 원반을 판 모서리(수평선)와 판 끝(두 수직선)으로 자른 넓이 비율(light-model diskBlocked)
  float arcInt(float t) { return (t * sqrt(max(0.0, 1.0 - t * t)) + asin(clamp(t, -1.0, 1.0))) / 2.0; }
  float diskCum(float v, float u0) {
    if (v <= -1.0 || u0 >= 1.0) return 0.0;
    float t = min(1.0, v);
    if (u0 <= -1.0) return 2.0 * (arcInt(t) - arcInt(-1.0));
    float w = sqrt(1.0 - u0 * u0);
    if (u0 >= 0.0) {
      float c = clamp(t, -w, w);
      return arcInt(c) - u0 * c - (arcInt(-w) + u0 * w);
    }
    float g = 2.0 * (arcInt(min(t, -w)) - arcInt(-1.0));
    if (t > -w) {
      float c = min(t, w);
      g += arcInt(c) - u0 * c - (arcInt(-w) + u0 * w);
    }
    if (t > w) g += 2.0 * (arcInt(t) - arcInt(w));
    return g;
  }
  float diskBlocked(float u0, float v0, float v1) {
    if (v1 <= v0) return 0.0;
    return clamp((diskCum(v1, u0) - diskCum(v0, u0)) / PI, 0.0, 1.0);
  }
  // 원판에서 uA ≤ u ≤ uB, v0 ≤ v ≤ v1인 넓이 비율(light-model diskBand)
  float diskBand(float uA, float uB, float v0, float v1) {
    if (uB <= uA || v1 <= v0) return 0.0;
    return max(0.0, diskBlocked(uA, v0, v1) - diskBlocked(uB, v0, v1));
  }
  // 판 하나(높이 yb ~ yt, 가로 X0 ~ X1, 앞 끝 ~ 벽인 상자)가 창빛 원반을 가리는 몫(light-model plankBlock):
  // 원반을 앙각 띠로 나눠 띠마다 광선이 판 높이를 지나는 앞뒤 거리 s0 ~ s1에서 가로가 판 범위에 걸리는 방위 구간
  const int KEY_BANDS = 12;
  float plankBlock(vec3 p, float yb, float yt, float zf) {
    float a = yb - p.y;
    float b = yt - p.y;
    if (b <= 0.0 || zf <= 0.0) return 0.0;
    float uMin = a <= 0.0 ? -2.0 : (atan(a, zf) - LELEV) / LRAD;
    float k = 0.0;
    for (int i = 0; i < KEY_BANDS; i++) {
      float uA = -1.0 + 2.0 * float(i) / float(KEY_BANDS);
      float uB = uA + 2.0 / float(KEY_BANDS);
      float lo = max(uA, uMin);
      if (lo >= uB) continue;
      float tn = tan(LELEV + 0.5 * (lo + uB) * LRAD);
      if (tn <= 1e-6) continue;
      float s0 = max(1e-3, max(0.0, a) / tn);
      float s1 = max(s0, min(zf, b / tn));
      float t0 = min((X0 - p.x) / s0, (X0 - p.x) / s1);
      float t1 = max((X1 - p.x) / s0, (X1 - p.x) / s1);
      k += diskBand(lo, uB, (atan(t0) - LAZ) / LRAD, (atan(t1) - LAZ) / LRAD);
    }
    return min(1.0, k);
  }
  // 틀 안쪽 면이 창빛 원반을 가리는 몫(light-model sideBlock)
  float sideBlock(vec3 p) {
    float zf = p.z + FFRONT;
    if (zf <= 0.0) return 0.0;
    return min(1.0, diskBand(-1.0, 1.0, -2.0, (atan((X0 - p.x) / zf) - LAZ) / LRAD) + diskBand(-1.0, 1.0, (atan((X1 - p.x) / zf) - LAZ) / LRAD, 2.0));
  }
  // 위 판(ceil ~ ceil + 두께) + 아래 판(floor − 두께 ~ floor), 틀이 있으면 안쪽 면까지(light-model plankKeyBlocked)
  float plankKeyOf(vec3 p) {
    if (env.x < 0.5) return 0.0;
    float zf = p.z + FRONT;
    float k = 0.0;
    // 두 판을 한 반복문으로(plankBlock 몸체가 한 번만 펼쳐지게, 차례는 위 판 → 아래 판 그대로)
    for (int i = 0; i < 2; i++) {
      if (i == 0 ? env.z >= FARV : env.y <= -FARV) continue;
      k += plankBlock(p, i == 0 ? env.z : env.y - THICK, i == 0 ? env.z + THICK : env.y, zf);
    }
    k = min(1.0, k);
    return env.x > 1.5 ? 1.0 - (1.0 - k) * (1.0 - sideBlock(p)) : k;
  }
  // 가림이 없을 때 받는 빛(light-model openE)
  vec3 openE(vec3 p, vec3 n) { return skyIrr(n) + KEYC * (DIFF * max(0.0, dot(n, LU)) * (1.0 - plankKeyOf(p))); }
  // 판 속 벽 점(판 두께 높이, 판 범위 안)은 판에 가려 보이지 않는다. 판 끝 둥근 모서리·안티에일리어싱으로 드러나는 화소는 그 시선이 실제로
  // 닿는 판 끝 바로 너머 벽으로 본다
  vec3 wallOutside(vec3 P, vec3 n) {
    // 틀 안쪽 면 너머 벽 점(가려져 안 보인다)은 굽기 칸 보간이 틀 안 값을 잇도록 안쪽 면 바로 앞 값으로
    if (env.x > 1.5 && n.z < -0.5 && P.z >= DEPTH - 1e-3) return vec3(clamp(P.x, X0 + 0.01, X1 - 0.01), P.y, P.z);
    if (env.x < 0.5 || n.z > -0.5 || P.z < DEPTH - 1e-3 || P.x <= X0 || P.x >= X1) return P;
    bool inF = env.y > -FARV && P.y < env.y && P.y > env.y - THICK;
    bool inC = env.z < FARV && P.y > env.z && P.y < env.z + THICK;
    if (!inF && !inC) return P;
    return vec3(P.x - X0 < X1 - P.x ? X0 - 0.01 : X1 + 0.01, P.y, P.z);
  }
  // 점 p에서 방향 w로 처음 보이는 둘레 면(판 윗면, 위 판 아랫면, 그 사이 벽)의 거리와 밝기 RGB, 없으면 하늘(light-model envHit).
  // 판은 그린 범위(X0 ~ X1)에서 끝나고 판 끝 너머는 어느 높이든 벽이다
  vec4 envHit(vec3 p, vec3 w) {
    vec4 hit = vec4(1e9, skyRad(w));
    if (env.x < 0.5) return hit;
    if (w.y < -1e-6 && env.y > -FARV) {
      float t = (env.y - p.y) / w.y;
      float x = p.x + w.x * t;
      if (t > 0.0 && inDepth(p.z + w.z * t) && x >= X0 && x <= X1) hit = vec4(t, RADF);
    }
    if (w.y > 1e-6 && env.z < FARV) {
      float t = (env.z - p.y) / w.y;
      float x = p.x + w.x * t;
      if (t > 0.0 && t < hit.x && inDepth(p.z + w.z * t) && x >= X0 && x <= X1) hit = vec4(t, RADU);
    }
    // 틀 안쪽 면
    if (env.x > 1.5 && abs(w.x) > 1e-6) {
      float t = ((w.x > 0.0 ? X1 : X0) - p.x) / w.x;
      float zh = p.z + w.z * t;
      if (t > 0.01 && t < hit.x && zh >= -FFRONT && zh <= DEPTH) hit = vec4(t, w.x > 0.0 ? RADSR : RADSL);
    }
    // 판 끝면(판 끝 너머에서 판 쪽으로)
    if (env.x < 1.5 && abs(w.x) > 1e-6) {
      float X = w.x > 0.0 ? X0 : X1;
      if ((w.x > 0.0 && p.x < X) || (w.x < 0.0 && p.x > X)) {
        float t = (X - p.x) / w.x;
        float y = p.y + w.y * t;
        bool inPlank = (env.y > -FARV && y <= env.y && y >= env.y - THICK) || (env.z < FARV && y >= env.z && y <= env.z + THICK);
        if (t > 0.0 && t < hit.x && inPlank && inDepth(p.z + w.z * t)) hit = vec4(t, RADE);
      }
    }
    if (w.z > 1e-6) {
      float t = (DEPTH - p.z) / w.z;
      float y = p.y + w.y * t;
      float x = p.x + w.x * t;
      // 판 사이 벽, 판 끝 너머는 어느 높이든 벽
      if (t > 0.0 && t < hit.x && ((y >= env.y && y <= env.z) || x < X0 || x > X1)) hit = vec4(t, RADW);
    }
    return hit;
  }
  // 거친 면의 반사(light-model envLobe와 같은 식): 거칠기만큼 퍼져 판 앞 모서리가 칼 같은 선으로 비치지 않는다
  vec3 envLobe(vec3 p, vec3 w, float rough) {
    // envHit은 한 번만 부른다: 셰이더 컴파일러가 함수를 호출마다 펼쳐 부르는 곳이 늘면 컴파일이 크게 느려진다(앱 시작이 멈춘 듯 보였다)
    vec4 h = envHit(p, w);
    float glow = overheadGlow(w);
    vec3 hit = h.yzw + vec3(h.x > 1e8 ? glow : 0.0);
    if (env.x < 0.5 || w.z >= -0.05) return hit;
    float zf = p.z + FRONT;
    if (zf <= 0.0) return hit;
    float x = p.x + w.x * (zf / -w.z);
    if (x < X0 || x > X1) return hit;
    float e = w.y / -w.z;
    float sp = max(0.02, rough * rough);
    float ec = (env.z - p.y) / zf;
    float ef = (env.y - p.y) / zf;
    float fc = env.z < FARV && p.y < env.z - 0.001 ? smoothstep(ec - sp, ec + sp, e) : 0.0;
    float ff = env.y > -FARV && p.y > env.y + 0.001 ? 1.0 - smoothstep(ef - sp, ef + sp, e) : 0.0;
    float fs = max(0.0, 1.0 - fc - ff);
    return (skyRad(w) + vec3(glow)) * fs + RADU * fc + RADF * ff;
  }


  // 판 끝 창 평면 i(0~7 = 창 넷 × 판 윗면·위 판 아랫면). 면 부분(part 0 판 범위, 1 왼쪽 끝 너머 벽, 2 오른쪽 끝 너머 벽)이 p에서 판 끝 창을
  // 지나야 보이면 그 창으로(판 범위를 통째로 건너면 두 끝 모두). 창 순서: X1(part 0·1, p가 X1 오른쪽), X0(part 1), X0(part 0·2, p가 X0 왼쪽), X1(part 2). 쓰지 않으면 false
  // (판 끝 너머의 면은 p에서 판 끝 평면 x = X를 지나는 높이가 판 윗면 ~ 위 판 아랫면 사이일 때만 보인다: p와 판 끝 모서리를 지나는 평면, light-model windowPlanes·acrossPlanes)
  bool acrossPlane(int i, vec3 p, int part, out vec3 w) {
    w = vec3(0.0);
    int wi = i / 2;
    bool on = wi == 0 ? ((part == 1 || part == 0) && p.x > X1) : (wi == 1 ? (part == 1 && p.x > X0) : (wi == 2 ? ((part == 2 || part == 0) && p.x < X0) : (part == 2 && p.x < X1)));
    if (!on) return false;
    bool lower = i == wi * 2;
    if (lower ? env.y <= -FARV : env.z >= FARV) return false;
    float Xr = (wi == 1 || wi == 2 ? X0 : X1) - p.x;
    float sg = Xr >= 0.0 ? 1.0 : -1.0;
    w = lower ? vec3(-(env.y - p.y) * sg, Xr * sg, 0.0) : vec3((env.z - p.y) * sg, -Xr * sg, 0.0);
    return true;
  }
  // 면 부분 part가 p에서 판 끝 창을 지날 수 있는가(acrossPlane이 하나라도 참일 수 있는가: 아니면 창 평면 여덟을 보지 않는다)
  bool acrossAny(vec3 p, int part) {
    return ((part == 0 || part == 1) && p.x > X1) || (part == 1 && p.x > X0) || ((part == 0 || part == 2) && p.x < X0) || (part == 2 && p.x < X1);
  }
  // 구역 사각형 sa~sd(p 기준)의 변 k(0~3)와 p를 지나는 평면, 구역 안쪽이 + (light-model sectorsOf)
  vec3 sectorPlane(int k, vec3 sa, vec3 sb, vec3 sc, vec3 sd) {
    vec3 u = k == 0 ? sa : (k == 1 ? sb : (k == 2 ? sc : sd));
    vec3 v = k == 0 ? sb : (k == 1 ? sc : (k == 2 ? sd : sa));
    vec3 g = cross(u, v);
    return dot(g, sa + sb + sc + sd) >= 0.0 ? g : -g;
  }
  // 자르는 평면 j: g·x ≥ off 쪽만 남긴다(x: 받는 점 p 기준). 0 반구(x·n ≥ HORIZON, 늘), 1~4 구역 평면 g1~g4(mode 1, sectorPlane),
  // 5~12 판 끝 창(across일 때만, 면 부분 part). 쓰지 않으면 false
  bool cutPlane(int j, vec3 n, int mode, vec3 g1, vec3 g2, vec3 g3, vec3 g4, bool across, vec3 p, int part, out vec3 g, out float off) {
    g = vec3(0.0);
    off = 0.0;
    if (j == 0) {
      g = n;
      off = HORIZON;
      return true;
    }
    if (j < 5) {
      g = j == 1 ? g1 : (j == 2 ? g2 : (j == 3 ? g3 : g4));
      return mode > 0;
    }
    return across && acrossPlane(j - 5, p, part, g);
  }
  // 볼록 사각형 a~d(p 기준 꼭짓점) ∩ 자르는 평면들(mode −1 반구만, 0 반구·판 끝 창, 1 반구·구역 평면 g1~g4·판 끝 창)의
  // (F, M): F = (1/π)∫cosθ dω, M = (1/π)∫ω cosθ dω (light-model moments). 경계 선분 L: 0~3 사각형 변, 4~16 자르는 평면 L − 4가 사각형을 지나는 선분
  vec4 regionVF(vec3 a, vec3 b, vec3 c, vec3 d, vec3 n, int mode, vec3 g1, vec3 g2, vec3 g3, vec3 g4, vec3 p, int part) {
    bool across = mode >= 0 && acrossAny(p, part);
    // 쓰는 자르는 평면 수(반구 1, 구역 평면 넷, 판 끝 창 여덟)
    int nc = across ? 13 : (mode > 0 ? 5 : 1);
    // 사각형이 감기는 쪽(경계 선분은 영역이 왼쪽에 오게 감는다)
    vec3 N = cross(b - a, c - b);
    float fsum = 0.0;
    vec3 S = vec3(0.0);
    float om = 0.0;
    float edges = 0.0;
    for (int L = 0; L < 17; L++) {
      if (L >= 4 + nc) break;
      vec3 x0 = L == 0 ? a : (L == 1 ? b : (L == 2 ? c : d));
      vec3 x1 = L == 0 ? b : (L == 1 ? c : (L == 2 ? d : a));
      int own = -1;
      if (L >= 4) {
        own = L - 4;
        vec3 g;
        float off;
        if (!cutPlane(own, n, mode, g1, g2, g3, g4, across, p, part, g, off)) continue;
        // 사각형 변 위 두 교점(0은 안쪽으로 센다: 볼록 사각형이라 많아야 둘), 방향은 g × N(영역 쪽이 왼쪽)
        int got = 0;
        for (int e = 0; e < 4; e++) {
          vec3 e0 = e == 0 ? a : (e == 1 ? b : (e == 2 ? c : d));
          vec3 e1 = e == 0 ? b : (e == 1 ? c : (e == 2 ? d : a));
          float s0 = dot(g, e0) - off;
          float s1 = dot(g, e1) - off;
          if ((s0 < 0.0) != (s1 < 0.0)) {
            vec3 y = e0 + (e1 - e0) * (s0 / (s0 - s1));
            if (got == 0) x0 = y; else x1 = y;
            got++;
          }
        }
        if (got < 2) continue;
        if (dot(x1 - x0, cross(g, N)) < 0.0) {
          vec3 y = x0;
          x0 = x1;
          x1 = y;
        }
      }
      // 다른 자르는 평면들 안 부분 [t0, t1]
      float t0 = 0.0;
      float t1 = 1.0;
      for (int k = 0; k < 13; k++) {
        if (k >= nc) break;
        if (k == own) continue;
        vec3 g;
        float off;
        if (!cutPlane(k, n, mode, g1, g2, g3, g4, across, p, part, g, off)) continue;
        float s0 = dot(g, x0) - off;
        float s1 = dot(g, x1) - off;
        if (s0 < 0.0 && s1 < 0.0) {
          t1 = -1.0;
          break;
        }
        if (s0 < 0.0) t0 = max(t0, s0 / (s0 - s1));
        else if (s1 < 0.0) t1 = min(t1, s0 / (s0 - s1));
      }
      if (t1 <= t0) continue;
      // 변 적분(light-model moments): 꼭짓점 방향 u0 → u1
      vec3 u0 = normalize(x0 + (x1 - x0) * t0);
      vec3 u1 = normalize(x0 + (x1 - x0) * t1);
      float cs = clamp(dot(u0, u1), -1.0, 1.0);
      vec3 cr = cross(u0, u1);
      float sn = length(cr);
      if (sn > 1e-7) {
        float th = atan(sn, cs);
        vec3 m = cr / sn;
        fsum += th * dot(m, n);
        vec3 W = u0 * sn + (u1 - cs * u0) * ((1.0 - cs) / sn);
        S += m * dot(n, W) + W * dot(m, n);
        // 입체각: n을 꼭짓점으로 한 구면 삼각형(n, u0, u1)의 부호 있는 넓이 합(영역이 반구 안이라 n은 늘 같은 쪽)
        om += 2.0 * atan(dot(n, cr), 1.0 + dot(n, u0) + cs + dot(n, u1));
        edges += 1.0;
      }
    }
    if (edges < 2.5) return vec4(0.0);
    float sg = fsum < 0.0 ? -1.0 : 1.0;
    vec3 M = (n * abs(om) / 3.0 + S * (sg / 6.0)) / PI;
    return vec4(abs(fsum) / (2.0 * PI), M);
  }


  // 판 범위 둘레 사각형 k(light-model envQuads part 'in'): 0 벽(이 줄 높이), 1 판 윗면, 2 위 판 아랫면, 가로 xa ~ xb(판 범위 안).
  // 면의 앞쪽(빛을 받는 쪽)에서만 보인다. 받는 점 p 기준 꼭짓점과 밝기, 없으면 false
  bool envQuad(int k, vec3 p, float xa, float xb, out vec3 a, out vec3 b, out vec3 c, out vec3 d, out vec3 rad) {
    float zf = -FRONT - p.z;
    float z = DEPTH - p.z;
    xa -= p.x;
    xb -= p.x;
    a = vec3(0.0); b = vec3(0.0); c = vec3(0.0); d = vec3(0.0); rad = vec3(0.0);
    if (k == 0) {
      float y0 = max(env.y, -FARV) - p.y;
      float y1 = min(env.z, FARV) - p.y;
      if (z <= 0.0) return false;
      a = vec3(xa, y0, z); b = vec3(xb, y0, z); c = vec3(xb, y1, z); d = vec3(xa, y1, z);
      rad = RADW;
      return true;
    }
    bool top = k == 1;
    float Y = top ? env.y : env.z;
    if (top ? Y <= -FARV : Y >= FARV) return false;
    // 판 윗면은 그 위에서, 아랫면은 그 아래에서
    if (top ? p.y <= Y : p.y >= Y) return false;
    float y = Y - p.y;
    a = vec3(xa, y, zf); b = vec3(xb, y, zf); c = vec3(xb, y, z); d = vec3(xa, y, z);
    rad = top ? RADF : RADU;
    return true;
  }
  // 사각형 하나(꼭짓점 a~d: 받는 점 기준)의 보이는 넓이: 반구로 자르고, 판 끝 너머 면이면 판 끝 창으로(part: acrossPlane)
  vec4 quadVF(vec3 a, vec3 b, vec3 c, vec3 d, vec3 n, vec3 p, int part) {
    return regionVF(a, b, c, d, n, 0, vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), p, part);
  }
  // 둘레 사각형 하나(t: 판 범위 면 3 × 가로 칸 1, 그다음 틀 안쪽 면 둘, 판 끝 너머 벽 둘, 판 끝면 넷). 받는 점 p 기준 꼭짓점·밝기·면 부분,
  // 판 범위 면이면 which(0 벽, 1 판 윗면, 2 위 판 아랫면)와 칸 col. 쓰지 않는 사각형이면 false. envLoss와 behindOf(구역, whole: 판 범위 통째 X0 ~ X1)가 같이 쓴다
  const int SECT_IN = 1;
  bool envSector(int t, vec3 p, int ncol, bool whole, out vec3 a, out vec3 b, out vec3 c, out vec3 d, out vec3 rad, out int part, out int which, out int col) {
    a = vec3(0.0); b = vec3(0.0); c = vec3(0.0); d = vec3(0.0); rad = vec3(0.0); part = 3; which = -1; col = -1;
    if (t < 3 * SECT_IN) {
      int k = t / SECT_IN;
      int j = t - k * SECT_IN;
      if (j >= ncol) return false;
      float xa = whole ? X0 : X0 + (X1 - X0) * float(j) / float(ncol);
      float xb = whole ? X1 : X0 + (X1 - X0) * float(j + 1) / float(ncol);
      part = 0; which = k; col = k * 0 + j + 1;
      return envQuad(k, p, xa, xb, a, b, c, d, rad);
    }
    float z = DEPTH - p.z;
    float zf = -FRONT - p.z;
    int s = t - 3 * SECT_IN;
    if (s < 2) {
      // 틀 안쪽 면 둘(앞 끝 ~ 벽, light-model envQuads part 'side'): 틀이 있을 때만
      if (env.x <= 1.5) return false;
      float X = s == 0 ? X0 : X1;
      if (s == 0 ? p.x <= X : p.x >= X) return false;
      float zs = -FFRONT - p.z;
      float y0 = max(env.y, -FARV) - p.y;
      float y1 = min(env.z, FARV) - p.y;
      float x = X - p.x;
      a = vec3(x, y0, z); b = vec3(x, y0, zs); c = vec3(x, y1, zs); d = vec3(x, y1, z);
      rad = s == 0 ? RADSL : RADSR;
      return true;
    }
    // 틀이 있으면 판 끝 너머는 없다
    if (env.x > 1.5) return false;
    if (s < 4) {
      // 판 끝 너머 벽: 판이 없어 위아래로 열려 있다(가림 없는 벽 밝기)
      if (z <= 0.0) return false;
      int side = s - 2;
      float xa = (side == 0 ? -FARV : X1) - p.x;
      float xb = (side == 0 ? X0 : FARV) - p.x;
      a = vec3(xa, -FARV, z); b = vec3(xb, -FARV, z); c = vec3(xb, FARV, z); d = vec3(xa, FARV, z);
      rad = RADW; part = side + 1; which = 0; col = side == 0 ? 0 : 2 - 1;
      return true;
    }
    // 판 끝면(판 끝 너머에서만 보인다): 아래 판(판 윗면 아래 두께), 위 판(위 판 아랫면 위 두께)
    int pl = (s - 4) / 2;
    int side = s - 4 - pl * 2;
    if (pl == 0 ? env.y <= -FARV : env.z >= FARV) return false;
    float X = side == 0 ? X0 : X1;
    if (side == 0 ? p.x >= X : p.x <= X) return false;
    float ya = pl == 0 ? env.y - THICK : env.z;
    float yb = pl == 0 ? env.y : env.z + THICK;
    float x = X - p.x;
    a = vec3(x, ya - p.y, z); b = vec3(x, ya - p.y, zf); c = vec3(x, yb - p.y, zf); d = vec3(x, yb - p.y, z);
    rad = RADE;
    return true;
  }
  vec3 envLoss(vec3 p, vec3 n) {
    if (env.x < 0.5) return vec3(0.0);
    vec3 loss = vec3(0.0);
    int ncol = 1;
    // 판 범위 면(가로 ncol칸: 격자가 있으면 칸마다 대표 점으로 읽는다), 틀 안쪽 면, 판 끝 너머 벽, 판 끝면 차례로(quadVF 한 곳)
    for (int t = 0; t < 3 * SECT_IN + 8; t++) {
      vec3 a; vec3 b; vec3 c; vec3 d; vec3 rad; int part; int which; int col;
      if (!envSector(t, p, ncol, false, a, b, c, d, rad, part, which, col)) continue;
      vec4 q = quadVF(a, b, c, d, n, p, part);
      if (q.x > 0.0) {
        vec3 r = rad;
        loss += skyOf(q) - r * q.x;
      }
    }
    return loss;
  }


  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec3 vnoise(vec2 x) {
    vec2 i = floor(x);
    vec2 fr = x - i;
    vec2 w = fr * fr * (3.0 - 2.0 * fr);
    vec2 dw = 6.0 * fr * (1.0 - fr);
    float a = hash12(i) * 2.0 - 1.0;
    float b = hash12(i + vec2(1.0, 0.0)) * 2.0 - 1.0;
    float c = hash12(i + vec2(0.0, 1.0)) * 2.0 - 1.0;
    float d = hash12(i + vec2(1.0, 1.0)) * 2.0 - 1.0;
    float k = a - b - c + d;
    return vec3(a + (b - a) * w.x + (c - a) * w.y + k * w.x * w.y, dw.x * (b - a + k * w.y), dw.y * (c - a + k * w.x));
  }
  float seenOf(float size, float fp) { return smoothstep(0.0, 1.0, clamp((size / max(fp, 1e-9) - 2.0) / 2.0, 0.0, 1.0)); }
  const float FIBW = 0.419375000;
  const float FIBL = 1.67750000;
  float pulseInt(float x, float q) { return floor(x) * q + clamp(fract(x) - (1.0 - q), 0.0, q); }
  float pulseCover(float x, float q, float w) {
    if (w < 1e-6) return fract(x) >= 1.0 - q ? 1.0 : 0.0;
    return (pulseInt(x + w * 0.5, q) - pulseInt(x - w * 0.5, q)) / w;
  }
  vec4 matSample(vec2 uv, vec2 fp, vec2 mR, vec4 mB, vec4 mG, vec2 mS) {
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
        // 보이지 않는 무늬(seen 0)는 잡음을 계산하지 않는다: 화소마다 도는 일이라 값이 같으면 비용만 줄인다
        if (seen > 0.0) {
          vec3 g = vnoise(vec2(u * mB.x, v * mB.y));
          su = mB.z * g.y * mB.x * seen;
          sv = mB.z * g.z * mB.y * seen;
        }
      }
    }
    float a = mR.x * mR.x;
    float r = sqrt(sqrt(a * a + 2.0 * mR.y * mR.y * (1.0 - seen * seen)));
    float fm = max(fp.x, fp.y);
    float f = 1.0;
    float s1 = mS.x;
    float s2 = mS.y;
    if (mG.x > 0.5 && mG.x < 1.5) {
      float g1 = seenOf(s1, fm);
      float g2 = seenOf(s2, fm);
      if (g1 > 0.0) f += mG.y * vnoise(vec2(u, v) / s1).x * g1;
      if (g2 > 0.0) f += mG.z * vnoise(vec2(u / s2 + 17.0, v / s2 + 31.0)).x * g2;
      // 짧은 섬유(surface-pattern fiberPattern·fiberSeen과 같은 식)
      float fs = smoothstep(0.0, 1.0, clamp((FIBW / max(fm, 1e-9) - 0.1) / 0.25, 0.0, 1.0)) * smoothstep(0.0, 1.0, clamp((min(fp.x, fp.y) / max(fm, 1e-9) - 0.2) / 0.25, 0.0, 1.0));
      if (mG.w > 0.0 && fs > 0.0) {
        float na = vnoise(vec2((0.94 * u + 0.34 * v) / FIBL + 5.0, (-0.34 * u + 0.94 * v) / FIBW + 9.0)).x;
        float nb = vnoise(vec2((0.82 * u - 0.57 * v) / FIBL + 41.0, (0.57 * u + 0.82 * v) / FIBW + 23.0)).x;
        f += mG.w * 0.5 * (na * abs(na) + nb * abs(nb)) * fs;
      }
    } else if (mG.x > 1.5 && mG.x < 2.5) {
      float k = 2.0 * PI / s1;
      f += mG.y * cos(k * u) * cos(k * v) * seenOf(s1 * 0.5, fm) + mG.z * vnoise(vec2(u / s2 + 17.0, v / s2 + 31.0)).x * seenOf(s2, fm);
    } else if (mG.x > 2.5 && mG.x < 3.5) {
      f += mG.y * vnoise(vec2(u / s1 + 13.0, v / (30.0 * s1))).x * seenOf(2.0 * s1, fp.x);
      float w = mG.w;
      float k0 = floor(u / s2);
      float cover = 0.0;
      for (int j = -1; j <= 1; j++) {
        float kk = k0 + float(j);
        float b = (kk + 0.5 + 0.35 * (hash12(vec2(kk, 3.0)) * 2.0 - 1.0)) * s2;
        cover += max(0.0, min(b + w * 0.5, u + fp.x * 0.5) - max(b - w * 0.5, u - fp.x * 0.5));
      }
      f -= mG.z * (min(1.0, cover / max(fp.x, 1e-6)) - w / s2);
    } else if (mG.x > 4.5) {
      // 린넨 실(surface-pattern linenPattern과 같은 식)
      f += mG.z * vnoise(vec2(u / s2 + 17.0, v / s2 + 31.0)).x * seenOf(s2, fm);
      float fs = smoothstep(0.0, 1.0, clamp((FIBW / max(fm, 1e-9) - 0.1) / 0.25, 0.0, 1.0)) * smoothstep(0.0, 1.0, clamp((min(fp.x, fp.y) / max(fm, 1e-9) - 0.2) / 0.25, 0.0, 1.0));
      if (mG.w > 0.0 && fs > 0.0) {
        float na = vnoise(vec2(u / FIBL + 5.0, v / FIBW + 9.0)).x;
        float nb = vnoise(vec2(u / FIBW + 41.0, v / FIBL + 23.0)).x;
        f += mG.w * 0.5 * (na * abs(na) + nb * abs(nb)) * fs;
      }
    } else if (mG.x > 3.5) {
      float warp = vnoise(vec2(u / (40.0 * s1), v / (4.0 * s1) + 5.0)).x * 1.5;
      f -= mG.y * (pulseCover(v / s1 + warp, 0.25, fp.y / s1) - 0.25);
      // 가는 결(surface-pattern과 같은 식)
      if (mG.w > 0.0) {
        float s3 = s1 * 0.430000000;
        f -= mG.w * (pulseCover(v / s3 + warp * 2.3 + 3.1, 0.3, fp.y / s3) - 0.3);
      }
      f += mG.z * vnoise(vec2(u / s2 + 11.0, v * 6.0 / s2)).x * seenOf(s2 / 6.0, fp.y);
    }
    return vec4(su, sv, f, r);
  }


  uniform float DODGE;      // 겹: 0 곱하기 · 1 닷지 · 2 한 번에(단색 재질) · 3 반사광 더하기
  uniform float SPLIT;
vec4 _tex(vec2 q) {
  vec3 t = texMat * vec3(q, 1.0);
  vec2 uv = (t.xy / t.z) / texSize;
  if (texDecal > 0.5 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) return vec4(0.0);
  return texture(tex, uv);
}
vec4 _keyTex(vec2 q) {
  vec3 t = keyTexMat * vec3(q, 1.0);
  vec2 uv = (t.xy / t.z) / keyTexSize;
  if (keyTexDecal > 0.5 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) return vec4(0.0);
  return texture(keyTex, uv);
}
vec4 _tex2(vec2 q) {
  vec3 t = tex2Mat * vec3(q, 1.0);
  vec2 uv = (t.xy / t.z) / tex2Size;
  if (tex2Decal > 0.5 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) return vec4(0.0);
  return texture(tex2, uv);
}
      // 1이면 곱하기·닷지가 확산 몫만(반사광은 겹 3)
  float plankKey(vec3 p) { return keyOn < 0.5 ? 0.0 : plankKeyOf(p); }
  // 카메라: 노출과 필름형 톤 곡선(light-model tone·toneInv)
  const float EXPO = 1.00000000;
  const float TTOE = 0.180000000;
  const float TK = 0.150000000;
  const float TSH = 0.950000000;
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
  float ggxKey(vec3 n, vec3 v, float rough) {
    float nl = dot(n, LU);
    float nv = dot(n, v);
    if (nl <= 0.0 || nv <= 0.0) return 0.0;
    vec3 hh = normalize(v + LU);
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
  const float RIMR = 6.10000000;
  const float RIMC = 6.00000000;
  // 점 P(법선 n, 재질 색 a, 하늘 가림 loss: 선형 RGB)의 빛. 눈 쪽 방향 v, eref: 그 재질의 대표 자리 빛. 채널마다 계산한다
  // 받는 빛 = 하늘·천장·창빛(위 판이 가린 창빛 몫 빼고) − 하늘 가림. 반사광 = 거울 방향의 둘레·하늘(이웃 책의 반사는 뺀다) + GGX 창빛
  // rough: 표면 거칠기(재질, 그리지 못한 미세 높이 몫 포함), alb: 반사율 결(배수, 평균 1),
  // kx: 책이 창빛 원반을 가리는 몫(위 판이 가리고 남은 빛에서, 벽 그림자 그림),
  // sref: 그 재질이 대표 자리에서 받는 반사광(장면 밝기, light-model SREF): 재질 색 a는 반사광까지 넣은 '보이는 색'이라 확산 몫은 toneInv(a) − sref
  // kS: 재질의 표면 반사 몫 배수(materials specular)
  vec4 shade(vec3 P, vec3 n, vec3 nf, vec3 v, vec3 lossIn, vec3 a, vec3 eref, float rough, float alb, float kx, vec3 sref, float kS) {
    vec3 loss = lossIn * OCC;
    float kb = 1.0 - (1.0 - plankKey(P)) * (1.0 - kx);
    // 가림(loss)은 면 법선 nf에서 구운 값: 둥근 모서리·구멍 벽처럼 법선이 기운 곳은 면이 받는 빛의 비율로(light-model lightWithLoss)
    vec3 e0 = skyIrr(n) + KEYC * (DIFF * max(0.0, dot(n, LU)) * (1.0 - kb));
    vec3 e0f = skyIrr(nf) + KEYC * (DIFF * max(0.0, dot(nf, LU)) * (1.0 - kb));
    // 하늘 가림은 그 면이 받는 하늘 빛보다 클 수 없다(light-model lightWithLoss): 아주 좁은 틈에서 해석 값이 넘는 것은 겹친 가리개가 같은 하늘을
    // 두 번 센 오차라 하늘 색이다. 넘친 몫(하늘 빛에 대한 비)만큼 하늘 빛을 세 채널에서 똑같이 빼 되비친 빛의 채널 차이는 그대로 둔다
    vec3 sky = skyIrr(nf);
    vec3 ov = (loss - sky) / max(sky, vec3(1e-4));
    vec3 lossB = loss - max(0.0, max(ov.x, max(ov.y, ov.z))) * sky;
    vec3 E = e0 * max(vec3(0.0), e0f - lossB) / max(e0f, vec3(1e-4));
    // 반사광도 둘레가 가린 만큼 가려진다(거친 면은 반사 방향이 넓어 하늘이 보이는 몫 = 확산 몫과 같다): 좁은 틈 안은 반사광도 없다
    vec3 vis = clamp((sky - lossB) / max(sky, vec3(1e-4)), 0.0, 1.0);
    float ks = envBRDF(max(0.0, dot(n, v)), rough) * kS;
    vec3 r = E * (1.0 - ks) * alb / eref;
    // 화면 색 = tone(노출 × ((toneInv(a) − sref) × r + 반사광))(light-model toneTarget). 곱하기·닷지 두 겹으로 그 색이 되게:
    // 곱하기가 화면 색을 base까지 내리고 닷지가 target까지 올린다. base는 확산 몫(반사광 없이)이되, 8비트 화면 버퍼에서 닷지가 올릴 수 있게
    // target의 1/4보다 낮추지 않는다(확산 몫이 0인 채널은 곱하기에서 0이 되면 닷지가 반사광을 더하지 못한다)
    vec3 am = max(a, vec3(1e-4));
    vec3 sa = max(vec3(0.0), vec3(toneInv(am.x), toneInv(am.y), toneInv(am.z)) - sref) * r * EXPO;
    vec3 spec = (ks * envLobe(P, reflect(-v, n), rough) * vis + KEYC * (ggxKey(n, v, rough) * kS * DIFF * (1.0 - kb))) / ECAM;
    vec3 st = sa + spec * EXPO;
    vec3 t0 = vec3(toneF(sa.x), toneF(sa.y), toneF(sa.z));
    vec3 target = vec3(toneF(st.x), toneF(st.y), toneF(st.z));
    if (DODGE > 2.5) return vec4(vec3(max(vec3(0.0), pow(target, vec3(IG)) - pow(t0, vec3(IG)))), 1.0);
    if (SPLIT > 0.5) target = t0;
    vec3 base = min(am, max(t0, 0.25 * target));
    vec3 m = pow(min(vec3(1.0), base / am), vec3(IG));
    if (DODGE < 0.5) return vec4(vec3(m), 1.0);
    vec3 s = vec3(0.0);
    for (int c = 0; c < 3; c++) {
      float b = c == 0 ? base.x : (c == 1 ? base.y : base.z);
      float t = c == 0 ? target.x : (c == 1 ? target.y : target.z);
      float sc = t > b && t > 0.0 ? 1.0 - pow(b / t, IG) : 0.0;
      if (c == 0) s.x = sc; else if (c == 1) s.y = sc; else s.z = sc;
    }
    // 한 번에 칠하기(DODGE 2): 곱하기·닷지 두 겹과 같은 이득
    if (DODGE > 1.5) return vec4(vec3(m / max(vec3(1e-4), 1.0 - s)), 1.0);
    return vec4(vec3(s), 1.0);
  }

  // 안쪽 모서리 곡면(light-model coveNormal): 벽·틀·판이 맞닿는 곳에서 면 법선이 맞닿은 면 법선 쪽으로 돈다
  float jointF2(float h) {
    float d = max(0.0, h);
    return 0.175000000 * (1.0 - d / sqrt(d * d + 393.030625));
  }
  float coveB(float d, float end) {
    float t = max(0.0, d);
    return t < 9.15000000 ? tan(end * (1.0 - t / 9.15000000)) : 0.0;
  }
  // 안쪽 모서리 번짐: 뒷벽·천장·판 윗면은 맞닿은 면 위에 그려진다. 실제 모서리는 곡면이라 한 면의 빛이 다른 면의 빛으로 서서히 넘어가므로, 그린 면이 모서리 쪽에서 투명해져 밑면이 비치게 한다.
  // 면 좌표: 뒷벽은 (x, y), 천장·판 윗면은 (x, z × 눌림): 화면에서 눌린 깊이를 눌린 만큼 줄여 폭이 화면에서 같게 보인다. 둥근 사각형 안쪽 거리라 꼭지점도 둥글다
  float softEdge(vec3 P) {
    vec2 u = abs(tN.z) > 0.5 ? P.xy : vec2(P.x, P.z * 0.0454545455);
    float front = 0.0;
    if (tN.y > 0.5) {
      // 앞 끝은 맞닿은 면으로 번지지 않는다(판 앞면과 만나는 곧은 끝)
      front = 1.0 - smoothstep(-46.4250000, -16.4250000, P.z);
    }
    vec2 c2 = vec2(softBox.x + softBox.y, softBox.z + softBox.w) * 0.5;
    vec2 q = abs(u - c2) - (vec2(softBox.y - softBox.x, softBox.w - softBox.z) * 0.5 - vec2(softR.x));
    float d = softR.x - length(max(q, vec2(0.0))) - min(max(q.x, q.y), 0.0);
    return max(front, smoothstep(0.0, softR.y, d));
  }
  // 평면 위 점 Q가 그려지는 캔버스 자리: 사상 P = (O + p.x Ux + p.y Vy) / w의 역(면 안 두 축 Au, Av로 푼다)
  vec2 pxOf(vec3 Q, vec3 Au, vec3 Av) {
    vec3 A = Ux - Q * Hw.x;
    vec3 B = Vy - Q * Hw.y;
    vec3 C = Q * Hw.z - O;
    float a = dot(A, Au);
    float b = dot(B, Au);
    float c = dot(A, Av);
    float d = dot(B, Av);
    float e = dot(C, Au);
    float g = dot(C, Av);
    return vec2(e * d - b * g, a * g - e * c) / (a * d - b * c);
  }
  vec3 coveOf(vec3 P) {
    vec3 c = vec3(0.0);
    if (env.x < 1.5 || false || P.z < -56.9250000 || (abs(tN.z) > 0.5 && P.z < -52.8750000)) return c;
    if (abs(tN.y) < 0.5) c.y += coveB(P.y - env.y, 0.436332313) - coveB(env.z - P.y, 0.436332313);
    if (abs(tN.x) < 0.5 && tN.y > -0.5) c.x += coveB(P.x - 0.00000000, 0.785398163) - coveB(366.000000 - P.x, 0.785398163);
    return c;
  }
  // 판 윗면 쪽 곡면만(아래 모서리): 옆벽·천장 모서리를 이어 그리는 곳에서도 판 쪽 곡면은 그대로 둔다
  float coveFloor(vec3 P) {
    if (env.x < 1.5 || false || P.z < -56.9250000 || (abs(tN.z) > 0.5 && P.z < -52.8750000) || abs(tN.y) > 0.5) return 0.0;
    return coveB(P.y - env.y, 0.436332313);
  }
  
void main() {
  vec2 p = FlutterFragCoord().xy;

    float w = dot(Hw, vec3(p, 1.0));
    vec3 P = wallOutside((O + p.x * Ux + p.y * Vy) / w, tN);
    // 화소 한 칸이 평면에서 덮는 길이(사상의 미분): 재질 무늬를 화소 크기로 거른다
    vec3 JX = (Ux - P * Hw.x) / w;
    vec3 JY = (Vy - P * Hw.y) / w;
    float b0 = slope(arc(bev0.w - dot(P, bev0.xyz), PLANKR));
    float b1 = slope(arc(bev1.w - dot(P, bev1.xyz), PLANKR));
    // 판 앞면 양 끝: 윤곽(PLANK_END_R)과 같은 반지름으로 법선이 옆으로 돈다. 윤곽만 둥글고 빛이 평면이면 곡면으로 보이지 않는다(2026-11-05 사용자 '선반 끝 곡선')
    float be = endR > 0.0 ? slope(arc(366.000000 - P.x, endR)) - slope(arc(P.x - 0.00000000, endR)) : 0.0;
    // 안쪽 모서리 곡면(Flutter 2026-11-15 사용자 '벽 이음새가 부자연스럽다'): 옆벽·천장·뒷벽이 맞닿은 모서리 선 위 점은 두 면에 같은 점이고
    // 곡면에서는 같은 법선(두 면의 이등분)이라 빛이 같아야 한다. 면마다 평평한 법선으로 따로 구워 모서리에서 값이 어긋났다(옆벽 188 / 뒷벽 201, 천장 150 / 옆벽 180).
    // 곡면 폭(COVE_R) 안에서는 법선과 가림을 모서리 선 위 점(이등분 법선)에서 잰 값으로 옮겨 간다: 두 면이 같은 식이라 모서리에서 값이 같다.
    // 책·접촉 그늘 몫(구운 값 − 둘레 몫)은 그 면 것을 그대로 더한다. 판 윗면 쪽 모서리는 하지 않는다(책 뒤 그늘이 모이는 곳)
    // 두 모서리가 만나는 꼭지점 근처는 두 모서리를 거리 비율로 함께 섞는다(가까운 하나만 고르면 거리가 같은 대각선에서 값이 바뀌어 밝은 대각선이 생겼다)
    float filA = 0.0;
    float filB = 0.0;
    vec3 filPA = P;
    vec3 filNA = tN;
    vec3 filPB = P;
    vec3 filNB = tN;
    if (env.x > 1.5 && P.z > -FFRONT + 0.5) {
      float R = 9.15000000;
      float h = 0.70710678;
      float dl = max(0.0, P.x - 0.00000000);
      float dr = max(0.0, 366.000000 - P.x);
      float dc = max(0.0, env.z - P.y);
      float db = max(0.0, DEPTH - P.z);
      // A: 세로 모서리(옆벽 쪽), B: 위 모서리(천장 쪽). 천장 자신은 A = 옆벽 쪽, B = 뒷벽 쪽
      if (tN.z < -0.5 && P.z > DEPTH - 1.0) {
        if (dl < dr) { filA = 1.0 - dl / R; filPA = vec3(0.00000000, P.y, DEPTH); filNA = vec3(h, 0.0, -h); }
        else { filA = 1.0 - dr / R; filPA = vec3(366.000000, P.y, DEPTH); filNA = vec3(-h, 0.0, -h); }
        filB = 1.0 - dc / R; filPB = vec3(P.x, env.z, DEPTH); filNB = vec3(0.0, -h, -h);
      } else if (abs(tN.x) > 0.5) {
        float xs = tN.x > 0.0 ? 0.00000000 : 366.000000;
        filA = 1.0 - db / R; filPA = vec3(xs, P.y, DEPTH); filNA = vec3(tN.x * h, 0.0, -h);
        filB = 1.0 - dc / R; filPB = vec3(xs, env.z, P.z); filNB = vec3(tN.x * h, -h, 0.0);
      } else if (tN.y < -0.5) {
        if (dl < dr) { filA = 1.0 - dl / R; filPA = vec3(0.00000000, env.z, P.z); filNA = vec3(h, -h, 0.0); }
        else { filA = 1.0 - dr / R; filPA = vec3(366.000000, env.z, P.z); filNA = vec3(-h, -h, 0.0); }
        filB = 1.0 - db / R; filPB = vec3(P.x, env.z, DEPTH); filNB = vec3(0.0, -h, -h);
      }
      // 섞는 몫은 부드러운 계단(smoothstep): 곧은 몫(1 − d/R)이면 곡면 폭 끝에서 밝기 기울기가 꺾여 세로 선(마하 띠)으로 보였다
      filA = clamp(filA, 0.0, 1.0);
      filB = clamp(filB, 0.0, 1.0);
      filA = filA * filA * (3.0 - 2.0 * filA);
      filB = filB * filB * (3.0 - 2.0 * filB);
    }
    float filT = max(filA, filB);
    vec3 n0 = normalize(tN + bev0.xyz * b0 + bev1.xyz * b1 + vec3(be, 0.0, 0.0));
    vec3 n = filT > 0.0
      ? normalize(n0 + (filNA - tN) * filA + (filNB - tN) * filB + vec3(0.0, coveFloor(P), 0.0))
      : normalize(tN + bev0.xyz * b0 + bev1.xyz * b1 + coveOf(P) + vec3(be, 0.0, 0.0));
    float rimLoss = 0.0;
    // 구멍 앞 끝 둥근 테(반지름 RIMR): 구멍(둥근 사각형, 모서리 RIMC)까지 거리 d로 벽 법선이 구멍 안쪽 면 법선 쪽으로 돈다
    if (rim.x < rim.y) {
      vec2 c = vec2(rim.x + rim.y, rim.z + rim.w) * 0.5;
      vec2 s = sign(P.xy - c);
      vec2 q = abs(P.xy - c) - (vec2(rim.y - rim.x, rim.w - rim.z) * 0.5 - vec2(RIMC));
      vec2 qp = max(q, vec2(0.0));
      float d = length(qp) + min(max(q.x, q.y), 0.0) - RIMC;
      // 구멍 가장자리 화소(흐림, d ≤ 0)도 테 끝 법선이다: 평평한 벽 법선이면 밝은 색이 안쪽 면과 섞여 1px 밝은 줄이 된다
      if (d < RIMR) {
        vec2 g = length(qp) > 1e-4 ? qp / length(qp) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
        // 원호 단면(앞에서 본 자리 sin θ = t): 벽 쪽은 천천히, 안쪽 끝에서 빠르게 돌아 테가 또렷하게 꺾인다(2026-11-05 사용자 사진, 제곱근으로 돌리면 넓게 번져 흐릿했다).
        // 끝은 안쪽 면 법선까지 다 돌지 않는다: 테는 맞닿은 면의 되비침을 받지 않아 다 돌리면 안쪽 면보다 어두운 줄이 생긴다(천장 앞 90°면 테 끝 180, 천장 189). 옆 76°, 위 70°면 테 끝과 안쪽 면·천장 밝기가 이어진다
        float rimT = min(1.0, 1.0 - d / RIMR);
        float th = mix(0.844444444, 0.777777778, g.y * g.y) * asin(rimT);
        n = normalize(tN * cos(th) - vec3(g * s, 0.0) * sin(th));
        // 옆 테만 안쪽 면처럼 위 면 아래에서 어두워진다(위 테는 그 면 자체다). 안쪽 끝에 몰린다(벽 쪽은 방을 그대로 본다), 위 판 높이 위로는 없다(판이 테보다 뒤라 가리지 않는다)
        rimLoss = P.y < rimCeil ? rimT * rimT * rimT * (1.0 - g.y * g.y) * jointF2(rimCeil - P.y) : 0.0;
      }
    }
    // 면 좌표: u = 판 길이 방향(x, 옆을 향한 틀 안쪽 면은 세로: 결이 틀 길이로 난다), v = 면 안의 다른 방향
    vec3 Au = abs(tN.x) > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 Av = normalize(cross(tN, Au));
    vec2 fp = vec2(max(abs(dot(JX, Au)), abs(dot(JY, Au))), max(abs(dot(JX, Av)), abs(dot(JY, Av))));
    // 나무 판 윗면은 나이테를 넓게 자른 면이라 결이 앞면보다 넓다(한 나이테 함수를 자른 방향만 다르다)
    float vk = mG.x > 3.5 && mG.x < 4.5 && tN.y > 0.5 ? 0.0714285714 : 1.0;
    vec4 ms = matSample(vec2(dot(P, Au), dot(P, Av) * vk) + mSeed, vec2(fp.x, fp.y * vk), mR, mB, mG, mS);
    n = normalize(n - ms.x * Au - ms.y * Av);
    // 틀 면을 구운 범위 밖으로 늘려 그린 곳(뒷벽 번짐 밑, 가장자리 화소 밑): 그대로 읽으면 아틀라스 옆 칸 값이다. 범위 끝 자리(칸 반 개 안쪽)의 구운 값을 읽어 면 끝 밝기가 그대로 이어진다
    bool beyond = env.x > 1.5 && abs(tN.z) < 0.5 && tN.y < 0.5 && (P.z > DEPTH + 0.01 || P.z < -FFRONT - 0.01 || (abs(tN.x) > 0.5 && P.y > env.z + 0.01));
    vec3 Pb = beyond ? vec3(P.x, abs(tN.x) > 0.5 ? min(P.y, env.z - 1.50000000) : P.y, clamp(P.z, -FFRONT + 6.50000000, DEPTH - 6.50000000)) : P;
    vec2 pb = beyond && liveEnv < 0.5 ? pxOf(Pb, Au, Av) : p;
    vec3 loss = liveEnv > 0.5 ? envLoss(Pb, tN) : lossDec(vec3(_tex(pb).rgb), skyIrr(tN));
    if (liveEnv < 0.5 && mixT < 1.0) loss = mix(lossDec(vec3(_tex2(pb).rgb), skyIrr(tN)), loss, mixT);
    if (rimLoss > 0.0) loss += rimLoss * (skyIrr(tN) + KEYC * (DIFF * max(0.0, dot(tN, LU)))) / OCC;
    vec3 nfF = tN;
    if (filT > 0.0) {
      // 모서리 선 위 점은 두 면 위에 있어 그대로 재면 면이 자기를 가린다: 이등분 법선 쪽으로 조금 띄운다. 두 모서리 값은 섞는 몫대로 평균
      vec3 own = max(vec3(0.0), loss - envLoss(P, tN));
      vec3 tgt = vec3(0.0);
      if (filA > 0.0) tgt += envLoss(filPA + filNA * 0.3, filNA) * filA;
      if (filB > 0.0) tgt += envLoss(filPB + filNB * 0.3, filNB) * filB;
      loss = mix(loss, tgt / (filA + filB) + own, filT);
      nfF = normalize(tN + (filNA - tN) * filA + (filNB - tN) * filB);
    }
    vec4 g = shade(P, n, nfF, normalize(vec3(cam4.x, cam4.y, cam4.z - cam4.w) - P), loss, albedo, eref, ms.w, ms.z, float(_keyTex(vec2(dot(P, kU), dot(P, kV)) + kO).a), sref, kS);
    if (DODGE > 1.5) {
      float softA = softR.y > 0.0 ? softEdge(P) : 1.0;
      { fragColor = vec4(vec3(min(base * vec3(g.rgb), vec3(1.0))) * softA, softA); return; }
    }
    { fragColor = g; return; }
  }
