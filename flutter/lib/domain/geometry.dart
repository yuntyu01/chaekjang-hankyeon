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
  final p = b.physical?.heightMm;
  if (p != null) return mm(p);
  return bookHeightOf[b.heightClass]!;
}

double bookThickness(Book b) {
  final pages = b.physical?.pages;
  if (pages != null) return spineDU(thicknessMm(pages));
  return bookThicknessOf[b.thicknessClass]!;
}

double frontWidth(Book b) {
  final w = b.physical?.widthMm;
  if (w != null) return mm(w);
  return (bookHeight(b) * b.coverAspectRatio).roundToDouble();
}

/// 책 크기 범위(mm). 줄 간격은 가장 큰 책으로 정한다(지금 앱 BOOK_SIZE_MM)
const bookSizeMm = (minH: 170.0, maxH: 225.0, minW: 100.0, maxW: 170.0);
final bookMaxH = mm(bookSizeMm.maxH);
