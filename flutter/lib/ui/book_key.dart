// 책 면이 받는 창빛 그림자(다른 책이 창빛 원반을 가리는 몫, 알파)를 면 좌표 그림으로: 받는 면(많아야 둘)을 가로로 나란히,
// 면 칸 안에서 (u, v)(DU, lightPanel 틀) × 배율 s. 조각마다 가리는 몫 w로 칠하고 반그림자만큼 흐린다.
// rects: 책 셰이더 kRect(면마다 칸 원점 x, y, 배율, 있음). 지금 앱 ui/SceneLight bookKeyImage를 옮긴 것
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import '../domain/book3.dart';
import '../domain/received3.dart';
import '../domain/vec3.dart';

class BookKey {
  const BookKey(this.image, this.rects);
  final ui.Image image;
  final List<double> rects;
}

Future<BookKey?> bookKeyImage(Book3 b, List<Face3> faces, double s) async {
  if (faces.isEmpty) return null;
  final x = rot(b.roll, b.yaw, const Vec3(1, 0, 0), b.spin, b.pitch);
  final y = rot(b.roll, b.yaw, const Vec3(0, 1, 0), b.spin, b.pitch);
  final z = rot(b.roll, b.yaw, const Vec3(0, 0, 1), b.spin, b.pitch);
  final cells = <({int f, int x, int w, int h})>[];
  var width = 0, height = 1;
  for (final fc in faces) {
    final pn = lightPanel(b.dims, fc.f);
    final w = (pn.w * s).ceil() + 2, h = (pn.h * s).ceil() + 2;
    cells.add((f: fc.f.index, x: width + 1, w: w, h: h));
    width += w;
    height = math.max(height, h);
  }
  final rec = ui.PictureRecorder();
  final canvas = ui.Canvas(rec);
  final rects = List<double>.filled(24, 0);
  for (var i = 0; i < faces.length; i++) {
    final fc = faces[i];
    final c = cells[i];
    final pn = lightPanel(b.dims, fc.f);
    var ul = pn.u.length, vl = pn.v.length;
    if (ul == 0) ul = 1;
    if (vl == 0) vl = 1;
    // 줄 공간 점 → 책 좌표 → 면 좌표(u, v) → 그림 px
    ui.Offset toPx(Vec3 q) {
      final d = q - b.t;
      final l = Vec3(d.dot(x), d.dot(y), d.dot(z));
      final o = l - pn.o;
      return ui.Offset(c.x + o.dot(pn.u) / ul * s, 1 + o.dot(pn.v) / vl * s);
    }

    canvas.save();
    canvas.clipRect(ui.Rect.fromLTWH(c.x - 1.0, 0, c.w.toDouble(), c.h.toDouble()));
    for (final band in fc.bands) {
      for (final layer in band) {
        if (layer.poly.length < 3 || layer.w <= 0) continue;
        final path = ui.Path()..addPolygon([for (final q in layer.poly) toPx(q)], true);
        canvas.drawPath(
          path,
          ui.Paint()
            ..isAntiAlias = true
            ..color = ui.Color.fromRGBO(0, 0, 0, math.min(1, layer.w))
            ..maskFilter = ui.MaskFilter.blur(ui.BlurStyle.normal, math.max(0.01, layer.sigma)),
        );
      }
    }
    canvas.restore();
    rects[c.f * 4] = c.x.toDouble();
    rects[c.f * 4 + 1] = 1;
    rects[c.f * 4 + 2] = s;
    rects[c.f * 4 + 3] = 1;
  }
  final image = await rec.endRecording().toImage(math.max(1, width), height);
  return BookKey(image, rects);
}
