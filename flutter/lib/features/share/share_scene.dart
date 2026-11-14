// 책 공유 카드 그림(지금 앱 features/book/share-scene.ts, 2026-11-10 사용자 시안 '재질·빛비침·그림자 99% 동일하게', '어떤 책을 넣어도 빛 반사가 책 위에서 동일하게'):
// 시안에서 책·글자를 지운 바탕(벽 질감·창빛 줄기·나무 선반)을 깔고, 그 위에 벽 그림자 → 선반 그늘 → 책(표지 + 오버레이 + 속지 띠) → 글자를 그린다.
// 오버레이는 시안 책에서 뽑은 두 지도: 곱하는 빛 M과 더하는 빛 A(shaders/share_cover.frag). 좌표는 시안 화소(폭 941)이고 그릴 때 폭에 맞춰 줄인다.
// 미리보기와 내보내기 모두 화면 밖 그림으로 같은 식을 그린다(셰이더의 FlutterFragCoord는 캔버스 변환을 거친 시안 화소 좌표)
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../../ui/keep_all.dart';

const sceneW = 941.0; // 시안 폭(화소)
const sceneH = 1671.0; // 시안 높이(9:16)

// 시안에서 잰 자리(화소)
const _coverH = 616.0; // 표지 높이(시안 책)
const _coverBottom = 840.0; // 표지 아래 끝(선반 윗면 위)
const _bookCx = 468.5; // 책(표지+속지) 가운데
const _coverMaxW = 520.0; // 아주 넓은 책은 이 폭에 맞춰 높이를 줄인다
const _pageK = 0.57; // 속지 띠 폭 = 표지 높이 × 두께/높이 × 이 값
const _shelfTop = 827.0; // 선반 윗면 뒤 끝
// 벽 그림자 지도 자리(시안 화소)와 시안 책 왼쪽·오른쪽 끝(속지 띠 끝)
const _shadeMap = (x: 200.0, y: 180.0, w: 680.0, h: 647.0);
const _refBook = (left: 239.0, right: 699.0);
// 표지 색감(시안 책은 실제 표지보다 채도가 높고 검정이 따뜻한 회색으로 뜬 무광 종이)
const _grade = (sat: 1.42, gamma: 1.015, gain: 0.978, lift: (15.8, 15.0, 12.6));

// 글자(시안에서 잰 크기·색)
const _ink = (title: Color(0xFF1B1B1B), author: Color(0xFF5E5D5E), note: Color(0xFF1E1E1E), star: Color(0xFF7E7C7C), meta: Color(0xFF7D7C7D), foot: Color(0xFF333233), rule: Color(0xFFD8D8D7));
const _textX = 89.0;
const _textW = 760.0;
const shareFonts = (title: 'MaruBuriSemiBold', note: 'MaruBuriRegular', ui: 'PretendardRegular');

/// 지금 앱(Skia 문단)의 그늘 번짐은 시그마 값이다. Flutter Shadow는 반지름을 받아 시그마로 바꾸므로 거꾸로 바꿔 넘긴다
double blurRadiusOfSigma(double sigma) => sigma <= 0.5 ? 0 : (sigma - 0.5) / 0.57735;

class ShareSceneAssets {
  const ShareSceneAssets({required this.plate, required this.mul, required this.add, required this.pages, required this.shelfRight, required this.shelfFront, required this.shade, required this.coverFx, required this.shadeFx, this.cover});
  final ui.Image plate, mul, add, pages, shelfRight, shelfFront, shade;
  final ui.FragmentProgram coverFx, shadeFx;
  final ui.Image? cover;

  ShareSceneAssets withCover(ui.Image? c) =>
      ShareSceneAssets(plate: plate, mul: mul, add: add, pages: pages, shelfRight: shelfRight, shelfFront: shelfFront, shade: shade, coverFx: coverFx, shadeFx: shadeFx, cover: c);
}

Future<ui.Image> assetImage(String path) async {
  final data = await rootBundle.load(path);
  final codec = await ui.instantiateImageCodec(data.buffer.asUint8List());
  final frame = await codec.getNextFrame();
  codec.dispose();
  return frame.image;
}

Future<ShareSceneAssets>? _assets;

/// 바탕·오버레이·셰이더(한 번 불러 둔다). 표지는 책마다 withCover로 붙인다
Future<ShareSceneAssets> loadShareAssets() => _assets ??= () async {
      Future<ui.Image> img(String n) => assetImage('assets/share/$n.png');
      final r = await Future.wait([img('plate'), img('book-mul'), img('book-add'), img('book-pages'), img('shelf-right'), img('shelf-front'), img('book-shade')]);
      return ShareSceneAssets(
        plate: r[0],
        mul: r[1],
        add: r[2],
        pages: r[3],
        shelfRight: r[4],
        shelfFront: r[5],
        shade: r[6],
        coverFx: await ui.FragmentProgram.fromAsset('shaders/share_cover.frag'),
        shadeFx: await ui.FragmentProgram.fromAsset('shaders/share_shade.frag'),
      );
    }();

class ShareSceneInput {
  const ShareSceneInput({required this.title, this.author, this.note, this.rating, this.extra = const [], required this.coverAspect, this.thicknessRatio, this.coverColor});
  final String title;
  final String? author, note;
  final num? rating; // 0.5 단위
  final List<String> extra; // 독서 시간·읽은 기간(고른 것만)
  final double coverAspect; // 표지 폭/높이
  final double? thicknessRatio; // 두께/높이(속지 띠 폭)
  final int? coverColor; // 표지 그림이 없을 때 표지 색(0xRRGGBB)

  @override
  bool operator ==(Object other) =>
      other is ShareSceneInput &&
      other.title == title &&
      other.author == author &&
      other.note == note &&
      other.rating == rating &&
      other.extra.join('|') == extra.join('|') &&
      other.coverAspect == coverAspect &&
      other.thicknessRatio == thicknessRatio &&
      other.coverColor == coverColor;

  @override
  int get hashCode => Object.hash(title, author, note, rating, extra.join('|'), coverAspect, thicknessRatio, coverColor);
}

class ShareLayout {
  ShareLayout(this.height, this.cover, this.pageW, this.title, this.author, this.note, this.meta, this.foot, this.y);
  final double height; // 장면 높이(시안 화소)
  final Rect cover;
  final double pageW;
  final ui.Paragraph title, foot;
  final ui.Paragraph? author, note, meta;
  final ({double title, double author, double note, double stars, double foot}) y;
}

// 종이에 찍힌 글자처럼 아래로 아주 옅은 그늘(시안 글자 둘레)
final _textShadow = [ui.Shadow(color: const Color.fromRGBO(0, 0, 0, 0.14), offset: const Offset(0, 1.5), blurRadius: blurRadiusOfSigma(2))];

ui.Paragraph _para(String text, String family, double size, Color color, [double? lineHeight]) {
  final b = ui.ParagraphBuilder(ui.ParagraphStyle(fontFamily: family, fontSize: size))
    ..pushStyle(ui.TextStyle(color: color, fontFamily: family, fontSize: size, height: lineHeight == null ? null : lineHeight / size, shadows: _textShadow))
    ..addText(keepAll(text));
  return b.build()..layout(const ui.ParagraphConstraints(width: _textW));
}

ShareLayout layoutShareScene(ShareSceneInput input) {
  // 책: 높이는 시안 책과 같게, 폭은 표지 비율. 너무 넓으면 폭을 묶고 높이를 줄인다
  var h = _coverH;
  var w = h * input.coverAspect;
  if (w > _coverMaxW) {
    w = _coverMaxW;
    h = w / input.coverAspect;
  }
  final pageW = math.max(10.0, math.min(40.0, h * (input.thicknessRatio ?? 0.07) * _pageK));
  final x = _bookCx - (w + pageW) / 2;
  final cover = Rect.fromLTWH(x, _coverBottom - h, w, h);

  final title = _para(input.title, shareFonts.title, 67, _ink.title, 80);
  final author = input.author != null ? _para(input.author!, shareFonts.ui, 36, _ink.author) : null;
  final note = input.note != null ? _para(input.note!, shareFonts.note, 48, _ink.note, 70) : null;
  final metaText = [if (input.rating != null && input.rating != 0) input.rating!.toStringAsFixed(1), ...input.extra].join('   ');
  final meta = metaText.isNotEmpty ? _para(metaText, shareFonts.ui, 36, _ink.meta) : null;
  final foot = _para('책장 한켠', shareFonts.ui, 33, _ink.foot);
  // 세로 흐름(시안에서 잰 간격, 글자 문단 위 끝): 제목 1017 → 12 → 저자 → 47 → 감상 → 60 → 별점 줄 → 152 → '책장 한켠'(시안 자리보다 위로는 올라가지 않는다)
  const yTitle = 1017.0;
  var bottom = yTitle + title.height;
  final yAuthor = bottom + 12;
  if (author != null) bottom = yAuthor + author.height;
  final yNote = bottom + 47;
  if (note != null) bottom = yNote + note.height;
  final yStars = bottom + 60;
  final hasMeta = (input.rating != null && input.rating != 0) || meta != null;
  if (hasMeta) bottom = yStars + 43;
  final yFoot = math.max(1551.0, (hasMeta ? yStars : bottom) + 152);
  final height = math.max(sceneH, yFoot + 120);
  return ShareLayout(height, cover, pageW, title, author, note, meta, foot, (title: yTitle, author: yAuthor, note: yNote, stars: yStars, foot: yFoot));
}

// 5각 별(시안 별: 끝이 조금 둥근 회색 별)
Path _star(double cx, double cy, double r0) {
  final p = Path();
  final r = r0 * 0.5;
  for (var i = 0; i < 10; i++) {
    final a = -math.pi / 2 + i * math.pi / 5;
    final rr = i.isOdd ? r : r0;
    final x = cx + rr * math.cos(a), y = cy + rr * math.sin(a);
    if (i == 0) {
      p.moveTo(x, y);
    } else {
      p.lineTo(x, y);
    }
  }
  return p..close();
}

Rect _all(ui.Image i) => Rect.fromLTWH(0, 0, i.width.toDouble(), i.height.toDouble());

/// width: 그리는 폭(화소)
void drawShareScene(Canvas canvas, double width, ShareLayout L, ShareSceneAssets A, ShareSceneInput input) {
  final k = width / sceneW;
  canvas.save();
  canvas.scale(k, k);
  final paint = Paint()
    ..isAntiAlias = true
    ..filterQuality = FilterQuality.medium;
  // 1) 바탕: 시안 높이를 넘으면 아래 벽(글자 없는 띠)을 거울로 이어 붙인다
  canvas.drawImageRect(A.plate, const Rect.fromLTWH(0, 0, sceneW, sceneH), const Rect.fromLTWH(0, 0, sceneW, sceneH), paint);
  var flip = true;
  for (var y = sceneH; y < L.height; y += 300, flip = !flip) {
    canvas.save();
    if (flip) {
      canvas.translate(0, 2 * y);
      canvas.scale(1, -1);
      canvas.drawImageRect(A.plate, const Rect.fromLTWH(0, sceneH - 300, sceneW, 300), Rect.fromLTWH(0, y - 300, sceneW, 300), paint);
    } else {
      canvas.drawImageRect(A.plate, const Rect.fromLTWH(0, sceneH - 300, sceneW, 300), Rect.fromLTWH(0, y, sceneW, 300), paint);
    }
    canvas.restore();
  }
  final c = L.cover;
  final right = c.right;
  final pw = L.pageW;
  // 2) 벽 빛·그늘(선반 윗면 뒤 끝 위로만): 바탕을 지도와 곱해 다시 그린다
  final sh = A.shadeFx.fragmentShader();
  var i = 0;
  void f(double v) => sh.setFloat(i++, v);
  f(A.plate.width.toDouble());
  f(A.plate.height.toDouble());
  f(_shadeMap.x);
  f(_shadeMap.y);
  f(_shadeMap.w);
  f(_shadeMap.h);
  f(c.left + (c.width + pw) / 2);
  f(c.left - _refBook.left);
  f(right + pw - _refBook.right);
  f(_coverBottom);
  f(_coverH / c.height);
  sh.setImageSampler(0, A.plate, filterQuality: FilterQuality.low);
  sh.setImageSampler(1, A.shade, filterQuality: FilterQuality.low);
  canvas.drawRect(const Rect.fromLTWH(0, 0, sceneW, _shelfTop), Paint()..shader = sh);
  sh.dispose();
  // 선반 윗면 그늘(시안에서 뜬 그림을 곱한다): 책 오른쪽 + 책 앞
  final mp = Paint()
    ..blendMode = BlendMode.multiply
    ..filterQuality = FilterQuality.medium;
  canvas.drawImageRect(A.shelfRight, _all(A.shelfRight), Rect.fromLTWH(right + pw, _shelfTop, 200, 27), mp);
  canvas.drawImageRect(A.shelfFront, _all(A.shelfFront), Rect.fromLTWH(c.left, _coverBottom + 1, c.width + pw, 13), mp);
  // 3) 책: 표지(오버레이 셰이더) → 속지 띠. 표지 그림이 없으면(받는 중·사진 없음) 표지 색 한 가지에 같은 오버레이
  final cs = A.coverFx.fragmentShader();
  i = 0;
  void g(double v) => cs.setFloat(i++, v);
  final cc = input.coverColor ?? 0xD9D6D2;
  for (final v in [c.left, c.top, c.width, c.height, _grade.sat, _grade.gamma, _grade.gain, _grade.lift.$1 / 255, _grade.lift.$2 / 255, _grade.lift.$3 / 255]) {
    g(v);
  }
  g(A.cover != null ? 1 : 0);
  g(((cc >> 16) & 0xFF) / 255);
  g(((cc >> 8) & 0xFF) / 255);
  g((cc & 0xFF) / 255);
  cs.setImageSampler(0, A.cover ?? A.mul, filterQuality: FilterQuality.low);
  cs.setImageSampler(1, A.mul, filterQuality: FilterQuality.low);
  cs.setImageSampler(2, A.add, filterQuality: FilterQuality.low);
  canvas.drawRRect(RRect.fromRectAndRadius(c, const Radius.circular(3)), Paint()
    ..isAntiAlias = true
    ..shader = cs);
  cs.dispose();
  canvas.drawImageRect(A.pages, _all(A.pages), Rect.fromLTWH(right - 0.5, c.top - 2, pw + 3 * (pw / 27), c.height + 4), paint);
  // 4) 글자
  canvas.drawParagraph(L.title, Offset(_textX - 4, L.y.title));
  if (L.author != null) canvas.drawParagraph(L.author!, Offset(_textX, L.y.author));
  if (L.note != null) canvas.drawParagraph(L.note!, Offset(_textX - 1, L.y.note));
  var mx = _textX + 3;
  final rating = input.rating;
  if (rating != null && rating != 0) {
    final fill = Paint()
      ..isAntiAlias = true
      ..color = _ink.star;
    final line = Paint()
      ..isAntiAlias = true
      ..color = _ink.star
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6;
    const r0 = 16.8;
    for (var s = 0; s < 5; s++) {
      final cx = mx + r0 + s * 43, cy = L.y.stars + 16;
      final path = _star(cx, cy, r0);
      final part = math.max(0.0, math.min(1.0, rating - s));
      if (part >= 1) {
        canvas.drawPath(path, fill);
      } else {
        if (part > 0) {
          canvas.save();
          canvas.clipRect(Rect.fromLTWH(cx - r0, cy - r0, r0 * 2 * part, r0 * 2));
          canvas.drawPath(path, fill);
          canvas.restore();
        }
        canvas.drawPath(path, line);
      }
    }
    mx += 5 * 43 + 18;
  }
  if (L.meta != null) canvas.drawParagraph(L.meta!, Offset(mx - 3, L.y.stars - 4));
  // 맨 아래 '책장 한켠' + 양옆 줄
  final fw = L.foot.maxIntrinsicWidth;
  canvas.drawParagraph(L.foot, Offset(sceneW / 2 - fw / 2, L.y.foot));
  final rp = Paint()..color = _ink.rule;
  canvas.drawRect(Rect.fromLTWH(296, L.y.foot + 22, 76, 2), rp);
  canvas.drawRect(Rect.fromLTWH(sceneW - 296 - 76, L.y.foot + 22, 76, 2), rp);
  canvas.restore();
}

/// 공유 카드 그림(폭 pxWidth 화소). 미리보기·내보내기가 같이 쓴다
ui.Image renderShareCard(ShareSceneAssets a, ShareSceneInput input, int pxWidth) {
  final l = layoutShareScene(input);
  final h = (l.height * pxWidth / sceneW).round();
  final rec = ui.PictureRecorder();
  drawShareScene(Canvas(rec), pxWidth.toDouble(), l, a, input);
  final pic = rec.endRecording();
  final img = pic.toImageSync(pxWidth, h);
  pic.dispose();
  return img;
}

/// 그림 높이/폭(미리보기 칸 크기)
double shareCardAspect(ShareSceneInput input) => layoutShareScene(input).height / sceneW;
