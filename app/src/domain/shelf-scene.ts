// 선반 한 칸의 책 프레임 계산(순수). 렌더링·터치 판정·그림자가 모두 이 결과를 쓴다.
// 좌표: 설계 단위, x는 선반 판 안쪽 왼쪽 끝 기준, y는 아래로 증가하며 선반 바닥이 SHELF.clearHeight.
import { boxSize, collide, frontPoly, silhouette, solveLean, type Placed } from './box';
import { fromPlaced, type Book3 } from './book3';
import { bookHeight, bookThickness, CAMERA, LYING_BACK_Z, SHELF, stackOffsets } from './geometry';
import { itemPositions, placementOf, shelfItems, type BookMap } from './layout-engine';
import { firstContact, MAX_LEAN } from './lean';
import type { Book, Pose, ShelfLayout, Tilt } from './types';

export type Point = { x: number; y: number };

export type BookFrame = {
  bookId: string;
  itemKey: string;
  shelfId: string;
  pose: Pose;
  tilt: Tilt;
  // 회전 전 렌더 박스
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
  origin: 'left bottom' | 'right bottom';
  // 실제 책 윤곽(회전 후). 터치 판정과 그림자에 쓴다. 그림자 영역은 포함하지 않는다.
  poly: Point[];
  stackIndex: number;
  // 기대려 했지만 닿을 곳이 없어(또는 선반 밖이라) 바로 선 책
  leanFailed?: boolean;
  // 기댄 상대 책
  leanOn?: string;
  // 선반 공간 상자(그리기·충돌의 원본)
  box?: Placed;
};

export type ItemFrame = { key: string; x: number; width: number; bookIds: string[] };

const FLOOR = SHELF.clearHeight;
const rad = (d: number) => (d * Math.PI) / 180;

function rotateAround(p: Point, c: Point, deg: number): Point {
  const t = rad(deg);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(t) - dy * Math.sin(t), y: c.y + dx * Math.sin(t) + dy * Math.cos(t) };
}

function rectPoly(left: number, top: number, w: number, h: number): Point[] {
  return [
    { x: left, y: top },
    { x: left + w, y: top },
    { x: left + w, y: top + h },
    { x: left, y: top + h },
  ];
}

// 세운 책 기울이기: 발(footX)은 제자리, 기대는 쪽 바닥 모서리를 축으로 angle(도, 부호=방향)만큼 돌린다.
export function leanFrame(book: Book, footX: number, angle: number) {
  const w = bookThickness(book);
  const h = bookHeight(book);
  const left = footX;
  const top = FLOOR - h;
  const origin = angle > 0 ? ('right bottom' as const) : ('left bottom' as const);
  const pivot = { x: angle > 0 ? left + w : left, y: FLOOR };
  const base = rectPoly(left, top, w, h);
  let poly = angle ? base.map((p) => rotateAround(p, pivot, angle)) : base;
  const dy = FLOOR - Math.max(...poly.map((p) => p.y));
  poly = poly.map((p) => ({ x: p.x, y: p.y + dy }));
  return { left, top: top + dy, width: w, height: h, rotate: angle || 0, origin, poly };
}

// 예전 테스트·호출 호환: 고정 각도로 기울인 모양
export function tiltedFrame(footX: number, w: number, h: number, tilt: Tilt) {
  const t = rad(Math.abs(tilt));
  const top = FLOOR - h;
  if (tilt === 0) return { left: footX, top, rotate: 0, origin: 'left bottom' as const, poly: rectPoly(footX, top, w, h) };
  const left = tilt > 0 ? footX - w * (1 - Math.cos(t)) : footX + h * Math.sin(t);
  const pivot = tilt > 0 ? { x: left + w, y: FLOOR } : { x: left, y: FLOOR };
  const poly = rectPoly(left, top, w, h).map((p) => rotateAround(p, pivot, tilt));
  return { left, top, rotate: tilt, origin: tilt > 0 ? ('right bottom' as const) : ('left bottom' as const), poly };
}

// 선반 판 좌우 끝(장면 좌표). 이 밖으로 쓰러지면 바로 선다.
export const PLANK_BOUNDS = { min: -SHELF.sideMargin + 2, max: 390 - SHELF.sideMargin - 2 };

// 상자 하나에서 프레임을 만든다: 앞면 사각형(그리기 위치, 기울기 전), 회전, 투영 실루엣(터치·그림자)
function frameOf(p: Placed, bookId: string, itemKey: string, shelfId: string, tilt: Tilt, stackIndex: number): BookFrame {
  const left = p.x + p.z * CAMERA.kx;
  const top = FLOOR - (p.y + p.size.h) - p.z * CAMERA.ky;
  return {
    bookId, itemKey, shelfId, pose: p.pose, tilt,
    left, top, width: p.size.w, height: p.size.h,
    rotate: p.angle || 0,
    origin: p.angle > 0 ? 'right bottom' : 'left bottom',
    poly: silhouette(CAMERA, p),
    stackIndex,
    box: p,
  };
}

// 선반 한 칸의 상자 배치와 프레임. 충돌·기대기는 선반 공간(가로·깊이·회전), 프레임은 투영 결과.
export function computeShelf(layout: ShelfLayout, books: BookMap, shelfId: string) {
  const positions = itemPositions(shelfItems(layout, shelfId), layout, books);
  const frames: BookFrame[] = [];
  const items: ItemFrame[] = [];
  for (const { item, x, width } of positions) {
    items.push({ key: item.key, x, width, bookIds: item.bookIds });
    if (item.stacked) {
      let y = 0;
      const offs = stackOffsets(item.bookIds.map((id) => books[id]));
      item.bookIds.forEach((id, i) => {
        const b = books[id];
        const box: Placed = { bookId: id, pose: 'horizontal', size: boxSize(b, 'horizontal'), x: x + offs[i], y, z: LYING_BACK_Z, angle: 0 };
        frames.push(frameOf(box, id, item.key, shelfId, 0, i));
        y += box.size.h;
      });
      continue;
    }
    const id = item.bookIds[0];
    const b = books[id];
    const p = placementOf(layout, id)!;
    const box: Placed = { bookId: id, pose: p.pose, size: boxSize(b, p.pose), x, y: 0, z: p.pose === 'horizontal' ? LYING_BACK_Z : 0, angle: 0 };
    frames.push(frameOf(box, id, item.key, shelfId, p.pose === 'spine' ? p.tilt : 0, 0));
  }
  solveLeans(frames, layout);
  return { frames, items };
}

// 앞면 윤곽(장면 좌표, 깊이 밀림 없이 선반 공간 x·바닥 기준). 접촉·겹침 검사용. 터치·그림자는 frame.poly(투영 실루엣).
export function frontOutline(f: BookFrame): Point[] {
  return frontPoly(f.box!).map((q) => ({ x: q.x, y: FLOOR - q.y }));
}

const inside = (poly: Point[]) => poly.every((p) => p.x >= PLANK_BOUNDS.min - 0.01 && p.x <= PLANK_BOUNDS.max + 0.01);

// 기대는 책들의 각도(선반 공간). 저장된 결과(각도·상대)가 아직 맞으면 그대로 쓰고(사용자가 꾸민 모습 유지),
// 상대가 바뀌었거나 더 이상 닿지 않거나 파고들면 옆 상자에 처음 닿는 각도를 다시 구한다(0.5도 탐색 + 이분 탐색).
// 깊이 구간이 겹치는 상자만 장애물이다(뒤에 놓인 눕힌 책은 화면에서 겹쳐도 닿지 않는다).
// 순서: 오른쪽으로 기대는 책은 오른쪽 이웃부터, 왼쪽으로 기대는 책은 왼쪽부터. 연쇄를 위해 몇 번 반복한다.
function solveLeans(frames: BookFrame[], layout: ShelfLayout) {
  const leaners = frames.filter((f) => f.pose === 'spine' && f.tilt !== 0);
  if (!leaners.length) return;
  const set = (f: BookFrame, angle: number, extra: Partial<BookFrame>) => {
    Object.assign(f, frameOf({ ...f.box!, angle }, f.bookId, f.itemKey, f.shelfId, f.tilt, f.stackIndex), extra);
  };
  const ordered = [...leaners].sort((a, b) => a.box!.x - b.box!.x);
  // 마주 보고 기대는 두 권은 같은 각도로 함께 기울여 처음 닿는 곳에서 멈춘다(한 권씩 풀면 먼저 푼 책이 빈틈을 다 차지한다).
  const paired = new Set<string>();
  const byLeft = [...frames].filter((f) => f.stackIndex === 0).sort((a, b) => a.box!.x - b.box!.x);
  for (let i = 0; i + 1 < byLeft.length; i++) {
    const a = byLeft[i];
    const b = byLeft[i + 1];
    if (!(a.pose === 'spine' && b.pose === 'spine' && a.tilt > 0 && b.tilt < 0)) continue;
    const c = firstContact((d) => collide({ ...a.box!, angle: d }, { ...b.box!, angle: -d }));
    if (!c.found || c.angle === 0) continue;
    set(a, c.angle, { leanFailed: false, leanOn: b.bookId });
    set(b, -c.angle, { leanFailed: false, leanOn: a.bookId });
    paired.add(a.bookId).add(b.bookId);
  }
  const passes = [ordered.filter((f) => f.tilt < 0), [...ordered].reverse().filter((f) => f.tilt > 0)].map((pass) =>
    pass.filter((f) => !paired.has(f.bookId)),
  );
  for (let iter = 0; iter < 3; iter++) {
    for (const pass of passes) {
      for (const f of pass) {
        const dir = Math.sign(f.tilt) as -1 | 1;
        const base = { ...f.box!, angle: 0 };
        const others = frames.filter((o) => o !== f).map((o) => o.box!);
        const stored = placementOf(layout, f.bookId)?.lean;
        const partner = stored && others.find((o) => o.bookId === stored.on);
        if (stored && partner && Math.sign(stored.angle) === dir && Math.abs(stored.angle) <= MAX_LEAN) {
          const q = { ...base, angle: stored.angle };
          const touching = collide({ ...base, angle: stored.angle + dir * 0.6 }, partner);
          if (touching && !others.some((o) => collide(q, o)) && inside(frontPoly(q))) {
            set(f, stored.angle, { leanFailed: false, leanOn: stored.on });
            continue;
          }
        }
        const r = solveLean(base, dir, others, PLANK_BOUNDS);
        set(f, r.angle, { leanFailed: !r.supported, leanOn: r.on });
      }
    }
  }
}

// 확정할 때 기대기 결과를 저장한다. 기댈 곳이 없던 책은 놓은 자리에서 바로 선다(tilt 0).
export function withLeans(layout: ShelfLayout, books: BookMap): ShelfLayout {
  const result = new Map<string, BookFrame>();
  for (const shelf of layout.shelves) for (const f of computeShelf(layout, books, shelf.id).frames) result.set(f.bookId, f);
  return {
    ...layout,
    placements: layout.placements.map((p) => {
      const f = result.get(p.bookId);
      if (!f || p.pose !== 'spine' || p.tilt === 0) return p.lean ? { ...p, lean: undefined } : p;
      if (f.leanFailed) return { ...p, tilt: 0 as Tilt, lean: undefined };
      return { ...p, lean: f.leanOn ? { angle: Math.round(f.rotate * 1000) / 1000, on: f.leanOn } : undefined };
    }),
  };
}

export function pointInPoly(pt: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// 위에 그려진 책(쌓기 위쪽)을 먼저 맞힌다. slop은 손가락 여유(설계 단위).
export function hitTest(frames: BookFrame[], pt: Point, slop = 3): BookFrame | null {
  const ordered = [...frames].sort((a, b) => b.stackIndex - a.stackIndex);
  for (const f of ordered) if (pointInPoly(pt, f.poly)) return f;
  for (const f of ordered) {
    const xs = f.poly.map((p) => p.x);
    const ys = f.poly.map((p) => p.y);
    if (pt.x >= Math.min(...xs) - slop && pt.x <= Math.max(...xs) + slop && pt.y >= Math.min(...ys) - slop && pt.y <= Math.max(...ys) + slop) {
      return f;
    }
  }
  return null;
}

// 프레임의 화면 외곽(투영 실루엣) 바운딩 박스
export function frameBBox(f: BookFrame) {
  const xs = f.poly.map((p) => p.x);
  const ys = f.poly.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

// 선반 밖에서 한 권만 그릴 때(서랍·상세): 똑바로 선 상자 하나의 프레임. 바닥 = FLOOR, 왼쪽 = 0.
export function standaloneFrame(book: Book, pose: Pose): BookFrame {
  const box: Placed = { bookId: book.id, pose, size: boxSize(book, pose), x: 0, y: 0, z: 0, angle: 0 };
  return frameOf(box, book.id, book.id, '', 0, 0);
}

// 선반 한 칸의 3D 자세(그리기·전환 경로의 입력)
export function bodiesOf(layout: ShelfLayout, books: BookMap, shelfId: string): Book3[] {
  return computeShelf(layout, books, shelfId).frames.map((f) => fromPlaced(f.box!));
}
