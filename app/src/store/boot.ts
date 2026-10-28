// 앱 시작 때 한 번: 서재 → 책장 배치 → 설정·시점·진행 중 독서 순으로 불러온다.
// 서재가 바뀔 때마다 책장에 그릴 책 모양을 다시 만든다(배치는 배치 저장소가 따로 저장).
import Storage from 'expo-sqlite/kv-store';
import { readLayout, saveLayout } from '@/db/local-db';

import { migrate, type BookMap } from '@/domain/layout-engine';
import type { Library } from '@/domain/library';
import { referenceHomeBooks, type HomeReferenceProfile } from '@/domain/home-reference';

import { libraryStore } from './library-store';
import { EMPTY_LAYOUT, placementStore } from './placement-store';
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

export function shelfBooks(lib: Library): BookMap {
  return referenceHomeBooks(lib, homeProfile);
}

let started: Promise<void> | null = null;

export function bootStores() {
  started ??= (async () => {
    bootMark('boot-start');
    await libraryStore.load();
    // 빈 서재로 계속 진행하면 읽지 못한 기존 배치를 덮어쓸 수 있다.
    if (libraryStore.get().error) throw new Error('서재를 불러오지 못했어요');
    bootMark('library-loaded', Object.keys(libraryStore.get().lib.books).length);
    // 배치를 읽지 못하면 빈 책장으로 시작하지 않는다(기존 저장본 보호).
    const saved = (await readLayout()).json;
    if (!libraryStore.get().error) {
      try {
        homeProfile = await installReferenceHome(libraryStore.get().lib, saved ? migrate(JSON.parse(saved)) : EMPTY_LAYOUT, {
          getItem: async key => key === 'shelf-layout' ? (await readLayout()).json : Storage.getItem(key),
          setItem: async (key, value) => { if (key === 'shelf-layout') await saveLayout(value, new Date().toISOString()); else await Storage.setItem(key, value); },
          saveLibrary: library => libraryStore.replaceAll(library),
          hasSavedLayout: saved !== null,
        });
      } catch (error) {
        // 백업/설치 실패는 다음 시작 때 재시도한다. 기존 서재는 계속 열 수 있다.
        console.warn('홈 시안 구성 저장 실패', error);
      }
    }
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
    // 서버 동기화(서버 주소가 있을 때만): 서재·배치가 모두 불러와진 뒤 연결한다
    initSync({ reloadLayout: () => placementStore.load(shelfBooks(libraryStore.get().lib)) });
    // 첫 화면에 필요한 것(설정·시점)만 기다리고, 진행 중 독서 복구는 뒤에서 읽는다(복구 창은 읽힌 뒤 뜬다)
    void readingStore.load().then(() => bootMark('reading-loaded'));
    await Promise.all([settingsStore.load(), viewStore.load()]);
    bootMark('settings-loaded');
  })().catch((error) => {
    started = null;
    throw error;
  });
  return started;
}
