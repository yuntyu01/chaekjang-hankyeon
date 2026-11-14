// 표지 전시 책의 자세(뒤로 젖힘·좌우 돌리기)의 축 정렬 범위. 지금 앱 domain/front-pose.ts의 frontExtent
library;

import 'dart:math' as math;

import 'book3.dart';
import 'book3_physics.dart';
import 'geometry.dart';
import 'placed.dart';
import 'statics.dart';
import 'types.dart';

({double x0, double x1, double y1, double z0, double z1}) frontExtent(Dims dims, [double pitch = 0, double spin = 0]) {
  final cs = corners(frontBook3('', dims, 0, 0, pitch, spin));
  var x0 = double.infinity, x1 = double.negativeInfinity, y1 = double.negativeInfinity;
  var z0 = double.infinity, z1 = double.negativeInfinity;
  for (final c in cs) {
    x0 = math.min(x0, c.x);
    x1 = math.max(x1, c.x);
    y1 = math.max(y1, c.y);
    z0 = math.min(z0, c.z);
    z1 = math.max(z1, c.z);
  }
  return (x0: x0, x1: x1, y1: y1, z0: z0, z1: z1);
}

/// 표지 전시 책의 상자 치수(책 좌표 T·H·W)
Dims frontDims(Book book) => Dims(bookThickness(book), bookHeight(book), frontWidth(book));

({double x0, double x1, double y1, double z0, double z1}) frontExt(Book book, {double? pitch, double? spin}) =>
    frontExtent(frontDims(book), pitch ?? 0, spin ?? 0);

// ---------- 표지 전시 책 자세 바꾸기(지금 앱 front-pose.ts 나머지) ----------

/// 손으로 새로 젖히는 범위(중력으로 넘어지는 자세는 90°까지), 벽에 닿은 것으로 보는 거리(DU)
const frontMaxPitch = 25.0;
const wallTouch = 0.3;

/// 표지 책 자세: depth = 똑바로 섰을 때 앞면 z, pitch = 뒤로 젖힘, spin = 좌우 돌리기
typedef FrontState = ({double depth, double pitch, double spin});

/// 가장 벽 쪽 꼭짓점의 z
double wallReach(Dims dims, FrontState s) => s.depth + frontExtent(dims, s.pitch, s.spin).z1;

/// 이 바닥 자리·좌우 각에서 머리가 벽에 닿는 젖힘 각(똑바로도 닿으면 0, 최대 각으로도 안 닿으면 null)
double? pitchForWall(Dims dims, double depth, double spin, double wall, [double max = frontMaxPitch + 10]) {
  double reach(double p) => depth + frontExtent(dims, p, spin).z1;
  if (reach(0) >= wall) return 0;
  if (reach(max) < wall) return null;
  var lo = 0.0, hi = max;
  for (var i = 0; i < 40; i++) {
    final mid = (lo + hi) / 2;
    if (reach(mid) < wall) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hi;
}

double _r2(double v) => jsRound(v * 100) / 100;

/// 표지 책 기본 자세: 넘어지지 않는 각(넘어짐 한계 + 3°)으로 머리가 벽에 닿는 자리
({double depth, double pitch, double? spin}) wallLeanPose(Dims dims, double wall, [double spin = 0]) {
  final pitch = _r2(tipAngle(dims.t, dims.h) + 3);
  return (depth: wall - frontExtent(dims, pitch, spin).z1, pitch: pitch, spin: spin == 0 ? null : spin);
}

/// 머리 젖히기 한 걸음
FrontState tiltStep(Dims dims, FrontState cur, double pitch, double wall) {
  final p = math.max(0.0, math.min(math.max(frontMaxPitch, cur.pitch), pitch));
  final touching = cur.pitch > 0 && wallReach(dims, cur) >= wall - wallTouch;
  final r = wallReach(dims, (depth: cur.depth, pitch: p, spin: cur.spin));
  var depth = cur.depth;
  if (r > wall || (touching && p < cur.pitch)) depth += wall - r;
  return (depth: depth, pitch: p, spin: cur.spin);
}

/// 좌우 돌리기 한 걸음(front: 선반 앞 끝 z)
FrontState spinStep(Dims dims, FrontState cur, double spin, double wall, double max, [double front = double.negativeInfinity]) {
  final s = math.max(-max, math.min(max, spin));
  final touching = cur.pitch > 0 && wallReach(dims, cur) >= wall - wallTouch;
  final r = wallReach(dims, (depth: cur.depth, pitch: cur.pitch, spin: s));
  var depth = cur.depth;
  if (touching || r > wall) depth += wall - r;
  final z0 = depth + frontExtent(dims, cur.pitch, s).z0;
  if (z0 < front) depth += front - z0;
  return (depth: depth, pitch: cur.pitch, spin: s);
}

/// 벽에서 떨어져 손으로만 받치고 있는 자세인지
bool frontUnsupported(Dims dims, FrontState s, double wall) => s.pitch > 0.05 && wallReach(dims, s) < wall - wallTouch - 0.2;

/// 손을 놓았을 때 머무는 젖힘
double releasedPitch(Dims dims, FrontState s, double wall) {
  if (s.pitch >= 89.95) return 90;
  if (s.pitch <= tipAngle(dims.t, dims.h)) return 0;
  final p = frontUnsupported(dims, s, wall) ? (pitchForWall(dims, s.depth, s.spin, wall, 90) ?? 90) : s.pitch;
  return wallLeanRest(dims.t, dims.h, p);
}

/// 젖힌 책의 2D 값(젖힘 평면: 가로 = z, 세로 = y). 축 = 뒤쪽 아래 모서리, 윗모서리 = 뒤쪽 위 모서리, poly = 옆에서 본 직사각형
({P2 pivot, P2 top, double dir, P2 g, double m, List<P2> poly}) frontLeaner2(Dims dims, FrontState s) {
  final r = s.pitch * math.pi / 180;
  final c = math.cos(r), sn = math.sin(r);
  final f = P2(s.depth + dims.t, 0);
  P2 at(double a, double b) => P2(f.x + a * c + b * sn, f.y - a * sn + b * c);
  final top = at(0, dims.h);
  return (pivot: f, top: top, dir: 1, g: at(-dims.t / 2, dims.h / 2), m: dims.t * dims.h * dims.w, poly: [f, top, at(-dims.t, dims.h), at(-dims.t, 0)]);
}

/// 받침 상자를 이 책의 젖힘 평면에 놓은 볼록 외곽(이 책 폭 안에 든 부분만)
List<P2> frontSupport2(Dims dims, FrontState s, double qx, Book3 support) {
  final r = s.spin * math.pi / 180;
  final c = math.cos(r), sn = math.sin(r);
  final qz = s.depth + dims.t / 2;
  final w = dims.w / 2;
  final cs = [
    for (final p in corners(support)) (x: (p.x - qx) * c + (p.z - qz) * sn, z: qz - (p.x - qx) * sn + (p.z - qz) * c, y: p.y),
  ];
  final pts = <P2>[for (final q in cs) if (q.x.abs() <= w) P2(q.z, q.y)];
  for (var i = 0; i < 8; i++) {
    for (final bit in const [1, 2, 4]) {
      if (i & bit != 0) continue;
      final a = cs[i], b = cs[i | bit];
      for (final e in [-w, w]) {
        if ((a.x - e) * (b.x - e) < 0) {
          final t = (e - a.x) / (b.x - a.x);
          pts.add(P2(a.z + t * (b.z - a.z), a.y + t * (b.y - a.y)));
        }
      }
    }
  }
  return hull2(pts);
}

/// 받침 외곽에 닿은 젖힌 책의 힘 평형: reason 'tip'이면 다시 서고, 'slip'이면 바닥이 앞으로 미끄러진다
({LeanStatics statics, Contact contact}) frontLean(Dims dims, FrontState s, List<P2> hull) {
  final l = frontLeaner2(dims, s);
  final contact = contact2(l.pivot, l.top, l.dir, hull);
  return (statics: statics2(l.pivot, l.g, l.m, contact), contact: contact);
}

/// 바닥 축 고정으로 s.pitch → target 넘어질 때 처음 닿는 외곽(1° 걸음 + 이분). 닿기 직전 각과 외곽 번호, 없으면 null
({double pitch, int index})? frontFall2(Dims dims, FrontState s, double target, List<List<P2>> hulls, [double tol = 0.01]) {
  int hitAt(double pitch) {
    final poly = frontLeaner2(dims, (depth: s.depth, pitch: pitch, spin: s.spin)).poly;
    return hulls.indexWhere((h) => penetration2(poly, h) > tol);
  }

  final first = hitAt(s.pitch);
  if (first >= 0) return (pitch: s.pitch, index: first);
  final count = (target - s.pitch).abs().ceil();
  var prev = s.pitch;
  for (var i = 1; i <= count; i++) {
    final pitch = s.pitch + (target - s.pitch) * i / count;
    if (hitAt(pitch) >= 0) {
      var lo = prev, hi = pitch;
      for (var k = 0; k < 20; k++) {
        final mid = (lo + hi) / 2;
        if (hitAt(mid) >= 0) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      return (pitch: lo, index: hitAt(hi));
    }
    prev = pitch;
  }
  return null;
}
