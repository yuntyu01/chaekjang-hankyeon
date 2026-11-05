// 전체 책 목록: 등록한 모든 책(책장에 놓인 책 + 책장에 없는 책)을 검색·읽기 상태·책장에 없는 책으로 거르고 정렬한다.
// 책 정보는 서재(library) 한 곳에만 있고, 책장 배치는 같은 책 ID로 따로 본다(두 곳에 따로 저장하지 않는다).
import { placementOf } from '@/domain/layout-engine';
import { bookmarksOf, finishedYear, roundsOf, sessionDay, type Library, type ReadStatus } from '@/domain/library';
import type { Book, ShelfLayout } from '@/domain/types';

export type AllBooksSort = 'recent' | 'title';
export type AllBooksFilter = { q: string; status: ReadStatus | 'all'; offShelfOnly: boolean; sort: AllBooksSort; year?: number | null };
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
    if (f.year && finishedYear(lib, id) !== f.year) continue;
    if (t && !`${book.title} ${book.author ?? ''}`.toLocaleLowerCase('ko').includes(t)) continue;
    rows.push({ book, onShelf });
  }
  if (f.sort === 'title') rows.sort((a, b) => a.book.title.localeCompare(b.book.title, 'ko'));
  else rows.sort((a, b) => (lib.books[b.book.id].createdAt ?? '').localeCompare(lib.books[a.book.id].createdAt ?? '') || a.book.title.localeCompare(b.book.title, 'ko'));
  return rows;
}

// 책마다 남긴 메모(독서 기록·갈피의 메모, 최근 순): 전체 책 목록의 메모 상자
export type BookMemo = { id: string; text: string; at: string; kind: 'reading' | 'bookmark' };
export function memosByBook(lib: Pick<Library, 'sessions' | 'bookmarks'>) {
  const out = new Map<string, BookMemo[]>();
  const add = (bookId: string | undefined, memo: BookMemo) => {
    if (!bookId || !memo.text) return;
    const list = out.get(bookId);
    if (list) list.push(memo);
    else out.set(bookId, [memo]);
  };
  for (const s of Object.values(lib.sessions)) add(s.myBookId, { id: s.id, text: s.memo?.trim() ?? '', at: sessionDay(s), kind: 'reading' });
  for (const m of Object.values(lib.bookmarks)) add(m.myBookId, { id: m.id, text: m.memo?.trim() ?? '', at: m.createdAt, kind: 'bookmark' });
  for (const list of out.values()) list.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

// 책을 지우면 함께 지워지는 것과 남는 것(library-store deleteBook과 같은 기준)
export function deleteSummary(lib: Library, ids: readonly string[]) {
  const set = new Set(ids);
  return {
    rounds: ids.reduce((a, id) => a + roundsOf(lib, id).length, 0),
    marks: ids.reduce((a, id) => a + bookmarksOf(lib, id).length, 0),
    sessions: Object.values(lib.sessions).filter((s) => s.myBookId && set.has(s.myBookId)).length,
  };
}
