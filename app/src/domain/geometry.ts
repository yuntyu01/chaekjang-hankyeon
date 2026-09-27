// 책 형상 계산. 모든 값은 설계 단위(DU, 기준 폭 390)이며 화면에서는 scale을 곱한다.
import { SHELF_ASSET } from './shelf-asset.generated';
import type { Book, BookPlacement, HeightClass, ThicknessClass, Tilt } from './types';

export const DESIGN_WIDTH = 390;

// 선반 표현 방식.
// 'drawn': 시안(정면 시점, 얇은 윗면, 직각 끝, 짧은 그림자)을 잰 치수로 코드가 그린다. 현재 기본.
// 'asset': assets/bookshelf/shelf-single.png. 받은 PNG가 위에서 내려다본 시점이라 시안과 맞지 않아 보류(시안 비율 PNG를 받으면 켠다).
export const SHELF_STYLE = 'drawn' as 'drawn' | 'asset';

// 선반 이미지(asset)는 원본 비율 그대로 SHELF_IMG_W 폭으로 설계 폭 가운데에 놓는다.
export const SHELF_IMG_W = 400;
export const SHELF_IMG_H = (SHELF_IMG_W * SHELF_ASSET.height) / SHELF_ASSET.width;
export const SHELF_IMG_X = (DESIGN_WIDTH - SHELF_IMG_W) / 2;

// 시안(941px → 390DU)에서 잰 선반 치수
const PLANK_TOP = 3.5; // 윗면
const PLANK_FRONT = 11.5; // 앞면

const asset = SHELF_STYLE === 'asset';
const USABLE_LEFT = asset ? SHELF_IMG_X + SHELF_ASSET.usableLeft * SHELF_IMG_W : 2;
const USABLE_W = asset ? (SHELF_ASSET.usableRight - SHELF_ASSET.usableLeft) * SHELF_IMG_W : DESIGN_WIDTH - 4;

export const SHELF = {
  sideMargin: USABLE_LEFT, // 장면 x=0의 화면 설계 좌표(drawn: 선반 판 왼쪽 끝)
  innerLeft: asset ? 1.5 : 20, // 시안: 첫 책이 판 끝에서 약 20DU 안쪽
  innerRight: asset ? 1.5 : 3,
  gap: 0, // 책 사이 기본 간격(시안: 서로 맞닿음)
  clearHeight: 178, // 장면 좌표의 바닥(y) 값
  // 줄 높이는 시안처럼 줄마다 그 줄에서 가장 큰 책(갈피 포함)에 맞춘다
  rowTopPad: 6, // 가장 큰 책 위 여백
  minClear: 110, // 빈 선반
  rowGap: 0, // 앞턱 아래 ~ 다음 줄
  plankTop: PLANK_TOP,
  plankFront: PLANK_FRONT,
  contact: asset ? SHELF_ASSET.contactY * SHELF_IMG_H : 0,
  lip: asset ? (SHELF_ASSET.frontTopY - SHELF_ASSET.contactY) * SHELF_IMG_H : PLANK_TOP, // 바닥선 ~ 앞턱 윗모서리
  below: asset ? (SHELF_ASSET.frontBottomY - SHELF_ASSET.contactY) * SHELF_IMG_H : PLANK_TOP + PLANK_FRONT, // 바닥선 ~ 앞턱 아래
};

export const SHELF_USABLE_WIDTH = USABLE_W - SHELF.innerLeft - SHELF.innerRight;

export const BOOK_HEIGHT: Record<HeightClass, number> = { short: 124, medium: 158, tall: 170 };
export const BOOK_THICKNESS: Record<ThicknessClass, number> = { thin: 28, medium: 36, thick: 42 };

// 눕힌 책의 윗면(표지 면) 깊이, 표지 전시의 옆면 두께.
export const TOP_FACE = 9;
export const FRONT_SIDE = 4;
// 쌓을 때 위 책을 살짝 어긋나게 둔다(아래에서 위 순서).
export const STACK_OFFSETS = [0, 8, 3];
export const MAX_STACK = 3;

export const TILTS: Tilt[] = [-7, 0, 7];

export function bookHeight(book: Book) {
  return book.dims?.height ?? BOOK_HEIGHT[book.heightClass];
}

export function bookThickness(book: Book) {
  return book.dims?.thickness ?? BOOK_THICKNESS[book.thicknessClass];
}

export function frontWidth(book: Book) {
  return book.dims?.coverWidth ?? Math.round(bookHeight(book) * book.coverAspectRatio);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

// 세운 책을 기울였을 때 차지하는 폭/높이. 바닥 모서리를 축으로 돌린다.
export function tiltedBounds(w: number, h: number, tilt: number) {
  const t = rad(Math.abs(tilt));
  return { width: w * Math.cos(t) + h * Math.sin(t), height: h * Math.cos(t) + w * Math.sin(t) };
}

// 한 권(쌓기 전)의 선반 점유 크기.
export function singleFootprint(book: Book, p: Pick<BookPlacement, 'pose' | 'tilt'>) {
  const h = bookHeight(book);
  const w = bookThickness(book);
  switch (p.pose) {
    case 'spine':
      if (p.tilt === 0) return { width: w, height: h };
      return tiltedBounds(w, h, p.tilt);
    case 'horizontal':
      return { width: h, height: w + TOP_FACE };
    case 'front':
      return { width: frontWidth(book) + FRONT_SIDE, height: h };
  }
}

// 쌓기 그룹: 폭은 (어긋남 포함) 가장 긴 책, 높이는 두께의 합.
export function stackFootprint(books: Book[]) {
  let width = 0;
  let height = TOP_FACE;
  books.forEach((b, i) => {
    width = Math.max(width, bookHeight(b) + (STACK_OFFSETS[i] ?? 0));
    height += bookThickness(b);
  });
  return { width, height };
}
