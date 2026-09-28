// 확정된 배치 상태 + 기기 로컬 저장 + 되돌리기 1회.
// 드래그 중 임시 위치는 여기 들어오지 않는다. 확정(commit)될 때만 저장한다.
import { useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';

import { toShelfBook } from '@/domain/catalog';
import { migrate, threeShelfLayout, validate, withNormalizedX, type BookMap } from '@/domain/layout-engine';
import { withLeans } from '@/domain/shelf-scene';
import { loadLibrary } from '@/db/local-db';
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
};

// 온보딩 예시 16권 + 로컬 DB의 내 책(읽음만 선반/서랍 대상, Phase 1에서 추가 흐름 연결)
const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));

let state: State = { books, layout: SAMPLE_LAYOUT, undo: null, save: 'idle', loaded: false };
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
  return threeShelfLayout({ version: 2, shelves, placements, drawer });
}

async function persist(layout: ShelfLayout) {
  set({ save: 'saving' });
  try {
    await Storage.setItem(KEY, JSON.stringify(withNormalizedX(layout, state.books)));
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
      const lib = await loadLibrary();
      const mine = lib.filter((r) => r.user.status === 'read').map((r) => toShelfBook(r.catalog, r.user));
      if (mine.length) set({ books: { ...state.books, ...Object.fromEntries(mine.map((b) => [b.id, b])) } });
    } catch {
      // 로컬 DB를 못 열어도 예시 책장은 보여준다.
    }
    try {
      const raw = (await Storage.getItem(KEY)) ?? (await Storage.getItem(LEGACY_KEY));
      if (raw) {
        const saved = JSON.parse(raw) as ShelfLayout | ShelfLayoutV1;
        if (saved.version === 1 || saved.version === 2) {
          set({ layout: repair(saved, state.books), loaded: true });
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
    // 기대기 결과(최종 각도·상대)를 함께 저장하고, 기댈 곳이 없던 책은 바로 세운다.
    next = withLeans(threeShelfLayout(next), state.books);
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

  // 개발용: 예시 18권 배치로 되돌린다(비교 캡처용). 되돌리기 한 번으로 복구할 수 있다.
  resetSample() {
    const next = withLeans(SAMPLE_LAYOUT, state.books);
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
