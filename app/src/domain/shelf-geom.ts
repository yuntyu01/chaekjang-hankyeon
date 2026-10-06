// 선반 판 모양(순수): 3D 판 꼭짓점을 책과 같은 project()로 투영해 보이는 면을 만든다.
// 선반 공간(책과 같음): x 오른쪽, y 위(판 윗면 y=0), z 벽 쪽(책 기준선 z=0, 판 앞 끝 -SHELF_FRONT, 벽 SHELF_DEPTH).
// 직교 투영이라 각 면은 평행사변형이고, 면 = 원점 O + 가로 U + 세로 V(화면 좌표, 설계 단위)로 나타낸다.
// 이웃한 면은 같은 꼭짓점을 쓴다(윗면 앞 변 = 앞면 위 변, 옆면 왼쪽 변 = 윗면 오른쪽 변·앞면 오른쪽 변).
import { project, type Camera } from './box';
import { viewAt } from './camera';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from './geometry';
import type { Point } from './shelf-scene';

export type ShelfFace = { O: Point; U: Point; V: Point; poly: Point[] };
export type ShelfFaces = { top: ShelfFace; front: ShelfFace; side: ShelfFace | null; corners: Record<string, Point> };

// 3D 꼭짓점 이름: [왼/오른][앞/뒤][위/아래]
export function shelfVertices() {
  'worklet';
  const zf = -SHELF_FRONT;
  const zb = SHELF_DEPTH;
  const yb = -SHELF_THICK;
  return {
    LFT: { x: SHELF_X0, y: 0, z: zf },
    RFT: { x: SHELF_X1, y: 0, z: zf },
    RBT: { x: SHELF_X1, y: 0, z: zb },
    LBT: { x: SHELF_X0, y: 0, z: zb },
    LFB: { x: SHELF_X0, y: yb, z: zf },
    RFB: { x: SHELF_X1, y: yb, z: zf },
    RBB: { x: SHELF_X1, y: yb, z: zb },
    LBB: { x: SHELF_X0, y: yb, z: zb },
  };
}

// 판 상자 꼭짓점 8개를 상자 꼭짓점 순서로(책 corners()와 같다: i&1 = 오른쪽, i&2 = 위, i&4 = 벽 쪽).
// 그림자 계산(shadowOnPlane)의 변 목록(BOX_EDGES)이 이 순서를 가정한다. 순서가 다르면 대각선을 변으로 잘라 그림자 모양이 틀어진다.
export function shelfBoxCorners() {
  'worklet';
  const v = shelfVertices();
  return [v.LFB, v.RFB, v.LFT, v.RFT, v.LBB, v.RBB, v.LBT, v.RBT];
}

function face(a: Point, b: Point, c: Point, d: Point): ShelfFace {
  'worklet';
  return {
  O: a,
  U: { x: b.x - a.x, y: b.y - a.y },
  V: { x: d.x - a.x, y: d.y - a.y },
  poly: [a, b, c, d],
  };
}

export function shelfFaces(cam: Camera): ShelfFaces {
  'worklet';
  const v = shelfVertices();
  const P = {
    LFT: project(cam, v.LFT),
    RFT: project(cam, v.RFT),
    RBT: project(cam, v.RBT),
    LBT: project(cam, v.LBT),
    LFB: project(cam, v.LFB),
    RFB: project(cam, v.RFB),
    RBB: project(cam, v.RBB),
    LBB: project(cam, v.LBB),
  };
  return {
    // 윗면: O = 뒤 왼쪽, U = 뒤 변(→오른쪽), V = 왼쪽 변(→앞). 질감 그림의 위쪽이 벽 쪽.
    top: face(P.LBT, P.RBT, P.RFT, P.LFT),
    // 앞면: O = 위 왼쪽, U = 위 변, V = 왼쪽 변(→아래)
    front: face(P.LFT, P.RFT, P.RFB, P.LFB),
    // 오른쪽 옆면: 그 끝에서 본 사선이 오른쪽(kx > 0)이면 보인다(원근 카메라는 눈이 판 가운데라 보이지 않는다). O = 앞 위, U = 위 변(→벽), V = 앞 변(→아래)
    side: viewAt(cam, v.RFT).kx > 0 ? face(P.RFT, P.RBT, P.RBB, P.RFB) : null,
    corners: P,
  };
}

// 텍스처 그림(w × h px) → 화면 px 행렬(3×3 행 우선): 그림 (0,0)=O, (w,0)=O+U, (0,h)=O+V. 화면 px = 설계 단위 × s + (tx, ty).
export function faceTextureMatrix(f: ShelfFace, w: number, h: number, s: number, tx: number, ty: number) {
  'worklet';
  const [a, b, c, d] = f.poly;
  const dx = a.x - b.x + c.x - d.x;
  const dy = a.y - b.y + c.y - d.y;
  if (Math.abs(dx) + Math.abs(dy) < 1e-8) return [(f.U.x * s) / w, (f.V.x * s) / h, f.O.x * s + tx, (f.U.y * s) / w, (f.V.y * s) / h, f.O.y * s + ty, 0, 0, 1];
  const x1 = b.x - c.x, x2 = d.x - c.x, y1 = b.y - c.y, y2 = d.y - c.y;
  const det = x1 * y2 - x2 * y1;
  const g = (dx * y2 - x2 * dy) / det;
  const k = (x1 * dy - dx * y1) / det;
  return [
    (s * (b.x - a.x + g * b.x) + tx * g) / w,
    (s * (d.x - a.x + k * d.x) + tx * k) / h, s * a.x + tx,
    (s * (b.y - a.y + g * b.y) + ty * g) / w,
    (s * (d.y - a.y + k * d.y) + ty * k) / h, s * a.y + ty,
    g / w, k / h, 1,
  ];
}
