// 지금 앱 QA 빌드가 비교 사진용으로 넣는 서재를 그대로 뽑는다(gen_shaders.sh가 jest로 돌린다).
// QA 앱에 딥링크 ?seedlib=1(realLibrarySeed: 실제 책 18권·두 달 독서·감상·메모·갈피) → ?seedshelf=1(비교 책장 REAL_LAYOUT 자리에 꽂기)을
// 보낸 것과 같은 일을 지금 앱의 실제 저장 경로(서재 저장소·책장 배치 저장소 → SQLite)로 하고, 표마다 행을 assets/qa_seed.json에 쓴다.
// Flutter는 서재가 비어 있으면 이 행을 그대로 넣는다 → 두 앱이 같은 데이터로 화면을 띄워 견줄 수 있다
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { createSQLiteTestDatabase } from '@/test-utils/sqlite';

jest.mock('@shopify/react-native-skia', () => mockStubModule());
jest.mock('react-native-reanimated', () => mockStubModule());
jest.mock('react-native-worklets', () => mockStubModule());
jest.mock('expo-audio', () => mockStubModule());
jest.mock('expo-video', () => mockStubModule());
let mockDb = createSQLiteTestDatabase();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb), openDatabaseSync: jest.fn(() => mockDb) }));
const mockKv = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockKv.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockKv.set(k, v)),
    removeItem: jest.fn(async (k: string) => void mockKv.delete(k)),
    getItemSync: jest.fn((k: string) => mockKv.get(k) ?? null),
    setItemSync: jest.fn((k: string, v: string) => void mockKv.set(k, v)),
  },
}));
function mockStubModule() {
  const f: any = new Proxy(function () {}, {
    get: (_t, k) => (k === '__esModule' ? true : k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : f),
    apply: () => f,
    construct: () => f,
  });
  return f;
}

const TABLES = ['editions', 'edition_authors', 'my_books', 'bindings', 'rounds', 'sessions', 'bookmarks', 'shelves', 'shelf_placements'];

// 지금 앱 QA에서 '폴더에 백업 파일 저장'으로 내보낸 서재가 있으면(tool/qa/rn-backup.json) 그것을 그대로 쓴다:
// 기기에서 넣은 예시 서재와 밀리초까지 같은 값(복원 함수는 '바뀐 때'를 복원 시각으로 바꾸므로 그 안의 replaceLib에 원래 값을 넣는다)
const BACKUP = join(__dirname, 'qa', 'rn-backup.json');

test('dump QA seed library', async () => {
  mockDb = createSQLiteTestDatabase();
  const now = new Date();
  if (existsSync(BACKUP)) {
    const data = JSON.parse(readFileSync(BACKUP, 'utf8'));
    const { replaceLib } = require('@/db/local-db') as typeof import('@/db/local-db');
    await replaceLib(data.library, true, { json: data.layout, at: data.exportedAt }, []);
    const rows: Record<string, unknown[]> = {};
    for (const t of TABLES) rows[t] = await mockDb.getAllAsync(`SELECT * FROM ${t}`);
    const dir = join(__dirname, '..', 'assets');
    writeFileSync(join(dir, 'qa_seed.json'), `${JSON.stringify({ note: '지금 앱 QA 서재 백업(tool/qa/rn-backup.json)을 지금 앱 저장 경로로 푼 행(tool/dump_qa_seed.test.ts). 손으로 고치지 말 것', now: data.exportedAt, view: data.view ?? null, settings: data.settings ?? null, rows })}\n`);
    console.log(`[dump] qa seed(backup) books ${rows.my_books.length} sessions ${rows.sessions.length} bookmarks ${rows.bookmarks.length} placements ${rows.shelf_placements.length}`);
    return;
  }
  const { libraryStore } = require('@/store/library-store') as typeof import('@/store/library-store');
  const { placementStore } = require('@/store/placement-store') as typeof import('@/store/placement-store');
  const { shelfBooks } = require('@/store/boot') as typeof import('@/store/boot');
  const { REAL_LAYOUT, realBookOf, realLibrarySeed } = require('@/domain/real-sample') as typeof import('@/domain/real-sample');
  const { rememberSpineRatio } = require('@/domain/cover-url') as typeof import('@/domain/cover-url');
  await libraryStore.load();
  // ?seedlib=1
  realLibrarySeed(libraryStore, now);
  await libraryStore.flushPending();
  const { lib } = libraryStore.get();
  // 기기에서 잰 책등 비율(실사 책 두께)을 같은 값으로(Flutter rememberSampleSpineRatios와 같다)
  const coverByTitle = new Map(Object.values(lib.books).map((b) => [lib.editions[b.editionId]?.title, lib.editions[b.editionId]?.coverUri]));
  for (const p of REAL_LAYOUT.placements) {
    const ref = realBookOf(p.bookId);
    const cover = ref && coverByTitle.get(ref.title);
    if (cover && ref?.dims) rememberSpineRatio(cover, ref.dims.thickness / ref.dims.height);
  }
  // ?seedshelf=1 (useHomePerf와 같은 계산)
  await placementStore.load(shelfBooks(lib));
  const byTitle = new Map(Object.values(lib.books).map((b) => [lib.editions[b.editionId]?.title, b.id]));
  const idOf = (sample: string) => byTitle.get(realBookOf(sample)?.title);
  const placements = REAL_LAYOUT.placements.flatMap((p) => {
    const id = idOf(p.bookId);
    if (!id) return [];
    const on = p.lean && !p.lean.on.startsWith('#') ? idOf(p.lean.on) : p.lean?.on;
    return [{ ...p, bookId: id, ...(p.lean ? (on ? { lean: { ...p.lean, on } } : { lean: undefined }) : {}) }];
  });
  const placed = new Set(placements.map((p) => p.bookId));
  const ok = placementStore.commit({ version: 2, shelves: REAL_LAYOUT.shelves, placements, drawer: Object.keys(lib.books).filter((id) => !placed.has(id)) });
  expect(ok).toBe(true);
  // 배치 저장(비동기)이 끝나기를 기다린다
  for (let i = 0; i < 50; i++) {
    const n = ((await mockDb.getFirstAsync('SELECT COUNT(*) AS n FROM shelf_placements')) as { n: number }).n;
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const rows: Record<string, unknown[]> = {};
  for (const t of TABLES) rows[t] = await mockDb.getAllAsync(`SELECT * FROM ${t}`);
  const dir = join(__dirname, '..', 'assets');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'qa_seed.json'), `${JSON.stringify({ note: '지금 앱 QA 비교 서재(?seedlib=1 → ?seedshelf=1, tool/dump_qa_seed.test.ts). 손으로 고치지 말 것', now: now.toISOString(), rows })}\n`);
  console.log(`[dump] qa seed books ${rows.my_books.length} sessions ${rows.sessions.length} bookmarks ${rows.bookmarks.length} placements ${rows.shelf_placements.length}`);
});
