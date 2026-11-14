// 책 한 권의 그림 재료(제목·재질 색·제목 색): 서재의 책 값에서 지금 앱 규칙으로 고른다(art.tsx faceOf·inkOf, binding-material bookTone).
library;

import 'binding_material.dart';
import 'book_light.dart' show pictureAlbedo;
import 'color.dart';
import 'cover_url.dart';
import 'types.dart';
import 'vec3.dart' show C3, linearOf;

class BookLook {
  const BookLook(this.title, this.face, this.tone, this.ink, {this.titleTop, this.coverUri, this.ribbons = 0, this.ribbon, this.material, this.artwork, this.reference, this.plainCover = false});
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

  /// 장정 재질(없으면 고운 종이): 빛 셰이더의 표면(지금 앱 BookLight material)
  final String? material;

  /// 기본 정면 장정 그림 id(있으면 앞표지는 그 그림 + 그림의 제목 색)
  final String? artwork;

  /// 시안 그림 표지(새 서재 예시 책, 지금 앱 ReferenceCover)와 앞표지에 제목을 쓰지 않는지
  final String? reference;
  final bool plainCover;

  /// 그림 책(표지 사진 또는 정면 장정 그림): 빛 셰이더가 그림 겹으로 그린다(지금 앱 bookLightRef picture)
  bool get picture => photo || artwork != null || reference != null;

  /// 빛 계산 기준 색: 그림 책은 그림이 색을 가지므로 중립 회색(사진 표지와 같은 규칙).
  /// 지금 앱은 기본 그림 표지를 책 색 기준으로 계산해 그림이 책 색에 물들었다(초록 책 → 청록 그림). 여기서는 고쳐 옮긴다
  C3 get lightAlbedo => picture ? pictureAlbedo : linearOf(rgbOf(tone));
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
      titleTop: b.titleTop, coverUri: b.coverArtUri, ribbons: b.quotes, ribbon: ribbon, material: b.material, artwork: b.coverArtId, reference: b.reference, plainCover: b.plainCover);
}
