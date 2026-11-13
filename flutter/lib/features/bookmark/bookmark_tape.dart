// 한지 테이프 한 조각(지금 앱 BookmarkTape.tsx): 44×45 재료 좌표의 윤곽·섬유·주름·그림자.
// 그림자는 흐림 필터 없이 옅은 윤곽을 여러 겹 겹쳐 번지게 한다(앱과 같은 방식). 조각마다 한 번 그림으로 구워 둔다
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';

import 'bookmark_paper.dart';
import 'paper_grain.dart';

Color _c(int rgb, double a) => Color(0xFF000000 | rgb).withValues(alpha: a);

const _max = 16;
final _baked = <String, ui.Image>{};

Paint _line(int rgb, double w, double a, {StrokeCap cap = StrokeCap.butt, StrokeJoin join = StrokeJoin.miter}) => Paint()
  ..style = PaintingStyle.stroke
  ..strokeWidth = w
  ..strokeCap = cap
  ..strokeJoin = join
  ..color = _c(rgb, a);

void _at(Canvas c, double dx, double dy, void Function() draw) {
  c.save();
  c.translate(dx, dy);
  draw();
  c.restore();
}

/// 같은 색 채움+선을 한 겹으로(겹친 곳이 두 번 칠해지지 않게) 투명도를 준다
void _layer(Canvas c, Rect bounds, double alpha, void Function() draw) {
  c.saveLayer(bounds, Paint()..color = Color.fromRGBO(0, 0, 0, alpha));
  draw();
  c.restore();
}

final _underShadow = svgPath('M2 40Q22 42.5 42 39.8L42 44.1Q21 45.8 2 44.7Z');
final _topEdge = svgPath('M.9 12L1.2 2.7Q1.3 1.3 3 1.35Q24 .8 41.8 1.1');

/// 재료 좌표(44×45)로 테이프를 그린다
void paintTape(Canvas c, Color color, String seed, double join) {
  final m = tapeMaterial(seed);
  final shape = svgPath(m.shape);
  final view = const Rect.fromLTWH(-12, -8, 68, 69);
  // 종이에 닿은 부분(join 아래)에만 지는 그림자
  c.save();
  c.clipRect(Rect.fromLTWH(-12, join, 68, 55));
  const spreads = [10.0, 8.5, 7.0, 5.5, 4.0, 2.5, 1.0, 0.0];
  for (final (i, spread) in spreads.indexed) {
    _layer(c, view, .012 + i * .001, () {
      _at(c, .8, 2.7, () {
        c.drawPath(shape, Paint()..color = const Color(0xFF94765B));
        if (spread > 0) c.drawPath(shape, _line(0x94765B, spread, 1, join: StrokeJoin.round));
      });
    });
  }
  for (final spread in const [5.0, 3.5, 2.0, .5]) {
    _layer(c, view, .026, () {
      _at(c, .6, 1.2, () {
        c.drawPath(_underShadow, Paint()..color = const Color(0xFF89705A));
        c.drawPath(_underShadow, _line(0x89705A, spread, 1, join: StrokeJoin.round));
      });
    });
  }
  c.restore();
  _at(c, .3, .8, () {
    c.drawPath(shape, Paint()..color = _c(0x6E6255, 0.17));
    c.drawPath(shape, _line(0x6E6255, .7, .06));
  });
  c.drawPath(shape, Paint()..color = color);
  c.save();
  c.clipPath(shape);
  c.drawRect(
    const Rect.fromLTWH(0, 0, 44, 45),
    Paint()
      ..shader = ui.Gradient.linear(
        Offset.zero,
        const Offset(0.6, 1),
        [_c(0xFFFFFF, .18), _c(0xFFFFFF, .015), _c(0x384D57, .045), _c(0xFFF6E9, .16)],
        [0, .25, .75, 1],
        TileMode.clamp,
        (Matrix4.identity()..scaleByDouble(44, 45, 1, 1)).storage,
      ),
  );
  c.drawPath(svgPath(m.pulp), Paint()..color = _c(0x46606A, .035));
  // 물결 주름: 골(어둡게)과 바로 옆 등(밝게). 위에서 오는 빛이라 등은 골보다 조금 위
  final swirl = svgPath(m.swirl);
  for (final w in const [3.2, 1.8]) {
    _at(c, 0, .7, () => c.drawPath(swirl, _line(0x3E5560, w, .022, cap: StrokeCap.round)));
  }
  for (final w in const [2.6, 1.3]) {
    c.drawPath(swirl, _line(0xFFFCF2, w, .05, cap: StrokeCap.round));
  }
  final short = svgPath(m.short), long = svgPath(m.long);
  c.drawPath(short, _line(0x4D6269, .32, .07, cap: StrokeCap.round));
  _at(c, .12, .22, () => c.drawPath(short, _line(0xF6F3E8, .36, .1, cap: StrokeCap.round)));
  c.drawPath(long, _line(0x61747A, .36, .11, cap: StrokeCap.round));
  _at(c, 0, .3, () => c.drawPath(long, _line(0xFFFCF0, .42, .15, cap: StrokeCap.round)));
  c.drawPath(svgPath(m.flecks), _line(0x334B56, .45, .11, cap: StrokeCap.round));
  c.drawRect(
    Rect.fromLTWH(0, join - 2.2, 44, 4.4),
    Paint()
      ..shader = ui.Gradient.linear(
        Offset(0, join - 2.2),
        Offset(0, join + 2.2),
        [_c(0x50606A, 0), _c(0x50606A, .065), _c(0xFFFFFF, .065), _c(0xFFFFFF, 0)],
        [0, .4, .55, 1],
      ),
  );
  c.restore();
  // 빛 받는 윗변과 찢긴 섬유(굵은 윤곽선은 없다)
  c.drawPath(_topEdge, _line(0xFFFCEF, .65, .52, cap: StrokeCap.round));
  final torn = svgPath(m.torn);
  c.drawPath(torn, _line(0x566B70, .55, .38, join: StrokeJoin.round));
  _at(c, 0, -.65, () => c.drawPath(torn, _line(0xFFF5E6, .5, .34)));
  c.drawPath(svgPath(m.fringe), _line(0xF5F0DF, .3, .55, cap: StrokeCap.round));
}

/// 테이프 위젯: width×height 자리에 붙고, 그림자·여백은 자리 밖(-12/44, -8/45)까지 그린다
class BookmarkTape extends StatelessWidget {
  const BookmarkTape({super.key, required this.color, required this.seed, required this.width, required this.height, this.paperEdge = 13});
  final Color color;
  final String seed;
  final double width, height, paperEdge;

  @override
  Widget build(BuildContext context) {
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final key = '$seed|${color.toARGB32()}|$width|$height|$paperEdge|${dpr.toStringAsFixed(2)}';
    var img = _baked.remove(key);
    if (img == null) {
      // SVG 상자(viewBox -12 -8 68 69, 가운데 맞춤 meet)
      final sw = width * 68 / 44, sh = height * 69 / 45;
      final s = math.min(width / 44, height / 45);
      final rec = ui.PictureRecorder();
      final c = Canvas(rec);
      c.scale(dpr);
      c.translate((sw - 68 * s) / 2 + 12 * s, (sh - 69 * s) / 2 + 8 * s);
      c.scale(s);
      paintTape(c, color, seed, paperEdge / height * 45);
      final pic = rec.endRecording();
      img = pic.toImageSync((sw * dpr).ceil(), (sh * dpr).ceil());
      pic.dispose();
    }
    _baked[key] = img;
    if (_baked.length > _max) _baked.remove(_baked.keys.first);
    return IgnorePointer(
      child: SizedBox(width: width, height: height, child: CustomPaint(painter: _TapePainter(img, width, height, dpr))),
    );
  }
}

class _TapePainter extends CustomPainter {
  _TapePainter(this.img, this.w, this.h, this.dpr);
  final ui.Image img;
  final double w, h, dpr;

  @override
  void paint(Canvas canvas, Size size) {
    final dst = Rect.fromLTWH(-12 * w / 44, -8 * h / 45, img.width / dpr, img.height / dpr);
    canvas.drawImageRect(img, Offset.zero & Size(img.width.toDouble(), img.height.toDouble()), dst, Paint()..filterQuality = FilterQuality.medium);
  }

  @override
  bool shouldRepaint(_TapePainter old) => old.img != img;
}
