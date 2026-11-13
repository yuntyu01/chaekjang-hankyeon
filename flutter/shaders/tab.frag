#version 460 core
// 이 파일은 tool/gen_shaders.sh 가 만든다. 손으로 고치지 말 것(출처: ../app/src/ui/scene-light-sksl.ts)
#include <flutter/runtime_effect.glsl>

precision highp float;
layout(location = 0) out vec4 fragColor;


  uniform vec3 pxa;       // 캔버스 배율 (s, 0, 0)
  uniform vec3 root;      // 뿌리(줄 공간)
  uniform vec3 axR;       // 탭 가로(책 두께 방향)·위(책 높이 방향)·법선
  uniform vec3 axU;
  uniform vec3 nrm;
  uniform vec3 loss;
  uniform vec4 cam4;
  uniform float keyOn;
  uniform vec3 albedo;
  uniform vec3 eref;
  uniform vec3 sref;
  uniform vec2 mR;
  uniform vec4 mB;
  uniform vec4 mG;
  uniform vec2 mS;
  uniform vec2 mSeed;

  uniform vec3 env;

  const float PI = 3.14159265;
  const float AMB = 0.720000000;
  const vec3 SKYTILT = vec3(0.00000000, 0.250000000, -0.120000000);
  const float DIFF = 0.220000000;
  // 방 빛 하늘 가림 세기(light.occlusion, 모든 곳 같은 비율)
  const float OCC = 0.300000000;
  const vec3 LU = vec3(-0.102940441, 0.173648178, -0.979412873);
  // 맞추기 값(스킨마다 다르다: 스토어에서 색을 고르면 셰이더를 다시 만들지 않고 값만 바꾼다, light-model lightSet().u)
  // 카메라 기준 빛(벽 대표 자리 빛 / 노출 기준 CAM.gain, 반사광을 장면 밝기로)
  uniform vec3 ECAM;
  const float LELEV = 0.175474740;
  const float LRAD = 0.139626340;
  const float LAZ = -0.104719755;
  const float F0 = 0.0400000000;
  // 창빛 원반이 하이라이트를 넓히는 몫(light-model ggxKey): α² += (반지름/2)²
  const float LR2 = 0.00487387872;
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
  const float LOSS_RP = 1.46730849;
  const float LOSS_RN = 0.774616985;
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
  uniform float SPLIT;      // 1이면 곱하기·닷지가 확산 몫만(반사광은 겹 3)
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
  const float RIMR = 3.05000000;
  const float RIMC = 1.50000000;
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

  
void main() {
  vec2 p = FlutterFragCoord().xy;

    // 탭 좌표(DU): 가로 x, 아래로 y(그림 좌표 그대로: 셰이더는 그리는 Group의 좌표를 받는다)
    vec2 l = p / pxa.x;
    vec3 P = root + axR * l.x - axU * l.y;
    float fp = 1.0 / pxa.x;
    vec4 ms = matSample(vec2(l.x, -l.y) + mSeed, vec2(fp, fp), mR, mB, mG, mS);
    vec3 n = normalize(nrm - ms.x * axR - ms.y * axU);
    vec3 view = cam4.w > 0.0 ? normalize(vec3(cam4.x, cam4.y, cam4.z - cam4.w) - P) : vec3(0.0, 0.0, -1.0);
    { fragColor = shade(P, n, nrm, view, loss, albedo, eref, ms.w, ms.z, 0.0, sref, 1.0); return; }
  }
