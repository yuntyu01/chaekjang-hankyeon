// 재생·일시정지 그림(지금 앱 ReadingScreen PlayIcon·PauseIcon)
library;

import 'package:flutter/widgets.dart';

import '../bookmark/bookmark_paper.dart';

final _tri = svgPath('M8.6 7v10l8.2-5z');

/// 재생 삼각형: 모서리를 둥글게(같은 색 굵은 둥근 이음 윤곽). 눈으로 가운데 보이게 오른쪽으로 조금
class PlayIcon extends StatelessWidget {
  const PlayIcon({super.key, required this.size, required this.color});
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(left: size * 0.08),
        child: CustomPaint(size: Size.square(size), painter: _Tri(color)),
      );
}

class _Tri extends CustomPainter {
  _Tri(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 24);
    canvas.drawPath(_tri, Paint()..color = color);
    canvas.drawPath(_tri, Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeJoin = StrokeJoin.round);
  }

  @override
  bool shouldRepaint(_Tri old) => old.color != color;
}

/// 일시정지: 끝이 둥근 두 막대
class PauseIcon extends StatelessWidget {
  const PauseIcon({super.key, required this.height, required this.width, required this.gap, required this.color});
  final double height, width, gap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    Widget bar() => Container(width: width, height: height, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(width / 2)));
    return Row(mainAxisSize: MainAxisSize.min, children: [bar(), SizedBox(width: gap), bar()]);
  }
}
