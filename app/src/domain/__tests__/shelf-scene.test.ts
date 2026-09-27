import { bookHeight, bookThickness, SHELF, singleFootprint } from '../geometry';
import type { BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { computeShelf, hitTest, pointInPoly, tiltedFrame } from '../shelf-scene';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const FLOOR = SHELF.clearHeight;

describe('기울인 책', () => {
  it.each([7, -7] as const)('%i°: 가장 낮은 점이 선반 바닥에 닿고 점유 폭 안에 들어간다', (tilt) => {
    const b = { ...books.b01, reference: undefined };
    const f = tiltedFrame(100, bookThickness(b), bookHeight(b), tilt);
    const ys = f.poly.map((p) => p.y);
    const xs = f.poly.map((p) => p.x);
    expect(Math.max(...ys)).toBeCloseTo(FLOOR, 6);
    const fp = singleFootprint(b, { pose: 'spine', tilt });
    expect(Math.min(...xs)).toBeCloseTo(100, 6);
    expect(Math.max(...xs)).toBeCloseTo(100 + fp.width, 6);
  });
});

describe('선반 장면', () => {
  it('흰은 느린 하루의 실제 윤곽에 기대며 선반에 닿는다', () => {
    const { frames } = computeShelf(SAMPLE_LAYOUT, books, 'shelf-1');
    const a = frames.find((f) => f.bookId === 'b17')!;
    const b = frames.find((f) => f.bookId === 'b06')!;
    const distance = (point: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) => {
      const dx = q.x - p.x, dy = q.y - p.y;
      const t = Math.max(0, Math.min(1, ((point.x - p.x) * dx + (point.y - p.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(point.x - p.x - t * dx, point.y - p.y - t * dy);
    };
    const distances = [[a.poly, b.poly], [b.poly, a.poly]].flatMap(([points, edges]) =>
      points.flatMap((p) => edges.map((q, i) => distance(p, q, edges[(i + 1) % edges.length]))));
    expect(Math.min(...distances)).toBeLessThan(0.001);
    expect(Math.max(...b.poly.map((p) => p.y))).toBeCloseTo(FLOOR, 6);
  });

  it('모든 책이 바닥 위에 있고 실제 윤곽은 서로 겹치지 않는다', () => {
    for (const s of SAMPLE_LAYOUT.shelves) {
      const { frames, items } = computeShelf(SAMPLE_LAYOUT, books, s.id);
      for (const f of frames) expect(Math.max(...f.poly.map((p) => p.y))).toBeLessThanOrEqual(FLOOR + 1e-6);
      for (let i = 1; i < items.length; i++) {
        expect(items[i].x).toBeGreaterThan(items[i - 1].x);
      }
      for (const f of frames) {
        const it = items.find((i) => i.key === f.itemKey)!;
        const xs = f.poly.map((p) => p.x);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(it.x - 1e-6);
        expect(Math.max(...xs)).toBeLessThanOrEqual(it.x + it.width + 1e-6);
      }
      // Silhouettes may share bounding boxes while leaning against each other.
      // Sample the interior along every scanline to detect real overlap.
      for (let y = 0.5; y < FLOOR; y += 2) {
        for (let x = 0.5; x < 365; x += 2) {
          const touching = frames.filter((f) => pointInPoly({ x, y }, f.poly));
          const groups = new Set(touching.map((f) => f.itemKey));
          expect(groups.size).toBeLessThanOrEqual(1);
        }
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

  it('윤곽이 비정형인 예시도 기울기와 관계없이 실제 밑면이 선반에 닿는다', () => {
    for (const tilt of [-7, 0, 7] as const) {
      const layout = { ...SAMPLE_LAYOUT, placements: SAMPLE_LAYOUT.placements.map((p) => ({ ...p, tilt: p.pose === 'spine' ? tilt : p.tilt })) };
      for (const shelf of layout.shelves) {
        const { frames } = computeShelf(layout, books, shelf.id);
        for (const f of frames.filter((frame) => frame.stackIndex === 0)) {
          expect(Math.max(...f.poly.map((p) => p.y))).toBeCloseTo(FLOOR, 6);
          const center = f.poly.reduce((p, q) => ({ x: p.x + q.x / f.poly.length, y: p.y + q.y / f.poly.length }), { x: 0, y: 0 });
          expect(hitTest([f], center, 0)?.bookId).toBe(f.bookId);
        }
      }
    }
  });
});

import { castShape, hull } from '../shadow-shape';

describe('책 그림자 모양', () => {
  it('책 윤곽과 오른쪽 아래로 옮긴 윤곽을 이은 볼록 껍질', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 50 },
      { x: 0, y: 50 },
    ];
    const s = castShape(rect, 18, 14);
    const xs = s.map((p) => p.x);
    const ys = s.map((p) => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(28);
    expect(Math.max(...ys)).toBe(64);
    // 비스듬한 변: 책 오른쪽 위 모서리(10,0)와 옮긴 모서리(28,14)가 이어진다
    expect(s).toEqual(expect.arrayContaining([{ x: 10, y: 0 }, { x: 28, y: 14 }]));
    expect(hull([...rect, { x: 5, y: 25 }])).toHaveLength(4);
  });
});
