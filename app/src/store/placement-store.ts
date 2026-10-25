// 확정된 배치 상태 + 기기 로컬 저장 + 되돌리기 1회.
// 드래그 중 임시 위치는 여기 들어오지 않는다. 확정(commit)될 때만 저장한다.
import { useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { noteLayoutChange } from './sync-dirty';

import { addBook as placeNewBook, addShelf, applySwapTarget, bookXs, ensureShelves, findSwapTarget, fitToShelf, migrate, moveToDrawer, normalize, placeFromDrawer, pruneEmptyShelves, setDepth, validate, withNormalizedX, type BookMap } from '@/domain/layout-engine';
import { ensureLeanGaps, withLeans } from '@/domain/shelf-scene';
import { SHELF_DEPTH, SHELF_FRONT } from '@/domain/geometry';
import { MOCKUP_BOOKS, MOCKUP_LAYOUT } from '@/domain/mockup-sample';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '@/domain/onboarding-sample';
import type { ShelfLayout, ShelfLayoutV1 } from '@/domain/types';

const KEY = 'shelf-layout';
const LEGACY_KEY = 'shelf-layout:v1'; // v1(서랍 없음) 저장본

export type SaveStatus = 'idle' | 'saving' | 'error';

type State = {
  books: BookMap;
  layout: ShelfLayout;
  undo: ShelfLayout | null;
  save: SaveStatus;
  loaded: boolean;
  notice: number | null; // 복원하면서 선반에 들어가지 않아 서랍으로 옮긴 책 수(한 번 알리고 지운다)
  fell: number | null; // 마지막 확정에서 받침을 잃고 선반에서 떨어져 서랍에 들어간 책 수(domain/statics, 한 번 알리고 지운다)
  demo: boolean; // 측정 번들 전용 예시 책장(메모리에만, 저장하지 않는다. 사용자 데이터와 섞지 않는다)
};

// 첫 실행: 빈 선반 세 칸
export const EMPTY_LAYOUT: ShelfLayout = ensureShelves({ version: 2, shelves: [], placements: [], drawer: [] });

let state: State = { books: {}, layout: EMPTY_LAYOUT, undo: null, save: 'idle', loaded: false, notice: null, fell: null, demo: false };
let userSnapshot: { books: BookMap; layout: ShelfLayout } | null = null;
export type DemoKind = 'sample' | 'mockup';
let demoKind: DemoKind = 'sample';
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

// 저장본 복원. 모르는 책·중복은 버리고, 빠진 책은 서랍에 넣는다(기존 선반 순서·그룹은 그대로).
export function repair(saved: ShelfLayout | ShelfLayoutV1, bookMap: BookMap): ShelfLayout {
  const layout = migrate(saved);
  const seen = new Set<string>();
  const placements = layout.placements.filter((p) => {
    if (!bookMap[p.bookId] || seen.has(p.bookId)) return false;
    seen.add(p.bookId);
    return true;
  });
  const drawer = layout.drawer.filter((id) => {
    if (!bookMap[id] || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const id of Object.keys(bookMap)) if (!seen.has(id)) drawer.push(id);
  const shelves = layout.shelves.length ? layout.shelves : [{ id: 'shelf-1', order: 0 }];
  return ensureShelves({ version: 2, shelves, placements, drawer });
}

// 복원 + 지금 선반 경계(좌우 끝·깊이 0~230mm)에 맞추기. 맞지 않던 책만 최소로 옮기고 서랍으로 간 책을 알려 준다.
export function restore(saved: ShelfLayout | ShelfLayoutV1, bookMap: BookMap) {
  const base = repair(saved, bookMap);
  const fit = fitToShelf(base, bookMap);
  // 예전 규칙으로 버티지 못하는 각에 기대 있던 책은 틈을 맞춰 다시 기댄다(domain/statics.ts)
  const lean = ensureLeanGaps(fit.layout, bookMap);
  return { layout: withLeans(lean.layout, bookMap), moved: fit.moved, changed: fit.changed || lean.changed };
}

async function persist(layout: ShelfLayout) {
  if (state.demo) return;
  set({ save: 'saving' });
  try {
    await Storage.setItem(KEY, JSON.stringify(withNormalizedX(layout, state.books)));
    noteLayoutChange(new Date().toISOString());
    // 저장 도중 다른 변경이 있었으면 그쪽이 다시 저장한다.
    if (state.layout === layout) set({ save: 'idle' });
  } catch {
    if (state.layout === layout) set({ save: 'error' });
  }
}

export const placementStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  // 저장된 배치를 읽는다. 책 목록은 서재(library-store)가 syncBooks로 넘긴다(먼저 불러온 뒤 호출).
  async load(books: BookMap) {
    state = { ...state, books };
    try {
      const raw = (await Storage.getItem(KEY)) ?? (await Storage.getItem(LEGACY_KEY));
      if (raw) {
        const saved = JSON.parse(raw) as ShelfLayout | ShelfLayoutV1;
        if (saved.version === 1 || saved.version === 2) {
          // 예전 예시 책(b01~b18)만 있던 저장본은 내 책이 아니므로 배치에서 빠진다(repair가 모르는 책을 버린다)
          const r = restore(saved, books);
          set({ layout: r.layout, loaded: true, notice: r.moved.length ? r.moved.length : null });
          if (r.changed) void persist(r.layout);
          return;
        }
      }
    } catch {
      // 읽기 실패 시 빈 책장으로 시작하되 저장은 덮어쓰지 않는다(다음 확정 때 저장).
    }
    set({ layout: repair(EMPTY_LAYOUT, books), loaded: true });
  },

  // 서재가 바뀌면(추가·삭제·장정·갈피 수) 책 모양을 다시 만들고, 사라진 책은 배치에서 뺀다(새 책은 addToShelf로)
  syncBooks(books: BookMap) {
    if (state.demo) {
      userSnapshot = userSnapshot && { ...userSnapshot, books };
      return;
    }
    const known = new Set(Object.keys(books));
    const gone = [...state.layout.placements.map((p) => p.bookId), ...state.layout.drawer].filter((id) => !known.has(id));
    // 크기(판형·쪽수)가 바뀐 책이 선반에 있으면 그 선반만 다시 맞춘다(안 들어가면 끝 책을 서랍으로, 알림)
    const resized = state.layout.placements.some((p) => {
      const a = state.books[p.bookId]?.physical;
      const b = books[p.bookId]?.physical;
      return !!a && !!b && (a.widthMm !== b.widthMm || a.heightMm !== b.heightMm || a.pages !== b.pages);
    });
    if (!gone.length && !resized) {
      set({ books });
      return;
    }
    if (!gone.length) {
      const fit = fitToShelf(state.layout, books);
      const layout = withLeans(fit.layout, books);
      set({ books, layout, undo: null, notice: fit.moved.length ? fit.moved.length : state.notice });
      if (fit.changed) void persist(layout);
      return;
    }
    const layout = withLeans(
      normalize({ ...state.layout, placements: state.layout.placements.filter((p) => known.has(p.bookId)), drawer: state.layout.drawer.filter((id) => known.has(id)) }),
      books,
    );
    set({ books, layout, undo: null });
    void persist(layout);
  },

  // 새 책을 책장 빈 자리에(없으면 where: 'none' — 새 선반 추가 또는 서랍 보관을 고르게 한다)
  addToShelf(bookId: string): 'shelf' | 'none' {
    const base = { ...state.layout, drawer: state.layout.drawer.filter((id) => id !== bookId) };
    const r = placeNewBook(base, state.books, bookId);
    if (r.where !== 'shelf') return 'none';
    return placementStore.commit(r.layout) ? 'shelf' : 'none';
  },
  addToDrawer(bookId: string) {
    if (state.layout.drawer.includes(bookId) || state.layout.placements.some((p) => p.bookId === bookId)) return true;
    return placementStore.commit(normalize({ ...state.layout, drawer: [bookId, ...state.layout.drawer] }));
  },
  toDrawer(bookId: string) {
    const r = moveToDrawer(state.layout, bookId, state.books);
    return r.ok ? placementStore.commit(r.layout) : false;
  },
  fromDrawer(bookId: string): 'shelf' | 'none' {
    const r = placeFromDrawer(state.layout, state.books, bookId);
    if (!r.ok) return 'none';
    return placementStore.commit(r.layout) ? 'shelf' : 'none';
  },
  addShelf() {
    const id = `shelf-${Date.now().toString(36)}`;
    return placementStore.commit(addShelf(state.layout, id));
  },
  pruneShelves() {
    return placementStore.commit(pruneEmptyShelves(state.layout));
  },

  // 측정 번들 전용: 예시 18권 책장(메모리에만). 끄면 내 책장으로 돌아간다.
  // kind 'mockup': 같은 자리·치수에 시안 책장의 제목·색·표지 그림을 입힌 비교 책장(domain/mockup-sample).
  setDemo(on: boolean, kind: DemoKind = 'sample') {
    if (on === state.demo && (!on || kind === demoKind)) return;
    if (on) {
      if (!state.demo) userSnapshot = { books: state.books, layout: state.layout };
      demoKind = kind;
      const [list, layout] = kind === 'mockup' ? [MOCKUP_BOOKS, MOCKUP_LAYOUT] : [SAMPLE_BOOKS, SAMPLE_LAYOUT];
      const books = Object.fromEntries(list.map((b) => [b.id, b]));
      set({ demo: true, books, layout: withLeans(layout, books), undo: null });
    } else {
      const snap = userSnapshot ?? { books: {}, layout: EMPTY_LAYOUT };
      userSnapshot = null;
      set({ demo: false, books: snap.books, layout: snap.layout, undo: null });
    }
  },

  // 검증된 레이아웃만 받는다. 무결성이 깨졌으면 거절한다.
  commit(next: ShelfLayout) {
    // 서재에는 있는데 배치(선반·서랍) 어디에도 없는 책(추가하고 자리를 고르지 않은 책)은 서랍에 넣는다.
    // 그러지 않으면 '모든 책이 한 곳에' 검사에 걸려 이후 모든 확정이 실패한다.
    const placed = new Set([...next.placements.map((p) => p.bookId), ...next.drawer]);
    const missing = Object.keys(state.books).filter((id) => !placed.has(id));
    if (missing.length) next = { ...next, drawer: [...next.drawer, ...missing] };
    // 기대기 결과(최종 각도·상대)를 함께 저장하고, 기댈 곳이 없던 책은 바로 세운다. 받침을 잃고 넘어진 책은 눕히거나
    // (선반 끝 밖으로 떨어지면) 서랍에 넣는다.
    const inDrawer = new Set(next.drawer);
    next = withLeans(ensureShelves(next), state.books);
    const errors = validate(next, state.books, Object.keys(state.books));
    if (errors.length) return false;
    const fell = next.drawer.filter((id) => !inDrawer.has(id)).length;
    set({ undo: state.layout, layout: next, fell: fell || null });
    void persist(next);
    return true;
  },

  undo() {
    if (!state.undo) return false;
    const prev = state.undo;
    set({ layout: prev, undo: null });
    void persist(prev);
    return true;
  },

  // 개발용: 예시 18권 배치로 되돌린다(비교 캡처용). 되돌리기 한 번으로 복구할 수 있다.
  resetSample() {
    const next = withLeans(SAMPLE_LAYOUT, state.books);
    set({ undo: state.layout, layout: next });
    void persist(next);
  },

  // 개발용: 3번째 선반에 눕힌 책 한 권(나미야)만 두고 그 선반의 다른 책은 서랍으로(투영·돌리기 확인용)
  resetPilot() {
    const keep = SAMPLE_LAYOUT.placements.find((p) => p.bookId === 'b12')!;
    const others = SAMPLE_LAYOUT.placements.filter((p) => p.shelfId === keep.shelfId && p.bookId !== 'b12');
    const next = withLeans(
      normalize({
        ...SAMPLE_LAYOUT,
        placements: [...SAMPLE_LAYOUT.placements.filter((p) => p.shelfId !== keep.shelfId), { ...keep, stackId: undefined, stackOrder: undefined, pos: 110 }],
        drawer: [...SAMPLE_LAYOUT.drawer, ...others.map((p) => p.bookId)],
      }),
      state.books,
    );
    set({ undo: state.layout, layout: next });
    void persist(next);
  },

  clearNotice() {
    set({ notice: null });
  },

  clearFell() {
    set({ fell: null });
  },

  // 개발용: 3번째 선반에 두 권만. 뒤쪽 벽 앞에 표지 전시(우리가 빛의 속도로), 앞쪽 선반 앞 끝에 세운 책(쇼코의 미소)이 표지 일부를 가린다.
  resetOcclusionPilot() {
    const keep = ['b16', 'b14'];
    let l = normalize({
      ...SAMPLE_LAYOUT,
      placements: SAMPLE_LAYOUT.placements
        .filter((p) => p.shelfId !== 'shelf-3' || keep.includes(p.bookId))
        .map((p) => (p.bookId === 'b16' ? { ...p, pos: 140, depth: undefined } : p.bookId === 'b14' ? { ...p, pos: 30, depth: undefined } : p)),
      drawer: [...SAMPLE_LAYOUT.drawer, ...SAMPLE_LAYOUT.placements.filter((p) => p.shelfId === 'shelf-3' && !keep.includes(p.bookId)).map((p) => p.bookId)],
    });
    const step = (r: ReturnType<typeof setDepth>) => (r.ok ? r.layout : l);
    l = step(setDepth(l, state.books, 'b16', SHELF_DEPTH));
    l = step(setDepth(l, state.books, 'b14', -SHELF_FRONT + 2));
    const x16 = bookXs(l, state.books).get('b16')!;
    l = step(applySwapTarget(l, state.books, 'b14', findSwapTarget(l, state.books, 'b14', x16 + 24)));
    const next = withLeans(l, state.books);
    set({ undo: state.layout, layout: next });
    void persist(next);
  },

  // 개발용: 3번째 선반 가운데에 표지 전시 책 한 권(우리가 빛의 속도로)만, 벽에서 떨어져 선 상태
  resetWallPilot() {
    const p = SAMPLE_LAYOUT.placements.find((q) => q.bookId === 'b16')!;
    const next = withLeans(
      normalize({
        ...SAMPLE_LAYOUT,
        placements: [...SAMPLE_LAYOUT.placements.filter((q) => q.shelfId !== p.shelfId), { ...p, pos: 130, depth: 0 }],
        drawer: [...SAMPLE_LAYOUT.drawer, ...SAMPLE_LAYOUT.placements.filter((q) => q.shelfId === p.shelfId && q.bookId !== 'b16').map((q) => q.bookId)],
      }),
      state.books,
    );
    set({ undo: state.layout, layout: next });
    void persist(next);
  },

  retrySave() {
    void persist(state.layout);
  },
};

export function usePlacementStore() {
  return useSyncExternalStore(placementStore.subscribe, placementStore.get);
}
