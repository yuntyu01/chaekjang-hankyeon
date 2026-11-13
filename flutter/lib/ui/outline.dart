// 화면 다각형 다루기: 볼록 다각형 안쪽으로 줄이기, 꼭짓점 둥글리기, 둔한 어깨 펴기, 판 윤곽.
// 지금 앱 ui/book3d/face-geometry(insetConvex·roundedPolygon)와 ui/shelf/ShelfPlank(softShoulders·plankShape)를 옮긴 것
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import '../domain/cast_shadow.dart' show hullOf;
import '../domain/geometry.dart';
import '../domain/shelf_geom.dart';
import '../domain/vec3.dart';
import '../scene_config/skin.dart';

/// 볼록 다각형을 변마다 r만큼 안쪽으로 줄인다(변을 평행 이동한 반평면들로 자른다)
List<ui.Offset> insetConvex(List<ui.Offset> pts, double r) {
  final n = pts.length;
  var cx = 0.0, cy = 0.0;
  for (final p in pts) {
    cx += p.dx / n;
    cy += p.dy / n;
  }
  var poly = [...pts];
  for (var i = 0; i < n && poly.length >= 3; i++) {
    final a = pts[i];
    final b = pts[(i + 1) % n];
    final len = math.sqrt((b.dx - a.dx) * (b.dx - a.dx) + (b.dy - a.dy) * (b.dy - a.dy));
    if (len < 1e-6) continue;
    var nx = -(b.dy - a.dy) / len;
    var ny = (b.dx - a.dx) / len;
    if ((cx - a.dx) * nx + (cy - a.dy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    final out = <ui.Offset>[];
    for (var j = 0; j < poly.length; j++) {
      final p = poly[j];
      final q = poly[(j + 1) % poly.length];
      final dp = (p.dx - a.dx) * nx + (p.dy - a.dy) * ny - r;
      final dq = (q.dx - a.dx) * nx + (q.dy - a.dy) * ny - r;
      if (dp >= 0) out.add(p);
      if ((dp >= 0) != (dq >= 0)) {
        final t = dp / (dp - dq);
        out.add(ui.Offset(p.dx + (q.dx - p.dx) * t, p.dy + (q.dy - p.dy) * t));
      }
    }
    poly = out;
  }
  return poly;
}

/// 볼록 다각형의 꼭짓점을 반지름 radius로 둥글린다(안으로 줄인 다각형의 꼭짓점마다 원호, 18°마다 한 점).
/// 너무 작아 줄일 수 없으면 반지름을 반씩 줄여 세 번까지 해 보고, 그래도 안 되면 그대로 둔다
List<ui.Offset> roundedPolygon(List<ui.Offset> pts, double radius) {
  var r = radius;
  var core = <ui.Offset>[];
  for (var k = 0; k < 3; k++, r /= 2) {
    core = insetConvex(pts, r);
    if (core.length >= 3) break;
  }
  if (core.length < 3) return pts;
  final n = core.length;
  var cx = 0.0, cy = 0.0;
  for (final p in core) {
    cx += p.dx / n;
    cy += p.dy / n;
  }
  // 변의 바깥 법선
  ui.Offset normal(ui.Offset a, ui.Offset b) {
    var len = math.sqrt((b.dx - a.dx) * (b.dx - a.dx) + (b.dy - a.dy) * (b.dy - a.dy));
    if (len == 0) len = 1;
    var nx = (b.dy - a.dy) / len;
    var ny = -(b.dx - a.dx) / len;
    if ((a.dx - cx) * nx + (a.dy - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    return ui.Offset(nx, ny);
  }

  final out = <ui.Offset>[];
  for (var i = 0; i < n; i++) {
    final v = core[i];
    final n0 = normal(core[(i + n - 1) % n], v);
    final n1 = normal(v, core[(i + 1) % n]);
    final a0 = math.atan2(n0.dy, n0.dx);
    var da = math.atan2(n1.dy, n1.dx) - a0;
    while (da > math.pi) {
      da -= 2 * math.pi;
    }
    while (da < -math.pi) {
      da += 2 * math.pi;
    }
    final steps = math.max(1, (da.abs() / (math.pi / 10)).ceil());
    for (var j = 0; j <= steps; j++) {
      final a = a0 + da * j / steps;
      out.add(ui.Offset(v.dx + r * math.cos(a), v.dy + r * math.sin(a)));
    }
  }
  return out;
}

/// 둔각 꼭짓점(판 윗면 빗변과 앞면 세로 변이 만나는 어깨)은 둥글려도 곡선이 아주 짧아 뾰족해 보여,
/// 양쪽 변으로 d만큼 물러난 두 점으로 바꾼다(안쪽 각 110°보다 크고 양쪽 변이 충분히 길 때만)
List<ui.Offset> softShoulders(List<ui.Offset> pts, double d) {
  final out = <ui.Offset>[];
  final n = pts.length;
  for (var i = 0; i < n; i++) {
    final v = pts[i];
    final a = pts[(i + n - 1) % n];
    final b = pts[(i + 1) % n];
    final la = (a - v).distance;
    final lb = (b - v).distance;
    final cos = la > 0 && lb > 0 ? ((a.dx - v.dx) * (b.dx - v.dx) + (a.dy - v.dy) * (b.dy - v.dy)) / (la * lb) : 0.0;
    if (cos < -0.34 && la > 4 * d && lb > 4 * d) {
      out
        ..add(v + (a - v) * (d / la))
        ..add(v + (b - v) * (d / lb));
    } else {
      out.add(v);
    }
  }
  return out;
}

/// 판 끝 모서리 반지름(움푹 파인 책장은 2.6mm, 지금 앱 PLANK_END_R)
final plankEndR = frameOn ? mm(2.6) : mm(5);

/// 면 사이 이음새: 뒤에 그리는 면을 공유 변 너머로 이만큼(px) 덮어 투명 틈이 생기지 않게 한다
const seamPx = 0.6;

/// 판의 화면 모양(캔버스 px): 윗면·앞면 다각형과 두 면 껍질을 모서리 반지름으로 둥글린 윤곽.
/// 판 그리기와 아래 줄이 이 판 자리를 비우는 윤곽이 같은 모양을 쓴다(지금 앱 plankShape)
({List<ui.Offset> top, List<ui.Offset> front, List<ui.Offset> outline}) plankShape(ui.Offset Function(Vec3) toPx, double s) {
  final f = shelfFaces(toPx);
  final top = f.top.poly;
  // 앞면은 위 변(윗면과 공유)을 위로 조금 덮는다
  final front = [
    for (var k = 0; k < f.front.poly.length; k++) k <= 1 ? f.front.poly[k] + const ui.Offset(0, -seamPx) : f.front.poly[k],
  ];
  final hull = hullOf([...top, ...front], (p) => p.dx, (p) => p.dy);
  return (top: top, front: front, outline: roundedPolygon(softShoulders(hull, plankEndR * s), plankEndR * s));
}

/// 아래 줄이 비우는 판 자리: 아래 끝을 1px 올려 판의 마지막 화소 줄은 아래 줄이 덮는다(지금 앱 plankOutlinePath)
ui.Path plankOutlinePath(ui.Offset Function(Vec3) toPx, double s) {
  final o = plankShape(toPx, s).outline;
  var y1 = -double.infinity;
  for (final q in o) {
    if (q.dy > y1) y1 = q.dy;
  }
  return pathOf([for (final q in o) ui.Offset(q.dx, math.min(q.dy, y1 - 1))]);
}

ui.Path pathOf(List<ui.Offset> pts) {
  final p = ui.Path();
  if (pts.isEmpty) return p;
  p.moveTo(pts[0].dx, pts[0].dy);
  for (final q in pts.skip(1)) {
    p.lineTo(q.dx, q.dy);
  }
  return p..close();
}

/// 문자열 → 재질 무늬 자리(지금 앱 seedOf, FNV-1a)
List<double> seedOf(String key) {
  var h = 2166136261;
  for (final c in key.codeUnits) {
    h = ((h ^ c) * 16777619) & 0xFFFFFFFF;
  }
  return [(h % 1000) + 0.37, ((h >> 10) % 1000) + 0.71];
}
