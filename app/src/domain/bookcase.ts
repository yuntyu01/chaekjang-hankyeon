// 연도 책장: 해가 바뀔 때 그해 책장을 한 벌 남긴다(2026-11-06 사용자 계획: 2026 → 2027이 되면 2026 책장을 고정).
// 남기는 것
//  * 책장 구조: 선반 순서, 책 자리·자세(지금 배치 그대로. 선반 폭 대비 위치 x 같은 계산값은 빼고)
//  * 책마다 덮어쓰는 값: 상태·별점·한 줄 감상·갈피 색·읽은 쪽, 그리고 그때 장정. 장정은 그 순간 줄을 복사해 새 id로 서재에 둔다
//    (지금 책의 장정을 바꿔도 연도 책장 모습은 그대로)
// 남기지 않는 것: 판본·회차·독서 기록·갈피. 원래 표에서 그해 날짜로 고른다(bookcaseLibrary). 나중에 고친 내용은 연도 책장에도 보인다.
// 연도 책장에 있는 책을 지우면 줄을 남기고 숨긴다(MyBook.hiddenAt, library-store deleteBook).
// 언제: 서재를 마지막으로 손댄 해가 올해보다 앞이고 그해 책장이 아직 없을 때(yearToArchive). 새해 첫 실행이 1월 중순이어도
// 그 사이 바뀐 것이 없으니 12월 31일의 모습과 같다. 연도는 기기 현지 시각으로 센다.
// 한 사용자에 한 해 한 벌: id는 해로 정한다(bookcaseIdOf). 서버는 처음 올린 것을 남긴다(server V17).
import type { Binding, Library, MyBook, ReadStatus } from './library';
import type { BookPlacement, ShelfLayout } from './types';

export type BookcaseBook = {
  bookId: string;
  bindingId?: string; // 그해 장정(복사본) id
  status: ReadStatus;
  rating?: number;
  note?: string;
  ribbonColor?: string;
  currentPage?: number;
};

export type Bookcase = {
  id: string;
  year: number;
  createdAt: string; // 남긴 순간
  updatedAt: string;
  layout: ShelfLayout;
  books: BookcaseBook[]; // 그때 서재에 있던 책(선반·서랍 모두)
};

export const bookcaseIdOf = (year: number) => `bc-${year}`;
// 그해 장정 복사본 id: 해와 책으로 정한다(두 기기가 같은 해를 남겨도 줄이 늘지 않는다)
export const archivedBindingId = (bookcaseId: string, bookId: string) => `${bookcaseId}-${bookId}`;

// 서재를 마지막으로 손댄 해(기기 현지): 서재 항목과 배치의 마지막 시각 중 가장 늦은 것. 아무것도 없으면 null.
// 미래 시각(기기 시계가 틀렸던 기록)은 세지 않는다. 세면 그 해까지 연도 책장이 안 생긴다
export function lastActiveYear(lib: Library, layoutAt: string | null, now: Date): number | null {
  const nowMs = now.getTime();
  let latest = NaN;
  const see = (iso: string | null | undefined) => {
    const t = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(t) && t <= nowMs && !(t <= latest)) latest = t;
  };
  see(layoutAt);
  for (const table of Object.values(lib) as Record<string, { updatedAt: string }>[]) for (const item of Object.values(table)) see(item.updatedAt);
  return Number.isFinite(latest) ? new Date(latest).getFullYear() : null;
}

// 지금 남겨야 할 해. 마지막으로 손댄 해가 올해보다 앞이고, 그해 책장이 없고, 남길 책이 있을 때만
export function yearToArchive(lib: Library, layoutAt: string | null, existingYears: readonly number[], now: Date): number | null {
  const year = lastActiveYear(lib, layoutAt, now);
  if (year === null || year >= now.getFullYear() || existingYears.includes(year)) return null;
  return Object.values(lib.books).some((b) => !b.hiddenAt) ? year : null;
}

const opt = <T>(v: T | undefined | null): T | undefined => (v === null || v === undefined ? undefined : v);

// 지금 서재·배치로 그해 책장을 만든다. skip: 남기지 않을 책(손대지 않은 예시 책 등). 숨긴 책은 넣지 않는다.
// 배치에서 서재에 없는 책(표시 전용 예시)과 없는 선반의 자리는 뺀다. 장정 복사본의 시각은 원래 장정 시각 그대로(두 기기가 같은 해를 남기면 더 새로 고친 쪽이 이긴다)
export function snapshotBookcase(lib: Library, layout: ShelfLayout, year: number, now: string, skip: ReadonlySet<string> = new Set()): { bookcase: Bookcase; bindings: Binding[] } {
  const id = bookcaseIdOf(year);
  const mine = Object.values(lib.books)
    .filter((b) => !b.hiddenAt && !skip.has(b.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bindings: Binding[] = [];
  const books: BookcaseBook[] = mine.map((b: MyBook) => {
    const bd = b.bindingId ? lib.bindings[b.bindingId] : undefined;
    let bindingId: string | undefined;
    if (bd) {
      bindingId = archivedBindingId(id, b.id);
      bindings.push({ ...bd, id: bindingId, myBookId: b.id });
    }
    const entry: BookcaseBook = { bookId: b.id, status: b.status };
    if (bindingId) entry.bindingId = bindingId;
    if (b.rating !== undefined && b.rating !== null) entry.rating = b.rating;
    if (b.note) entry.note = b.note;
    if (b.ribbonColor) entry.ribbonColor = b.ribbonColor;
    if (b.currentPage !== undefined && b.currentPage !== null) entry.currentPage = b.currentPage;
    return entry;
  });
  const known = new Set(books.map((b) => b.bookId));
  const shelves = new Set(layout.shelves.map((s) => s.id));
  const placed = new Set<string>();
  const placements: BookPlacement[] = [];
  for (const p of layout.placements) {
    if (!known.has(p.bookId) || !shelves.has(p.shelfId) || placed.has(p.bookId)) continue;
    placed.add(p.bookId);
    const { x: _x, ...kept } = p;
    placements.push(kept);
  }
  const drawer: string[] = [];
  for (const b of layout.drawer) if (known.has(b) && !placed.has(b)) { placed.add(b); drawer.push(b); }
  return {
    bookcase: { id, year, createdAt: now, updatedAt: now, layout: { version: 2, shelves: layout.shelves.map((s) => ({ id: s.id, order: s.order })), placements, drawer }, books },
    bindings,
  };
}

// 그 책이 들어 있는 연도 책장의 해(오래된 순). 지울 때 안내에 쓴다
export function archivedYearsOf(bookcases: readonly Bookcase[], bookId: string): number[] {
  return bookcases.filter((c) => c.books.some((b) => b.bookId === bookId)).map((c) => c.year).sort((a, b) => a - b);
}

// 연도 책장에 있는 책 id
export function archivedBookIds(bookcases: readonly Bookcase[]): Set<string> {
  const out = new Set<string>();
  for (const c of bookcases) for (const b of c.books) out.add(b.bookId);
  return out;
}

// 연도 책장을 그리고 보여 줄 서재. full은 숨긴 책까지 든 서재.
// 책은 그때 값(상태·별점·한 줄 감상·갈피 색·쪽·장정), 판본·장정 줄은 지금 서재에서, 회차·독서 기록·갈피는 그해가 끝나기 전에 만든 것만.
// 그해 뒤에 끝낸 회차는 끝나지 않은 것으로 본다(그때 상태와 맞게)
export function bookcaseLibrary(full: Library, c: Bookcase): Library {
  const end = new Date(c.year + 1, 0, 1).getTime();
  const lastDay = `${c.year}-12-31`;
  const before = (iso: string | undefined) => !!iso && Date.parse(iso) < end;
  const lib: Library = { editions: {}, books: {}, rounds: {}, sessions: {}, bookmarks: {}, bindings: {} };
  for (const e of c.books) {
    const base = full.books[e.bookId];
    if (!base) continue;
    const b: MyBook = { ...base, status: e.status, rating: opt(e.rating), note: opt(e.note), ribbonColor: opt(e.ribbonColor), currentPage: opt(e.currentPage), bindingId: opt(e.bindingId) };
    delete b.hiddenAt;
    lib.books[b.id] = b;
    const ed = full.editions[b.editionId];
    if (ed) lib.editions[ed.id] = ed;
    const bd = e.bindingId ? full.bindings[e.bindingId] : undefined;
    if (bd) lib.bindings[bd.id] = bd;
  }
  for (const r of Object.values(full.rounds)) {
    if (!lib.books[r.myBookId] || !before(r.createdAt)) continue;
    lib.rounds[r.id] = r.finishedAt && r.finishedAt > lastDay ? { ...r, finishedAt: undefined } : r;
  }
  for (const s of Object.values(full.sessions)) if (s.myBookId && lib.books[s.myBookId] && before(s.startedAt)) lib.sessions[s.id] = s;
  for (const m of Object.values(full.bookmarks)) if (lib.books[m.myBookId] && before(m.createdAt)) lib.bookmarks[m.id] = m;
  return lib;
}

// ---- 전송 형식(server sync_bookcase.go와 같은 모양) ----
export type WireBookcase = {
  id: string; year: number; createdAt: string; updatedAt: string;
  shelves: { id: string; order: number }[]; placements: BookPlacement[]; drawer: string[];
  books: BookcaseBook[];
};

export const bookcaseToWire = (c: Bookcase): WireBookcase => ({
  id: c.id, year: c.year, createdAt: c.createdAt, updatedAt: c.updatedAt,
  shelves: c.layout.shelves, placements: c.layout.placements.map(({ x: _x, ...p }) => p), drawer: c.layout.drawer, books: c.books,
});

const statuses: readonly string[] = ['want', 'reading', 'read', 'paused'];
// 받은 값은 서버가 검사했지만 모양만 다시 확인한다(모르는 값은 버린다)
export function bookcaseFromWire(w: WireBookcase): Bookcase | null {
  if (!w || typeof w.id !== 'string' || !w.id || typeof w.year !== 'number' || typeof w.createdAt !== 'string') return null;
  const books: BookcaseBook[] = [];
  for (const b of Array.isArray(w.books) ? w.books : []) {
    if (!b || typeof b.bookId !== 'string' || !statuses.includes(b.status)) continue;
    const e: BookcaseBook = { bookId: b.bookId, status: b.status };
    if (typeof b.bindingId === 'string' && b.bindingId) e.bindingId = b.bindingId;
    if (typeof b.rating === 'number') e.rating = b.rating;
    if (typeof b.note === 'string' && b.note) e.note = b.note;
    if (typeof b.ribbonColor === 'string' && b.ribbonColor) e.ribbonColor = b.ribbonColor;
    if (typeof b.currentPage === 'number') e.currentPage = b.currentPage;
    books.push(e);
  }
  return {
    id: w.id, year: w.year, createdAt: w.createdAt, updatedAt: w.updatedAt ?? w.createdAt,
    layout: { version: 2, shelves: Array.isArray(w.shelves) ? w.shelves : [], placements: Array.isArray(w.placements) ? w.placements : [], drawer: Array.isArray(w.drawer) ? w.drawer : [] },
    books,
  };
}
