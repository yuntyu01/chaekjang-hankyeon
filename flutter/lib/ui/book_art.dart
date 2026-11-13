// 책 그림: 장정 색 바탕에 책등·표지 제목을 그린다. 빛 두 겹(곱하기·닷지)이 이 위에 칠해진다.
// 지금 앱 ui/book3d/art.tsx가 하던 일 가운데 제목 조판만 먼저 옮긴 것(그림 표지·띠·갈피는 아직).
// 면마다 3D 사각형을 화면으로 투영해 그 안에 면 좌표로 그린다(원근까지 담은 3×3 행렬을 캔버스 변환으로)
library;

import 'dart:typed_data';
import 'dart:ui' as ui;

import '../domain/book3.dart';
import '../domain/shelf_geom.dart';
import '../domain/vec3.dart';
import 'scene.dart' show srgbOf;

/// 제목 글꼴(지금 앱과 같은 함렛 SemiBold)
const titleFamily = 'Hahmlet';

/// 2차원 3×3(행 우선) → 캔버스 4×4 변환(열 우선)
Float64List toM44(List<double> m) {
  final o = Float64List(16);
  o[0] = m[0];
  o[1] = m[3];
  o[3] = m[6];
  o[4] = m[1];
  o[5] = m[4];
  o[7] = m[7];
  o[10] = 1;
  o[12] = m[2];
  o[13] = m[5];
  o[15] = m[8];
  return o;
}

ui.Path _poly(List<ui.Offset> pts) {
  final p = ui.Path()..moveTo(pts[0].dx, pts[0].dy);
  for (final q in pts.skip(1)) {
    p.lineTo(q.dx, q.dy);
  }
  return p..close();
}

/// 책 한 권의 그림을 그린다: 보이는 면마다 장정 색을 칠하고 책등·표지에 제목을 쓴다
void drawBookArt(
  ui.Canvas canvas,
  Book3 b,
  C3 albedo,
  String title,
  ui.Color ink,
  ui.Offset Function(Vec3) project,
) {
  final fill = ui.Paint()..color = srgbOf(albedo);
  for (final f in [FaceId.spine, FaceId.cover, FaceId.head, FaceId.fore, FaceId.back, FaceId.tail]) {
    final pn = lightPanel(b.dims, f);
    Vec3 turn(Vec3 v) => rot(b.roll, b.yaw, v, b.spin, b.pitch);
    // 면이 보이는지: 바깥 법선이 눈 쪽인가(원근이라 면 가운데에서 본다)
    final n = turn(faceNormal(f));
    final o = toWorld(b, pn.o);
    final mid = o + turn(pn.u) * 0.5 + turn(pn.v) * 0.5;
    // 벽 쪽을 향한 면은 보이지 않는다(간단한 판정). mid는 면 가운데
    if (n.z > 0.2 || mid.z < -1e9) continue;
    final corners = [
      project(o),
      project(o + turn(pn.u)),
      project(o + turn(pn.u) + turn(pn.v)),
      project(o + turn(pn.v)),
    ];
    final face = ShelfFace(corners[0], corners[1] - corners[0], corners[3] - corners[0], corners);
    canvas.drawPath(_poly(corners), fill);
    if (f != FaceId.spine && f != FaceId.cover) continue;
    if (title.isEmpty) continue;

    final w = pn.w, h = pn.h;
    final m = faceTextureMatrix(face, w.round(), h.round(), 1, 0, 0);
    canvas.save();
    canvas.clipPath(_poly(corners));
    canvas.transform(toM44(m));
    if (f == FaceId.spine) {
      _spineTitle(canvas, title, w, h, ink);
    } else {
      _coverTitle(canvas, title, w, h, ink);
    }
    canvas.restore();
  }
}

/// 책등 제목: 한 글자씩 세로로(한글은 전각이라 폭이 같다)
void _spineTitle(ui.Canvas canvas, String title, double w, double h, ui.Color ink) {
  // 글자 크기: 책등 폭의 0.42, 8.5~11DU(지금 앱 title-layout spineTitleLayout과 같은 기준)
  var size = (w * 0.42 * 2).round() / 2;
  if (size < 8.5) size = 8.5;
  if (size > 11) size = 11;
  final chars = title.characters2;
  // 글자 사이는 1.16배. 넘치면 줄인다
  var pitch = size * 1.16;
  final top = 0.23 * h;
  final room = h * 0.93 - top;
  while (chars.length * pitch > room && size > 6) {
    size -= 0.5;
    pitch = size * 1.16;
  }
  var y = top;
  for (final ch in chars) {
    final p = _para(ch, size, ink, w);
    canvas.drawParagraph(p, ui.Offset((w - p.maxIntrinsicWidth) / 2, y));
    y += pitch;
    if (y > h) break;
  }
}

/// 표지 제목: 가운데 위쪽에 여러 줄
void _coverTitle(ui.Canvas canvas, String title, double w, double h, ui.Color ink) {
  final size = (w * 0.11).clamp(7.0, 16.0);
  final p = _para(title, size, ink, w * 0.76, center: true);
  canvas.drawParagraph(p, ui.Offset(w * 0.12, h * 0.16));
}

ui.Paragraph _para(String text, double size, ui.Color ink, double maxW, {bool center = false}) {
  final b = ui.ParagraphBuilder(ui.ParagraphStyle(
    fontFamily: titleFamily,
    fontSize: size,
    textAlign: center ? ui.TextAlign.center : ui.TextAlign.start,
    maxLines: 4,
  ))
    ..pushStyle(ui.TextStyle(color: ink, fontFamily: titleFamily, fontSize: size, height: 1.18))
    ..addText(text);
  final p = b.build()..layout(ui.ParagraphConstraints(width: maxW));
  return p;
}

/// 글자 하나씩(결합 문자는 한 덩이로)
extension on String {
  List<String> get characters2 {
    final out = <String>[];
    for (final r in runes) {
      out.add(String.fromCharCode(r));
    }
    return out;
  }
}
