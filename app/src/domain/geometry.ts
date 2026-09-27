// 책 형상 계산. 모든 값은 설계 단위(DU, 기준 폭 390)이며 화면에서는 scale을 곱한다.
import type { Book, BookPlacement, HeightClass, ThicknessClass, Tilt } from './types';

export const DESIGN_WIDTH = 390;

export const SHELF = {
  sideMargin: 12, // 화면 끝 ~ 선반 판
  innerPadding: 10, // 선반 판 끝 ~ 첫 책
  gap: 3, // 책 사이 기본 간격
  clearHeight: 178, // 선반 위 책이 놓이는 공간
  plankTop: 7, // 선반 윗면(깊이)
  plankFront: 13, // 선반 앞면
  rowGap: 16, // 선반 판 아래 ~ 다음 선반 공간
  rowTopPad: 8, // 선반 공간 위 여백
};

export const SHELF_USABLE_WIDTH = DESIGN_WIDTH - SHELF.sideMargin * 2 - SHELF.innerPadding * 2;

export const BOOK_HEIGHT: Record<HeightClass, number> = { short: 130, medium: 148, tall: 166 };
export const BOOK_THICKNESS: Record<ThicknessClass, number> = { thin: 27, medium: 34, thick: 42 };

// 눕힌 책의 윗면(표지 면) 깊이, 표지 전시의 옆면 두께.
export const TOP_FACE = 6;
export const FRONT_SIDE = 5;
// 쌓을 때 위 책을 살짝 어긋나게 둔다(아래에서 위 순서).
export const STACK_OFFSETS = [0, 8, 3];
export const MAX_STACK = 3;

export const TILTS: Tilt[] = [-7, 0, 7];

export function bookHeight(book: Book) {
  return BOOK_HEIGHT[book.heightClass];
}

export function bookThickness(book: Book) {
  return BOOK_THICKNESS[book.thicknessClass];
}

export function frontWidth(book: Book) {
  return Math.round(bookHeight(book) * book.coverAspectRatio);
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
