// 책 상자의 3D 자세. app/src/domain/book3.ts·book-parts.ts에서 빛 계산에 쓰는 것만 옮긴 것.
// 책 좌표: 세운 책(책등이 앞) 기준으로 x = 두께 T(왼쪽 뒤표지 → 오른쪽 앞표지), y = 세로 H(아래 → 위), z = 표지 폭 W(앞 책등 → 뒤 책배).
// 방향(합성 순서 고정): ① 세로축 yaw → ② 앞뒤축 roll(+ = 오른쪽으로 기울기) → ③ 좌우축 pitch(+ = 윗부분이 벽 쪽) → ④ 수직축 spin.
// 선반 공간(월드): x 오른쪽, y 위, z 벽 쪽. 월드 점 = R·책좌표 + t
library;

import 'dart:math' as math;

import 'geometry.dart';
import 'vec3.dart';

class Dims {
  const Dims(this.t, this.h, this.w);

  /// 두께
  final double t;

  /// 세로
  final double h;

  /// 표지 폭
  final double w;
}

class Book3 {
  const Book3({
    required this.id,
    required this.dims,
    required this.t,
    this.roll = 0,
    this.yaw = 0,
    this.spin = 0,
    this.pitch = 0,
  });

  final String id;
  final Dims dims;
  final Vec3 t;
  final double roll;
  final double yaw;
  final double spin;
  final double pitch;
}

/// 책 좌표 → 월드 방향(자리 t는 빼고 돌리기만)
Vec3 rot(double roll, double yaw, Vec3 v, [double spin = 0, double pitch = 0]) {
  if (spin != 0 || pitch != 0) {
    var r = rot(roll, yaw, v);
    if (pitch != 0) {
      final c = pitch * math.pi / 180;
      final cs = math.cos(c), sn = math.sin(c);
      r = Vec3(r.x, r.y * cs - r.z * sn, r.z * cs + r.y * sn);
    }
    if (spin != 0) {
      final c = spin * math.pi / 180;
      final cs = math.cos(c), sn = math.sin(c);
      r = Vec3(r.x * cs - r.z * sn, r.y, r.x * sn + r.z * cs);
    }
    return r;
  }
  final b = yaw * math.pi / 180;
  final cb = math.cos(b), sb = math.sin(b);
  final x1 = v.x * cb + v.z * sb;
  final z1 = -v.x * sb + v.z * cb;
  // 시계 방향 + → 수학 각은 −
  final a = -roll * math.pi / 180;
  final ca = math.cos(a), sa = math.sin(a);
  return Vec3(x1 * ca - v.y * sa, x1 * sa + v.y * ca, z1);
}

Vec3 toWorld(Book3 b, Vec3 v) => rot(b.roll, b.yaw, v, b.spin, b.pitch) + b.t;

Vec3 cornerLocal(Dims d, int i) => Vec3(i & 1 != 0 ? d.t : 0, i & 2 != 0 ? d.h : 0, i & 4 != 0 ? d.w : 0);

List<Vec3> corners(Book3 b) => List.generate(8, (i) => toWorld(b, cornerLocal(b.dims, i)));

enum FaceId { spine, cover, back, head, tail, fore }

/// 면의 바깥 법선(책 좌표)
Vec3 faceNormal(FaceId f) => switch (f) {
      FaceId.spine => const Vec3(0, 0, -1),
      FaceId.cover => const Vec3(1, 0, 0),
      FaceId.back => const Vec3(-1, 0, 0),
      FaceId.head => const Vec3(0, 1, 0),
      FaceId.tail => const Vec3(0, -1, 0),
      FaceId.fore => const Vec3(0, 0, 1),
    };

/// 평면 조각: 원점 O에서 U(가로 끝), V(세로 끝)로 펼친 평행사변형. 그림 좌표 w×h(DU)가 이 조각에 붙는다
class Panel {
  const Panel(this.o, this.u, this.v, this.w, this.h);
  final Vec3 o;
  final Vec3 u;
  final Vec3 v;
  final double w;
  final double h;
}

/// 표지판 두께(bd)와 책등 띠(sp). 속지 면은 판 끝 테두리를 뺀 넓이만큼 종이다
({double bd, double sp}) rigOf(Dims d) {
  const minBd = 0.95, maxBd = 1.7, k = 0.047;
  final bd = math.max(minBd, math.min(maxBd, d.t * k));
  return (bd: bd, sp: bd * 1.1);
}

/// 판 끝 여유(양장 표지 판이 속지보다 나온 길이, 실제 2~3mm)
final square = mm(2.5);

Panel _facePanel(Dims d, FaceId f) {
  if (f == FaceId.spine) return Panel(Vec3(0, d.h, 0), Vec3(d.t, 0, 0), Vec3(0, -d.h, 0), d.t, d.h);
  if (f == FaceId.cover) return Panel(Vec3(d.t, d.h, 0), Vec3(0, 0, d.w), Vec3(0, -d.h, 0), d.w, d.h);
  return Panel(Vec3(0, d.h, d.w), Vec3(0, 0, -d.w), Vec3(0, -d.h, 0), d.w, d.h);
}

/// 빛을 계산할 면 틀(바깥 평면 전체). 책등·표지·뒤표지는 면 그대로, 머리·꼬리·책배는 판 끝 평면
Panel lightPanel(Dims d, FaceId f) {
  if (f == FaceId.spine || f == FaceId.cover || f == FaceId.back) return _facePanel(d, f);
  if (f == FaceId.fore) return Panel(Vec3(0, d.h, d.w), Vec3(d.t, 0, 0), Vec3(0, -d.h, 0), d.t, d.h);
  return Panel(Vec3(0, f == FaceId.head ? d.h : 0, 0), Vec3(d.t, 0, 0), Vec3(0, 0, d.w), d.t, d.w);
}
