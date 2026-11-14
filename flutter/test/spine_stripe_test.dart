// 표지 이어 쌓기 책등(지금 앱 coverEdgeStripe): 앞표지 왼쪽 가장자리 띠를 줄마다 평균 낸 1화소 폭 그림과,
// 글자가 놓인 구간의 바탕에 맞춘 제목 색(위는 검고 아래는 흰 표지 → 위 글자는 밝게, 아래 글자는 어둡게)
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:chaekjang/domain/color.dart' show titleInk;
import 'package:chaekjang/ui/cover_photo.dart';
import 'package:flutter_test/flutter_test.dart';

Future<ui.Image> _image(int w, int h, Uint8List rgba) async {
  final buf = await ui.ImmutableBuffer.fromUint8List(rgba);
  final desc = ui.ImageDescriptor.raw(buf, width: w, height: h, pixelFormat: ui.PixelFormat.rgba8888);
  final codec = await desc.instantiateCodec();
  return (await codec.getNextFrame()).image;
}

void main() {
  testWidgets('위는 검고 아래는 흰 표지: 줄무늬 높이·색과 구간별 제목 색', (t) async {
    await t.runAsync(() async {
      const w = 200, h = 300;
      final px = Uint8List(w * h * 4);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          final i = (y * w + x) * 4;
          final v = y < h / 2 ? 20 : 235;
          px[i] = v;
          px[i + 1] = v;
          px[i + 2] = v;
          px[i + 3] = 255;
        }
      }
      final p = await CoverPhoto.of(await _image(w, h, px));
      final s = p.stripe!;
      expect(s.image.width, 1);
      expect(s.image.height, h);
      expect(s.inkAt(0.1, 0.3), titleInk('#141414'));
      expect(s.inkAt(0.7, 0.9), titleInk('#ebebeb'));
      expect(s.inkAt(0.1, 0.3), isNot(s.inkAt(0.7, 0.9)));
      final data = (await s.image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
      expect(data.getUint8(0), 20);
      expect(data.getUint8((h - 1) * 4), 235);
    });
  });
}
