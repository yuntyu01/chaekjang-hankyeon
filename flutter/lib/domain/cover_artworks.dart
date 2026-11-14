// 기본 정면 장정 그림(지금 앱 domain/cover-artworks.ts, 2026-10-10): 사용자가 여러 책에 골라 입히는 공통 표지 그림. 제목 없는 평면 풍경이라
// 제목은 기존 조판으로 위 여백에 얹는다. 앱에는 720×1080(표지)과 180×270(고르기 썸네일) JPEG. id는 저장·백업·동기화에 쓰는 고정 값이다.
// ink: 제목이 놓이는 하늘 띠의 평균 밝기로 정한 제목 색(dark 따뜻한 먹색, light 아이보리: 달빛 호수만).
// focusY: 책 판형이 그림(2:3)보다 넓어 위아래가 잘릴 때 위에서 자르는 몫(0.35: 위 제목 여백과 아래 풍경을 함께 남긴다)
library;

typedef CoverArtwork = ({String id, String name, String ink});

const coverArtworks = <CoverArtwork>[
  (id: 'forest-path', name: '숲길', ink: 'dark'),
  (id: 'sunset-sea', name: '노을 바다', ink: 'dark'),
  (id: 'moon-lake', name: '달빛 호수', ink: 'light'),
  (id: 'autumn-field', name: '가을 들판', ink: 'dark'),
  (id: 'flower-garden', name: '꽃 정원', ink: 'dark'),
  (id: 'winter-forest', name: '겨울 숲', ink: 'dark'),
];

/// 제목 색(2026-11-01 책 글씨 색: 흰색·회색빛 검정)
const artworkInk = {'dark': '#3A3B3D', 'light': '#FFFFFF'};

/// 제목 칸 위 끝(표지 높이에 대한 몫): 그림 하늘 여백 안
const artworkTitleTop = 0.11;
const artworkFocusY = 0.35;

bool isCoverArtworkId(String? id) => id != null && coverArtworks.any((a) => a.id == id);

CoverArtwork? coverArtwork(String? id) => coverArtworks.where((a) => a.id == id).firstOrNull;

String artworkAsset(String id) => 'assets/covers/artworks/$id.jpg';
String artworkThumb(String id) => 'assets/covers/artworks/$id-thumb.jpg';

/// 그림(iw×ih)을 면(w×h)에 늘이지 않고 채우는 자리: 위아래가 잘리면 위에서 focusY만큼
({double x, double y, double width, double height}) focusedRect(double iw, double ih, double w, double h, double focusY) {
  final k = w / iw > h / ih ? w / iw : h / ih;
  final dw = iw * k, dh = ih * k;
  return (x: (w - dw) / 2, y: (h - dh) * focusY, width: dw, height: dh);
}
