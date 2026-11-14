#version 460 core
// 이 파일은 tool/gen_shaders.sh 가 만든다. 손으로 고치지 말 것(출처: ../app/src/ui/scene-light-sksl.ts)
#include <flutter/runtime_effect.glsl>

precision highp float;
layout(location = 0) out vec4 fragColor;



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


  uniform vec4 box[160];
  uniform float nBox;


  uniform sampler2D grid;
  uniform vec2 gridSize;   // 그림 칸 수(SkSL 화소 좌표를 0~1로 바꾼다)
  uniform mat3 gridMat;    // 그리는 좌표 → 그림 칸(SkSL에서는 자식 그림에 붙인 행렬)
  uniform float gridDecal; // 1이면 그림 밖은 비워 둔다(SkSL TileMode.Decal)      // 빛 격자 그림(GRID_SCALE), gridOn < 0.5면 읽지 않는다(가리개는 가림 없는 받는 빛: 격자 풀기 첫 번)
  uniform float gridOn;
  uniform float gridNx;     // 둘레 면 가로 칸 수(책이 없으면 1)
  const float GN = 8.0;
  const float ENY = 16.0;
  const float GSCALE = 1.50000000;
  const float ENVL = 175.375000;
  uniform vec3 ALB_WALL;   // 맞추기 값(벽·판 반사율)
  uniform vec3 ALB_PLANK;
vec4 _grid(vec2 q) {
  vec3 t = gridMat * vec3(q, 1.0);
  vec2 uv = (t.xy / t.z) / gridSize;
  if (gridDecal > 0.5 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) return vec4(0.0);
  return texture(grid, uv);
}

  float chebIndex(float t, float n) { return (n - 1.0) * acos(1.0 - 2.0 * clamp(t, 0.0, 1.0)) / PI; }
  // 블록 (bx, by)의 칸 좌표 (su, sv) 겹선형 값(칸 가운데 사이를 그림의 선형 읽기로)
  vec3 gridAt(float bx, float by, float su, float sv, float nu, float nv) {
    return vec3(_grid(vec2(bx + clamp(su, 0.0, nu - 1.0) + 0.5, by + clamp(sv, 0.0, nv - 1.0) + 0.5)).rgb) * GSCALE;
  }
  // 둘레 면 which의 두 번째 방향 t(light-model envT)
  float envT(int which, vec3 q) {
    if (which != 0) return (q.z + FRONT) / ENVL;
    if (env.y > -FARV && env.z < FARV) return (q.y - env.y) / (env.z - env.y);
    float h = env.y > -FARV ? q.y - env.y : env.z - q.y;
    return h / (ENVL + max(0.0, h));
  }
  vec3 envGridE(int which, vec3 q) {
    float su = gridNx < 1.5 ? 0.0 : (q.x - X0) / (X1 - X0) * (gridNx - 1.0);
    return gridAt(0.0, nBox * GN + float(which) * ENY, su, chebIndex(envT(which, q), ENY), gridNx, ENY);
  }
  // 둘레 면 which 평면 위, 받는 점 p에서 코사인 가중 평균 방향(q.yzw)이 닿는 점(나란하면 x = FARV 밖)
  vec3 envRep(int which, vec3 p, vec4 q, out bool ok) {
    vec3 nf = which == 0 ? vec3(0.0, 0.0, -1.0) : (which == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0));
    vec3 O = which == 0 ? vec3(0.0, 0.0, DEPTH) : vec3(0.0, which == 1 ? env.y : env.z, 0.0);
    float den = dot(q.yzw, nf);
    ok = abs(den) >= 1e-12;
    return ok ? p + q.yzw * (dot(O - p, nf) / den) : p;
  }
  // 둘레 면 which의 밝기: 격자가 있으면 대표 점에서
  vec3 envRad(int which, vec3 p, vec4 q, vec3 fallback) {
    if (gridOn < 0.5) return fallback;
    bool ok;
    vec3 X = envRep(which, p, q, ok);
    if (!ok) return fallback;
    return (which == 0 ? ALB_WALL : ALB_PLANK) * envGridE(which, X);
  }
  // 둘레 면 구간 번호(light-model colOf): 0 왼쪽 끝 너머, 1~ENV_COLS 판 범위 칸, NCOL − 1 오른쪽 끝 너머(가리개 뒤 밝기 behindRad)
  const int NCOL = ENV_COLS + 2;
  int colOf(float x) {
    if (x < X0) return 0;
    if (x >= X1) return NCOL - 1;
    if (gridNx < 1.5) return 1;
    return 1 + int(min(float(ENV_COLS - 1), floor((x - X0) / (X1 - X0) * float(ENV_COLS))));
  }
  // 상자 i(가운데 c, 면 위 두 축 au·av와 반 길이)의 면 f 위 점 X가 받는 빛
  vec3 boxGridE(float i, float f, vec3 c, vec3 au, float hu, vec3 av, float hv, vec3 X) {
    vec3 d = X - c;
    float su = chebIndex((dot(d, au) + hu) / (2.0 * hu), GN);
    float sv = chebIndex((dot(d, av) + hv) / (2.0 * hv), GN);
    return gridAt(f * GN, i * GN, su, sv, GN, GN);
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
  // 둘레 사각형 하나(t: 판 범위 면 3 × 가로 칸 ENV_COLS, 그다음 틀 안쪽 면 둘, 판 끝 너머 벽 둘, 판 끝면 넷). 받는 점 p 기준 꼭짓점·밝기·면 부분,
  // 판 범위 면이면 which(0 벽, 1 판 윗면, 2 위 판 아랫면)와 칸 col. 쓰지 않는 사각형이면 false. envLoss와 behindOf(구역, whole: 판 범위 통째 X0 ~ X1)가 같이 쓴다
  const int SECT_IN = ENV_COLS;
  bool envSector(int t, vec3 p, int ncol, bool whole, out vec3 a, out vec3 b, out vec3 c, out vec3 d, out vec3 rad, out int part, out int which, out int col) {
    a = vec3(0.0); b = vec3(0.0); c = vec3(0.0); d = vec3(0.0); rad = vec3(0.0); part = 3; which = -1; col = -1;
    if (t < 3 * SECT_IN) {
      int k = t / SECT_IN;
      int j = t - k * SECT_IN;
      if (j >= ncol) return false;
      float xa = whole ? X0 : X0 + (X1 - X0) * float(j) / float(ncol);
      float xb = whole ? X1 : X0 + (X1 - X0) * float(j + 1) / float(ncol);
      part = 0; which = k; col = k * NCOL + j + 1;
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
      rad = RADW; part = side + 1; which = 0; col = side == 0 ? 0 : NCOL - 1;
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
    int ncol = gridOn > 0.5 && gridNx > 1.5 ? ENV_COLS : 1;
    // 판 범위 면(가로 ncol칸: 격자가 있으면 칸마다 대표 점으로 읽는다), 틀 안쪽 면, 판 끝 너머 벽, 판 끝면 차례로(quadVF 한 곳)
    for (int t = 0; t < 3 * SECT_IN + 8; t++) {
      vec3 a; vec3 b; vec3 c; vec3 d; vec3 rad; int part; int which; int col;
      if (!envSector(t, p, ncol, false, a, b, c, d, rad, part, which, col)) continue;
      vec4 q = quadVF(a, b, c, d, n, p, part);
      if (q.x > 0.0) {
        vec3 r = part == 0 ? envRad(which, p, q, rad) : rad;
        loss += skyOf(q) - r * q.x;
      }
    }
    return loss;
  }
  // 가려진 부분(구역 which의 조각 q, 받는 점 p·법선 n)의 밝기: 그 대표 점이 든 둘레 면 구간을 envLoss가 읽은 값(light-model colRad), 그 구간이 보이지 않으면 envRad.
  // 가리개 뒤에 가려진 부분도 같은 구간 밝기로 빼야 둘레 면 몫과 정확히 상쇄된다(깊은 틈). 2026-11-13: 구간마다 값을 담아 두던 표(vec3 60칸)를 없애고
  // 그 구간 하나를 envLoss와 같은 계산으로 다시 구한다(표는 폰 GPU에서 레지스터에 못 들어가 느린 메모리로 나갔다. 값은 같다)
  vec3 behindRad(int which, vec3 p, vec3 n, vec4 q, vec3 fallback) {
    if (gridOn < 0.5) return fallback;
    bool ok;
    vec3 X = envRep(which, p, q, ok);
    if (!ok) return fallback;
    // 판 끝 너머 벽은 열린 벽
    if (which == 0 && (X.x < X0 || X.x > X1)) return fallback;
    // 구간 번호(colOf) → envLoss의 사각형 차례: 판 범위 칸, 판 끝 바로 위(x = X1)는 오른쪽 끝 너머 벽
    int ci = colOf(X.x);
    int t = ci >= 1 && ci <= ENV_COLS ? which * SECT_IN + ci - 1 : (which == 0 && ci == NCOL - 1 ? 3 * SECT_IN + 3 : -1);
    vec3 a; vec3 b; vec3 c; vec3 d; vec3 rad; int part; int wh; int col;
    if (t >= 0 && envSector(t, p, gridNx > 1.5 ? ENV_COLS : 1, false, a, b, c, d, rad, part, wh, col)) {
      vec4 qc = quadVF(a, b, c, d, n, p, part);
      if (qc.x > 0.0) return part == 0 ? envRad(wh, p, qc, rad) : rad;
    }
    return (which == 0 ? ALB_WALL : ALB_PLANK) * envGridE(which, X);
  }


  // ---------- 책 상자가 가린 하늘(light-model boxLoss) ----------
  // 면 위 사각형 r(u0, u1, v0, v1) 하나: 보이는 부분(반구로 자른 사각형)의 (뒤에 보였을 밝기 − 면 밝기). 면 밝기: 빛 격자가 있으면 대표 점에서(반사율 alb × 받는 빛),
  // 없으면 open(가림 없는 받는 빛). gi = (상자 번호, 면 번호 f), fc·nf: 면 가운데·바깥 법선, c·hu·hv: 상자 가운데·면 위 반 길이.
  // 뒤에 보였을 것(light-model behindOf): 구역(light-model sectorsOf: 판 범위 판 윗면·벽·위 판 아랫면 통째, 틀 안쪽 면, 판 끝 너머 벽, 판 끝면)마다
  // 보이는 부분이 그 구역(구역 사각형 변과 p를 지나는 평면 ∩ 판 끝 창) 안에 든 몫 × 그 밝기(판 범위는 빛 격자의 대표 점에서), 나머지는 하늘.
  // t = −1이 보이는 부분 전체, 0~10이 구역(regionVF를 부르는 곳 하나). 사각형 꼭짓점이 구역 평면 하나 밖에 모두 있으면 0, 모든 평면 안이면 보이는 부분 전체
  vec3 stripLoss(vec3 p, vec3 n, vec3 fc, vec3 nf, vec3 au, float hu, vec3 av, float hv, vec3 c, vec4 r, vec3 open, vec3 alb, vec2 gi) {
    if (r.y <= r.x || r.w <= r.z) return vec3(0.0);
    vec3 o = fc - p;
    vec3 a = o + au * r.x + av * r.z;
    vec3 b = o + au * r.y + av * r.z;
    vec3 e = o + au * r.y + av * r.w;
    vec3 d = o + au * r.x + av * r.w;
    vec4 total = vec4(0.0);
    vec4 rest = vec4(0.0);
    vec3 sum = vec3(0.0);
    for (int t = -1; t < 11; t++) {
      vec3 sa = vec3(0.0);
      vec3 sb = vec3(0.0);
      vec3 sc = vec3(0.0);
      vec3 sd = vec3(0.0);
      vec3 rad = vec3(0.0);
      int part = 3;
      int which = -1;
      int col = -1;
      int mode = -1;
      if (t >= 0) {
        if (env.x < 0.5) break;
        if (!envSector(t < 3 ? t * SECT_IN : t - 3 + 3 * SECT_IN, p, 1, true, sa, sb, sc, sd, rad, part, which, col)) continue;
        mode = 1;
        vec3 g1 = sectorPlane(0, sa, sb, sc, sd);
        vec3 g2 = sectorPlane(1, sa, sb, sc, sd);
        vec3 g3 = sectorPlane(2, sa, sb, sc, sd);
        vec3 g4 = sectorPlane(3, sa, sb, sc, sd);
        sa = g1;
        sb = g2;
        sc = g3;
        sd = g4;
        bool across = acrossAny(p, part);
        bool inside = true;
        bool outside = false;
        for (int j = 1; j < 13; j++) {
          if (j >= 5 && !across) break;
          vec3 g;
          float off;
          if (!cutPlane(j, n, 1, g1, g2, g3, g4, across, p, part, g, off)) continue;
          float lo = min(min(dot(g, a), dot(g, b)), min(dot(g, e), dot(g, d)));
          float hi = max(max(dot(g, a), dot(g, b)), max(dot(g, e), dot(g, d)));
          if (hi < 0.0) {
            outside = true;
            break;
          }
          if (lo < 0.0) inside = false;
        }
        if (outside) continue;
        if (inside) mode = 2;
      }
      vec4 q = mode == 2 ? total : regionVF(a, b, e, d, n, mode, sa, sb, sc, sd, p, part);
      if (t < 0) {
        if (q.x <= 0.0) return vec3(0.0);
        total = q;
        rest = q;
      } else if (q.x > 0.0) {
        sum += (which >= 0 ? behindRad(which, p, n, q, rad) : rad) * q.x;
        rest -= q;
      }
    }
    vec3 behind = env.x < 0.5 ? skyOf(total) : sum + skyOf(rest);
    vec3 rad = open;
    float den = dot(total.yzw, nf);
    if (gridOn > 0.5 && abs(den) > 1e-12) rad = alb * boxGridE(gi.x, gi.y, c, au, hu, av, hv, p + total.yzw * (dot(o, nf) / den));
    return behind - total.x * rad;
  }
  // 축 k 방향 s 면의 반사율(light-model faceAlbedo): 표지·책등 = 장정(tone), 머리·꼬리·책배 = 장정과 속지를 속지 넓이 비(fr.x 머리, fr.y 책배)로
  vec3 faceAlbedo(vec3 tone, vec2 fr, float k, float s) { return k < 0.5 ? tone : (k < 1.5 ? mix(tone, PAPER, fr.x) : (s < 0.0 ? tone : mix(tone, PAPER, fr.y))); }
  // 상자들이 가린 하늘. 뺄 상자: self(받는 점의 책), skipA·skipB(격자점을 덮은 책), 없으면 −1.
  // 상자 × 면(축 k) × 띠(j) 를 한 반복문으로 돈다(2026-11-13): 세 겹 반복을 GPU 컴파일러가 펼치면 stripLoss 몸체가 12벌 복사돼
  // S23(Adreno)에서 컴파일과 실행이 모두 크게 느렸다. 면마다 띠 넷의 합(fsum)을 따로 모아 더하는 차례는 예전 faceLoss와 같다.
  // 면(상자 bi의 축 a, 반 길이 h, 면 번호 k)마다 마주 보는 이웃 면(덮개)이 가리는 부분은 뺀 띠 넷으로
  vec3 boxesLoss(vec3 p, vec3 n, float self, float skipA, float skipB) {
    vec3 loss = vec3(0.0);
    vec3 fsum = vec3(0.0);
    bool faceOn = false;
    vec4 S0 = vec4(0.0);
    vec4 S1 = vec4(0.0);
    vec4 S2 = vec4(0.0);
    vec4 S3 = vec4(0.0);
    vec3 c = vec3(0.0);
    vec3 au = vec3(0.0);
    float hu = 0.0;
    vec3 av = vec3(0.0);
    float hv = 0.0;
    vec3 nf = vec3(0.0);
    vec3 fc = vec3(0.0);
    vec3 alb = vec3(0.0);
    vec3 open = vec3(0.0);
    float fi = 0.0;
    float code = 0.0;
    for (int t = 0; t < 20 * 12; t++) {
      int i = t / 12;
      int r = t - i * 12;
      int k = r / 4;
      int j = r - k * 4;
      if (float(i) >= nBox) break;
      if (j == 0) {
        faceOn = false;
        fsum = vec3(0.0);
        fi = float(i);
        if (abs(fi - self) > 0.5 && abs(fi - skipA) > 0.5 && abs(fi - skipB) > 0.5) {
          // 배열 번호는 반복 변수 t로 바로(SkSL ES2: 상수·반복 변수 식만)
          vec4 b0 = box[(t / 12) * 8];
          vec4 b1 = box[(t / 12) * 8 + 1];
          vec4 b2 = box[(t / 12) * 8 + 2];
          vec4 b3 = box[(t / 12) * 8 + 3];
          // 받는 면 평면 뒤에 통째로 있는 상자는 보이지 않는다
          float front = dot(b0.xyz - p, n) + b1.w * abs(dot(b1.xyz, n)) + b2.w * abs(dot(b2.xyz, n)) + b3.w * abs(dot(b3.xyz, n));
          if (front > 0.0) {
            vec4 cc = box[(t / 12) * 8 + 4];
            vec4 r0 = box[(t / 12) * 8 + 5];
            vec4 r1 = box[(t / 12) * 8 + 6];
            vec4 b7 = box[(t / 12) * 8 + 7];
            vec3 tone = vec3(b0.w, b7.xy);
            vec2 fr = b7.zw;
            // 면 축 k와 그 면 위의 두 축(k + 1, k + 2)
            vec4 A = k == 0 ? b1 : (k == 1 ? b2 : b3);
            vec4 U = k == 0 ? b2 : (k == 1 ? b3 : b1);
            vec4 V = k == 0 ? b3 : (k == 1 ? b1 : b2);
            c = b0.xyz;
            float h = A.w;
            au = U.xyz; hu = U.w; av = V.xyz; hv = V.w;
            float dk = dot(p - c, A.xyz);
            if (abs(dk) > h) {
              faceOn = true;
              float s = dk > 0.0 ? 1.0 : -1.0;
              code = float(k) + (s > 0.0 ? 3.0 : 0.0);
              vec4 R = vec4(-hu, hu, -hv, hv);
              vec4 E = vec4(0.0, -1.0, 0.0, -1.0);
              S0 = R;
              S1 = E;
              S2 = E;
              S3 = E;
              float g = -1.0;
              vec4 cr = R;
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
                  S0 = u0 > R.x ? vec4(R.x, u0, R.z, R.w) : E;
                  S1 = u1 < R.y ? vec4(u1, R.y, R.z, R.w) : E;
                  S2 = v0 > R.z ? vec4(u0, u1, R.z, v0) : E;
                  S3 = v1 < R.w ? vec4(u0, u1, v1, R.w) : E;
                }
              }
              nf = A.xyz * s;
              fc = c + nf * h;
              alb = faceAlbedo(tone, fr, float(k), s);
              open = alb * irr(nf);
            }
          }
        }
      }
      if (faceOn) fsum += stripLoss(p, n, fc, nf, au, hu, av, hv, c, j == 0 ? S0 : (j == 1 ? S1 : (j == 2 ? S2 : S3)), open, alb, vec2(fi, code));
      if (j == 3) loss += fsum;
    }
    return loss;
  }

  const float TOUCH = 0.0500000000;
  // 면 가장자리 점은 면 안으로 TOUCH 들인다(light-model inset)
  float inset(float t, float len) {
    float e = min(0.5, TOUCH / max(len, 1e-9));
    return clamp(t, e, 1.0 - e);
  }
  float chebT(float i, float n) { return n < 1.5 ? 0.0 : (1.0 - cos(PI * i / (n - 1.0))) / 2.0; }
  bool insideBox(vec3 q, vec3 c, vec4 A, vec4 B, vec4 C) {
    vec3 d = q - c;
    return abs(dot(d, A.xyz)) < A.w && abs(dot(d, B.xyz)) < B.w && abs(dot(d, C.xyz)) < C.w;
  }
  // 점 p에서 방향 w로 가는 광선이 상자에 닿는가
  bool rayHits(vec3 p, vec3 w, vec3 c, vec4 A, vec4 B, vec4 C) {
    vec3 o = p - c;
    vec3 ol = vec3(dot(o, A.xyz), dot(o, B.xyz), dot(o, C.xyz));
    vec3 wl = vec3(dot(w, A.xyz), dot(w, B.xyz), dot(w, C.xyz));
    vec3 h = vec3(A.w, B.w, C.w);
    vec3 inv = 1.0 / (abs(wl) + 1e-12) * sign(wl + 1e-15);
    vec3 ta = (-h - ol) * inv;
    vec3 tb = (h - ol) * inv;
    vec3 mn = min(ta, tb);
    vec3 mx = max(ta, tb);
    return max(1e-6, max(mn.x, max(mn.y, mn.z))) <= min(mx.x, min(mx.y, mx.z));
  }
  // 방향 w로 창빛이 책(제 상자·덮은 책 빼고)에 막히지 않으면 1
  float keyFree(vec3 P, vec3 w, float self, float skipA, float skipB) {
    for (int i = 0; i < 20; i++) {
      if (float(i) >= nBox) break;
      float fi = float(i);
      if (abs(fi - self) > 0.5 && abs(fi - skipA) > 0.5 && abs(fi - skipB) > 0.5 && rayHits(P, w, box[i * 8].xyz, box[i * 8 + 1], box[i * 8 + 2], box[i * 8 + 3])) return 0.0;
    }
    return 1.0;
  }
  // 광선 P + t·w가 둘레 판 덩어리(위 판·아래 판, light-model rayHitsPlank)를 지나면 1
  float slabHit(vec3 P, vec3 w, float y0, float y1) {
    vec3 lo = vec3(X0, y0, -FRONT);
    vec3 hi = vec3(X1, y1, DEPTH);
    vec3 inv = 1.0 / (abs(w) + 1e-12) * sign(w + 1e-15);
    vec3 ta = (lo - P) * inv;
    vec3 tb = (hi - P) * inv;
    vec3 mn = min(ta, tb);
    vec3 mx = max(ta, tb);
    return max(1e-4, max(mn.x, max(mn.y, mn.z))) < min(mx.x, min(mx.y, mx.z)) ? 1.0 : 0.0;
  }
  float plankHit(vec3 P, vec3 w) {
    float c = env.z < FARV ? slabHit(P, w, env.z, env.z + THICK) : 0.0;
    float f = env.y > -FARV ? slabHit(P, w, env.y - THICK, env.y) : 0.0;
    return max(c, f);
  }
  
void main() {
  vec2 pc = FlutterFragCoord().xy;

    float ix = floor(pc.x);
    float iy = floor(pc.y);
    vec3 P = vec3(0.0);
    vec3 n = vec3(0.0, 0.0, -1.0);
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
      for (int i = 0; i < 20; i++) {
        if (float(i) == bi) {
          vec4 b0 = box[i * 8];
          vec4 b1 = box[i * 8 + 1];
          vec4 b2 = box[i * 8 + 2];
          vec4 b3 = box[i * 8 + 3];
          vec4 A = k < 0.5 ? b1 : (k < 1.5 ? b2 : b3);
          vec4 U = k < 0.5 ? b2 : (k < 1.5 ? b3 : b1);
          vec4 V = k < 0.5 ? b3 : (k < 1.5 ? b1 : b2);
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
        P = vec3(x, y, DEPTH);
        n = vec3(0.0, 0.0, -1.0);
      } else {
        float t = inset(chebT(b, ENY), ENVL);
        P = vec3(x, which == 1 ? env.y : env.z, -FRONT + ENVL * t);
        n = vec3(0.0, which == 1 ? 1.0 : -1.0, 0.0);
      }
    }
    vec3 q = P + n * TOUCH;
    // 판 속·벽 너머(어디서도 보이지 않는다)
    bool shelf = q.z > DEPTH || (inDepth(q.z) && ((env.y > -FARV && q.y < env.y && q.y > env.y - THICK) || (env.z < FARV && q.y > env.z && q.y < env.z + THICK)));
    if (absent || shelf) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    // 덮은 책(많아야 둘)은 뺀다: 덮은 책이 없었다면 받았을 빛
    float skipA = -1.0;
    float skipB = -1.0;
    for (int i = 0; i < 20; i++) {
      if (float(i) >= nBox) break;
      if (abs(float(i) - self) > 0.5 && insideBox(q, box[i * 8].xyz, box[i * 8 + 1], box[i * 8 + 2], box[i * 8 + 3])) {
        if (skipA < 0.0) skipA = float(i); else skipB = float(i);
      }
    }
    float nl = dot(n, LU);
    float key = 0.0;
    if (nl > 0.0) {
      // 판은 원반을 자른 활꼴, 책은 판이 막지 않은 원반 위 방향들(light-model KEY_DIRS) 가운데 막힌 몫(합집합, light-model gridKeyFree)
      float kopen = 0.0;
      float kfree = 0.0;
      // 방향마다 같은 몸체를 펼쳐 쓰면 GPU 컴파일러가 상자 반복(keyFree)을 방향 수만큼 복사한다: 반복문 하나로(차례·값은 같다)
      for (int i = 0; i < 16; i++) {
        vec3 w = (i < 8 ? (i < 4 ? (i < 2 ? (i < 1 ? vec3(-0.121397685, 0.173618212, -0.977302061) : vec3(-0.0789053975, 0.194955268, -0.977633051)) : (i < 3 ? vec3(-0.107211476, 0.132775380, -0.985330603) : vec3(-0.131818948, 0.211811562, -0.968379898))) : (i < 6 ? (i < 5 ? vec3(-0.0484542677, 0.163832475, -0.985297470) : vec3(-0.154956600, 0.140808862, -0.977835015)) : (i < 7 ? vec3(-0.0842813572, 0.236828785, -0.967888826) : vec3(-0.0709310218, 0.110471965, -0.991344912)))) : (i < 12 ? (i < 10 ? (i < 9 ? vec3(-0.173519616, 0.198945254, -0.964526686) : vec3(-0.0278373619, 0.203414283, -0.978696945)) : (i < 11 ? vec3(-0.139724986, 0.0973495557, -0.985393319) : vec3(-0.127414388, 0.256362935, -0.958145928))) : (i < 14 ? (i < 13 ? vec3(-0.0237459745, 0.127227300, -0.991589302) : vec3(-0.196180589, 0.152523977, -0.968632858)) : (i < 15 ? vec3(-0.0440049470, 0.252993680, -0.966466638) : (vec3(-0.0910949856, 0.0722301432, -0.993219266))))));
        float o = 1.0 - plankHit(P, w);
        kopen += o;
        kfree += o > 0.5 ? keyFree(P, w, self, skipA, skipB) : 0.0;
      }
      key = DIFF * nl * (1.0 - plankKeyOf(P)) * (kopen > 0.5 ? kfree / kopen : 1.0);
    }
    vec3 lossE = envLoss(P, n);
    vec3 E = max(vec3(0.0), skyIrr(n) + KEYC * key - lossE - boxesLoss(P, n, self, skipA, skipB));
    { fragColor = vec4(vec3(clamp(E / GSCALE, 0.0, 1.0)), 1.0); return; }
  }
