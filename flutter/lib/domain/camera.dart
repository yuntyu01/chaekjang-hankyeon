// 보기 구도(원근 카메라). app/src/domain/camera.ts·ui/shelf/metrics.ts에서 빛·굽기에 쓰는 값만 먼저 옮긴 것.
// 줄마다 원근: 눈은 줄 앞 viewDist만큼 떨어져 있고, 보기 각(아래로 내려다보는 각)은 viewPitchMin~Max.
library;

import 'dart:math' as math;

import '../scene_config/skin.dart';
import 'geometry.dart';

/// 줄 앞 카메라 거리(DU). 틀 없는 책장은 6.45m × 0.7625DU/mm
final viewDist = frameOn ? look.dist : 4918.0;

/// 기본 보기 각(움푹 파인 책장은 눈 높이에서 정해진다)
final viewPitchMin = frameOn ? math.atan(look.eyeY / look.dist) * 180 / math.pi : 4.0;
const viewPitchMax = 8.0;

/// 줄 가운데(선반 공간 x): 화면 가운데 = designWidth / 2 − 책 줄 왼쪽 여백
const viewCx = 183.0;

/// 책장 장면 좌우 여백(움푹 파인 책장은 테가 화면 끝에 닿지 않게)
final scenePad = frameOn ? 4.0 : 0.0;

/// 선반 공간 x = 0의 화면 설계 좌표
const sideMargin = 12.0;

double kyOf(double deg) => math.tan(deg * math.pi / 180);

/// 설계 폭을 화면 폭에 맞추는 배율과 왼쪽 치우침
({double scale, double originX}) metricsOf(double windowWidth) {
  final scale = windowWidth / (designWidth + 2 * scenePad);
  return (scale: scale, originX: scenePad * scale);
}

/// 눈(원근 카메라): 줄 공간 (x, y, z = 0)에서 줄 앞 dist만큼 떨어져 있다. 지금 앱 camAt(deg).eye
class Eye {
  const Eye(this.x, this.y, this.dist);
  final double x;
  final double y;
  final double dist;
}

Eye eyeAt(double deg) => Eye(viewCx, viewDist * kyOf(deg), viewDist);

/// 점 p에서 본 시선 기울기(지금 앱 viewAt): 원근이라 자리마다 다르다
({double kx, double ky}) viewAt(Eye e, double px, double py, double pz) {
  final r = e.dist + pz;
  return (kx: (e.x - px) / r, ky: (e.y - py) / r);
}
