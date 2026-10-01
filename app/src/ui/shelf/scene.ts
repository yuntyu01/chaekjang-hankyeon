// 홈 선반 장면 상태(하나). 줄마다 움직임(트랙·진행률)과 줄 위치, 공통 카메라가 UI 스레드 SharedValue에 있고,
// 책 면·그림자·선택 빛·손잡이·터치 판정이 모두 여기서 같은 프레임의 3D 자세를 읽는다.
// - 3D: 줄마다 자기 선반 공간(판 윗면 y=0). 줄 사이는 3D 줄 간격(dy)만큼 떨어진 한 공간이다(카메라와 무관).
// - 가림: 모든 줄의 책과 선반 판을 한 번에 분리축으로 앞뒤를 정한다(drawOrder). 윗선반 판이 아래 줄 책머리를 가리고,
//   다른 줄로 옮겨 가는 책처럼 줄 경계를 지나는 책도 같은 규칙으로 정해진다.
// - 터치: 지금 보이는 윤곽과 가림 순서로 가장 앞에 보이는 책을 고른다(UI 스레드, 그리는 것과 같은 프레임).
// 워클릿은 만들어질 때 쓰는 함수를 붙잡으므로, 쓰이는 함수를 먼저 정의한다.
import { makeMutable, type SharedValue } from 'react-native-reanimated';

import { corners, depthKey, drawOrder, frontOf, toWorld, type Book3 } from '@/domain/book3';
import { hull } from '@/domain/box';
import { toPx, type Affine, type Cam, type Point } from '@/domain/camera';
import { SHELF, SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from '@/domain/geometry';
import { pointInPoly } from '@/domain/shelf-scene';
import { bookAt, holdTrack, type Track } from '@/domain/transition';
import { silhouette } from '@/ui/book3d/face-geometry';
import { RIBBON_OUT } from '@/ui/shelf/metrics';

export type Tracks = Record<string, Track>;
// 막 다른 줄로 떠난 책이 이 줄에 남기는 경로(이 줄 좌표): 그 책이 지금 있는 줄의 경로를 세로로 옮긴 것과 그 진행 시각.
// t0: 경로가 출발한 이 줄 시계(awayT) 값(출발 전이면 Infinity = 출발 자세), dur·out: 그 책이 있는 줄 경로와 같은 길이·감속,
// k: 그림자가 더는 이 줄에 없는 진행(실제 시간 비율). 책마다 따로 시각을 가져, 한 줄에서 여러 권이 떠나거나 가는 줄이 경로를 다시 짜도
// 서로의 진행을 건드리지 않는다.
export type AwayEntry = { tr: Track; t0: number; dur: number; out: boolean; k: number };
export type Aways = Record<string, AwayEntry>;
// 한 줄의 움직임: 책마다 경로(트랙)와 줄 전체가 함께 쓰는 진행률 t(0→1).
// away: 막 다른 줄로 떠난 책의 남는 경로(AwayEntry). awayT: 남는 경로가 있는 동안 실제 시간(ms)으로 흐르는 이 줄의 시계.
// 이동 캔버스가 그 책을 그리고 있지 않으면 이 줄은 그 책이 이 줄 공간 안에 있는 동안 그 자세로 계속 그리고
// (이동 캔버스의 첫 그림이 늦어도 빈 프레임이 없게), 그 책이 이 줄에 드리우던 그림자(벽·선반 윗면·틈·이웃 책 면)는 늘 실제 경로를 따라 옅어진다.
// 그 책이 있는 줄이 경로를 다시 짜면 남는 경로도 새 경로로 옮겨 잇는다(그림자가 한 프레임에 사라지지 않게, planner awaysOf).
export type Motion = { tracks: SharedValue<Tracks>; t: SharedValue<number>; away: SharedValue<Aways>; awayT: SharedValue<number> };

export function makeMotion(init: Book3[]): Motion {
  return { tracks: makeMutable<Tracks>(Object.fromEntries(init.map((b) => [b.id, holdTrack(b)]))), t: makeMutable(1), away: makeMutable<Aways>({}), awayT: makeMutable(0) };
}

// 경로 진행 감속(Reanimated Easing.out(cubic) / Easing.inOut(cubic)과 같은 식)
export function easeOf(out: boolean, u: number) {
  'worklet';
  if (out) return 1 - Math.pow(1 - u, 3);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

// 남는 경로의 지금 자세(이 줄 시계 clock): 그 책이 있는 줄의 경로와 같은 시각·감속, 그림자가 없어지는 진행 k에서 멈춘다
export function awayAt(e: AwayEntry, clock: number): Book3 {
  'worklet';
  const u = e.t0 === Infinity || !(e.dur > 0) ? 0 : Math.max(0, Math.min(e.k, (clock - e.t0) / e.dur));
  return bookAt(e.tr, easeOf(e.out, u));
}

// 이 줄에서 지금 이 책의 자세(없으면 null). 멈춘 책은 늘 같은 객체라, 읽는 쪽 계산이 다시 돌지 않는다.
export function bodyOf(m: Motion, id: string): Book3 | null {
  'worklet';
  const tr = m.tracks.value[id];
  return tr ? bookAt(tr, m.t.value) : null;
}

// 이 줄에 그림자를 드리우는 자세: 이 줄의 책, 또는 막 다른 줄로 떠난 책(away, 이 줄 좌표)
export function shadeOf(m: Motion, id: string): Book3 | null {
  'worklet';
  const tr = m.tracks.value[id];
  if (tr) return bookAt(tr, m.t.value);
  const a = m.away.value[id];
  return a ? awayAt(a, m.awayT.value) : null;
}

// 줄 위치(UI 스레드용): 콘텐츠 px의 책 기준선, 맨 윗줄 기준 3D 세로 거리 dy(DU, 아래로 +), 그 줄의 3D 줄 간격 space
export type SceneRow = { shelfId: string; baseline: number; dy: number; space: number };
export type SceneGeo = { rows: SceneRow[]; s: number; originX: number };
export type SceneMotion = { shelfId: string; m: Motion };

// 줄의 px 변환(콘텐츠 px): 그 줄 책 기준선 왼쪽 끝이 원점. JS 쪽 rowAffine(metrics)과 같은 식.
export function rowPx(geo: SceneGeo, row: SceneRow): Affine {
  'worklet';
  return { s: geo.s, tx: geo.originX + SHELF.sideMargin * geo.s, ty: row.baseline };
}

// 줄 선반 판의 3D 상자(그 줄 공간). 책과 같은 Book3로 두고 분리축 가림 순서에 함께 넣는다.
export function plankBody(shelfId: string, dy: number): Book3 {
  'worklet';
  return { id: `plank:${shelfId}`, dims: { T: SHELF_X1 - SHELF_X0, H: SHELF_THICK, W: SHELF_FRONT + SHELF_DEPTH }, roll: 0, yaw: 0, t: { x: SHELF_X0, y: -SHELF_THICK - dy, z: -SHELF_FRONT } };
}

export function lowered(b: Book3, dy: number): Book3 {
  'worklet';
  return dy ? { ...b, t: { x: b.t.x, y: b.t.y - dy, z: b.t.z } } : b;
}

// 줄 캔버스에 실제로 올라간 책(책 id → 올라간 줄들). 줄 캔버스의 책이 첫 그림을 낸 뒤 표시된다(ShelfMotion RowBook).
// 한 책이 여러 줄에 올라가 있을 수 있다: 끄는 책은 손가락이 지나간 줄에 미리 올려 둔다(그 줄의 트랙이 생기면 바로 그 줄이 그린다).
// 다른 줄로 막 옮겨 간 책은 새 줄 캔버스에 올라가기 전까지 이동 캔버스가 계속 그린다(캔버스에 책을 올리는 일은 JS에서 늦게 끝난다).
export type Present = Record<string, Record<string, true>>;
export const presentSV = makeMutable<Present>({});
// 실제로 그릴 수 있게 된 캔버스(책 id → 줄 id, 이동 캔버스는 TRANSIT_ROW): 그 캔버스의 책 그림이 첫 그림을 낸 뒤 그 책의 화면 계산이
// 처음 돈 때 표시한다(ShelfMotion RowBook·ShelfScene TransitBook). present는 캔버스에 올라간 순간(첫 그림 전)이라 그때 넘겨주면
// 아무도 그리지 않는 프레임이 생길 수 있어, 이동 캔버스가 손을 떼는 판단(transitLead)은 live로 한다.
export const TRANSIT_ROW = '@transit';
export const liveSV = makeMutable<Present>({});
// 미리 그려 둘 책: 끄는 책이 다른 줄 위로 처음 가면(다른 줄로 옮겨 갈 수 있게 되면) 이동 캔버스가 그 책을 줄 그림과 같은 자세로
// 위에 겹쳐 그려 둔다. 이동 캔버스의 첫 그림(그림·질감을 처음 올리는 비용)이 경로 첫 프레임에 몰리지 않게. 끌기가 끝나면 거둔다.
export const warmSV = makeMutable<string | null>(null);

// 이 책의 지금 줄과 자세: 모든 줄 움직임 가운데 이 책 트랙이 있는 줄(한 줄뿐이다)
export function locate(list: SceneMotion[], geo: SceneGeo, id: string): { row: SceneRow; b: Book3 } | null {
  'worklet';
  for (const row of geo.rows)
    for (const e of list) {
      if (e.shelfId !== row.shelfId) continue;
      const tr = e.m.tracks.value[id];
      if (tr) return { row, b: bookAt(tr, e.m.t.value) };
    }
  return null;
}

// 책이 제 줄 공간(판 윗면 ~ 윗선반 아랫면) 밖에 걸쳐 있다 = 다른 줄로 옮겨 가는 중. 그동안은 줄 캔버스가 아니라
// 맨 위 이동 캔버스가 그린다(ShelfScene). 제 줄 안에서 들어 올리거나 앞으로 빼는 것은 줄 공간 안이다.
export function outsideRow(b: Book3, space: number) {
  'worklet';
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of corners(b)) {
    lo = Math.min(lo, c.y);
    hi = Math.max(hi, c.y);
  }
  return lo < -1 || hi > space + 1;
}

// 줄 공간 밖으로 이만큼(DU) 넘게 나간 책은 그 줄에 그림자를 드리우지 않는다(그 안에서는 거리에 따라 옅어진다)
export const OUT_SHADE_MAX = 40;

// 제 줄 공간 밖으로 벗어난 거리(DU, 안이면 0). 옮겨 가는 동안 그 책의 줄 그림자를 거리에 따라 옅게 하는 데 쓴다.
export function outsideDist(b: Book3, space: number) {
  'worklet';
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of corners(b)) {
    lo = Math.min(lo, c.y);
    hi = Math.max(hi, c.y);
  }
  return Math.max(0, -1 - lo, hi - space - 1);
}

// 이 줄이 그리는 자세: 이 줄 트랙이 있고 줄 공간 안일 때만(아니면 null). 멈춘 책은 늘 같은 객체라 읽는 쪽 계산이 다시 돌지 않고,
// 다른 줄로 옮겨 가며 줄 공간 밖에 있는 동안(이동 캔버스가 그린다)도 null로 멈춰 있어 이 줄 캔버스가 매 프레임 다시 그려지지 않는다.
// withAway: 막 떠난 책(away)도 이 줄 공간 안에 있는 동안은 그린다(책 그림에만. 선택 빛·놓일 범위는 지금 이 줄의 책만)
export function drawnOf(m: Motion, id: string, space: number, withAway?: boolean): Book3 | null {
  'worklet';
  const tr = m.tracks.value[id];
  if (!tr) {
    const a = withAway === true ? m.away.value[id] : undefined;
    if (!a) return null;
    const b = awayAt(a, m.awayT.value);
    return outsideRow(b, space) ? null : b;
  }
  if (!tr.moving && tr.rest) return tr.rest;
  const b = bookAt(tr, m.t.value);
  return outsideRow(b, space) ? null : b;
}

// 이 줄 그림자에 쓰는 자세(shadeOf): 줄 공간 밖으로 OUT_SHADE_MAX 넘게 떨어진 책은 그림자가 없으므로 null로 멈춘다
export function shadeIn(m: Motion, id: string, space: number): Book3 | null {
  'worklet';
  const tr = m.tracks.value[id];
  if (tr && !tr.moving && tr.rest) return tr.rest;
  const b = shadeOf(m, id);
  return b && outsideDist(b, space) <= OUT_SHADE_MAX ? b : null;
}
export type Poses = Record<string, Book3 | null>;

// 이동 캔버스가 이 책을 그릴 때: 제 줄 공간 밖에 걸쳐 있거나(옮겨 가는 중), 지금 줄 캔버스가 아직 그 책을 그릴 수 없거나(live 전),
// 미리 그려 두는 책이다(warm, 줄 그림 위에 같은 자세로). 이동 캔버스만 그리는 때(lead)는 앞의 둘이다.
// live·warm은 부르는 쪽 계산에서 .value로 읽어 넘긴다(계산이 그 값의 변화를 알고 다시 돌게: 함수 안에서 읽으면 모른다).
export function transitLead(list: SceneMotion[], geo: SceneGeo, id: string, live: Present) {
  'worklet';
  const at = locate(list, geo, id);
  if (!at) return false;
  return outsideRow(at.b, at.row.space) || !live[id]?.[at.row.shelfId];
}
export function transitVisible(list: SceneMotion[], geo: SceneGeo, id: string, live: Present, warm: string | null) {
  'worklet';
  return warm === id ? !!locate(list, geo, id) : transitLead(list, geo, id, live);
}

// 화면 투영 범위(설계 단위, 위가 +): 겹칠 수 있는 쌍만 앞뒤를 따진다
function screenBox(b: Book3, cam: Cam) {
  'worklet';
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const c of corners(b)) {
    const x = c.x + c.z * cam.kx;
    const y = c.y + c.z * cam.ky;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}

// 갈피 끈(책 머리 위로 나온 끈)의 화면 윤곽(콘텐츠 px): BookNode Ribbons와 같은 자리·회전, 끈 폭·길이를 조금 넉넉히
function ribbonQuad(cam: Cam, aff: Affine, b: Book3, n: number): Point[] {
  'worklet';
  const d = b.dims;
  const o = toPx(cam, aff, toWorld(b, { x: d.T * 0.55, y: d.H, z: d.W * 0.18 }));
  const half = ((n * 6.8 + (n - 1) * 2.4) / 2 + 0.8) * aff.s;
  const top = -(RIBBON_OUT + 0.8) * aff.s;
  const bottom = 1.2 * aff.s;
  const a = (b.roll * Math.PI) / 180;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const local = [
    { x: -half, y: top },
    { x: half, y: top },
    { x: half, y: bottom },
    { x: -half, y: bottom },
  ];
  const out: Point[] = [];
  for (const q of local) out.push({ x: o.x + q.x * c - q.y * sn, y: o.y + q.x * sn + q.y * c });
  return out;
}

// 옮겨 가는 책(shelfId 줄의 id) 앞에 있는 것들(다른 책·선반 판, 모든 줄)의 화면 윤곽(콘텐츠 px).
// 이동 캔버스는 모든 줄 캔버스 위에 있으므로, 그 책은 이 윤곽들 밖에만 그려야 가림이 맞다.
// 책은 줄 캔버스가 실제로 그리는 둥근 윤곽(face-geometry silhouette)으로 자른다(상자 꼭짓점 윤곽이면 모서리에 틈이 남는다).
// 앞 책의 갈피 끈(ribbons: 책 id → 끈 수)도 그 책과 같은 깊이로 앞을 가린다. 같이 옮겨 가는 다른 책(transit: 이동 캔버스에 올라간 책)은
// 줄 공간 밖에 있어도 넣어, 이동 캔버스 안에서 그리는 순서(id 순)와 상관없이 실제 깊이로 서로 가린다.
export function frontOccluders(list: SceneMotion[], geo: SceneGeo, cam: Cam, shelfId: string, id: string, ribbons?: Record<string, number>, transit?: Record<string, true>): Point[][] {
  'worklet';
  const out: Point[][] = [];
  let B: Book3 | null = null;
  for (const row of geo.rows) {
    if (row.shelfId !== shelfId) continue;
    for (const e of list) {
      if (e.shelfId !== shelfId) continue;
      const tr = e.m.tracks.value[id];
      if (tr) B = lowered(bookAt(tr, e.m.t.value), row.dy);
    }
  }
  if (!B) return out;
  const bb = screenBox(B, cam);
  for (const row of geo.rows) {
    const aff = rowPx(geo, row);
    for (const e of list) {
      if (e.shelfId !== row.shelfId) continue;
      const tracks = e.m.tracks.value;
      const t = e.m.t.value;
      for (const k in tracks) {
        if (row.shelfId === shelfId && k === id) continue;
        const b = bookAt(tracks[k], t);
        if (outsideRow(b, row.space) && !(transit && transit[k])) continue;
        const L = lowered(b, row.dy);
        const lb = screenBox(L, cam);
        const n = ribbons ? ribbons[k] ?? 0 : 0;
        const up = n > 0 ? RIBBON_OUT + 2 : 0; // 갈피 끈이 머리 위로 나온 만큼 위로 넓혀 본다(DU)
        if (lb.x1 < bb.x0 - 0.5 || bb.x1 < lb.x0 - 0.5 || lb.y1 + up < bb.y0 - 0.5 || bb.y1 < lb.y0 - 0.5) continue;
        if (frontOf(L, B, cam) >= 0) continue;
        out.push(silhouette(cam, b, aff));
        if (n > 0) out.push(ribbonQuad(cam, aff, b, n));
      }
    }
    const pb = plankBody(row.shelfId, 0);
    const PL = lowered(pb, row.dy);
    const pbb = screenBox(PL, cam);
    if (pbb.x1 < bb.x0 - 0.5 || bb.x1 < pbb.x0 - 0.5 || pbb.y1 < bb.y0 - 0.5 || bb.y1 < pbb.y0 - 0.5) continue;
    if (frontOf(PL, B, cam) < 0) out.push(hull(corners(pb).map((q) => toPx(cam, aff, q))));
  }
  return out;
}

// 장면 전체의 그리는 순서(키 → 순위, 작을수록 먼저 = 뒤). 책 키는 책 id, 판은 'plank:선반id'.
// drawnOnly: 줄 캔버스 한 줄의 순서(그 줄이 그리는 책만). 다른 줄로 옮겨 가며 줄 공간 밖에 있는 책(이동 캔버스가 그린다)은 빼서,
// 그 책이 움직이는 동안 이 줄 순위가 바뀌어 줄 캔버스가 다시 그려지지 않게 한다. 막 떠난 책(away)은 이 줄 공간 안에 있는 동안
// 이 줄이 그리므로 넣는다.
export function sceneOrder(list: SceneMotion[], geo: SceneGeo, cam: Cam, drawnOnly?: boolean): Record<string, number> {
  'worklet';
  const bs: Book3[] = [];
  for (const row of geo.rows) {
    let m: Motion | null = null;
    for (const e of list) if (e.shelfId === row.shelfId) m = e.m;
    if (m) {
      const tracks = m.tracks.value;
      const t = m.t.value;
      for (const id in tracks) {
        const b = bookAt(tracks[id], t);
        if (drawnOnly === true && outsideRow(b, row.space)) continue;
        bs.push(lowered(b, row.dy));
      }
      if (drawnOnly === true) {
        const away = m.away.value;
        for (const id in away) {
          if (tracks[id]) continue;
          const b = awayAt(away[id], m.awayT.value);
          if (!outsideRow(b, row.space)) bs.push(lowered(b, row.dy));
        }
      }
    }
    bs.push(plankBody(row.shelfId, row.dy));
  }
  const r = drawOrder(bs, cam, depthKey);
  const out: Record<string, number> = {};
  for (let i = 0; i < bs.length; i++) out[bs[i].id] = r[i];
  return out;
}

// ---------- 터치 판정 ----------
function distToPoly(p: Point, poly: Point[]) {
  'worklet';
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
    best = Math.min(best, Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy));
  }
  return best;
}

export type Pick = { shelfId: string; bookId: string } | null;

// 콘텐츠 px의 한 점에서 가장 앞에 보이는 책. 선반 판(앞면·윗면)이 앞에 있으면 책이 아니다.
// 윤곽 안에 들어간 것이 없으면 slopPx 안에서 가장 가까운(같으면 앞에 있는) 책.
export function pickAt(list: SceneMotion[], geo: SceneGeo, cam: Cam, x: number, y: number, slopPx: number): Pick {
  'worklet';
  const order = sceneOrder(list, geo, cam);
  let best: Pick = null;
  let bestRank = -1;
  let near: Pick = null;
  let nearD = Infinity;
  let nearRank = -1;
  for (const row of geo.rows) {
    const aff = rowPx(geo, row);
    const px = (q: { x: number; y: number; z: number }) => toPx(cam, aff, q);
    // 판: 앞에 있으면 그 뒤 책은 가려진다
    const plank = plankBody(row.shelfId, 0);
    const pr = order[plank.id] ?? -1;
    const pp = hull(corners(plank).map(px));
    if (pointInPoly({ x, y }, pp) && pr > bestRank) {
      best = null;
      bestRank = pr;
    }
    let m: Motion | null = null;
    for (const e of list) if (e.shelfId === row.shelfId) m = e.m;
    if (!m) continue;
    const tracks = m.tracks.value;
    const t = m.t.value;
    for (const id in tracks) {
      const b = bookAt(tracks[id], t);
      const poly = hull(corners(b).map(px));
      const r = order[id] ?? 0;
      if (pointInPoly({ x, y }, poly)) {
        if (r > bestRank) {
          best = { shelfId: row.shelfId, bookId: id };
          bestRank = r;
        }
      } else {
        const d = distToPoly({ x, y }, poly);
        if (d <= slopPx && (d < nearD - 0.5 || (Math.abs(d - nearD) <= 0.5 && r > nearRank))) {
          near = { shelfId: row.shelfId, bookId: id };
          nearD = d;
          nearRank = r;
        }
      }
    }
  }
  if (bestRank >= 0) return best;
  return near;
}

// 선반 앞면(시점 끌기 띠): 지금 카메라로 투영한 판 앞면의 세로 범위(콘텐츠 px), 최소 minPx 높이로 넓힌다
export function plankFrontBand(row: SceneRow, geo: SceneGeo, cam: Cam, minPx: number, padPx: number) {
  'worklet';
  const top = row.baseline + SHELF_FRONT * cam.ky * geo.s;
  const bottom = top + SHELF_THICK * geo.s;
  const grow = Math.max(padPx, (minPx - (bottom - top)) / 2);
  return { y0: top - grow, y1: bottom + grow };
}
