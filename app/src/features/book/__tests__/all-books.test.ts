// 전체 책: 서재의 모든 책(책장에 놓인 책 포함)을 검색·읽기 상태·책장에 없는 책으로 거르고 정렬한다
import { emptyLibrary, type Library, type MyBook, type ReadStatus } from '@/domain/library';
import { SAMPLE_BOOKS } from '@/domain/test-fixtures/interaction-books';
import type { ShelfLayout } from '@/domain/types';

import { listAllBooks } from '../all-books';

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
