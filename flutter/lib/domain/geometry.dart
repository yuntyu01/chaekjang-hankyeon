// 책장의 3D 구조(카메라와 상관없다). app/src/domain/geometry.ts에서 빛 계산에 쓰는 값만 먼저 옮긴 것.
// 모든 값은 설계 단위(DU, 기준 폭 390)이며 화면에서는 배율(scale)을 곱한다.
// 깊이(줄 기준): 판 앞 끝 z = −shelfFront, 책 기준선 z = 0, 뒷벽 z = shelfDepth
library;

import 'dart:math' as math;

import '../scene_config/skin.dart';
import 'types.dart';

const designWidth = 390.0;
const plankInset = 10.0;
const _usableLeft = 12.0;
const usableW = designWidth - _usableLeft * 2;

/// 선반 안쪽 480mm = 사용 폭
const duMm = usableW / 480;

const shelfTotalDepthMm = 230.0;
const shelfFrontMm = 70.0;
const shelfDepthMm = shelfTotalDepthMm - shelfFrontMm;
const shelfDepth = shelfDepthMm * duMm;
const shelfFront = shelfFrontMm * duMm;

/// 평평한 벽 면(구멍 앞 끝, z = −frameFront). 움푹 파인 책장은 판 앞면보다 앞이다(skin look.lipMm)
final frameFront = (shelfFrontMm + (frameOn ? look.lipMm : -3)) * duMm;

final shelfThickMm = frameOn ? look.thickMm : 21.5;
final shelfThick = shelfThickMm * duMm;

/// 판 좌우 끝. 움푹 파인 책장은 판 끝이 곧 옆 벽이라 책 줄보다 길지 않다
final _plankOver = frameOn ? 0.0 : 1.5;
final shelfX0 = -_plankOver;
final shelfX1 = usableW + _plankOver;

/// 구멍 앞 끝 둥근 테의 반지름. 평평한 벽에서 구멍 바깥쪽으로 그만큼 넓다
final rimR = frameOn ? look.rimMm * duMm : 0.0;
final frameX0 = shelfX0;
final frameX1 = shelfX1;

/// 선반 안쪽 길이를 480mm로 고정하고, 화면에서는 이 길이가 사용 폭에 맞도록 비율만 바꾼다
const shelfLengthMm = 480.0;
const shelfUsableWidth = usableW;
const duPerMm = shelfUsableWidth / shelfLengthMm;

double mm(double v) => v * duPerMm;

// ---------- 책 크기(등급 또는 실제 판형) ----------
const minSpineDu = 30.0;
const minSpineMm = 10.0;
const thicknessGrowth = 1.0;
const mmPerPage = 0.06;
const coverMm = 1.5;

/// 책등 두께 mm → DU(얇은 책도 손으로 집을 만한 최소 두께를 준다)
double spineDU(double thickMm) => minSpineDu + math.max(0.0, thickMm - minSpineMm) * duPerMm * thicknessGrowth;

/// 쪽수 → 두께 mm
double thicknessMm(int pages) => pages * mmPerPage + coverMm;

/// 개별 치수가 없는 책의 기본 크기
const bookHeightOf = {HeightClass.short: 136.0, HeightClass.medium: 174.0, HeightClass.tall: 188.0};
const bookThicknessOf = {ThicknessClass.thin: 28.0, ThicknessClass.medium: 36.0, ThicknessClass.thick: 42.0};

double bookHeight(Book b) {
  final d = b.dims;
  if (d != null && d.height > 0) return d.height;
  final p = b.physical?.heightMm;
  if (p != null) return mm(p);
  return bookHeightOf[b.heightClass]!;
}

double bookThickness(Book b) {
  final d = b.dims;
  if (d != null && d.thickness > 0) return d.thickness;
  final pages = b.physical?.pages;
  if (pages != null) return spineDU(thicknessMm(pages));
  return bookThicknessOf[b.thicknessClass]!;
}

double frontWidth(Book b) {
  final d = b.dims;
  if (d != null && d.coverWidth > 0) return d.coverWidth;
  final w = b.physical?.widthMm;
  if (w != null) return mm(w);
  return (bookHeight(b) * b.coverAspectRatio).roundToDouble();
}

/// 책 크기 범위(mm). 줄 간격은 가장 큰 책으로 정한다(지금 앱 BOOK_SIZE_MM)
const bookSizeMm = (minH: 170.0, maxH: 225.0, minW: 100.0, maxW: 170.0);
final bookMaxH = mm(bookSizeMm.maxH);

/// 책 두께 범위(DU): 하한은 책등 제목이 들어가는 값, 상한은 가장 두꺼운 책 세 권을 쌓아도 줄 간격 안(지금 앱 BOOK_MIN_T·BOOK_MAX_T)
const bookMinT = 28.0;
final bookMaxT = spineDU(55);

// ---------- 배치 기하(지금 앱 geometry.ts) ----------
/// 선반 사용 폭(왼쪽 끝 = 0)과 서 있는 책 사이 틈
const shelfInnerLeft = 0.0;
const shelfGap = 0.0;
const shelfUsableW = usableW;

/// 움푹 파인 책장의 옆 벽(책처럼 기댈 수 있는 상자). 기댄 상대 id로도 쓴다
const wallL = '#wall-l';
const wallR = '#wall-r';
bool isWallId(String id) => id == wallL || id == wallR;

const maxSpin = 45.0;
const maxFrontSpin = 90.0;

/// 누운 책(더미)의 기본 깊이
const lyingBackZ = 40.0;

/// 책을 저절로 놓을 때 벽과 띄우는 거리, 세운 책 책등 줄과 벽 사이 최소 거리
final wallGapDu = mm(15);
final spineWallGap = mm(3);

/// 쌓을 때 위 책을 살짝 어긋나게(아래에서 위 순서)
const stackOffsetsBase = [0.0, 8.0, 3.0];

/// 기본 깊이: 세운 책·표지 책은 책 기준선(0), 눕힌 책은 조금 뒤. 벽과 가까운 깊은 책은 그만큼 앞으로
double defaultDepth(Book book, Pose pose) {
  final w = frontWidth(book);
  if (pose == Pose.front) return 0;
  if (pose == Pose.upright) return math.max(-shelfFront, math.min(0, shelfDepth - spineWallGap - w));
  return math.max(-shelfFront, math.min(lyingBackZ, shelfDepth - wallGapDu - w));
}

/// 수직축으로 돌린 눕힌 책의 축 정렬 폭(x)·깊이(z)
({double w, double d}) spunExtent(Book book, [double spin = 0]) {
  final l = bookHeight(book), w = frontWidth(book);
  final r = spin * math.pi / 180;
  return (w: (l * math.cos(r)).abs() + (w * math.sin(r)).abs(), d: (l * math.sin(r)).abs() + (w * math.cos(r)).abs());
}

/// (예전 저장본) 표지 책이 벽에 기댄 각
double wallPitch(Book book, double depth, [bool lean = false]) {
  if (!lean) return 0;
  final g = math.max(0.0, shelfDepth - (depth + bookThickness(book)));
  return math.asin(math.min(1.0, g / bookHeight(book))) * 180 / math.pi;
}

/// 쌓인 책의 왼쪽 어긋남(DU). 짧은 위 책은 아래 책의 오른쪽 끝에, 같은 길이는 맞춰, 더 긴 책은 정해진 어긋남
List<double> stackOffsets(List<Book> books, [List<double> spins = const []]) {
  final out = <double>[];
  for (var i = 0; i < books.length; i++) {
    if (i == 0) {
      out.add(0);
      continue;
    }
    final below = bookHeight(books[i - 1]);
    final d = below - bookHeight(books[i]);
    final si = i < spins.length ? spins[i] : 0.0, sp = i - 1 < spins.length ? spins[i - 1] : 0.0;
    final align = si.abs() + sp.abs() > 0.01 ? 0.6 : 1.0;
    out.add(d > 0.5 ? out[i - 1] + d * align : d >= -0.5 ? out[i - 1] : (i < stackOffsetsBase.length ? stackOffsetsBase[i] : 0));
  }
  return out;
}

// ---------- 실제 크기(지금 앱 jacket-proportions) ----------
bool _saneSize(double w, double h) => w >= 70 && h >= 90 && w / h >= 0.45 && w / h <= 1.3;

/// 높이·폭·두께에 함께 곱하는 배율: 범위 안의 책은 1, 밖의 책만 비율을 지켜 줄이거나 키운다
double bookSizeFactor(double w, double h) => math.min(
    bookSizeMm.maxH / h, math.min(bookSizeMm.maxW / w, math.max(1.0, math.max(bookSizeMm.minH / h, bookSizeMm.minW / w))));

/// 내 책의 실제 크기: 제공된 mm를 선반과 같은 축척으로. 두께는 책등 사진 비율이 있으면 그 값, 없으면 쪽수로
BookDims realDimensions(double widthMm, double heightMm, int pages, [double? spineRatio, double minSpine = bookMinT]) {
  final ok = _saneSize(widthMm, heightMm);
  final w = ok ? widthMm : 128.0, h = ok ? heightMm : 188.0;
  final f = bookSizeFactor(w, h);
  final height = mm(h * f);
  final thick = spineRatio != null && spineRatio != 0 ? height * spineRatio : mm(thicknessMm(pages)) * f;
  return BookDims(height, math.min(bookMaxT, math.max(minSpine, thick)), mm(w * f));
}
