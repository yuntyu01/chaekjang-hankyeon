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
export const BOOK_SHELF_DEPTH = 0.42; // 책을 선반 앞쪽으로 조금 당김(앞에 남는 나무 약 7.6DU)
const CONTACT_Y = SHELF_ASSET.plankTopY + (SHELF_ASSET.frontTopY - SHELF_ASSET.plankTopY) * BOOK_SHELF_DEPTH;

export const SHELF = {
  sideMargin: USABLE_LEFT, // 장면 x=0의 화면 설계 좌표(drawn: 선반 판 왼쪽 끝)
  innerLeft: 0,
  innerRight: 0,
  gap: 0, // 책 사이 기본 간격(시안: 서로 맞닿음)
  clearHeight: 178, // 장면 좌표의 바닥(y) 값
  rowGap: 0, // 앞턱 아래 ~ 다음 줄
  rowTopPad: 2, // 가장 높은 책(갈피 포함) 위 여백: 시안처럼 위 선반 바로 밑까지
  minClear: 110,
  plankTop: PLANK_TOP,
  plankFront: PLANK_FRONT,
  contact: asset ? CONTACT_Y * SHELF_IMG_H : 0,
  lip: asset ? (SHELF_ASSET.frontTopY - CONTACT_Y) * SHELF_IMG_H : PLANK_TOP,
  below: asset ? (SHELF_ASSET.frontBottomY - CONTACT_Y) * SHELF_IMG_H : PLANK_TOP + PLANK_FRONT,
};

export const SHELF_USABLE_WIDTH = USABLE_W - SHELF.innerLeft - SHELF.innerRight;

// ---------- 실제 단위 ----------
// 선반 안쪽 길이를 480mm로 고정하고, 화면에서는 이 길이가 사용 폭에 맞도록 비율만 바꾼다.
// 어느 기기에서든 한 선반에 들어가는 책 수가 같다.
export const SHELF_LENGTH_MM = 480;
export const DU_PER_MM = SHELF_USABLE_WIDTH / SHELF_LENGTH_MM;
// 두께: 얇은 책(10mm 이하)도 세로 제목이 들어가게 최소 22DU로 두고(상자 모델은 앞면 전체가 책등이라 제목 폭이 넉넉하다),
// 그보다 두꺼운 만큼은 실제 두께 차이 그대로 늘린다(실제 비율 1.0배). 300쪽 ≈ 29DU, 450쪽 ≈ 36DU.
export const MIN_SPINE_DU = 22;
export const MIN_SPINE_MM = 10;
export const THICKNESS_GROWTH = 1.0;
// 종이 한 쪽 두께(mm, 일반 도서 용지 약 0.12mm/장)와 앞뒤 표지 두께
export const MM_PER_PAGE = 0.06;
export const COVER_MM = 1.5;

export const mm = (v: number) => v * DU_PER_MM;

// 가운데 시점: 책 가운데 x(장면 좌표)가 화면 가운데에서 얼마나 떨어졌나(-1 왼쪽 끝 ~ 1 오른쪽 끝).
// 왼쪽 책은 오른쪽 옆면이, 오른쪽 책은 왼쪽 옆면이 보이고, 가운데에 가까울수록 옆면이 좁다.
export function viewOf(centerX: number) {
  const mid = DESIGN_WIDTH / 2 - SHELF.sideMargin;
  return Math.max(-1, Math.min(1, (centerX - mid) / (SHELF_USABLE_WIDTH / 2)));
}
// 세로 시점: 2번째 선반이 눈높이(0). 위 선반은 올려다봐 윗면이 안 보이고 옆면 윗부분이 깎여 보이며(-1),
// 아래 선반은 내려다봐 세운 책 윗면이 살짝 보인다(+1).
export function viewYOf(rowIndex: number) {
  return Math.max(-1, Math.min(1, rowIndex - 1));
}
export const TOP_VIEW = 4; // 내려다볼 때 보이는 세운 책 윗면 높이(DU)

export function spineDU(thickMm: number) {
  return MIN_SPINE_DU + Math.max(0, thickMm - MIN_SPINE_MM) * DU_PER_MM * THICKNESS_GROWTH;
}
export function thicknessMm(pages: number) {
  return pages * MM_PER_PAGE + COVER_MM;
}
// 개별 치수가 없는 등록 도서의 기본 크기
export const BOOK_HEIGHT: Record<HeightClass, number> = { short: 136, medium: 174, tall: 188 };
export const BOOK_THICKNESS: Record<ThicknessClass, number> = { thin: 28, medium: 36, thick: 42 };

// 눕힌 책의 윗면(표지 면) 깊이, 표지 전시의 옆면 두께.
export const TOP_FACE = 9;
// 누운 책(더미)은 선반 위에서 세운 책보다 조금 뒤에 놓인다: 화면에서 바닥이 이만큼 위(DU). 시안 3번 줄 약 2DU.
export const LYING_BACK = 2;
export const FRONT_SIDE = 4;
// 쌓을 때 위 책을 살짝 어긋나게 둔다(아래에서 위 순서).
export const STACK_OFFSETS = [0, 8, 3];
export const MAX_STACK = 3;
export const HOME_SHELF_COUNT = 3;

// tilt 값의 부호 = 기대는 방향(-: 왼쪽, +: 오른쪽). 실제 각도는 빈틈과 옆 책 윤곽으로 계산한다(lean.ts).
export const TILTS: Tilt[] = [-7, 0, 7];
// 예전 저장본(빈틈 없음)의 기울인 책이 기댈 수 있게 만들어 주는 각도
export const LEGACY_LEAN = 7;
// 메뉴로 기울일 때 벌려 주는 각도(최대 기울기는 lean.ts MAX_LEAN)
export const MENU_LEAN = 8;
// 눕힌 책은 선반 끝을 이만큼 넘어도 된다(DU)
export const H_OVERHANG = 20;

export function bookHeight(book: Book) {
  if (book.dims?.height) return book.dims.height;
  if (book.physical) return mm(book.physical.heightMm);
  return BOOK_HEIGHT[book.heightClass];
}

export function bookThickness(book: Book) {
  if (book.dims?.thickness) return book.dims.thickness;
  if (book.physical) return spineDU(thicknessMm(book.physical.pages));
  return BOOK_THICKNESS[book.thicknessClass];
}

export function frontWidth(book: Book) {
  if (book.dims?.coverWidth) return book.dims.coverWidth;
  if (book.physical) return mm(book.physical.widthMm);
  return Math.round(bookHeight(book) * book.coverAspectRatio);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

// 세운 책을 기울였을 때 차지하는 폭/높이. 바닥 모서리를 축으로 돌린다.
export function tiltedBounds(w: number, h: number, tilt: number) {
  const t = rad(Math.abs(tilt));
  return { width: w * Math.cos(t) + h * Math.sin(t), height: h * Math.cos(t) + w * Math.sin(t) };
}

// 한 권(쌓기 전)의 선반 점유 크기. 세운 책은 항상 똑바로 선 모양으로 잰다(기울기는 빈틈 안에서 생긴다).
export function singleFootprint(book: Book, p: Pick<BookPlacement, 'pose' | 'tilt'>) {
  const h = bookHeight(book);
  const w = bookThickness(book);
  switch (p.pose) {
    case 'spine':
      return { width: w, height: h };
    case 'horizontal':
      return { width: h, height: w + TOP_FACE };
    case 'front':
      return { width: frontWidth(book) + FRONT_SIDE, height: h };
  }
}

// Actual visible contour, normalized to left x=0 and floor y=0.
// Shared by packing and painting so tilted books can lean against neighbours.
export function visibleBookOutline(book: Book, p: Pick<BookPlacement, 'pose' | 'tilt'>) {
  const h = p.pose === 'horizontal' ? bookThickness(book) + TOP_FACE : bookHeight(book);
  const w = p.pose === 'horizontal' ? bookHeight(book) : p.pose === 'front' ? frontWidth(book) + FRONT_SIDE : bookThickness(book);
  const points = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const t = rad(p.pose === 'spine' ? p.tilt : 0);
  const turned = points.map((q) => ({ x: q.x * Math.cos(t) - q.y * Math.sin(t), y: q.x * Math.sin(t) + q.y * Math.cos(t) }));
  const x0 = Math.min(...turned.map((q) => q.x)), floor = Math.max(...turned.map((q) => q.y));
  return turned.map((q) => ({ x: q.x - x0, y: q.y - floor }));
}

// 쌓기 그룹: 폭은 (어긋남 포함) 가장 긴 책, 높이는 두께의 합.
// 쌓인 책의 왼쪽 어긋남(DU). 아래 책보다 짧은 책은 아래 책 안쪽(가운데보다 조금 오른쪽)에 올린다(시안).
// 같거나 긴 책은 정해진 어긋남(STACK_OFFSETS)을 쓴다.
export function stackOffsets(books: Book[]) {
  const out: number[] = [];
  books.forEach((b, i) => {
    if (i === 0) return out.push(0);
    const below = bookHeight(books[i - 1]);
    const d = below - bookHeight(b);
    out.push(d > 0 ? out[i - 1] + d * 0.6 : (STACK_OFFSETS[i] ?? 0));
  });
  return out;
}

export function stackFootprint(books: Book[]) {
  let width = 0;
  let height = TOP_FACE;
  const offs = stackOffsets(books);
  books.forEach((b, i) => {
    width = Math.max(width, bookHeight(b) + offs[i]);
    height += bookThickness(b);
  });
  return { width, height };
}
