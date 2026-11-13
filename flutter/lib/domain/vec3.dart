// 3D 점·방향과 선형 RGB 색. app/src/domain/camera.ts의 Vec3, light-model.ts의 C3를 옮긴 것.
// 좌표는 책장 좌표(DU, 1DU ≈ 1mm): x 오른쪽, y 위, z 앞(벽에서 나오는 쪽)
library;

import 'dart:math' as math;

class Vec3 {
  const Vec3(this.x, this.y, this.z);
  final double x;
  final double y;
  final double z;

  static const zero = Vec3(0, 0, 0);

  Vec3 operator +(Vec3 b) => Vec3(x + b.x, y + b.y, z + b.z);
  Vec3 operator -(Vec3 b) => Vec3(x - b.x, y - b.y, z - b.z);
  Vec3 operator *(double k) => Vec3(x * k, y * k, z * k);
  Vec3 operator -() => Vec3(-x, -y, -z);

  double dot(Vec3 b) => x * b.x + y * b.y + z * b.z;
  Vec3 cross(Vec3 b) => Vec3(y * b.z - z * b.y, z * b.x - x * b.z, x * b.y - y * b.x);
  double get length => math.sqrt(x * x + y * y + z * z);
  Vec3 get unit {
    final l = length;
    return l > 0 ? Vec3(x / l, y / l, z / l) : zero;
  }

  List<double> get list => [x, y, z];

  @override
  String toString() => '($x, $y, $z)';
}

/// 선형 RGB 세 채널(0~). 감마를 푼 값이라 더하고 곱할 수 있다
class C3 {
  const C3(this.r, this.g, this.b);
  const C3.grey(double v) : r = v, g = v, b = v;
  final double r;
  final double g;
  final double b;

  static const black = C3.grey(0);
  static const white = C3.grey(1);

  C3 operator +(C3 c) => C3(r + c.r, g + c.g, b + c.b);
  C3 operator -(C3 c) => C3(r - c.r, g - c.g, b - c.b);
  C3 operator *(Object k) => k is C3 ? C3(r * k.r, g * k.g, b * k.b) : C3(r * (k as double), g * k, b * k);

  double get lum => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  List<double> get list => [r, g, b];

  @override
  String toString() => '[$r, $g, $b]';
}

/// 화면 감마(지금 앱 light-model GAMMA): 색 ↔ 선형은 이 거듭제곱 하나다(sRGB 구간 곡선이 아니다)
const gamma = 2.2;

/// 16진 색(0xRRGGBB) → 선형 RGB(지금 앱 linearOf)
C3 linearOf(int hex) {
  double ch(int v) => math.pow(v / 255, gamma).toDouble();
  return C3(ch((hex >> 16) & 0xFF), ch((hex >> 8) & 0xFF), ch(hex & 0xFF));
}
