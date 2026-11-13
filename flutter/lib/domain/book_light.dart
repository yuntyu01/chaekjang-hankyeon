// 책 장정 색(화면 색) → 실제 반사율: 화면 톤 곡선을 거꾸로 풀고 반사광을 뺀 뒤 대표 자리 빛·카메라 이득으로 나눈다.
// 굽기의 색 번짐(옆 책·벽으로 튄 빛)에 쓴다. 지금 앱 light-model toneInv·bookAlbedo를 옮긴 것
library;

import 'dart:math' as math;

import '../gen/book_light.g.dart';
import 'vec3.dart';

/// 화면 톤 곡선의 거꾸로(발끝은 3차식이라 뉴턴 여섯 번, 어깨는 지수)
double toneInv(double y) {
  const toe = toneToe, k = toneK, s = toneShoulder;
  if (y <= 0) return 0;
  if (y < toe) {
    var x = y;
    for (var i = 0; i < 6; i++) {
      final u = 1 - x / toe;
      final f = x - k * x * u * u - y;
      final d = 1 - k * u * u + 2 * k * x * u / toe;
      x -= f / d;
    }
    return x;
  }
  if (y <= s) return y;
  if (y >= 1) return 1e4;
  return s - (1 - s) * math.log((1 - y) / math.max(1e-6, 1 - s));
}

/// 장정 색(#rrggbb) → 반사율(재질: fine·linen·matte·laid)
C3 bookAlbedo(String hex, [String material = 'fine']) {
  final c = linearOf(int.parse(hex.substring(1), radix: 16));
  final e = bookErefOf[material]!, sr = bookSrefOf[material]!;
  double ch(double v, double s, double cam, double ee) => math.max(0, toneInv(v) - s) * cam / ee / camGain;
  return C3(ch(c.r, sr.r, erefWall.r, e.r), ch(c.g, sr.g, erefWall.g, e.g), ch(c.b, sr.b, erefWall.b, e.b));
}

/// 사진 책(표지 사진이 있는 책)의 빛 셰이더 반사율: 회색 0.5(색은 그림이 낸다)
const pictureAlbedo = C3(0.5, 0.5, 0.5);
