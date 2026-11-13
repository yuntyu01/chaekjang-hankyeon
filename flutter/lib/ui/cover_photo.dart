// 표지 사진을 앞표지 면에 꽉 채워 그린다: 그림 바깥 흰 여백은 표지가 아니라서 빼고(whiteMat), 채도는 사진 책 규칙(0.85)으로.
// 지금 앱 ui/book3d/art.tsx PhotoCover와 domain/cover-url whiteMat을 옮긴 것
library;

import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import '../domain/binding_material.dart';

/// 표지 그림 둘레 흰 여백(변마다 잘라 낼 비율)
class CoverMat {
  const CoverMat(this.l, this.t, this.r, this.b);
  final double l;
  final double t;
  final double r;
  final double b;
  static const none = CoverMat(0, 0, 0, 0);
}

const _nearWhite = 245;
const _matMin = 0.01;
const _matMax = 0.07;
const _matLines = [0.2, 0.35, 0.5, 0.65, 0.8];

/// 네 변 모두 거의 흰 띠가 있고 그 폭이 좁을 때만 여백으로 본다(원래 흰 표지는 띠가 없는 변이 있거나 폭이 넓다). 여백이 아니면 null
CoverMat? whiteMat(int width, int height, Uint8List rgba) {
  bool white(int x, int y) {
    final i = (y * width + x) * 4;
    return rgba[i] >= _nearWhite && rgba[i + 1] >= _nearWhite && rgba[i + 2] >= _nearWhite;
  }

  final band = [double.infinity, double.infinity, double.infinity, double.infinity];
  for (final f in _matLines) {
    final row = (height * f).floor(), col = (width * f).floor();
    var l = 0, r = 0, t = 0, b = 0;
    while (l < width && white(l, row)) {
      l++;
    }
    while (r < width && white(width - 1 - r, row)) {
      r++;
    }
    while (t < height && white(col, t)) {
      t++;
    }
    while (b < height && white(col, height - 1 - b)) {
      b++;
    }
    band[0] = math.min(band[0], l.toDouble());
    band[1] = math.min(band[1], r.toDouble());
    band[2] = math.min(band[2], t.toDouble());
    band[3] = math.min(band[3], b.toDouble());
  }
  final l = band[0] / width, r = band[1] / width, t = band[2] / height, b = band[3] / height;
  if ([l, r, t, b].reduce(math.min) < _matMin || [l, r, t, b].reduce(math.max) > _matMax) return null;
  return CoverMat(l, t, r, b);
}

/// 표지 사진 한 장(그림 + 흰 여백)
class CoverPhoto {
  const CoverPhoto(this.image, this.mat);
  final ui.Image image;
  final CoverMat mat;

  static Future<CoverPhoto> of(ui.Image image) async {
    final data = await image.toByteData(format: ui.ImageByteFormat.rawStraightRgba);
    final mat = data == null ? null : whiteMat(image.width, image.height, data.buffer.asUint8List());
    return CoverPhoto(image, mat ?? CoverMat.none);
  }
}

/// 사진 채도 행렬(휘도는 그대로 두고 회색 쪽으로), Flutter 색 행렬(5×4)
final _photoMatrix = () {
  final m = saturationMatrix(photoSaturation);
  return <double>[
    m[0][0], m[0][1], m[0][2], 0, 0, //
    m[1][0], m[1][1], m[1][2], 0, 0, //
    m[2][0], m[2][1], m[2][2], 0, 0, //
    0, 0, 0, 1, 0,
  ];
}();

/// 면 그림 좌표(0..w, 0..h)에 표지 사진을 꽉 채운다(비율이 다르면 넘치는 쪽을 가운데로 자른다)
void drawPhotoCover(ui.Canvas canvas, CoverPhoto photo, double w, double h) {
  final img = photo.image, m = photo.mat;
  final iw = img.width.toDouble(), ih = img.height.toDouble();
  final k = math.max(w / (iw * (1 - m.l - m.r)), h / (ih * (1 - m.t - m.b)));
  final x = w / 2 - (m.l + (1 - m.l - m.r) / 2) * iw * k;
  final y = h / 2 - (m.t + (1 - m.t - m.b) / 2) * ih * k;
  canvas.save();
  canvas.clipRect(ui.Rect.fromLTWH(0, 0, w, h));
  canvas.drawImageRect(
    img,
    ui.Rect.fromLTWH(0, 0, iw, ih),
    ui.Rect.fromLTWH(x, y, iw * k, ih * k),
    ui.Paint()
      ..filterQuality = ui.FilterQuality.medium
      ..colorFilter = ui.ColorFilter.matrix(_photoMatrix),
  );
  canvas.restore();
}
