import { frontExtent } from '../front-pose';
import { emptyLibrary } from '../library';
import { frontDims, SHELF_DEPTH, SHELF_FRONT, SHELF_USABLE_WIDTH } from '../geometry';
import { SAMPLE_LAYOUT } from '../onboarding-sample';
import { realBoardSeed, realReadingLibrary, REAL_BEFORE, REAL_BOOKS, REAL_FRONT_BEFORE, REAL_FRONT_BOOKS, REAL_FRONT_LAYOUT, REAL_LAYOUT, REAL_SIDE_BOOKS, REAL_SIDE_LAYOUT } from '../real-sample';
import { computeShelf, resolveLeans } from '../shelf-scene';
import { leanHolds } from '../statics';
import type { Book, ShelfLayout } from '../types';
import { demoKindOf } from '@/store/placement-store';

const SHELVES: [string, Book[], ShelfLayout][] = [
  ['real', REAL_BOOKS, REAL_LAYOUT],
  ['real-front', REAL_FRONT_BOOKS, REAL_FRONT_LAYOUT],
  ['real-side', REAL_SIDE_BOOKS, REAL_SIDE_LAYOUT],
  ['real-before', ...REAL_BEFORE],
  ['real-front-before', ...REAL_FRONT_BEFORE],
];
const mapOf = (list: Book[]) => Object.fromEntries(list.map((b) => [b.id, b]));

describe('실물 비교 책장(측정 전용)', () => {
  it('예시 책장과 같은 줄·순서에 실제 표지 책을 꽂고, 표지 책만 자세가 다르다', () => {
    expect(REAL_LAYOUT.placements.map(({ depth, pitch, spin, ...p }) => p)).toEqual(SAMPLE_LAYOUT.placements);
    expect(REAL_BEFORE[1].placements).toEqual(SAMPLE_LAYOUT.placements);
  });
  it.each(SHELVES)('%s: 실제 표지, 책이 빠지거나 떨어지지 않고 선반 안에 놓인다', (_, list, layout) => {
    const books = mapOf(list);
    for (const b of list) expect(b.coverArtUri).toMatch(/^https:\/\/image\.yes24\.com\/goods\/\d+\/L\??$/);
    expect(layout.placements.map((p) => p.bookId).sort()).toEqual(list.map((b) => b.id).sort());
    const r = resolveLeans(layout, books);
    expect(r.layout.drawer).toEqual([]);
    for (const sh of layout.shelves) {
      const row = computeShelf(r.layout, books, sh.id);
      for (const f of row.frames) expect(f.fell ?? false).toBeFalsy();
      for (const it of row.items) expect(it.x + it.width).toBeLessThanOrEqual(SHELF_USABLE_WIDTH + 0.01);
    }
  });
  it('벽에 기댄 표지: 넘어지지 않는 각이고 머리가 벽에 닿으며 선반 위에 있다', () => {
    const books = mapOf(REAL_FRONT_BOOKS);
    for (const p of REAL_FRONT_LAYOUT.placements) {
      const d = frontDims(books[p.bookId]);
      expect(leanHolds(d.T, d.H, p.pitch!)).toBe(true);
      const e = frontExtent(d, p.pitch, p.spin);
      expect(p.depth! + e.z1).toBeCloseTo(SHELF_DEPTH);
      expect(p.depth! + e.z0).toBeGreaterThanOrEqual(-SHELF_FRONT);
    }
  });
  it('돌려 세운 책은 벽을 뚫지 않는다', () => {
    const books = mapOf(REAL_SIDE_BOOKS);
    for (const p of REAL_SIDE_LAYOUT.placements.filter((q) => q.pose === 'front')) {
      const e = frontExtent(frontDims(books[p.bookId]), 0, p.spin);
      expect(p.depth! + e.z1).toBeLessThanOrEqual(SHELF_DEPTH);
      expect(p.depth! + e.z0).toBeGreaterThanOrEqual(-SHELF_FRONT);
    }
  });
  it('달력 사진용 서재: 그달 안의 기록이고 같은 입력이면 같다', () => {
    const lib = realReadingLibrary(2026, 10);
    const list = Object.values(lib.sessions);
    expect(list.length).toBeGreaterThan(20);
    for (const v of list) {
      expect(lib.books[v.myBookId!]).toBeDefined();
      expect(new Date(v.startedAt).getMonth()).toBe(9);
    }
    expect(realReadingLibrary(2026, 10).sessions).toEqual(lib.sessions);
  });
  it('보드 사진용: 책이 없으면 넣고, 갈피는 한 번만 넣는다', () => {
    let lib = emptyLibrary();
    const store = {
      get: () => ({ lib }),
      addBook: () => {
        lib = { ...lib, books: { ...lib.books, b1: { id: 'b1', editionId: 'e', status: 'reading', createdAt: '', updatedAt: '' } } };
        return 'b1';
      },
      addBookmark: (m: { myBookId: string; text: string }) => {
        const id = `m${Object.keys(lib.bookmarks).length}`;
        lib = { ...lib, bookmarks: { ...lib.bookmarks, [id]: { id, ...m, createdAt: '', updatedAt: '' } } };
        return id;
      },
    };
    expect(realBoardSeed(store, 'demo')).toBe('b1');
    const n = Object.keys(lib.bookmarks).length;
    expect(n).toBeGreaterThan(5);
    expect(realBoardSeed(store, 'b1')).toBe('b1');
    expect(Object.keys(lib.bookmarks)).toHaveLength(n);
  });
  it('demoboot 값은 아는 이름만 켠다', () => {
    expect(demoKindOf('1')).toBe('sample');
    expect(demoKindOf('real')).toBe('real');
    expect(demoKindOf('real-side')).toBe('real-side');
    expect(demoKindOf('0')).toBeNull();
    expect(demoKindOf(null)).toBeNull();
  });
});
