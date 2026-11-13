// 책장 겉모습(스킨)과 손으로 정한 모양 값. app/src/scene-config/skin.ts를 옮긴 것(값은 커밋된 것 그대로).
// 이식 1단계에서는 고르기(저장된 스킨 읽기·바꾸기)를 빼고 기본값만 둔다. 셰이더 소스가 이 값을 박아 쓴다.
library;

/// 재질: 나무 · 칠 · 벽지
enum SkinMat { wood, paint, wallpaper }

class SkinPart {
  const SkinPart(this.name, this.color, this.mat);
  final String name;
  final int color; // 0xRRGGBB
  final SkinMat mat;
}

const plankSkins = <String, SkinPart>{
  'pine': SkinPart('밝은 나무', 0xF2DCC1, SkinMat.wood),
  'oak': SkinPart('오크', 0xD6B48C, SkinMat.wood),
  'walnut': SkinPart('호두나무', 0x8F6E55, SkinMat.wood),
  'white': SkinPart('흰 칠', 0xF5F3EE, SkinMat.paint),
};

const frameSkins = <String, SkinPart?>{
  'white': SkinPart('흰 벽', 0xECE7E4, SkinMat.paint),
  'pine': SkinPart('밝은 나무 벽', 0xF2D7BC, SkinMat.wood),
  'walnut': SkinPart('호두나무 벽', 0x8F6950, SkinMat.wood),
  'none': null,
};

// 벽 기본 색은 일반 화면 바탕과 같은 흰색(2026-11-05 사용자가 후보 중 고름)
const wallColor = 0xFFFFFF;
const wallSkins = <String, SkinPart>{
  'white': SkinPart('흰 벽', wallColor, SkinMat.paint),
  'paper': SkinPart('종이 벽지', 0xF6F4EE, SkinMat.wallpaper),
  'cream': SkinPart('크림', 0xF5EEE1, SkinMat.paint),
  'sage': SkinPart('세이지', 0xE3E8DD, SkinMat.paint),
};

class SkinChoice {
  const SkinChoice({required this.plank, required this.frame, required this.wall});
  final String plank;
  final String frame;
  final String wall;
}

const defaultSkin = SkinChoice(plank: 'pine', frame: 'white', wall: 'white');

final skinPlank = plankSkins[defaultSkin.plank]!;
final skinFrame = frameSkins[defaultSkin.frame];
final skinWall = wallSkins[defaultSkin.wall]!;

/// 움푹 파인 책장(틀이 있는 책장)인지. 빛 값과 셰이더 갈래가 이것으로 갈린다
final frameOn = skinFrame != null;

/// 손으로 정한 모양 값(mm·DU). dist 눈 거리, eyeY 눈 높이, thickMm 판 두께,
/// jointMm·jointK 안쪽 모서리 그늘, rimMm 테 반지름, coveMm 곡면, cornerMm 꼭지점 둥글기,
/// sideMm·sideK 옆면 그늘, plankSpec 판 윤기, cornerK 꼭지점 그늘, softMm 번짐, rimCorner 테 모서리, lipMm 벽 앞 거리
class Look {
  const Look();
  final double dist = 3300;
  final double eyeY = 150;
  final double thickMm = 19;
  final double jointMm = 8;
  final double jointK = 0.22;
  final double rimMm = 4;
  final double coveMm = 7;
  final double cornerMm = 9;
  final double sideMm = 26;
  final double sideK = 0.6;
  final double plankSpec = 2;
  final double cornerK = 0.22;
  final double softMm = 3;
  final double rimCorner = 1.5;
  final double lipMm = 4;
}

const look = Look();
