// 지금 앱의 빛 맞추기 값(light-model lightSet().u). tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것.
// 재질 색(시안 색)에서 거꾸로 구한 반사율·카메라 기준 빛이라 스킨마다 다르다: 지금 스킨(scene_config/skin.dart skinLight)의 값을 읽는다
// ignore_for_file: non_constant_identifier_names
library;

import '../domain/vec3.dart';
import '../scene_config/skin.dart' show skinLight;

C3 get ALB_PLANK => skinLight.u['ALB_PLANK']!;
C3 get ALB_WALL => skinLight.u['ALB_WALL']!;
C3 get ECAM => skinLight.u['ECAM']!;
C3 get EREF_PAPER => skinLight.u['EREF_PAPER']!;
C3 get PAPER => skinLight.u['PAPER']!;
C3 get RADE => skinLight.u['RADE']!;
C3 get RADF => skinLight.u['RADF']!;
C3 get RADSL => skinLight.u['RADSL']!;
C3 get RADSR => skinLight.u['RADSR']!;
C3 get RADU => skinLight.u['RADU']!;
C3 get RADW => skinLight.u['RADW']!;
