import { useEffect, useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';

import { libraryStore } from './library-store';

// '아껴둔' 갈피: 2026-11부터 갈피 기록의 savedAt(아껴둔 때)으로 둔다 → 백업·복원·사용자별 동기화에 함께 간다.
// 예전에는 기기 안 키(bookmark-favorites:v1)에만 있었다: 처음 불러올 때 그 목록을 savedAt으로 한 번 옮긴다(옛 키는 지우지 않는다).
// 화면은 예전처럼 ids(아껴둔 순서)·toggle만 쓴다.
const KEY = 'bookmark-favorites:v1';
const MIGRATED = 'bookmark-favorites:moved-to-library';
type State = { loaded: boolean; ids: readonly string[] };
let state: State = { loaded: false, ids: [] };
let loading: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function idsOf(): string[] {
  return Object.values(libraryStore.get().lib.bookmarks)
    .filter((m) => m.savedAt)
    .sort((a, b) => a.savedAt!.localeCompare(b.savedAt!))
    .map((m) => m.id);
}
function refresh() {
  const ids = idsOf();
  if (state.loaded && ids.length === state.ids.length && ids.every((id, i) => id === state.ids[i])) return;
  state = { loaded: true, ids };
  emit();
}
libraryStore.subscribe(() => {
  if (state.loaded) refresh();
});

export const bookmarkPreferencesStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  load(): Promise<void> {
    if (state.loaded) return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
      if (!(await Storage.getItem(MIGRATED))) {
        const raw = await Storage.getItem(KEY);
        const value: unknown = raw ? JSON.parse(raw) : [];
        const old = Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];
        const marks = libraryStore.get().lib.bookmarks;
        const base = Date.now();
        // 예전 순서(누른 순서)를 지키려고 1ms씩 늦춘다. 없는 갈피는 건너뛴다. 이미 아껴둔 표시가 있으면 그대로
        old.forEach((id, i) => {
          if (marks[id] && !marks[id].savedAt) libraryStore.updateBookmark(id, { savedAt: new Date(base + i).toISOString() });
        });
        if (old.length) await libraryStore.flushPending();
        await Storage.setItem(MIGRATED, '1');
      }
      state = { loaded: true, ids: idsOf() };
      emit();
    })().finally(() => { loading = null; });
    return loading;
  },
  toggle(id: string): Promise<void> {
    // 누른 순서대로(처음 불러오는 중에 누른 것도)
    const next = writes.catch(() => {}).then(async () => {
      await bookmarkPreferencesStore.load();
      const m = libraryStore.get().lib.bookmarks[id];
      if (!m) return;
      libraryStore.updateBookmark(id, { savedAt: m.savedAt ? undefined : new Date().toISOString() });
      await libraryStore.flushPending();
      refresh();
    });
    writes = next;
    return next;
  },
};

export function useBookmarkPreferences() {
  const value = useSyncExternalStore(bookmarkPreferencesStore.subscribe, bookmarkPreferencesStore.get);
  useEffect(() => { void bookmarkPreferencesStore.load().catch(() => {}); }, []);
  return value;
}
