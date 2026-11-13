// 책 그림(재질 바탕): 책 윤곽을 재질 색으로 칠하고, 속지 면(머리·꼬리·책배)은 종이 색 구멍, 책등·앞표지에 제목을 쓴다.
// 빛 두 겹(곱하기·닷지)이 이 위에 칠해진다. 지금 앱 ui/book3d(BookNode·BookFaces·art.tsx)의 벡터 장정(표지 사진이 없는 책)을 옮긴 것.
// 면마다 3D 사각형을 화면으로 투영해 그 안에 면 그림 좌표(DU)로 그린다(원근까지 담은 3×3 행렬을 캔버스 변환으로).
library;

import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import '../domain/book3.dart';
import '../domain/book_look.dart';
import '../domain/camera.dart';
import '../domain/geometry.dart';
import '../domain/shelf_geom.dart';
import '../domain/title_layout.dart';
import '../domain/vec3.dart';
import 'glyph_metrics.dart';
import 'outline.dart';

/// 제목 글꼴(지금 앱과 같은 함렛 SemiBold)
const titleFamily = 'Hahmlet';

/// 속지(종이 단면) 색(지금 앱 surfaces.paper)
const pageBase = 0xFFF1EEE6;

/// 책 판 모서리 반지름(지금 앱 EDGE_R)
final edgeR = mm(4);

/// 세운 책등 제목 크기를 정할 때 쓰는 폭(책등 폭의 94%)
const spineFace = 0.94;

/// 앞표지 제본 홈(지금 앱 GROOVE.at): 제목은 홈을 뺀 면의 가운데
const grooveAt = 6.5;

ui.Color _color(String hex) => ui.Color(0xFF000000 | int.parse(hex.substring(1), radix: 16));

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

/// 책 화면 윤곽: 여덟 꼭짓점 투영의 껍질을 판 모서리 반지름으로 둥글린다(지금 앱 silhouette)
List<ui.Offset> silhouette(ui.Offset Function(Vec3) project, Book3 b, double s) {
  final pts = [for (final v in corners(b)) project(v)];
  return roundedPolygon(_hull(pts), edgeR * s);
}

List<ui.Offset> _hull(List<ui.Offset> pts) {
  final p = [...pts]..sort((a, b) => a.dx == b.dx ? a.dy.compareTo(b.dy) : a.dx.compareTo(b.dx));
  double cross(ui.Offset o, ui.Offset a, ui.Offset b) => (a.dx - o.dx) * (b.dy - o.dy) - (a.dy - o.dy) * (b.dx - o.dx);
  final lower = <ui.Offset>[];
  for (final q in p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower.last, q) <= 0) {
      lower.removeLast();
    }
    lower.add(q);
  }
  final upper = <ui.Offset>[];
  for (final q in p.reversed) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper.last, q) <= 0) {
      upper.removeLast();
    }
    upper.add(q);
  }
  return [...lower.sublist(0, lower.length - 1), ...upper.sublist(0, upper.length - 1)];
}

/// 책 한 권의 바탕을 그린다(윤곽 안은 호출하는 쪽이 이미 잘라 둔다)
void drawBookArt(ui.Canvas canvas, Book3 b, BookLook look, GlyphMetrics glyphs, Eye eye, ui.Offset Function(Vec3) project,
    double s) {
  final tone = _color(look.tone);
  // 몸체: 윤곽 전체를 재질 색으로(판 두 장·책등·판 끝이 모두 같은 색)
  canvas.drawPath(pathOf(silhouette(project, b, s)), ui.Paint()..color = tone);
  Vec3 turn(Vec3 v) => rot(b.roll, b.yaw, v, b.spin, b.pitch);

  // 속지 면(머리·꼬리·책배): 판 끝(테) 안쪽 구멍은 종이 색, 보이는 안쪽 벽은 재질 색
  for (final f in const [FaceId.head, FaceId.tail, FaceId.fore]) {
    if (!faceVisible(eye, b, f)) continue;
    final pf = pageFace(b.dims, f);
    ui.Offset p(Vec3 v) => project(toWorld(b, v));
    final cap = roundedPolygon(_hull([for (final r in pf.rims) for (final v in r) p(v)]), edgeR * s);
    canvas.save();
    canvas.clipPath(pathOf(cap));
    canvas.drawPath(pathOf(_hull([for (final v in pf.opening) p(v)])), ui.Paint()..color = const ui.Color(pageBase));
    for (final w in pf.walls) {
      final n = turn(w.n);
      final at = toWorld(b, w.pts[0]);
      final k = viewAt(eye, at.x, at.y, at.z);
      final facing = (n.x * k.kx + n.y * k.ky - n.z) / math.sqrt(k.kx * k.kx + k.ky * k.ky + 1);
      if (facing > 0.002) canvas.drawPath(pathOf([for (final v in w.pts) p(v)]), ui.Paint()..color = tone);
    }
    canvas.restore();
  }

  // 책등·앞표지: 면 그림 좌표(DU)에 제목
  for (final f in const [FaceId.spine, FaceId.cover]) {
    if (!faceVisible(eye, b, f)) continue;
    final pn = facePanel(b.dims, f);
    final o = toWorld(b, pn.o);
    final corners = [project(o), project(o + turn(pn.u)), project(o + turn(pn.u) + turn(pn.v)), project(o + turn(pn.v))];
    final face = ShelfFace(corners[0], corners[1] - corners[0], corners[3] - corners[0], corners);
    final m = faceTextureMatrix(face, 1, 1, 1, 0, 0);
    canvas.save();
    canvas.clipPath(pathOf(corners));
    // 면 그림 좌표: (0, 0) = 그림 왼쪽 위, (w, h) = 오른쪽 아래(DU)
    canvas.transform(toM44(m));
    canvas.scale(1 / pn.w, 1 / pn.h);
    if (look.title.isNotEmpty) {
      if (f == FaceId.spine) {
        final op = titleOpacity(b.roll);
        if (op.v > 0.001) _verticalTitle(canvas, look, b.dims, glyphs, op.v);
        if (op.h > 0.001) _lyingTitle(canvas, look, b.dims, glyphs, op.h);
      } else {
        _coverTitle(canvas, look, b.dims, glyphs);
      }
    }
    canvas.restore();
  }
}

// ---------- 제목 ----------
/// 세운 책등 ↔ 눕힌 책등 조판을 바꾸는 눕힘 정도(|roll|, 도): 두 조판이 겹쳐 보이지 않게 차례로(지금 앱 TITLE_SWAP)
({double v, double h}) titleOpacity(double roll) {
  double smooth(double a, double b, double v) {
    final t = math.max(0.0, math.min(1.0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  final r = roll.abs();
  return (v: 1 - smooth(36, 45, r), h: smooth(45, 54, r));
}

/// 글자 하나를 원점 (x, y) = 기준선 위치에 그린다(Skia drawText와 같은 자리)
void _glyph(ui.Canvas canvas, String ch, double x, double baseline, double fs, ui.Color color) {
  final pb = ui.ParagraphBuilder(ui.ParagraphStyle(fontFamily: titleFamily, fontSize: fs, maxLines: 1))
    ..pushStyle(ui.TextStyle(color: color, fontFamily: titleFamily, fontSize: fs))
    ..addText(ch);
  final p = pb.build()..layout(const ui.ParagraphConstraints(width: double.infinity));
  canvas.drawParagraph(p, ui.Offset(x, baseline - p.alphabeticBaseline));
}

ui.Color _alpha(ui.Color c, double a) => c.withValues(alpha: a);

/// 세운 책등 제목(세로 조판): 글자를 바로 세워 열로 쌓는다. 글자마다 나아가기 폭의 가운데를 열 가운데에 둔다.
/// 쉼표·마침표는 앞 글자 오른쪽 아래(지금 앱 verticalTitlePicture)
void _verticalTitle(ui.Canvas canvas, BookLook look, Dims d, GlyphMetrics g, double opacity) {
  final w = d.t, h = d.h;
  final textEnd = look.titleTop != null ? 0.79 : 0.88;
  final t = spineTitleLayout(look.title, h, d.t * spineFace, textEnd, textEnd + 0.12);
  final fs = t.fontSize;
  final gy = -(g.ascent(fs) + g.descent(fs)) / 2;
  final colW = fs * 1.2;
  final cols = t.columns.reversed.toList();
  final x0 = w / 2 - cols.length * colW / 2;
  final ink = _alpha(_color(look.ink), opacity);
  final top = look.titleTop != null ? math.max(0.12, look.titleTop! - _titleLift) : t.textTop;
  for (var ci = 0; ci < cols.length; ci++) {
    final cells = <({String ch, String? punct})>[];
    for (final r in cols[ci].runes) {
      final ch = String.fromCharCode(r);
      if ((ch == ',' || ch == '.') && cells.isNotEmpty) {
        cells[cells.length - 1] = (ch: cells.last.ch, punct: ch);
      } else {
        cells.add((ch: ch, punct: null));
      }
    }
    final cx = x0 + (ci + 0.5) * colW;
    var y = top * h;
    for (final cell in cells) {
      if (cell.ch == ' ') {
        y += fs * t.pitch * spineSpace;
        continue;
      }
      final cellH = fs * t.pitch;
      final code = cell.ch.runes.first;
      final gx = cx - g.advance(code, fs) / 2;
      final cy = y + cellH / 2;
      _glyph(canvas, cell.ch, gx, cy + gy, fs, ink);
      if (cell.punct != null) _glyph(canvas, cell.punct!, gx + g.ink(code, fs).x1 - fs * 0.05, cy + fs * 0.5, fs, ink);
      y += cellH + (cell.punct != null ? fs * 0.36 : 0);
    }
  }
}

/// 장정 판짜기 제목을 책등에서 올리는 몫(지금 앱 TITLE_LIFT)
const _titleLift = 0.06;

/// 눕힌 책등 제목(가로 한 줄): 머리(위) → 꼬리(아래)로 쓰고 글자 위쪽은 앞표지 쪽을 향한다. 두께 방향 가운데
void _lyingTitle(ui.Canvas canvas, BookLook look, Dims d, GlyphMetrics g, double opacity) {
  final w = d.t, h = d.h;
  final t = lyingTitleLayout(look.title, h, d.t);
  final fs = t.fontSize;
  final gy = -(g.ascent(fs) + g.descent(fs)) / 2;
  final ink = _alpha(_color(look.ink), opacity);
  canvas.save();
  canvas.translate(w / 2, t.start * h);
  canvas.rotate(math.pi / 2);
  var x = 0.0;
  for (final r in t.text.runes) {
    final ch = String.fromCharCode(r);
    if (ch == ' ') {
      x += fs * 0.32;
      continue;
    }
    final box = g.ink(r, fs);
    _glyph(canvas, ch, x, gy, fs, ink);
    x += (box.x1 - box.x0) + fs * lyingTrack;
  }
  canvas.restore();
}

/// 앞표지 제목: 표지 위에서 11%(벡터 장정), 제본 홈을 뺀 면의 가운데에 고르게 나눈 줄로
void _coverTitle(ui.Canvas canvas, BookLook look, Dims d, GlyphMetrics g) {
  final cw = d.w, h = d.h;
  final ct = coverTitleLayout(look.title, d.w, d.h);
  final cfs = ct.fontSize;
  final lh = cfs * coverLineH;
  final top = math.max(0.08, 0.11) * h;
  final cx0 = (cw + grooveAt) / 2;
  final ink = _color(look.ink);
  for (var i = 0; i < ct.lines.length; i++) {
    final chars = [for (final r in ct.lines[i].runes) r];
    final ws = [
      for (final r in chars) r == 0x20 ? cfs * coverSpace : (() {
        final b = g.ink(r, cfs);
        return b.x1 - b.x0;
      })(),
    ];
    final total = ws.fold(0.0, (a, b) => a + b) + cfs * coverTrack * (chars.length - 1);
    var x = cx0 - total / 2;
    final base = top + i * lh + lh / 2 - (g.ascent(cfs) + g.descent(cfs)) / 2;
    for (var j = 0; j < chars.length; j++) {
      if (chars[j] != 0x20) _glyph(canvas, String.fromCharCode(chars[j]), x, base, cfs, ink);
      x += ws[j] + cfs * coverTrack;
    }
  }
}
