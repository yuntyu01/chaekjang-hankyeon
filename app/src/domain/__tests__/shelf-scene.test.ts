import { bookHeight, bookThickness, LYING_BACK, SHELF, singleFootprint } from '../geometry';
import type { BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { computeShelf, frontOutline, hitTest, leanFrame, PLANK_BOUNDS, pointInPoly } from '../shelf-scene';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const FLOOR = SHELF.clearHeight;

describe('기울인 책', () => {
  it.each([7, -7] as const)('%i°: 발은 제자리, 가장 낮은 점이 선반 바닥에 닿는다', (tilt) => {
    const b = { ...books.b01, reference: undefined };
    const f = leanFrame(b, 100, tilt);
    expect(Math.max(...f.poly.map((p) => p.y))).toBeCloseTo(FLOOR, 6);
    const pivotX = tilt > 0 ? 100 + bookThickness(b) : 100;
    expect(f.poly.some((p) => Math.abs(p.x - pivotX) < 1e-6 && Math.abs(p.y - FLOOR) < 1e-6)).toBe(true);
    // 기울기는 빈틈 안에서 생기므로 점유 폭은 똑바로 선 폭 그대로
    expect(singleFootprint(b, { pose: 'spine', tilt }).width).toBe(bookThickness(b));
    expect(bookHeight(b)).toBeGreaterThan(0);
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
    const [ap, bp] = [frontOutline(a), frontOutline(b)];
    const distances = [[ap, bp], [bp, ap]].flatMap(([points, edges]) =>
      points.flatMap((p) => edges.map((q, i) => distance(p, q, edges[(i + 1) % edges.length]))));
    expect(b.leanOn).toBe('b17');
    expect(Math.min(...distances)).toBeLessThan(0.1);
    expect(Math.max(...bp.map((p) => p.y))).toBeCloseTo(FLOOR, 6);
  });

  it('모든 책이 바닥 위에 있고 실제 윤곽은 서로 겹치지 않는다', () => {
    for (const s of SAMPLE_LAYOUT.shelves) {
      const { frames, items } = computeShelf(SAMPLE_LAYOUT, books, s.id);
      for (const f of frames) expect(Math.max(...frontOutline(f).map((p) => p.y))).toBeLessThanOrEqual(FLOOR + 1e-6);
      for (let i = 1; i < items.length; i++) {
        expect(items[i].x).toBeGreaterThan(items[i - 1].x);
      }
      // 기댄 책은 자기 칸 밖(빈틈)으로 기울 수 있다. 대신 선반 판 안에 있어야 한다(눕힌 책은 끝을 조금 넘을 수 있음).
      for (const f of frames) {
        if (f.pose === 'horizontal') continue;
        const xs = frontOutline(f).map((p) => p.x);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(PLANK_BOUNDS.min - 1e-6);
        expect(Math.max(...xs)).toBeLessThanOrEqual(PLANK_BOUNDS.max + 1e-6);
      }
      // 같은 깊이의 앞면끼리 겹치면 안 된다(뒤에 놓인 눕힌 책은 화면에서 겹쳐도 닿지 않는다).
      for (let y = 0.5; y < FLOOR; y += 2) {
        for (let x = 0.5; x < 365; x += 2) {
          const touching = frames.filter((f) => f.box!.z === 0 && pointInPoly({ x, y }, frontOutline(f)));
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
          expect(Math.max(...frontOutline(f).map((p) => p.y))).toBeCloseTo(FLOOR, 6); // 선반 공간 바닥(깊이 밀림 전)
          expect(Math.max(...f.poly.map((p) => p.y))).toBeCloseTo(FLOOR - (f.pose === 'horizontal' ? LYING_BACK : 0), 6);
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
