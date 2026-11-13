// 가만히 있는 자세 판정(정역학, 순수). 책을 고른 직육면체로 보고 넘어짐(무게중심)·미끄러짐(바닥 마찰 0.4)·받침 넘어감을 푼다.
// 지금 앱 domain/statics.ts를 옮긴 것
library;

import 'dart:math' as math;

import 'book3.dart';
import 'book3_physics.dart';
import 'placed.dart';
import 'types.dart';

const floorFriction = 0.4;

/// 메뉴로 기울일 때 쓰는 가장 큰 각(디자인 한도)
const leanMenuMax = 20.0;

/// 메뉴로 기울일 때 넘어짐 한계보다 더 기울게 하는 여유
const leanMargin = 1.5;

const _deg = 180 / math.pi;

/// 평평한 받침에 기댈 때 다시 서는 한계(도)
double tipAngle(double t, double h) => math.atan2(t, h) * _deg;

/// 평평한 받침에 기댈 때 바닥이 미끄러지지 않는 가장 큰 각(도)
double slipAngle(double t, double h, [double mu = floorFriction]) => math.atan(2 * mu + t / h) * _deg;

double? menuLeanAngle(double t, double h) {
  final want = tipAngle(t, h) + leanMargin;
  return want <= leanMenuMax ? want : null;
}

/// 표지 책이 벽에 기댈 때 손을 놓은 뒤 머무는 젖힘 각
double wallLeanRest(double t, double h, double pitch) {
  if (pitch >= 89.95) return 90;
  if (pitch <= tipAngle(t, h)) return 0;
  if (pitch > slipAngle(t, h)) return 90;
  return pitch;
}

bool leanHolds(double t, double h, double angle, [double mu = floorFriction]) {
  final a = angle.abs();
  return a > tipAngle(t, h) && a <= slipAngle(t, h, mu);
}

double _cross(P2 a, P2 b) => a.x * b.y - a.y * b.x;

/// 상자의 x-y 외곽(깊이 방향으로 본 실루엣)
List<P2> outlineXY(Placed p) => hull2([for (final c in corners(fromPlaced(p))) P2(c.x, c.y)]);

double massOf(Placed p) => p.size.w * p.size.h * p.size.d;

P2 centerXY(Placed p) {
  final cs = corners(fromPlaced(p));
  var x = 0.0, y = 0.0;
  for (final c in cs) {
    x += c.x;
    y += c.y;
  }
  return P2(x / cs.length, y / cs.length);
}

/// 기댄 세운 책의 바닥 축 모서리(x-y)
P2 pivotOf(Placed p) => P2(p.angle > 0 ? p.x + p.size.w : p.x, p.y);

({P2 c, double d}) _closestOnSegment(P2 q, P2 a, P2 b) {
  final dx = b.x - a.x, dy = b.y - a.y;
  var l2 = dx * dx + dy * dy;
  if (l2 == 0) l2 = 1;
  final t = math.max(0.0, math.min(1.0, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
  final c = P2(a.x + t * dx, a.y + t * dy);
  return (c: c, d: math.sqrt((q.x - c.x) * (q.x - c.x) + (q.y - c.y) * (q.y - c.y)));
}

P2 _outward(P2 a, P2 b) {
  var l = math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
  if (l == 0) l = 1;
  return P2((b.y - a.y) / l, -(b.x - a.x) / l);
}

/// 볼록 다각형 둘(반시계)이 파고든 깊이(음수면 떨어져 있다)
double penetration2(List<P2> a, List<P2> b) {
  var depth = double.infinity;
  for (final p in [a, b]) {
    for (var i = 0; i < p.length; i++) {
      final n = _outward(p[i], p[(i + 1) % p.length]);
      var a0 = double.infinity, a1 = double.negativeInfinity, b0 = double.infinity, b1 = double.negativeInfinity;
      for (final q in a) {
        final t = q.x * n.x + q.y * n.y;
        a0 = math.min(a0, t);
        a1 = math.max(a1, t);
      }
      for (final q in b) {
        final t = q.x * n.x + q.y * n.y;
        b0 = math.min(b0, t);
        b1 = math.max(b1, t);
      }
      depth = math.min(depth, math.min(a1, b1) - math.max(a0, b0));
    }
  }
  return depth;
}

/// 접촉: 자리와 받침이 기댄 책을 미는 방향(단위)
class Contact {
  const Contact(this.at, this.n);
  final P2 at;
  final P2 n;
}

/// 기댄 책과 받침 다각형(볼록, 반시계)의 접촉(마찰 0)
Contact contact2(P2 pivot, P2 top, double dir, List<P2> s) {
  var bestD = double.infinity;
  var bestAt = top;
  var bestN = P2(-dir, 0);
  for (final facing in [true, false]) {
    for (var i = 0; i < s.length; i++) {
      final a = s[i], b = s[(i + 1) % s.length];
      final n = _outward(a, b);
      if (facing && n.x * dir > -0.3) continue;
      final d = _closestOnSegment(top, a, b).d;
      if (d < bestD) {
        bestD = d;
        bestAt = top;
        bestN = n;
      }
    }
    if (bestD < double.infinity) break;
  }
  var inward = _outward(pivot, top);
  if (inward.x.sign != dir) inward = P2(-inward.x, -inward.y);
  inward = P2(-inward.x, -inward.y);
  for (final v in s) {
    final r = _closestOnSegment(v, pivot, top);
    if (r.d < bestD - 1e-6) {
      bestD = r.d;
      bestAt = r.c;
      bestN = inward;
    }
  }
  return Contact(bestAt, bestN);
}

/// 세운 책의 2D 값: 축, 기우는 쪽 윗모서리(발에서 책의 위 방향으로 키만큼), 기우는 쪽
({P2 pivot, P2 top, double dir}) _spineLeaner2(Placed p) {
  final dir = p.angle == 0 ? 1.0 : p.angle.sign;
  final pv = pivotOf(p);
  final a = p.angle * math.pi / 180;
  return (pivot: pv, top: P2(pv.x + p.size.h * math.sin(a), pv.y + p.size.h * math.cos(a)), dir: dir);
}

Contact contactOf(Placed leaner, Placed support) {
  final l = _spineLeaner2(leaner);
  return contact2(l.pivot, l.top, l.dir, outlineXY(support));
}

class Force {
  const Force(this.f, this.at);
  final P2 f;
  final P2 at;
}

class LeanStatics {
  const LeanStatics(this.normal, this.onSupport, this.floor, this.ok, [this.reason]);
  final double normal;
  final Force onSupport;
  final P2 floor;
  final bool ok;
  final String? reason;
}

/// 기댄 책 한 권의 힘 평형(2D): 바닥 축(마찰) + 무게 + 받침 접촉(마찰 0) + 밖에서 오는 힘
LeanStatics statics2(P2 pivot, P2 g, double m, Contact contact, [List<Force> external = const [], double mu = floorFriction]) {
  P2 r(P2 q) => P2(q.x - pivot.x, q.y - pivot.y);
  var tau = _cross(r(g), P2(0, -m));
  for (final e in external) {
    tau += _cross(r(e.at), e.f);
  }
  final lever = _cross(r(contact.at), contact.n);
  final n = lever.abs() < 1e-9 ? -1.0 : -tau / lever;
  final fx = n * contact.n.x + external.fold(0.0, (s, e) => s + e.f.x);
  final fy = n * contact.n.y + external.fold(0.0, (s, e) => s + e.f.y) - m;
  final floor = P2(-fx, -fy);
  final onSupport = Force(P2(-n * contact.n.x, -n * contact.n.y), contact.at);
  if (n <= 0) return LeanStatics(n / m, onSupport, floor, false, 'tip');
  if (floor.y <= 0 || floor.x.abs() > mu * floor.y + 1e-9) return LeanStatics(n / m, onSupport, floor, false, 'slip');
  return LeanStatics(n / m, onSupport, floor, true);
}

LeanStatics leanStatics(Placed leaner, Contact contact, [List<Force> external = const [], double mu = floorFriction]) =>
    statics2(pivotOf(leaner), centerXY(leaner), massOf(leaner), contact, external, mu);

/// 받침이 되는 똑바로 선 세운 책이 기댄 책들이 미는 힘에 넘어가는지(넘어가면 그 방향)
int supportTips(Placed support, List<Force> pushes, bool Function(int dir) backed) {
  if (support.pose != Pose.upright || support.angle != 0 || pushes.isEmpty) return 0;
  final fx = pushes.fold(0.0, (s, p) => s + p.f.x);
  final d = fx.sign.toInt();
  if (d == 0 || backed(d)) return 0;
  final q = P2(d < 0 ? support.x : support.x + support.size.w, support.y);
  final g = centerXY(support);
  final m = massOf(support);
  P2 r(P2 v) => P2(v.x - q.x, v.y - q.y);
  var tau = _cross(r(g), P2(0, -m));
  for (final p in pushes) {
    tau += _cross(r(p.at), p.f);
  }
  final tips = d < 0 ? tau > 1e-9 : tau < -1e-9;
  if (tips) return d;
  final fy = m - pushes.fold(0.0, (s, p) => s + p.f.y);
  return fx.abs() > floorFriction * fy + 1e-9 ? d : 0;
}

/// 받침 너머(밀리는 쪽)에 붙어 선 책이 있는지
bool isBacked(Placed support, int dir, List<Placed> others, [double tol = 0.5]) {
  final s = fromPlaced(support);
  final sc = centerXY(support).x;
  return others.any((o) => o.bookId != support.bookId && (centerXY(o).x - sc).sign == dir && gap(s, fromPlaced(o)) < tol);
}

/// 넘어지는 책이 바닥에 누울 때 차지하는 가로 범위
({double x0, double x1}) fallenSpan(Placed p, int dir) {
  final pv = pivotOf(p.copyWith(angle: dir.toDouble()));
  return dir < 0 ? (x0: pv.x - p.size.h, x1: pv.x) : (x0: pv.x, x1: pv.x + p.size.h);
}
