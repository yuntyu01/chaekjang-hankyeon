#version 460 core
// 책 공유 카드 벽의 빛·그늘(지금 앱 share-scene.ts SHADE_SKSL): 바탕 × 시안 벽에서 뜬 그림자 지도. 지도는 책 가장자리에 붙여 옮긴 자리에서 읽는다(왼쪽 반은
// 책 왼쪽 끝, 오른쪽 반은 속지 띠 끝). 책이 낮으면 표지 아래 끝을 기준으로 세로를 늘인다. 지도 밖은 바탕 그대로
#include <flutter/runtime_effect.glsl>

precision highp float;
layout(location = 0) out vec4 fragColor;

uniform vec2 plateSize;   // 바탕 그림 크기(시안 화소)
uniform vec4 map;         // 지도 자리(x, y, w, h)
uniform float split;
uniform vec2 shift;
uniform float bottom;
uniform float vs;
uniform sampler2D plate;
uniform sampler2D shade;

void main() {
  // FlutterFragCoord는 캔버스 변환을 거친 좌표(여기서는 시안 화소)다
  vec2 p = FlutterFragCoord().xy;
  vec3 c = texture(plate, p / plateSize).rgb;
  vec2 q = vec2(p.x - (p.x > split ? shift.y : shift.x), bottom - (bottom - p.y) * vs) - map.xy;
  float t = 1.0;
  if (q.x >= 0.0 && q.y >= 0.0 && q.x < map.z && q.y < map.w) t = 0.5 + texture(shade, q / map.zw).r * 0.6375;
  fragColor = vec4(c * t, 1.0);
}
