// 책 장정 색 → 반사율(지금 앱 light-model bookAlbedo)에 쓰는 값. tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것
library;

import '../domain/vec3.dart';
import '../scene_config/skin.dart' show skinLight;

/// 화면 톤 곡선(발끝·어깨)
const toneToe = 0.18;
const toneK = 0.15;
const toneShoulder = 0.95;

/// 카메라 이득과 벽 대표 자리 빛(스킨마다)
double get camGain => skinLight.camGain;
C3 get erefWall => skinLight.erefWall;

/// 구운 하늘 가림 담기(scene-light-sksl lossEncode·lossDecode): 0을 가운데 G0로 양쪽 제곱근 곡선
const lossG0 = 0.3;
const lossRP = 1.4673084924772408;
const lossRN = 0.7746169849544818;

/// 하늘 빛(skyIrr = SKYC · (AMB + SKYTILT·n))
const skyC = C3(1, 1, 1);
const ambient = 0.72;
const skyTilt = (0, 0.25, -0.12);

/// 장정 재질마다 대표 자리 빛·반사광(고운 종이·린넨·무광·줄무늬 종이, 스킨마다)
Map<String, C3> get bookErefOf => skinLight.bookErefOf;
Map<String, C3> get bookSrefOf => skinLight.bookSrefOf;
