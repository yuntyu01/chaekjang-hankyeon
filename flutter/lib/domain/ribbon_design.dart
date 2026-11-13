// 갈피(종이 탭): 갈피가 하나면 한 장, 둘 이상이면 두 장이 머리 위로 나란히 나온다. 지금 앱 domain/ribbon-design.ts와 art.tsx tabsOf를 옮긴 것
library;

import 'dart:math' as math;

import 'book3.dart';
import 'color.dart';
import 'vec3.dart';

/// 갈피가 머리에서 나오는 자리(책 좌표): 두께 0.55T, 책등에서 깊이 0.3W 뒤
const ribbonZ = 0.3;
const _gap = 1.2;

/// 뿌리가 머리 면 속지 사이로 묻히는 길이, 장마다 기우는 최대 각
const tabHidden = 1.2;
const tabTiltMax = 4.0;

class Tab {
  const Tab(this.x, this.width, this.out, this.color, this.seed, this.tilt);
  final double x;
  final double width;
  final double out;
  final String color;
  final int seed;
  final double tilt;
}

int _seedOf(String id) {
  var h = 0;
  for (final c in id.codeUnits) {
    h = (h * 31 + c) & 0xFFFFFFFF;
  }
  return h;
}

/// 0~1 난수(지금 앱 rng: 선형 합동)
double Function() _rng(int seed) {
  var k = seed & 0xFFFFFFFF;
  return () {
    k = (k * 1664525 + 1013904223) & 0xFFFFFFFF;
    return k / 4294967296;
  };
}

/// 갈피 장 모양(장마다 폭·나온 길이, 두 장이면 책마다 길쭉한 장이 왼쪽·오른쪽)
List<({double x, double width, double out})> ribbonDesign(String id, int count) {
  if (count < 2) return const [(x: 0, width: 9.2, out: 14)];
  final h = _seedOf(id);
  const a = (width: 8.4, out: 15.0), b = (width: 7.2, out: 11.5);
  final (l, r) = h % 2 == 1 ? (a, b) : (b, a);
  final total = l.width + _gap + r.width;
  return [
    (x: -total / 2 + l.width / 2, width: l.width, out: l.out),
    (x: total / 2 - r.width / 2, width: r.width, out: r.out),
  ];
}

/// 책 한 권의 갈피 탭들: 색은 갈피 색(없으면 무채색이 아닌 책 재질 색), 장마다 조금씩 기운다
List<Tab> tabsOf(String id, int count, String? ribbon, String tone) {
  final design = ribbonDesign(id, count);
  final (c1, c2) = tabColors(ribbon ?? (isNeutralColor(tone) ? null : tone), id);
  final tall = design.map((t) => t.out).reduce((a, b) => a > b ? a : b);
  final seed = _seedOf(id);
  return [
    for (var i = 0; i < design.length; i++)
      () {
        final t = design[i];
        final sd = (seed + i * 7919) & 0xFFFFFFFF;
        return Tab(t.x, t.width, t.out, t.out == tall ? c1 : c2, sd, (_rng(sd ^ 0x9e3779b9)() - 0.5) * 2 * tabTiltMax);
      }(),
  ];
}

/// 갈피의 축: 가로(ax)·머리 방향(up)·보는 쪽 법선(n). 책을 돌린 만큼 같이 돌되 40°까지, 눕힌 책은 돌리지 않는다(지금 앱 tabAxes)
({Vec3 ax, Vec3 up, Vec3 n}) tabAxes(Book3 b) {
  final up = rot(b.roll, b.yaw, const Vec3(0, 1, 0), b.spin, b.pitch);
  var len = math.sqrt(up.x * up.x + up.y * up.y);
  if (len == 0) len = 1;
  final x0 = Vec3(up.y / len, -up.x / len, 0);
  final w0 = x0.cross(up);
  final deg = up.y.abs() > 0.5 ? math.max(-_tabMaxSpin, math.min(_tabMaxSpin, b.spin)) : 0.0;
  final c = math.cos(deg * math.pi / 180), s = math.sin(deg * math.pi / 180);
  final ax = Vec3(x0.x * c + w0.x * s, x0.y * c + w0.y * s, x0.z * c + w0.z * s);
  return (ax: ax, up: up, n: up.cross(ax));
}

const _tabMaxSpin = 40.0;

/// 갈피 뿌리(줄 공간)와 탭 가운데(하늘 가림을 재는 한 점)
({Vec3 root, Vec3 center}) tabRoot(Book3 b, double out) {
  final d = b.dims;
  final root = toWorld(b, Vec3(d.t * 0.55, d.h, d.w * ribbonZ));
  final up = rot(b.roll, b.yaw, const Vec3(0, 1, 0), b.spin, b.pitch);
  return (root: root, center: root + up * (out / 2));
}
