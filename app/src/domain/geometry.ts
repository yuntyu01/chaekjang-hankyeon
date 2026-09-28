// 책 형상 계산. 모든 값은 설계 단위(DU, 기준 폭 390)이며 화면에서는 scale을 곱한다.
import { frontExtent } from './front-pose';
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
export const SHELF_THICKNESS = 0.8;
export const SHELF_IMG_H = ((SHELF_IMG_W * SHELF_ASSET.height) / SHELF_ASSET.width) * SHELF_THICKNESS;
export const SHELF_IMG_X = PLANK_INSET - SHELF_ASSET.plankLeft * SHELF_IMG_W;

// 시안(941px → 390DU)에서 잰 선반 치수
const PLANK_TOP = 6; // 윗면: 책 앞으로 또렷하게 보이게 시안보다 깊게
const PLANK_FRONT = 11.5; // 앞면

const asset = SHELF_STYLE === 'asset';
const USABLE_LEFT = 12;
const USABLE_W = DESIGN_WIDTH - USABLE_LEFT * 2;
const DU_MM = USABLE_W / 480; // 선반 안쪽 480mm = 사용 폭(SHELF_LENGTH_MM과 같은 비율)

// ---------- 공통 카메라(선반과 책이 같은 것을 쓴다) ----------
// 직교 투영으로 살짝 내려다본다. 선반 공간(x 오른쪽, y 위, z 벽 쪽)의 점이 화면(설계 단위, 아래가 +)으로:
//   화면 x = x + z·kx,  화면 y = 바닥 - (y + z·tanφ)
// 정확한 직교식 -(y·cosφ + z·sinφ)과는 화면 전체 세로 배율(1/cosφ, 3°에서 0.14%)만 다르다.
// 3°·kx 0.035: 시안(거의 눈높이)에 가깝게 윗면·옆면을 줄이면서 돌린 눕힌 책의 기울기는 남기는 값(6°·2°와 비교해 정함).
// 같은 높이라도 깊이가 다르면 화면 높이가 달라진다(벽 쪽일수록 위). kx는 옆면을 조금 보이게 하는 사선이다(카메라 좌우 회전 아님).
export const VIEW_PITCH_DEG = 3;
export const VIEW_KY = Math.tan((VIEW_PITCH_DEG * Math.PI) / 180);
export const VIEW_KX = 0.035;

// ---------- 선반 판(3D) ----------
// 깊이(선반 공간 z, 책 줄 기준): 판 앞 끝 z = -SHELF_FRONT, 책 기준선 z = 0, 뒷벽 z = SHELF_DEPTH.
// 판 전체 230mm = 앞 끝 → 책 기준선 70mm + 책 기준선 → 벽 160mm(앞 끝을 0으로 재면 기준선 70, 벽 230).
export const SHELF_TOTAL_DEPTH_MM = 230;
export const SHELF_FRONT_MM = 70;
export const SHELF_DEPTH_MM = SHELF_TOTAL_DEPTH_MM - SHELF_FRONT_MM;
export const SHELF_DEPTH = SHELF_DEPTH_MM * DU_MM;
export const SHELF_FRONT = SHELF_FRONT_MM * DU_MM;
// 판 두께(앞면 높이, DU): 지금 화면의 앞면 두께 그대로
export const SHELF_THICK = (SHELF_ASSET.frontBottomY - SHELF_ASSET.frontTopY) * SHELF_IMG_H;
// 판 좌우 끝(선반 공간 x). 책 줄(0 ~ 사용 폭)을 덮고, 사선(kx)으로 투영했을 때
// 앞 왼쪽 모서리와 뒤 오른쪽 모서리가 화면 양 끝에서 PLANK_INSET 안쪽에 오도록 정한다.
export const SHELF_X0 = PLANK_INSET - USABLE_LEFT + SHELF_FRONT * VIEW_KX;
export const SHELF_X1 = DESIGN_WIDTH - PLANK_INSET - USABLE_LEFT - SHELF_DEPTH * VIEW_KX;

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
  // 책 줄 바닥선(화면 y = 바닥) 기준 화면 거리(DU). 모두 위 카메라로 3D 판을 투영한 값.
  back: asset ? SHELF_DEPTH * VIEW_KY : 0, // 바닥선 → 윗면 뒤 모서리(벽)
  lip: asset ? SHELF_FRONT * VIEW_KY : PLANK_TOP, // 바닥선 → 윗면 앞 모서리
  below: asset ? SHELF_FRONT * VIEW_KY + SHELF_THICK : PLANK_TOP + PLANK_FRONT, // 바닥선 → 판 앞면 아래
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

// 줄마다 같은 카메라(위 공통 카메라). 배치·충돌은 카메라와 상관없는 선반 공간에서 하고, 카메라는 그리기·터치에만 쓴다.
export const ROW_CAMERAS = [{ kx: VIEW_KX, ky: VIEW_KY }];
export function cameraFor(_rowIndex: number) {
  return ROW_CAMERAS[0];
}
export const CAMERA = ROW_CAMERAS[0];

// ---------- 보기 설정: 내려다보는 각 ----------
// 기본 3°, 꾸미기에서 위아래로 끌어 8°까지(책 배치·광원은 그대로, 같은 장면을 다르게 보는 것).
// 확정된 각은 공통 카메라(CAMERA, 배치 계산·터치·줄 높이용)에 반영한다. 끄는 동안의 각은 화면(UI 스레드) 카메라만 바꾼다.
export const VIEW_PITCH_MIN = 3;
export const VIEW_PITCH_MAX = 8;
export const kyOf = (deg: number) => Math.tan((deg * Math.PI) / 180);
export function setViewPitch(deg: number) {
  const d = Math.max(VIEW_PITCH_MIN, Math.min(VIEW_PITCH_MAX, deg));
  CAMERA.ky = kyOf(d);
  return d;
}

// 시점 끌기를 놓았을 때 정착할 각(3° 또는 8°). home = 잡기 전에 있던(정착 중이었으면 향하던) 시점,
// now = 손가락이 끈 만큼의 각, vy = 놓을 때 세로 속도(dp/s, + = 아래로 = 더 내려다보기).
// 조금만 움직였으면 원래 시점(아주 세게 튕긴 경우만 예외), 빠르게 놓으면 그 방향, 아니면 가까운 쪽.
export const VIEW_DEG_PER_DP = 0.03; // 약 170dp 끌면 3° → 8°
export const VIEW_SMALL_DEG = 0.8;
export function viewSettle(home: number, p0: number, now: number, vy: number) {
  'worklet';
  const moved = Math.abs(now - p0);
  const flick = moved < VIEW_SMALL_DEG ? 1500 : 500;
  if (vy > flick) return VIEW_PITCH_MAX;
  if (vy < -flick) return VIEW_PITCH_MIN;
  if (moved < VIEW_SMALL_DEG) return home;
  return now - VIEW_PITCH_MIN < VIEW_PITCH_MAX - now ? VIEW_PITCH_MIN : VIEW_PITCH_MAX;
}
// 눕힌 책의 수직축 회전 범위(도). 미적·조작상의 제한(선반 깊이·충돌·받침에 따라 더 좁아질 수 있다).
export const MAX_SPIN = 12;

// 누운 책(더미)은 선반 위에서 세운 책보다 뒤에 놓인다(선반 공간 깊이 DU). 화면에서는 LYING_BACK_Z × ky만큼 올라간다.
export const LYING_BACK_Z = 40;
export const LYING_BACK = LYING_BACK_Z * CAMERA.ky;
// (예전 방식 렌더러용: 서랍 등) 눕힌 책의 윗면 깊이, 표지 전시의 옆면 두께
export const TOP_FACE = 9;
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

// 한 권(쌓기 전)의 선반 점유 크기(상자 모델). 폭은 앞면 가로(옆면은 옆 책 뒤로 숨는다),
// 높이는 화면에서 보이는 높이(앞면 + 위로 밀린 윗면, 눕힌 책은 뒤에 놓인 만큼 더). 세운 책은 똑바로 선 모양으로 잰다.
// 기본 깊이(선반 공간 z): 세운 책·표지 책은 책 기준선(0), 눕힌 책은 조금 뒤.
// 기준선 뒤 공간(SHELF_DEPTH)보다 깊은 책은 벽에 붙고 그만큼 기준선 앞으로 나온다(선반 앞 끝까지).
export function defaultDepth(book: Book, pose: BookPlacement['pose']) {
  const W = frontWidth(book);
  if (pose === 'front') return 0;
  if (pose === 'spine') return Math.max(-SHELF_FRONT, Math.min(0, SHELF_DEPTH - W));
  return Math.max(-SHELF_FRONT, Math.min(LYING_BACK_Z, SHELF_DEPTH - W - 2));
}

// 수직축으로 돌린 눕힌 책의 축 정렬 폭(x)·깊이(z)
export function spunExtent(book: Book, spin = 0) {
  const L = bookHeight(book);
  const W = frontWidth(book);
  const r = (spin * Math.PI) / 180;
  return { w: Math.abs(L * Math.cos(r)) + Math.abs(W * Math.sin(r)), d: Math.abs(L * Math.sin(r)) + Math.abs(W * Math.cos(r)) };
}

// ---------- 표지 전시 책의 벽 기대기 ----------
// 뒤쪽 아래 모서리(z = depth + 두께)는 사용자가 둔 자리 그대로 선반에, 뒤쪽 윗모서리는 벽(z = SHELF_DEPTH)에 닿는다:
//   sin(각) = 벽까지 틈 / 책 높이. 벽에서 멀어질수록 더 기운다. 틈이 커서 각이 WALL_LEAN_MAX를 넘으면 벽에서 떨어져 똑바로 선다.
// 선 책은 틈이 WALL_LEAN_ENTER 각에 해당하는 거리 안으로 들어와야 기대기 시작한다(두 경계 사이에서는 지금 상태 유지).
export const WALL_LEAN_ENTER = 16;
export const WALL_LEAN_MAX = 20;
export function wallGap(book: Book, depth: number) {
  return SHELF_DEPTH - (depth + bookThickness(book));
}
export function nextWallLean(book: Book, depth: number, prev?: boolean) {
  const lim = bookHeight(book) * Math.sin(((prev ? WALL_LEAN_MAX : WALL_LEAN_ENTER) * Math.PI) / 180);
  return wallGap(book, depth) <= lim + 1e-6;
}
export function wallPitch(book: Book, depth: number, lean?: boolean) {
  if (!lean) return 0;
  const g = Math.max(0, wallGap(book, depth));
  return (Math.asin(Math.min(1, g / bookHeight(book))) * 180) / Math.PI;
}

export function placementDepth(book: Book, p: Pick<BookPlacement, 'pose' | 'depth' | 'spin'> & { pitch?: number }) {
  const z = p.depth ?? defaultDepth(book, p.pose);
  if (p.pose === 'front' && (p.pitch || p.spin)) {
    const e = frontExt(book, p);
    return { z0: z + e.z0, z1: z + e.z1 };
  }
  const d = p.pose === 'horizontal' ? spunExtent(book, p.spin).d : p.pose === 'front' ? bookThickness(book) : frontWidth(book);
  return { z0: z, z1: z + d };
}

// 표지 전시 책의 상자 치수(책 좌표 T·H·W)와 두 회전의 축 정렬 범위
export function frontDims(book: Book) {
  return { T: bookThickness(book), H: bookHeight(book), W: frontWidth(book) };
}
export function frontExt(book: Book, p: { pitch?: number; spin?: number }) {
  return frontExtent(frontDims(book), p.pitch ?? 0, p.spin ?? 0);
}

// ky: 화면 높이를 잴 카메라(기본은 지금 보기 각). 줄 높이는 가장 내려다보는 각으로 재서 보기 각을 바꿔도 줄이 움직이지 않게 한다.
export function singleFootprint(book: Book, p: Pick<BookPlacement, 'pose' | 'tilt'> & { spin?: number; depth?: number; pitch?: number }, ky = CAMERA.ky) {
  const h = bookHeight(book);
  const t = bookThickness(book);
  const w = frontWidth(book);
  switch (p.pose) {
    case 'spine':
      return { width: t, height: h + w * ky };
    case 'horizontal': {
      const e = spunExtent(book, p.spin);
      return { width: e.w, height: t + ((p.depth ?? defaultDepth(book, 'horizontal')) + e.d) * ky };
    }
    case 'front': {
      if (!p.pitch && !p.spin) return { width: w, height: h + t * ky };
      const e = frontExt(book, p);
      return { width: e.x1 - e.x0, height: e.y1 + (e.z1 - e.z0) * ky };
    }
  }
}

// 앞면 윤곽(왼쪽 x=0, 바닥 y=0, 위로 음수). 배치(packing)가 쓴다.
export function visibleBookOutline(book: Book, p: Pick<BookPlacement, 'pose' | 'tilt'> & { spin?: number; pitch?: number }) {
  const fe = p.pose === 'front' && (p.pitch || p.spin) ? frontExt(book, p) : null;
  const h = p.pose === 'horizontal' ? bookThickness(book) : fe ? fe.y1 : bookHeight(book);
  const w = p.pose === 'horizontal' ? spunExtent(book, p.spin).w : fe ? fe.x1 - fe.x0 : p.pose === 'front' ? frontWidth(book) : bookThickness(book);
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

export function stackFootprint(books: Book[], spins: number[] = [], ky = CAMERA.ky) {
  let width = 0;
  let height = LYING_BACK_Z * ky;
  let depth = 0;
  const offs = stackOffsets(books);
  books.forEach((b, i) => {
    width = Math.max(width, spunExtent(b, spins[i]).w + offs[i]);
    height += bookThickness(b);
    depth = Math.max(depth, frontWidth(b));
  });
  return { width, height: height + depth * ky };
}
