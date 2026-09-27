// 선반 한 칸의 책 프레임 계산(순수). 렌더링·터치 판정·그림자가 모두 이 결과를 쓴다.
// 좌표: 설계 단위, x는 선반 판 안쪽 왼쪽 끝 기준, y는 아래로 증가하며 선반 바닥이 SHELF.clearHeight.
import {
  bookHeight,
  bookThickness,
  FRONT_SIDE,
  frontWidth,
  SHELF,
  STACK_OFFSETS,
  TOP_FACE,
} from './geometry';
import { itemPositions, placementOf, shelfItems, type BookMap } from './layout-engine';
import { contactAngle, firstContact, MAX_LEAN, overlaps } from './lean';
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
// 예시 책은 실제 윤곽으로, 가장 낮은 점이 선반 바닥에 닿게 앉힌다.
export function leanFrame(book: Book, footX: number, angle: number) {
  const w = bookThickness(book);
  const h = bookHeight(book);
  const left = footX;
  const top = FLOOR - h;
  const origin = angle > 0 ? ('right bottom' as const) : ('left bottom' as const);
  const pivot = { x: angle > 0 ? left + w : left, y: FLOOR };
  const art = book.reference;
  const useArt = art && art.pose === 'spine' && !book.coverArtUri && !book.spineArtUri;
  const base = useArt ? art.outline.map((p) => ({ x: left + p.x, y: top + p.y })) : rectPoly(left, top, w, h);
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

export function computeShelf(layout: ShelfLayout, books: BookMap, shelfId: string) {
  const positions = itemPositions(shelfItems(layout, shelfId), layout, books);
  const frames: BookFrame[] = [];
  const items: ItemFrame[] = [];
  for (const { item, x, width } of positions) {
    items.push({ key: item.key, x, width, bookIds: item.bookIds });
    if (item.stacked) {
      let bottom = FLOOR;
      item.bookIds.forEach((id, i) => {
        const b = books[id];
        const len = bookHeight(b);
        const t = bookThickness(b);
        const left = x + (STACK_OFFSETS[i] ?? 0);
        const top = bottom - t - TOP_FACE;
        frames.push({
          bookId: id, itemKey: item.key, shelfId, pose: 'horizontal', tilt: 0,
          left, top, width: len, height: t + TOP_FACE, rotate: 0, origin: 'left bottom',
          poly: rectPoly(left, top, len, t + TOP_FACE), stackIndex: i,
        });
        bottom -= t;
      });
      continue;
    }
    const id = item.bookIds[0];
    const b = books[id];
    const p = placementOf(layout, id)!;
    if (p.pose === 'spine') {
      const f = leanFrame(b, x, 0);
      frames.push({ bookId: id, itemKey: item.key, shelfId, pose: 'spine', tilt: p.tilt, stackIndex: 0, ...f });
    } else if (p.pose === 'horizontal') {
      const len = bookHeight(b);
      const hh = bookThickness(b) + TOP_FACE;
      frames.push({
        bookId: id, itemKey: item.key, shelfId, pose: 'horizontal', tilt: 0,
        left: x, top: FLOOR - hh, width: len, height: hh, rotate: 0, origin: 'left bottom',
        poly: rectPoly(x, FLOOR - hh, len, hh), stackIndex: 0,
      });
    } else {
      const w = frontWidth(b) + FRONT_SIDE;
      const h = bookHeight(b);
      frames.push({
        bookId: id, itemKey: item.key, shelfId, pose: 'front', tilt: 0,
        left: x, top: FLOOR - h, width: w, height: h, rotate: 0, origin: 'left bottom',
        poly: rectPoly(x, FLOOR - h, w, h), stackIndex: 0,
      });
    }
  }
  // Use the same silhouette for painting, hit testing and shadows. Reference
  // books have shaped shoulders and page edges, not rectangular silhouettes.
  for (const f of frames) {
    const book = books[f.bookId];
    const art = book.reference;
    if (!art || art.pose !== f.pose || book.coverArtUri || book.spineArtUri || f.pose === 'spine') continue;
    const pivot = { x: f.left + (f.origin === 'right bottom' ? f.width : 0), y: f.top + f.height };
    f.poly = art.outline.map((p) => rotateAround({ x: f.left + p.x, y: f.top + p.y }, pivot, f.rotate));
    const item = items.find((it) => it.key === f.itemKey)!;
    if (f.pose !== 'horizontal') {
      const dx = item.x - Math.min(...f.poly.map((p) => p.x));
      f.left += dx;
      f.poly = f.poly.map((p) => ({ x: p.x + dx, y: p.y }));
    }
    // A shaped book's lowest corner can lie above its rectangular bounds after
    // rotation. Seat the actual outline on the plank, including the painted node.
    if (f.stackIndex === 0) {
      const dy = FLOOR - Math.max(...f.poly.map((p) => p.y));
      f.top += dy;
      f.poly = f.poly.map((p) => ({ x: p.x, y: p.y + dy }));
    }
  }
  solveLeans(frames, books, layout);
  return { frames, items };
}

const inside = (poly: Point[]) => poly.every((p) => p.x >= PLANK_BOUNDS.min - 0.01 && p.x <= PLANK_BOUNDS.max + 0.01);

// 기대는 책들의 각도. 저장된 결과(각도·상대)가 아직 맞으면 그대로 쓰고(사용자가 꾸민 모습 유지),
// 상대가 바뀌었거나 더 이상 닿지 않거나 파고들면 옆 책의 실제 윤곽에 닿을 때까지 다시 구한다.
// 순서: 오른쪽으로 기대는 책은 오른쪽 이웃이 먼저 정해져야 하므로 오른쪽부터, 왼쪽으로 기대는 책은 왼쪽부터.
// 서로 마주 기대거나 연쇄로 기대는 경우를 위해 몇 번 반복한다.
function solveLeans(frames: BookFrame[], books: BookMap, layout: ShelfLayout) {
  const leaners = frames.filter((f) => f.pose === 'spine' && f.tilt !== 0);
  if (!leaners.length) return;
  const foot = new Map(leaners.map((f) => [f.bookId, f.left]));
  const ordered = [...leaners].sort((a, b) => a.left - b.left);
  // 마주 보고 기대는 두 권(오른쪽으로 기대는 책 바로 오른쪽에 왼쪽으로 기대는 책)은 같은 각도로 함께 기울여 처음 닿는 곳에서 멈춘다.
  // 한 권씩 풀면 먼저 푼 책이 빈틈을 다 차지하기 때문이다.
  const paired = new Set<string>();
  const byLeft = [...frames].filter((f) => f.stackIndex === 0).sort((a, b) => a.left - b.left);
  for (let i = 0; i + 1 < byLeft.length; i++) {
    const a = byLeft[i];
    const b = byLeft[i + 1];
    if (!(a.pose === 'spine' && b.pose === 'spine' && a.tilt > 0 && b.tilt < 0)) continue;
    const ba = books[a.bookId];
    const bb = books[b.bookId];
    const c = firstContact((d) => overlaps(leanFrame(ba, a.left, d).poly, leanFrame(bb, b.left, -d).poly));
    if (!c.found || c.angle === 0) continue;
    Object.assign(a, leanFrame(ba, a.left, c.angle), { leanFailed: false, leanOn: b.bookId });
    Object.assign(b, leanFrame(bb, b.left, -c.angle), { leanFailed: false, leanOn: a.bookId });
    paired.add(a.bookId).add(b.bookId);
  }
  const passes = [ordered.filter((f) => f.tilt < 0), [...ordered].reverse().filter((f) => f.tilt > 0)].map((pass) =>
    pass.filter((f) => !paired.has(f.bookId)),
  );
  for (let iter = 0; iter < 3; iter++) {
    for (const pass of passes) {
      for (const f of pass) {
        const dir = Math.sign(f.tilt);
        const book = books[f.bookId];
        const x0 = foot.get(f.bookId)!;
        const mid = x0 + bookThickness(book) / 2;
        const side = frames
          .filter((o) => o !== f)
          .filter((o) => (dir > 0 ? Math.max(...o.poly.map((p) => p.x)) > mid : Math.min(...o.poly.map((p) => p.x)) < mid));
        const obstacles = side.map((o) => o.poly);
        const at = (deg: number) => leanFrame(book, x0, dir * deg).poly;
        const stored = placementOf(layout, f.bookId)?.lean;
        const partner = stored && side.find((o) => o.bookId === stored.on);
        if (
          stored &&
          partner &&
          Math.sign(stored.angle) === dir &&
          Math.abs(stored.angle) <= MAX_LEAN &&
          !obstacles.some((o) => overlaps(at(Math.abs(stored.angle)), o)) &&
          overlaps(at(Math.abs(stored.angle) + 0.6), partner.poly) &&
          inside(at(Math.abs(stored.angle)))
        ) {
          Object.assign(f, leanFrame(book, x0, stored.angle), { leanFailed: false, leanOn: stored.on });
          continue;
        }
        const r = contactAngle(at, obstacles, PLANK_BOUNDS);
        const on = r.supported && r.angle > 0 ? side.find((o) => overlaps(at(r.angle + 0.6), o.poly))?.bookId : undefined;
        Object.assign(f, leanFrame(book, x0, dir * r.angle), { leanFailed: !r.supported, leanOn: on });
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
