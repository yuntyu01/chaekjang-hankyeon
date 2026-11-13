// 책이 창빛 원반을 가리는 몫을 면 좌표 그림(알파)으로 그려 둔다. 벽·판 윗면 셰이더가 빛 계산 안에서 읽는다.
// 지금 앱 ui/shelf/ShelfMotion planeShadows·useWallKey·useFloorKey를 옮긴 것.
// 구간(bands)마다 흐림이 다른 그림자를 겹쳐 그린다: 가리개에 가까운 쪽은 또렷하고 멀수록 번진다
library;

import 'dart:ui' as ui;

import '../domain/book3.dart';
import '../domain/cast_shadow.dart';
import '../domain/geometry.dart';
import '../domain/shelf_row.dart';

/// 면 하나의 창빛 그림자: 그림과 평면 점 P → 그림 칸 사상
class PlaneKey {
  const PlaneKey(this.image, this.kU, this.kV, this.kO);
  final ui.Image? image;
  final List<double> kU;
  final List<double> kV;
  final List<double> kO;

  static const none = PlaneKey(null, [0, 0, 0], [0, 0, 0], [-8, -8]);
}

List<ui.Offset> _poly(List<({double x, double y})> pts) => [for (final p in pts) ui.Offset(p.x, p.y)];

ui.Path _path(List<ui.Offset> pts) {
  final p = ui.Path()..moveTo(pts[0].dx, pts[0].dy);
  for (final q in pts.skip(1)) {
    p.lineTo(q.dx, q.dy);
  }
  return p..close();
}

/// 줄의 책들이 뒷벽에 드리우는 그림자. y1: 위 판 아랫면 높이, ceil: 위 판 아랫면(없으면 무한)
Future<PlaneKey> wallKey(List<Book3> books, double s, double y1, {double ceil = double.infinity}) async {
  final w = ((wallX1 - wallX0) * s).ceil();
  final h = ((y1 + shelfThick) * s).ceil();
  if (w <= 0 || h <= 0 || books.isEmpty) return PlaneKey.none;
  final rec = ui.PictureRecorder();
  final canvas = ui.Canvas(rec);
  for (final b in books) {
    for (var k = 0; k < shadowBands.length; k++) {
      final c = bookCast(b, s, k, true, ceil: ceil);
      if (c == null || c.w <= 0) continue;
      final hull = hullOf(c.pts, (p) => p.x, (p) => p.y);
      final parts = wallParts([for (final p in hull) (x: p.x, y: p.y)], shelfX0, shelfX1);
      if (parts.isEmpty) continue;
      final paint = ui.Paint()
        ..color = ui.Color.fromARGB((c.w * 255).round().clamp(0, 255), 0, 0, 0)
        ..maskFilter = ui.MaskFilter.blur(ui.BlurStyle.normal, c.sigma < 0.01 ? 0.01 : c.sigma);
      for (final q in parts) {
        canvas.drawPath(_path(_poly([for (final p in q) (x: (p.x - wallX0) * s, y: (y1 - p.y) * s)])), paint);
      }
    }
  }
  final img = await rec.endRecording().toImage(w, h);
  return PlaneKey(img, [s, 0, 0], [0, -s, 0], [-wallX0 * s, y1 * s]);
}

/// 줄의 책들이 판 윗면에 드리우는 그림자
Future<PlaneKey> floorKey(List<Book3> books, double s, {double ceil = double.infinity}) async {
  final w = ((shelfX1 - shelfX0) * s).ceil();
  final h = ((shelfDepth + shelfFront) * s).ceil();
  if (w <= 0 || h <= 0 || books.isEmpty) return PlaneKey.none;
  final rec = ui.PictureRecorder();
  final canvas = ui.Canvas(rec);
  for (final b in books) {
    for (var k = 0; k < shadowBands.length; k++) {
      final c = bookCast(b, s, k, false, ceil: ceil);
      if (c == null || c.w <= 0) continue;
      final pts = [for (final p in c.pts) (x: (p.x - shelfX0) * s, y: (p.z + shelfFront) * s)];
      final hull = hullOf(pts, (p) => p.x, (p) => p.y);
      if (hull.length < 3) continue;
      canvas.drawPath(
        _path(_poly(hull)),
        ui.Paint()
          ..color = ui.Color.fromARGB((c.w * 255).round().clamp(0, 255), 0, 0, 0)
          ..maskFilter = ui.MaskFilter.blur(ui.BlurStyle.normal, c.sigma < 0.01 ? 0.01 : c.sigma),
      );
    }
  }
  final img = await rec.endRecording().toImage(w, h);
  return PlaneKey(img, [s, 0, 0], [0, 0, s], [-shelfX0 * s, shelfFront * s]);
}

/// 줄 하나의 창빛 그림자 둘(뒷벽·판 윗면)
Future<({PlaneKey wall, PlaneKey floor})> rowKeys(RowCase row, double s) async {
  final ceil = row.space;
  return (
    wall: await wallKey(row.books, s, row.space + shelfThick, ceil: ceil),
    floor: await floorKey(row.books, s, ceil: ceil),
  );
}
