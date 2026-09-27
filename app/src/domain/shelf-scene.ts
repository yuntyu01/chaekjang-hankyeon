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
import type { Pose, ShelfLayout, Tilt } from './types';

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

// 세운 책 기울이기: 기울어지는 쪽 바닥 모서리를 축으로 돌려 바닥에 닿게 한다.
export function tiltedFrame(footX: number, w: number, h: number, tilt: Tilt) {
  const t = rad(Math.abs(tilt));
  const top = FLOOR - h;
  if (tilt === 0) return { left: footX, top, rotate: 0, origin: 'left bottom' as const, poly: rectPoly(footX, top, w, h) };
  const left = tilt > 0 ? footX - w * (1 - Math.cos(t)) : footX + h * Math.sin(t);
  const pivot = tilt > 0 ? { x: left + w, y: FLOOR } : { x: left, y: FLOOR };
  const poly = rectPoly(left, top, w, h).map((p) => rotateAround(p, pivot, tilt));
  return { left, top, rotate: tilt, origin: tilt > 0 ? ('right bottom' as const) : ('left bottom' as const), poly };
}

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
      const w = bookThickness(b);
      const h = bookHeight(b);
      const f = tiltedFrame(x, w, h, p.tilt);
      frames.push({ bookId: id, itemKey: item.key, shelfId, pose: 'spine', tilt: p.tilt, width: w, height: h, stackIndex: 0, ...f });
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
  return { frames, items };
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
