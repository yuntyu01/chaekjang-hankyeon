// 글꼴 표 읽기: 값은 fontTools로 읽은 함렛 SemiBold 값(한글 나아가기 0.93em, '가' 잉크 0.053~0.919em)
import 'dart:io';
import 'dart:typed_data';

import 'package:chaekjang/ui/glyph_metrics.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final g = GlyphMetrics.parse(ByteData.sublistView(File('assets/fonts/Hahmlet-SemiBold.ttf').readAsBytesSync()));
  test('한글 나아가기·잉크 상자가 글꼴 값과 같다', () {
    for (final ch in '가나다책장한켠느린계절'.runes) {
      expect(g.advance(ch, 10), closeTo(9.3, 1e-9), reason: String.fromCharCode(ch));
    }
    final ga = g.ink('가'.runes.first, 10);
    expect(ga.x0, closeTo(0.53, 1e-9));
    expect(ga.x1, closeTo(9.19, 1e-9));
    final ch = g.ink('책'.runes.first, 10);
    expect(ch.x1, closeTo(8.62, 1e-9));
    final comma = g.ink(','.runes.first, 10);
    expect(comma.x0, closeTo(0.75, 1e-9));
    expect(g.advance('A'.runes.first, 10), closeTo(8.45, 1e-9));
  });
  test('띄어쓰기는 잉크가 없고 올림·내림 부호가 Skia와 같다', () {
    final sp = g.ink(0x20, 10);
    expect(sp.x1 - sp.x0, 0);
    expect(g.ascent(10), closeTo(-11.6, 1e-9));
    expect(g.descent(10), closeTo(2.88, 1e-9));
  });
}
