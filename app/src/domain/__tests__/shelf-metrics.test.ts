import { computeRows, makeMetrics, RIBBON_OUT, ROW_CLEARANCE, rowAt, toContent, toScene } from '@/ui/shelf/metrics';
import { BASE_CAM, project } from '../camera';
import { bookHeight, SHELF_FRONT, SHELF_THICK } from '../geometry';
import { addShelf, moveToShelf, setPose, threeShelfLayout, validate, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { computeShelf, frameBBox } from '../shelf-scene';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));

it('세 선반의 간격은 같고 헤더와 하단 아이콘 사이에서 중앙 정렬된다', () => {
  const rows = computeRows(SAMPLE_LAYOUT, books, 1, 800, 70);
  expect(rows).toHaveLength(3);
  expect(rows[1].top - rows[0].top).toBeCloseTo(rows[2].top - rows[1].top);
  expect(rows[0].top).toBeCloseTo(800 - 70 - (rows[2].top + rows[2].height));
  for (const row of rows) {
    for (const frame of computeShelf(SAMPLE_LAYOUT, books, row.shelfId).frames) {
      // 책 윗끝(기본 3° 투영, 기준선 원점)이 줄 칸 위 끝에서 8DU 이상 아래
      const top = frameBBox(frame, BASE_CAM).minY + row.clear;
      expect(top).toBeGreaterThanOrEqual(8);
    }
  }
});

it('줄 간격은 3D 값: 보기 각은 입력이 아니고, 모든 줄이 같으며 = 가장 키 큰 책(갈피 포함) + 여유', () => {
  const m = makeMetrics(390);
  const rows = computeRows(SAMPLE_LAYOUT, books, m.scale, 800, 70);
  const tallest = Math.max(...SAMPLE_LAYOUT.placements.map((p) => bookHeight(books[p.bookId]) + ((books[p.bookId].quotes ?? 0) > 0 ? RIBBON_OUT : 0)));
  for (const row of rows) {
    expect(row.space).toBeCloseTo(tallest + ROW_CLEARANCE, 9);
    expect(row.height).toBeCloseTo((row.space + SHELF_THICK) * m.scale, 9);
    // 책 기준선(선반 공간 원점)이 row.baseline, 칸 아래 끝 = 이 줄 판 앞면 아래 모서리를 기본 3°로 본 자리
    expect(toContent(m, row, { x: 0, y: 0 }).y).toBeCloseTo(row.baseline, 9);
    expect(row.top + row.height).toBeCloseTo(toContent(m, row, project(BASE_CAM, { x: 0, y: -SHELF_THICK, z: -SHELF_FRONT })).y, 9);
  }
  // 자세를 바꿔도(가장 키 큰 책을 표지로) 책 세로 길이로 재므로 줄이 움직이지 않는다
  const front = setPose(SAMPLE_LAYOUT, books, 'b02', 'front');
  if (!front.ok) throw new Error(front.reason);
  expect(computeRows(front.layout, books, m.scale, 800, 70)).toEqual(rows);
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
    const bb = frameBBox(frame, BASE_CAM); // 기본 3°로 그린 책의 화면 외곽
    const p = { x: bb.minX + bb.width / 2, y: bb.minY + bb.height / 2 };
    const pixel = toContent(m, row, p);
    const restored = toScene(m, row, pixel.x, pixel.y);
    expect(rowAt(rows, pixel.y)).toBe(i);
    expect(restored.x).toBeCloseTo(p.x, 6);
    expect(restored.y).toBeCloseTo(p.y, 6);
  });
});
