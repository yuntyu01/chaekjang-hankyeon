import { useEffect, useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';

// Presentation preference only: never rewrite the library's bookmarks or book records.
const KEY = 'bookmark-favorites:v1';
let state: { loaded: boolean; ids: readonly string[] } = { loaded: false, ids: [] };
let loading: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

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
      const raw = await Storage.getItem(KEY);
      const value: unknown = raw ? JSON.parse(raw) : [];
      state = { loaded: true, ids: Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [] };
      emit();
    })().finally(() => { loading = null; });
    return loading;
  },
  toggle(id: string): Promise<void> {
    // Serialize taps, including those made while the initial preference is loading.
    const next = writes.catch(() => {}).then(async () => {
      await bookmarkPreferencesStore.load();
      const ids = state.ids.includes(id) ? state.ids.filter((value) => value !== id) : [...state.ids, id];
      await Storage.setItem(KEY, JSON.stringify(ids));
      state = { loaded: true, ids };
      emit();
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
