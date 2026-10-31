// 전체 책 목록: 등록한 모든 책(책장에 놓인 책 + 책장에 없는 책)을 검색·읽기 상태·책장에 없는 책으로 거르고 정렬한다.
// 책 정보는 서재(library) 한 곳에만 있고, 책장 배치는 같은 책 ID로 따로 본다(두 곳에 따로 저장하지 않는다).
import { placementOf } from '@/domain/layout-engine';
import type { Library, ReadStatus } from '@/domain/library';
import type { Book, ShelfLayout } from '@/domain/types';

export type AllBooksSort = 'recent' | 'title';
export type AllBooksFilter = { q: string; status: ReadStatus | 'all'; offShelfOnly: boolean; sort: AllBooksSort };
export type AllBooksRow = { book: Book; onShelf: boolean };

export function listAllBooks(lib: Library, books: Record<string, Book>, layout: ShelfLayout, f: AllBooksFilter): AllBooksRow[] {
  const t = f.q.trim().toLocaleLowerCase('ko');
  const rows: AllBooksRow[] = [];
  for (const id of Object.keys(lib.books)) {
    const book = books[id];
    if (!book) continue;
    const onShelf = !!placementOf(layout, id);
    if (f.offShelfOnly && onShelf) continue;
    if (f.status !== 'all' && lib.books[id].status !== f.status) continue;
    if (t && !`${book.title} ${book.author ?? ''}`.toLocaleLowerCase('ko').includes(t)) continue;
    rows.push({ book, onShelf });
  }
  if (f.sort === 'title') rows.sort((a, b) => a.book.title.localeCompare(b.book.title, 'ko'));
  else rows.sort((a, b) => (lib.books[b.book.id].createdAt ?? '').localeCompare(lib.books[a.book.id].createdAt ?? '') || a.book.title.localeCompare(b.book.title, 'ko'));
  return rows;
}
