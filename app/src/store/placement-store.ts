// 확정된 배치 상태 + 기기 로컬 저장 + 되돌리기 1회.
// 드래그 중 임시 위치는 여기 들어오지 않는다. 확정(commit)될 때만 저장한다.
import { useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';

import { normalize, validate, type BookMap } from '@/domain/layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '@/domain/sample-books';
import type { ShelfLayout } from '@/domain/types';

const KEY = 'shelf-layout:v1';

export type SaveStatus = 'idle' | 'saving' | 'error';

type State = {
  books: BookMap;
  layout: ShelfLayout;
  undo: ShelfLayout | null;
  save: SaveStatus;
  loaded: boolean;
};

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));

let state: State = { books, layout: SAMPLE_LAYOUT, undo: null, save: 'idle', loaded: false };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

// 저장본 복원. 모르는 책·중복은 버리고 빠진 책은 마지막 선반에 붙인다(기존 순서·그룹은 유지).
export function repair(saved: ShelfLayout, bookMap: BookMap): ShelfLayout {
  const seen = new Set<string>();
  const placements = saved.placements.filter((p) => {
    if (!bookMap[p.bookId] || seen.has(p.bookId)) return false;
    seen.add(p.bookId);
    return true;
  });
  const shelves = saved.shelves.length ? saved.shelves : [{ id: 'shelf-1', order: 0 }];
  const last = [...shelves].sort((a, b) => b.order - a.order)[0];
  const maxOrder = Math.max(-1, ...placements.filter((p) => p.shelfId === last.id).map((p) => p.order));
  Object.keys(bookMap)
    .filter((id) => !seen.has(id))
    .forEach((id, i) => placements.push({ bookId: id, shelfId: last.id, order: maxOrder + 1 + i, pose: 'spine', tilt: 0 }));
  return normalize({ version: 1, shelves, placements });
}

async function persist(layout: ShelfLayout) {
  set({ save: 'saving' });
  try {
    await Storage.setItem(KEY, JSON.stringify(layout));
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

  async load() {
    try {
      const raw = await Storage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as ShelfLayout;
        if (saved.version === 1) {
          const fixed = repair(saved, state.books);
          set({ layout: fixed, loaded: true });
          return;
        }
      }
    } catch {
      // 읽기 실패 시 샘플로 시작하되 저장은 덮어쓰지 않는다(다음 확정 때 저장).
    }
    set({ loaded: true });
  },

  // 검증된 레이아웃만 받는다. 무결성이 깨졌으면 거절한다.
  commit(next: ShelfLayout) {
    const errors = validate(next, state.books, Object.keys(state.books));
    if (errors.length) return false;
    set({ undo: state.layout, layout: next });
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

  retrySave() {
    void persist(state.layout);
  },
};

export function usePlacementStore() {
  return useSyncExternalStore(placementStore.subscribe, placementStore.get);
}
