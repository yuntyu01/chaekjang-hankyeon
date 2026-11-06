import { bookcaseFromWire, bookcaseLibrary, bookcaseToWire, lastActiveYear, snapshotBookcase, yearToArchive } from '../bookcase';
import { emptyLibrary, type Binding, type Bookmark, type Library, type MyBook, type Round, type Session } from '../library';
import type { ShelfLayout } from '../types';

// 기기 현지 시각으로 센다: 시험도 현지 시각으로 만든다
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

const book = (id: string, extra: Partial<MyBook> = {}): MyBook => ({ id, editionId: `ed-${id}`, status: 'read', bindingId: `bd-${id}`, createdAt: local(2026, 3, 1), updatedAt: local(2026, 3, 1), ...extra });
const binding = (id: string, bookId: string, color: string, at = local(2026, 3, 1)): Binding => ({ id, myBookId: bookId, spineColor: color, motif: 'none', source: 'default', status: 'ready', seed: 0, createdAt: at, updatedAt: at });

function library(): Library {
  const lib = emptyLibrary();
  for (const id of ['a', 'b', 'c']) {
    lib.books[id] = book(id);
    lib.editions[`ed-${id}`] = { id: `ed-${id}`, title: id, authors: [], source: 'manual', createdAt: local(2026, 3, 1), updatedAt: local(2026, 3, 1) };
    lib.bindings[`bd-${id}`] = binding(`bd-${id}`, id, '#111111');
  }
  lib.books.a = book('a', { rating: 5, note: '한 줄 감상', ribbonColor: '#7B4497', currentPage: 120, updatedAt: local(2026, 12, 30) });
  return lib;
}

const layout: ShelfLayout = {
  version: 2,
  shelves: [{ id: 's1', order: 0 }, { id: 's2', order: 1 }],
  placements: [
    { bookId: 'a', shelfId: 's1', order: 0, pose: 'spine', tilt: 7, lean: { angle: 4, on: '#wall-l' }, x: 0.1 },
    { bookId: 'sample', shelfId: 's1', order: 1, pose: 'front', tilt: 0 }, // 서재에 없는 표시 전용 책
    { bookId: 'b', shelfId: 'gone', order: 0, pose: 'spine', tilt: 0 }, // 없는 선반
    { bookId: 'a', shelfId: 's2', order: 0, pose: 'spine', tilt: 0 }, // 두 번
  ],
  drawer: ['c', 'b', 'sample'],
};

describe('언제 남기나', () => {
  it('마지막으로 손댄 해가 올해보다 앞이고 그해 책장이 없으면 그해', () => {
    const lib = library();
    expect(lastActiveYear(lib, local(2026, 12, 31, 23), new Date(2027, 0, 1, 0, 1))).toBe(2026);
    expect(yearToArchive(lib, local(2026, 12, 31, 23), [], new Date(2027, 0, 1, 0, 1))).toBe(2026);
    // 1월 중순에 처음 켜도, 몇 해를 건너뛰어도 마지막으로 쓴 해
    expect(yearToArchive(lib, null, [], new Date(2027, 0, 15))).toBe(2026);
    expect(yearToArchive(lib, null, [], new Date(2028, 5, 1))).toBe(2026);
  });

  it('이미 있거나, 올해 손댔거나, 책이 없으면 남기지 않는다', () => {
    const lib = library();
    expect(yearToArchive(lib, null, [2026], new Date(2027, 0, 2))).toBeNull();
    expect(yearToArchive(lib, local(2027, 1, 1, 1), [], new Date(2027, 0, 2))).toBeNull();
    expect(yearToArchive(lib, null, [], new Date(2026, 11, 31, 23))).toBeNull(); // 아직 그해
    expect(yearToArchive(emptyLibrary(), local(2026, 6, 1), [], new Date(2027, 0, 2))).toBeNull();
    const onlyHidden = library();
    for (const id of Object.keys(onlyHidden.books)) onlyHidden.books[id] = { ...onlyHidden.books[id], hiddenAt: local(2026, 5, 1) };
    expect(yearToArchive(onlyHidden, null, [], new Date(2027, 0, 2))).toBeNull();
  });

  it('미래 시각(틀린 기기 시계로 남은 기록)은 마지막 시각으로 세지 않는다', () => {
    const lib = library();
    lib.sessions.s = { id: 's', startedAt: local(2030, 1, 1), endedAt: local(2030, 1, 1), durationMs: 1, createdAt: local(2030, 1, 1), updatedAt: local(2030, 1, 1) };
    expect(yearToArchive(lib, null, [], new Date(2027, 0, 2))).toBe(2026);
  });
});

describe('무엇을 남기나', () => {
  it('책마다 덮어쓰는 값과 그때 장정(복사본), 배치 구조를 남긴다', () => {
    const lib = library();
    lib.books.c = { ...lib.books.c, hiddenAt: local(2026, 8, 1) }; // 이미 숨긴 책은 넣지 않는다
    const { bookcase, bindings } = snapshotBookcase(lib, layout, 2026, local(2027, 1, 1, 0));
    expect(bookcase.id).toBe('bc-2026');
    expect(bookcase.books).toEqual([
      { bookId: 'a', bindingId: 'bc-2026-a', status: 'read', rating: 5, note: '한 줄 감상', ribbonColor: '#7B4497', currentPage: 120 },
      { bookId: 'b', bindingId: 'bc-2026-b', status: 'read' },
    ]);
    // 복사본: 새 id, 같은 책, 같은 모습, 원래 시각(두 기기가 남겨도 더 새로 고친 쪽이 이긴다)
    expect(bindings).toEqual([{ ...lib.bindings['bd-a'], id: 'bc-2026-a' }, { ...lib.bindings['bd-b'], id: 'bc-2026-b' }]);
    // 서재에 없는 책·없는 선반·두 번 나온 자리·계산값 x는 빼고, 선반은 그대로
    expect(bookcase.layout).toEqual({
      version: 2,
      shelves: [{ id: 's1', order: 0 }, { id: 's2', order: 1 }],
      placements: [{ bookId: 'a', shelfId: 's1', order: 0, pose: 'spine', tilt: 7, lean: { angle: 4, on: '#wall-l' } }],
      drawer: ['b'],
    });
  });

  it('남기지 않을 책(손대지 않은 예시 책)은 뺀다', () => {
    const { bookcase } = snapshotBookcase(library(), layout, 2026, local(2027, 1, 1, 0), new Set(['b']));
    expect(bookcase.books.map((b) => b.bookId)).toEqual(['a', 'c']);
    expect(bookcase.layout.drawer).toEqual(['c']);
  });
});

describe('연도 책장으로 볼 서재', () => {
  it('나중에 바꾼 한 줄 감상·장정은 그때 값으로, 갈피·기록은 그해 것만', () => {
    const lib = library();
    const { bookcase, bindings } = snapshotBookcase(lib, layout, 2026, local(2027, 1, 1, 0));
    for (const b of bindings) lib.bindings[b.id] = b;
    // 2027년: 감상을 고치고 장정을 바꾸고 지운(숨긴) 책
    lib.books.a = { ...lib.books.a, note: '다시 읽고 바꾼 감상', rating: 3, status: 'reading', updatedAt: local(2027, 2, 1) };
    lib.bindings['bd-a'] = { ...lib.bindings['bd-a'], spineColor: '#FF0000', updatedAt: local(2027, 2, 1) };
    lib.books.b = { ...lib.books.b, hiddenAt: local(2027, 2, 2) };
    const mark = (id: string, at: string): Bookmark => ({ id, myBookId: 'a', text: id, createdAt: at, updatedAt: at });
    lib.bookmarks.m1 = mark('m1', local(2026, 12, 31, 23));
    lib.bookmarks.m2 = mark('m2', local(2027, 1, 1, 0));
    const session = (id: string, at: string): Session => ({ id, myBookId: 'a', startedAt: at, endedAt: at, durationMs: 60_000, memo: id, createdAt: at, updatedAt: at });
    lib.sessions.s1 = session('s1', local(2026, 6, 1));
    lib.sessions.s2 = session('s2', local(2027, 3, 1));
    const round = (id: string, created: string, finishedAt?: string): Round => ({ id, myBookId: 'a', index: 1, startedAt: created.slice(0, 10), finishedAt, createdAt: created, updatedAt: created });
    lib.rounds.r1 = round('r1', local(2026, 5, 1), '2027-01-03');
    lib.rounds.r2 = round('r2', local(2027, 1, 5));

    const view = bookcaseLibrary(lib, bookcase);
    expect(view.books.a).toMatchObject({ note: '한 줄 감상', rating: 5, status: 'read', bindingId: 'bc-2026-a' });
    expect(view.bindings[view.books.a.bindingId!].spineColor).toBe('#111111');
    expect(view.books.b).toBeDefined();
    expect(view.books.b.hiddenAt).toBeUndefined();
    expect(Object.keys(view.bookmarks)).toEqual(['m1']);
    expect(Object.keys(view.sessions)).toEqual(['s1']);
    expect(Object.keys(view.rounds)).toEqual(['r1']);
    expect(view.rounds.r1.finishedAt).toBeUndefined(); // 그해에는 아직 읽는 중이었다
  });
});

it('전송 형식으로 오가도 같다', () => {
  const { bookcase } = snapshotBookcase(library(), layout, 2026, local(2027, 1, 1, 0));
  const wire = JSON.parse(JSON.stringify(bookcaseToWire(bookcase)));
  expect(bookcaseFromWire(wire)).toEqual(bookcase);
  expect(bookcaseFromWire({ ...wire, books: [{ bookId: 'x', status: 'lost' }, ...wire.books] })!.books).toEqual(bookcase.books);
  expect(bookcaseFromWire({ ...wire, id: '' })).toBeNull();
});
