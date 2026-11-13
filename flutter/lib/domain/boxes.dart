// 책을 빛 계산용 상자로 바꾸고 셰이더가 읽을 숫자 묶음으로 담는다.
// app/src/domain/light-model.ts의 Box·boxOf·withCovers·packBoxes를 옮긴 것(식 그대로).
library;

import 'dart:math' as math;

import 'book3.dart';
import 'vec3.dart';

/// 덮개: 이 상자의 축 k · 쪽 s 면을 마주 보는 가장 가까운 이웃 면(간격 g, 덮인 범위 u0~u1 · v0~v1)
class Cover {
  const Cover(this.k, this.s, this.g, this.u0, this.u1, this.v0, this.v1);
  final int k;
  final int s;
  final double g;
  final double u0;
  final double u1;
  final double v0;
  final double v1;
}

/// 빛 계산용 상자: 가운데 c, 축 셋과 반 길이, 장정 반사율 tone, 머리·책배의 속지 비, 덮개
class Box {
  Box({
    required this.c,
    required this.ax,
    required this.ay,
    required this.az,
    required this.hx,
    required this.hy,
    required this.hz,
    required this.tone,
    required this.head,
    required this.fore,
    this.covers = const [],
  });

  final Vec3 c;
  final Vec3 ax;
  final Vec3 ay;
  final Vec3 az;
  final double hx;
  final double hy;
  final double hz;
  final C3 tone;
  final double head;
  final double fore;
  List<Cover> covers;

  Vec3 axis(int k) => k == 0 ? ax : (k == 1 ? ay : az);
  double half(int k) => k == 0 ? hx : (k == 1 ? hy : hz);
}

/// tone: 장정 재질 반사율. 속지 면은 판 끝 테두리(두께 bd, 책등 띠 sp)를 뺀 넓이만큼 종이다
Box boxOf(Book3 b, C3 tone) {
  final cs = corners(b);
  final d = b.dims;
  final rig = rigOf(d);
  final pages = math.max(0.0, d.t - 2 * rig.bd) / d.t;
  final head = pages * (math.max(0.0, d.w - rig.sp) / d.w);
  Vec3 axis(Vec3 q, double l) => Vec3((q.x - cs[0].x) / l, (q.y - cs[0].y) / l, (q.z - cs[0].z) / l);
  return Box(
    c: Vec3((cs[0].x + cs[7].x) / 2, (cs[0].y + cs[7].y) / 2, (cs[0].z + cs[7].z) / 2),
    ax: axis(cs[1], d.t),
    ay: axis(cs[2], d.h),
    az: axis(cs[4], d.w),
    hx: d.t / 2,
    hy: d.h / 2,
    hz: d.w / 2,
    tone: tone,
    head: head,
    fore: pages,
  );
}

const coverMax = 2;
const _parallel = 1 - 1e-6;

/// 상자마다 덮개(평행하게 마주 보는 가장 가까운 이웃 면). 덮인 넓이가 큰 순으로 coverMax개
List<Box> withCovers(List<Box> list) {
  for (var i = 0; i < list.length; i++) {
    final bi = list[i];
    final found = <({Cover c, double area})>[];
    for (var k = 0; k < 3; k++) {
      final ak = bi.axis(k);
      final ku = (k + 1) % 3;
      final kv = (k + 2) % 3;
      final au = bi.axis(ku);
      final av = bi.axis(kv);
      for (final s in [-1, 1]) {
        ({Cover c, double area})? best;
        for (var j = 0; j < list.length; j++) {
          if (j == i) continue;
          final bj = list[j];
          // 이웃 상자의 축이 이 상자 축과 모두 평행해야 한다(면끼리 평행)
          var kj = -1;
          var hu = 0.0;
          var hv = 0.0;
          for (var q = 0; q < 3; q++) {
            final aq = bj.axis(q);
            if (aq.dot(ak).abs() > _parallel) {
              kj = q;
            } else if (aq.dot(au).abs() > _parallel) {
              hu = bj.half(q);
            } else if (aq.dot(av).abs() > _parallel) {
              hv = bj.half(q);
            }
          }
          if (kj < 0 || hu == 0 || hv == 0) continue;
          final dc = bj.c - bi.c;
          // 이 면에서 바깥(s·ak)으로 이웃 상자의 가까운 면까지
          final g = s * dc.dot(ak) - bi.half(k) - bj.half(kj);
          if (g < -1e-3) continue;
          final du = dc.dot(au);
          final dv = dc.dot(av);
          final u0 = math.max(-bi.half(ku), du - hu);
          final u1 = math.min(bi.half(ku), du + hu);
          final v0 = math.max(-bi.half(kv), dv - hv);
          final v1 = math.min(bi.half(kv), dv + hv);
          if (u1 <= u0 || v1 <= v0) continue;
          final area = (u1 - u0) * (v1 - v0);
          if (best == null || g < best.c.g - 1e-6 || ((g - best.c.g).abs() <= 1e-6 && area > best.area)) {
            best = (c: Cover(k, s, math.max(0, g), u0, u1, v0, v1), area: area);
          }
        }
        if (best != null) found.add(best);
      }
    }
    found.sort((a, b) => b.area.compareTo(a.area));
    bi.covers = found.take(coverMax).map((e) => e.c).toList();
  }
  return list;
}

/// 셰이더 유니폼 벡터 수(GLES 3.0 최소 224) 안에 들도록 줄당 이만큼
const boxMax = 20;
const boxVec = 8;

/// 상자 목록과 셰이더가 읽을 숫자 묶음(상자마다 vec4 여덟)
class BoxBuf {
  BoxBuf(this.list, this.ids, this.v);
  final List<Box> list;
  final List<String> ids;
  final List<double> v;
}

/// 상자마다 vec4 여덟: (c, 장정 R) · (축 x, 반 길이) · (축 y, …) · (축 z, …) ·
/// (덮개 k0+3·(s>0), g0, k1, g1) · (u0,u1,v0,v1)₀ · (…)₁ · (장정 G, 장정 B, 머리 속지 비, 책배 속지 비)
BoxBuf packBoxes(List<Box> list, List<String> ids) {
  final v = List<double>.filled(boxMax * boxVec * 4, 0);
  final n = math.min(boxMax, list.length);
  for (var i = 0; i < n; i++) {
    final b = list[i];
    final o = i * boxVec * 4;
    v[o] = b.c.x;
    v[o + 1] = b.c.y;
    v[o + 2] = b.c.z;
    v[o + 3] = b.tone.r;
    v[o + 4] = b.ax.x;
    v[o + 5] = b.ax.y;
    v[o + 6] = b.ax.z;
    v[o + 7] = b.hx;
    v[o + 8] = b.ay.x;
    v[o + 9] = b.ay.y;
    v[o + 10] = b.ay.z;
    v[o + 11] = b.hy;
    v[o + 12] = b.az.x;
    v[o + 13] = b.az.y;
    v[o + 14] = b.az.z;
    v[o + 15] = b.hz;
    // 덮개 없음 = 면 번호 −1
    v[o + 16] = -1;
    v[o + 18] = -1;
    for (var j = 0; j < b.covers.length && j < coverMax; j++) {
      final c = b.covers[j];
      v[o + 16 + j * 2] = (c.k + (c.s > 0 ? 3 : 0)).toDouble();
      v[o + 17 + j * 2] = c.g;
      final r = o + 20 + j * 4;
      v[r] = c.u0;
      v[r + 1] = c.u1;
      v[r + 2] = c.v0;
      v[r + 3] = c.v1;
    }
    v[o + 28] = b.tone.g;
    v[o + 29] = b.tone.b;
    v[o + 30] = b.head;
    v[o + 31] = b.fore;
  }
  return BoxBuf(list.take(n).toList(), ids.take(n).toList(), v);
}

final noBoxes = packBoxes([], []);
