// 내 서재 저장소: 메모리 상태 + SQLite 표(종류별)에 바로 기록. 화면은 useLibrary()로 읽는다.
// 모든 변경은 여기 행동(action)으로만 한다. 책장 배치는 placement-store가 따로 저장한다(배치를 바꿔도 기록은 그대로).
// 숨긴 책(MyBook.hiddenAt: 지웠지만 연도 책장에 있어 남긴 책, domain/bookcase)은 화면용 서재(state.lib)에서 뺀다.
// 그 책의 장정·회차·갈피와 그 책만 쓰는 판본도 함께 빼서 hidden에 두고, 그 책의 독서 기록은 '책 없음'으로 보인다(지울 때와 같은 모습).
// 동기화·백업·연도 책장은 둘을 합친 서재(full())를 쓴다.
import { useSyncExternalStore } from 'react';

import type { Merge } from '@/domain/sync';
import type { Bookcase } from '@/domain/bookcase';
import { withoutBooks } from '@/domain/home-reference';
import { applyLocalChanges, applyRemoteChanges, loadLib, replaceLib, type LibKind, type LocalChange } from '@/db/local-db';
import {
  addSessionTo,
  applyStatus,
  bookmarksOf,
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
  type Session,
  type SessionInput,
  type SessionPatch, withCoverColors } from '@/domain/library';

type State = { lib: Library; loaded: boolean; error: string | null };

let state: State = { lib: emptyLibrary(), loaded: false, error: null };
let replacingWithLayout = false;
// 숨긴 책과 딸린 항목(원래 값). 숨긴 책에 연결된 독서 기록은 여기에 원래 값, state.lib에는 연결을 뺀 모습이 있다
let hidden: Library = emptyLibrary();
// 연도 책장에 있는 책(지우면 숨긴다). bookcase-store가 알려 준다
let archived: ReadonlySet<string> = new Set();

const isEmpty = (lib: Library) => !Object.keys(lib.books).length && !Object.keys(lib.sessions).length && !Object.keys(lib.editions).length;
// 같은 원래 기록에는 같은 모습을 돌려준다(바뀌지 않은 기록이 바뀐 것으로 보여 저장되지 않게)
const unlinked = new WeakMap<Session, Session>();
function unlinkedView(s: Session): Session {
  let v = unlinked.get(s);
  if (!v) {
    v = { ...s, myBookId: undefined, roundId: undefined };
    unlinked.set(s, v);
  }
  return v;
}

// 전체 서재 → 화면용 서재 + 숨긴 부분. 숨긴 책이 없으면 그대로
export function splitHidden(full: Library): { lib: Library; hidden: Library } {
  const gone = new Set<string>();
  for (const b of Object.values(full.books)) if (b.hiddenAt) gone.add(b.id);
  if (!gone.size) return { lib: full, hidden: emptyLibrary() };
  const lib = emptyLibrary();
  const kept = emptyLibrary();
  for (const b of Object.values(full.books)) (gone.has(b.id) ? kept : lib).books[b.id] = b;
  for (const r of Object.values(full.rounds)) (gone.has(r.myBookId) ? kept : lib).rounds[r.id] = r;
  for (const m of Object.values(full.bookmarks)) (gone.has(m.myBookId) ? kept : lib).bookmarks[m.id] = m;
  for (const bd of Object.values(full.bindings)) (gone.has(bd.myBookId) ? kept : lib).bindings[bd.id] = bd;
  for (const s of Object.values(full.sessions)) {
    if (s.myBookId && gone.has(s.myBookId)) {
      kept.sessions[s.id] = s;
      lib.sessions[s.id] = unlinkedView(s);
    } else lib.sessions[s.id] = s;
  }
  const used = new Set(Object.values(lib.books).map((b) => b.editionId));
  const hiddenUse = new Set(Object.values(kept.books).map((b) => b.editionId));
  for (const e of Object.values(full.editions)) (used.has(e.id) || !hiddenUse.has(e.id) ? lib : kept).editions[e.id] = e;
  return { lib, hidden: kept };
}

let joined: { lib: Library; hidden: Library; full: Library } | null = null;
// 화면용 서재 + 숨긴 부분 = 전체 서재(숨긴 책의 독서 기록은 원래 값으로)
function full(): Library {
  if (isEmpty(hidden)) return state.lib;
  if (joined && joined.lib === state.lib && joined.hidden === hidden) return joined.full;
  const l = state.lib;
  const lib: Library = {
    editions: { ...l.editions, ...hidden.editions }, books: { ...l.books, ...hidden.books }, rounds: { ...l.rounds, ...hidden.rounds },
    sessions: { ...l.sessions, ...hidden.sessions }, bookmarks: { ...l.bookmarks, ...hidden.bookmarks }, bindings: { ...l.bindings, ...hidden.bindings },
  };
  joined = { lib: l, hidden, full: lib };
  return lib;
}
function setFull(next: Library) {
  const s = splitHidden(next);
  hidden = s.hidden;
  set({ lib: s.lib });
}
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
  // 화면에서 고친(또는 지운) '책 없음' 기록은 그 값이 이제 원래 값이다
  if (!isEmpty(hidden) && changes.some((c) => c.kind === 'sessions' && hidden.sessions[c.id])) {
    const sessions = { ...hidden.sessions };
    for (const c of changes) if (c.kind === 'sessions') delete sessions[c.id];
    hidden = { ...hidden, sessions };
  }
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
  full,
  setArchived(ids: ReadonlySet<string>) { archived = ids; },
  isReplacingWithLayout: () => replacingWithLayout,
  flushPending,
  hasPending: () => pending.length > 0,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  async load() {
    try {
      const lib = await loadLib();
      const s = splitHidden(lib);
      hidden = s.hidden;
      set({ lib: s.lib, loaded: true, error: null });
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

  updateBook(id: string, patch: Partial<Pick<MyBook, 'rating' | 'note' | 'currentPage' | 'ribbonColor'>>) {
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

  // 이미 DB에 기록한 장정(연도 책장의 그해 장정 복사본, bookcase-store)을 화면용 서재에 넣는다. 다시 저장하지 않는다
  adoptBindings(list: Binding[]) {
    if (!list.length) return;
    const bindings = { ...state.lib.bindings };
    for (const b of list) bindings[b.id] = b;
    set({ lib: { ...state.lib, bindings } });
  },

  // 표지에서 가장 넓게 차지하는 색을 판본·기본 장정에 넣는다(여러 권을 한 번에: 책장이 한 번만 다시 그려진다)
  applyCoverColors(colors: { editionId: string; color: string }[]) {
    if (colors.length) commit(withCoverColors(state.lib, colors, now()));
  },

  // 손대지 않은 예시 책을 서재에서 뺀다(domain/home-reference checkSampleBooks가 고른 것만). 동기화에는 삭제로 올라가
  // 서버에 올라간 예시도 지워진다. 책장 배치는 그대로라 표시 전용 예시로 남는다
  removeSampleBooks(ids: string[]) {
    const next = withoutBooks(state.lib, ids.filter((id) => !!state.lib.books[id]));
    if (next !== state.lib) commit(next);
  },

  // 삭제 범위: 내 책·판본·장정·회차·갈피는 지운다. 독서 시간 기록은 '책 없음'으로 남겨 통계에 유지한다.
  // 연도 책장에 있는 책은 지우지 않고 숨긴다: 내 책 줄에 숨긴 때만 적고, 장정·회차·갈피·독서 기록 연결은 그대로 둔다(화면에서는 지운 것과 같다)
  deleteBook(id: string) {
    const b = state.lib.books[id];
    if (!b) return;
    if (archived.has(id)) {
      const t = now();
      const hiddenBook: MyBook = { ...b, hiddenAt: t, updatedAt: t };
      pending.push([{ kind: 'books', id, item: hiddenBook, deleted: false, at: t }]);
      const saving = flushPending();
      const all = full();
      setFull({ ...all, books: { ...all.books, [id]: hiddenBook } });
      void saving.catch(() => {});
      return;
    }
    const lib: Library = { ...state.lib, books: { ...state.lib.books }, editions: { ...state.lib.editions }, bindings: { ...state.lib.bindings }, rounds: { ...state.lib.rounds }, bookmarks: { ...state.lib.bookmarks }, sessions: { ...state.lib.sessions } };
    delete lib.books[id];
    // 숨긴 책이 같은 판본을 쓰면 판본은 남긴다(아래에서 숨긴 쪽으로 옮긴다)
    const sharedWithHidden = Object.values(hidden.books).some((o) => o.editionId === b.editionId);
    if (!sharedWithHidden && !Object.values(lib.books).some((o) => o.editionId === b.editionId)) delete lib.editions[b.editionId];
    for (const bd of Object.values(state.lib.bindings)) if (bd.myBookId === id) delete lib.bindings[bd.id];
    for (const r of roundsOf(state.lib, id)) delete lib.rounds[r.id];
    for (const m of bookmarksOf(state.lib, id)) delete lib.bookmarks[m.id];
    const t = now();
    for (const s of Object.values(state.lib.sessions)) if (s.myBookId === id) lib.sessions[s.id] = { ...s, myBookId: undefined, roundId: undefined, updatedAt: t };
    commit(lib);
    if (sharedWithHidden) setFull(full());
  },

  addBookmark(input: Pick<Bookmark, 'myBookId' | 'text' | 'page' | 'memo' | 'photoUri' | 'photoRatio' | 'sessionId' | 'boardX' | 'boardY' | 'boardRot'>) {
    const t = now();
    const m: Bookmark = { id: newId('bm'), createdAt: t, updatedAt: t, ...input };
    commit({ ...state.lib, bookmarks: { ...state.lib.bookmarks, [m.id]: m } });
    return m.id;
  },
  updateBookmark(id: string, patch: Partial<Pick<Bookmark, 'text' | 'page' | 'memo' | 'myBookId' | 'photoUri' | 'photoRatio' | 'sessionId' | 'savedAt' | 'boardX' | 'boardY' | 'boardRot' | 'boardW'>>) {
    const m = state.lib.bookmarks[id];
    if (!m) return;
    commit({ ...state.lib, bookmarks: { ...state.lib.bookmarks, [id]: { ...m, ...patch, updatedAt: now() } } });
  },
  // 갈피 보드에서 카드 하나를 손댈 때: 아직 자동 자리인 다른 카드를 지금 자리에 고정하고(손댄 카드 때문에 다른 카드가 움직이지 않게) 손댄 카드를 바꾼다.
  // 한 번에 저장하고, 손댄 카드가 맨 위에 오도록 고정한 카드보다 늦은 시각을 준다
  updateBoard(spots: readonly { id: string; x: number; y: number; rot: number }[], id: string, patch: Partial<Pick<Bookmark, 'boardX' | 'boardY' | 'boardRot' | 'boardW'>>) {
    const m = state.lib.bookmarks[id];
    if (!m) return;
    const t = now();
    const before = new Date(Date.parse(t) - 1).toISOString();
    const bookmarks = { ...state.lib.bookmarks };
    for (const s of spots) {
      const o = bookmarks[s.id];
      if (o && s.id !== id && typeof o.boardX !== 'number') bookmarks[s.id] = { ...o, boardX: s.x, boardY: s.y, boardRot: s.rot, updatedAt: before };
    }
    bookmarks[id] = { ...m, ...patch, updatedAt: t };
    commit({ ...state.lib, bookmarks });
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
  // m은 전체 서재(full())로 합친 결과다. 숨긴 책이 오가면 화면용 서재와 숨긴 부분을 다시 나눈다
  async applyRemote(m: Merge) {
    const before = full();
    const changes: LocalChange[] = [
      ...m.writes.map(w => ({ kind: w.kind, id: w.item.id, item: w.item, deleted: false, at: w.item.updatedAt })),
      ...m.erases.map(e => ({ kind: e.kind, id: e.id, deleted: true, at: new Date().toISOString() })),
    ];
    await applyRemoteChanges(changes);
    // 저장하는 동안 사용자가 다시 수정한 항목은 그 값이 이긴다.
    const latest = full();
    const next: Library = { ...latest };
    for (const c of changes) {
      const original = before[c.kind] as Record<string, unknown>;
      const current = latest[c.kind] as Record<string, unknown>;
      if (current[c.id] !== original[c.id]) continue;
      const table = { ...(next[c.kind] as Record<string, unknown>) };
      if (c.deleted) delete table[c.id];
      else table[c.id] = c.item;
      (next[c.kind] as Record<string, unknown>) = table;
    }
    setFull(next);
  },

  // 백업 복원
  async replaceAll(lib: Library, layout?: { json: string | null; at: string }, bookcases?: Bookcase[]) {
    await flushPending();
    await replaceLib(lib, true, layout, bookcases);
    replacingWithLayout = !!layout;
    try {
      const s = splitHidden(lib);
      hidden = s.hidden;
      set({ lib: s.lib, error: null });
    } finally { replacingWithLayout = false; }
  },
};

export function useLibrary() {
  return useSyncExternalStore(libraryStore.subscribe, libraryStore.get);
}
