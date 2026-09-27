// 책과 배치의 기본 타입. 화면 픽셀이 아니라 선반·순서·쌓기 그룹으로 저장한다.

export type Pose = 'spine' | 'horizontal' | 'front';
export type Tilt = -7 | 0 | 7;
export type HeightClass = 'short' | 'medium' | 'tall';
export type ThicknessClass = 'thin' | 'medium' | 'thick';

// 개발용 샘플 그림 식별자. 실제 자산(coverArtUri/spineArtUri)이 들어오면 그쪽이 우선한다.
export type SceneId = 'moonlake' | 'forest' | 'sunset' | 'river' | 'nightpine' | 'meadow';
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
  // 앞표지 그림. 없으면 단색 표지 + 큰 모티프.
  scene?: SceneId;
  // 책등·가로 책등에 쓰는 작은 모티프.
  motif: MotifId;
  // 책등에 장면 그림을 크롭해서 쓸 때 가로 위치(0~1). 표지를 찌그러뜨리지 않는다.
  spineCropX?: number;
  // 제목/모티프 색. 없으면 배경색 밝기로 자동.
  inkColor?: string;
  accentColor?: string;
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
  finishedAt?: string; // YYYY-MM-DD
};

export type BookPlacement = {
  bookId: string;
  shelfId: string;
  order: number; // 선반 안에서 일반 책/쌓기 그룹의 순서
  pose: Pose;
  tilt: Tilt; // horizontal/front일 때 0
  stackId?: string; // 같은 그룹은 같은 shelfId와 order를 공유
  stackOrder?: number; // 아래에서 위 순서
};

export type Shelf = { id: string; order: number };

export type ShelfLayout = {
  version: 1;
  shelves: Shelf[];
  placements: BookPlacement[];
};
