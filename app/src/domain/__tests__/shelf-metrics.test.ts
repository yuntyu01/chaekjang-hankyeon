import { computeRows, makeMetrics, rowAt, toContent, toScene } from '@/ui/shelf/metrics';
import { SHELF } from '../geometry';
import { addShelf, moveToShelf, threeShelfLayout, validate, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { computeShelf } from '../shelf-scene';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));

it('세 선반의 간격은 같고 헤더와 하단 아이콘 사이에서 중앙 정렬된다', () => {
  const rows = computeRows(SAMPLE_LAYOUT, books, 1, 800, 70);
  expect(rows).toHaveLength(3);
  expect(rows[1].top - rows[0].top).toBeCloseTo(rows[2].top - rows[1].top);
  expect(rows[0].top).toBeCloseTo(800 - 70 - (rows[2].top + rows[2].height));
  for (const row of rows) {
    for (const frame of computeShelf(SAMPLE_LAYOUT, books, row.shelfId).frames) {
      const top = Math.min(...frame.poly.map((p) => p.y)) + row.clear - SHELF.clearHeight;
      expect(top).toBeGreaterThanOrEqual(8);
    }
  }
});

it('키 큰 책을 다른 선반으로 옮겨도 간격과 선반 위치가 흔들리지 않는다', () => {
  const layout = addShelf(SAMPLE_LAYOUT, 'empty');
  const before = computeRows(layout, books, 1);
  const result = moveToShelf(layout, books, 'b02', 'empty');
  if (!result.ok) throw new Error(result.reason);
  const after = computeRows(result.layout, books, 1);
  expect(after).toEqual(before);
  expect(after[3].top).toBeCloseTo(after[2].top + after[2].height);
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
    const p = { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
    const pixel = toContent(m, row, p);
    const restored = toScene(m, row, pixel.x, pixel.y);
    expect(rowAt(rows, pixel.y)).toBe(i);
    expect(restored.x).toBeCloseTo(p.x, 6);
    expect(restored.y).toBeCloseTo(p.y, 6);
  });
});
