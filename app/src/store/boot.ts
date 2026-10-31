// 앱 시작 때 한 번: 서재 → 책장 배치 → 설정·시점·진행 중 독서 순으로 불러온다.
// 서재가 바뀔 때마다 책장에 그릴 책 모양을 다시 만든다(배치는 배치 저장소가 따로 저장).
import Storage from 'expo-sqlite/kv-store';
import { readLayout, saveLayout } from '@/db/local-db';

import { migrate, type BookMap } from '@/domain/layout-engine';
import type { Library } from '@/domain/library';
import { checkSampleBooks, referenceHomeBooks, type HomeReferenceProfile } from '@/domain/home-reference';

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
// 예시 책 분리 결과(뺀 것·보존한 것과 이유). 보고·점검용
export const SAMPLE_REPORT_KEY = 'sample-books:report';
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
    // 예시 책 분리(2026-11): 손대지 않은 예시만 서재에서 빼고(표시 전용으로 남음), 사용자 흔적이 있는 예시는 실제 책으로 보존·기록
    try {
      const checks = checkSampleBooks(libraryStore.get().lib);
      const pure = checks.filter((c) => c.pure).map((c) => c.id);
      if (pure.length) {
        libraryStore.removeSampleBooks(pure);
        await libraryStore.flushPending();
      }
      const kept = checks.filter((c) => !c.pure);
      if (pure.length || kept.length) await Storage.setItem(SAMPLE_REPORT_KEY, JSON.stringify({ at: new Date().toISOString(), removed: pure, kept }));
      if (kept.length) console.warn('예시 책 중 사용자 기록이 있어 보존', JSON.stringify(kept));
    } catch (error) {
      console.warn('예시 책 분리 실패(다음 시작 때 다시)', error);
    }
    let lib = libraryStore.get().lib;
    await placementStore.load(shelfBooks(lib));
    bootMark('layout-loaded');
    if (PERF_ENABLED) {
      const demo = await Storage.getItem(DEMO_BOOT_KEY);
      if (demo === '1' || demo === 'mockup') placementStore.setDemo(true, demo === 'mockup' ? 'mockup' : 'sample');
    }
    // 독서 복구가 끝나기 전 새 타이머를 시작하면 불러온 값이 새 기록을 덮을 수 있다.
    await Promise.all([readingStore.load().then(() => bootMark('reading-loaded')), settingsStore.load(), viewStore.load()]);
    libraryStore.subscribe(() => {
      const next = libraryStore.get().lib;
      if (next === lib) return;
      lib = next;
      // 복원은 배치까지 함께 기록했고 곧 그 배치를 읽는다. 이전 배치로 덮어쓰지 않는다.
      if (libraryStore.isReplacingWithLayout()) return;
      placementStore.syncBooks(shelfBooks(next));
    });
    // 서버 동기화(서버 주소가 있을 때만): 서재·배치가 모두 불러와진 뒤 연결한다
    initSync({ reloadLayout: () => placementStore.load(shelfBooks(libraryStore.get().lib)) });
    bootMark('settings-loaded');
  })().catch((error) => {
    started = null;
    throw error;
  });
  return started;
}
