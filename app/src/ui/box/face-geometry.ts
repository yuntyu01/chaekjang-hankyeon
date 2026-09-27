// 상자 옆면·윗면의 모양 계산(워클릿). 선반 줄·드래그·서랍 모두 이것 하나로 면을 만든다.
// UI 스레드에서 매 프레임 진행률 t의 상자로 다시 계산하므로, 워클릿은 쓰는 함수를 먼저 정의한다(만들 때 붙잡는다).
import { visibleFaces, type Camera, type Face, type Placed } from '@/domain/box';
import type { Point } from '@/domain/shelf-scene';
import type { Pose } from '@/domain/types';

export type FaceKind = Face['kind'];
// 장면 좌표 → 캔버스 px: X = x * s + tx, Y = y * s + ty
export type Affine = { s: number; tx: number; ty: number };

export type FaceGeom = {
  ok: boolean;
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

export const EMPTY_FACE: FaceGeom = { ok: false, all: [], runs: [], inner: null, lines: [], hi: [], A: { x: 0, y: 0 }, B: { x: 0, y: 0 }, Ab: { x: 0, y: 0 }, mid: { x: 0, y: 0 } };

// 면 재료: 표지 판(board) 또는 종이 단면(pages). k = 밝기(빛은 왼쪽 위: 윗면 밝고 오른쪽 옆면 어둡다).
// boards: 종이 단면에서 표지 판이 보이는 방향(u = 앞 모서리 방향 양끝, v = 깊이 방향 앞뒤 끝).
export function materialOf(pose: Pose, kind: FaceKind): { mat: 'board' | 'pages'; k: number; boards?: 'u' | 'v' } {
  if (pose === 'spine') return kind === 'top' ? { mat: 'pages', k: 0.97, boards: 'u' } : { mat: 'board', k: kind === 'right' ? 0.8 : 0.9 };
  if (pose === 'front') return kind === 'left' ? { mat: 'board', k: 0.9 } : { mat: 'pages', k: kind === 'top' ? 0.97 : 0.86, boards: 'v' };
  return kind === 'top' ? { mat: 'board', k: 1.02 } : { mat: 'pages', k: kind === 'right' ? 0.88 : 0.9, boards: 'u' };
}

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
  if (kind === 'top') return { radii: [0, 1.6 * s, 1.8 * s, 1.8 * s], wob: [false, true, true, false], outer: [false, true, true, false] };
  if (kind === 'right') return { radii: [1.2 * s, 0, 1.8 * s, 1.6 * s], wob: [false, false, true, false], outer: [false, false, true, true] };
  return { radii: [0, 0, 2 * s, 2 * s], wob: [false, true, true, true], outer: [false, true, true, true] };
}

export function faceAt(cam: Camera, p: Placed, kind: FaceKind): Face | null {
  'worklet';
  const sides = visibleFaces(cam, p).sides;
  for (let i = 0; i < sides.length; i++) if (sides[i].kind === kind) return sides[i];
  return null;
}

// 면 하나의 그릴 모양. bow: 세운 책 머리의 볼록함(px), boards: 종이 단면의 판 방향(null = 표지 판 면)
export function computeFace(face: Face | null, kind: FaceKind, px: Affine, bow: number, boards: 'u' | 'v' | null, seed: number): FaceGeom {
  'worklet';
  if (!face) return EMPTY_FACE;
  const s = px.s;
  const P0 = (q: Point) => ({ x: q.x * s + px.tx, y: q.y * s + px.ty });
  let A = P0(face.poly[0]);
  let B = P0(face.poly[1]);
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
  const soft = softFace([A, B, Bb, Ab], st.radii, st.wob, st.outer, bulge, s, seed);
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

// 이 상자에서 그릴 면 종류(처음·끝 모양 어느 쪽에서든 보이는 면). 윗면을 마지막에(옆면 위에) 그린다.
export function kindsOf(cam: Camera, boxes: Placed[]): FaceKind[] {
  const set = new Set<FaceKind>();
  for (const b of boxes) for (const f of visibleFaces(cam, b).sides) set.add(f.kind);
  return [...set].sort((a, b) => (a === 'top' ? 1 : 0) - (b === 'top' ? 1 : 0));
}

export const seedOf = (id: string, kind: FaceKind) => [...id].reduce((h, c) => h + c.charCodeAt(0), 0) * 0.37 + kind.length;
