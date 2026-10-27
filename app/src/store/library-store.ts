// 내 서재 저장소: 메모리 상태 + SQLite 표(종류별)에 바로 기록. 화면은 useLibrary()로 읽는다.
// 모든 변경은 여기 행동(action)으로만 한다. 책장 배치는 placement-store가 따로 저장한다(배치를 바꿔도 기록은 그대로).
import { useSyncExternalStore } from 'react';

import { noteChange } from './sync-dirty';
import type { Merge } from '@/domain/sync';
import { deleteLib, loadLib, loadLibrary, putLib, replaceLib, type LibKind } from '@/db/local-db';
import {
  applyStatus,
  bookmarksOf,
  currentRound,
  defaultBinding,
  rebindInput,
  emptyLibrary,
  newId,
  roundsOf,
  type Binding,
  type Bookmark,
  type Edition,
  type Library,
  type MyBook,
  type ReadStatus,
  type Round,
  type Session,
} from '@/domain/library';

type State = { lib: Library; loaded: boolean; error: string | null };

let state: State = { lib: emptyLibrary(), loaded: false, error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const now = () => new Date().toISOString();

// 메모리 먼저 바꾸고 표에 기록(실패하면 알림만: 다음 변경 때 다시 쓴다)
let applyingRemote = false; // 서버에서 받은 변경을 적용하는 중에는 '올릴 변경'으로 세지 않는다
function write(kind: LibKind, item: { id: string; updatedAt?: string }) {
  if (!applyingRemote) noteChange(kind, item.id, false, item.updatedAt ?? new Date().toISOString());
  putLib(kind, item).catch((e) => set({ error: String(e?.message ?? e) }));
}
function erase(kind: LibKind, id: string) {
  if (!applyingRemote) noteChange(kind, id, true, new Date().toISOString());
  deleteLib(kind, id).catch((e) => set({ error: String(e?.message ?? e) }));
}

// 두 서재를 비교해 바뀐 항목만 기록(행동이 여러 표를 건드려도 한 번에)
function commit(next: Library) {
  const prev = state.lib;
  set({ lib: next });
  for (const k of Object.keys(next) as LibKind[]) {
    const a = prev[k] as Record<string, unknown>;
    const b = next[k] as Record<string, { id: string; updatedAt?: string }>;
    for (const id of Object.keys(b)) if (a[id] !== b[id]) write(k, b[id]);
    for (const id of Object.keys(a)) if (!(id in b)) erase(k, id);
  }
}

export type NewBookInput = {
  edition: Omit<Edition, 'id' | 'createdAt' | 'updatedAt'>;
  status: ReadStatus;
  binding: Pick<Binding, 'spineColor' | 'motif' | 'source' | 'seed' | 'coverArtUri' | 'spineArtUri'> & Partial<Pick<Binding, 'inkColor' | 'accentColor' | 'layout' | 'material' | 'coverArtId'>>;
};

export const libraryStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  async load() {
    try {
      let lib = await loadLib();
      // 이전 구조(user_books + catalog_books)에 내 책이 있으면 한 번 옮긴다(같은 ISBN 판본이 이미 있으면 건너뜀)
      const legacy = await loadLibrary().catch(() => []);
      let migrated = 0;
      for (const { catalog: c, user: u } of legacy) {
        if (Object.values(lib.editions).some((e) => e.isbn13 === c.isbn13)) continue;
        const t = u.createdAt || now();
        const e: Edition = { id: newId('ed'), isbn13: c.isbn13, title: c.title, authors: c.authors, publisher: c.publisher, publishedAt: c.publishedAt, pageCount: c.pageCount, coverUri: c.coverUrl, coverSource: c.coverUrl ? 'api' : undefined, source: 'search', createdAt: t, updatedAt: t };
        const b: MyBook = { id: newId('bk'), editionId: e.id, status: u.status === 'read' ? 'read' : u.status === 'reading' ? 'reading' : 'want', note: u.note, createdAt: t, updatedAt: t };
        const bd = defaultBinding(b.id, c.title, 0, t, rebindInput({ isbn13: c.isbn13, title: c.title, authors: c.authors, pageCount: c.pageCount, publishedAt: c.publishedAt }, { themeColor: c.themeColor }));
        if (u.customThemeColor) bd.spineColor = u.customThemeColor;
        b.bindingId = bd.id;
        lib = { ...lib, editions: { ...lib.editions, [e.id]: e }, books: { ...lib.books, [b.id]: b }, bindings: { ...lib.bindings, [bd.id]: bd } };
        if (u.startedAt || u.finishedAt) {
          const r: Round = { id: newId('rd'), myBookId: b.id, index: 1, startedAt: u.startedAt, finishedAt: u.status === 'read' ? u.finishedAt : undefined, createdAt: t, updatedAt: t };
          lib = { ...lib, rounds: { ...lib.rounds, [r.id]: r } };
        }
        migrated++;
      }
      if (migrated) await replaceLib(lib);
      set({ lib, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: String((e as Error)?.message ?? e) });
    }
  },

  // 책 추가(판본 + 내 책 + 장정 + 읽기 상태에 맞는 회차)
  addBook(input: NewBookInput): string {
    const t = now();
    const e: Edition = { ...input.edition, id: newId('ed'), createdAt: t, updatedAt: t };
    const id = newId('bk');
    const bd: Binding = { id: newId('bd'), myBookId: id, status: 'ready', createdAt: t, updatedAt: t, ...input.binding };
    const b: MyBook = { id, editionId: e.id, status: 'want', bindingId: bd.id, createdAt: t, updatedAt: t };
    let lib: Library = { ...state.lib, editions: { ...state.lib.editions, [e.id]: e }, books: { ...state.lib.books, [id]: b }, bindings: { ...state.lib.bindings, [bd.id]: bd } };
    if (input.status !== 'want') lib = applyStatus(lib, id, input.status, t);
    commit(lib);
    return id;
  },

  updateEdition(editionId: string, patch: Partial<Omit<Edition, 'id' | 'createdAt'>>) {
    const e = state.lib.editions[editionId];
    if (!e) return;
    commit({ ...state.lib, editions: { ...state.lib.editions, [editionId]: { ...e, ...patch, updatedAt: now() } } });
  },

  updateBook(id: string, patch: Partial<Pick<MyBook, 'rating' | 'note' | 'currentPage'>>) {
    const b = state.lib.books[id];
    if (!b) return;
    commit({ ...state.lib, books: { ...state.lib.books, [id]: { ...b, ...patch, updatedAt: now() } } });
  },

  setStatus(id: string, status: ReadStatus) {
    commit(applyStatus(state.lib, id, status, now()));
  },

  // 다시 읽기: 지난 회차는 그대로 두고 새 회차를 연다
  reread(id: string) {
    const b = state.lib.books[id];
    if (!b) return;
    const last = currentRound(state.lib, id);
    const t = now();
    const r: Round = { id: newId('rd'), myBookId: id, index: (last?.index ?? 0) + 1, startedAt: t.slice(0, 10), createdAt: t, updatedAt: t };
    commit({ ...state.lib, rounds: { ...state.lib.rounds, [r.id]: r }, books: { ...state.lib.books, [id]: { ...b, status: 'reading', updatedAt: t } } });
  },

  updateRound(roundId: string, patch: Partial<Pick<Round, 'startedAt' | 'finishedAt'>>) {
    const r = state.lib.rounds[roundId];
    if (!r) return;
    commit({ ...state.lib, rounds: { ...state.lib.rounds, [roundId]: { ...r, ...patch, updatedAt: now() } } });
  },

  setBinding(myBookId: string, patch: Pick<Binding, 'spineColor' | 'motif' | 'source' | 'seed'> & Partial<Binding>) {
    const b = state.lib.books[myBookId];
    if (!b) return;
    const t = now();
    const old = b.bindingId ? state.lib.bindings[b.bindingId] : undefined;
    const bd: Binding = old ? { ...old, ...patch, updatedAt: t } : { id: newId('bd'), myBookId, status: 'ready', createdAt: t, updatedAt: t, ...patch };
    commit({ ...state.lib, bindings: { ...state.lib.bindings, [bd.id]: bd }, books: { ...state.lib.books, [myBookId]: { ...b, bindingId: bd.id, updatedAt: t } } });
  },

  // 삭제 범위: 내 책·판본·장정·회차·갈피는 지운다. 독서 시간 기록은 '책 없음'으로 남겨 통계에 유지한다.
  deleteBook(id: string) {
    const b = state.lib.books[id];
    if (!b) return;
    const lib: Library = { ...state.lib, books: { ...state.lib.books }, editions: { ...state.lib.editions }, bindings: { ...state.lib.bindings }, rounds: { ...state.lib.rounds }, bookmarks: { ...state.lib.bookmarks }, sessions: { ...state.lib.sessions } };
    delete lib.books[id];
    if (!Object.values(lib.books).some((o) => o.editionId === b.editionId)) delete lib.editions[b.editionId];
    for (const bd of Object.values(state.lib.bindings)) if (bd.myBookId === id) delete lib.bindings[bd.id];
    for (const r of roundsOf(state.lib, id)) delete lib.rounds[r.id];
    for (const m of bookmarksOf(state.lib, id)) delete lib.bookmarks[m.id];
    const t = now();
    for (const s of Object.values(state.lib.sessions)) if (s.myBookId === id) lib.sessions[s.id] = { ...s, myBookId: undefined, roundId: undefined, updatedAt: t };
    commit(lib);
  },

  addBookmark(input: Pick<Bookmark, 'myBookId' | 'text' | 'page' | 'memo' | 'photoUri' | 'photoRatio'>) {
    const t = now();
    const m: Bookmark = { id: newId('bm'), createdAt: t, updatedAt: t, ...input };
    commit({ ...state.lib, bookmarks: { ...state.lib.bookmarks, [m.id]: m } });
    return m.id;
  },
  updateBookmark(id: string, patch: Partial<Pick<Bookmark, 'text' | 'page' | 'memo' | 'myBookId' | 'photoUri' | 'photoRatio'>>) {
    const m = state.lib.bookmarks[id];
    if (!m) return;
    commit({ ...state.lib, bookmarks: { ...state.lib.bookmarks, [id]: { ...m, ...patch, updatedAt: now() } } });
  },
  deleteBookmark(id: string) {
    const next = { ...state.lib.bookmarks };
    delete next[id];
    commit({ ...state.lib, bookmarks: next });
  },

  // id를 주면(타이머 id) 같은 기록을 두 번 저장해도 하나로 남는다
  addSession(input: Pick<Session, 'myBookId' | 'startedAt' | 'endedAt' | 'durationMs' | 'pagesRead' | 'memo'> & { id?: string }) {
    const t = now();
    const round = input.myBookId ? currentRound(state.lib, input.myBookId) : undefined;
    const prev = input.id ? state.lib.sessions[input.id] : undefined;
    const s: Session = { roundId: round?.id, createdAt: prev?.createdAt ?? t, updatedAt: t, ...input, id: input.id ?? newId('ss') };
    let lib: Library = { ...state.lib, sessions: { ...state.lib.sessions, [s.id]: s } };
    // 쪽수를 적었으면 현재 쪽수를 앞으로만 옮긴다(선택 입력)
    const b = input.myBookId ? lib.books[input.myBookId] : undefined;
    if (b && input.pagesRead) lib = { ...lib, books: { ...lib.books, [b.id]: { ...b, currentPage: Math.max(b.currentPage ?? 0, input.pagesRead), updatedAt: t } } };
    commit(lib);
    return s.id;
  },
  updateSession(id: string, patch: Partial<Pick<Session, 'myBookId' | 'startedAt' | 'endedAt' | 'durationMs' | 'pagesRead' | 'memo'>>) {
    const s = state.lib.sessions[id];
    if (!s) return;
    const roundId = patch.myBookId !== undefined && patch.myBookId !== s.myBookId ? (patch.myBookId ? currentRound(state.lib, patch.myBookId)?.id : undefined) : s.roundId;
    commit({ ...state.lib, sessions: { ...state.lib.sessions, [id]: { ...s, ...patch, roundId, updatedAt: now() } } });
  },
  deleteSession(id: string) {
    const next = { ...state.lib.sessions };
    delete next[id];
    commit({ ...state.lib, sessions: next });
  },

  // 서버에서 받은 변경 적용(올릴 변경으로 세지 않는다)
  applyRemote(m: Merge) {
    applyingRemote = true;
    try {
      for (const w of m.writes) write(w.kind, w.item);
      for (const e of m.erases) erase(e.kind, e.id);
    } finally {
      applyingRemote = false;
    }
    set({ lib: m.lib });
  },

  // 백업 복원
  async replaceAll(lib: Library) {
    await replaceLib(lib);
    set({ lib });
  },
};

export function useLibrary() {
  return useSyncExternalStore(libraryStore.subscribe, libraryStore.get);
}
