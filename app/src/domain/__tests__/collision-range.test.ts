import { collisionRangeX, fromPlaced, gap, type Book3 } from '../book3';
import type { Placed } from '../box';
import { itemBoxes, itemPositions, shelfItems, type BookMap } from '../layout-engine';
import type { Book, ShelfLayout } from '../types';

const move = (b: Book3, dx: number): Book3 => ({ ...b, t: { ...b.t, x: b.t.x + dx } });
const box = (extra: Partial<Placed> = {}): Placed => ({ bookId: 'book', pose: 'front', size: { w: 100, h: 150, d: 22 }, x: 0, y: 0, z: 0, angle: 0, ...extra });

it('axis-aligned boxes have an exact collision interval, including contact tolerance', () => {
  const a = fromPlaced(box());
  const b = fromPlaced(box({ x: 20 }));
  expect(collisionRangeX(a, b, 0.01)).toEqual({ lo: -119.99, hi: 79.99 });
  expect(collisionRangeX(a, fromPlaced(box({ y: 150 })))).toBeNull();
  expect(collisionRangeX(a, fromPlaced(box({ z: 22 })))).toBeNull();
});

it('detects a narrow rotated-corner collision that lies between coarse position samples', () => {
  const a = fromPlaced(box({ spin: 6 }));
  const b = fromPlaced(box({ spin: -20, z: 43.25 }));
  const range = collisionRangeX(a, b, 0.01)!;
  expect(range.lo).toBeCloseTo(2.212508, 5);
  expect(range.hi).toBeCloseTo(6.425719, 5);
  expect(gap(a, move(b, 5))).toBeLessThan(-0.01);
  expect(gap(a, move(b, range.hi))).toBeCloseTo(-0.01, 8);
  expect(gap(a, move(b, range.hi + 0.01))).toBeGreaterThan(-0.01);
});

it('packing separates those rotated books, including sub-tolerance depth changes', () => {
  const makeBook = (id: string): Book => ({ id, title: id, themeColor: '#CCBBAA', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 2 / 3, art: { motif: 'leaf' }, dims: { height: 150, thickness: 22, coverWidth: 100 } });
  const books: BookMap = { a: makeBook('a'), b: makeBook('b') };
  // The last two depths shared the old rounded cache key, but have different collision boundaries.
  for (const depth of [43.25, 43.254, 43.251]) {
    const layout: ShelfLayout = { version: 2, shelves: [{ id: 's', order: 0 }], drawer: [], placements: [
      { bookId: 'a', shelfId: 's', order: 0, pose: 'front', tilt: 0, spin: 6, depth: 0, pos: 10 },
      { bookId: 'b', shelfId: 's', order: 1, pose: 'front', tilt: 0, spin: -20, depth, pos: 15 },
    ] };
    const positions = itemPositions(shelfItems(layout, 's'), layout, books);
    const [a, b] = positions.map(p => fromPlaced(itemBoxes(p.item, layout, books, p.x)[0]));
    expect(positions[1].x).toBeGreaterThan(16.4);
    expect(gap(a, b)).toBeGreaterThanOrEqual(-0.01000001);
  }
});

it('agrees with independent SAT collision checks for tilted, pitched and spun boxes', () => {
  const poses = [box(), box({ pose: 'spine', angle: 18 }), box({ spin: -17, pitch: 32 }), box({ pose: 'horizontal', spin: 12 })];
  for (const pa of poses) for (const pb of poses) {
    const a = fromPlaced(pa);
    const b = fromPlaced({ ...pb, z: pb.z + 11, y: 3 });
    const range = collisionRangeX(a, b, 0.01);
    for (let x = -180.125; x < 180; x += 7.25) {
      const inside = range !== null && x > range.lo && x < range.hi;
      expect(inside).toBe(gap(a, move(b, x)) < -0.01);
    }
  }
});

it('randomized orientations keep both endpoints at the SAT contact tolerance', () => {
  let seed = 0x3821a;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const body = (): Book3 => ({
    id: 'test', dims: { T: 10 + random() * 35, H: 90 + random() * 110, W: 60 + random() * 80 },
    roll: random() * 180 - 90, yaw: random() * 90, spin: random() * 40 - 20, pitch: random() * 60,
    t: { x: random() * 60, y: random() * 40, z: random() * 80 },
  });
  let collidingPairs = 0;
  for (let i = 0; i < 300; i++) {
    const a = body();
    const b = body();
    const range = collisionRangeX(a, b, 0.01);
    if (range) {
      collidingPairs++;
      expect(gap(a, move(b, (range.lo + range.hi) / 2))).toBeLessThan(-0.01);
      for (const endpoint of [range.lo, range.hi]) expect(gap(a, move(b, endpoint))).toBeCloseTo(-0.01, 7);
      expect(gap(a, move(b, range.lo - 0.001))).toBeGreaterThan(-0.01);
      expect(gap(a, move(b, range.hi + 0.001))).toBeGreaterThan(-0.01);
    } else {
      for (const dx of [-200, -100, -50, 0, 50, 100, 200]) expect(gap(a, move(b, dx))).toBeGreaterThanOrEqual(-0.01000001);
    }
  }
  expect(collidingPairs).toBeGreaterThan(50);
});
