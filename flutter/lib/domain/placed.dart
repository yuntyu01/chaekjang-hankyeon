// 책 상자 모델(순수). 책 한 권 = 상자 하나이고, 자세(책등·표지·눕힘)는 같은 상자를 돌린 것이다.
// 선반 공간: x = 선반 판 안쪽 왼쪽에서 오른쪽(DU), y = 바닥에서 위, z = 책 줄 앞선에서 벽 쪽. 지금 앱 domain/box.ts를 옮긴 것
library;

import 'dart:math' as math;

import 'book3_physics.dart';
import 'geometry.dart';
import 'types.dart';

/// 선반 공간에서 상자가 차지하는 크기: w = 가로(x), h = 높이(y), d = 깊이(z)
class BoxSize {
  const BoxSize(this.w, this.h, this.d);
  final double w;
  final double h;
  final double d;
}

/// 자세(지금 앱 이름: spine = 세움, front = 표지 전시, horizontal = 눕힘)
BoxSize boxSize(Book book, Pose pose) {
  final t = bookThickness(book), h = bookHeight(book), w = frontWidth(book);
  return switch (pose) {
    Pose.upright => BoxSize(t, h, w),
    Pose.front => BoxSize(w, h, t),
    Pose.horizontal => BoxSize(h, t, w),
  };
}

/// 놓인 상자. angle(도): +면 오른쪽으로 기울어 오른쪽 아래 모서리가 축, −면 왼쪽 아래 모서리가 축(세운 책만).
/// x는 똑바로 섰을 때 왼쪽 면, y 밑면, z 앞면. spin: 눕힌 책의 수직축 회전(x·z는 돌린 뒤 축 정렬 상자의 최솟값),
/// pitch: 표지 책이 벽에 기댄 각(z는 똑바로 섰을 때 앞면), flip: 눕힌 책의 머리가 오른쪽
class Placed {
  const Placed(this.bookId, this.pose, this.size, this.x, this.y, this.z, this.angle, {this.spin, this.pitch, this.flip = false});
  final String bookId;
  final Pose pose;
  final BoxSize size;
  final double x;
  final double y;
  final double z;
  final double angle;
  final double? spin;
  final double? pitch;
  final bool flip;

  Placed copyWith({double? x, double? y, double? z, double? angle, BoxSize? size}) =>
      Placed(bookId, pose, size ?? this.size, x ?? this.x, y ?? this.y, z ?? this.z, angle ?? this.angle,
          spin: spin, pitch: pitch, flip: flip);
}

double _rad(double d) => d * math.pi / 180;

/// 수직축으로 돌린 눕힌 책의 축 정렬 폭·깊이
double aabbW(Placed p) {
  final s = p.spin;
  if (s == null || s == 0) return p.size.w;
  final r = _rad(s);
  return (p.size.w * math.cos(r)).abs() + (p.size.d * math.sin(r)).abs();
}

/// 2D 점(선반 공간 x-y, y 위)
class P2 {
  const P2(this.x, this.y);
  final double x;
  final double y;
}

/// 앞면 윤곽(선반 공간 x-y). 반시계: 왼아래 → 오른아래 → 오른위 → 왼위
List<P2> frontPoly(Placed p) {
  final h = p.size.h;
  final w = aabbW(p);
  final base = [P2(p.x, p.y), P2(p.x + w, p.y), P2(p.x + w, p.y + h), P2(p.x, p.y + h)];
  if (p.angle == 0) return base;
  final pivot = p.angle > 0 ? base[1] : base[0];
  final t = _rad(-p.angle);
  final c = math.cos(t), s = math.sin(t);
  return [
    for (final q in base)
      P2(pivot.x + (q.x - pivot.x) * c - (q.y - pivot.y) * s, pivot.y + (q.x - pivot.x) * s + (q.y - pivot.y) * c),
  ];
}

/// 공통 허용 오차(DU): 이보다 얕게 파고드는 것은 맞닿음·계산 오차로 본다
const tolerance = 0.25;

/// 접촉 탐색(기대기 각도를 찾을 때)의 기준
const contactTol = 0.05;

/// 선반 공간 충돌: 두 책의 실제 회전 상자 분리축 검사
bool collide(Placed a, Placed b, [double margin = tolerance]) => gap(fromPlaced(a), fromPlaced(b)) < -margin;

/// 볼록 껍질(모노톤 체인)
List<P2> hull2(List<P2> points) {
  final p = [...points]..sort((a, b) => a.x != b.x ? a.x.compareTo(b.x) : a.y.compareTo(b.y));
  if (p.length < 3) return p;
  double cross(P2 o, P2 a, P2 b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  final lower = <P2>[];
  for (final q in p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower.last, q) <= 0) {
      lower.removeLast();
    }
    lower.add(q);
  }
  final upper = <P2>[];
  for (final q in p.reversed) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper.last, q) <= 0) {
      upper.removeLast();
    }
    upper.add(q);
  }
  return [...lower.sublist(0, lower.length - 1), ...upper.sublist(0, upper.length - 1)];
}


/// 지금 앱 Math.round와 같은 반올림(.5는 +∞ 쪽: −5337.5 → −5337). Dart round()는 0에서 먼 쪽이라 음수 반올림이 0.01씩 어긋났다
double jsRound(double v) => (v + 0.5).floorToDouble();
