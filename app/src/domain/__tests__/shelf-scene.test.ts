import { bookHeight, bookThickness, SHELF, singleFootprint } from '../geometry';
import type { BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { computeShelf, hitTest, tiltedFrame } from '../shelf-scene';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const FLOOR = SHELF.clearHeight;

describe('기울인 책', () => {
  it.each([7, -7] as const)('%i°: 가장 낮은 점이 선반 바닥에 닿고 점유 폭 안에 들어간다', (tilt) => {
    const b = books.b01;
    const f = tiltedFrame(100, bookThickness(b), bookHeight(b), tilt);
    const ys = f.poly.map((p) => p.y);
    const xs = f.poly.map((p) => p.x);
    expect(Math.max(...ys)).toBeCloseTo(FLOOR, 6);
    const fp = singleFootprint(books.b01, { pose: 'spine', tilt });
    expect(Math.min(...xs)).toBeCloseTo(100, 6);
    expect(Math.max(...xs)).toBeCloseTo(100 + fp.width, 6);
  });
});

describe('선반 장면', () => {
  it('모든 책이 바닥 위에 있고 서로의 점유 구간이 겹치지 않는다', () => {
    for (const s of SAMPLE_LAYOUT.shelves) {
      const { frames, items } = computeShelf(SAMPLE_LAYOUT, books, s.id);
      for (const f of frames) expect(Math.max(...f.poly.map((p) => p.y))).toBeLessThanOrEqual(FLOOR + 1e-6);
      for (let i = 1; i < items.length; i++) {
        expect(items[i].x).toBeGreaterThanOrEqual(items[i - 1].x + items[i - 1].width);
      }
      for (const f of frames) {
        const it = items.find((i) => i.key === f.itemKey)!;
        const xs = f.poly.map((p) => p.x);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(it.x - 1e-6);
        expect(Math.max(...xs)).toBeLessThanOrEqual(it.x + it.width + 1e-6);
      }
    }
  });

  it('쌓인 책은 위 책부터 맞고, 아래 책도 따로 선택된다', () => {
    const { frames } = computeShelf(SAMPLE_LAYOUT, books, 'shelf-3');
    const top = frames.find((f) => f.bookId === 'b13')!;
    const bottom = frames.find((f) => f.bookId === 'b12')!;
    expect(hitTest(frames, { x: top.left + 20, y: top.top + 15 })?.bookId).toBe('b13');
    expect(hitTest(frames, { x: bottom.left + 20, y: FLOOR - 8 })?.bookId).toBe('b12');
    expect(hitTest(frames, { x: 340, y: 10 })).toBeNull();
  });
});

import { castShape, hull } from '../../ui/shelf/ShelfShadows';

describe('책 그림자 모양', () => {
  it('책 윤곽을 오른쪽으로 끌어 늘린 볼록 껍질', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 50 },
      { x: 0, y: 50 },
    ];
    const s = castShape(rect, 2, 0, 20);
    const xs = s.map((p) => p.x);
    expect(Math.min(...xs)).toBe(2);
    expect(Math.max(...xs)).toBe(32);
    expect(hull([...rect, { x: 5, y: 25 }])).toHaveLength(4);
  });
});
