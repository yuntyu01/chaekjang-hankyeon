// 상자 옆면·윗면의 모양 계산(워클릿). 선반 줄·드래그·서랍 모두 이것 하나로 면을 만든다.
// UI 스레드에서 매 프레임 지금 자세(Book3)로 다시 계산한다. 워클릿은 쓰는 함수를 먼저 정의한다(만들 때 붙잡는다).
// 면 윤곽 순서 [A, B, Bb, Ab]: A→B = 지금 가장 앞을 향한 면(주 면)과 맞닿은 변(주 면의 반시계 순서), Ab·Bb = 뒤쪽 끝.
import { corners, faceFrame, facing, faceCorners, faceNormal, FACE_IDS, rot, toWorld, type Book3, type Cam, type FaceId } from '@/domain/book3';
import { project } from '@/domain/box';
import type { Point } from '@/domain/shelf-scene';

export type FaceKind = 'top' | 'right' | 'left' | 'bottom';
// 장면 좌표 → 캔버스 px: X = x * s + tx, Y = y * s + ty
export type Affine = { s: number; tx: number; ty: number };

export type FaceGeom = {
  ok: boolean;
  lit: boolean; // 빛을 받는 쪽(위·왼쪽) 면
  all: Point[]; // 면 윤곽(둥근 모서리·손그림 흔들림)
  runs: Point[][]; // 바깥 실루엣 변(연한 선)
  inner: Point[] | null; // 종이 단면
  lines: Point[][]; // 종이 결 선
  hi: Point[]; // 빛 받는 모서리 광택
  A: Point;
  B: Point;
  Ab: Point;
  mid: Point; // 모서리 명암이 풀리는 곳
};

export const EMPTY_FACE: FaceGeom = { ok: false, lit: false, all: [], runs: [], inner: null, lines: [], hi: [], A: { x: 0, y: 0 }, B: { x: 0, y: 0 }, Ab: { x: 0, y: 0 }, mid: { x: 0, y: 0 } };

// 손으로 그은 선의 흔들림(0 근처 부드러운 잡음). t는 선을 따라간 거리(px), s = 1DU px.
function wobbleAt(t: number, s: number, seed: number) {
  'worklet';
  return 0.65 * Math.sin((t / (24 * s)) * Math.PI * 2 + seed) + 0.35 * Math.sin((t / (10 * s)) * Math.PI * 2 + seed * 2.3);
}

function sub(a: Point, b: Point) {
  'worklet';
  return { x: a.x - b.x, y: a.y - b.y };
}

function unit(v: Point) {
  'worklet';
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

// 부드러운 면 윤곽: 모서리마다 둥글기(radii), 변마다 손그림 흔들림(wob)과 볼록함(bulge: 변 가운데를 이 벡터만큼 민다).
// outer: 바깥 실루엣에 해당하는 변(연한 선을 그을 곳). 다른 면과 이어지는 변은 곧게 두고 선을 긋지 않는다.
export function softFace(pts: Point[], radii: number[], wob: boolean[], outer: boolean[], bulge: (Point | null)[] | null, s: number, seed: number) {
  'worklet';
  const n = pts.length;
  const amp = 0.32 * s;
  const p0: Point[] = [];
  const p1: Point[] = [];
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    const pr = pts[(i + n - 1) % n];
    const nx = pts[(i + 1) % n];
    const lp = Math.hypot(pr.x - c.x, pr.y - c.y) || 1;
    const ln = Math.hypot(nx.x - c.x, nx.y - c.y) || 1;
    const tp = Math.min(radii[i] ?? 0, lp / 2) / lp;
    const tn = Math.min(radii[i] ?? 0, ln / 2) / ln;
    p0.push({ x: c.x + (pr.x - c.x) * tp, y: c.y + (pr.y - c.y) * tp });
    p1.push({ x: c.x + (nx.x - c.x) * tn, y: c.y + (nx.y - c.y) * tn });
  }
  const corner: Point[][] = [];
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    if (!((radii[i] ?? 0) > 0)) {
      corner.push([c]);
      continue;
    }
    const out: Point[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      const u = 1 - t;
      out.push({ x: u * u * p0[i].x + 2 * u * t * c.x + t * t * p1[i].x, y: u * u * p0[i].y + 2 * u * t * c.y + t * t * p1[i].y });
    }
    corner.push(out);
  }
  const edge: Point[][] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const from = p1[i];
    const to = p0[(i + 1) % n];
    const L = Math.hypot(to.x - from.x, to.y - from.y);
    const full = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const d = unit(sub(to, from));
    const nrm = { x: -d.y, y: d.x };
    const out: Point[] = [];
    const steps = Math.max(1, Math.floor(L / (1.5 * s)));
    const bv = bulge ? bulge[i] : null;
    for (let k = 1; k < steps; k++) {
      const t = (k / steps) * L;
      const q = { x: from.x + d.x * t, y: from.y + d.y * t };
      const u = Math.hypot(q.x - a.x, q.y - a.y) / full;
      const off = wob[i] ? amp * wobbleAt(t + i * 37 * s, s, seed) * Math.sin((Math.PI * k) / steps) : 0;
      const bs = Math.sin(Math.PI * u);
      out.push({ x: q.x + nrm.x * off + (bv ? bv.x * bs : 0), y: q.y + nrm.y * off + (bv ? bv.y * bs : 0) });
    }
    edge.push(out);
  }
  const all: Point[] = [];
  for (let i = 0; i < n; i++) {
    for (const q of corner[i]) all.push(q);
    for (const q of edge[i]) all.push(q);
  }
  // 바깥 변 이어 긋기
  const runs: Point[][] = [];
  let start = -1;
  for (let i = 0; i < n; i++) if (!outer[i]) start = i;
  if (start < 0) runs.push([...all, all[0]]);
  else {
    let run: Point[] = [];
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (!outer[i]) continue;
      if (outer[(i + n - 1) % n]) for (const q of corner[i]) run.push(q);
      else run = [p1[i]];
      for (const q of edge[i]) run.push(q);
      const nx = (i + 1) % n;
      if (!outer[nx]) {
        run.push(p0[nx]);
        runs.push(run);
        run = [];
      }
    }
  }
  return { all, runs };
}

// 면 네 꼭짓점의 둥글기·흔들림·바깥 변. visibleFaces 순서:
// top = [A 앞 오른쪽 위(옆면과 공유), B 앞 왼쪽 위, Bb 뒤 왼쪽, Ab 뒤 오른쪽(옆면과 공유)], 변 0 = 앞, 1 = 왼쪽, 2 = 뒤, 3 = 옆면과 공유
// right = [A 앞 오른쪽 아래, B 앞 오른쪽 위(윗면과 공유), Bb 뒤 위, Ab 뒤 아래], 변 0 = 앞, 1 = 윗면과 공유, 2 = 뒤, 3 = 바닥
function faceStyle(kind: FaceKind, s: number) {
  'worklet';
  if (kind === 'top') return { radii: [0, 3 * s, 3 * s, 3 * s], wob: [false, true, true, false], outer: [false, true, true, false] };
  if (kind === 'right') return { radii: [2 * s, 0, 3 * s, 2.4 * s], wob: [false, false, true, false], outer: [false, false, true, true] };
  return { radii: [0, 0, 2 * s, 2 * s], wob: [false, true, true, true], outer: [false, true, true, true] };
}

// 면 하나의 그릴 모양. bow: 세운 책 머리의 볼록함(px), boards: 종이 단면의 판 방향(null = 표지 판 면)
// under > 0: 앞면과 맞닿은 변을 앞면 쪽으로 그만큼(px) 밀어 넣는다(앞면 둥근 모서리 틈이 비어 보이지 않게, 앞면이 덮는다)
export function computeFace(face: { poly: Point[] } | null, kind: FaceKind, px: Affine, bow: number, boards: 'u' | 'v' | null, seed: number, under = 0): FaceGeom {
  'worklet';
  if (!face) return EMPTY_FACE;
  const s = px.s;
  const P0 = (q: Point) => ({ x: q.x * s + px.tx, y: q.y * s + px.ty });
  let A = P0(face.poly[0]);
  let B = P0(face.poly[1]);
  if (under > 0) {
    const Ab0 = P0(face.poly[3]);
    const d = unit(sub(A, Ab0));
    A = { x: A.x + d.x * under, y: A.y + d.y * under };
    B = { x: B.x + d.x * under, y: B.y + d.y * under };
  }
  let Bb = P0(face.poly[2]);
  let Ab = P0(face.poly[3]);
  // 세운 책의 볼록한 머리(앞면과 같은 곡선): 윗면은 양끝이 bow만큼 내려오고 가운데가 솟는다. 옆면 위 모서리도 같이 내려온다.
  let bulge: (Point | null)[] | null = null;
  if (bow && kind === 'top') {
    const d = unit(sub(B, A));
    let nIn = { x: -d.y, y: d.x };
    const dd = sub(Ab, A);
    if (nIn.x * dd.x + nIn.y * dd.y > 0) nIn = { x: -nIn.x, y: -nIn.y };
    A = { x: A.x + nIn.x * bow, y: A.y + nIn.y * bow };
    B = { x: B.x + nIn.x * bow, y: B.y + nIn.y * bow };
    Bb = { x: Bb.x + nIn.x * bow, y: Bb.y + nIn.y * bow };
    Ab = { x: Ab.x + nIn.x * bow, y: Ab.y + nIn.y * bow };
    const up = { x: -nIn.x * bow, y: -nIn.y * bow };
    bulge = [up, null, up, null];
  } else if (bow && kind === 'right') {
    const dn = unit(sub(A, B));
    B = { x: B.x + dn.x * bow, y: B.y + dn.y * bow };
    Bb = { x: Bb.x + dn.x * bow, y: Bb.y + dn.y * bow };
  }
  const st = faceStyle(kind, s);
  // 앞면 밑으로 밀어 넣은 윗면은 앞면 둥근 모서리(약 3.4DU) 자리를 메워 모서리를 다시 각지게 만든다:
  // 바깥 앞 모서리(B)를 밀어 넣은 만큼 더 둥글게 해 앞면 모서리와 같은 곡선으로 넘어가게 한다(곡률은 그대로 작게)
  const radii = kind === 'top' && under > 0 ? [st.radii[0], 3.4 * s + under, st.radii[2], st.radii[3]] : st.radii;
  const soft = softFace([A, B, Bb, Ab], radii, st.wob, st.outer, bulge, s, seed);
  const up0 = bulge ? bulge[0] : null;
  const P = (u: number, v: number) => {
    const bs = up0 ? Math.sin(Math.PI * u) : 0;
    const ux = up0 ? up0.x : 0;
    const uy = up0 ? up0.y : 0;
    return { x: A.x + (B.x - A.x) * u + (Ab.x - A.x) * v + ux * bs, y: A.y + (B.y - A.y) * u + (Ab.y - A.y) * v + uy * bs };
  };
  const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const depth = Math.hypot(Ab.x - A.x, Ab.y - A.y) || 1;
  const bu = Math.min(0.3, (1.0 * s) / len);
  const bv = Math.min(0.3, (0.8 * s) / depth);
  let inner: Point[] | null = null;
  const lines: Point[][] = [];
  if (boards === 'u') {
    inner = [P(bu, 0), P(1 - bu, 0), P(1 - bu, 1), P(bu, 1)];
    lines.push([P(0.4, 0.05), P(0.4, 0.95)], [P(0.62, 0.05), P(0.62, 0.95)]);
  } else if (boards === 'v') {
    inner = [P(0.04, bv), P(0.96, bv), P(0.96, 1 - bv), P(0.04, 1 - bv)];
    lines.push([P(0.06, 0.45), P(0.94, 0.45)]);
  }
  const hi: Point[] = [];
  for (let k = 0; k <= 12; k++) hi.push(P(k / 12, 0));
  return {
    ok: true,
    lit: kind === 'top' || kind === 'left',
    all: soft.all,
    runs: soft.runs,
    inner,
    lines,
    hi,
    A,
    B,
    Ab,
    mid: { x: A.x + (Ab.x - A.x) * 0.45, y: A.y + (Ab.y - A.y) * 0.45 },
  };
}


// 가장 앞을 향한 면
export function mainFace(cam: Cam, b: Book3): FaceId {
  'worklet';
  let best: FaceId = 'spine';
  let bv = -Infinity;
  for (const f of FACE_IDS) {
    const v = facing(cam, b, f);
    if (v > bv) {
      bv = v;
      best = f;
    }
  }
  return best;
}

// 옆면 하나의 그릴 모양(보이지 않거나 주 면이면 EMPTY). bowS: 세운 책 머리 볼록함(px, 책등이 주 면이고 서 있을 때만).
export function sideFaceGeom(cam: Cam, b: Book3, f: FaceId, px: Affine, bowS: number, pages: boolean, seed: number): FaceGeom {
  'worklet';
  if (facing(cam, b, f) <= 0.002) return EMPTY_FACE;
  // 아래를 향한 면(바닥·아래 책에 닿는 면)은 올려다볼 때도 그리지 않는다
  if (rot(b.roll, b.yaw, faceNormal(f), b.spin ?? 0, b.pitch ?? 0).y < -0.5) return EMPTY_FACE;
  const main = mainFace(cam, b);
  if (main === f) return EMPTY_FACE;
  const cs = corners(b);
  const P = (i: number) => project(cam, cs[i]);
  const mc = faceCorners(main);
  // 주 면 꼭짓점을 화면에서 반시계(위가 +)로
  let cx = 0;
  let cy = 0;
  for (const i of mc) {
    const p = P(i);
    cx += p.x / 4;
    cy += p.y / 4;
  }
  const ord = [...mc].sort((i, j) => {
    const p = P(i);
    const q = P(j);
    return Math.atan2(-(p.y - cy), p.x - cx) - Math.atan2(-(q.y - cy), q.x - cx);
  });
  const fc = faceCorners(f);
  let A = -1;
  let B = -1;
  for (let k = 0; k < 4; k++) {
    const i = ord[k];
    const j = ord[(k + 1) % 4];
    if (fc.includes(i) && fc.includes(j)) {
      A = i;
      B = j;
    }
  }
  if (A < 0) return EMPTY_FACE;
  const ia = fc.indexOf(A);
  const ib = fc.indexOf(B);
  const nb = fc[(ib + 1) % 4] === A ? fc[(ib + 3) % 4] : fc[(ib + 1) % 4];
  const na = fc[(ia + 1) % 4] === B ? fc[(ia + 3) % 4] : fc[(ia + 1) % 4];
  const pa = P(A);
  const pb = P(B);
  const mx = (pa.x + pb.x) / 2 - cx;
  const my = (pa.y + pb.y) / 2 - cy;
  const kind: FaceKind = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : my < 0 ? 'top' : 'bottom';
  // 종이 단면에서 표지 판은 두께 방향 양끝: A→B가 두께(x) 방향이면 u, 아니면 깊이 쪽 v
  const boards = pages ? ((A ^ B) === 1 ? 'u' : 'v') : null;
  // 볼록한 머리는 세운 책만(누운 책 모서리는 곧은 직선)
  const bow = main === 'spine' && Math.abs(b.roll) < 45 && (kind === 'top' || kind === 'right') ? bowS : 0;
  // 책등·앞표지가 옆면이 될 때(비스듬히)는 그림 위에 그려지므로 밀어 넣지 않는다
  const under = f === 'spine' || f === 'cover' ? 0 : 2.4 * px.s;
  return computeFace({ poly: [pa, pb, P(nb), P(na)] }, kind, px, bow, boards, seed, under);
}

// 면 그림 px → 캔버스 px 행렬(3×3, 행 우선). 투영이 선형(직교)이라 면의 세 모서리로 정해지는 affine이 곧 면 전체의 투영이다.
export function faceMatrix(b: Book3, f: 'spine' | 'cover', cam: Cam, px: Affine) {
  'worklet';
  const fr = faceFrame(b.dims, f);
  const O = project(cam, toWorld(b, fr.O));
  const U = rot(b.roll, b.yaw, fr.U, b.spin ?? 0, b.pitch ?? 0);
  const V = rot(b.roll, b.yaw, fr.V, b.spin ?? 0, b.pitch ?? 0);
  const s = px.s;
  const ux = (U.x + U.z * cam.kx) / fr.w;
  const uy = -(U.y + U.z * cam.ky) / fr.w;
  const vx = (V.x + V.z * cam.kx) / fr.h;
  const vy = -(V.y + V.z * cam.ky) / fr.h;
  return [ux, vx, O.x * s + px.tx, uy, vy, O.y * s + px.ty, 0, 0, 1];
}

export const seedOf = (id: string, f: string) => [...id].reduce((h, c) => h + c.charCodeAt(0), 0) * 0.37 + f.length;
