// 내 서재 저장소: 메모리 상태 + SQLite 표(종류별)에 바로 기록. 화면은 useLibrary()로 읽는다.
// 모든 변경은 여기 행동(action)으로만 한다. 책장 배치는 placement-store가 따로 저장한다(배치를 바꿔도 기록은 그대로).
import { useSyncExternalStore } from 'react';

import type { Merge } from '@/domain/sync';
import { withoutBooks } from '@/domain/home-reference';
import { applyLocalChanges, applyRemoteChanges, loadLib, loadLibrary, replaceLib, type LibKind, type LocalChange } from '@/db/local-db';
import {
  addSessionTo,
  applyStatus,
  bookmarksOf,
  defaultBinding,
  rebindInput,
  emptyLibrary,
  newId,
  rereadRound,
  roundsOf,
  updateSessionIn,
  type Binding,
  type Bookmark,
  type Edition,
  type Library,
  type MyBook,
  type ReadStatus,
  type Round,
  type SessionInput,
  type SessionPatch,
} from '@/domain/library';

type State = { lib: Library; loaded: boolean; error: string | null };

let state: State = { lib: emptyLibrary(), loaded: false, error: null };
let replacingWithLayout = false;
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const now = () => new Date().toISOString();

// 실패한 저장은 메모리에 남겨 재시도한다. 다음 변경이 이전 실패를 건너뛰지 않는다.
const pending: LocalChange[][] = [];
let persisting: Promise<void> | null = null;
function flushPending(): Promise<void> {
  if (persisting) return persisting;
  const work = (async () => {
    while (pending.length) {
      await applyLocalChanges(pending[0]);
      pending.shift();
    }
    if (state.error) set({ error: null });
  })();
  persisting = work.catch((error) => {
    set({ error: String((error as Error)?.message ?? error) });
    throw error;
  }).finally(() => { persisting = null; });
  return persisting;
}

// 화면은 즉시 갱신하고, 한 행동의 변경과 동기화 대기 기록은 같은 트랜잭션에 저장한다.
function commit(next: Library) {
  const prev = state.lib;
  const changes: LocalChange[] = [];
  const at = now();
  for (const k of Object.keys(next) as LibKind[]) {
    const a = prev[k] as Record<string, unknown>;
    const b = next[k] as Record<string, { id: string; updatedAt?: string }>;
    for (const id of Object.keys(b)) if (a[id] !== b[id]) changes.push({ kind: k, id, item: b[id], deleted: false, at: b[id].updatedAt ?? at });
    for (const id of Object.keys(a)) if (!(id in b)) changes.push({ kind: k, id, deleted: true, at });
  }
  if (changes.length) pending.push(changes);
  const saving = changes.length ? flushPending() : null;
  set({ lib: next });
  if (saving) void saving.catch(() => {});
}

export type NewBookInput = {
  edition: Omit<Edition, 'id' | 'createdAt' | 'updatedAt'>;
  status: ReadStatus;
  binding: Pick<Binding, 'spineColor' | 'motif' | 'source' | 'seed' | 'coverArtUri' | 'spineArtUri'> & Partial<Pick<Binding, 'inkColor' | 'accentColor' | 'layout' | 'material' | 'coverArtId'>>;
};

export const libraryStore = {
  get: () => state,
  isReplacingWithLayout: () => replacingWithLayout,
  flushPending,
  hasPending: () => pending.length > 0,
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
      if (migrated) await replaceLib(lib, true);
      set({ lib, loaded: true, error: null });
    } catch (e) {
      console.warn('library load failed', String((e as Error)?.stack ?? e));
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

  // 같은 상태를 다시 고르면 바꾸지 않는다. 날짜는 기기 현지 날짜(domain/library applyStatus)
  setStatus(id: string, status: ReadStatus) {
    const next = applyStatus(state.lib, id, status, now());
    if (next !== state.lib) commit(next);
  },

  // 다시 읽기: 지난 회차는 그대로 두고 새 회차를 연다(진도는 0쪽부터)
  reread(id: string) {
    const next = rereadRound(state.lib, id, now());
    if (next !== state.lib) commit(next);
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

  // 손대지 않은 예시 책을 서재에서 뺀다(domain/home-reference checkSampleBooks가 고른 것만). 동기화에는 삭제로 올라가
  // 서버에 올라간 예시도 지워진다. 책장 배치는 그대로라 표시 전용 예시로 남는다
  removeSampleBooks(ids: string[]) {
    const next = withoutBooks(state.lib, ids.filter((id) => !!state.lib.books[id]));
    if (next !== state.lib) commit(next);
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

  addBookmark(input: Pick<Bookmark, 'myBookId' | 'text' | 'page' | 'memo' | 'photoUri' | 'photoRatio' | 'sessionId'>) {
    const t = now();
    const m: Bookmark = { id: newId('bm'), createdAt: t, updatedAt: t, ...input };
    commit({ ...state.lib, bookmarks: { ...state.lib.bookmarks, [m.id]: m } });
    return m.id;
  },
  updateBookmark(id: string, patch: Partial<Pick<Bookmark, 'text' | 'page' | 'memo' | 'myBookId' | 'photoUri' | 'photoRatio' | 'sessionId' | 'savedAt'>>) {
    const m = state.lib.bookmarks[id];
    if (!m) return;
    commit({ ...state.lib, bookmarks: { ...state.lib.bookmarks, [id]: { ...m, ...patch, updatedAt: now() } } });
  },
  deleteBookmark(id: string) {
    const next = { ...state.lib.bookmarks };
    delete next[id];
    commit({ ...state.lib, bookmarks: next });
  },

  // id를 주면(타이머 id) 같은 기록을 두 번 저장해도 하나로 남는다. 책이 있으면 회차를 먼저 확보해 연결한다(domain addSessionTo)
  addSession(input: SessionInput) {
    const r = addSessionTo(state.lib, input, now());
    commit(r.lib);
    return r.id;
  },
  // 준 필드만 바꾼다. myBookId 키를 undefined로 주면 연결 해제(회차도 함께 비운다)
  updateSession(id: string, patch: SessionPatch) {
    const next = updateSessionIn(state.lib, id, patch, now());
    if (next !== state.lib) commit(next);
  },
  // 기록을 지우면 그 기록에 연결된 갈피는 연결만 비운다(갈피 원문은 그대로)
  deleteSession(id: string) {
    const next = { ...state.lib.sessions };
    delete next[id];
    const t = now();
    const marks = { ...state.lib.bookmarks };
    for (const m of Object.values(state.lib.bookmarks)) if (m.sessionId === id) marks[m.id] = { ...m, sessionId: undefined, updatedAt: t };
    commit({ ...state.lib, sessions: next, bookmarks: marks });
  },

  // 서버에서 받은 변경은 올릴 변경으로 세지 않고, 기록 완료 후 커서를 옮긴다.
  async applyRemote(m: Merge) {
    const before = state.lib;
    const changes: LocalChange[] = [
      ...m.writes.map(w => ({ kind: w.kind, id: w.item.id, item: w.item, deleted: false, at: w.item.updatedAt })),
      ...m.erases.map(e => ({ kind: e.kind, id: e.id, deleted: true, at: new Date().toISOString() })),
    ];
    await applyRemoteChanges(changes);
    // 저장하는 동안 사용자가 다시 수정한 항목은 그 값이 이긴다.
    const next: Library = { ...state.lib };
    for (const c of changes) {
      const original = before[c.kind] as Record<string, unknown>;
      const current = state.lib[c.kind] as Record<string, unknown>;
      if (current[c.id] !== original[c.id]) continue;
      const table = { ...(next[c.kind] as Record<string, unknown>) };
      if (c.deleted) delete table[c.id];
      else table[c.id] = c.item;
      (next[c.kind] as Record<string, unknown>) = table;
    }
    set({ lib: next });
  },

  // 백업 복원
  async replaceAll(lib: Library, layout?: { json: string | null; at: string }) {
    await flushPending();
    await replaceLib(lib, true, layout);
    replacingWithLayout = !!layout;
    try { set({ lib, error: null }); }
    finally { replacingWithLayout = false; }
  },
};

export function useLibrary() {
  return useSyncExternalStore(libraryStore.subscribe, libraryStore.get);
}
