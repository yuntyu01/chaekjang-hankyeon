// 전환 경로: 모든 진행률 t에서 겹치지 않고, 끝은 정확히 목표 배치.
import { SHELF } from '../geometry';
import { setTilt, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { computeShelf, PLANK_BOUNDS, withLeans } from '../shelf-scene';
import type { Placed } from '../box';
import { boxAt, firstOverlap, planTransition, SAMPLES } from '../transition';
import type { Book, BookPlacement, ShelfLayout, Tilt } from '../types';

const boxesOf = (l: ShelfLayout, books: BookMap, shelf: string) => computeShelf(l, books, shelf).frames.map((f) => f.box!);

const book = (id: string, height: number, thickness: number): Book => ({
  id, title: id, themeColor: '#CCBBAA', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 0.7,
  art: { motif: 'leaf' }, dims: { height, thickness, coverWidth: 120 },
});
const small: BookMap = { A: book('A', 180, 40), B: book('B', 150, 28), C: book('C', 120, 34) };
const place = (bookId: string, order: number, pos: number, tilt: Tilt = 0): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt, pos });
const layoutOf = (...placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] });

function expectClean(prev: ShelfLayout, next: ShelfLayout, books: BookMap, shelf: string) {
  const a = boxesOf(prev, books, shelf);
  const b = boxesOf(next, books, shelf);
  const plan = planTransition(a, b, PLANK_BOUNDS);
  expect(firstOverlap(plan.entries, PLANK_BOUNDS)).toBeNull();
  // 끝(t=1)은 목표와 같고, 시작(t=0)은 이전과 같다
  for (const e of plan.entries) {
    const end = boxAt(e, 1);
    const target = b.find((p) => p.bookId === e.id)!;
    expect(end.x).toBeCloseTo(target.x, 6);
    expect(end.angle).toBeCloseTo(target.angle, 6);
    const start = boxAt(e, 0);
    const origin = a.find((p) => p.bookId === e.id) ?? target;
    if (origin.pose === target.pose) expect(start.angle).toBeCloseTo(origin.angle, 6);
    // 어느 t에서도 바닥 아래로 내려가지 않는다
    for (let k = 0; k <= SAMPLES; k++) expect(boxAt(e, k / SAMPLES).y).toBeGreaterThanOrEqual(0);
  }
  return plan;
}

describe('기울이기 경로', () => {
  it('메뉴로 기울이기(틈 벌리기 + 기울기): 도중에도 겹치지 않는다', () => {
    const base = withLeans(layoutOf(place('A', 0, 0), place('B', 1, 40), place('C', 2, 68)), small);
    for (const [id, tilt] of [['C', -7], ['B', -7], ['A', 7], ['B', 7]] as const) {
      const r = setTilt(base, small, id, tilt);
      if (!r.ok) continue;
      const next = withLeans(r.layout, small);
      const plan = expectClean(base, next, small, 's');
      expect(plan.strategy).not.toBe('snap');
    }
  });

  it('기울인 책을 다시 세우기도 겹치지 않는다', () => {
    const leaning = withLeans(layoutOf(place('A', 0, 0), place('B', 1, 40 + 16, -7)), small);
    const r = setTilt(leaning, small, 'B', 0);
    if (!r.ok) throw new Error(r.reason);
    expectClean(leaning, withLeans(r.layout, small), small, 's');
  });

  it('함께 움직이면 파고드는 경우(세우면서 옆 책이 다가옴) 경로를 바꿔 피한다', () => {
    // 키 큰 B가 왼쪽 A에 15도로 기대 있다가 서고, 그사이 A가 B 옆으로 다가온다.
    // 같은 t로 동시에 움직이면 sin이 볼록해서 도중에 B 윗모서리가 A를 파고든다.
    const B: Placed = { bookId: 'B', pose: 'spine', size: { w: 30, h: 320, d: 100 }, x: 200, y: 0, z: 0, angle: 0 };
    const A: Placed = { bookId: 'A', pose: 'spine', size: { w: 40, h: 330, d: 100 }, x: 0, y: 0, z: 0, angle: 0 };
    const reach = 320 * Math.sin((15 * Math.PI) / 180);
    const prev = [{ ...A, x: 200 - reach - 40 }, { ...B, angle: -15 }];
    const next = [{ ...A, x: 160 }, B];
    const plan = planTransition(prev, next, { min: -100, max: 500 });
    expect(plan.strategy).not.toBe('A');
    expect(firstOverlap(plan.entries, { min: -100, max: 500 })).toBeNull();
  });

  it('예시 18권: 선반마다 모든 세운 책을 기울였다 되돌려도 경로가 깨끗하다', () => {
    const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
    const base = withLeans(SAMPLE_LAYOUT, books);
    for (const p of base.placements.filter((q) => q.pose === 'spine')) {
      for (const tilt of [-7, 7, 0] as const) {
        if (p.tilt === tilt) continue;
        const r = setTilt(base, books, p.bookId, tilt);
        if (!r.ok) continue;
        expectClean(base, withLeans(r.layout, books), books, p.shelfId);
      }
    }
    expect(SHELF.clearHeight).toBeGreaterThan(0);
  });
});
