#version 460 core
// 이 파일은 tool/gen_shaders.sh 가 만든다. 손으로 고치지 말 것(출처: ../app/src/ui/scene-light-sksl.ts)
#include <flutter/runtime_effect.glsl>

precision highp float;
layout(location = 0) out vec4 fragColor;


  uniform sampler2D tex;
  uniform vec2 texSize;   // 그림 칸 수(SkSL 화소 좌표를 0~1로 바꾼다)
  uniform mat3 texMat;    // 그리는 좌표 → 그림 칸(SkSL에서는 자식 그림에 붙인 행렬)
  uniform float texDecal; // 1이면 그림 밖은 비워 둔다(SkSL TileMode.Decal)       // 줄 아틀라스(그림 px 그대로 읽는다)
  uniform sampler2D keyTex;
  uniform vec2 keyTexSize;   // 그림 칸 수(SkSL 화소 좌표를 0~1로 바꾼다)
  uniform mat3 keyTexMat;    // 그리는 좌표 → 그림 칸(SkSL에서는 자식 그림에 붙인 행렬)
  uniform float keyTexDecal; // 1이면 그림 밖은 비워 둔다(SkSL TileMode.Decal)    // 이 책 면이 받는 창빛 그림자(다른 책이 창빛 원반을 가리는 몫, 알파): 면마다 칸(kRect)
  uniform sampler2D tex2;
  uniform vec2 tex2Size;   // 그림 칸 수(SkSL 화소 좌표를 0~1로 바꾼다)
  uniform mat3 tex2Mat;    // 그리는 좌표 → 그림 칸(SkSL에서는 자식 그림에 붙인 행렬)
  uniform float tex2Decal; // 1이면 그림 밖은 비워 둔다(SkSL TileMode.Decal)      // 앞 굽기 아틀라스(그림 px 그대로)
  uniform vec4 rect2[6];  // 앞 굽기에서 면마다 칸(rect와 같은 틀)
  uniform float mixT;       // 새 굽기 몫(1이면 tex만)
  uniform vec4 kRect[6];  // 면마다 그림자 칸: (칸 원점 x, y, 배율 px/DU, 있으면 1)
  uniform vec4 cam4;      // 눈(x, y, 기준면 z, 거리). 거리 ≤ 0이면 사선 카메라(kx, ky = cam4.xy)
  uniform vec3 pxa;       // 캔버스 px = 화면 점 × s + (tx, ty): (s, tx, ty)
  uniform vec3 bO;        // 책 좌표 원점(줄 공간)과 축(단위): 책 좌표 (x 두께, y 높이, z 깊이)
  uniform vec3 bX;
  uniform vec3 bY;
  uniform vec3 bZ;
  uniform vec3 dims;      // T, H, W
  uniform vec3 rig;       // 판 두께 bd, 책등 띠 sp, 속지가 들어간 깊이 sq(book-parts rigOf)
  uniform vec4 rect[6];   // 면마다 아틀라스 칸 (0, 0) 자리와 칸 수(x, y, w, h). w ≤ 0이면 구운 값 없음
  uniform float keyOn;
  uniform vec3 albedo;    // 장정 색(선형 RGB)
  uniform vec3 erefB;     // 장정 재질의 대표 자리 빛·반사광(light-model bookEref·bookSref), 속지 단면의 대표 자리 반사광
  uniform vec3 srefB;
  uniform vec3 srefP;
  uniform float specK;     // 장정 재질의 표면 반사 몫 배수(materials specular)
  uniform vec2 mR;        // 장정 재질(domain/surface-pattern matUniforms): 거칠기·기울기 RMS, 미세 높이, 결, 결 크기, 책마다 무늬 자리 어긋남
  uniform vec4 mB;
  uniform vec4 mG;
  uniform vec2 mS;
  uniform vec2 mSeed;
  uniform vec2 pR;        // 속지 단면 재질(materials.pages, 같은 꼴)
  uniform vec4 pB;
  uniform vec4 pG;
  uniform vec2 pS;

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
  const float LRAD = 0.0698131701;
  const float LAZ = -0.104719755;
  const float F0 = 0.0400000000;
  // 창빛 원반이 하이라이트를 넓히는 몫(light-model ggxKey): α² += (반지름/2)²
  const float LR2 = 0.00121846968;
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

  const float CURVE = 0.500000000;
  uniform vec3 EREF_PAPER;
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
 // 맞추기 값(속지 대표 자리 빛)
  const vec4 GRV = vec4(6.50000000, 2.40000000, 0.160000000, 0.0);
  vec3 toRow(vec3 l) { return bX * l.x + bY * l.y + bZ * l.z; }

  
void main() {
  vec2 p = FlutterFragCoord().xy;

    vec3 E;
    vec3 d;
    if (cam4.w > 0.0) {
      E = vec3(cam4.x, cam4.y, cam4.z - cam4.w);
      d = vec3((p.x - pxa.y) / pxa.x, -(p.y - pxa.z) / pxa.x, cam4.z) - E;
    } else {
      // 사선 카메라: 화면 점 (X, Y)는 x + z·kx = X, y + z·ky = Y인 선
      d = vec3(-cam4.x, -cam4.y, 1.0);
      E = vec3((p.x - pxa.y) / pxa.x, -(p.y - pxa.z) / pxa.x, 0.0) - d * 10000.0000;
    }
    vec3 o = E - bO;
    vec3 ol = vec3(dot(o, bX), dot(o, bY), dot(o, bZ));
    vec3 dl = vec3(dot(d, bX), dot(d, bY), dot(d, bZ));
    vec3 inv = 1.0 / (abs(dl) + 1e-12) * sign(dl + 1e-15);
    vec3 ta = -ol * inv;
    vec3 tb = (dims - ol) * inv;
    vec3 mn = min(ta, tb);
    vec3 mx = max(ta, tb);
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
      if (t0 > t1 || t1 <= 0.0) { fragColor = vec4(DODGE < 0.5 ? 1.0 : 0.0, DODGE < 0.5 ? 1.0 : 0.0, DODGE < 0.5 ? 1.0 : 0.0, 1.0); return; }
    }
    vec3 L = clamp(ol + dl * t0, vec3(0.0), dims);
    float T = dims.x;
    float H = dims.y;
    float W = dims.z;
    // 들어간 면과 그 면 좌표(u, v), 면 크기, 바깥 법선·가로·세로 축(책 좌표)
    int fi = 0;
    float u = 0.0; float v = 0.0; float pw = 1.0; float ph = 1.0;
    vec3 nl = vec3(0.0, 0.0, -1.0); vec3 ul = vec3(1.0, 0.0, 0.0); vec3 vl = vec3(0.0, -1.0, 0.0);
    if (mn.x >= mn.y && mn.x >= mn.z) {
      if (dl.x < 0.0) { fi = 1; u = L.z; v = H - L.y; pw = W; ph = H; nl = vec3(1.0, 0.0, 0.0); ul = vec3(0.0, 0.0, 1.0); }
      else { fi = 2; u = W - L.z; v = H - L.y; pw = W; ph = H; nl = vec3(-1.0, 0.0, 0.0); ul = vec3(0.0, 0.0, -1.0); }
    } else if (mn.y >= mn.z) {
      fi = dl.y < 0.0 ? 3 : 4;
      u = L.x; v = L.z; pw = T; ph = W;
      nl = vec3(0.0, dl.y < 0.0 ? 1.0 : -1.0, 0.0); ul = vec3(1.0, 0.0, 0.0); vl = vec3(0.0, 0.0, 1.0);
    } else {
      if (dl.z > 0.0) { fi = 0; u = L.x; v = H - L.y; pw = T; ph = H; }
      else { fi = 5; u = L.x; v = H - L.y; pw = T; ph = H; nl = vec3(0.0, 0.0, 1.0); }
    }
    vec3 a = albedo;
    vec3 n = nl;
    vec3 Lp = L;
    bool page = false;
    // 닿은 평면(법선 nh, 광선 매개변수 th)과 그 평면의 무늬 축(Au, Av)
    float th = t0;
    vec3 nh = nl;
    vec3 Au = ul;
    vec3 Av = vl;
    if (fi < 3) {
      // 책 면: 둥근 모서리(반지름 EDGER, 면이 좁으면 그 절반), 책등 곡면, 표지·뒤표지 제본 홈
      float ry = min(ph / 2.0, EDGER);
      // 세로 변 양쪽 면이 둘 다 보이면(돌린 표지 책의 책등·표지처럼) 그 변은 윤곽이 아니라 두 면을 잇는 둥근 모서리다. 윤곽처럼 면마다 끝까지 굴리면
      // 두 면의 법선이 어긋나 한 면이 둥근 카드처럼 따로 떠 보였고(2026-10-10 사용자: 모서리가 깨진다), 둥글기를 빼면 날카로운 선이 남았다(2026-11-02 사용자: 좀 둥글게).
      // 그래서 두 면의 법선이 가운데(45°, 면 기울기 1)에서 만나게 해 빛이 끊기지 않고 이어지게 한다. 세운 책의 옆면처럼 한쪽이 원근으로 살짝 보이는 변은 윤곽과 같다
      vec3 dn = dl / length(dl);
      float fown = -dot(nl, dn);
      float f0 = min(fown, fi == 0 ? dn.x : (fi == 1 ? dn.z : -dn.z));
      float f1 = min(fown, fi == 0 ? -dn.x : (fi == 1 ? -dn.z : dn.z));
      float k0 = 1.0 - smoothstep(0.06, 0.18, f0);
      float k1 = 1.0 - smoothstep(0.06, 0.18, f1);
      float tx = arc(pw - u, min(pw / 2.0, mix(SEAMR, EDGER, k1))) * mix(0.7071, 1.0, k1) - arc(u, min(pw / 2.0, mix(SEAMR, EDGER, k0))) * mix(0.7071, 1.0, k0);
      float ty = arc(ph - v, ry) - arc(v, ry);
      // 모서리 사분원 밖(두 변의 기울기 합이 1을 넘는 곳)은 둥근 상자라면 없는 자리라 법선이 면에 눕는다(창빛을 정면으로 받아 흰 세모가 됐다).
      // 바깥 모서리는 둥근 윤곽이 잘라 내지만, 두 면이 만나는 모서리(돌린 표지 책의 책등·표지 위 끝)에서는 보였다: 둥근 변의 끝 기울기로 묶는다
      float tl = length(vec2(tx, ty));
      if (tl > 0.95) { tx *= 0.95 / tl; ty *= 0.95 / tl; }
      float nz = sqrt(max(1e-4, 1.0 - tx * tx - ty * ty));
      float sx = tx / nz;
      if (fi == 0) sx += tan(CURVE * (u / pw * 2.0 - 1.0));
      else {
        float hd = ((fi == 1 ? u : pw - u) - GRV.x) / GRV.y;
        sx += (fi == 1 ? 1.0 : -1.0) * GRV.z * hd * exp(-hd * hd);
      }
      // 만나는 변에서 기울기 1을 넘으면(둥근 책등의 곡면이 더해지는 자리) 옆 면 법선을 지나쳐 빛이 다시 끊긴다
      sx = clamp(sx, -mix(1.0, 20.0, k0), mix(1.0, 20.0, k1));
      n = normalize(sx * ul + (ty / nz) * vl + nl);
    } else {
      // 종이 단면 면: 열린 칸(판·책등 띠 안쪽) 안이면 광선을 속지 쪽으로 이어 속지 면(깊이 sq) 또는 판 안쪽 벽에
      float u0 = rig.x;
      float u1 = T - rig.x;
      float v0 = fi == 5 ? 0.0 : rig.y;
      float v1 = fi == 5 ? H : W;
      // 판 끝 면(테두리)과 속지는 두께 방향 x를 가로로
      Au = vec3(1.0, 0.0, 0.0);
      if (u >= u0 && u <= u1 && v >= v0 && v <= v1) {
        a = PAPER_COLOR;
        float down = -dot(dl, nl);
        float du = dot(dl, ul);
        float dv = dot(dl, vl);
        float tw = rig.z / max(down, 1e-9);
        vec3 nw = nl;
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
    vec3 dpx = vec3(bX.x, bY.x, bZ.x) / pxa.x;
    vec3 dpy = -vec3(bX.y, bY.y, bZ.y) / pxa.x;
    float tk = cam4.w > 0.0 ? th : 1.0;
    float dn = dot(nh, dl);
    vec3 JX = tk * (dpx - dl * dot(nh, dpx) / dn);
    vec3 JY = tk * (dpy - dl * dot(nh, dpy) / dn);
    vec2 fp = vec2(max(abs(dot(JX, Au)), abs(dot(JY, Au))), max(abs(dot(JX, Av)), abs(dot(JY, Av))));
    vec2 uv = vec2(dot(Lp, Au), dot(Lp, Av)) + mSeed;
    // 재질 무늬는 한 번만 부른다(두 곳에서 부르면 GPU 컴파일러가 몸체를 두 벌 펼친다)
    vec4 ms = matSample(uv, fp, page ? pR : mR, page ? pB : mB, page ? pG : mG, page ? pS : mS);
    n = normalize(n - ms.x * Au - ms.y * Av);
    vec3 P = bO + toRow(Lp);
    vec3 nw3 = normalize(toRow(n));
    // 하늘 가림: 그 면의 구운 칸(면 평면 점의 칸 좌표), 없으면 둘레만 그 자리에서(면 법선)
    vec4 R = vec4(0.0);
    for (int i = 0; i < 6; i++) { if (i == fi) R = rect[i]; }
    vec3 loss = R.z > 0.0 ? lossDec(vec3(_tex(vec2(R.x + u / pw * R.z, R.y + v / ph * R.w)).rgb), skyIrr(toRow(nl))) : envLoss(bO + toRow(L), toRow(nl));
    if (mixT < 1.0) {
      vec4 R2 = vec4(0.0);
      for (int i = 0; i < 6; i++) { if (i == fi) R2 = rect2[i]; }
      if (R2.z > 0.0) loss = mix(lossDec(vec3(_tex2(vec2(R2.x + u / pw * R2.z, R2.y + v / ph * R2.w)).rgb), skyIrr(toRow(nl))), loss, mixT);
    }
    vec3 view = cam4.w > 0.0 ? normalize(E - P) : normalize(-d);
    vec4 K = vec4(0.0);
    for (int i = 0; i < 6; i++) { if (i == fi) K = kRect[i]; }
    float kx = K.w > 0.5 ? float(_keyTex(K.xy + vec2(u, v) * K.z).a) : 0.0;
    // 두 면이 만나는 둥근 모서리(책등↔표지·뒤표지): 그늘은 면마다 따로 구워 모서리에서 값이 끊긴다(2026-11-03 사용자: 어린 왕자 책등과 표지 사이가 |처럼 각진다, 옆 책이 책등만 가린 책).
    // 모서리 띠(둥근 반지름의 두 배)에서 옆 면의 같은 높이 값과 섞어 모서리에서 두 면이 같은 값이 되게 한다. 옆 면이 보이지 않으면(구운 칸이 없으면) 섞지 않는다
    if (fi < 3) {
      float seamW = min(pw * 0.5, 2.0 * SEAMR);
      int fN = -1;
      float uN = 0.0;
      float dS = 0.0;
      if (fi == 1) { fN = 0; uN = T; dS = u; }
      else if (fi == 2) { fN = 0; uN = 0.0; dS = pw - u; }
      else if (pw - u < u) { fN = 1; uN = 0.0; dS = pw - u; }
      else { fN = 2; uN = W; dS = u; }
      if (dS < seamW) {
        vec4 RN = vec4(0.0);
        vec4 KN = vec4(0.0);
        for (int i = 0; i < 6; i++) { if (i == fN) { RN = rect[i]; KN = kRect[i]; } }
        if (R.z > 0.0 && RN.z > 0.0) {
          float kb = 1.0 - dS / seamW;
          float kw = 0.5 * kb * kb * (3.0 - 2.0 * kb);
          vec3 nN = fN == 0 ? vec3(0.0, 0.0, -1.0) : (fN == 1 ? vec3(1.0, 0.0, 0.0) : vec3(-1.0, 0.0, 0.0));
          float pwN = fN == 0 ? T : W;
          vec3 skyN = skyIrr(toRow(nN));
          vec3 lossN = lossDec(vec3(_tex(vec2(RN.x + uN / pwN * RN.z, RN.y + v / ph * RN.w)).rgb), skyN);
          loss = mix(loss, lossN * skyIrr(toRow(nl)) / max(skyN, vec3(1e-4)), kw);
          kx = mix(kx, KN.w > 0.5 ? float(_keyTex(KN.xy + vec2(uN, v) * KN.z).a) : 0.0, kw);
        }
      }
    }
    { fragColor = shade(P, nw3, normalize(toRow(nl)), view, loss, a, page ? EREF_PAPER : erefB, ms.w, ms.z, kx, page ? srefP : srefB, page ? 1.0 : specK); return; }
  }
