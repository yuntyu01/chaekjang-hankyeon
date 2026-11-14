#version 460 core
// 책 공유 카드의 표지(지금 앱 features/book/share-scene.ts COVER_SKSL): 표지 색감을 시안 책처럼 바꾸고(채도·감마·밝기·검정 띄우기)
// 시안 책에서 뽑은 곱하는 빛 M·더하는 빛 A를 같은 자리에 얹는다(out = grade(c)·M + A). 어떤 표지든 빛이 같은 자리에 같은 세기로 든다
#include <flutter/runtime_effect.glsl>

precision highp float;
layout(location = 0) out vec4 fragColor;

uniform vec4 rect;        // 표지 자리(시안 화소 x, y, w, h)
uniform float sat;
uniform float gamma;
uniform float gain;
uniform vec3 lift;
uniform float hasCover;   // 0이면 표지 색 한 가지
uniform vec3 coverColor;
uniform sampler2D cover;
uniform sampler2D mulMap;
uniform sampler2D addMap;

void main() {
  // FlutterFragCoord는 캔버스 변환을 거친 좌표(여기서는 시안 화소)다
  vec2 p = FlutterFragCoord().xy;
  vec2 uv = clamp((p - rect.xy) / rect.zw, 0.0, 1.0);
  vec3 c = hasCover > 0.5 ? texture(cover, uv).rgb : coverColor;
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 cc = clamp(mix(vec3(g), c, sat), 0.0, 1.0);
  cc = pow(cc, vec3(gamma)) * gain;
  cc = lift + cc * (1.0 - lift);
  float m = texture(mulMap, uv).r * 2.0;
  float a = texture(addMap, uv).r - 64.0 / 255.0;
  fragColor = vec4(clamp(cc * m + a, 0.0, 1.0), 1.0);
}
