// 화면 폭 → 설계 단위 스케일과 선반 줄 위치.
// 저장은 순서·그룹 기준이라 폭이 바뀌어도 배치를 다시 계산하지 않고 균일하게 확대·축소한다.
// 정책: 태블릿 등 넓은 화면은 520px 폭에서 멈추고 가운데 정렬, 좁은 화면(<320px)은 그대로 축소한다(데이터는 건드리지 않음).
// 줄 간격은 3D 값이다(판 윗면 → 윗선반 아랫면). 보기 각·꾸미기 모드와 상관없이 같고, 화면 위치는 카메라가 투영만 바꾼다.
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { hasRibbon } from '@/domain/ribbon-design';
import { BASE_CAM, type Point } from '@/domain/camera';
import { bookHeight, DESIGN_WIDTH, SHELF, SHELF_FRONT, SHELF_THICK } from '@/domain/geometry';
import { sortedShelves, type BookMap } from '@/domain/layout-engine';
import type { ShelfLayout } from '@/domain/types';

export const MAX_LAYOUT_WIDTH = 520;
export const CONTENT_TOP = 10; // 시안의 첫 책 머리/선반 기준선에 맞춘 최소 상단 여백

export type ShelfMetrics = { scale: number; originX: number };

export type RowGeom = {
  shelfId: string;
  top: number; // 콘텐츠 px: 줄 칸 위 끝
  clear: number; // DU: 줄 칸 위 끝 → 책 기준선(선반 공간 y=0, z=0)의 화면 거리
  space: number; // DU(3D): 판 윗면 → 윗선반 아랫면 높이
  height: number; // px: 줄 칸 전체 = 3D 줄 간격(space + 판 두께) × 배율
  baseline: number; // 콘텐츠 px: 책 기준선 왼쪽 끝(선반 공간 원점)의 화면 y
};

export function makeMetrics(windowWidth: number): ShelfMetrics {
  const width = Math.min(windowWidth, MAX_LAYOUT_WIDTH);
  return { scale: width / DESIGN_WIDTH, originX: (windowWidth - width) / 2 };
}

// 폭이 그대로면 같은 객체(이 값을 받는 메모·효과가 렌더마다 다시 돌지 않게)
export function useShelfMetrics() {
  const { width } = useWindowDimensions();
  return useMemo(() => makeMetrics(width), [width]);
}

export const RIBBON_OUT = 15; // 줄 간격에 예약하는 갈피 높이(가장 긴 장). 실제 모양은 ribbon-design.
// 가장 키 큰 책(갈피 포함) 머리 위의 3D 여유(DU). 기본 3° 보기에서 예전 줄 간격(가장 큰 책의 투영 높이 + 2DU)과 같아지는 값.
export const ROW_CLEARANCE = 22;
// 시안의 둘째 줄 위 여백은 조금 넓고, 마지막 줄 위 여백은 더 촘촘하다.
export const ROW_CLEARANCES = [26.1, 27.85, 10.55];
// 줄 칸(화면)의 기준 보기는 기본 3°다: 칸 경계 = 윗선반 앞면 아래 모서리를 3°로 본 자리(기본 보기에서 예전과 같은 위치).
// 칸은 줄을 고르는 터치 띠·세로 가운데 정렬에만 쓰고, 그리기·가림은 실제 카메라로 한다.
// 원근 카메라에서는 판 높이·줄 가운데의 요약 기울기(camera.ts). 줄 칸은 이 값으로 잰다: 줄 기준선 사이 화면 거리가 3D 줄 간격과
// 정확히 같아야 다른 줄로 옮겨 가는 책(줄 좌표를 3D 간격만큼 옮겨 그린다)이 넘어가는 순간 튀지 않는다.
// 윗선반 앞면 아래 모서리를 아래 줄 눈으로 본 자리는 이 칸 위 끝보다 약 2DU 위(원근 d)라, 그 띠는 위 줄이 그린 판이 덮는다.
const REF_KY = BASE_CAM.ky;
// 빈 선반만 있어도 이만큼은 둔다(예전 최소 높이 110DU + 여백을 3D로)
const MIN_SPACE = 110 + SHELF.rowTopPad + SHELF_FRONT * REF_KY;

// 헤더 아래 빈 공간 비율(1 = 세 줄을 가운데 정렬). 측정 번들에서 비교할 때만 바꾼다
// rowFit(기본 1): 각 줄에 필요한 높이로 3D 줄 간격을 맞춘다.
export const LAYOUT = { topGap: 0.34, rowFit: 1 };

// 한 선반에 놓인 책 중 가장 높은 머리(갈피 포함, DU). 자세와 무관하게 책 세로 길이로 잰다(자세를 바꿔도 줄이 움직이지 않게).
function tallestOn(layout: ShelfLayout, books: BookMap, shelfId: string) {
  let top = 0;
  for (const p of layout.placements) {
    if (p.shelfId !== shelfId) continue;
    const b = books[p.bookId];
    if (!b) continue;
    top = Math.max(top, bookHeight(b) + (hasRibbon(b) ? RIBBON_OUT : 0));
  }
  return top;
}

// 3D 줄 간격(판 윗면 → 윗선반 아랫면, DU): 해당 선반의 가장 키 큰 책 + 여유.
export function rowSpaces(layout: ShelfLayout, books: BookMap): Map<string, number> {
  const shelves = sortedShelves(layout);
  const need = new Map(shelves.map((s, i) => [s.id, tallestOn(layout, books, s.id) + (shelves.length === 3 ? ROW_CLEARANCES[i] : ROW_CLEARANCE)]));
  const space = Math.max(MIN_SPACE, ...need.values());
  return new Map(shelves.map((s) => [s.id, space - LAYOUT.rowFit * (space - Math.max(MIN_SPACE, need.get(s.id)!))]));
}

export function computeRows(layout: ShelfLayout, books: BookMap, scale: number, viewportHeight = 0, bottomInset = 0): RowGeom[] {
  const shelves = sortedShelves(layout);
  const spaces = rowSpaces(layout, books);
  const heights = shelves.map((s) => (spaces.get(s.id)! + SHELF_THICK) * scale);
  const total = heights.reduce((a, b) => a + b, 0);
  let top = Math.max(CONTENT_TOP, ((viewportHeight - bottomInset - total) / 2) * LAYOUT.topGap);
  return shelves.map((s, i) => {
    const space = spaces.get(s.id)!;
    const clear = space - SHELF_FRONT * REF_KY;
    const row = { shelfId: s.id, top, clear, space, height: heights[i], baseline: top + clear * scale };
    top += heights[i];
    return row;
  });
}

// 선반 공간 투영(설계 단위, 원점 = 책 기준선 왼쪽 끝) ↔ 콘텐츠 px
export function toContent(m: ShelfMetrics, row: RowGeom, p: Point): Point {
  return { x: m.originX + (SHELF.sideMargin + p.x) * m.scale, y: row.baseline + p.y * m.scale };
}

export function toScene(m: ShelfMetrics, row: RowGeom, x: number, y: number): Point {
  return { x: (x - m.originX) / m.scale - SHELF.sideMargin, y: (y - row.baseline) / m.scale };
}

export function rowAt(rows: RowGeom[], y: number) {
  return rows.findIndex((r) => y >= r.top && y < r.top + r.height);
}

// 한 줄의 캔버스 px 변환(설계 단위 → px). top: 그 캔버스의 콘텐츠 y(줄 캔버스면 캔버스 위 끝, 한 캔버스면 0)
export function rowAffine(m: ShelfMetrics, row: RowGeom, canvasTop: number, canvasLeft = 0) {
  return { s: m.scale, tx: m.originX + SHELF.sideMargin * m.scale - canvasLeft, ty: row.baseline - canvasTop };
}
