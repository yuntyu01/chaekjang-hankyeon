// 앱 시작 때 한 번: 서재 → 책장 배치 → 설정·시점·진행 중 독서 순으로 불러온다.
// 서재가 바뀔 때마다 책장에 그릴 책 모양을 다시 만든다(배치는 배치 저장소가 따로 저장).
import Storage from 'expo-sqlite/kv-store';

import type { BookMap } from '@/domain/layout-engine';
import { toShelfBook, type Library } from '@/domain/library';

import { libraryStore } from './library-store';
import { placementStore } from './placement-store';
import { readingStore } from './reading-store';
import { settingsStore } from './settings-store';
import { viewStore } from './view-store';
import { bootMark } from '@/ui/boot-trace';
import { PERF_ENABLED } from '@/ui/perf';

// 측정 번들: 예시 18권 책장으로 시작(저장하지 않는 메모리 전용). ?demoboot=1 로 켜고 0으로 끈다.
// ?demoboot=mockup 은 같은 자리·치수에 시안 책장의 제목·색·표지 그림을 입힌 비교 책장
export const DEMO_BOOT_KEY = 'perf-demo-boot';

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
    bootMark('boot-start');
    await libraryStore.load();
    bootMark('library-loaded', Object.keys(libraryStore.get().lib.books).length);
    let lib = libraryStore.get().lib;
    await placementStore.load(shelfBooks(lib));
    bootMark('layout-loaded');
    if (PERF_ENABLED) {
      const demo = await Storage.getItem(DEMO_BOOT_KEY);
      if (demo === '1' || demo === 'mockup') placementStore.setDemo(true, demo === 'mockup' ? 'mockup' : 'sample');
    }
    libraryStore.subscribe(() => {
      const next = libraryStore.get().lib;
      if (next === lib) return;
      lib = next;
      placementStore.syncBooks(shelfBooks(next));
    });
    // 첫 화면에 필요한 것(설정·시점)만 기다리고, 진행 중 독서 복구는 뒤에서 읽는다(복구 창은 읽힌 뒤 뜬다)
    void readingStore.load().then(() => bootMark('reading-loaded'));
    await Promise.all([settingsStore.load(), viewStore.load()]);
    bootMark('settings-loaded');
  })();
  return started;
}
