// 선반 경계(좌우 끝·깊이 0~230mm) 판정, 188mm 책 돌리기, 깊이 300mm·20DU 돌출 시절 저장본 복구.
import { mm, SHELF_DEPTH, SHELF_FRONT, SHELF_USABLE_WIDTH } from '../geometry';
import { checkSpace, fitToShelf, itemBottomCorners, itemPositions, placementOf, setSpin, shelfItems, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import type { Book, BookPlacement, ShelfLayout, Tilt } from '../types';

const book = (id: string, hMm: number, tDu: number, wMm: number): Book => ({
  id, title: id, themeColor: '#CCBBAA', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: wMm / hMm,
  art: { motif: 'leaf' }, dims: { height: mm(hMm), thickness: tDu, coverWidth: mm(wMm) },
});
// 188mm × 128mm 눕힌 책(돌리면 깊이 약 164mm가 필요: 기준선 뒤 160mm보다 크다), 세운 책 두 권
const books: BookMap = { L: book('L', 188, 30, 128), A: book('A', 225, 40, 150), B: book('B', 210, 30, 140), W: book('W', 188, 30, 200) };
const place = (bookId: string, order: number, pos: number, extra: Partial<BookPlacement> = {}): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt: 0 as Tilt, pos, ...extra });
const layoutOf = (...placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] });

// 모든 책의 실제 바닥 네 모서리가 경계 안, 선반 윗면에 닿음
function expectInside(l: ShelfLayout, bm: BookMap, shelf = 's') {
  expect(checkSpace(l, bm, shelf)).toBeNull();
  for (const p of itemPositions(shelfItems(l, shelf), l, bm)) {
    for (const c of itemBottomCorners(p.item, l, bm, p.x)) {
      expect(c.x).toBeGreaterThanOrEqual(-0.01);
      expect(c.x).toBeLessThanOrEqual(SHELF_USABLE_WIDTH + 0.01);
      expect(c.z).toBeGreaterThanOrEqual(-SHELF_FRONT - 0.01);
      expect(c.z).toBeLessThanOrEqual(SHELF_DEPTH + 0.01);
    }
  }
}
const spinOf = (l: ShelfLayout, id: string) => placementOf(l, id)!.spin ?? 0;

it('미세 여백을 추가해도 이미 선반을 채운 책 네 권은 서랍으로 이동하지 않는다', () => {
  const bm = Object.fromEntries(['A', 'B', 'C', 'D'].map((id) => [id, book(id, 188, SHELF_USABLE_WIDTH / 4, 128)]));
  const l = layoutOf(...Object.keys(bm).map((id, i) => place(id, i, i * SHELF_USABLE_WIDTH / 4)));
  const result = fitToShelf(l, bm);
  expect(result.moved).toEqual([]);
  expect(result.layout.drawer).toEqual([]);
  expect(result.layout.placements.map((p) => p.bookId)).toEqual(['A', 'B', 'C', 'D']);
  expectInside(result.layout, bm);
});

describe('188mm 눕힌 책 돌리기', () => {
  it('공간이 있으면 원하는 각도 그대로, 깊이만 필요한 만큼 앞으로', () => {
    const l = layoutOf(place('L', 0, 100, { pose: 'horizontal' }));
    for (const d of [-12, 12]) {
      const r = setSpin(l, books, 'L', d);
      if (!r.ok) throw new Error(r.reason);
      expect(spinOf(r.layout, 'L')).toBe(d);
      expect(placementOf(r.layout, 'L')!.depth!).toBeLessThan(0); // 기준선 앞으로 나왔다(크기는 그대로)
      expectInside(r.layout, books);
    }
  });

  it('오른쪽 끝에서는 원하는 각도를 지키고 위치만 최소로 왼쪽으로', () => {
    const w0 = mm(188);
    const l = layoutOf(place('L', 0, SHELF_USABLE_WIDTH - w0, { pose: 'horizontal' }));
    const r = setSpin(l, books, 'L', 12);
    if (!r.ok) throw new Error(r.reason);
    expect(spinOf(r.layout, 'L')).toBe(12);
    const x = itemPositions(shelfItems(r.layout, 's'), r.layout, books)[0];
    expect(x.x + x.width).toBeCloseTo(SHELF_USABLE_WIDTH, 1); // 끝에 붙었다(돌출 없음)
    expectInside(r.layout, books);
  });

  it('옆 책들로 꽉 차 있으면 가능한 각도에서 멈춘다(명확히 원한 각도보다 작다)', () => {
    // L(폭 약 143DU) + 두께 30DU 세운 책 7권 = 353DU, 남는 폭 약 13DU. 12°로 돌리면 폭이 약 17DU 늘어난다.
    const bm: BookMap = { L: books.L };
    const ps: BookPlacement[] = [place('L', 0, 0, { pose: 'horizontal' })];
    for (let i = 0; i < 7; i++) {
      bm[`S${i}`] = book(`S${i}`, 200, 30, 130);
      ps.push(place(`S${i}`, i + 1, SHELF_USABLE_WIDTH - (7 - i) * 30));
    }
    const l = layoutOf(...ps);
    expectInside(l, bm);
    const r = setSpin(l, bm, 'L', 12);
    const got = r.ok ? spinOf(r.layout, 'L') : 0;
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThan(12);
    if (r.ok) expectInside(r.layout, bm);
  });

  it('깊이(0~230mm)가 모자라면 그 각도까지만', () => {
    // 표지 폭 200mm: 12°면 188·sin12 + 200·cos12 ≈ 235mm > 230mm
    const l = layoutOf(place('W', 0, 100, { pose: 'horizontal' }));
    const r = setSpin(l, books, 'W', 12);
    const got = r.ok ? spinOf(r.layout, 'W') : 0;
    expect(got).toBeLessThan(12);
    expect(got).toBeGreaterThan(8);
    if (r.ok) expectInside(r.layout, books);
  });
});

describe('깊이 300mm·20DU 돌출 시절 저장본 복구', () => {
  const all: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
  // 예전 기준: 기준선 뒤 230mm(= 지금 벽보다 70mm 더 뒤), 눕힌 책은 좌우 20DU까지 밖으로
  const OLD_WALL = mm(230);

  it('벗어난 책만 최소로 옮기고, 나머지 자리와 책 정보는 그대로', () => {
    const old: ShelfLayout = {
      ...SAMPLE_LAYOUT,
      placements: SAMPLE_LAYOUT.placements.map((p) => {
        if (p.bookId === 'b12') return { ...p, depth: OLD_WALL - 112, pos: -20 }; // 쌓기 더미: 예전 벽 가까이 + 왼쪽 돌출
        return p;
      }),
    };
    const before = JSON.stringify(all);
    const r = fitToShelf(old, all);
    expect(r.moved).toEqual([]);
    expect(r.changed).toBe(true);
    for (const s of r.layout.shelves) expectInside(r.layout, all, s.id);
    // 다른 선반은 그대로
    for (const p of r.layout.placements.filter((q) => q.shelfId !== 'shelf-3')) expect(p).toEqual(old.placements.find((q) => q.bookId === p.bookId));
    // 더미는 벽 안으로 들어왔고, 바닥은 윗면에 닿는다
    const d = placementOf(r.layout, 'b12')!.depth!;
    expect(d).toBeLessThan(OLD_WALL - 112);
    expect(JSON.stringify(all)).toBe(before); // 책 정보(독서 기록) 불변
    const books = r.layout.placements.map((p) => p.bookId).concat(r.layout.drawer).sort();
    expect(books).toEqual(SAMPLE_LAYOUT.placements.map((p) => p.bookId).concat(SAMPLE_LAYOUT.drawer).sort());
  });

  it('이미 맞는 저장본은 바꾸지 않는다', () => {
    const r = fitToShelf(SAMPLE_LAYOUT, all);
    expect(r.changed).toBe(false);
    expect(r.layout).toBe(SAMPLE_LAYOUT);
  });

  it('돌출로만 들어가던 꽉 찬 선반: 회전을 먼저 줄이고, 그래도 안 되면 끝 책만 서랍으로', () => {
    const lb: BookMap = { ...books };
    // 눕힌 책 둘(돌린 채) + 세운 책: 예전 돌출(좌우 20DU) 덕에 들어가던 폭
    const w = mm(188);
    const old: ShelfLayout = layoutOf(
      place('L', 0, -20, { pose: 'horizontal', spin: 10, depth: 40 }),
      place('A', 1, w - 20 + 5),
      place('B', 2, w - 20 + 5 + 40),
      place('W', 3, SHELF_USABLE_WIDTH + 20 - w, { pose: 'horizontal', depth: OLD_WALL - mm(200) }),
    );
    const r = fitToShelf(old, lb);
    expectInside(r.layout, lb);
    const kept = r.layout.placements.map((p) => p.bookId);
    expect([...kept, ...r.layout.drawer].sort()).toEqual(['A', 'B', 'L', 'W']);
    for (const id of r.moved) expect(r.layout.drawer).toContain(id);
    // 회전을 줄여 넣었거나(서랍 0권) 끝 책만 뺐다(1권)
    expect(r.moved.length).toBeLessThanOrEqual(1);
  });
});
