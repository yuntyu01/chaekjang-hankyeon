// 화면 폭 → 설계 단위 배율과 선반 줄 위치. 지금 앱 ui/shelf/metrics.ts를 옮긴 것.
// 넓은 화면은 520px 폭에서 멈추고 가운데 정렬한다. 줄 간격은 3D 값이라(판 윗면 → 윗선반 아랫면) 모든 줄이 같고,
// 화면 위치는 카메라가 투영만 바꾼다.
library;

import 'dart:math' as math;

import '../domain/camera.dart';
import '../domain/geometry.dart';

const maxLayoutWidth = 520.0;

/// 첫 줄 위 최소 여백
const contentTop = 10.0;

class ShelfMetrics {
  const ShelfMetrics(this.scale, this.originX);
  final double scale;
  final double originX;
}

ShelfMetrics makeMetrics(double windowWidth) {
  final width = math.min(windowWidth, maxLayoutWidth);
  final scale = width / (designWidth + 2 * scenePad);
  return ShelfMetrics(scale, (windowWidth - width) / 2 + scenePad * scale);
}

/// 줄 간격에 잡아 두는 갈피 높이(가장 긴 장)
const ribbonOut = 15.0;

/// 가장 큰 책 + 갈피 머리 위 여유(DU)
const rowClearance = 10.0;

/// 3D 줄 간격(판 윗면 → 윗선반 아랫면, DU): 어떤 책을 꽂아도 모든 줄이 같다
final rowSpace = bookMaxH + ribbonOut + rowClearance;

/// 헤더 아래 빈 공간 비율(1 = 줄들을 가운데 정렬)
const topGap = 0.34;

/// 줄 하나의 화면 자리(콘텐츠 px): 칸 위 끝, 칸 위 끝 → 책 기준선 거리(DU), 3D 줄 간격, 칸 높이, 책 기준선 y
class RowGeom {
  const RowGeom(this.top, this.clear, this.space, this.height, this.baseline);
  final double top;
  final double clear;
  final double space;
  final double height;
  final double baseline;
}

/// 줄 칸의 기준 보기는 기본 보기 각이다: 칸 경계 = 윗선반 앞면 아래 모서리를 기본 보기로 본 자리.
/// 줄 기준선 사이 화면 거리가 3D 줄 간격과 정확히 같다(다른 줄로 옮겨 가는 책이 튀지 않게)
/// real: 화면 가운데에 놓을 때 세는 줄 수(잠긴 칸은 빼고, 지금 앱은 진짜 선반만 세고 잠긴 칸은 그 아래 이어 붙인다). 없으면 n
List<RowGeom> computeRows(int n, double scale, {double viewportHeight = 0, double bottomInset = 0, int? real}) {
  final height = (rowSpace + shelfThick) * scale;
  final clear = rowSpace - shelfFront * kyOf(viewPitchMin);
  var top = math.max(contentTop, (viewportHeight - bottomInset - height * (real ?? n)) / 2 * topGap);
  return [
    for (var i = 0; i < n; i++) RowGeom(top + i * height, clear, rowSpace, height, top + i * height + clear * scale),
  ];
}
