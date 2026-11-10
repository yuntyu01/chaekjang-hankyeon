// 연도 책장 저장소: 남긴 연도 책장 목록과, 해가 바뀌면 그해 책장을 남기는 일(규칙은 domain/bookcase).
// 확인하는 때: 앱 시작(다른 저장보다 먼저, boot), 앱으로 돌아올 때, 앱을 켜 둔 채 새해 자정이 지날 때.
// 처음 받는 동기화가 끝나지 않았으면(새 기기에서 서재를 받는 중) 남기지 않는다: 반쯤 받은 서재로 한 해를 고정하지 않게.
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { createBookcase, readBookcases, readLayout } from '@/db/local-db';
import { archivedBookIds, archivedYearsOf, snapshotBookcase, yearToArchive, type Bookcase } from '@/domain/bookcase';
import { checkSampleBooks } from '@/domain/home-reference';
import { migrate } from '@/domain/layout-schema';
import type { ShelfLayout } from '@/domain/types';

import { libraryStore } from './library-store';

// 서버에서 서재 전체를 처음부터 받는 중(services/sync가 쓰고 지운다)
export const PULL_ALL_KEY = 'sync-pulling-all:v1';

type State = { bookcases: Bookcase[]; loaded: boolean };
let state: State = { bookcases: [], loaded: false };
const listeners = new Set<() => void>();
let syncBusy = false;
let checking: Promise<number | null> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let watching = false;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  libraryStore.setArchived(archivedBookIds(state.bookcases));
  listeners.forEach((l) => l());
}

function storedLayout(json: string | null): ShelfLayout {
  if (!json) return { version: 2, shelves: [], placements: [], drawer: [] };
  try {
    const l = migrate(JSON.parse(json));
    return Array.isArray(l.shelves) && Array.isArray(l.placements) && Array.isArray(l.drawer) ? l : { version: 2, shelves: [], placements: [], drawer: [] };
  } catch {
    // 읽지 못한 배치는 비운다(책 목록·한 줄 감상은 그래도 남긴다)
    return { version: 2, shelves: [], placements: [], drawer: [] };
  }
}

async function check(now: Date): Promise<number | null> {
  if (syncBusy || (await Storage.getItem(PULL_ALL_KEY))) return null;
  await libraryStore.flushPending();
  const { json, at } = await readLayout();
  const full = libraryStore.full();
  const year = yearToArchive(full, at, state.bookcases.map((c) => c.year), now);
  if (year === null) return null;
  return keep(json, year, now);
}

// 지금 서재·배치(json)를 그해 책장으로 남긴다. 손대지 않은 예시 책(시작 때 서재에서 빠질 책)은 남기지 않는다
async function keep(json: string | null, year: number, now: Date): Promise<number | null> {
  const full = libraryStore.full();
  const skip = new Set(checkSampleBooks(full).filter((c) => c.pure).map((c) => c.id));
  const { bookcase, bindings } = snapshotBookcase(full, storedLayout(json), year, now.toISOString(), skip);
  if (!bookcase.books.length) return null;
  await createBookcase(bookcase, bindings);
  libraryStore.adoptBindings(bindings);
  set({ bookcases: [...state.bookcases.filter((c) => c.year !== year), bookcase].sort((a, b) => a.year - b.year) });
  console.log(`[bookcase] ${year}년 책장을 남겼어요(${bookcase.books.length}권, 선반 ${bookcase.layout.shelves.length})`);
  return year;
}

// 앱을 켜 둔 채 새해가 되면 자정 직후에 한 번 확인한다(하루 안으로 남았을 때만 예약)
function arm() {
  if (timer) clearTimeout(timer);
  timer = null;
  const now = new Date();
  const left = new Date(now.getFullYear() + 1, 0, 1).getTime() - now.getTime();
  if (left > 24 * 3600_000) return;
  timer = setTimeout(() => {
    timer = null;
    void bookcaseStore.checkYear().catch(() => {}).finally(arm);
  }, left + 5_000);
}

export const bookcaseStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  async load() {
    const { bookcases } = await readBookcases();
    set({ bookcases, loaded: true });
  },

  // 해가 바뀌었으면 그해 책장을 남긴다. 남긴 해(없으면 null). 동시에 부르면 한 번만 한다
  checkYear(now: Date = new Date()): Promise<number | null> {
    checking ??= check(now).finally(() => { checking = null; });
    return checking;
  },

  // 측정 번들 전용(useHomePerf ?seedyear=2025): 지금 책장을 지난 해 책장으로 남긴다(지난 책장 화면 사진용, 측정 번들은 서버가 없다). 그해 책장이 있으면 그대로 둔다
  async seedYear(year: number): Promise<number | null> {
    if (state.bookcases.some((c) => c.year === year)) return null;
    await libraryStore.flushPending();
    const { json } = await readLayout();
    return keep(json, year, new Date());
  },

  // 동기화가 도는 동안은 확인하지 않는다(받는 도중의 서재로 남기지 않게)
  setSyncBusy(busy: boolean) { syncBusy = busy; },

  watch() {
    if (watching) return;
    watching = true;
    arm();
    AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void bookcaseStore.checkYear().catch((e) => console.warn('연도 책장 확인 실패', e));
      arm();
    });
  },
};

export function useBookcases(): Bookcase[] {
  return useSyncExternalStore(bookcaseStore.subscribe, () => state.bookcases);
}

// 지울 책 중 연도 책장에 있는 책의 해들(그 책들은 지우지 않고 숨긴다: library-store deleteBook)
export function keptYears(bookcases: readonly Bookcase[], ids: readonly string[]): { kept: string[]; years: number[] } {
  const kept = ids.filter((id) => bookcases.some((c) => c.books.some((b) => b.bookId === id)));
  const years = [...new Set(kept.flatMap((id) => archivedYearsOf(bookcases, id)))].sort((a, b) => a - b);
  return { kept, years };
}
