// 기대기 각 찾기(순수): 세운 책을 바닥 모서리를 축으로 쓰러뜨리며 옆 책의 실제 3D 상자에 처음 닿는 각도. 지금 앱 domain/lean.ts
library;

import 'book3.dart';
import 'book3_physics.dart';
import 'placed.dart';
import 'statics.dart';

class LeanContact {
  const LeanContact(this.angle, this.found, this.outside, [this.on]);
  final double angle;
  final String? on;
  final bool found;
  final bool outside;
}

LeanContact leanContact(Placed p, int dir, List<Placed> others, ({double min, double max}) bounds,
    [double from = 0, double to = leanMenuMax]) {
  final obstacles = [for (final o in others.where((o) => o.bookId != p.bookId)) (id: o.bookId, b: fromPlaced(o))];
  Book3 placedAt(double deg) => fromPlaced(p.copyWith(angle: dir * deg));
  bool out(double deg) => frontPoly(p.copyWith(angle: dir * deg)).any((q) => q.x < bounds.min - 0.01 || q.x > bounds.max + 0.01);
  String? touching(double deg) {
    final me = placedAt(deg);
    for (final o in obstacles) {
      if (gap(me, o.b) < -contactTol) return o.id;
    }
    return null;
  }

  final c = firstContact((deg) => out(deg) || touching(deg) != null, from, to);
  if (!c.found) return LeanContact(from, false, false);
  final on = touching(c.angle + 0.6);
  return LeanContact(c.angle, on != null, on == null, on);
}

/// hits(deg)가 처음 참이 되는 직전 각도: 0.5도 간격으로 찾고 이분법으로 좁힌다
({double angle, bool found}) firstContact(bool Function(double deg) hits, [double from = 0, double to = leanMenuMax]) {
  if (hits(from + 0.3)) return (angle: from, found: true);
  const step = 0.5;
  var lo = from;
  var hi = -1.0;
  for (var d = from + step; d <= to + 1e-9; d += step) {
    if (hits(d)) {
      hi = d;
      break;
    }
    lo = d;
  }
  if (hi < 0) return (angle: from, found: false);
  for (var i = 0; i < 12; i++) {
    final mid = (lo + hi) / 2;
    if (hits(mid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return (angle: lo, found: true);
}
