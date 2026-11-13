// 3D 책장의 빛과 카메라(장면 입력). app/src/scene-config/lighting.ts를 옮긴 것(값은 커밋된 것 그대로).
// 밝기·그림자·어둠·반사광은 모두 이 입력과 3D 형태에서 계산한다. 손으로 정한 진하기·번짐·범위는 두지 않는다.
//
// 빛은 두 개뿐이고 모든 물체(책·판·면)에 같은 규칙으로 쓴다(2026-10-10 사용자 '물리법칙 같은 것도 일관되게'):
// - 창빛(key): 작은 원반 하나(왼쪽·위 각도, 반지름). 그림자·받는 빛·하이라이트를 모두 이 원반으로 계산한다.
// - 방 빛(sky): 위·앞이 밝은 방. 가리개가 가린 만큼 줄어드는 하늘 가림을 어디서나 같은 세기(occlusion)로 쓴다.
// 세기는 상대값이다. 재질 색(시안 색)은 그 재질이 대표 자리에서 보이는 색으로 보고 반사율을 거꾸로 구한다(light_model calibrate).
library;

import 'dart:math' as math;

import '../domain/vec3.dart';
import 'skin.dart';

double _tanD(double deg) => math.tan(deg * math.pi / 180);

/// 창빛 방향: 위 각(el), 왼쪽 각(az)
Vec3 _keyDir(double el, double az) => Vec3(-_tanD(az), _tanD(el) * math.sqrt(1 + _tanD(az) * _tanD(az)), -1);

class Light {
  const Light({
    required this.dir,
    required this.radius,
    required this.ambient,
    required this.diffuse,
    required this.occlusion,
    required this.overhead,
  });

  /// 창빛 방향(단위 아님: lUnit이 정규화한다)
  final Vec3 dir;

  /// 창빛 원반 반지름(라디안)
  final double radius;

  /// 방 빛 평균 밝기
  final double ambient;

  /// 창빛 세기
  final double diffuse;

  /// 방 빛 하늘 가림 세기. 물리값은 1이지만 0.3으로 둔다(1이면 뒷벽이 시안보다 훨씬 어둡다.
  /// 좁은 곳의 어둠은 안쪽 모서리 그늘 jointShade가 맡는다)
  final double occlusion;

  /// 위 앞쪽 넓은 조명의 밝기(2026-11-05 사용자 사진 '둥근 만큼 빛 반사'). 면이 받는 빛은 skyTilt에 이미 들어 있어
  /// 반사광에만 더한다(overheadGlow): 위로 기운 둥근 모서리에만 빛줄이 생긴다
  final double overhead;

  /// 방 빛이 방향에 따라 바뀌는 크기(위가 밝다). 면이 받는 방 빛 = ambient ± |skyTilt|
  Vec3 get skyTilt => const Vec3(0, 0.25, -0.12);

  C3 get skyColor => C3.white;
  C3 get keyColor => C3.white;
}

// 움푹 파인 책장: 2026-11-04 사용자가 사진으로 고른 c1을 시안 그늘 길이에 맞춘 값(위 10°, 왼쪽 6°, 반지름 8°).
// 전 책장(틀 없음, 사용자가 아직 고르는 중): 2026-11-03 '수정안 2'
final _niche = Light(dir: _keyDir(10, 6), radius: 8 * math.pi / 180, ambient: 0.72, diffuse: 0.22, occlusion: 0.3, overhead: 3.2);
final _open = Light(dir: _keyDir(17, 10), radius: 14 * math.pi / 180, ambient: 0.55, diffuse: 0.35, occlusion: 0.3, overhead: 0);

final light = frameOn ? _niche : _open;

/// 반사율 상한. 틀이 기준이다: 틀은 안쪽 면에서 보이는 색이라 벽보다 반사율이 크고, 그 값이 상한이 된다
final albedoMax = frameOn ? 0.9 : 0.7;

/// 접촉 그늘 높이(mm). 책 밑동을 이 높이의 어두운 띠로 보고 받치는 면이 그만큼 가려진 것으로 친다
/// (2026-11-02 사용자 '책이 선반에 놓여 있는 느낌')
const contactHeightMm = 18.0;

/// 카메라(보기 선택, 물리 값이 아니다). 노출 뒤 필름형 톤 곡선을 지난다(light_model tone):
/// shoulder를 넘으면 1로 부드럽게 다가가고, toe 아래는 검정 쪽 기울기를 1 − toeK로 누른다
class Camera {
  const Camera();
  final double exposure = 0;
  final double shoulder = 0.95;
  final double toe = 0.18;
  final double toeK = 0.15;
}

const camera = Camera();

/// 수직 반사율(비금속). 종이·천·도료·나무 마감은 모두 유전체라 값이 같고, 다른 것은 표면뿐이다
const f0 = 0.04;

/// 책장에 그리는 실제 표지 사진의 채도(1 = 원본, 2026-11-03 사용자 '실사 책들 채도를 좀 낮추면')
const photoSaturation = 0.85;

/// 섬유 점의 폭·길이(mm)
const fiberWidth = 0.55;
const fiberLength = 2.2;
