// 책 한 권의 그림 재료(제목·재질 색·제목 색): 서재의 책 값에서 지금 앱 규칙으로 고른다(art.tsx faceOf·inkOf, binding-material bookTone).
library;

import 'binding_material.dart';
import 'color.dart';
import 'types.dart';

class BookLook {
  const BookLook(this.title, this.face, this.tone, this.ink, {this.titleTop});
  final String title;

  /// 장정 색(제목 색을 고르는 바탕), 재질 색(몸체·책등·표지와 빛 셰이더의 반사율), 제목 색(모두 #rrggbb)
  final String face;
  final String tone;
  final String ink;

  /// 장정 판짜기가 정한 책등 제목 위치(책 높이 비율, 없으면 자동)
  final double? titleTop;
}

/// 표지 사진이 없는 책(벡터 장정): 장정 색 = 책 색, 재질 색 = 장정 띠 가운데 색, 제목 색 = 저장된 색 또는 자동
BookLook lookOf(Book b) {
  final face = jacketColor(hexOf(b.themeColor));
  return BookLook(b.title, face, bookToneOf(face), displayInk(b.inkColor, face));
}
