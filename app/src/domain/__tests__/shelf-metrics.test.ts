import { computeRows, lockedRowsAfter, makeMetrics, LAYOUT, RIBBON_OUT, ROW_CLEARANCE, ROW_SPACE, rowAt, toContent, toScene } from '@/ui/shelf/metrics';
import { BASE_CAM, project } from '../camera';
import { BOOK_MAX_H, BOOK_MAX_T, BOOK_MIN_T, BOOK_SIZE_MM, bookHeight, bookThickness, frontWidth, mm, SHELF_FRONT, SHELF_THICK } from '../geometry';
import { MAX_STACK } from '../layout-rules';
import { ribbonDesign } from '../ribbon-design';
import { realDimensions } from '../jacket-proportions';
import type { Book } from '../types';
import { addShelf, moveToShelf, setPose, type BookMap } from '../layout-engine';
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
    const rows = computeRows(SAMPLE_LAYOUT, 1, 800, 70);
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
  const rows = computeRows(SAMPLE_LAYOUT, 1, 800, 70);
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

it('줄 간격은 모든 줄이 같고, 가장 큰 책 + 갈피가 윗선반에 닿지 않는다', () => {
  const m = makeMetrics(390);
  const rows = computeRows(SAMPLE_LAYOUT, m.scale, 800, 70);
  expect(ROW_SPACE).toBeCloseTo(BOOK_MAX_H + RIBBON_OUT + ROW_CLEARANCE, 9);
  for (const row of rows) {
    expect(row.space).toBe(ROW_SPACE);
    expect(row.height).toBeCloseTo((row.space + SHELF_THICK) * m.scale, 9);
    // 책 기준선(선반 공간 원점)이 row.baseline, 칸 아래 끝 = 이 줄 판 앞면 아래 모서리를 기본 보기로 본 자리(원근 d 때문에 0.5DU 안쪽 차이)
    expect(toContent(m, row, { x: 0, y: 0 }).y).toBeCloseTo(row.baseline, 9);
    expect(Math.abs(row.top + row.height - toContent(m, row, project(BASE_CAM, { x: 0, y: -SHELF_THICK, z: -SHELF_FRONT })).y)).toBeLessThan(0.5 * m.scale);
  }
  // 자세를 바꿔도(가장 키 큰 책을 표지로) 책 세로 길이로 재므로 줄이 움직이지 않는다
  const front = setPose(SAMPLE_LAYOUT, books, 'b02', 'front');
  if (!front.ok) throw new Error(front.reason);
  expect(computeRows(front.layout, m.scale, 800, 70)).toEqual(rows);
});

describe('책 크기 범위', () => {
  const sized = (widthMm: number, heightMm: number, pages: number): Book => {
    const physical = { widthMm, heightMm, pages };
    return { ...SAMPLE_BOOKS[0], physical, coverAspectRatio: widthMm / heightMm, dims: realDimensions(physical) };
  };
  it('큰 판형은 표지 비율을 지켜 줄이고, 범위 안의 책은 실제 크기 그대로다', () => {
    const big = sized(188, 257, 300); // 4×6배판
    expect(bookHeight(big)).toBeCloseTo(BOOK_MAX_H, 9);
    expect(frontWidth(big) / bookHeight(big)).toBeCloseTo(188 / 257, 9);
    // 두께도 같은 배율, 범위 안의 책끼리는 실제 길이 비율 그대로
    expect(bookThickness(sized(188, 257, 800))).toBeCloseTo(mm(800 * 0.06 + 1.5) * (225 / 257), 9);
    expect(bookHeight(sized(128, 188, 300)) / bookHeight(sized(153, 225, 300))).toBeCloseTo(188 / 225, 9);
    const usual = sized(153, 224, 300);
    expect(bookHeight(usual)).toBeCloseTo(mm(224), 9);
    expect(frontWidth(usual)).toBeCloseTo(mm(153), 9);
  });
  it('작은 판형은 최소 높이까지 키우고, 넓은 책은 폭 상한을 넘지 않는다', () => {
    const pocket = sized(105, 148, 200); // 문고판
    expect(bookHeight(pocket)).toBeCloseTo(mm(BOOK_SIZE_MM.minH), 9);
    expect(frontWidth(pocket) / bookHeight(pocket)).toBeCloseTo(105 / 148, 9);
    expect(bookThickness(sized(188, 257, 40))).toBeGreaterThanOrEqual(BOOK_MIN_T); // 줄여도 최소 두께
    expect(frontWidth(sized(90, 200, 200))).toBeCloseTo(mm(BOOK_SIZE_MM.minW), 9); // 좁은 책은 폭 하한까지(비율 유지)
    const wide = sized(260, 210, 100); // 가로로 긴 그림책
    expect(frontWidth(wide)).toBeCloseTo(mm(BOOK_SIZE_MM.maxW), 9);
    expect(bookHeight(wide)).toBeLessThanOrEqual(BOOK_MAX_H);
  });
  it('어떤 책도 윗선반에 닿지 않는다: 최대 높이 + 가장 긴 갈피, 가장 두꺼운 책 쌓기', () => {
    const giant = sized(210, 297, 3000);
    expect(bookThickness(giant)).toBeCloseTo(BOOK_MAX_T, 9);
    const longest = Math.max(ribbonDesign({ ...giant, id: 'a', art: { ...giant.art, ribbonCount: 1 } }).out, ribbonDesign({ ...giant, id: 'b', art: { ...giant.art, ribbonCount: 2 } }).out);
    expect(longest).toBeLessThanOrEqual(RIBBON_OUT);
    expect(bookHeight(giant) + longest).toBeLessThan(ROW_SPACE);
    expect(MAX_STACK * BOOK_MAX_T).toBeLessThan(ROW_SPACE);
    // 책이 없어도, 어떤 책을 꽂아도 줄 간격은 그대로다
    expect(computeRows({ ...SAMPLE_LAYOUT, placements: [] }, 1)[0].space).toBe(ROW_SPACE);
  });
});

it('키 큰 책을 옮겨도 빈 선반이 생겨도 모든 줄 간격은 같다', () => {
  const m = makeMetrics(390);
  const result = moveToShelf(addShelf(SAMPLE_LAYOUT, 'extra'), books, 'b06', 'extra');
  if (!result.ok) throw new Error(result.reason);
  const rows = computeRows(result.layout, m.scale, 800, 70);
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row.space).toBeCloseTo(rows[0].space, 9);
    expect(row.height).toBeCloseTo(rows[0].height, 9);
  }
  // 빈 책장도 줄 간격은 같다
  const empty = computeRows({ ...SAMPLE_LAYOUT, placements: [], drawer: SAMPLE_LAYOUT.placements.map((p) => p.bookId) }, m.scale, 800, 70);
  expect(new Set(empty.map((r) => r.space)).size).toBe(1);
  expect(empty[0].space).toBeGreaterThan(100);
});

it.each([280, 390, 520, 768])('폭 %i에서 실제로 그린 책 위치가 올바른 줄의 터치 좌표로 복원된다', (width) => {
  const m = makeMetrics(width);
  const rows = computeRows(SAMPLE_LAYOUT, m.scale);
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
