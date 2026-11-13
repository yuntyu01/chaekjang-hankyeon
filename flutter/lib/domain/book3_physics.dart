// 놓인 상자(Placed) ↔ 3D 자세(Book3), 3D 상자 충돌(분리축). 지금 앱 domain/book3.ts의 배치·충돌 쪽을 옮긴 것
library;

import 'dart:math' as math;

import 'book3.dart';
import 'placed.dart';
import 'types.dart';
import 'vec3.dart';

Dims dimsOf(Placed p) => switch (p.pose) {
      Pose.upright => Dims(p.size.w, p.size.h, p.size.d),
      Pose.front => Dims(p.size.d, p.size.h, p.size.w),
      Pose.horizontal => Dims(p.size.h, p.size.w, p.size.d),
    };

({double roll, double yaw}) orientOf(Pose pose, double angle, [bool flip = false]) => switch (pose) {
      Pose.horizontal => (roll: flip ? 90.0 : -90.0, yaw: 0.0),
      Pose.front => (roll: 0.0, yaw: 90.0),
      Pose.upright => (roll: angle, yaw: 0.0),
    };

/// 회전 기준점(책 좌표): 기우는 쪽 바닥 모서리(발)
Vec3 pivotLocal(Dims d, double roll) => roll > 0 ? Vec3(d.t, 0, 0) : const Vec3(0, 0, 0);

/// 표지 전시 책(뒤로 젖힘 + 좌우 돌리기): yaw 90(책 좌표 x = 두께 → 월드 −z, z = 표지 폭 → 월드 x)
Book3 frontBook3(String id, Dims dims, double qx, double depth, [double pitch = 0, double spin = 0]) {
  final f = Vec3(qx, 0, depth + dims.t); // 뒤쪽 아래 모서리 가운데(젖힘 축 위)
  final q = Vec3(qx, 0, depth + dims.t / 2); // 바닥 가운데(돌리기 축 위)
  final c = spin * math.pi / 180;
  final dx = f.x - q.x, dz = f.z - q.z;
  final spun = Vec3(dx * math.cos(c) - dz * math.sin(c), 0, dx * math.sin(c) + dz * math.cos(c));
  final r = rot(0, 90, Vec3(0, 0, dims.w / 2), spin, pitch);
  return Book3(id: id, dims: dims, roll: 0, yaw: 90, pitch: pitch, spin: spin, t: Vec3(q.x + spun.x - r.x, -r.y, q.z + spun.z - r.z));
}

Book3 _withT(Book3 b, Vec3 t) => Book3(id: b.id, dims: b.dims, t: t, roll: b.roll, yaw: b.yaw, spin: b.spin, pitch: b.pitch);

Book3 fromPlaced(Placed p) {
  final dims = dimsOf(p);
  final o = orientOf(p.pose, p.angle, p.flip);
  final spin = p.pose == Pose.horizontal ? (p.spin ?? 0) : 0.0;
  final b = Book3(id: p.bookId, dims: dims, roll: o.roll, yaw: o.yaw, spin: spin, t: const Vec3(0, 0, 0));
  if (p.pose == Pose.front && ((p.pitch ?? 0) != 0 || (p.spin ?? 0) != 0)) {
    final f = frontBook3(p.bookId, dims, 0, p.z, p.pitch ?? 0, p.spin ?? 0);
    var minX = double.infinity;
    for (final c in corners(f)) {
      minX = math.min(minX, c.x);
    }
    return _withT(f, Vec3(f.t.x + p.x - minX, f.t.y + p.y, f.t.z));
  }
  if (p.pose == Pose.upright && p.angle != 0) {
    final foot = Vec3(p.angle > 0 ? p.x + p.size.w : p.x, p.y, p.z);
    return _withT(b, foot - rot(o.roll, o.yaw, pivotLocal(dims, o.roll)));
  }
  final c = corners(b);
  var mx = double.infinity, my = double.infinity, mz = double.infinity;
  for (final q in c) {
    mx = math.min(mx, q.x);
    my = math.min(my, q.y);
    mz = math.min(mz, q.z);
  }
  return _withT(b, Vec3(p.x - mx, p.y - my, p.z - mz));
}

/// 놓인 상자의 여덟 꼭짓점(월드)
List<Vec3> cornersOfPlaced(Placed p) => corners(fromPlaced(p));

/// XZ 평면 점
class PXZ {
  const PXZ(this.x, this.z);
  final double x;
  final double z;
}

List<PXZ> _hullXZ(List<PXZ> pts) {
  final p = [...pts]..sort((a, b) => a.x != b.x ? a.x.compareTo(b.x) : a.z.compareTo(b.z));
  if (p.length < 3) return p;
  double cross(PXZ o, PXZ a, PXZ b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  final lower = <PXZ>[];
  for (final q in p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower.last, q) <= 0) {
      lower.removeLast();
    }
    lower.add(q);
  }
  final upper = <PXZ>[];
  for (final q in p.reversed) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper.last, q) <= 0) {
      upper.removeLast();
    }
    upper.add(q);
  }
  return [...lower.sublist(0, lower.length - 1), ...upper.sublist(0, upper.length - 1)];
}

/// 선반 위(XZ)에서 본 바닥(없으면 윗면) 다각형: 받침·쌓기 판정용
List<PXZ> footprintXZ(Book3 b) {
  final c = corners(b);
  final lo = c.map((q) => q.y).reduce(math.min);
  final hi = c.map((q) => q.y).reduce(math.max);
  final base = c.where((q) => q.y < lo + 0.5).toList();
  final top = c.where((q) => q.y > hi - 0.5).toList();
  return _hullXZ([for (final q in (base.length >= 3 ? base : top)) PXZ(q.x, q.z)]);
}

List<PXZ> topXZ(Book3 b) {
  final c = corners(b);
  final hi = c.map((q) => q.y).reduce(math.max);
  return _hullXZ([for (final q in c.where((q) => q.y > hi - 0.5)) PXZ(q.x, q.z)]);
}

double topY(Book3 b) => corners(b).map((q) => q.y).reduce(math.max);

/// 볼록 다각형 inner가 outer 안에 있는지(tol만큼 삐져나오는 것은 허용)
bool containsXZ(List<PXZ> outer, List<PXZ> inner, [double tol = 0.3]) {
  for (var i = 0; i < outer.length; i++) {
    final a = outer[i], b = outer[(i + 1) % outer.length];
    final ex = b.x - a.x, ez = b.z - a.z;
    var len = math.sqrt(ex * ex + ez * ez);
    if (len == 0) len = 1;
    for (final q in inner) {
      final cr = (ex * (q.z - a.z) - ez * (q.x - a.x)) / len;
      if (cr < -tol) return false;
    }
  }
  return true;
}

class _Obb {
  const _Obb(this.c, this.ax, this.h);
  final Vec3 c;
  final List<Vec3> ax;
  final List<double> h;
}

_Obb _obb(Book3 b) {
  final d = b.dims;
  return _Obb(
    toWorld(b, Vec3(d.t / 2, d.h / 2, d.w / 2)),
    [
      rot(b.roll, b.yaw, const Vec3(1, 0, 0), b.spin, b.pitch),
      rot(b.roll, b.yaw, const Vec3(0, 1, 0), b.spin, b.pitch),
      rot(b.roll, b.yaw, const Vec3(0, 0, 1), b.spin, b.pitch),
    ],
    [d.t / 2, d.h / 2, d.w / 2],
  );
}

List<Vec3> _axes(_Obb a, _Obb b) {
  final axes = [...a.ax, ...b.ax];
  for (var i = 0; i < 3; i++) {
    for (var j = 0; j < 3; j++) {
      final c = a.ax[i].cross(b.ax[j]);
      final l = c.length;
      if (l > 1e-6) axes.add(c * (1 / l));
    }
  }
  return axes;
}

double _radius(_Obb o, Vec3 n) =>
    o.h[0] * o.ax[0].dot(n).abs() + o.h[1] * o.ax[1].dot(n).abs() + o.h[2] * o.ax[2].dot(n).abs();

/// 두 상자 사이 간격(분리축 중 가장 큰 틈, 음수면 그만큼 파고듦). 맞닿음은 0 근처
double gap(Book3 a, Book3 b) {
  final A = _obb(a), B = _obb(b);
  final d = B.c - A.c;
  var best = double.negativeInfinity;
  for (final n in _axes(A, B)) {
    final g = d.dot(n).abs() - _radius(A, n) - _radius(B, n);
    if (g > best) best = g;
  }
  return best;
}

/// B를 x축으로 s만큼 옮길 때 두 상자가 tol보다 깊이 겹치는 s의 열린 구간
({double lo, double hi})? collisionRangeX(Book3 a, Book3 b, [double tol = 0]) {
  final A = _obb(a), B = _obb(b);
  final d = B.c - A.c;
  var lo = double.negativeInfinity, hi = double.infinity;
  for (final n in _axes(A, B)) {
    final radius = _radius(A, n) + _radius(B, n) - tol;
    final center = d.dot(n);
    if (radius <= 0) return null;
    if (n.x.abs() < 1e-12) {
      if (center.abs() >= radius - 1e-9) return null;
      continue;
    }
    final s0 = (-radius - center) / n.x, s1 = (radius - center) / n.x;
    lo = math.max(lo, math.min(s0, s1));
    hi = math.min(hi, math.max(s0, s1));
    if (lo >= hi) return null;
  }
  return (lo: lo, hi: hi);
}

double lowest(Book3 b) => corners(b).map((q) => q.y).reduce(math.min);

({double lo, double hi}) xRange(Book3 b) {
  final c = corners(b).map((q) => q.x);
  return (lo: c.reduce(math.min), hi: c.reduce(math.max));
}
