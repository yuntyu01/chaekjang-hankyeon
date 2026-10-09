// 책 형상 계산. 모든 값은 설계 단위(DU, 기준 폭 390)이며 화면에서는 scale을 곱한다.
// 카메라(보기 각·사선)는 domain/camera 하나뿐이다. 여기 값들은 카메라와 상관없는 3D 구조다.
import { BASE_CAM, kyOf, VIEW_KX, VIEW_PITCH_MAX, VIEW_PITCH_MIN } from './camera';
import { frontExtent } from './front-pose';
import type { Book, BookPlacement, HeightClass, ThicknessClass } from './types';

export { kyOf, VIEW_KX, VIEW_PITCH_MAX, VIEW_PITCH_MIN };

export const DESIGN_WIDTH = 390;
export const PLANK_INSET = 10;

const USABLE_LEFT = 12;
const USABLE_W = DESIGN_WIDTH - USABLE_LEFT * 2;
const DU_MM = USABLE_W / 480; // 선반 안쪽 480mm = 사용 폭(SHELF_LENGTH_MM과 같은 비율)

// ---------- 선반 판(3D) ----------
// 깊이(선반 공간 z, 책 줄 기준): 판 앞 끝 z = -SHELF_FRONT, 책 기준선 z = 0, 뒷벽 z = SHELF_DEPTH.
// 판 전체 230mm = 앞 끝 → 책 기준선 70mm + 책 기준선 → 벽 160mm(앞 끝을 0으로 재면 기준선 70, 벽 230).
export const SHELF_TOTAL_DEPTH_MM = 230;
export const SHELF_FRONT_MM = 70;
export const SHELF_DEPTH_MM = SHELF_TOTAL_DEPTH_MM - SHELF_FRONT_MM;
export const SHELF_DEPTH = SHELF_DEPTH_MM * DU_MM;
export const SHELF_FRONT = SHELF_FRONT_MM * DU_MM;
// 시안 선반 앞면 두께: 853px 시안에서 약 33~35px(1.666px/mm) → 약 21mm. 약 16.4DU.
export const SHELF_THICK_MM = 21.5;
export const SHELF_THICK = SHELF_THICK_MM * DU_MM;
// 판 좌우 끝(선반 공간 x): 책 줄(0 ~ 사용 폭)보다 양쪽으로 PLANK_OVER씩 길다(줄 가운데에 대해 대칭).
// 원근 카메라에서 판 앞 끝(z = -SHELF_FRONT)은 눈에 가까워 조금 넓게 보인다: 화면에서는 양 끝에서 약 PLANK_INSET - 1.5 안쪽.
const PLANK_OVER = 1.5;
export const SHELF_X0 = -PLANK_OVER;
export const SHELF_X1 = USABLE_W + PLANK_OVER;

export const SHELF = {
  sideMargin: USABLE_LEFT, // 선반 공간 x=0의 화면 설계 좌표
  innerLeft: 0,
  innerRight: 0,
  gap: 0, // 서 있는 책 사이 틈: 붙인다(깊이 145mm 책 사이 2~3mm 틈은 빛이 들지 않아 검은 선이 된다. 그림자 참고 그림도 책끼리 맞닿는다)
  rowTopPad: 2, // 가장 높은 책(갈피 포함) 위 여백(기본 3°에서): 시안처럼 위 선반 바로 밑까지
  minClear: 110,
};

export const SHELF_USABLE_WIDTH = USABLE_W - SHELF.innerLeft - SHELF.innerRight;

// ---------- 실제 단위 ----------
// 선반 안쪽 길이를 480mm로 고정하고, 화면에서는 이 길이가 사용 폭에 맞도록 비율만 바꾼다.
// 어느 기기에서든 한 선반에 들어가는 책 수가 같다.
export const SHELF_LENGTH_MM = 480;
export const DU_PER_MM = SHELF_USABLE_WIDTH / SHELF_LENGTH_MM;
// 얇은 책도 제목과 작은 그림이 들어가게 최소 30DU. 그보다 두꺼운 만큼은
// 실제 두께 차이를 반영한다. 300쪽 ≈ 37DU, 450쪽 ≈ 44DU.
export const MIN_SPINE_DU = 30;
export const MIN_SPINE_MM = 10;
export const THICKNESS_GROWTH = 1.0;
// 종이 한 쪽 두께(mm, 일반 도서 용지 약 0.12mm/장)와 앞뒤 표지 두께
export const MM_PER_PAGE = 0.06;
export const COVER_MM = 1.5;

export const mm = (v: number) => v * DU_PER_MM;

export function spineDU(thickMm: number) {
  return MIN_SPINE_DU + Math.max(0, thickMm - MIN_SPINE_MM) * DU_PER_MM * THICKNESS_GROWTH;
}
export function thicknessMm(pages: number) {
  return pages * MM_PER_PAGE + COVER_MM;
}
// 개별 치수가 없는 등록 도서의 기본 크기
export const BOOK_HEIGHT: Record<HeightClass, number> = { short: 136, medium: 174, tall: 188 };
export const BOOK_THICKNESS: Record<ThicknessClass, number> = { thin: 28, medium: 36, thick: 42 };

// 예전 이름(다른 화면 호환). 값이 바뀌지 않는 기본 3° 카메라다. 보기 각은 view-store → 화면 카메라(camSV)로만 바뀐다.
export const CAMERA = BASE_CAM;

// ---------- 보기 설정: 내려다보는 각(VIEW_PITCH_MIN ~ 8°, 원근 카메라의 눈높이) ----------
// 꾸미기에서 선반 앞면을 위아래로 끌어 바꾼다. 책 배치·광원·줄 간격은 그대로(같은 장면을 다르게 보는 것).

// 시점 끌기를 놓았을 때 정착할 각(기본 또는 8°). home = 잡기 전에 있던(정착 중이었으면 향하던) 시점,
// now = 손가락이 끈 만큼의 각, vy = 놓을 때 세로 속도(dp/s, + = 아래로 = 더 내려다보기).
// 조금만 움직였으면 원래 시점(아주 세게 튕긴 경우만 예외), 빠르게 놓으면 그 방향, 아니면 가까운 쪽.
export const VIEW_DEG_PER_DP = (VIEW_PITCH_MAX - VIEW_PITCH_MIN) / 170; // 약 170dp 끌면 기본 → 8°
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
// 표지 책의 좌우 돌리기 범위(도): 서 있는 책은 제자리에서 자유롭게 돈다(2026-10-10 사용자: 표지 상태 돌리기는 자유로워야).
// 옆 책·벽·선반 끝에 닿으면 그 직전에서 멈춘다(frontSpin reach)
export const MAX_FRONT_SPIN = 90;

// 누운 책(더미)의 기본 깊이: 세운 책보다 조금 뒤(선반 공간 z, DU)
export const LYING_BACK_Z = 40;
// 책을 저절로 놓을 때 벽과 띄우는 거리(실제 책장처럼 10~20mm): 벽에 붙은 책은 그 뒤 벽을 거의 다 가려 접촉선처럼 짙은 그늘이 진다.
// 사용자가 앞뒤로 옮길 때는 벽까지(SHELF_DEPTH) 갈 수 있다(물리 한계는 벽)
export const WALL_GAP = mm(15);
// 세운 책 책등 줄: 책등은 책 기준선(0)에 한 줄로 맞춘다(사람이 꽂는 방식, 그림자 참고 그림). 깊이가 다른 책을 저마다 벽 쪽(WALL_GAP)에 붙여 세우면
// 책등이 들쭉날쭉해(예시 책 깊이 150~156mm면 1~5DU) 얕은 책의 둥근 모서리가 앞으로 나온 옆 책 옆면과 좁은 구석을 이뤄 빛이 들지 않는다(검은 띠).
// 벽과 이보다 가까워지는 깊은 책만 그만큼 앞으로 나온다
export const SPINE_WALL_GAP = mm(3);
// 쌓을 때 위 책을 살짝 어긋나게 둔다(아래에서 위 순서).
export const STACK_OFFSETS = [0, 8, 3];
export const MAX_STACK = 3;
export const HOME_SHELF_COUNT = 3;

// tilt 값은 부호만 쓴다(기대는 방향: -1 왼쪽, +1 오른쪽). 실제 각도는 빈틈과 옆 책 3D 상자로 계산한다.
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

// 한 권(쌓기 전)의 선반 점유 크기(상자 모델). 폭은 앞면 가로(옆면은 옆 책 뒤로 숨는다),
// 높이는 화면에서 보이는 높이(앞면 + 위로 밀린 윗면, 눕힌 책은 뒤에 놓인 만큼 더). 세운 책은 똑바로 선 모양으로 잰다.
// 기본 깊이(선반 공간 z): 세운 책·표지 책은 책 기준선(0), 눕힌 책은 조금 뒤. 세운 책은 벽과 SPINE_WALL_GAP, 눕힌 책은 WALL_GAP보다 가깝게 두지 않는다:
// 기준선 뒤 공간에서 그 틈을 뺀 것보다 깊은 책은 그만큼 기준선 앞으로 나온다(선반 앞 끝까지).
export function defaultDepth(book: Book, pose: BookPlacement['pose']) {
  const W = frontWidth(book);
  if (pose === 'front') return 0;
  if (pose === 'spine') return Math.max(-SHELF_FRONT, Math.min(0, SHELF_DEPTH - SPINE_WALL_GAP - W));
  return Math.max(-SHELF_FRONT, Math.min(LYING_BACK_Z, SHELF_DEPTH - WALL_GAP - W));
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
//   sin(각) = 벽까지 틈 / 책 높이. 벽에서 멀어질수록 더 기울고, 닿지 못하면 바닥에 눕는다.
// 서 있는 책은 앞뒤로 옮겨도 저절로 기대지 않는다(벽 가까이 가도 서 있다): 기대기는 머리 손잡이로 젖힐 때만.
export function wallGap(book: Book, depth: number) {
  return SHELF_DEPTH - (depth + bookThickness(book));
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

// ky: 화면 높이를 잴 카메라(기본 3°). 폭(width)은 배치(packing)가 쓴다. 줄 간격은 이 값이 아니라 3D 높이로 정한다(ui/shelf/metrics).
export function singleFootprint(book: Book, p: Pick<BookPlacement, 'pose' | 'tilt'> & { spin?: number; depth?: number; pitch?: number }, ky = BASE_CAM.ky) {
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

// 쌓기 그룹: 폭은 (어긋남 포함) 가장 긴 책, 높이는 두께의 합.
// 쌓인 책의 왼쪽 어긋남(DU). 아래 책보다 짧은 책은 아래 책 안쪽(가운데보다 조금 오른쪽)에 올린다(시안).
// 짧은 위 책은 아래 책의 오른쪽 끝에 맞춘다(시안의 두 권 더미).
// 길이가 같은 책은 아래 책에 맞춰 올린다(어긋나면 받침 밖으로 나가 쌓을 수 없다: 받침 판정 support.ts와 같은 규칙).
// 더 긴 책은 정해진 어긋남(STACK_OFFSETS)을 쓴다.
const SAME_LENGTH = 0.5; // DU: 이만큼 차이는 같은 판형으로 본다
export function stackOffsets(books: Book[], spins: number[] = []) {
  const out: number[] = [];
  books.forEach((b, i) => {
    if (i === 0) return out.push(0);
    const below = bookHeight(books[i - 1]);
    const d = below - bookHeight(b);
    const align = Math.abs(spins[i] ?? 0) + Math.abs(spins[i-1] ?? 0) > 0.01 ? 0.6 : 1;
    out.push(d > SAME_LENGTH ? out[i - 1] + d * align : d >= -SAME_LENGTH ? out[i - 1] : (STACK_OFFSETS[i] ?? 0));
  });
  return out;
}

export function stackFootprint(books: Book[], spins: number[] = [], ky = BASE_CAM.ky) {
  let width = 0;
  let height = LYING_BACK_Z * ky;
  let depth = 0;
  const offs = stackOffsets(books, spins);
  books.forEach((b, i) => {
    width = Math.max(width, spunExtent(b, spins[i]).w + offs[i]);
    height += bookThickness(b);
    depth = Math.max(depth, frontWidth(b));
  });
  return { width, height: height + depth * ky };
}
