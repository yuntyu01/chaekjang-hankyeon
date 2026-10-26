// 받침을 잃고 바닥에 눕는 책: 발(기우는 쪽 바닥 모서리)을 축으로 넘어지는 쪽으로만 돌고, 깊이는 그대로, 오른쪽으로 넘어지면
// 머리가 오른쪽(flip). 키 큰 책을 돌리는 경로는 윗선반 판을 뚫지 않는다(firstOverlap ceil).
import { corners, fromPlaced, lowest, pivotLocal, toWorld, type Book3 } from '../book3';
import { SHELF_FRONT } from '../geometry';
import { moveBook, normalize, placementOf, setPose, type BookMap } from '../layout-engine';
import { bodiesOf, computeShelf, PLANK_BOUNDS, withLeans } from '../shelf-scene';
import { fallenSpan } from '../statics';
import { bookAt, firstOverlap, gravityPlan, planTransition, type Track } from '../transition';
import type { Book, BookPlacement, ShelfLayout } from '../types';

const NO_RUSH = { budgetMs: 60_000 };
const book = (id: string, height: number, thickness: number, coverAspectRatio = 0.7): Book => ({
  id,
  title: id,
  themeColor: '#CCBBAA',
  heightClass: 'medium',
  thicknessClass: 'medium',
  coverAspectRatio,
  art: { motif: 'leaf' },
  dims: { height, thickness },
});
const place = (bookId: string, order: number, pos: number, tilt: -7 | 0 | 7 = 0): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt, pos });
const layoutOf = (...placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] });
const comY = (b: Book3) => corners(b).reduce((s, c) => s + c.y, 0) / 8;

const C = book('C', 120, 34);
const D = book('D', 160, 30);
const books: BookMap = { C, D };
// D가 C에 기대 있다가 C를 빼면 받침 없이 바닥까지 넘어진다(왼쪽: C가 왼쪽, 오른쪽: C가 오른쪽)
const SIDES = [
  { name: '왼쪽', dir: -1, layout: layoutOf(place('C', 0, 150), place('D', 1, 150 + 34 + 30, -7)) },
  { name: '오른쪽', dir: 1, layout: layoutOf(place('D', 0, 100, 7), place('C', 1, 100 + 30 + 30)) },
] as const;

function fall(l0: ShelfLayout) {
  const before = withLeans(l0, books);
  const after = withLeans({ ...before, placements: before.placements.filter((p) => p.bookId !== 'C') }, books);
  return { before, after };
}

describe('받침을 잃고 바닥에 눕기', () => {
  for (const side of SIDES) {
    it(`${side.name}으로 넘어지면 발을 축으로 그쪽으로 눕고, 깊이는 그대로다`, () => {
      const { before, after } = fall(side.layout);
      const was = computeShelf(before, books, 's').frames.find((f) => f.bookId === 'D')!;
      expect(Math.sign(was.box.angle)).toBe(side.dir);
      const p = placementOf(after, 'D')!;
      expect(p.pose).toBe('horizontal');
      expect(!!p.flip).toBe(side.dir > 0);
      const lying = computeShelf(after, books, 's').frames.find((f) => f.bookId === 'D')!;
      expect(lying.box.z).toBeCloseTo(was.box.z, 6);
      // 축 모서리에서 키만큼 넘어진 쪽
      const span = fallenSpan({ ...was.box, angle: 0 }, side.dir);
      expect(lying.box.x).toBeCloseTo(span.x0, 1);
      expect(fromPlaced(lying.box).roll).toBe(side.dir * 90);
    });

    it(`${side.name}으로 넘어지는 동작: 발이 제자리에 있고 넘어지는 쪽으로만 돌며 점점 빨라진다`, () => {
      const { before, after } = fall(side.layout);
      const prev = bodiesOf(before, books, 's').filter((b) => b.id !== 'C');
      const plan = planTransition(prev, bodiesOf(after, books, 's'), PLANK_BOUNDS, NO_RUSH);
      expect(plan.strategy).not.toBe('pull');
      const g = gravityPlan(plan, PLANK_BOUNDS);
      expect(g?.fall).toBe(true);
      const tr = g!.tracks.find((t: Track) => t.id === 'D')!;
      expect(tr.segs.some((s) => s.e === 1)).toBe(true);
      const start = bookAt(tr, 0);
      const foot = toWorld(start, pivotLocal(start.dims, side.dir));
      let roll = start.roll;
      let y = comY(start);
      for (let k = 1; k <= 40; k++) {
        const b = bookAt(tr, k / 40);
        const f = toWorld(b, pivotLocal(b.dims, side.dir));
        expect(Math.hypot(f.x - foot.x, f.y - foot.y, f.z - foot.z)).toBeLessThan(0.01);
        expect(lowest(b)).toBeCloseTo(0, 6);
        expect((b.roll - roll) * side.dir).toBeGreaterThanOrEqual(-1e-9);
        expect(comY(b)).toBeLessThanOrEqual(y + 1e-9);
        roll = b.roll;
        y = comY(b);
      }
      expect(roll).toBeCloseTo(side.dir * 90, 6);
      // 천천히 출발해 닿을 때 가장 빠르다
      expect(Math.abs(bookAt(tr, 0.5).roll - start.roll)).toBeLessThan(Math.abs(roll - start.roll) / 4);
    });
  }

  it('표지 폭이 좁은 책도 눕힌 기본 깊이로 뒤로 튀지 않는다', () => {
    for (const aspect of [0.7, 0.5, 0.45]) {
      const all: BookMap = { C, D: book('D', 160, 30, aspect) };
      const before = withLeans(SIDES[0].layout, all);
      const z = computeShelf(before, all, 's').frames.find((f) => f.bookId === 'D')!.box.z;
      const after = withLeans({ ...before, placements: before.placements.filter((p) => p.bookId !== 'C') }, all);
      expect(computeShelf(after, all, 's').frames.find((f) => f.bookId === 'D')!.box.z).toBeCloseTo(z, 6);
    }
  });
});

describe('머리가 오른쪽인 눕힌 책(flip)', () => {
  const { after } = fall(SIDES[1].layout);

  it('상자 범위는 기본 눕힘과 같고 그리는 방향만 다르다', () => {
    const box = computeShelf(after, books, 's').frames.find((f) => f.bookId === 'D')!.box;
    const a = fromPlaced(box);
    const b = fromPlaced({ ...box, flip: undefined });
    const key = (x: Book3) => corners(x).map((c) => `${c.x.toFixed(6)},${c.y.toFixed(6)},${c.z.toFixed(6)}`).sort().join('|');
    expect(key(a)).toBe(key(b));
    expect(a.roll).toBe(90);
    expect(b.roll).toBe(-90);
  });

  it('정리·옮기기에도 남고, 자세를 바꾸면 없어진다', () => {
    expect(placementOf(normalize(after), 'D')!.flip).toBe(true);
    const moved = moveBook(after, books, 'D', { kind: 'insert', shelfId: 's', index: 0, x: 20 });
    if (!moved.ok) throw new Error(moved.reason);
    expect(placementOf(moved.layout, 'D')!.flip).toBe(true);
    const up = setPose(after, books, 'D', 'spine');
    if (!up.ok) throw new Error(up.reason);
    expect(placementOf(up.layout, 'D')!.flip).toBeUndefined();
    const down = setPose(up.layout, books, 'D', 'horizontal');
    if (!down.ok) throw new Error(down.reason);
    expect(placementOf(down.layout, 'D')!.flip).toBeUndefined();
  });
});

describe('윗선반 판(천장)', () => {
  // 맨 아랫줄 줄 높이 = 가장 키 큰 책 188 + 여유 10.55. 두께 69 책(약 1000쪽)을 제자리에서 눕히면 대각선(200.3)이 판을 뚫는다
  const big = book('B', 188, 69);
  const all: BookMap = { B: big };
  const ceil = 188 + 10.55;
  const topUnder = (tr: Track) => {
    let top = -Infinity;
    for (let k = 0; k <= 200; k++) for (const c of corners(bookAt(tr, k / 200))) if (c.z > -SHELF_FRONT) top = Math.max(top, c.y);
    return top;
  };

  it('경로 검사가 판을 뚫는 경로를 잡고, 계획은 판 아래로만 지나간다', () => {
    const l = withLeans(layoutOf(place('B', 0, 150)), all);
    const r = setPose(l, all, 'B', 'horizontal');
    if (!r.ok) throw new Error(r.reason);
    const prev = bodiesOf(l, all, 's');
    const next = bodiesOf(r.layout, all, 's');
    const free = planTransition(prev, next, PLANK_BOUNDS, NO_RUSH);
    expect(topUnder(free.tracks[0])).toBeGreaterThan(ceil + 1);
    expect(firstOverlap(free.tracks, PLANK_BOUNDS, Infinity, ceil)?.b).toBe('ceiling');
    const roofed = planTransition(prev, next, PLANK_BOUNDS, { ...NO_RUSH, ceil });
    expect(topUnder(roofed.tracks[0])).toBeLessThanOrEqual(ceil + 0.3);
  });

  it('처음부터 판 높이 밖에 있던 책(다른 줄에서 오는 책)은 천장 검사를 하지 않는다', () => {
    const l = withLeans(layoutOf(place('B', 0, 150)), all);
    const b = bodiesOf(l, all, 's')[0];
    const high = { ...b, t: { ...b.t, y: b.t.y + 40 } };
    const plan = planTransition([high], [b], PLANK_BOUNDS, { ...NO_RUSH, ceil });
    expect(firstOverlap(plan.tracks, PLANK_BOUNDS, Infinity, ceil)?.b).not.toBe('ceiling');
  });
});
