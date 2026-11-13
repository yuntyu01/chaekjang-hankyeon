// 책 한 권의 그림 재료(제목·재질 색·제목 색): 서재의 책 값에서 지금 앱 규칙으로 고른다(art.tsx faceOf·inkOf, binding-material bookTone).
library;

import 'binding_material.dart';
import 'color.dart';
import 'cover_url.dart';
import 'types.dart';

class BookLook {
  const BookLook(this.title, this.face, this.tone, this.ink, {this.titleTop, this.coverUri, this.ribbons = 0, this.ribbon});
  final String title;

  /// 장정 색(제목 색을 고르는 바탕), 재질 색(몸체·책등·표지와 빛 셰이더의 반사율), 제목 색(모두 #rrggbb)
  final String face;
  final String tone;
  final String ink;

  /// 장정 판짜기가 정한 책등 제목 위치(책 높이 비율, 없으면 자동)
  final double? titleTop;

  /// 표지 사진 주소(있으면 사진 책: 재질 색은 사진 채도로, 빛 셰이더는 회색 반사율 + 그림 겹)
  final String? coverUri;
  bool get photo => coverUri != null;

  /// 갈피 장 수(남긴 문장 수, 0이면 갈피 없음)와 갈피 색
  final int ribbons;
  final String? ribbon;
}

/// 장정 색 = 책 색, 재질 색 = 장정 띠 가운데 색(표지 사진 책은 사진 채도로), 제목 색 = 저장된 색 또는 자동(지금 앱 faceOf·bookTone·inkOf)
BookLook lookOf(Book b) {
  final face = jacketColor(hexOf(b.themeColor));
  final photo = b.coverArtUri != null;
  // 갈피 색: 고른 색 → 표지에서 뽑은 색 → 무채색이 아닌 책 색(지금 앱 toShelfBook art.ribbon)
  final theme = hexOf(b.themeColor);
  final accent = coverAccentOf(b.coverUri);
  final ribbon = (b.ribbonColor?.isNotEmpty ?? false)
      ? b.ribbonColor
      : (accent != null && accent.isNotEmpty)
          ? accent
          : (isNeutralColor(theme) ? null : theme);
  return BookLook(b.title, face, bookToneOf(face, photo: photo), displayInk(b.inkColor, face),
      titleTop: b.titleTop, coverUri: b.coverArtUri, ribbons: b.quotes, ribbon: ribbon);
}
