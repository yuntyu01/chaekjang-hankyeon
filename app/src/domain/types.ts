// 책과 배치의 기본 타입. 화면 픽셀이 아니라 선반·순서·쌓기 그룹으로 저장한다.

export type Pose = 'spine' | 'horizontal' | 'front';
export type Tilt = -7 | 0 | 7;
export type HeightClass = 'short' | 'medium' | 'tall';
export type ThicknessClass = 'thin' | 'medium' | 'thick';

// 개발용 샘플 그림 식별자. 실제 자산(coverArtUri/spineArtUri)이 들어오면 그쪽이 우선한다.
// MotifId는 개발용 SVG 9종, 책에는 모티프 슬롯 id(motif-slots.ts, 30종)를 저장한다.
export type MotifId =
  | 'sprig'
  | 'leaf'
  | 'cotton'
  | 'moon'
  | 'star'
  | 'wave'
  | 'flower'
  | 'pine'
  | 'bud';

export type BookArt = {
  // 책등·가로 책등에 쓰는 작은 모티프(모티프 슬롯 id).
  motif: string;
  // 제목/모티프 색. 없으면 배경색 밝기로 자동.
  inkColor?: string;
  accentColor?: string;
  // 갈피(가름끈) 색. 저장된 문장이 있는 책(Book.quotes > 0)에만 표시된다.
  ribbon?: string;
  // 장정에 포함된 가름끈. 문장 기록 수를 꾸며내지 않고 장식만 표시한다.
  ribbonVisible?: boolean;
  ribbonCount?: number; // 보이는 갈피 장 수(예시 책장: 시안 그대로). 없으면 남긴 갈피 수(quotes)
  // 장정별 인쇄 위치. 없으면 제목 길이에 맞춘 자동 조판을 사용한다.
  titleTop?: number;
  motifScale?: number;
  motifBottom?: number;
  plainCover?: boolean;
  // 재장정 정면: 예시 일러스트 대신 바탕색 단색 + 종이 결 + 상단 제목 + 큰 모티프 하나(실제 표지·그림을 쓰지 않는다)
  vectorCover?: boolean;
  // 장정 재질(표지·책등·판). 없으면 무광 종이
  material?: BindingMaterial;
};

// 장정 재질: 무광 종이 · 천 · 코팅지(모두 유전체, 표면 거칠기와 결·미세 높이만 다르다: ui/lighting materials)
export type BindingMaterial = 'paper' | 'cloth' | 'coated';
export const BINDING_MATERIALS: BindingMaterial[] = ['paper', 'cloth', 'coated'];

// 이미지 자산: 앱 번들(require 결과 숫자) 또는 원격 URI
export type ImageSource = number | { uri: string };

// 실제 책의 물리 치수(판형·쪽수). 화면 크기는 여기서 계산한다(geometry.ts).
export type Physical = {
  heightMm: number; // 판형 세로
  widthMm: number; // 판형 가로(앞표지 폭)
  pages: number; // 쪽수 → 두께
};

// 코드로 그리는 몸체에 입힐 평평한 재료
export type BodyArt = import('./body-art.generated').BodyArt;
export type CoverArt = import('./body-art.generated').CoverArt & {
  sourceRect?: { x: number; y: number; width: number; height: number };
  printedTitle?: string;
  titleRect?: { x: number; y: number; width: number; height: number; cleanX: number };
  // 기본 정면 장정 그림(cover-artworks): 제목 색은 ink 그대로, 판형이 넓으면 위에서 focusY 몫만큼 자른다
  artworkId?: string;
  focusY?: number;
};

export type Book = {
  id: string;
  title: string;
  author?: string;
  originalCoverUri?: string; // 실제 도서 표지(상세보기 전용)
  coverArtUri?: string; // 앱 재장정 표지 그림 슬롯
  spineArtUri?: string; // 앱 재장정 책등 그림 슬롯
  themeColor: string;
  heightClass: HeightClass;
  thicknessClass: ThicknessClass;
  coverAspectRatio: number; // 너비/높이
  art: BookArt;
  publisher?: string;
  publishedAt?: string; // 출간 YYYY-MM 또는 YYYY-MM-DD
  startedAt?: string; // 읽기 시작 YYYY-MM-DD
  finishedAt?: string; // YYYY-MM-DD
  quotes?: number; // 저장된 문장 수. 갈피 표시와 연결(0이면 갈피 없음)
  // 실제 판형·쪽수. 있으면 등급 대신 이걸로 크기를 정한다.
  physical?: Physical;
  // 등급·판형 대신 쓰는 직접 치수(DU). 테스트나 특수한 경우.
  dims?: { height?: number; thickness?: number; coverWidth?: number };
  // 코드 몸체 재료: 책등 색·모티프(없으면 themeColor + art.motif 슬롯의 SVG)
  body?: BodyArt;
  // 표지 전시용 평평한 그림(없으면 themeColor + 모티프)
  cover?: CoverArt;
};

export type BookPlacement = {
  bookId: string;
  shelfId: string;
  order: number; // 선반 안에서 일반 책/쌓기 그룹의 순서
  pose: Pose;
  tilt: Tilt; // horizontal/front일 때 0
  stackId?: string; // 같은 그룹은 같은 shelfId와 order를 공유
  stackOrder?: number; // 아래에서 위 순서
  // 기준 선반 좌표(DU, 선반 사용 범위 왼쪽 끝 = 0)에서의 자리 왼쪽 끝. 사용자가 둔 위치와 빈틈을 그대로 보존한다.
  // 화면에서는 선반과 함께 같은 비율로 확대·축소된다. 쌓기 그룹은 모든 멤버가 같은 값.
  pos?: number;
  // 기대기 결과(최종 각도, 도, 부호=방향)와 기댄 상대. 상대가 바뀌거나 없어지면 다시 계산한다.
  lean?: { angle: number; on: string };
  // 선반 공간 깊이(DU): 책이 차지하는 축 정렬 상자의 앞면 z(0 = 책 줄 앞선, 벽 쪽이 +). 없으면 자세별 기본 깊이.
  depth?: number;
  // 수직축 회전(도, + = 오른쪽 끝이 벽 쪽으로). 눕힌 책은 비스듬히 놓기, 표지 책은 좌우 돌리기. 세운 책은 0.
  spin?: number;
  // 쌓인 위 책: 자동 자리(아래 책 위 가운데 쪽)에서 사용자가 옮긴 가로·깊이 어긋남(DU). 받침 안에서만. 아래 책을 옮겨도 그대로 따라간다.
  stackDx?: number;
  stackDz?: number;
  // (예전 저장본) 표지 전시 책이 벽에 기대 있는지. 지금은 pitch로 저장한다.
  wallLean?: boolean;
  // 뒤로 젖힘(도, 0 = 똑바로, 90 = 뒤로 넘어져 바닥에 놓임). 중간 각도는 벽이나 다른 책이 받친다.
  // 표지 책의 좌우 돌리기는 spin(도)을 같이 쓴다.
  pitch?: number;
  // 저장 시 기록하는 정규화 위치(선반 사용 폭 대비 왼쪽 끝, 0~1). 복원의 기준은 order이고 이 값은 참고·동기화용.
  x?: number;
};

export type Shelf = { id: string; order: number };

// v2: 선반에 두지 않은 책은 서랍(drawer)에 순서대로 보관한다. 모든 책은 선반 또는 서랍 중 한 곳에만 있다.
export type ShelfLayout = {
  version: 2;
  shelves: Shelf[];
  placements: BookPlacement[];
  drawer: string[];
};

export type ShelfLayoutV1 = {
  version: 1;
  shelves: Shelf[];
  placements: BookPlacement[];
};
