// 표지 사진을 앞표지 면에 꽉 채워 그린다: 그림 바깥 흰 여백은 표지가 아니라서 빼고(whiteMat), 채도는 사진 책 규칙(0.85)으로.
// 지금 앱 ui/book3d/art.tsx PhotoCover와 domain/cover-url whiteMat을 옮긴 것.
// 책등 모양(scene_config/spine_look)에 쓰는 그림도 함께 둔다: 실물 측면(YES24 책등 사진)·표지 이어 쌓기(앞표지 가장자리 줄무늬)
library;

import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import '../domain/binding_material.dart';
import '../domain/color.dart' show hexOf, titleInk;
import '../domain/cover_url.dart' show isSpineImage, spineOfCover;
import '../scene_config/spine_look.dart';
import '../services/cover_cache.dart' show loadCover, rawImageInLine;

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

/// 표지 이어 쌓기 책등: 앞표지에서 책등과 맞닿는 가장자리 띠를 줄마다 평균 낸 폭 1화소 그림(책등 폭으로 늘린다)과,
/// 제목 색을 고르는 줄 평균색 누적 합(지금 앱 coverEdgeStripe)
class SpineStripe {
  const SpineStripe(this.image, this._acc, this._rows);
  final ui.Image image;
  final Float64List _acc;
  final int _rows;

  /// 책등 세로 구간(머리 0 ~ 꼬리 1)에 놓이는 글자의 색: 그 구간 줄무늬 평균색에 대해 공통 규칙(titleInk).
  /// 위는 검고 아래는 흰 띠인 표지(데미안)에서 한 색이면 위 글자가 묻혀서 글자마다 고른다
  String inkAt(double f0, double f1) {
    final hh = _rows;
    final a = math.max(0, math.min(hh - 1, (f0 * hh).floor()));
    final b = math.max(a + 1, math.min(hh, (f1 * hh).ceil()));
    final mean = [for (var c = 0; c < 3; c++) ((_acc[b * 3 + c] - _acc[a * 3 + c]) / (b - a)).round()];
    return titleInk(hexOf((mean[0] << 16) | (mean[1] << 8) | mean[2]));
  }
}

/// 띠 위치(그림 끝 이음 흐림을 피해 조금 안쪽부터)와 폭(표지 폭에 대한 비율)
const _stripeIn = 0.004;
const _stripeW = 0.012;

({Uint8List pixels, Float64List acc, int rows})? _stripePixels(int iw, int ih, Uint8List rgba, CoverMat m) {
  final x0 = ((m.l + _stripeIn) * iw).round();
  final bw = math.max(2, (_stripeW * iw).round());
  final y0 = (m.t * ih).round();
  final hh = ((1 - m.b) * ih).round() - y0;
  if (hh < 2 || x0 + bw > iw) return null;
  final out = Uint8List(hh * 4);
  final acc = Float64List((hh + 1) * 3);
  for (var y = 0; y < hh; y++) {
    for (var c = 0; c < 3; c++) {
      var v = 0;
      for (var x = 0; x < bw; x++) {
        v += rgba[((y0 + y) * iw + x0 + x) * 4 + c];
      }
      out[y * 4 + c] = (v / bw).round();
      acc[(y + 1) * 3 + c] = acc[y * 3 + c] + v / bw;
    }
    out[y * 4 + 3] = 255;
  }
  return (pixels: out, acc: acc, rows: hh);
}

/// 표지 사진 한 장(그림 + 흰 여백) + 책등 모양에 쓰는 그림(줄무늬, 실물 측면이면 책등 사진)
class CoverPhoto {
  const CoverPhoto(this.image, this.mat, {this.stripe, this.spine});
  final ui.Image image;
  final CoverMat mat;
  final SpineStripe? stripe;

  /// YES24 책등 사진(실물 측면을 골랐고 좁고 긴 그림이 있을 때만)
  final ui.Image? spine;

  static Future<CoverPhoto> of(ui.Image image, {ui.Image? spine}) async {
    final data = await image.toByteData(format: ui.ImageByteFormat.rawStraightRgba);
    final rgba = data?.buffer.asUint8List();
    final mat = (rgba == null ? null : whiteMat(image.width, image.height, rgba)) ?? CoverMat.none;
    SpineStripe? stripe;
    final px = rgba == null ? null : _stripePixels(image.width, image.height, rgba, mat);
    if (px != null) {
      final img = await rawImageInLine(px.pixels, 1, px.rows);
      if (img != null) stripe = SpineStripe(img, px.acc, px.rows);
    }
    return CoverPhoto(image, mat, stripe: stripe, spine: spine);
  }
}

/// 지금 고른 책등 모양으로 이 책등에 그릴 그림과 제목 색. 사진이면 제목을 쓰지 않는다(사진 안에 있다). null이면 색 한 가지
({ui.Image image, String Function(double, double)? ink})? spineArtOf(CoverPhoto? p) {
  if (p == null) return null;
  switch (spineLook.value) {
    case SpineLook.photo:
      final s = p.spine;
      return s == null ? null : (image: s, ink: null);
    case SpineLook.stripe:
      final s = p.stripe;
      return s == null ? null : (image: s.image, ink: s.inkAt);
    case SpineLook.color:
      return null;
  }
}

final _made = <String, Future<CoverPhoto?>>{};

/// 표지 사진(주소)을 받아 그릴 준비를 한다: 흰 여백·줄무늬를 재고, 실물 측면을 골랐으면 YES24 책등 사진도 받는다.
/// 같은 주소·같은 모양은 한 번만(못 받았으면 다음에 다시)
Future<CoverPhoto?> loadCoverPhoto(String uri) {
  final withSpine = spineLook.value == SpineLook.photo;
  final key = '$uri|${withSpine ? 's' : ''}';
  return _made[key] ??= () async {
    final img = await loadCover(uri);
    if (img == null) {
      _made.remove(key);
      return null;
    }
    ui.Image? spine;
    final side = withSpine ? spineOfCover(uri, 'XL') : null;
    if (side != null) {
      final s = await loadCover(side);
      // 책등이 없는 책은 YES24가 '이미지 준비중' 대체 그림(넓은 그림)을 주므로 좁고 긴 그림만 쓴다
      if (s != null && isSpineImage(s.width, s.height)) spine = s;
    }
    if (_made.length > 256) _made.remove(_made.keys.first);
    return CoverPhoto.of(img, spine: spine);
  }();
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

/// 면 그림 좌표(0..w, 0..h)에 책등 그림(사진·줄무늬)을 늘려 채운다(지금 앱 fit="fill"), 채도는 사진 규칙
void drawSpineImage(ui.Canvas canvas, ui.Image img, double w, double h) {
  canvas.drawImageRect(
    img,
    ui.Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble()),
    ui.Rect.fromLTWH(0, 0, w, h),
    ui.Paint()
      ..filterQuality = ui.FilterQuality.medium
      ..colorFilter = ui.ColorFilter.matrix(_photoMatrix),
  );
}

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
