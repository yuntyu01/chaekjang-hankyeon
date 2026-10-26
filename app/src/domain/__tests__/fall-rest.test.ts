// 받침을 잃고 넘어진 책이 머무는 곳(shelf-scene layFallen·fallRest): 판 끝에 걸쳐 눕기(overhang), 먼저 누운 책에 막혀 다시 서기,
// 서로 쪽으로 넘어진 두 권의 A자 기대기, 서랍으로 떨어지는 책의 사라지는 경로(transition dropTrack).
import { pivotLocal, toWorld } from '../book3';
import { bookXs, checkSpace, fitToShelf, OVERHANG_MARGIN, placementOf, validate, withNormalizedX, type BookMap } from '../layout-engine';
import { computeShelf, PLANK_BOUNDS, withLeans } from '../shelf-scene';
import { bookAt, dropTrack } from '../transition';
import type { Book, BookPlacement, ShelfLayout } from '../types';

const book = (id: string, height: number, thickness: number): Book => ({
  id,
  title: id,
  themeColor: '#CCBBAA',
  heightClass: 'medium',
  thicknessClass: 'medium',
  coverAspectRatio: 0.7,
  art: { motif: 'leaf' },
  dims: { height, thickness },
});
const place = (bookId: string, order: number, pos: number, tilt: -7 | 0 | 7 = 0): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt, pos });
const layoutOf = (...placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] });
const without = (l: ShelfLayout, id: string): ShelfLayout => ({ ...l, placements: l.placements.filter((p) => p.bookId !== id) });

describe('판 끝에 걸쳐 눕기', () => {
  // D가 왼쪽 C에 기대 있다가 C를 빼면 왼쪽으로 넘어진다. 무게중심(발 - 키/2)은 판 위라 판 왼쪽 끝 밖으로 걸쳐 눕는다
  const C = book('C', 120, 34);
  const D = book('D', 160, 30);
  const books: BookMap = { C, D };
  const before = withLeans(layoutOf(place('C', 0, 50), place('D', 1, 114, -7)), books);

  it('기대 있던 책이 판 끝 밖으로 걸쳐 눕는다(서랍으로 가지 않는다)', () => {
    expect(computeShelf(before, books, 's').frames.find((f) => f.bookId === 'D')!.box.angle).toBeLessThan(0);
    const after = withLeans(without(before, 'C'), books);
    expect(after.drawer).toEqual([]);
    const p = placementOf(after, 'D')!;
    expect(p.pose).toBe('horizontal');
    expect(p.overhang).toBe(true);
    const x = bookXs(after, books).get('D')!;
    expect(x).toBeLessThan(0);
    // 무게중심은 판 끝에서 OVERHANG_MARGIN 안
    expect(x + 160 / 2).toBeGreaterThanOrEqual(PLANK_BOUNDS.min + OVERHANG_MARGIN - 1e-6);
    expect(checkSpace(after, books)).toBeNull();
    expect(validate(after, books, ['D'])).toEqual([]);
  });

  it('저장했다 불러와도 그대로 걸쳐 있다', () => {
    const after = withLeans(without(before, 'C'), books);
    const saved = JSON.parse(JSON.stringify(withNormalizedX(after, books)));
    expect(fitToShelf(saved, books).changed).toBe(false);
    expect(bookXs(withLeans(saved, books), books).get('D')).toBeCloseTo(bookXs(after, books).get('D')!, 6);
  });

  it('무게중심이 판 끝에서 OVERHANG_MARGIN 안쪽이 아니면 판에서 떨어져 서랍으로 간다', () => {
    // 발이 판 끝에서 키/2 + 1DU: 무게중심이 판 끝(−1.5)에서 2.5DU 안쪽뿐
    const l = withLeans(layoutOf(place('C', 0, 79 - 34 - 30), place('D', 1, 79, -7)), books);
    expect(computeShelf(l, books, 's').frames.find((f) => f.bookId === 'D')!.box.angle).toBeLessThan(0);
    expect(withLeans(without(l, 'C'), books).drawer).toEqual(['D']);
  });
});

describe('먼저 누운 책에 막혀 다시 서기', () => {
  // A는 오른쪽 R에, B는 왼쪽 R에 기대 있다. R을 빼면 B가 먼저 왼쪽으로 누워 A의 발 바로 앞을 막고, A는 넘어지지 않고 선다
  const A = book('A', 196, 30);
  const R = book('R', 140, 35);
  const B = book('B', 160, 32);
  const books: BookMap = { A, R, B };
  it('넘어지자마자 누운 책에 닿으면 다시 똑바로 선다(눕혀 옆 책을 밀거나 서랍으로 보내지 않는다)', () => {
    const before = withLeans(layoutOf(place('A', 0, 58, 7), place('R', 1, 130), place('B', 2, 212, -7)), books);
    const fs = computeShelf(before, books, 's').frames;
    expect(fs.find((f) => f.bookId === 'A')!.leanOn).toBe('R');
    expect(fs.find((f) => f.bookId === 'B')!.leanOn).toBe('R');
    const after = withLeans(without(before, 'R'), books);
    expect(after.drawer).toEqual([]);
    expect(placementOf(after, 'B')!.pose).toBe('horizontal');
    const a = placementOf(after, 'A')!;
    expect(a.pose).toBe('spine');
    expect(a.tilt).toBe(0);
    expect(validate(after, books, ['A', 'B'])).toEqual([]);
  });
});

describe('서로 쪽으로 넘어진 두 권: A자로 기댄다', () => {
  const L = book('L', 156.3, 45.7);
  const M = book('M', 100, 68.3);
  const Rb = book('Rb', 156.3, 42.4);
  const W = book('W', 152.5, 44.1);
  const E = book('E', 166.2, 45.2);
  const books: BookMap = { L, M, Rb, W, E };
  it('가운데 받침을 빼면 두 권이 가운데서 만나 서로에게 기대 선다(발 마찰로 버티는 각)', () => {
    const before = withLeans(layoutOf(place('W', 0, 32), place('L', 1, 82, 7), place('M', 2, 160.7), place('Rb', 3, 262, -7), place('E', 4, 304.6)), books);
    const fs = computeShelf(before, books, 's').frames;
    expect(fs.find((f) => f.bookId === 'L')!.leanOn).toBe('M');
    expect(fs.find((f) => f.bookId === 'Rb')!.leanOn).toBe('M');
    const after = withLeans(without(before, 'M'), books);
    expect(after.drawer).toEqual([]);
    const l = computeShelf(after, books, 's').frames;
    const fl = l.find((f) => f.bookId === 'L')!;
    const fr = l.find((f) => f.bookId === 'Rb')!;
    expect(fl.leanOn).toBe('Rb');
    expect(fr.leanOn).toBe('L');
    expect(fl.box.angle).toBeGreaterThan(20);
    expect(fl.box.angle).toBeLessThan(38.7);
    expect(Math.abs(fl.box.angle + fr.box.angle)).toBeLessThan(1e-6);
    // 다시 풀어도 같다
    expect(withLeans(after, books).placements).toEqual(after.placements);
  });
});

describe('서랍으로 떨어지는 책의 경로(dropTrack)', () => {
  const b = { id: 'x', dims: { T: 30, H: 160, W: 110 }, roll: 12, yaw: 0, t: { x: 100, y: 0, z: 5 } };
  for (const d of [-1, 1] as const) {
    it(`${d > 0 ? '오른쪽' : '왼쪽'}: 발을 축으로 눕고 옅어져 사라진다`, () => {
      const tr = dropTrack(b, d);
      expect(bookAt(tr, 0).alpha).toBe(1);
      expect(bookAt(tr, 1).alpha).toBe(0);
      expect(bookAt(tr, 1).roll).toBeCloseTo(d * 90, 6);
      const foot = toWorld(bookAt(tr, 0), pivotLocal(b.dims, d));
      for (let k = 0; k <= 12; k++) {
        const q = bookAt(tr, (0.6 * k) / 12);
        const f = toWorld(q, pivotLocal(q.dims, d));
        expect(Math.hypot(f.x - foot.x, f.y - foot.y, f.z - foot.z)).toBeLessThan(1e-6);
      }
      let a = 1;
      for (let k = 0; k <= 20; k++) {
        const q = bookAt(tr, k / 20).alpha!;
        expect(q).toBeLessThanOrEqual(a + 1e-12);
        a = q;
      }
    });
  }
});
