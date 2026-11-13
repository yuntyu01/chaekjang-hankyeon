// 실제 그림자: 창빛 방향으로 3D 점을 받는 면(벽 z = shelfDepth, 판 윗면 y = 0, 판 앞면 z = −shelfFront)에 떨어뜨린다.
// app/src/domain/cast-shadow.ts를 옮긴 것. 광원은 면 밝기와 같은 방향이고, 면광원이라 가리는 물체에서 멀수록 번진다.
// 연속 흐림을 빛 길이 구간(bands)으로 나눠 구간마다 가운데 거리로 번지게 그린다
library;

import 'dart:math' as math;

import '../scene_config/lighting.dart';
import 'book3.dart';
import 'geometry.dart';
import 'vec3.dart';

/// 빛이 나아가는 방향(광원 → 물체), 길이 1
Vec3 travelOf(Vec3 dir) => -dir.unit;

final bookLight = travelOf(light.dir);

/// 반그림자 폭 = spread × 빛 길이
final shadowSpread = 2 * math.tan(light.radius);

/// 빛 길이 구간: 반그림자가 1DU가 되는 거리에서 2배씩, 마지막은 끝없이
final shadowBands = <double>[for (final k in [1, 2, 4, 8, 16, 32]) k / shadowSpread, double.infinity];

/// 빛줄기가 1DU 깊어지는 동안 내려가는 높이
final ceilK = -bookLight.y / bookLight.z;

/// 빛줄기가 1DU 내려가는 동안 가로로 가는 거리(빛이 왼쪽에서 와서 오른쪽으로 간다)
final dropK = bookLight.x / -bookLight.y;

/// 벽 평면(z = wall)으로. 빛이 벽 쪽으로 가야 한다
Vec3 onWall(Vec3 p, Vec3 d, double wall) {
  final t = math.max(0.0, (wall - p.z) / d.z);
  return Vec3(p.x + d.x * t, p.y + d.y * t, wall);
}

/// 수평면(y = y0)으로. 빛이 아래로 가야 한다
Vec3 onFloor(Vec3 p, Vec3 d, double y0) {
  final t = math.max(0.0, (y0 - p.y) / d.y);
  return Vec3(p.x + d.x * t, y0, p.z + d.z * t);
}

/// 판 앞 끝을 지나는 빛줄기가 이 점 높이에서 들어오는 높이(위 판에 막히는지 보는 값)
double entryY(Vec3 c) => c.y + ceilK * math.min(0.0, c.z + shelfFront);

/// 볼록 다면체 꼭짓점에서 f가 (lo, hi]인 부분의 꼭짓점 + 변이 경계를 지나는 점
List<Vec3> _bandPart(List<Vec3> cs, List<double> f, double lo, double hi, bool box) {
  final out = <Vec3>[];
  for (var i = 0; i < cs.length; i++) {
    if (f[i] >= lo && f[i] <= hi) out.add(cs[i]);
  }
  void cut(int i, int j) {
    for (final l in [lo, hi]) {
      if ((f[i] - l) * (f[j] - l) >= 0) continue;
      final t = (l - f[i]) / (f[j] - f[i]);
      out.add(Vec3(
        cs[i].x + (cs[j].x - cs[i].x) * t,
        cs[i].y + (cs[j].y - cs[i].y) * t,
        cs[i].z + (cs[j].z - cs[i].z) * t,
      ));
    }
  }

  if (box && cs.length == 8) {
    for (final e in _boxEdges) {
      cut(e[0], e[1]);
    }
  } else {
    for (var i = 0; i < cs.length; i++) {
      for (var j = i + 1; j < cs.length; j++) {
        cut(i, j);
      }
    }
  }
  return out;
}

const _boxEdges = [
  [0, 1], [2, 3], [4, 5], [6, 7], //
  [0, 2], [1, 3], [4, 6], [5, 7], //
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/// 볼록 다면체 꼭짓점에서 한쪽만 남긴다(경계를 지나는 점 포함)
List<Vec3> _clipPts(List<Vec3> cs, double Function(Vec3) f, double lim, bool keepBelow) {
  final v = [for (final c in cs) keepBelow ? lim - f(c) : f(c) - lim];
  final out = <Vec3>[];
  for (var i = 0; i < cs.length; i++) {
    if (v[i] >= 0) out.add(cs[i]);
  }
  for (var i = 0; i < cs.length; i++) {
    for (var j = i + 1; j < cs.length; j++) {
      if (v[i] * v[j] >= 0) continue;
      final t = v[i] / (v[i] - v[j]);
      out.add(Vec3(
        cs[i].x + (cs[j].x - cs[i].x) * t,
        cs[i].y + (cs[j].y - cs[i].y) * t,
        cs[i].z + (cs[j].z - cs[i].z) * t,
      ));
    }
  }
  return out;
}

/// 반그림자 폭 w(DU) → 가우스 흐림 시그마
double penumbraSigma(double w) => w / math.sqrt(2 * math.pi);

final _seenU = () {
  final d = bookLight;
  final l = math.sqrt(d.z * d.z + d.x * d.x);
  return l > 0 ? Vec3(d.z / l, 0, -d.x / l) : const Vec3(1, 0, 0);
}();
final _seenV = () {
  final d = bookLight;
  final u = _seenU;
  return d.cross(u).unit;
}();

/// 빛에서 본 가리개의 두 폭(좁은 쪽, 넓은 쪽)
({double a, double b}) seenSize(List<Vec3> cs) {
  var u0 = double.infinity, u1 = -double.infinity, v0 = double.infinity, v1 = -double.infinity;
  for (final c in cs) {
    final u = c.dot(_seenU);
    final v = c.dot(_seenV);
    u0 = math.min(u0, u);
    u1 = math.max(u1, u);
    v0 = math.min(v0, v);
    v1 = math.max(v1, v);
  }
  final a = u1 - u0, b = v1 - v0;
  return a < b ? (a: a, b: b) : (a: b, b: a);
}

/// 광원 원반 중 가리개가 가리는 몫(가리개가 반그림자보다 좁으면 1보다 작다)
double thinOccluder(({double a, double b}) seen, double pen) {
  final w = math.max(1e-3, pen);
  return math.min(1.0, seen.a / w) * math.min(1.0, seen.b / w);
}

/// 받는 면 위 그림자: pts(면 위 점), sigma(흐림, 캔버스 px), w(가리는 몫)
class BookCast {
  const BookCast(this.pts, this.sigma, this.w);
  final List<Vec3> pts;
  final double sigma;
  final double w;
}

/// k번째 구간의 책 그림자. wall이면 뒷벽, 아니면 판 윗면.
/// ceil: 위 판 아랫면 높이(위에 줄이 없으면 무한). s: 캔버스 배율
BookCast? bookCast(Book3 b, double s, int k, bool wall, {double ceil = double.infinity}) {
  final lo = k == 0 ? 0.0 : shadowBands[k - 1];
  final hi = shadowBands[k];
  final d = bookLight;
  final full = corners(b);
  var cs = full;
  var box = true;
  var y0 = double.infinity, y1 = -double.infinity;
  for (final c in cs) {
    y0 = math.min(y0, c.y);
    y1 = math.max(y1, c.y);
  }
  if (!wall && y0 < -0.05) {
    cs = _clipPts(cs, (c) => c.y, 0, false);
    box = false;
  }
  if (ceil < double.infinity && y1 > ceil) {
    cs = _clipPts(cs, entryY, ceil, true);
    box = false;
  }
  if (cs.length < 3) return null;
  final f = [for (final c in cs) wall ? math.max(0.0, (shelfDepth - c.z) / d.z) : math.max(0.0, c.y / -d.y)];
  var f0 = double.infinity, f1 = -double.infinity;
  for (final v in f) {
    f0 = math.min(f0, v);
    f1 = math.max(f1, v);
  }
  if (f1 <= lo || f0 > hi) return null;
  final part = _bandPart(cs, f, lo, hi, box);
  if (part.length < 3) return null;
  final pts = [for (final c in part) wall ? onWall(c, d, shelfDepth) : onFloor(c, d, 0)];
  final pen = shadowSpread * ((math.max(lo, f0) + math.min(hi, f1)) / 2);
  return BookCast(pts, penumbraSigma(pen) * s, thinOccluder(seenSize(full), shadowSpread * math.max(lo, f0)));
}

/// 벽 위 그림자를 판에 가려지지 않고 벽에 닿는 부분으로 나눈다(판 윗면 위, 그리고 판 끝 너머 옆 벽)
List<List<({double x, double y})>> wallParts(List<({double x, double y})> poly, double x0, double x1) {
  List<({double x, double y})> clip(List<({double x, double y})> p, double Function(({double x, double y})) f) {
    final out = <({double x, double y})>[];
    for (var i = 0; i < p.length; i++) {
      final a = p[i];
      final b = p[(i + 1) % p.length];
      final fa = f(a), fb = f(b);
      if (fa >= 0) out.add(a);
      if ((fa >= 0) != (fb >= 0)) {
        final t = fa / (fa - fb);
        out.add((x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t));
      }
    }
    return out;
  }

  final top = clip(poly, (q) => q.y);
  final below = clip(poly, (q) => -q.y);
  final right = below.length >= 3 ? clip(below, (q) => q.x - x1 - dropK * -q.y) : <({double x, double y})>[];
  final left = below.length >= 3 ? clip(below, (q) => x0 - q.x) : <({double x, double y})>[];
  return [top, right, left].where((q) => q.length >= 3).toList();
}

/// 점들의 볼록 외곽(Andrew monotone chain)
List<T> hullOf<T>(List<T> pts, double Function(T) gx, double Function(T) gy) {
  if (pts.length < 3) return pts;
  final p = [...pts]..sort((a, b) => gx(a) == gx(b) ? gy(a).compareTo(gy(b)) : gx(a).compareTo(gx(b)));
  double cross(T o, T a, T b) => (gx(a) - gx(o)) * (gy(b) - gy(o)) - (gy(a) - gy(o)) * (gx(b) - gx(o));
  final out = <T>[];
  for (final q in p) {
    while (out.length >= 2 && cross(out[out.length - 2], out.last, q) <= 0) {
      out.removeLast();
    }
    out.add(q);
  }
  final lower = out.length + 1;
  for (var i = p.length - 2; i >= 0; i--) {
    while (out.length >= lower && cross(out[out.length - 2], out.last, p[i]) <= 0) {
      out.removeLast();
    }
    out.add(p[i]);
  }
  out.removeLast();
  return out;
}
