// 화면 폭 → 설계 단위 스케일과 선반 줄 위치.
// 저장은 순서·그룹 기준이라 폭이 바뀌어도 배치를 다시 계산하지 않고 균일하게 확대·축소한다.
// 정책: 태블릿 등 넓은 화면은 520px 폭에서 멈추고 가운데 정렬, 좁은 화면(<320px)은 그대로 축소한다(데이터는 건드리지 않음).
// 줄 간격은 3D 값이다(판 윗면 → 윗선반 아랫면). 보기 각·꾸미기 모드와 상관없이 같고, 화면 위치는 카메라가 투영만 바꾼다.
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { BASE_CAM, type Point } from '@/domain/camera';
import { BOOK_MAX_H, DESIGN_WIDTH, SHELF, SHELF_FRONT, SHELF_THICK } from '@/domain/geometry';
import { sortedShelves } from '@/domain/layout-engine';
import type { ShelfLayout } from '@/domain/types';
import { FRAME_ON } from '@/scene-config/skin';

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

// 움푹 파인 책장의 바깥 여백: 시안의 구멍 왼쪽 끝이 화면 폭의 약 3%라 장면을 설계 폭보다 양쪽으로 4DU 넓게 잡는다(화면에서 약 2% 작아진다). 선반 치수(DU)·저장된 배치는 그대로라 책 수가 같다
export const SCENE_PAD = FRAME_ON ? 4 : 0;

export function makeMetrics(windowWidth: number): ShelfMetrics {
  const width = Math.min(windowWidth, MAX_LAYOUT_WIDTH);
  const scale = width / (DESIGN_WIDTH + 2 * SCENE_PAD);
  return { scale, originX: (windowWidth - width) / 2 + SCENE_PAD * scale };
}

// 폭이 그대로면 같은 객체(이 값을 받는 메모·효과가 렌더마다 다시 돌지 않게)
export function useShelfMetrics() {
  const { width } = useWindowDimensions();
  return useMemo(() => makeMetrics(width), [width]);
}

export const RIBBON_OUT = 15; // 줄 간격에 예약하는 갈피 높이(가장 긴 장). 실제 모양은 ribbon-design.
// 가장 큰 책 + 갈피 머리 위의 3D 여유(DU, 화면 약 10dp)
export const ROW_CLEARANCE = 10;
// 3D 줄 간격(판 윗면 → 윗선반 아랫면, DU): 모든 줄이 언제나 같다(2026-11-05 사용자 '선반 사이 간격 일정하게, 최대 책 + 갈피가 윗선반에 닿지 않게').
// 어떤 책을 꽂아도 달라지지 않는다: 책 크기는 geometry BOOK_MAX_H로 묶인다
export const ROW_SPACE = BOOK_MAX_H + RIBBON_OUT + ROW_CLEARANCE;
// 줄 칸(화면)의 기준 보기는 기본 4°(BASE_CAM)다: 칸 경계 = 윗선반 앞면 아래 모서리를 기본 보기로 본 자리(기본 보기에서 예전과 같은 위치).
// 칸은 줄을 고르는 터치 띠·세로 가운데 정렬에만 쓰고, 그리기·가림은 실제 카메라로 한다.
// 원근 카메라에서는 판 높이·줄 가운데의 요약 기울기(camera.ts). 줄 칸은 이 값으로 잰다: 줄 기준선 사이 화면 거리가 3D 줄 간격과
// 정확히 같아야 다른 줄로 옮겨 가는 책(줄 좌표를 3D 간격만큼 옮겨 그린다)이 넘어가는 순간 튀지 않는다.
// 윗선반 앞면 아래 모서리를 아래 줄 눈으로 본 자리는 이 칸 위 끝보다 약 2DU 위(원근 d)라, 그 띠는 위 줄이 그린 판이 덮는다.
const REF_KY = BASE_CAM.ky;

// 헤더 아래 빈 공간 비율(1 = 세 줄을 가운데 정렬). 측정 번들에서 비교할 때만 바꾼다
export const LAYOUT = { topGap: 0.34 };

export function computeRows(layout: ShelfLayout, scale: number, viewportHeight = 0, bottomInset = 0): RowGeom[] {
  const shelves = sortedShelves(layout);
  const height = (ROW_SPACE + SHELF_THICK) * scale;
  const clear = ROW_SPACE - SHELF_FRONT * REF_KY;
  let top = Math.max(CONTENT_TOP, ((viewportHeight - bottomInset - height * shelves.length) / 2) * LAYOUT.topGap);
  return shelves.map((s) => {
    const row = { shelfId: s.id, top, clear, space: ROW_SPACE, height, baseline: top + clear * scale };
    top += height;
    return row;
  });
}

// 잠긴 선반 줄(아직 열지 않은 칸): 마지막 줄 아래로 이어진다. 높이는 다른 줄과 같다
export function lockedRowsAfter(rows: RowGeom[], count: number, scale: number): RowGeom[] {
  const clear = ROW_SPACE - SHELF_FRONT * REF_KY;
  const height = (ROW_SPACE + SHELF_THICK) * scale;
  const last = rows.at(-1);
  let top = last ? last.top + last.height : CONTENT_TOP;
  return Array.from({ length: count }, (_, i) => {
    const row = { shelfId: `locked:${i}`, top, clear, space: ROW_SPACE, height, baseline: top + clear * scale };
    top += height;
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
