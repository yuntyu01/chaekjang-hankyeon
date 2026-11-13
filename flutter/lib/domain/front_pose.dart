// 표지 전시 책의 자세(뒤로 젖힘·좌우 돌리기)의 축 정렬 범위. 지금 앱 domain/front-pose.ts의 frontExtent
library;

import 'dart:math' as math;

import 'book3.dart';
import 'book3_physics.dart';
import 'geometry.dart';
import 'types.dart';

({double x0, double x1, double y1, double z0, double z1}) frontExtent(Dims dims, [double pitch = 0, double spin = 0]) {
  final cs = corners(frontBook3('', dims, 0, 0, pitch, spin));
  var x0 = double.infinity, x1 = double.negativeInfinity, y1 = double.negativeInfinity;
  var z0 = double.infinity, z1 = double.negativeInfinity;
  for (final c in cs) {
    x0 = math.min(x0, c.x);
    x1 = math.max(x1, c.x);
    y1 = math.max(y1, c.y);
    z0 = math.min(z0, c.z);
    z1 = math.max(z1, c.z);
  }
  return (x0: x0, x1: x1, y1: y1, z0: z0, z1: z1);
}

/// 표지 전시 책의 상자 치수(책 좌표 T·H·W)
Dims frontDims(Book book) => Dims(bookThickness(book), bookHeight(book), frontWidth(book));

({double x0, double x1, double y1, double z0, double z1}) frontExt(Book book, {double? pitch, double? spin}) =>
    frontExtent(frontDims(book), pitch ?? 0, spin ?? 0);
