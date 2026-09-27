// 책 형상 계산. 모든 값은 설계 단위(DU, 기준 폭 390)이며 화면에서는 scale을 곱한다.
import { SHELF_ASSET } from './shelf-asset.generated';
import type { Book, BookPlacement, HeightClass, ThicknessClass, Tilt } from './types';

export const DESIGN_WIDTH = 390;

// 선반 이미지(assets/bookshelf/shelf-single.png)는 원본 비율 그대로 SHELF_IMG_W 폭으로, 설계 폭 가운데에 놓는다.
// 투명 여백은 화면 밖으로 나가도 되지만 보이는 판(앞턱) 양끝은 화면 안에 들어온다.
export const SHELF_IMG_W = 400;
export const SHELF_IMG_H = (SHELF_IMG_W * SHELF_ASSET.height) / SHELF_ASSET.width;
export const SHELF_IMG_X = (DESIGN_WIDTH - SHELF_IMG_W) / 2;
// 측정값(정규화)을 설계 단위로
const CONTACT_DU = SHELF_ASSET.contactY * SHELF_IMG_H; // 이미지 위쪽 ~ 책 밑면 기준선
const LIP_DU = (SHELF_ASSET.frontTopY - SHELF_ASSET.contactY) * SHELF_IMG_H; // 기준선 ~ 앞턱 윗모서리
const BELOW_DU = (SHELF_ASSET.frontBottomY - SHELF_ASSET.contactY) * SHELF_IMG_H; // 기준선 ~ 앞턱 아래
const USABLE_LEFT = SHELF_IMG_X + SHELF_ASSET.usableLeft * SHELF_IMG_W;
const USABLE_W = (SHELF_ASSET.usableRight - SHELF_ASSET.usableLeft) * SHELF_IMG_W;

export const SHELF = {
  sideMargin: USABLE_LEFT, // 장면 x=0(선반 사용 범위 왼쪽 끝)의 화면 설계 좌표
  innerLeft: 1.5, // 사용 범위 왼쪽 끝 ~ 첫 책
  innerRight: 1.5,
  gap: 0, // 책 사이 기본 간격(시안: 서로 맞닿음)
  clearHeight: 178, // 장면 좌표의 바닥(y) 값
  // 줄 간격(모든 줄 공통): 가장 큰 책·쌓임(≈175) + 갈피 돌출(7) + 위 여백(6)
  rowClear: 188,
  rowGap: 4, // 앞턱 아래 ~ 다음 줄 위 여백
  contact: CONTACT_DU,
  lip: LIP_DU,
  below: BELOW_DU,
  // 호환용(빈 선반 최소 높이 등)
  minClear: 110,
};

export const ROW_PITCH = SHELF.rowClear + BELOW_DU + SHELF.rowGap;
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
