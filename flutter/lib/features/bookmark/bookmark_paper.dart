// 갈피 종이(지금 앱 BookmarkPaper.tsx): 바탕색 + 옅은 빛 띠 + 섬유 무늬 세 겹(64·91·137 주기, 서로 맞지 않아 타일이 보이지 않는다).
// 무늬 한 칸은 씨앗별로 한 번만 그림으로 굽고(기기 화소 배율), 화면에서는 그 그림을 반복 채움으로 깐다(스크롤 중 다시 그리지 않는다)
library;

import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';
import 'package:path_parsing/path_parsing.dart';

import 'paper_grain.dart';

class _PathWriter extends PathProxy {
  _PathWriter(this.path);
  final Path path;
  @override
  void moveTo(double x, double y) => path.moveTo(x, y);
  @override
  void lineTo(double x, double y) => path.lineTo(x, y);
  @override
  void cubicTo(double x1, double y1, double x2, double y2, double x3, double y3) => path.cubicTo(x1, y1, x2, y2, x3, y3);
  @override
  void close() => path.close();
}

/// SVG 경로 글자 → Path
Path svgPath(String d) {
  final p = Path();
  writeSvgPathDataToPath(d, _PathWriter(p));
  return p;
}

enum PaperKind { plain, colored, tape }

Color _c(int rgb, double a) => Color(0xFF000000 | rgb).withValues(alpha: a);

/// 반복 채움 한 칸(정수 화소에 맞춘 배율과 함께)
class _Tile {
  _Tile(this.image, this.k);
  final ui.Image image;
  final double k;
}

class _Tiles {
  _Tiles(this.fine, this.soft, this.pulp);
  final _Tile fine, soft, pulp;
}

// 씨앗별 무늬 칸(최근 것만). 화면에서 빠진 칸 그림은 참조가 끊기면 엔진이 거둔다
const _tileMax = 24;
final _tiles = <String, _Tiles>{};

_Tile _bake(double size, double dpr, void Function(Canvas) draw) {
  final px = (size * dpr).ceil();
  final k = px / size;
  final rec = ui.PictureRecorder();
  final c = Canvas(rec);
  c.scale(k);
  // 칸 밖으로 나간 섬유는 잘린다(SVG 무늬와 같다)
  c.clipRect(Rect.fromLTWH(0, 0, size, size));
  draw(c);
  final pic = rec.endRecording();
  final img = pic.toImageSync(px, px);
  pic.dispose();
  return _Tile(img, k);
}

Paint _stroke(int rgb, double width, double alpha, {StrokeCap cap = StrokeCap.butt}) => Paint()
  ..style = PaintingStyle.stroke
  ..strokeWidth = width
  ..strokeCap = cap
  ..isAntiAlias = true
  ..color = _c(rgb, alpha);

Paint _fill(int rgb, double alpha) => Paint()..color = _c(rgb, alpha);

void _shifted(Canvas c, double dx, double dy, void Function() draw) {
  c.save();
  c.translate(dx, dy);
  draw();
  c.restore();
}

_Tiles _tilesOf(String seed, PaperKind kind, double dpr) {
  final key = '$seed|${kind.name}|${dpr.toStringAsFixed(2)}';
  final hit = _tiles.remove(key);
  if (hit != null) return _tiles[key] = hit;
  final g = makeGrain(seed);
  final tape = kind == PaperKind.tape, colored = kind == PaperKind.colored;
  final fine = svgPath(g.fine), broad = svgPath(g.broad), pulp = svgPath(g.pulp), cloud = svgPath(g.cloud);
  final t = _Tiles(
    _bake(64, dpr, (c) {
      c.drawPath(fine, _stroke(colored ? 0x52616A : 0x827772, tape ? 0.55 : 0.35, tape ? 0.115 : colored ? 0.20 : 0.12));
      _shifted(c, .2, .3, () => c.drawPath(fine, _stroke(0xFFFFFF, tape ? 0.65 : 0.45, tape ? 0.19 : colored ? 0.25 : 0.17)));
    }),
    _bake(91, dpr, (c) {
      c.drawPath(broad, _stroke(colored ? 0x526570 : 0x897E78, tape ? 1.4 : 0.8, tape ? 0.036 : colored ? 0.06 : 0.04, cap: StrokeCap.round));
      _shifted(c, .15, .35, () => c.drawPath(broad, _stroke(0xFFFFFF, 0.65, colored ? 0.075 : 0.045, cap: StrokeCap.round)));
    }),
    _bake(137, dpr, (c) {
      c.drawPath(cloud, _fill(colored ? 0x526570 : 0x958B85, colored ? 0.028 : 0.014));
      _shifted(c, 23, 51, () => c.drawPath(cloud, _fill(0xFFFFFF, colored ? 0.05 : 0.035)));
      c.drawPath(pulp, _fill(colored ? 0x53616B : 0x897E78, colored ? 0.035 : 0.025));
      _shifted(c, 37, 19, () => c.drawPath(pulp, _fill(0xFFFFFF, colored ? 0.085 : 0.055)));
    }),
  );
  _tiles[key] = t;
  if (_tiles.length > _tileMax) _tiles.remove(_tiles.keys.first);
  return t;
}

/// 갈피 종이 한 장(부모 크기를 채운다)
class BookmarkPaper extends StatelessWidget {
  const BookmarkPaper({super.key, required this.color, required this.radius, required this.seed, this.kind = PaperKind.plain});
  final Color color;
  final double radius;
  final String seed;
  final PaperKind kind;

  @override
  Widget build(BuildContext context) {
    final tiles = _tilesOf(seed, kind, MediaQuery.devicePixelRatioOf(context));
    return IgnorePointer(child: CustomPaint(painter: _PaperPainter(color, radius, kind, tiles), size: Size.infinite));
  }
}

class _PaperPainter extends CustomPainter {
  _PaperPainter(this.color, this.radius, this.kind, this.tiles);
  final Color color;
  final double radius;
  final PaperKind kind;
  final _Tiles tiles;

  Paint _tiled(_Tile t) => Paint()
    ..shader = ui.ImageShader(t.image, TileMode.repeated, TileMode.repeated, (Matrix4.identity()..scaleByDouble(1 / t.k, 1 / t.k, 1, 1)).storage,
        filterQuality: FilterQuality.medium);

  @override
  void paint(Canvas canvas, Size size) {
    final r = Offset.zero & size;
    final colored = kind == PaperKind.colored;
    canvas.save();
    canvas.clipRRect(RRect.fromRectAndRadius(r, Radius.circular(radius)));
    canvas.drawRect(r, Paint()..color = color);
    // 빛 띠: 상자 기준(왼쪽 위 → 가로 75%·아래 끝) 그러데이션
    canvas.drawRect(
      r,
      Paint()
        ..shader = ui.Gradient.linear(
          Offset.zero,
          const Offset(0.75, 1),
          [_c(0xFFFFFF, colored ? 0.10 : 0.20), _c(0xFFFFFF, 0), _c(colored ? 0x536575 : 0x9C928C, colored ? 0.045 : 0.022)],
          [0, 0.42, 1],
          TileMode.clamp,
          (Matrix4.identity()..scaleByDouble(size.width, size.height, 1, 1)).storage,
        ),
    );
    canvas.drawRect(r, _tiled(tiles.soft));
    canvas.drawRect(r, _tiled(tiles.pulp));
    canvas.drawRect(r, _tiled(tiles.fine));
    canvas.restore();
  }

  @override
  bool shouldRepaint(_PaperPainter old) => old.color != color || old.radius != radius || old.kind != kind || old.tiles != tiles;
}
