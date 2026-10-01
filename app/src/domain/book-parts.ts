// 책 한 권의 몸체 구조(순수, UI 스레드 워클릿에서도 쓴다). 책 좌표: x = 두께(0 뒤표지 ~ T 앞표지), y = 높이, z = 깊이(0 책등 ~ W 책배).
// - 표지 판 두 장: x ∈ [0, bd], [T − bd, T]. 책등 띠: 머리·꼬리에서 z ∈ [0, sp](제본된 쪽을 감싼 표지).
// - 속지 묶음: 판 사이(x ∈ [bd, T − bd]), 책등 띠 뒤에서 책배 쪽 판 끝보다 sq 안쪽까지, 머리·꼬리도 판 끝보다 sq 안쪽.
//   판이 속지보다 머리·꼬리·책배 쪽으로 sq만큼 나와 있어(판 끝 여유) 속지 면은 판 끝 면보다 sq 안으로 들어가 있다.
// 모든 면은 이 구조의 평면 조각을 같은 카메라로 투영해 그린다(화면 좌표에서 밀어 넣기·흔들림 없음). 보이는지는 자세와 카메라로 정한다.
// 충돌·받침·가림 순서는 바깥 상자(T×H×W) 그대로이고, 그리는 모양은 그 상자 안에만 있다: 둥근 모서리(CORNER_R)는 책 전체 윤곽을
// 안쪽으로 깎을 뿐 밖으로 내밀지 않는다.
import type { Book3, FaceId, Vec3 } from './book3';

type Dims = Book3['dims'];

export const BOARD = { min: 1.1, max: 1.8, k: 0.08 }; // 판 두께 = 책 두께 × k (DU, 범위 안)
export const SQUARE = 1.6; // 판이 속지보다 나온 길이(DU)
export const CORNER_R = 3.0; // 보이는 윤곽 모서리 둥글기(DU): 모든 책·모든 자세에 같은 규칙
// 표지 판의 제본 홈: 책등 쪽 변에서 at(DU) 안쪽의 좁은 그늘(dark 폭)과 그 바로 뒤(gap)의 가는 밝음(lit 폭).
// 앞표지 그림과 판 면(뒤표지·비스듬한 앞표지 덮개)이 같은 규칙을 쓴다.
export const GROOVE = { at: 5, dark: 0.8, lit: 0.6, gap: 0.9 };

export type Rig = { bd: number; sp: number; sq: number };

export function rigOf(d: Dims): Rig {
  'worklet';
  const bd = Math.max(BOARD.min, Math.min(BOARD.max, d.T * BOARD.k));
  return { bd, sp: bd * 1.1, sq: SQUARE };
}

// 평면 조각: 원점 O에서 U(가로 끝), V(세로 끝)로 펼친 평행사변형. 그림 좌표 w×h(DU)가 이 조각에 붙는다(면 그림과 같은 방식).
export type Panel = { O: Vec3; U: Vec3; V: Vec3; w: number; h: number };

const v3 = (x: number, y: number, z: number): Vec3 => {
  'worklet';
  return { x, y, z };
};

// 종이 단면이 있는 면(머리·꼬리·책배)의 구조: 판 끝 평면의 열린 칸, 그보다 sq 안쪽의 속지 면, 칸 가장자리의 판·책등 테두리,
// 칸과 속지 면 사이의 안쪽 벽(판 안쪽·책등 띠 안쪽). 벽은 법선(n)으로 보이는지 정한다.
export type PageFace = {
  opening: Vec3[]; // 판 끝 평면에서 테두리 안쪽(속지가 들어가 보이는 칸)
  page: Panel; // 속지 면(판 끝보다 sq 안쪽 평면)
  rims: Vec3[][]; // 판 끝·책등 띠 끝(바깥 평면)
  walls: { pts: Vec3[]; n: Vec3 }[]; // 칸 안쪽 벽(판 안쪽 면, 책등 띠 안쪽 면)
};

export function pageFace(d: Dims, f: 'head' | 'tail' | 'fore'): PageFace {
  'worklet';
  const { T, H, W } = d;
  const { bd, sp, sq } = rigOf(d);
  const x0 = bd;
  const x1 = T - bd;
  if (f === 'fore') {
    const z = W;
    const zi = W - sq;
    return {
      opening: [v3(x0, H, z), v3(x1, H, z), v3(x1, 0, z), v3(x0, 0, z)],
      page: { O: v3(x0, H - sq, zi), U: v3(x1 - x0, 0, 0), V: v3(0, -(H - 2 * sq), 0), w: x1 - x0, h: H - 2 * sq },
      rims: [
        [v3(0, H, z), v3(x0, H, z), v3(x0, 0, z), v3(0, 0, z)],
        [v3(x1, H, z), v3(T, H, z), v3(T, 0, z), v3(x1, 0, z)],
      ],
      walls: [
        { pts: [v3(x0, H - sq, zi), v3(x0, H - sq, z), v3(x0, sq, z), v3(x0, sq, zi)], n: v3(1, 0, 0) },
        { pts: [v3(x1, H - sq, zi), v3(x1, H - sq, z), v3(x1, sq, z), v3(x1, sq, zi)], n: v3(-1, 0, 0) },
      ],
    };
  }
  const top = f === 'head';
  const y = top ? H : 0;
  const yi = top ? H - sq : sq;
  return {
    opening: [v3(x0, y, sp), v3(x1, y, sp), v3(x1, y, W), v3(x0, y, W)],
    page: { O: v3(x0, yi, sp), U: v3(x1 - x0, 0, 0), V: v3(0, 0, W - sq - sp), w: x1 - x0, h: W - sq - sp },
    rims: [
      [v3(0, y, 0), v3(x0, y, 0), v3(x0, y, W), v3(0, y, W)],
      [v3(x1, y, 0), v3(T, y, 0), v3(T, y, W), v3(x1, y, W)],
      [v3(x0, y, 0), v3(x1, y, 0), v3(x1, y, sp), v3(x0, y, sp)],
    ],
    walls: [
      { pts: [v3(x0, yi, sp), v3(x0, y, sp), v3(x0, y, W - sq), v3(x0, yi, W - sq)], n: v3(1, 0, 0) },
      { pts: [v3(x1, yi, sp), v3(x1, y, sp), v3(x1, y, W - sq), v3(x1, yi, W - sq)], n: v3(-1, 0, 0) },
      { pts: [v3(x0, yi, sp), v3(x1, yi, sp), v3(x1, y, sp), v3(x0, y, sp)], n: v3(0, 0, 1) },
    ],
  };
}

// 판 면(앞·뒤표지)과 책등의 그림 조각(그림 왼쪽 위 원점). 책등: 두께×세로, 앞표지: 표지 폭×세로(책등 쪽이 왼쪽),
// 뒤표지: 표지 폭×세로(책등 쪽이 오른쪽, 뒤에서 본 모습).
export function facePanel(d: Dims, f: 'spine' | 'cover' | 'back'): Panel {
  'worklet';
  if (f === 'spine') return { O: v3(0, d.H, 0), U: v3(d.T, 0, 0), V: v3(0, -d.H, 0), w: d.T, h: d.H };
  if (f === 'cover') return { O: v3(d.T, d.H, 0), U: v3(0, 0, d.W), V: v3(0, -d.H, 0), w: d.W, h: d.H };
  return { O: v3(0, d.H, d.W), U: v3(0, 0, -d.W), V: v3(0, -d.H, 0), w: d.W, h: d.H };
}

export const PAGE_FACES: ('head' | 'tail' | 'fore')[] = ['head', 'tail', 'fore'];
export const isPageFace = (f: FaceId): f is 'head' | 'tail' | 'fore' => f === 'head' || f === 'tail' || f === 'fore';
