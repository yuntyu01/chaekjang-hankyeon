// 받침을 잃고 넘어진 책이 머무는 곳(shelf-scene layFallen·fallRest): 판 끝에 걸쳐 눕기(overhang), 서로 쪽으로 넘어진 두 권의 A자 기대기,
// 발이 미끄러지다 뒤 책에 기운 몸이 닿아 막힌 기대기(lean.slide), 서랍으로 떨어지는 책의 사라지는 경로(transition dropTrack).
import { corners, fromPlaced, gap, lowest, pivotLocal, toWorld } from '../book3';
import {
  applySwapTarget,
  bookXs,
  checkSpace,
  detach,
  EDGE_PAD,
  findDropTarget,
  findSwapTarget,
  fitToShelf,
  moveBook,
  moveToShelf,
  OVERHANG_MARGIN,
  placementOf,
  setTilt,
  validate,
  withNormalizedX,
  type BookMap,
} from '../layout-engine';
import { bodiesOf, computeShelf, PLANK_BOUNDS, resolveLeans, withLeans } from '../shelf-scene';
import { bookAt, DROP_MS, dropFallMs, dropTrack, planTransition, retime, retimeDrop } from '../transition';
import { bookThickness, SHELF, SHELF_FRONT, SHELF_USABLE_WIDTH } from '../geometry';
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
  // D가 왼쪽 C에 기대 있다가 C를 빼면 왼쪽으로 넘어진다. 넘어진 자리(발 − 키)는 판 왼쪽 끝 밖이지만 무게중심은 판 위다.
  // 옆 책을 밀지 않고 남는 빈자리만큼 안쪽으로 미끄러지고, 모자라면 화면에 보이는 데까지만 걸치고, 그래도 안 되면 서랍으로(사용자 결정 2026-10-27)
  const C = book('C', 120, 34);
  const D = book('D', 160, 30);
  const E = book('E', 150, 30);
  const books: BookMap = { C, D, E };
  const fallWith = (ex?: number) => {
    const ps = [place('C', 0, 50), place('D', 1, 114, -7)];
    if (ex !== undefined) ps.push(place('E', 2, ex));
    const before = withLeans(layoutOf(...ps), books);
    expect(computeShelf(before, books, 's').frames.find((f) => f.bookId === 'D')!.box.angle).toBeLessThan(0);
    return { before, after: withLeans(without(before, 'C'), books) };
  };

  it('빈자리가 있으면 안쪽으로 미끄러져 판 안에 눕는다', () => {
    const { after } = fallWith();
    expect(after.drawer).toEqual([]);
    const p = placementOf(after, 'D')!;
    expect(p.pose).toBe('horizontal');
    expect(p.overhang).toBeUndefined();
    expect(bookXs(after, books).get('D')).toBeCloseTo(0, 6);
  });

  it('빈자리가 모자라면 옆 책을 밀지 않고 화면에 보이는 데까지만 판 끝에 걸친다', () => {
    const { before, after } = fallWith(156);
    expect(after.drawer).toEqual([]);
    const p = placementOf(after, 'D')!;
    expect(p.pose).toBe('horizontal');
    expect(p.overhang).toBe(true);
    const x = bookXs(after, books).get('D')!;
    expect(x).toBeLessThan(0);
    expect(x).toBeGreaterThanOrEqual(-SHELF.sideMargin + 1 - 1e-6);
    expect(Math.abs(bookXs(after, books).get('E')! - bookXs(before, books).get('E')!)).toBeLessThanOrEqual(0.5);
    expect(checkSpace(after, books)).toBeNull();
    expect(validate(after, books, ['D', 'E'])).toEqual([]);
    // 저장했다 불러와도 그대로 걸쳐 있다
    const saved = JSON.parse(JSON.stringify(withNormalizedX(after, books)));
    expect(fitToShelf(saved, books).changed).toBe(false);
    expect(bookXs(withLeans(saved, books), books).get('D')).toBeCloseTo(x, 6);
  });

  it('화면 안에서 걸쳐도 옆 책을 밀어야 하면 서랍으로 간다', () => {
    const { after } = fallWith(148);
    expect(after.drawer).toEqual(['D']);
  });

  it('무게중심이 판 끝에서 OVERHANG_MARGIN 안쪽이 아니면 판에서 떨어져 서랍으로 간다', () => {
    // 발이 판 끝에서 키/2 + 1DU: 무게중심이 판 끝(−1.5)에서 2.5DU 안쪽뿐
    const l = withLeans(layoutOf(place('C', 0, 79 - 34 - 30), place('D', 1, 79, -7)), books);
    expect(computeShelf(l, books, 's').frames.find((f) => f.bookId === 'D')!.box.angle).toBeLessThan(0);
    expect(withLeans(without(l, 'C'), books).drawer).toEqual(['D']);
  });
});

describe('판 끝에 걸친 책이 있는 줄', () => {
  // 위와 같이 빈자리가 모자라 화면에 보이는 데까지 걸친 D. 걸친 책은 사용 폭 밖이라, 줄 전체를 사용 폭으로 검사하면 그 줄의 모든 옮기기가 막혔다
  const books: BookMap = {
    C: book('C', 120, 34),
    D: book('D', 160, 30),
    E: book('E', 150, 30),
    F: book('F', 140, 32),
    H: book('H', 140, 40),
    I: book('I', 140, 40),
    J: book('J', 140, 40),
    K: book('K', 150, 30),
    M: book('M', 140, 45),
  };
  const hung = (...rest: BookPlacement[]) => {
    const t = (p: BookPlacement): BookPlacement => ({ ...p, shelfId: 't' });
    const before = withLeans(
      { version: 2, shelves: [{ id: 's', order: 0 }, { id: 't', order: 1 }], placements: [place('C', 0, 50), place('D', 1, 114, -7), ...rest, t(place('K', 0, 0)), t(place('M', 1, 40))], drawer: [] },
      books,
    );
    const l = withLeans(without(before, 'C'), books);
    expect(placementOf(l, 'D')!.overhang).toBe(true);
    return l;
  };

  it('그 줄의 다른 책을 끌어 옮길 수 있다', () => {
    const l = hung(place('E', 2, 156), place('F', 3, 230));
    for (const [id, dx] of [['E', 3], ['E', 40], ['F', 50], ['F', -30], ['E', 100]] as const) {
      const c = bookXs(l, books).get(id)! + books[id]!.dims!.thickness! / 2 + dx;
      const r = applySwapTarget(l, books, id, findSwapTarget(l, books, id, c));
      expect(r.ok).toBe(true);
    }
  });

  it('다른 줄 책을 그 줄에 놓을 수 있다', () => {
    const l = hung(place('E', 2, 156), place('F', 3, 230));
    for (const x of [220, 300, 330]) {
      const r = moveBook(l, books, 'K', findDropTarget(detach(l, 'K', books), books, 's', x, 'spine', 30));
      expect(r.ok).toBe(true);
    }
  });

  it('끼워 넣은 책에 밀려도 화면 밖으로 나가지 않는다(더 밀어야 하면 거절)', () => {
    let l = hung(place('E', 2, 156), place('F', 3, 190), place('H', 4, 225), place('I', 5, 268), place('J', 6, 310));
    const r1 = moveToShelf(l, books, 'K', 's');
    expect(r1.ok).toBe(true);
    l = withLeans((r1 as { layout: ShelfLayout }).layout, books);
    expect(bookXs(l, books).get('D')!).toBeLessThan(0);
    expect(bookXs(l, books).get('D')!).toBeGreaterThanOrEqual(-SHELF.sideMargin + EDGE_PAD - 1e-6);
    // 45 두께 한 권 더: 걸친 책을 화면 밖으로 밀어야 들어간다
    expect(moveToShelf(l, books, 'M', 's').ok).toBe(false);
  });
});

describe('키가 다른 두 권이 서로 쪽으로 넘어질 때', () => {
  // A는 오른쪽 R에, B는 왼쪽 R에 기대 있다. R을 빼면 둘이 함께 넘어져 가운데서 만난다(한 권씩 풀면 B가 먼저 누워 A의 발 앞을 막았다)
  const A = book('A', 196, 30);
  const R = book('R', 140, 35);
  const B = book('B', 160, 32);
  const books: BookMap = { A, R, B };
  it('함께 넘어져 A자로 기대 선다(어느 쪽도 눕거나 서랍으로 가지 않는다)', () => {
    const before = withLeans(layoutOf(place('A', 0, 58, 7), place('R', 1, 130), place('B', 2, 212, -7)), books);
    const fs = computeShelf(before, books, 's').frames;
    expect(fs.find((f) => f.bookId === 'A')!.leanOn).toBe('R');
    expect(fs.find((f) => f.bookId === 'B')!.leanOn).toBe('R');
    const after = withLeans(without(before, 'R'), books);
    expect(after.drawer).toEqual([]);
    const l = computeShelf(after, books, 's').frames;
    expect(l.find((f) => f.bookId === 'A')!.leanOn).toBe('B');
    expect(l.find((f) => f.bookId === 'B')!.leanOn).toBe('A');
    // 자리는 그대로(두 권 다 발이 제자리)
    expect(bookXs(after, books).get('A')).toBeCloseTo(58, 6);
    expect(bookXs(after, books).get('B')).toBeCloseTo(212, 6);
    expect(validate(after, books, ['A', 'B'])).toEqual([]);
    expect(withLeans(after, books).placements).toEqual(after.placements);
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
  it('밀려 넘어진 받침이 넘어진 쪽을 기록한다(서 있던 책이라 보이던 자세로는 알 수 없다)', () => {
    // b3을 왼쪽으로 기울이면 왼쪽 b1을 밀어 넘어뜨린다: 판 왼쪽 끝 밖으로 넘어져 서랍으로
    const books: BookMap = { b1: book('b1', 160.1, 41.4), b3: book('b3', 183, 46.9), b4: book('b4', 196, 34.9), b2: book('b2', 138.8, 41.8) };
    const l = withLeans(layoutOf(place('b1', 0, 37.49), place('b3', 1, 101.11), place('b4', 2, 185.51, -7), place('b2', 3, 306.01)), books);
    const r = setTilt(l, books, 'b3', -7);
    expect(r.ok).toBe(true);
    const input = (r as { layout: ShelfLayout }).layout;
    const before = JSON.stringify(input);
    const after = resolveLeans(input, books);
    expect(after.layout.drawer).toEqual(['b1']);
    expect(after.falls).toEqual({ b1: -1 });
    // 같은 ID를 가진 독립적인 미리보기를 반대 방향으로 풀어도 첫 결과를 바꾸지 않는다.
    const mirrored: ShelfLayout = { ...input, placements: input.placements.map(p => ({
      ...p, order: input.placements.length - 1 - p.order,
      pos: SHELF_USABLE_WIDTH - p.pos! - bookThickness(books[p.bookId]),
      tilt: -p.tilt as BookPlacement['tilt'],
      lean: p.lean ? { ...p.lean, angle: -p.lean.angle } : undefined,
    })) };
    const right = resolveLeans(mirrored, books);
    expect(right.falls).toEqual({ b1: 1 });
    expect(after.falls).toEqual({ b1: -1 });
    expect(resolveLeans(after.layout, books).falls).toEqual({});
    expect(JSON.stringify(input)).toBe(before);
  });

  it('비켜 가는 옆 책은 막지 않는다(같은 진행의 자세와 견준다)', () => {
    const b = { id: 'x', dims: { T: 30, H: 160, W: 110 }, roll: 5, yaw: 0, t: { x: 100, y: 0, z: 5 } };
    const n = { id: 'n', dims: { T: 30, H: 150, W: 110 }, roll: 0, yaw: 0, t: { x: 190, y: 0, z: 5 } };
    const away = planTransition([n], [{ ...n, t: { ...n.t, x: 330 } }], PLANK_BOUNDS, { budgetMs: 60_000 }).tracks;
    const still = bookAt(dropTrack(b, 1, [n]), 1).roll;
    const tr = dropTrack(b, 1, away);
    expect(bookAt(tr, 1).roll).toBeGreaterThan(still + 5);
    for (let k = 0; k <= 60; k++) expect(gap(bookAt(tr, k / 60), bookAt(away[0], k / 60))).toBeGreaterThan(-0.31);
  });

  it('옆 책 경로가 이 책 자리를 지나가면 그 전에 사라진다', () => {
    const b = { id: 'x', dims: { T: 30, H: 160, W: 110 }, roll: 0, yaw: 0, t: { x: 150, y: 0, z: 5 } };
    const n = { id: 'n', dims: { T: 30, H: 150, W: 110 }, roll: 0, yaw: 0, t: { x: 320, y: 0, z: 5 } };
    const pass = planTransition([n], [{ ...n, t: { ...n.t, x: 10 } }], PLANK_BOUNDS, { budgetMs: 60_000 }).tracks;
    const tr = dropTrack(b, -1, pass);
    expect(bookAt(tr, 1).alpha).toBe(0);
    for (let k = 0; k <= 120; k++) {
      const q = bookAt(tr, k / 120);
      if ((q.alpha ?? 1) >= 0.25) expect(gap(q, bookAt(pass[0], k / 120))).toBeGreaterThan(-0.31);
    }
  });

  it('넘어지다 옆 책에 닿으면 그 각에서 멈춰 옅어진다(옆 책을 뚫고 눕지 않는다)', () => {
    const b = { id: 'x', dims: { T: 30, H: 160, W: 110 }, roll: 5, yaw: 0, t: { x: 100, y: 0, z: 5 } };
    const n = { id: 'n', dims: { T: 30, H: 150, W: 110 }, roll: 0, yaw: 0, t: { x: 190, y: 0, z: 5 } };
    const tr = dropTrack(b, 1, [n]);
    const end = bookAt(tr, 1);
    expect(end.roll).toBeGreaterThan(20);
    expect(end.roll).toBeLessThan(90);
    for (let k = 0; k <= 40; k++) expect(gap(bookAt(tr, k / 40), n)).toBeGreaterThan(-0.31);
    expect(end.alpha).toBe(0);
  });

  it('옆 책이 나중에 비켜 가면 막혀 있던 각에서 따라 넘어져 끝까지 눕는다', () => {
    const b = { id: 'x', dims: { T: 30, H: 160, W: 110 }, roll: 5, yaw: 0, t: { x: 100, y: 0, z: 5 } };
    const n = { id: 'n', dims: { T: 30, H: 150, W: 110 }, roll: 0, yaw: 0, t: { x: 190, y: 0, z: 5 } };
    // 진행 0.5까지 제자리, 그 뒤 0.8까지 비켜 간다
    const away = retime(planTransition([n], [{ ...n, t: { ...n.t, x: 330 } }], PLANK_BOUNDS, { budgetMs: 60_000 }).tracks[0], -5 / 3, 0.3);
    const tr = dropTrack(b, 1, [away]);
    const stuck = bookAt(tr, 0.45).roll;
    expect(stuck).toBeLessThan(40);
    expect(bookAt(tr, 0.5).roll).toBeCloseTo(stuck, 6);
    expect(bookAt(tr, 1).roll).toBeCloseTo(90, 6);
    let r = b.roll;
    for (let k = 0; k <= 240; k++) {
      const q = bookAt(tr, k / 240);
      expect(q.roll).toBeGreaterThanOrEqual(r - 1e-9);
      r = q.roll;
      expect(gap(q, bookAt(away, k / 240))).toBeGreaterThan(-0.31);
    }
  });

  it('눕는 시간은 발을 축으로 쓰러지는 막대의 끝 빠르기에 맞는다(키 190mm 책 약 0.38초)', () => {
    const H = 145; // DU(약 190mm)
    expect(dropFallMs(H, 0)).toBeGreaterThan(360);
    expect(dropFallMs(H, 0)).toBeLessThan(400);
    // 끝 각속도(°/ms) = √(3g/H)
    const tr = dropTrack({ id: 'x', dims: { T: 30, H, W: 110 }, roll: 0, yaw: 0, t: { x: 100, y: H / 2, z: 5 } }, 1);
    const F = tr.segs[0].t1;
    const dt = 1e-4;
    const w = ((bookAt(tr, F).roll - bookAt(tr, F - dt).roll) / (dt * DROP_MS)) * ((Math.PI / 180) * 1000);
    expect(w).toBeGreaterThan(12.4 * 0.97);
    expect(w).toBeLessThan(12.4 * 1.03);
  });

  const b = { id: 'x', dims: { T: 30, H: 160, W: 110 }, roll: 12, yaw: 0, t: { x: 100, y: 0, z: 5 } };
  it('넘어지던 도중 다시 짜면 지금 자세·빠르기·진하기에서 그대로 이어 간다(다시 진해지거나 처음부터 출발하지 않는다)', () => {
    const tr = dropTrack(b, 1);
    for (const tc of [0.2, 0.5]) {
      const again = retimeDrop(tr, tc, 1);
      const mid = bookAt(tr, tc);
      expect(bookAt(again, 0).roll).toBeCloseTo(mid.roll, 9);
      expect(bookAt(again, 0).alpha ?? 1).toBeCloseTo(mid.alpha ?? 1, 9);
      for (let k = 1; k <= 20; k++) {
        const u = (k / 20) * (1 - tc);
        expect(bookAt(again, u).roll).toBeCloseTo(bookAt(tr, tc + u).roll, 6);
        expect(bookAt(again, u).alpha!).toBeCloseTo(bookAt(tr, tc + u).alpha!, 6);
      }
      expect(bookAt(again, 1 - tc).alpha).toBe(0);
    }
    // 새 줄 시계가 두 배 길면 남은 경로는 진행의 절반에 지나간다(실제 시간으로는 같다)
    const long = retimeDrop(tr, 0.3, 0.5);
    expect(bookAt(long, 0.05).roll).toBeCloseTo(bookAt(tr, 0.4).roll, 6);
  });

  it('표지 책(선반 앞 끝에서 떨어짐): 판 앞 끝 너머로 미끄러진 뒤 떨어지고, 판을 뚫지 않는다', () => {
    const fb = book('f', 150, 20);
    const l = layoutOf({ bookId: 'f', shelfId: 's', order: 0, pose: 'front', tilt: 0, pos: 100, pitch: 25 } as BookPlacement);
    const q0 = bodiesOf(l, { f: fb }, 's')[0];
    const tr = dropTrack(q0, 0);
    expect(bookAt(tr, 0).alpha).toBe(1);
    expect(bookAt(tr, 1).alpha).toBe(0);
    expect(lowest(bookAt(tr, 1))).toBeLessThan(-q0.dims.H / 2);
    for (let k = 0; k <= 120; k++) {
      const q = bookAt(tr, k / 120);
      for (const c of corners(q)) if (c.y < -0.3) expect(c.z).toBeLessThan(-SHELF_FRONT + 0.3);
      expect(q.pitch ?? 0).toBeCloseTo(q0.pitch ?? 0, 9);
    }
  });

  // b는 오른쪽으로 12° 기대 있다: 오른쪽으로는 그 발을 축으로 바로 눕고, 왼쪽으로는 먼저 오른발로 일어선 뒤 왼발을 축으로 눕는다
  for (const d of [-1, 1] as const) {
    it(`${d > 0 ? '오른쪽' : '왼쪽(반대쪽으로 기대 있던 책은 먼저 일어선다)'}: 발을 축으로 눕고 옅어져 사라진다`, () => {
      const tr = dropTrack(b, d);
      expect(bookAt(tr, 0).alpha).toBe(1);
      expect(bookAt(tr, 1).alpha).toBe(0);
      expect(bookAt(tr, 1).roll).toBeCloseTo(d * 90, 6);
      const rightFoot = toWorld(bookAt(tr, 0), pivotLocal(b.dims, 1));
      let down: ReturnType<typeof toWorld> | null = null;
      let r = b.roll * d;
      for (let k = 0; k <= 240; k++) {
        const q = bookAt(tr, k / 240);
        expect(q.roll * d).toBeGreaterThanOrEqual(r - 1e-9);
        r = q.roll * d;
        // 오른쪽에 기운 동안은 오른발, 왼쪽으로 넘어가는 동안은 왼발이 그 자리
        const f = toWorld(q, pivotLocal(q.dims, q.roll > 1e-9 ? 1 : -1));
        const ref = q.roll > 1e-9 ? rightFoot : (down ??= f);
        expect(Math.hypot(f.x - ref.x, f.y - ref.y, f.z - ref.z)).toBeLessThan(1e-6);
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

describe('발이 미끄러지다 뒤 책에 막힌 기대기(lean.slide)', () => {
  // D가 C에 기대 있다가 C를 빼면 키 50인 S 모서리에 닿는다. 그 각(약 63°)은 바닥 마찰로 버티지 못해 발이 왼쪽으로 미끄러지고,
  // 기운 몸의 아래 모서리가 바로 왼쪽 Z에 닿는 데서 막힌다. 배치 자리(pos)는 그대로, 미끄러진 만큼은 slide
  const D = book('D', 160, 30);
  const C = book('C', 120, 34);
  const S = book('S', 50, 20);
  const Z = book('Z', 130, 25);
  const books: BookMap = { D, C, S, Z };
  it('기운 몸이 뒤 책에 실제로 닿아 있고(37mm 떨어진 채 버티지 않는다), 다시 풀어도 그대로다', () => {
    const l = withLeans(layoutOf(place('Z', 0, 75), place('D', 1, 100, 7), place('C', 2, 160), place('S', 3, 230)), books);
    const after = withLeans(without(l, 'C'), books);
    const d = placementOf(after, 'D')!;
    expect(d.lean?.on).toBe('S');
    expect(d.lean!.slide).toBeGreaterThan(5);
    expect(bookXs(after, books).get('D')).toBeCloseTo(100, 6);
    const fs = computeShelf(after, books, 's').frames;
    const fd = fs.find((f) => f.bookId === 'D')!;
    const fz = fs.find((f) => f.bookId === 'Z')!;
    const g = gap(fromPlaced(fd.box), fromPlaced(fz.box));
    expect(g).toBeLessThan(0.5);
    expect(g).toBeGreaterThan(-0.26);
    expect(withLeans(after, books).placements).toEqual(after.placements);
  });

  it('그 책을 다시 세우는 동안 들린 뒤 모서리가 뒤 책을 파고들지 않는다(발이 앞서 제자리로 가며 일어선다)', () => {
    const l = withLeans(layoutOf(place('Z', 0, 75), place('D', 1, 100, 7), place('C', 2, 160), place('S', 3, 230)), books);
    const leaning = withLeans(without(l, 'C'), books);
    const r = setTilt(leaning, books, 'D', 0);
    expect(r.ok).toBe(true);
    const up = withLeans((r as { layout: ShelfLayout }).layout, books);
    const plan = planTransition(bodiesOf(leaning, books, 's'), bodiesOf(up, books, 's'), PLANK_BOUNDS, { budgetMs: 60_000 });
    const tz = plan.tracks.find((t) => t.id === 'Z')!;
    const td = plan.tracks.find((t) => t.id === 'D')!;
    for (let k = 0; k <= 60; k++) expect(gap(bookAt(td, k / 60), bookAt(tz, k / 60))).toBeGreaterThan(-0.3);
  });
});

describe('기댄 책이 미는 힘에 넘어가는 받침', () => {
  // 키 큰 L이 가는 S에 기대면 S는 미는 힘에 오른쪽으로 넘어가다 2DU 옆 N에 닿는다. 그 각(약 0.8°)은 S 혼자서는 다시 서는 각이지만
  // 미는 힘이 붙잡고 있어 N에 기대 선다(예전에는 다시 세워, 넘어가야 할 받침이 똑바로 선 채 L을 받쳤다)
  const L = book('L', 190, 30);
  const S = book('S', 150, 16);
  const N = book('N', 150, 40);
  const books: BookMap = { L, S, N };
  it('받침이 이웃에 작게 기대 미는 힘을 넘긴다', () => {
    const l = withLeans(layoutOf(place('L', 0, 20, 7), place('S', 1, 90), place('N', 2, 108)), books);
    const fs = computeShelf(l, books, 's').frames;
    const fl = fs.find((f) => f.bookId === 'L')!;
    const sf = fs.find((f) => f.bookId === 'S')!;
    expect(fl.leanOn).toBe('S');
    expect(sf.leanOn).toBe('N');
    expect(sf.box.angle).toBeGreaterThan(0.3);
    expect(sf.box.angle).toBeLessThan(2);
    expect(l.drawer).toEqual([]);
    expect(withLeans(l, books).placements).toEqual(l.placements);
  });
});
