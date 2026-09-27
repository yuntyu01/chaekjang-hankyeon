// 책과 배치의 기본 타입. 화면 픽셀이 아니라 선반·순서·쌓기 그룹으로 저장한다.

export type Pose = 'spine' | 'horizontal' | 'front';
export type Tilt = -7 | 0 | 7;
export type HeightClass = 'short' | 'medium' | 'tall';
export type ThicknessClass = 'thin' | 'medium' | 'thick';

// 개발용 샘플 그림 식별자. 실제 자산(coverArtUri/spineArtUri)이 들어오면 그쪽이 우선한다.
// MotifId는 개발용 SVG 9종, 책에는 모티프 슬롯 id(motif-slots.ts, 30종)를 저장한다.
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
  // 책등·가로 책등에 쓰는 작은 모티프(모티프 슬롯 id).
  motif: string;
  // 책등에 장면 그림을 크롭해서 쓸 때 가로 위치(0~1). 표지를 찌그러뜨리지 않는다.
  spineCropX?: number;
  // 제목/모티프 색. 없으면 배경색 밝기로 자동.
  inkColor?: string;
  accentColor?: string;
  // 갈피(가름끈) 색. 저장된 문장이 있는 책(Book.quotes > 0)에만 표시된다.
  ribbon?: string;
};

// 이미지 자산: 앱 번들(require 결과 숫자) 또는 원격 URI
export type ImageSource = number | { uri: string };

// Development samples use individual, clipped regions of the reference artwork.
// The transform removes the source lean; placement applies the live tilt again.
export type ReferenceArt = {
  pose: Pose;
  width: number;
  height: number;
  outline: { x: number; y: number }[];
  matrix: [number, number, number, number, number, number];
};

// 시안에서 뽑은 개발용 샘플 장정(scripts/extract-reference-assets.py). 제목은 지운 그림이고 앱이 다시 조판한다.
export type SampleArt = {
  kind: 'spine' | 'cover' | 'horizontal';
  w: number; // DU. spine=두께, cover=표지 폭(옆면 포함), horizontal=길이
  h: number; // DU. spine/cover=높이, horizontal=두께
  color: string;
  ink: string;
  titleSize: number;
  titleLine?: number; // 줄 간격(배수)
  titleTop?: number;
  titleCx?: number;
  titleLeft?: number;
  titleCy?: number;
  topFace?: string;
  topFaceH?: number;
  topImage?: ImageSource; // 가로 책 윗면 그림
  coverLines?: string;
  // 책등 그림 위쪽을 잘라낸 높이(DU)와 그 자리를 다시 그릴 색·폭(비율). 시안 윗면의 깎인 모서리에 벽이 섞여서.
  cap?: number;
  capColor?: string;
  capW?: number;
  // 키를 늘릴 때 늘려도 되는 빈 바탕 띠(그림 높이 비율). 그림·모티프는 원래 비율을 유지한다.
  band?: [number, number];
  image: ImageSource;
  motif?: ImageSource;
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
  quotes?: number; // 저장된 문장 수. 갈피 표시와 연결(0이면 갈피 없음)
  // 등급 대신 쓰는 정확한 치수(DU). 온보딩 샘플처럼 실제 판형을 아는 경우.
  dims?: { height?: number; thickness?: number; coverWidth?: number };
  // 모티프 그림 자산(투명 PNG). 없으면 art.motif 슬롯의 개발용 SVG.
  motifImage?: ImageSource;
  sample?: SampleArt;
  // 코드로 그리는 몸체에 입힐 재료(색·모티프). 있으면 잘라 붙인 예시 그림(reference·sample) 대신 쓴다.
  body?: import('./body-art.generated').BodyArt;
  reference?: ReferenceArt;
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
