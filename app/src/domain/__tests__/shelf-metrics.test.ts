import { computeRows, lockedRowsAfter, makeMetrics, LAYOUT, RIBBON_OUT, ROW_CLEARANCE, rowAt, toContent, toScene } from '@/ui/shelf/metrics';
import { BASE_CAM, project } from '../camera';
import { bookHeight, SHELF_FRONT, SHELF_THICK } from '../geometry';
import { addShelf, moveToShelf, setPose, threeShelfLayout, validate, type BookMap } from '../layout-engine';
import { lockedShelfCount, SHELF_SLOTS } from '../layout-rules';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../test-fixtures/interaction-books';
import { computeShelf, frameBBox } from '../shelf-scene';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));

describe('잠긴 선반 줄', () => {
  it('기본 세 칸 아래로 두 칸이 이어지고, 열면 줄어들고 다 열면 없다', () => {
    expect(lockedShelfCount(3)).toBe(2);
    expect(lockedShelfCount(4)).toBe(1);
    expect(lockedShelfCount(SHELF_SLOTS)).toBe(0);
    expect(lockedShelfCount(9)).toBe(0);
  });
  it('마지막 줄 바로 아래에 같은 높이로 붙고, 있어도 위 세 줄 자리는 그대로다', () => {
    const rows = computeRows(SAMPLE_LAYOUT, books, 1, 800, 70);
    const locked = lockedRowsAfter(rows, 2, 1);
    expect(locked).toHaveLength(2);
    expect(locked[0].top).toBeCloseTo(rows[2].top + rows[2].height);
    expect(locked[1].top).toBeCloseTo(locked[0].top + locked[0].height);
    expect(locked[0].height).toBeCloseTo(Math.max(...rows.map((r) => r.height)));
    expect(locked[0].baseline).toBeGreaterThan(locked[0].top);
    expect(locked[0].baseline).toBeLessThan(locked[0].top + locked[0].height);
    expect(lockedRowsAfter(rows, 0, 1)).toEqual([]);
  });
});

it('선반 칸은 이어지고 헤더 아래 여백과 하단 공간을 둔다', () => {
  const rows = computeRows(SAMPLE_LAYOUT, books, 1, 800, 70);
  expect(rows).toHaveLength(3);
  expect(rows[1].top).toBeCloseTo(rows[0].top + rows[0].height);
  expect(rows[2].top).toBeCloseTo(rows[1].top + rows[1].height);
  const free = 800 - 70 - rows.reduce((n, r) => n + r.height, 0);
  expect(rows[0].top).toBeCloseTo(free * LAYOUT.topGap / 2);
  for (const row of rows) {
    for (const frame of computeShelf(SAMPLE_LAYOUT, books, row.shelfId).frames) {
      // 가장 촘촘한 마지막 줄도 책 머리가 윗선반 아래를 침범하지 않는다.
      const top = frameBBox(frame, BASE_CAM).minY + row.clear;
      expect(top).toBeGreaterThanOrEqual(0);
    }
  }
});

it('줄 간격은 모든 줄이 같다: 책장의 가장 키 큰 책과 갈피에 맞추며 자세 변경에는 고정된다', () => {
  const m = makeMetrics(390);
  const rows = computeRows(SAMPLE_LAYOUT, books, m.scale, 800, 70);
  const tallest = Math.max(...SAMPLE_LAYOUT.placements.map((p) => bookHeight(books[p.bookId]) + ((books[p.bookId].quotes ?? 0) > 0 ? RIBBON_OUT : 0)));
  for (const row of rows) {
    expect(row.space).toBeCloseTo(tallest + ROW_CLEARANCE, 9);
    expect(row.height).toBeCloseTo((row.space + SHELF_THICK) * m.scale, 9);
    // 책 기준선(선반 공간 원점)이 row.baseline, 칸 아래 끝 = 이 줄 판 앞면 아래 모서리를 기본 보기로 본 자리(원근 d 때문에 0.5DU 안쪽 차이)
    expect(toContent(m, row, { x: 0, y: 0 }).y).toBeCloseTo(row.baseline, 9);
    expect(Math.abs(row.top + row.height - toContent(m, row, project(BASE_CAM, { x: 0, y: -SHELF_THICK, z: -SHELF_FRONT })).y)).toBeLessThan(0.5 * m.scale);
  }
  // 자세를 바꿔도(가장 키 큰 책을 표지로) 책 세로 길이로 재므로 줄이 움직이지 않는다
  const front = setPose(SAMPLE_LAYOUT, books, 'b02', 'front');
  if (!front.ok) throw new Error(front.reason);
  expect(computeRows(front.layout, books, m.scale, 800, 70)).toEqual(rows);
});

it('키 큰 책을 옮겨도 빈 선반이 생겨도 모든 줄 간격은 같다', () => {
  const m = makeMetrics(390);
  const result = moveToShelf(addShelf(SAMPLE_LAYOUT, 'extra'), books, 'b06', 'extra');
  if (!result.ok) throw new Error(result.reason);
  const rows = computeRows(result.layout, books, m.scale, 800, 70);
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row.space).toBeCloseTo(rows[0].space, 9);
    expect(row.height).toBeCloseTo(rows[0].height, 9);
  }
  // 빈 책장도 줄 간격은 같고 최소 높이는 지킨다
  const empty = computeRows(threeShelfLayout({ ...SAMPLE_LAYOUT, placements: [], drawer: SAMPLE_LAYOUT.placements.map((p) => p.bookId) }), books, m.scale, 800, 70);
  expect(new Set(empty.map((r) => r.space)).size).toBe(1);
  expect(empty[0].space).toBeGreaterThan(100);
});

it('기존 4번째 선반을 정리하면서 책을 서랍에 보존하고 3개를 유지한다', () => {
  const result = moveToShelf(addShelf(SAMPLE_LAYOUT, 'extra'), books, 'b06', 'extra');
  if (!result.ok) throw new Error(result.reason);
  const next = threeShelfLayout(result.layout);
  expect(next.shelves).toHaveLength(3);
  expect(next.drawer).toContain('b06');
  expect(validate(next, books, Object.keys(books))).toEqual([]);
  expect(threeShelfLayout(next)).toEqual(next);
  expect(threeShelfLayout({ ...SAMPLE_LAYOUT, shelves: [] }).shelves).toHaveLength(3);
});

it.each([280, 390, 520, 768])('폭 %i에서 실제로 그린 책 위치가 올바른 줄의 터치 좌표로 복원된다', (width) => {
  const m = makeMetrics(width);
  const rows = computeRows(SAMPLE_LAYOUT, books, m.scale);
  rows.forEach((row, i) => {
    const frame = computeShelf(SAMPLE_LAYOUT, books, row.shelfId).frames[0];
    const bb = frameBBox(frame, BASE_CAM); // 기본 4°로 그린 책의 화면 외곽
    const p = { x: bb.minX + bb.width / 2, y: bb.minY + bb.height / 2 };
    const pixel = toContent(m, row, p);
    const restored = toScene(m, row, pixel.x, pixel.y);
    expect(rowAt(rows, pixel.y)).toBe(i);
    expect(restored.x).toBeCloseTo(p.x, 6);
    expect(restored.y).toBeCloseTo(p.y, 6);
  });
});
