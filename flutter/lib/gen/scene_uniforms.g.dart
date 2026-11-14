// 장면을 그리는 데 쓰는 값(재질 색 DESIGN · 대표 자리 빛 EREF · 반사광 SREF · 표면 재질 materials · 보이는 색 surfaces).
// tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것. 빛 설정이 바뀌면 다시 만들어야 한다
library;

import '../domain/vec3.dart';
import '../scene_config/skin.dart' show skinLight;

/// 표면 재질 uniform(거칠기·법선 무늬·반사율 무늬·무늬 크기)
class Mat {
  const Mat(this.rough, this.bump, this.grain, this.gsize);
  final List<double> rough;
  final List<double> bump;
  final List<double> grain;
  final List<double> gsize;
}

/// 한 부품: 재질 색(반사율) · 대표 자리 빛 · 반사광 · 표면 · 보이는 색
class Surface {
  const Surface(this.albedo, this.eref, this.sref, this.mat, this.color);
  final C3 albedo;
  final C3 eref;
  final C3 sref;
  final Mat mat;
  final int color;
}

/// 책 장정 하나: 대표 자리 빛 · 반사광 · 거울 반사 세기 · 장정 표면 · 속지 표면 · 속지 반사광
class BookSurface {
  const BookSurface(this.eref, this.sref, this.specK, this.mat, this.pages, this.srefPaper);
  final C3 eref;
  final C3 sref;
  final double specK;
  final Mat mat;
  final Mat pages;
  final C3 srefPaper;
}

// 스킨마다 다른 값(지금 스킨 scene_config/skin.dart skinLight에서 읽는다. 표는 skin_lights.g.dart)
BookSurface get bookFine => skinLight.bookFine;

/// 장정 재질의 책 표면(없거나 모르는 재질이면 고운 종이)
BookSurface bookSurfaceOf(String? material) => skinLight.books[material ?? 'fine'] ?? skinLight.bookFine;

/// 갈피 탭 종이(무광 종이): 대표 자리 빛 · 반사광 · 표면
({C3 eref, C3 sref, Mat mat}) get tabPaper => skinLight.tabPaper;

Surface get wallSurface => skinLight.wall;
Surface get plankSurface => skinLight.plank;
Surface get frameSurface => skinLight.frame;
