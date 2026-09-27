// 화면 폭 → 설계 단위 스케일과 선반 줄 위치.
// 저장은 순서·그룹 기준이라 폭이 바뀌어도 배치를 다시 계산하지 않고 균일하게 확대·축소한다.
// 정책: 태블릿 등 넓은 화면은 520px 폭에서 멈추고 가운데 정렬, 좁은 화면(<320px)은 그대로 축소한다(데이터는 건드리지 않음).
// 세 선반은 같은 간격으로 놓고, 헤더와 하단 아이콘 사이에서 중앙 정렬한다.
// 선반과 책은 같은 줄 좌표계(같은 스케일·스크롤)에 놓인다.
import { useWindowDimensions } from 'react-native';

import { DESIGN_WIDTH, SHELF } from '@/domain/geometry';
import { itemHeight, shelfItems, sortedShelves, type BookMap } from '@/domain/layout-engine';
import type { Point } from '@/domain/shelf-scene';
import type { ShelfLayout } from '@/domain/types';

export const MAX_LAYOUT_WIDTH = 520;
export const CONTENT_TOP = 4;
const FLOOR = SHELF.clearHeight;

export type ShelfMetrics = { scale: number; originX: number };

export type RowGeom = {
  shelfId: string;
  top: number; // 콘텐츠 px
  clear: number; // DU: 선반 판 위 공간(가장 큰 책 + 여백)
  height: number; // px: 줄 전체(판·아래 여백 포함)
};

export function makeMetrics(windowWidth: number): ShelfMetrics {
  const width = Math.min(windowWidth, MAX_LAYOUT_WIDTH);
  return { scale: width / DESIGN_WIDTH, originX: (windowWidth - width) / 2 };
}

export function useShelfMetrics() {
  const { width } = useWindowDimensions();
  return makeMetrics(width);
}

export const RIBBON_OUT = 8;

export function computeRows(layout: ShelfLayout, books: BookMap, scale: number, viewportHeight = 0, bottomInset = 0): RowGeom[] {
  const shelves = sortedShelves(layout);
  const tallest = Math.max(SHELF.minClear, ...shelves.flatMap((s) => shelfItems(layout, s.id).map((it) => itemHeight(it, layout, books))));
  const clear = tallest + RIBBON_OUT + SHELF.rowTopPad;
  const height = (clear + SHELF.below + SHELF.rowGap) * scale;
  let top = Math.max(CONTENT_TOP, (viewportHeight - bottomInset - height * shelves.length) / 2);
  return shelves.map((s) => {
    const row = { shelfId: s.id, top, clear, height };
    top += height;
    return row;
  });
}

// 장면 좌표(설계 단위, 바닥 = FLOOR) ↔ 콘텐츠 px
export function toContent(m: ShelfMetrics, row: RowGeom, p: Point): Point {
  return {
    x: m.originX + (SHELF.sideMargin + p.x) * m.scale,
    y: row.top + (row.clear + p.y - FLOOR) * m.scale,
  };
}

export function toScene(m: ShelfMetrics, row: RowGeom, x: number, y: number): Point {
  return {
    x: (x - m.originX) / m.scale - SHELF.sideMargin,
    y: (y - row.top) / m.scale - row.clear + FLOOR,
  };
}

export function rowAt(rows: RowGeom[], y: number) {
  return rows.findIndex((r) => y >= r.top && y < r.top + r.height);
}
