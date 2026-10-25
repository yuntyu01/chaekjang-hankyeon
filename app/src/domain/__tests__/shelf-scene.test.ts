// 선반 장면(3D 상자 프레임): 앞면 윤곽은 선반 공간 x, 바닥(판 윗면) 0·위가 -. 터치 외곽은 상자를 카메라로 투영한 것.
// 장면 터치(가장 앞에 보이는 책 고르기)는 scene-pick.test.ts.
import { fromPlaced, lowest } from '../book3';
import { BASE_CAM } from '../camera';
import { bookHeight, bookThickness, singleFootprint } from '../geometry';
import type { BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { computeShelf, frontOutline, outlineOf, PLANK_BOUNDS, pointInPoly, standaloneFrame } from '../shelf-scene';
import { overlaps } from '../test-fixtures/overlap';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));

describe('기울인 책', () => {
  it.each([7, -7] as const)('%i°: 발은 제자리, 가장 낮은 점이 선반 바닥에 닿는다', (tilt) => {
    const b = { ...books.b01, reference: undefined };
    const up = standaloneFrame(b, 'spine');
    const f = { ...up, box: { ...up.box, x: 100, angle: tilt } };
    const o = frontOutline(f);
    expect(Math.max(...o.map((p) => p.y))).toBeCloseTo(0, 6);
    const pivotX = tilt > 0 ? 100 + bookThickness(b) : 100;
    expect(o.some((p) => Math.abs(p.x - pivotX) < 1e-6 && Math.abs(p.y) < 1e-6)).toBe(true);
    expect(lowest(fromPlaced(f.box))).toBeCloseTo(0, 6); // 3D 상자도 판 윗면에 닿는다
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
    expect(Math.max(...bp.map((p) => p.y))).toBeCloseTo(0, 6);
  });

  it('모든 책이 바닥 위에 있고 실제 윤곽은 서로 겹치지 않는다', () => {
    for (const s of SAMPLE_LAYOUT.shelves) {
      const { frames, items } = computeShelf(SAMPLE_LAYOUT, books, s.id);
      for (const f of frames) expect(Math.max(...frontOutline(f).map((p) => p.y))).toBeLessThanOrEqual(1e-6);
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
      // 같은 깊이의 앞면끼리 파고들면 안 된다(맞닿음은 된다. 뒤에 놓인 눕힌 책은 화면에서 겹쳐도 닿지 않는다).
      const front = frames.filter((f) => f.box.z === 0);
      for (let i = 0; i < front.length; i++)
        for (let j = i + 1; j < front.length; j++) {
          if (front[i].itemKey === front[j].itemKey) continue;
          expect(overlaps(frontOutline(front[i]), frontOutline(front[j]), 0.05)).toBe(false);
        }
    }
  });

  it('윤곽이 비정형인 예시도 기울기와 관계없이 실제 밑면이 선반에 닿는다', () => {
    for (const tilt of [-7, 0, 7] as const) {
      const layout = { ...SAMPLE_LAYOUT, placements: SAMPLE_LAYOUT.placements.map((p) => ({ ...p, tilt: p.pose === 'spine' ? tilt : p.tilt })) };
      for (const shelf of layout.shelves) {
        const { frames } = computeShelf(layout, books, shelf.id);
        for (const f of frames.filter((frame) => frame.stackIndex === 0)) {
          expect(Math.max(...frontOutline(f).map((p) => p.y))).toBeCloseTo(0, 6); // 선반 공간 바닥(깊이 밀림 전)
          // 터치 외곽(상자를 기본 카메라로 투영한 볼록 외곽)의 가운데는 그 책 위
          const poly = outlineOf(BASE_CAM, fromPlaced(f.box));
          const center = poly.reduce((p, q) => ({ x: p.x + q.x / poly.length, y: p.y + q.y / poly.length }), { x: 0, y: 0 });
          expect(pointInPoly(center, poly)).toBe(true);
        }
      }
    }
  });
});
