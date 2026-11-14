// 벽에 새긴 해 숫자(지금 앱 ui/EngravedYear.tsx, 2026-11-09 홈 시안): 지난 책장 머리글·모아 보기 이름표가 같이 쓴다.
// 새김 = 벽보다 진한 회색 글자 + 안쪽 그늘: 위에서 오는 빛이라 홈의 위 가장자리는 어둡고(벽이 가린다) 아래 가장자리는 밝다.
// 순백 벽에서는 바깥에 흰 빛줄을 그려도 보이지 않으므로 글자 안쪽 그늘로만 깊이를 낸다
library;

import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import 'theme.dart';

const _fill = Color(0xFFC0BAB6);
const _dark = Color.fromRGBO(78, 62, 52, 0.48);
const _light = Color.fromRGBO(255, 255, 255, 0.75);
const _track = -0.05; // 자간(글자 크기 배수): Pretendard 숫자는 시안의 둥근 숫자보다 8% 넓어 조금 좁힌다
const _textMax = 1.3; // 시스템 글자 확대는 머리글처럼 1.3배까지
const _pad = 4.0;
const _digitH = 0.72; // 숫자 높이(글자 크기 배수, Pretendard 숫자 윗선)

double _scaled(BuildContext context, double size) => MediaQuery.textScalerOf(context).clamp(maxScaleFactor: _textMax).scale(size);

/// 글자 상자 높이(머리줄 높이를 잡을 때)
double engravedHeight(BuildContext context, double size) => (_scaled(context, size) * 1.3).ceilToDouble();

class EngravedYear extends StatelessWidget {
  const EngravedYear({super.key, required this.label, required this.size, this.a11yLabel, this.header = false});
  final String label;
  final double size;
  final String? a11yLabel;
  final bool header;

  @override
  Widget build(BuildContext context) {
    final fs = _scaled(context, size);
    final tp = TextPainter(
      text: TextSpan(text: label, style: TextStyle(fontFamily: AppFonts.uiTitle, fontSize: fs, letterSpacing: _track * fs, color: _fill, height: 1)),
      textDirection: TextDirection.ltr,
      textScaler: TextScaler.noScaling,
    )..layout();
    final h = engravedHeight(context, size);
    final w = (tp.width - _track * fs).ceilToDouble() + 2 * _pad;
    return Semantics(
      header: header,
      label: a11yLabel ?? label,
      excludeSemantics: true,
      child: SizedBox(width: w, height: h, child: CustomPaint(painter: _Engraved(tp, fs, h))),
    );
  }
}

class _Engraved extends CustomPainter {
  _Engraved(this.tp, this.fs, this.h);
  final TextPainter tp;
  final double fs, h;

  @override
  void paint(Canvas canvas, Size size) {
    final base = tp.computeDistanceToActualBaseline(TextBaseline.alphabetic);
    // 숫자 윤곽(위아래가 같은 높이)을 상자 가운데에
    final at = Offset(_pad, (h - _digitH * fs) / 2 - (base - _digitH * fs));
    final k = fs / 34;
    final bounds = Offset.zero & size;
    canvas.saveLayer(bounds, Paint());
    tp.paint(canvas, at);
    // 안쪽 그늘: 글자 위에만(srcATop) 그늘 색을 깔고, 그늘 방향으로 옮겨 흐린 글자 모양을 파낸다 → 반대쪽 가장자리에만 남는다
    for (final (color, dy, blur) in [(_dark, 1.6 * k, 1.4 * k), (_light, -1.1 * k, 1.0 * k)]) {
      canvas.saveLayer(bounds, Paint()..blendMode = BlendMode.srcATop);
      canvas.drawRect(bounds, Paint()..color = color);
      canvas.saveLayer(bounds, Paint()
        ..blendMode = BlendMode.dstOut
        ..imageFilter = ImageFilter.blur(sigmaX: math.max(0.01, blur), sigmaY: math.max(0.01, blur)));
      tp.paint(canvas, at + Offset(0, dy));
      canvas.restore();
      canvas.restore();
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_Engraved old) => old.tp.text != tp.text || old.fs != fs || old.h != h;
}
