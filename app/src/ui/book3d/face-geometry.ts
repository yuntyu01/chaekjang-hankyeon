// 책 면의 화면 모양 계산(워클릿). 선반 줄·이동 캔버스·서랍 모두 이것 하나로 면을 만든다.
// 모든 면은 책 좌표의 평면 조각(domain/book-parts)을 지금 자세·카메라로 투영한다: 그림이 붙는 조각은 조각 → 캔버스 변환 행렬,
// 테두리·안쪽 벽처럼 단색인 조각은 투영한 다각형. 화면 좌표에서 밀어 넣거나 흔들거나 부풀리지 않는다.
// 둥근 모서리는 책 전체의 투영 윤곽을 판 모서리 반지름(EDGE_R)으로 깎은 모양 하나로 만든다(모든 면·그림자·빛이 같이 잘린다).
// 워클릿은 만들어질 때 쓰는 함수를 붙잡으므로, 쓰이는 함수를 먼저 정의한다.
import { corners, faceCorners, faceNormal, facing, rot, toWorld, type Book3, type Cam, type FaceId, type Vec3 } from '@/domain/book3';
import { EDGE_R, facePanel, pageFace, type Panel } from '@/domain/book-parts';
import { hull } from '@/domain/box';
import { project, viewAt, type Point } from '@/domain/camera';

// 장면 좌표 → 캔버스 px: X = x * s + tx, Y = y * s + ty
export type Affine = { s: number; tx: number; ty: number };

// 보이지 않는 면의 행렬(그림을 화면 밖 한 점으로): 그룹 불투명도만으로는 기록된 그림이 얇은 선으로 남는다
export const HIDDEN_MATRIX = [0, 0, -1e4, 0, 0, -1e4, 0, 0, 1];

// 조각 그림 px → 캔버스 px 행렬(3×3, 행 우선). 눕힌 책의 작은 원근 보정도
// 동차 좌표로 포함해 그림, 속지, 윤곽이 같은 네 꼭짓점에 정확히 붙는다.
// 그림은 조각 w×h(DU)를 배율 s로 기록한 것(그림 px = DU × s).
export function panelMatrix(b: Book3, p: Panel, cam: Cam, px: Affine) {
  'worklet';
  const O = project(cam, toWorld(b, p.O));
  const U = rot(b.roll, b.yaw, p.U, b.spin ?? 0, b.pitch ?? 0);
  const V = rot(b.roll, b.yaw, p.V, b.spin ?? 0, b.pitch ?? 0);
  const s = px.s;
  // 원근 카메라(eye)는 사선 없이 눈 쪽으로 모으는 것과 같다(camera.project): 같은 동차 행렬로 그린다
  const t = cam.eye ? { x: cam.eye.x, y: -cam.eye.y, z: cam.eye.z, strength: 1 / cam.eye.dist } : null;
  const kx = cam.eye ? 0 : cam.kx;
  const ky = cam.eye ? 0 : cam.ky;
  if (t) {
    const o = toWorld(b, p.O);
    const d0 = 1 + (o.z - t.z) * t.strength;
    const du = U.z * t.strength / (p.w * s);
    const dv = V.z * t.strength / (p.h * s);
    return [
      (U.x + U.z * kx + t.x * U.z * t.strength) / p.w + px.tx * du,
      (V.x + V.z * kx + t.x * V.z * t.strength) / p.h + px.tx * dv,
      O.x * s * d0 + px.tx * d0,
      (-(U.y + U.z * ky) + t.y * U.z * t.strength) / p.w + px.ty * du,
      (-(V.y + V.z * ky) + t.y * V.z * t.strength) / p.h + px.ty * dv,
      O.y * s * d0 + px.ty * d0,
      du, dv, d0,
    ];
  }
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

// 면이 보이는가: 카메라 쪽을 향하고(뒷면 거르기), 받침에 닿은 아래 면(바닥·아래 책에 닿는 면)이 아닐 때.
// 아래를 향해도 들린 면은 보인다: 뒤로 젖힌 표지 책은 뒤쪽 아래 모서리만 선반에 닿고 꼬리가 앞으로 드러난다
// (빼면 그 자리에 속지·판 그림 없이 바탕 책 색이 칠해져 밑이 책 색 판이나 흰 판으로 보였다)
export function faceVisible(cam: Cam, b: Book3, f: FaceId) {
  'worklet';
  if (facing(cam, b, f) <= 0.002) return false;
  if (rot(b.roll, b.yaw, faceNormal(f), b.spin ?? 0, b.pitch ?? 0).y >= -0.5) return true;
  const cs = corners(b);
  let lo = Infinity;
  for (const c of cs) lo = Math.min(lo, c.y);
  return faceCorners(f).some((i) => cs[i].y > lo + 0.5);
}

// 종이 단면 면(머리·꼬리·책배) 하나의 화면 모양: 열린 칸, 속지 조각 행렬, 판·책등 테두리, 안쪽 벽(캔버스 px, pageFace 벽 순서, 안 보이면 빈 배열)
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
  for (const w of pf.walls) {
    const n = rot(b.roll, b.yaw, w.n, b.spin ?? 0, b.pitch ?? 0);
    // 원근 카메라는 벽 조각 첫 꼭짓점 자리에서 본다
    const k = viewAt(cam, toWorld(b, w.pts[0]));
    walls.push((n.x * k.kx + n.y * k.ky - n.z) / Math.hypot(k.kx, k.ky, 1) > 0.002 ? w.pts.map(P) : []);
  }
  return { ok: true, opening: pf.opening.map(P), pageM: panelMatrix(b, pf.page, cam, px), rims: pf.rims.map((r) => r.map(P)), walls };
}

// 볼록 다각형을 r만큼 안으로 줄인 모양: 변마다 안쪽으로 r 민 반평면들의 교집합(변이 짧으면 그 변은 사라진다).
function insetConvex(pts: Point[], r: number): Point[] {
  'worklet';
  const n = pts.length;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x / n;
    cy += p.y / n;
  }
  let poly = pts.slice();
  for (let i = 0; i < n && poly.length >= 3; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    if ((cx - a.x) * nx + (cy - a.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const out: Point[] = [];
    for (let j = 0; j < poly.length; j++) {
      const P = poly[j];
      const Q = poly[(j + 1) % poly.length];
      const dp = (P.x - a.x) * nx + (P.y - a.y) * ny - r;
      const dq = (Q.x - a.x) * nx + (Q.y - a.y) * ny - r;
      if (dp >= 0) out.push(P);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        out.push({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t });
      }
    }
    poly = out;
  }
  return poly;
}

// 책 전체의 투영 윤곽(8 꼭짓점의 볼록 껍질)을 같은 반지름 r로 둥글린 모양(캔버스 px): 윤곽을 r만큼 안으로 줄였다가 둥근 이음으로
// r만큼 다시 넓힌다(민코프스키). 낮은 시점(기본 4°)에서 머리 쪽은 짧은 변 두세 개가 몰려 있어 꼭짓점마다 깎으면 반지름이 거의 사라졌다
// (시안 책등 위 모서리 약 2.6~4.3DU 둥글기가 1~2px로만 보였다). 이렇게 하면 그 짧은 변들을 한 번에 둥글린다.
// 윤곽이 너무 얇아(폭 < 2r) 줄인 모양이 없어지면 반지름을 줄여 다시 하고, 그래도 안 되면 껍질 그대로.
// Shared by the book and shelf silhouettes; never grows beyond the original hull.
// 볼록 다각형 poly를 볼록 다각형 clip 안쪽만 남긴다(서덜랜드–호지먼). 경로 자르기(clip)는 안티에일리어싱이 없어 계단이 되므로
// 둥근 윤곽 안 면을 다각형으로 미리 잘라 안티에일리어싱되는 경로로 칠할 때
export function clipConvexBy(poly: Point[], clip: Point[]): Point[] {
  'worklet';
  const m = clip.length;
  if (m < 3) return poly;
  let cx = 0;
  let cy = 0;
  for (const p of clip) {
    cx += p.x / m;
    cy += p.y / m;
  }
  let out = poly;
  for (let i = 0; i < m && out.length >= 3; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % m];
    const side = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const sc = side({ x: cx, y: cy }) >= 0 ? 1 : -1;
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j];
      const Q = inp[(j + 1) % inp.length];
      const sp = side(P) * sc;
      const sq = side(Q) * sc;
      if (sp >= 0) out.push(P);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t });
      }
    }
  }
  return out;
}
export function roundedPolygon(pts: Point[], radius: number): Point[] {
  'worklet';
  let r = radius;
  let core: Point[] = [];
  for (let k = 0; k < 3; k++, r /= 2) {
    core = insetConvex(pts, r);
    if (core.length >= 3) break;
  }
  if (core.length < 3) return pts;
  const n = core.length;
  let cx = 0;
  let cy = 0;
  for (const p of core) {
    cx += p.x / n;
    cy += p.y / n;
  }
  // 변의 바깥 법선
  const normal = (a: Point, b: Point) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = (b.y - a.y) / len;
    let ny = -(b.x - a.x) / len;
    if ((a.x - cx) * nx + (a.y - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x: nx, y: ny };
  };
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const v = core[i];
    const n0 = normal(core[(i + n - 1) % n], v);
    const n1 = normal(v, core[(i + 1) % n]);
    const a0 = Math.atan2(n0.y, n0.x);
    let da = Math.atan2(n1.y, n1.x) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 10)));
    for (let j = 0; j <= steps; j++) {
      const a = a0 + (da * j) / steps;
      out.push({ x: v.x + r * Math.cos(a), y: v.y + r * Math.sin(a) });
    }
  }
  return out;
}

// radius: 둥글기(DU). 주지 않으면 EDGE_R(워클릿은 기본값 매개변수를 싣지 않아 본문에서 정한다)
export function silhouette(cam: Cam, b: Book3, px: Affine, radius?: number): Point[] {
  'worklet';
  const r = radius === undefined ? EDGE_R : radius;
  const pts = hull(corners(b).map((c) => {
    const q = project(cam, c);
    return { x: q.x * px.s + px.tx, y: q.y * px.s + px.ty };
  }));
  return roundedPolygon(pts, r * px.s);
}

export const seedOf = (id: string, f: string) => [...id].reduce((h, c) => h + c.charCodeAt(0), 0) * 0.37 + f.length;
