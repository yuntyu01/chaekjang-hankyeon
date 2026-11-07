import { snapshotBookcase } from '@/domain/bookcase';
import { emptyLibrary, type Library, type MyBook } from '@/domain/library';
import type { ShelfLayout } from '@/domain/types';

import { prefixLayout, realId, yearPrefix, yearScene } from '../year-shelf';

const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const book = (id: string, extra: Partial<MyBook> = {}): MyBook => ({ id, editionId: `ed-${id}`, status: 'reading', createdAt: local(2026, 3, 1), updatedAt: local(2026, 3, 1), ...extra });

function library(): Library {
  const lib = emptyLibrary();
  for (const id of ['a', 'b', 'c']) {
    lib.books[id] = book(id);
    lib.editions[`ed-${id}`] = { id: `ed-${id}`, title: `책 ${id}`, authors: ['지은이'], source: 'manual', createdAt: local(2026, 3, 1), updatedAt: local(2026, 3, 1) };
  }
  return lib;
}

const layout: ShelfLayout = {
  version: 2,
  shelves: [{ id: 's1', order: 0 }, { id: 's2', order: 1 }],
  placements: [
    { bookId: 'a', shelfId: 's1', order: 0, pose: 'spine', tilt: 0 },
    { bookId: 'b', shelfId: 's1', order: 1, pose: 'spine', tilt: 0 },
  ],
  drawer: ['c'],
};

describe('지난 연도 책장 장면', () => {
  it('책·선반·쌓기·기댄 상대 id에 해 앞머리를 붙여 지금 책장의 그림 상태와 섞이지 않는다', () => {
    const l: ShelfLayout = {
      version: 2,
      shelves: [{ id: 's1', order: 0 }],
      placements: [
        { bookId: 'a', shelfId: 's1', order: 0, pose: 'horizontal', tilt: 0, stackId: 'st', stackOrder: 0 },
        { bookId: 'b', shelfId: 's1', order: 1, pose: 'spine', tilt: -7, lean: { angle: -7, on: 'a' } },
        { bookId: 'c', shelfId: 's1', order: 2, pose: 'spine', tilt: 7, lean: { angle: 7, on: '#wall-r' } },
      ],
      drawer: ['d'],
    };
    const out = prefixLayout(l, 'y2026~');
    expect(out.shelves[0].id).toBe('y2026~s1');
    expect(out.placements.map((p) => [p.bookId, p.shelfId])).toEqual([['y2026~a', 'y2026~s1'], ['y2026~b', 'y2026~s1'], ['y2026~c', 'y2026~s1']]);
    expect(out.placements[0].stackId).toBe('y2026~st');
    expect(out.placements[1].lean?.on).toBe('y2026~a');
    expect(out.placements[2].lean?.on).toBe('#wall-r');
    expect(out.drawer).toEqual(['y2026~d']);
    expect(realId('y2026~', 'y2026~a')).toBe('a');
  });

  it('그해 상태로 책 모양을 만들고, 지금 서재에서 숨긴 책도 그린다. 그해 완독만 센다', () => {
    const lib = library();
    lib.rounds.r1 = { id: 'r1', myBookId: 'a', index: 1, startedAt: '2026-04-01', finishedAt: '2026-05-01', createdAt: local(2026, 4, 1), updatedAt: local(2026, 5, 1) };
    lib.books.a = { ...lib.books.a, status: 'read' };
    const { bookcase } = snapshotBookcase(lib, layout, 2026, local(2027, 1, 1, 0));
    // 2027년에 b를 숨기고 c를 다 읽었다
    const now = library();
    now.rounds = { ...lib.rounds, r2: { id: 'r2', myBookId: 'c', index: 1, startedAt: '2027-01-02', finishedAt: '2027-02-01', createdAt: local(2027, 1, 2), updatedAt: local(2027, 2, 1) } };
    now.books.b = { ...now.books.b, hiddenAt: local(2027, 1, 5) };
    const scene = yearScene(now, bookcase);
    const p = yearPrefix(2026);
    expect(scene.prefix).toBe(p);
    expect(Object.keys(scene.books).sort()).toEqual([`${p}a`, `${p}b`, `${p}c`]);
    expect(scene.books[`${p}a`].id).toBe(`${p}a`);
    expect(scene.books[`${p}a`].seedId).toBe('a'); // 갈피 탭 무늬는 지금 책장과 같게
    expect(scene.books[`${p}a`].title).toBe('책 a');
    expect(scene.layout.placements.map((q) => q.bookId)).toEqual([`${p}a`, `${p}b`]);
    expect(scene.layout.drawer).toEqual([`${p}c`]);
    expect(scene.lib.books.b.hiddenAt).toBeUndefined();
    expect(scene.count).toBe(3);
    expect(scene.finished).toBe(1);
  });
});
