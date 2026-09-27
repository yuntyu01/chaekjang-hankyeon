// 책 형상 계산. 모든 값은 설계 단위(DU, 기준 폭 390)이며 화면에서는 scale을 곱한다.
import { SHELF_ASSET } from './shelf-asset.generated';
import type { Book, BookPlacement, HeightClass, ThicknessClass, Tilt } from './types';

export const DESIGN_WIDTH = 390;

// 선반 표현 방식.
// 'asset': assets/bookshelf/shelf-plank.png(받은 v4에서 바깥 그림자를 분리한 나무판만). 그림자는 ShelfShadow가 그린다. 기본.
// 'drawn': 코드로 그리는 판(PNG가 없을 때의 대체).
export const SHELF_STYLE = 'asset' as 'drawn' | 'asset';

// 선반 이미지는 원본 비율 그대로. 폭은 투명 여백이 아니라 나무판 바운딩 박스(plankLeft~plankRight)가
// 화면 좌우 PLANK_INSET 여백에 맞도록 계산하고, 이미지 오프셋도 그에 맞춘다(양 끝이 보이게).
export const PLANK_INSET = 2;
export const SHELF_IMG_W = (DESIGN_WIDTH - PLANK_INSET * 2) / (SHELF_ASSET.plankRight - SHELF_ASSET.plankLeft);
// 선반 두께: 윗면·앞면을 세로로 THICKNESS배(나무판 PNG는 결이 가로라 세로로 늘려도 티가 나지 않는다)
export const SHELF_THICKNESS = 0.94;
export const SHELF_IMG_H = ((SHELF_IMG_W * SHELF_ASSET.height) / SHELF_ASSET.width) * SHELF_THICKNESS;
export const SHELF_IMG_X = PLANK_INSET - SHELF_ASSET.plankLeft * SHELF_IMG_W;

// 시안(941px → 390DU)에서 잰 선반 치수
const PLANK_TOP = 6; // 윗면: 책 앞으로 또렷하게 보이게 시안보다 깊게
const PLANK_FRONT = 11.5; // 앞면

const asset = SHELF_STYLE === 'asset';
const USABLE_LEFT = 12;
const USABLE_W = DESIGN_WIDTH - USABLE_LEFT * 2;
// 0 = rear edge of the top surface, 1 = front lip. Seat the book near the
// back, leaving a visible strip of wood in front of its lowest corner.
export const BOOK_SHELF_DEPTH = 0.28;
const CONTACT_Y = SHELF_ASSET.plankTopY + (SHELF_ASSET.frontTopY - SHELF_ASSET.plankTopY) * BOOK_SHELF_DEPTH;

export const SHELF = {
  sideMargin: USABLE_LEFT, // 장면 x=0의 화면 설계 좌표(drawn: 선반 판 왼쪽 끝)
  innerLeft: 0,
  innerRight: 0,
  gap: 0, // 책 사이 기본 간격(시안: 서로 맞닿음)
  clearHeight: 178, // 장면 좌표의 바닥(y) 값
  rowGap: 0, // 앞턱 아래 ~ 다음 줄
  rowTopPad: 12,
  minClear: 110,
  plankTop: PLANK_TOP,
  plankFront: PLANK_FRONT,
  contact: asset ? CONTACT_Y * SHELF_IMG_H : 0,
  lip: asset ? (SHELF_ASSET.frontTopY - CONTACT_Y) * SHELF_IMG_H : PLANK_TOP,
  below: asset ? (SHELF_ASSET.frontBottomY - CONTACT_Y) * SHELF_IMG_H : PLANK_TOP + PLANK_FRONT,
};

export const SHELF_USABLE_WIDTH = USABLE_W - SHELF.innerLeft - SHELF.innerRight;
// 개별 치수가 없는 등록 도서의 기본 크기
export const BOOK_HEIGHT: Record<HeightClass, number> = { short: 136, medium: 174, tall: 188 };
export const BOOK_THICKNESS: Record<ThicknessClass, number> = { thin: 28, medium: 36, thick: 42 };

// 눕힌 책의 윗면(표지 면) 깊이, 표지 전시의 옆면 두께.
export const TOP_FACE = 9;
export const FRONT_SIDE = 4;
// 쌓을 때 위 책을 살짝 어긋나게 둔다(아래에서 위 순서).
export const STACK_OFFSETS = [0, 8, 3];
export const MAX_STACK = 3;
export const HOME_SHELF_COUNT = 3;

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
  if (book.reference?.pose === p.pose && !book.coverArtUri && !book.spineArtUri) {
    const poly = visibleBookOutline(book, p);
    return { width: Math.max(...poly.map((q) => q.x)), height: -Math.min(...poly.map((q) => q.y)) };
  }
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

// Actual visible contour, normalized to left x=0 and floor y=0.
// Shared by packing and painting so tilted books can lean against neighbours.
export function visibleBookOutline(book: Book, p: Pick<BookPlacement, 'pose' | 'tilt'>) {
  const art = book.reference;
  const h = p.pose === 'horizontal' ? bookThickness(book) + TOP_FACE : bookHeight(book);
  const w = p.pose === 'horizontal' ? bookHeight(book) : p.pose === 'front' ? frontWidth(book) + FRONT_SIDE : bookThickness(book);
  const points = art?.pose === p.pose && !book.coverArtUri && !book.spineArtUri
    ? art.outline : [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const t = rad(p.pose === 'spine' ? p.tilt : 0);
  const turned = points.map((q) => ({ x: q.x * Math.cos(t) - q.y * Math.sin(t), y: q.x * Math.sin(t) + q.y * Math.cos(t) }));
  const x0 = Math.min(...turned.map((q) => q.x)), floor = Math.max(...turned.map((q) => q.y));
  return turned.map((q) => ({ x: q.x - x0, y: q.y - floor }));
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
