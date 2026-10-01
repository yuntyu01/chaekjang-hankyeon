// 책 면의 화면 모양 계산(워클릿). 선반 줄·이동 캔버스·서랍 모두 이것 하나로 면을 만든다.
// 모든 면은 책 좌표의 평면 조각(domain/book-parts)을 지금 자세·카메라로 투영한다: 그림이 붙는 조각은 조각 → 캔버스 변환 행렬,
// 테두리·안쪽 벽처럼 단색인 조각은 투영한 다각형. 화면 좌표에서 밀어 넣거나 흔들거나 부풀리지 않는다.
// 둥근 모서리는 책 전체의 투영 윤곽을 공통 반지름(CORNER_R)으로 깎는 자르기 하나로 만든다(모든 면·그림자·빛이 같이 잘린다).
// 워클릿은 만들어질 때 쓰는 함수를 붙잡으므로, 쓰이는 함수를 먼저 정의한다.
import { corners, faceNormal, facing, rot, toWorld, type Book3, type Cam, type FaceId, type Vec3 } from '@/domain/book3';
import { CORNER_R, facePanel, pageFace, type Panel } from '@/domain/book-parts';
import { hull } from '@/domain/box';
import { project, type Point } from '@/domain/camera';

// 장면 좌표 → 캔버스 px: X = x * s + tx, Y = y * s + ty
export type Affine = { s: number; tx: number; ty: number };

// 보이지 않는 면의 행렬(그림을 화면 밖 한 점으로): 그룹 불투명도만으로는 기록된 그림이 얇은 선으로 남는다
export const HIDDEN_MATRIX = [0, 0, -1e4, 0, 0, -1e4, 0, 0, 1];

// 조각 그림 px → 캔버스 px 행렬(3×3, 행 우선). 투영이 선형(직교)이라 조각의 원점·두 변으로 정해지는 affine이 곧 조각 전체의 투영이다.
// 그림은 조각 w×h(DU)를 배율 s로 기록한 것(그림 px = DU × s).
export function panelMatrix(b: Book3, p: Panel, cam: Cam, px: Affine) {
  'worklet';
  const O = project(cam, toWorld(b, p.O));
  const U = rot(b.roll, b.yaw, p.U, b.spin ?? 0, b.pitch ?? 0);
  const V = rot(b.roll, b.yaw, p.V, b.spin ?? 0, b.pitch ?? 0);
  const s = px.s;
  const ux = (U.x + U.z * cam.kx) / p.w;
  const uy = -(U.y + U.z * cam.ky) / p.w;
  const vx = (V.x + V.z * cam.kx) / p.h;
  const vy = -(V.y + V.z * cam.ky) / p.h;
  return [ux, vx, O.x * s + px.tx, uy, vy, O.y * s + px.ty, 0, 0, 1];
}

// 책등·앞표지·뒤표지 그림 조각의 행렬
export function faceMatrix(b: Book3, f: 'spine' | 'cover' | 'back', cam: Cam, px: Affine) {
  'worklet';
  return panelMatrix(b, facePanel(b.dims, f), cam, px);
}

// 면이 보이는가: 카메라 쪽을 향하고(뒷면 거르기), 아래를 향한 면(바닥·아래 책에 닿는 면)이 아닐 때
export function faceVisible(cam: Cam, b: Book3, f: FaceId) {
  'worklet';
  if (facing(cam, b, f) <= 0.002) return false;
  return rot(b.roll, b.yaw, faceNormal(f), b.spin ?? 0, b.pitch ?? 0).y >= -0.5;
}

// 종이 단면 면(머리·꼬리·책배) 하나의 화면 모양: 열린 칸, 속지 조각 행렬, 판·책등 테두리, 보이는 안쪽 벽(캔버스 px)
export type PageGeom = { ok: boolean; opening: Point[]; pageM: number[]; rims: Point[][]; walls: Point[][] };
export const EMPTY_PAGE: PageGeom = { ok: false, opening: [], pageM: HIDDEN_MATRIX, rims: [], walls: [] };

export function pageGeom(cam: Cam, b: Book3, f: 'head' | 'tail' | 'fore', px: Affine): PageGeom {
  'worklet';
  if (!faceVisible(cam, b, f)) return EMPTY_PAGE;
  const pf = pageFace(b.dims, f);
  const P = (v: Vec3) => {
    const q = project(cam, toWorld(b, v));
    return { x: q.x * px.s + px.tx, y: q.y * px.s + px.ty };
  };
  const walls: Point[][] = [];
  const l = Math.hypot(cam.kx, cam.ky, 1);
  for (const w of pf.walls) {
    const n = rot(b.roll, b.yaw, w.n, b.spin ?? 0, b.pitch ?? 0);
    if ((n.x * cam.kx + n.y * cam.ky - n.z) / l > 0.002) walls.push(w.pts.map(P));
  }
  return { ok: true, opening: pf.opening.map(P), pageM: panelMatrix(b, pf.page, cam, px), rims: pf.rims.map((r) => r.map(P)), walls };
}

// 책 전체의 투영 윤곽(8 꼭짓점의 볼록 껍질)을 모서리마다 같은 작은 반지름으로 깎은 모양(캔버스 px). 짧은 변에서는 반지름을 줄인다.
export function silhouette(cam: Cam, b: Book3, px: Affine): Point[] {
  'worklet';
  const pts = hull(
    corners(b).map((c) => {
      const q = project(cam, c);
      return { x: q.x * px.s + px.tx, y: q.y * px.s + px.ty };
    }),
  );
  const n = pts.length;
  const out: Point[] = [];
  const r = CORNER_R * px.s;
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    const a = pts[(i + n - 1) % n];
    const e = pts[(i + 1) % n];
    const la = Math.hypot(a.x - c.x, a.y - c.y) || 1;
    const le = Math.hypot(e.x - c.x, e.y - c.y) || 1;
    // 짧은 변(3°에서 비스듬한 윤곽 변은 약 6DU)에서도 이웃 모서리가 한 곡선으로 합쳐지지 않게 변 길이의 30%까지만 깎는다
    const k = Math.min(r, la * 0.3, le * 0.3);
    const p0 = { x: c.x + ((a.x - c.x) * k) / la, y: c.y + ((a.y - c.y) * k) / la };
    const p1 = { x: c.x + ((e.x - c.x) * k) / le, y: c.y + ((e.y - c.y) * k) / le };
    // 모서리 곡선(2차 베지어, 꼭짓점이 조절점)
    for (let j = 0; j <= 4; j++) {
      const t = j / 4;
      const u = 1 - t;
      out.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y });
    }
  }
  return out;
}

export const seedOf = (id: string, f: string) => [...id].reduce((h, c) => h + c.charCodeAt(0), 0) * 0.37 + f.length;
