// 전체 책: 서재의 모든 책(책장에 놓인 책 포함)을 검색·읽기 상태·책장에 없는 책으로 거르고 정렬한다
import { emptyLibrary, type Library, type MyBook, type ReadStatus } from '@/domain/library';
import { SAMPLE_BOOKS } from '@/domain/test-fixtures/interaction-books';
import type { ShelfLayout } from '@/domain/types';

import { deleteNote, deleteSummary, listAllBooks, memosByBook } from '../all-books';

const [a, b, c] = SAMPLE_BOOKS;
const books = { [a.id]: a, [b.id]: b, [c.id]: c };
const my = (id: string, status: ReadStatus, createdAt: string) => ({ id, editionId: 'e', status, bindingId: 'bd', createdAt, updatedAt: createdAt }) as MyBook;
const lib: Library = { ...emptyLibrary(), books: { [a.id]: my(a.id, 'reading', '2026-10-01'), [b.id]: my(b.id, 'want', '2026-10-03'), [c.id]: my(c.id, 'read', '2026-10-02') } };
// a만 책장에, b·c는 책장에 없는 책
const layout: ShelfLayout = { version: 2, shelves: [{ id: 'shelf-1', order: 0 }], placements: [{ bookId: a.id, shelfId: 'shelf-1', order: 0, pose: 'spine' } as ShelfLayout['placements'][number]], drawer: [b.id, c.id] };
const all = { q: '', status: 'all' as const, offShelfOnly: false, sort: 'recent' as const };

it('책장에 놓인 책도 포함해 모두 보이고, 놓였는지 표시한다(최근 추가순)', () => {
  const rows = listAllBooks(lib, books, layout, all);
  expect(rows.map((r) => r.book.id)).toEqual([b.id, c.id, a.id]);
  expect(rows.find((r) => r.book.id === a.id)?.onShelf).toBe(true);
  expect(rows.find((r) => r.book.id === b.id)?.onShelf).toBe(false);
});

it('책장에 없는 책만, 읽기 상태로, 제목·저자 검색으로 거른다', () => {
  expect(listAllBooks(lib, books, layout, { ...all, offShelfOnly: true }).map((r) => r.book.id).sort()).toEqual([b.id, c.id].sort());
  expect(listAllBooks(lib, books, layout, { ...all, status: 'read' }).map((r) => r.book.id)).toEqual([c.id]);
  expect(listAllBooks(lib, books, layout, { ...all, q: a.title.slice(0, 2) }).map((r) => r.book.id)).toContain(a.id);
  expect(listAllBooks(lib, books, layout, { ...all, q: '없는 제목 zzz' })).toEqual([]);
});

it('제목순 정렬', () => {
  const rows = listAllBooks(lib, books, layout, { ...all, sort: 'title' });
  const titles = rows.map((r) => r.book.title);
  expect(titles).toEqual([...titles].sort((x, y) => x.localeCompare(y, 'ko')));
});

it('완독한 해로 거른다', () => {
  const done: Library = { ...lib, rounds: { r1: { id: 'r1', myBookId: a.id, index: 1, finishedAt: '2025-03-01', createdAt: '2025-03-01', updatedAt: '2025-03-01' } } };
  const filter = { q: '', status: 'all' as const, offShelfOnly: false, sort: 'recent' as const };
  expect(listAllBooks(done, books, layout, { ...filter, year: 2025 }).map((r) => r.book.id)).toEqual([a.id]);
  expect(listAllBooks(done, books, layout, { ...filter, year: 2024 })).toEqual([]);
  expect(listAllBooks(done, books, layout, { ...filter, year: null })).toHaveLength(3);
});

describe('책마다 남긴 메모', () => {
  const memoLib = {
    sessions: {
      s1: { id: 's1', myBookId: 'x', startedAt: '2026-11-01T01:00:00', endedAt: '2026-11-01T02:00:00', memo: '  첫 메모 ' },
      s2: { id: 's2', myBookId: 'x', startedAt: '2026-11-03T01:00:00', endedAt: '2026-11-03T02:00:00', memo: '   ' },
      s3: { id: 's3', startedAt: '2026-11-03T01:00:00', endedAt: '2026-11-03T02:00:00', memo: '책 없는 메모' },
    },
    bookmarks: {
      m1: { id: 'm1', myBookId: 'x', createdAt: '2026-11-02T00:00:00Z', memo: '갈피 메모' },
      m2: { id: 'm2', myBookId: 'y', createdAt: '2026-11-02T00:00:00Z' },
    },
  } as unknown as Parameters<typeof memosByBook>[0];
  it('최근 순으로 모으고 빈 메모와 책 없는 메모는 뺀다', () => {
    const map = memosByBook(memoLib);
    expect(map.get('x')?.map((m) => [m.text, m.kind])).toEqual([['갈피 메모', 'bookmark'], ['첫 메모', 'reading']]);
    expect(map.has('y')).toBe(false);
    expect(map.size).toBe(1);
  });
});

it('삭제하면 지워지는 것과 남는 것을 고른 책만 센다', () => {
  const base = { createdAt: '2026-11-01', updatedAt: '2026-11-01' };
  const l: Library = {
    ...lib,
    rounds: { r1: { id: 'r1', myBookId: a.id, index: 1, ...base }, r2: { id: 'r2', myBookId: b.id, index: 1, ...base } },
    bookmarks: { m1: { id: 'm1', myBookId: a.id, text: 'x', ...base }, m2: { id: 'm2', myBookId: c.id, text: 'y', ...base } },
    sessions: { s1: { id: 's1', myBookId: a.id, startedAt: '2026-11-01', endedAt: '2026-11-01', durationMs: 1, ...base }, s2: { id: 's2', startedAt: '2026-11-01', endedAt: '2026-11-01', durationMs: 1, ...base } },
  };
  expect(deleteSummary(l, [a.id, b.id])).toEqual({ rounds: 2, marks: 1, sessions: 1 });
  expect(deleteSummary(l, [])).toEqual({ rounds: 0, marks: 0, sessions: 0 });
});

test('삭제 문구: 0개는 빼고 한 줄에 한 문장', () => {
  expect(deleteNote({ rounds: 1, marks: 3, sessions: 2 })).toBe('갈피 3개와 읽은 기록 1회도 지워져요.\n독서 시간은 통계에 남아요.\n되돌릴 수 없어요.');
  expect(deleteNote({ rounds: 2, marks: 0, sessions: 0 })).toBe('읽은 기록 2회도 지워져요.\n되돌릴 수 없어요.');
  expect(deleteNote({ rounds: 0, marks: 0, sessions: 1 })).toBe('독서 시간은 통계에 남아요.\n되돌릴 수 없어요.');
  expect(deleteNote({ rounds: 0, marks: 0, sessions: 0 })).toBe('되돌릴 수 없어요.');
});
