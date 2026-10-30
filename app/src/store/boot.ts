// 앱 시작 때 한 번: 서재 → 책장 배치 → 설정·시점·진행 중 독서 순으로 불러온다.
// 서재가 바뀔 때마다 책장에 그릴 책 모양을 다시 만든다(배치는 배치 저장소가 따로 저장).
import Storage from 'expo-sqlite/kv-store';

import { saveLayout } from '@/db/local-db';
import type { BookMap } from '@/domain/layout-engine';
import type { Library } from '@/domain/library';
import type { ShelfLayout } from '@/domain/types';
import { referenceHomeBooks, type HomeReferenceProfile } from '@/domain/home-reference';

import { libraryStore } from './library-store';
import { EMPTY_LAYOUT, placementStore, readSavedLayout } from './placement-store';
import { installReferenceHome } from './home-reference-install';
import { readingStore } from './reading-store';
import { initSync } from '@/services/sync';
import { settingsStore } from './settings-store';
import { viewStore } from './view-store';
import { bootMark } from '@/ui/boot-trace';
import { PERF_ENABLED } from '@/ui/perf';

// 측정 번들: 예시 18권 책장으로 시작(저장하지 않는 메모리 전용). ?demoboot=1 로 켜고 0으로 끈다.
// ?demoboot=mockup 은 같은 자리·치수에 시안 책장의 제목·색·표지 그림을 입힌 비교 책장
export const DEMO_BOOT_KEY = 'perf-demo-boot';
let homeProfile: HomeReferenceProfile = {};

// 서재가 바뀌면 책 모양을 다시 만들되, 내용이 같은 책은 이전 객체를 그대로 쓴다
// (책장 줄·책 그림 기록이 객체가 같은지로 다시 그릴지 정하므로, 한 권만 바뀌면 그 책만 다시 그린다)
let lastBooks: BookMap = {};
export function shelfBooks(lib: Library): BookMap {
  const next = referenceHomeBooks(lib, homeProfile);
  for (const id of Object.keys(next)) if (lastBooks[id] && same(lastBooks[id], next[id])) next[id] = lastBooks[id];
  lastBooks = next;
  return next;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

let started: Promise<void> | null = null;

export function bootStores() {
  started ??= (async () => {
    bootMark('boot-start');
    // 설정·시점은 서재와 무관하다: 먼저 읽기 시작해 두고 첫 화면 직전에 기다린다
    const prefs = Promise.all([settingsStore.load(), viewStore.load()]);
    await libraryStore.load();
    bootMark('library-loaded', Object.keys(libraryStore.get().lib.books).length);
    // 저장된 배치는 한 번만 읽는다(시안 설치가 새 배치를 쓰면 배치 저장소가 다시 읽는다)
    let saved: ShelfLayout | null | undefined;
    if (!libraryStore.get().error) {
      try {
        homeProfile = await installReferenceHome(libraryStore.get().lib, async () => (saved = await readSavedLayout()) ?? EMPTY_LAYOUT, {
          getItem: key => Storage.getItem(key),
          setItem: (key, value) => Storage.setItem(key, value),
          saveLibrary: library => libraryStore.replaceAll(library),
          saveLayout: async layout => {
            saved = undefined;
            await saveLayout(layout, true);
          },
        });
      } catch (error) {
        // 백업/설치 실패는 다음 시작 때 재시도한다. 기존 서재는 계속 열 수 있다.
        console.warn('홈 시안 구성 저장 실패', error);
      }
    }
    let lib = libraryStore.get().lib;
    await placementStore.load(shelfBooks(lib), saved);
    bootMark('layout-loaded');
    if (PERF_ENABLED) {
      const demo = await Storage.getItem(DEMO_BOOT_KEY);
      if (demo === '1' || demo === 'mockup') placementStore.setDemo(true, demo === 'mockup' ? 'mockup' : 'sample');
    }
    libraryStore.subscribe(() => {
      const next = libraryStore.get().lib;
      if (next === lib) return;
      const prev = lib;
      lib = next;
      // 책장 책 모양에 쓰이지 않는 것(독서 세션)만 바뀌었으면 다시 만들지 않는다
      if (prev.books === next.books && prev.editions === next.editions && prev.bindings === next.bindings && prev.rounds === next.rounds && prev.bookmarks === next.bookmarks) return;
      placementStore.syncBooks(shelfBooks(next));
    });
    // 서버 동기화(서버 주소가 있을 때만): 서재·배치가 모두 불러와진 뒤 연결한다
    initSync({ reloadLayout: () => placementStore.load(shelfBooks(libraryStore.get().lib)) });
    // 첫 화면에 필요한 것(설정·시점)만 기다리고, 진행 중 독서 복구는 뒤에서 읽는다(복구 창은 읽힌 뒤 뜬다)
    void readingStore.load().then(() => bootMark('reading-loaded'));
    await prefs;
    bootMark('settings-loaded');
  })();
  return started;
}
