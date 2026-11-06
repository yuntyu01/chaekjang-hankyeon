// 해 넘김 → 연도 책장 남기기 → 지금 서재에서 고치고 지우기 → 다시 켜기를 실제 SQLite로(2026-11-06 연도 책장)
import { createSQLiteTestDatabase } from '@/test-utils/sqlite';

let mockDb = createSQLiteTestDatabase();
const mockStorage: Record<string, string> = {};
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete mockStorage[key]; }),
} }));

type Local = typeof import('@/db/local-db');
type Library = typeof import('../library-store')['libraryStore'];
type Cases = typeof import('../bookcase-store');
let local: Local;
let store: Library;
let cases: Cases;
const start = async () => {
  jest.resetModules();
  local = require('@/db/local-db') as Local;
  store = (require('../library-store') as typeof import('../library-store')).libraryStore;
  cases = require('../bookcase-store') as Cases;
  await store.load();
  await cases.bookcaseStore.load();
};
// 날짜만 바꾼다(타이머는 그대로: SQLite 대기열이 setTimeout을 쓰지 않아도 안전하게)
const at = (y: number, m: number, d: number, h = 12, min = 0) => jest.setSystemTime(new Date(y, m - 1, d, h, min));

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  mockDb = createSQLiteTestDatabase();
  await start();
});
afterEach(() => jest.useRealTimers());

const input = (title: string) => ({
  edition: { title, authors: ['저자'], source: 'manual' as const },
  status: 'read' as const,
  binding: { spineColor: '#123456', motif: 'leaf', source: 'custom' as const, seed: 1 },
});

async function year2026() {
  at(2026, 3, 1);
  const a = store.addBook(input('데미안'));
  const b = store.addBook(input('모순'));
  store.updateBook(a, { note: '알을 깨고 나오기', rating: 5 });
  const mark = store.addBookmark({ myBookId: a, text: '새는 알에서 나오려고 투쟁한다' });
  const session = store.addSession({ myBookId: a, startedAt: new Date(2026, 2, 1, 20).toISOString(), endedAt: new Date(2026, 2, 1, 21).toISOString(), durationMs: 3_600_000, memo: '첫 장' } as never);
  await store.flushPending();
  at(2026, 12, 31, 22);
  const layout = { version: 2, shelves: [{ id: 's1', order: 0 }, { id: 's2', order: 1 }], placements: [{ bookId: a, shelfId: 's2', order: 0, pose: 'spine', tilt: 7, lean: { angle: 5, on: '#wall-l' } }], drawer: [b] };
  await local.saveLayout(JSON.stringify(layout), new Date().toISOString());
  return { a, b, mark, session };
}

it('새해 첫 확인에 그해 책장을 한 번 남기고, 장정 복사본과 함께 올릴 목록에 넣는다', async () => {
  const { a, b } = await year2026();
  at(2026, 12, 31, 23, 59);
  expect(await cases.bookcaseStore.checkYear()).toBeNull(); // 아직 그해
  at(2027, 1, 1, 0, 0);
  expect(await cases.bookcaseStore.checkYear()).toBe(2026);
  expect(await cases.bookcaseStore.checkYear()).toBeNull(); // 한 해 한 벌

  const { bookcases, unsynced } = await local.readBookcases();
  expect(unsynced).toEqual(['bc-2026']);
  expect(bookcases).toHaveLength(1);
  const c = bookcases[0];
  expect(c.year).toBe(2026);
  expect(c.layout.shelves).toEqual([{ id: 's1', order: 0 }, { id: 's2', order: 1 }]);
  expect(c.layout.placements).toEqual([{ bookId: a, shelfId: 's2', order: 0, pose: 'spine', tilt: 7, lean: { angle: 5, on: '#wall-l' } }]);
  expect(c.layout.drawer).toEqual([b]);
  expect(c.books.find((x) => x.bookId === a)).toEqual({ bookId: a, bindingId: `bc-2026-${a}`, status: 'read', rating: 5, note: '알을 깨고 나오기' });
  // 지울 때 안내: 연도 책장에 있는 책과 그 해
  expect(cases.keptYears(cases.bookcaseStore.get().bookcases, [a, 'bk-new'])).toEqual({ kept: [a], years: [2026] });

  // 장정 복사본은 서재 항목이자 올릴 변경, 연도 책장은 같은 스냅숏에 함께
  const snap = await local.captureSyncSnapshot(true);
  expect(snap.dirty[`bindings:bc-2026-${a}`]).toBeDefined();
  expect(snap.lib.bindings[`bc-2026-${a}`]).toMatchObject({ myBookId: a, spineColor: '#123456' });
  expect(snap.bookcases.map((x) => x.id)).toEqual(['bc-2026']);
  expect(store.get().lib.bindings[`bc-2026-${a}`]).toBeDefined();
  await local.markBookcasesSynced(['bc-2026']);
  expect((await local.captureSyncSnapshot(true)).bookcases).toEqual([]);
  // 다시 연결(전체 다시 올리기)하면 연도 책장도 다시 올린다
  await local.queueAllChanges({});
  expect((await local.captureSyncSnapshot(true)).bookcases.map((x) => x.id)).toEqual(['bc-2026']);
});

it('2027년에 감상·장정을 바꾸고 책을 지워도 2026년 책장은 그대로, 지운 책의 갈피·기록도 남는다', async () => {
  const { a, mark, session } = await year2026();
  at(2027, 1, 2);
  await cases.bookcaseStore.checkYear();
  const { bookcaseLibrary } = require('@/domain/bookcase') as typeof import('@/domain/bookcase');

  at(2027, 2, 1);
  store.updateBook(a, { note: '다시 읽으니 다르다', rating: 3 });
  store.setBinding(a, { spineColor: '#FF0000', motif: 'none', source: 'custom', seed: 2 });
  await store.flushPending();
  let view = bookcaseLibrary(store.full(), cases.bookcaseStore.get().bookcases[0]);
  expect(view.books[a]).toMatchObject({ note: '알을 깨고 나오기', rating: 5 });
  expect(view.bindings[view.books[a].bindingId!].spineColor).toBe('#123456');

  // 지우기: 화면에서는 사라지고(갈피·독서 기록 연결도), 줄은 숨긴 채 남는다
  store.deleteBook(a);
  await store.flushPending();
  const visible = store.get().lib;
  expect(visible.books[a]).toBeUndefined();
  expect(visible.bookmarks[mark]).toBeUndefined();
  expect(visible.sessions[session]).toMatchObject({ myBookId: undefined, memo: '첫 장' });
  const db = await local.captureSyncSnapshot();
  expect(db.lib.books[a].hiddenAt).toBeTruthy();
  expect(db.lib.bookmarks[mark]).toBeDefined();
  expect(db.lib.sessions[session].myBookId).toBe(a);
  expect(Object.values(db.lib.bindings).filter((x) => x.myBookId === a)).toHaveLength(2);
  expect(db.dirty[`books:${a}`]).toMatchObject({ deleted: false });

  // 다시 켜도 숨긴 채로, 2026년 책장에서는 보인다
  await start();
  expect(store.get().lib.books[a]).toBeUndefined();
  expect(store.full().books[a]).toBeDefined();
  view = bookcaseLibrary(store.full(), cases.bookcaseStore.get().bookcases[0]);
  expect(view.books[a]).toMatchObject({ note: '알을 깨고 나오기' });
  expect(Object.keys(view.bookmarks)).toEqual([mark]);
  expect(Object.keys(view.sessions)).toEqual([session]);
});

it('연도 책장에 없는 책(올해 산 책)은 예전처럼 지운다. 숨긴 책과 같은 판본이면 판본은 남긴다', async () => {
  const { a } = await year2026();
  at(2027, 1, 2);
  await cases.bookcaseStore.checkYear();
  at(2027, 3, 1);
  const fresh = store.addBook(input('올해 산 책'));
  await store.flushPending();
  // 다른 기기에서 같은 판본으로 다시 들인 책
  const edition = store.get().lib.books[a].editionId;
  const twin = { ...store.get().lib.books[a], id: 'bk-twin', bindingId: undefined, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.applyRemote({ lib: store.full(), writes: [{ kind: 'books', item: twin }], erases: [], files: [] });

  store.deleteBook(a); // 연도 책장에 있다 → 숨김. 판본은 보이는 책(twin)이 쓰니 화면에 남는다
  await store.flushPending();
  expect(store.get().lib.editions[edition]).toBeDefined();
  store.deleteBook('bk-twin'); // 연도 책장에 없다 → 지움. 판본은 숨긴 책이 쓰니 지우지 않고 숨긴 쪽으로
  store.deleteBook(fresh);
  await store.flushPending();
  const db = await local.captureSyncSnapshot();
  expect(db.lib.books['bk-twin']).toBeUndefined();
  expect(db.lib.books[fresh]).toBeUndefined();
  expect(db.dirty[`books:${fresh}`]).toMatchObject({ deleted: true });
  expect(db.lib.editions[edition]).toBeDefined();
  expect(db.dirty[`editions:${edition}`]?.deleted).toBe(false); // 처음 만든 것만 올릴 목록에 있다(지우기 아님)
  expect(store.get().lib.editions[edition]).toBeUndefined();
  expect(store.full().editions[edition]).toBeDefined();
});

it('처음부터 받는 동기화가 끝나지 않았거나 동기화 중이면 남기지 않는다', async () => {
  await year2026();
  at(2027, 1, 2);
  mockStorage[cases.PULL_ALL_KEY] = '1';
  expect(await cases.bookcaseStore.checkYear()).toBeNull();
  delete mockStorage[cases.PULL_ALL_KEY];
  cases.bookcaseStore.setSyncBusy(true);
  expect(await cases.bookcaseStore.checkYear()).toBeNull();
  cases.bookcaseStore.setSyncBusy(false);
  expect(await cases.bookcaseStore.checkYear()).toBe(2026);
});

it('다른 기기가 먼저 올린 같은 해 책장이 오면 그것으로 바꾸고, 다른 기기가 숨긴 책은 화면에서 뺀다', async () => {
  const { a, b } = await year2026();
  at(2027, 1, 2);
  await cases.bookcaseStore.checkYear();
  const remote = { ...cases.bookcaseStore.get().bookcases[0], createdAt: new Date(2027, 0, 1, 0, 1).toISOString(), books: [{ bookId: b, status: 'reading' as const }] };
  await local.saveRemoteBookcases([remote]);
  await cases.bookcaseStore.load();
  const { bookcases, unsynced } = await local.readBookcases();
  expect(unsynced).toEqual([]);
  expect(bookcases[0].books).toEqual([{ bookId: b, status: 'reading' }]);
  expect(bookcases[0].layout.placements).toEqual([]); // 그 책장에 없는 책의 자리는 남지 않는다

  const hidden = { ...store.full().books[a], hiddenAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.applyRemote({ lib: store.full(), writes: [{ kind: 'books', item: hidden }], erases: [], files: [] });
  expect(store.get().lib.books[a]).toBeUndefined();
  expect(store.full().books[a].hiddenAt).toBe(hidden.hiddenAt);
});
