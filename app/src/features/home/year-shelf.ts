// 지난 연도 책장을 그릴 장면 입력(2026-11-07 사용자 '왼쪽으로 넘기면 전년도 책장, 양손으로 줄이면 옆에 보이게').
// 그해 서재(domain/bookcase bookcaseLibrary)로 책 모양을 만들고, 남긴 배치를 지금 책장과 같은 복원 규칙으로 맞춘다.
// 책장 그림의 UI 상태(올라간 캔버스·경로·구운 그림)는 책 id·선반 id로 전역에 모인다(ui/shelf/scene presentSV, planner, 그림 보관 키).
// 지난 책장도 같은 책·같은 선반 id를 쓰므로 그대로 그리면 지금 책장과 섞인다: 해마다 앞머리를 붙인 id로 그린다.
import { bookcaseLibrary, type Bookcase } from '@/domain/bookcase';
import { toShelfBook, type Library } from '@/domain/library';
import type { BookMap } from '@/domain/layout-schema';
import type { ShelfLayout } from '@/domain/types';
import { restore } from '@/store/placement-store';

export const yearPrefix = (year: number) => `y${year}~`;
export const realId = (prefix: string, id: string) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);

export function prefixLayout(layout: ShelfLayout, prefix: string): ShelfLayout {
  const p = (id: string) => prefix + id;
  return {
    ...layout,
    shelves: layout.shelves.map((s) => ({ ...s, id: p(s.id) })),
    placements: layout.placements.map((q) => ({
      ...q,
      bookId: p(q.bookId),
      shelfId: p(q.shelfId),
      ...(q.stackId ? { stackId: p(q.stackId) } : {}),
      // 옆 벽에 기댄 표시(#wall-l·#wall-r)는 책이 아니라 그대로
      ...(q.lean ? { lean: { ...q.lean, on: q.lean.on.startsWith('#') ? q.lean.on : p(q.lean.on) } } : {}),
    })),
    drawer: layout.drawer.map(p),
  };
}

export type YearScene = {
  year: number;
  prefix: string;
  lib: Library; // 그해 서재(실제 id)
  books: BookMap; // 앞머리 id
  layout: ShelfLayout; // 앞머리 id
  count: number; // 선반·서랍의 책 수
  finished: number; // 그해 다 읽은 책 수
};

export function yearScene(full: Library, c: Bookcase): YearScene {
  const lib = bookcaseLibrary(full, c);
  const raw: BookMap = {};
  for (const id of Object.keys(lib.books)) {
    const b = toShelfBook(lib, id);
    if (b) raw[id] = b;
  }
  const { layout } = restore(c.layout, raw);
  const prefix = yearPrefix(c.year);
  const books: BookMap = {};
  for (const [id, b] of Object.entries(raw)) books[prefix + id] = { ...b, id: prefix + id, seedId: id };
  const finished = Object.values(raw).filter((b) => b.finishedAt?.startsWith(String(c.year))).length;
  return { year: c.year, prefix, lib, books, layout: prefixLayout(layout, prefix), count: Object.keys(raw).length, finished };
}
