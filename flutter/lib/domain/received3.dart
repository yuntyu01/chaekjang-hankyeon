// 책 면이 받는 창빛 그림자의 3D 단계(순수, 카메라와 무관): 같은 줄의 다른 책을 빛 길이 구간으로 잘라 받는 면에 떨어뜨리고
// 구간 가운데 거리의 반그림자로 번지게 한다. 지금 앱 domain/received3.ts와 cast-shadow shadowOnPlane·underCeil을 옮긴 것.
// 결과(가려지는 몫)는 면 좌표 그림으로 그려 책 빛 셰이더가 빛 계산 안에서 쓴다(ui/book_key.dart)
library;

import 'dart:math' as math;

import 'book3.dart';
import 'cast_shadow.dart';
import 'geometry.dart';
import 'vec3.dart';

const _boxEdges = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7], //
];

/// 가리개 상자 꼭짓점을 빛을 따라 평면(p0, n)에 떨어뜨린다(빛 길이 tMin < t ≤ tMax 부분만). 지금 앱 shadowOnPlane(gradient 없이)
({List<Vec3> pts, double dist, double tFar}) shadowOnPlane(List<Vec3> occ, Vec3 p0, Vec3 n, Vec3 light, [double tMax = double.infinity, double tMin = 0]) {
  final nd = n.dot(light);
  if (nd > -1e-4) return (pts: const [], dist: 0, tFar: 0);
  final lo = math.max(0.05, tMin * -nd);
  final hi = tMax * -nd;
  final h = [for (final c in occ) n.dot(c - p0)];
  final out = <Vec3>[];
  var dist = double.infinity, tFar = double.negativeInfinity;
  void put(Vec3 c, double hc) {
    final t = hc / -nd;
    if (t < dist) dist = t;
    if (t > tFar) tFar = t;
    out.add(c + light * t);
  }

  for (var i = 0; i < 8; i++) {
    if (h[i] > lo && h[i] <= hi) put(occ[i], h[i]);
  }
  for (final e in _boxEdges) {
    final i = e[0], j = e[1];
    for (final lim in [lo, hi]) {
      if (!lim.isFinite || (h[i] - lim) * (h[j] - lim) >= 0) continue;
      final u = (lim - h[i]) / (h[j] - h[i]);
      put(occ[i] + (occ[j] - occ[i]) * u, lim);
    }
  }
  if (out.length < 3) return (pts: const [], dist: 0, tFar: 0);
  return (pts: out, dist: dist, tFar: tFar);
}

/// 위 판 아랫면(ceil)보다 위로 빛줄기가 들어오는 부분(위 판이 막는 부분)을 뺀 상자. 다 막히면 null
Book3? underCeil(Book3 b, double ceil) {
  if (!(ceil < double.infinity)) return b;
  final cs = corners(b);
  final g = [for (final c in cs) entryY(c)];
  final lo = g.reduce(math.min), hi = g.reduce(math.max);
  if (hi <= ceil) return b;
  if (lo >= ceil) return null;
  const bits = [1, 2, 4];
  var axis = 0;
  var best = -1.0;
  for (var a = 0; a < 3; a++) {
    var sum = 0.0;
    for (var i = 0; i < 8; i++) {
      if (i & bits[a] == 0) sum += (g[i | bits[a]] - g[i]).abs();
    }
    if (sum > best) {
      best = sum;
      axis = a;
    }
  }
  var u0 = 0.0, u1 = 1.0;
  for (var i = 0; i < 8; i++) {
    if (i & bits[axis] != 0) continue;
    final g0 = g[i], g1 = g[i | bits[axis]];
    if (g1 > g0) {
      if (g1 > ceil) u1 = math.min(u1, math.max(0, (ceil - g0) / (g1 - g0)));
    } else if (g0 > ceil) {
      u0 = math.max(u0, g0 == g1 ? 1 : math.min(1, (g0 - ceil) / (g0 - g1)));
    }
  }
  if (u1 - u0 <= 1e-3) return null;
  final d = b.dims;
  final l = axis == 0 ? d.t : axis == 1 ? d.h : d.w;
  final off = Vec3(axis == 0 ? u0 * l : 0, axis == 1 ? u0 * l : 0, axis == 2 ? u0 * l : 0);
  final n = (u1 - u0) * l;
  return Book3(
    id: b.id,
    dims: Dims(axis == 0 ? n : d.t, axis == 1 ? n : d.h, axis == 2 ? n : d.w),
    t: rot(b.roll, b.yaw, off, b.spin, b.pitch) + b.t,
    roll: b.roll,
    yaw: b.yaw,
    spin: b.spin,
    pitch: b.pitch,
  );
}

/// 이 책에 그림자를 드리울 수 있는 이웃의 가로 범위(한 줄 안 가장 긴 빛 길이만큼 빛이 옆으로 비켜 가는 거리)
final _drift = bookLight.x.abs() / bookLight.z * (shelfFront + shelfDepth);
final reachL = bookLight.x > 0 ? _drift : 0.0;
final reachR = bookLight.x < 0 ? _drift : 0.0;

({double lo, double hi}) _xRange(Book3 b) {
  final xs = corners(b).map((c) => c.x);
  return (lo: xs.reduce(math.min), hi: xs.reduce(math.max));
}

/// 자세 b의 책에 그림자를 드리울 수 있는 같은 줄 책들(위 판이 막는 부분은 뺀 상자로)
List<Book3> occludersIn(List<Book3> row, Book3 b, [double ceil = double.infinity]) {
  final me = _xRange(b);
  return [
    for (final o in row)
      if (o.id != b.id)
        if (underCeil(o, ceil) case final ob?)
          if (!(_xRange(ob).hi < me.lo - reachL || _xRange(ob).lo > me.hi + reachR)) ob,
  ];
}

class Layer3 {
  const Layer3(this.poly, this.sigma, this.w);
  final List<Vec3> poly;
  final double sigma;
  final double w;
}

class Face3 {
  const Face3(this.f, this.fc, this.bands);
  final FaceId f;
  final List<Vec3> fc;
  final List<List<Layer3>> bands;
}

/// 받는 그림자(면마다 빛 길이 구간마다 가리개 조각). s: 캔버스 배율(흐림 px)
List<Face3> receivedShadow3(Book3 b, List<Book3> occBodies, double s) {
  final lightV = bookLight;
  final ln = -lightV;
  final occs = [
    for (final ob in occBodies)
      () {
        final cs = corners(ob);
        return (cs: cs, seen: seenSize(cs));
      }(),
  ];
  final cs = corners(b);
  final bands = shadowBands;
  final faces = <Face3>[];
  for (final f in FaceId.values) {
    final n = rot(b.roll, b.yaw, faceNormal(f), b.spin, b.pitch);
    if (n.y < -0.5) continue;
    if (n.dot(ln) <= 0) continue;
    final fc = [for (final i in faceCorners(f)) cs[i]];
    final e1 = fc[1] - fc[0], e2 = fc[3] - fc[0];
    final l1 = e1.dot(e1) == 0 ? 1.0 : e1.dot(e1), l2 = e2.dot(e2) == 0 ? 1.0 : e2.dot(e2);
    bool touches(List<Vec3> pts) {
      var u0 = double.infinity, u1 = double.negativeInfinity, v0 = double.infinity, v1 = double.negativeInfinity;
      for (final q in pts) {
        final d = q - fc[0];
        final u = d.dot(e1) / l1, v = d.dot(e2) / l2;
        u0 = math.min(u0, u);
        u1 = math.max(u1, u);
        v0 = math.min(v0, v);
        v1 = math.max(v1, v);
      }
      return u1 > 0 && u0 < 1 && v1 > 0 && v0 < 1;
    }

    final layers = [for (var k = 0; k < bands.length; k++) <Layer3>[]];
    var any = false;
    for (final occ in occs) {
      final all = shadowOnPlane(occ.cs, fc[0], n, lightV);
      if (all.pts.length < 3 || !touches(all.pts)) continue;
      for (var k = 0; k < bands.length; k++) {
        final lo = k == 0 ? 0.0 : bands[k - 1];
        final hi = bands[k];
        if (all.dist >= hi || all.tFar <= lo) continue;
        final part = shadowOnPlane(occ.cs, fc[0], n, lightV, hi, lo);
        if (part.pts.length < 3) continue;
        final poly = hullOf(
          [for (final p in part.pts) (x: (p - fc[0]).dot(e1) / l1, y: (p - fc[0]).dot(e2) / l2, point: p)],
          (q) => q.x,
          (q) => q.y,
        ).map((q) => q.point).toList();
        if (poly.length < 3) continue;
        final pen = shadowSpread * ((part.dist + part.tFar) / 2);
        layers[k].add(Layer3(poly, penumbraSigma(pen) * s, thinOccluder(occ.seen, shadowSpread * math.max(lo, part.dist))));
        any = true;
      }
    }
    if (any) faces.add(Face3(f, fc, layers));
  }
  return faces;
}
