// 앱 시작 때 한 번: 서재 → 책장 배치 → 설정·시점·진행 중 독서 순으로 불러온다.
// 서재가 바뀔 때마다 책장에 그릴 책 모양을 다시 만든다(배치는 배치 저장소가 따로 저장).
import type { BookMap } from '@/domain/layout-engine';
import { toShelfBook, type Library } from '@/domain/library';

import { libraryStore } from './library-store';
import { placementStore } from './placement-store';
import { readingStore } from './reading-store';
import { settingsStore } from './settings-store';
import { viewStore } from './view-store';

export function shelfBooks(lib: Library): BookMap {
  const out: BookMap = {};
  for (const id of Object.keys(lib.books)) {
    const b = toShelfBook(lib, id);
    if (b) out[id] = b;
  }
  return out;
}

let started: Promise<void> | null = null;

export function bootStores() {
  started ??= (async () => {
    await libraryStore.load();
    let lib = libraryStore.get().lib;
    await placementStore.load(shelfBooks(lib));
    libraryStore.subscribe(() => {
      const next = libraryStore.get().lib;
      if (next === lib) return;
      lib = next;
      placementStore.syncBooks(shelfBooks(next));
    });
    await Promise.all([settingsStore.load(), viewStore.load(), readingStore.load()]);
  })();
  return started;
}
