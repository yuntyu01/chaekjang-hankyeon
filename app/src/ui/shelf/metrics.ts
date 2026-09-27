// 화면 폭 → 설계 단위 스케일. 저장은 순서·그룹 기준이라 폭이 바뀌어도 배치를 다시 계산하지 않고 균일하게 확대·축소한다.
// 정책: 태블릿 등 넓은 화면은 520px 폭에서 멈추고 가운데 정렬, 좁은 화면(<320px)은 그대로 축소한다(데이터는 건드리지 않음).
import { useWindowDimensions } from 'react-native';

import { DESIGN_WIDTH, SHELF } from '@/domain/geometry';
import type { Point } from '@/domain/shelf-scene';

export const MAX_LAYOUT_WIDTH = 520;
export const ROW_DU = SHELF.rowTopPad + SHELF.clearHeight + SHELF.plankTop + SHELF.plankFront + SHELF.rowGap;
export const CONTENT_TOP = 4;

export type ShelfMetrics = {
  scale: number;
  originX: number; // 설계 폭 영역의 화면 x
  rowHeight: number;
  // 설계 좌표(선반 판 안쪽 기준) → 콘텐츠 px
  toContent: (shelfIndex: number, p: Point) => Point;
  shelfTop: (shelfIndex: number) => number;
};

export function makeMetrics(windowWidth: number): ShelfMetrics {
  const width = Math.min(windowWidth, MAX_LAYOUT_WIDTH);
  const scale = width / DESIGN_WIDTH;
  const originX = (windowWidth - width) / 2;
  const rowHeight = ROW_DU * scale;
  const shelfTop = (i: number) => CONTENT_TOP + i * rowHeight;
  return {
    scale,
    originX,
    rowHeight,
    shelfTop,
    toContent: (i, p) => ({
      x: originX + (SHELF.sideMargin + p.x) * scale,
      y: shelfTop(i) + (SHELF.rowTopPad + p.y) * scale,
    }),
  };
}

export function useShelfMetrics() {
  const { width } = useWindowDimensions();
  return makeMetrics(width);
}
