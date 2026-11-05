import { createSQLiteTestDatabase } from '@/test-utils/sqlite';

let mockDb = createSQLiteTestDatabase();
const mockStorage: Record<string, string> = {};
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage[key] = value; }),
} }));

type Local = typeof import('@/db/local-db');
type Store = typeof import('../library-store')['libraryStore'];
let local: Local;
let store: Store;
beforeEach(async () => {
  jest.resetModules();
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  mockDb = createSQLiteTestDatabase();
  local = require('@/db/local-db') as Local;
  store = (require('../library-store') as typeof import('../library-store')).libraryStore;
  await local.readPendingState();
});

const input = {
  edition: { title: '테스트 책', authors: ['저자'], source: 'manual' as const },
  status: 'want' as const,
  binding: { spineColor: '#123456', motif: 'leaf', source: 'custom' as const, seed: 1 },
};

it('여러 항목을 저장하다 실패하면 전부 롤백하고, 다시 시도하면 전부 기록한다', async () => {
  await mockDb.execAsync("CREATE TRIGGER reject_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  const id = store.addBook(input);
  await expect(store.flushPending()).rejects.toThrow('disk failure');
  const before = await local.captureSyncSnapshot();
  expect(before.lib.books).toEqual({});
  expect(before.lib.editions).toEqual({});
  expect(before.dirty).toEqual({});
  expect(store.get().lib.books[id]).toBeDefined(); // 화면의 수정값은 재시도까지 유지한다
  expect(store.get().error).toContain('disk failure');
  await mockDb.execAsync('DROP TRIGGER reject_outbox');
  await store.flushPending();
  const after = await local.captureSyncSnapshot();
  expect(after.lib.books[id]).toBeDefined();
  expect(Object.keys(after.lib.editions)).toHaveLength(1);
  expect(Object.keys(after.lib.bindings)).toHaveLength(1);
  expect(Object.keys(after.dirty)).toHaveLength(3);
  expect(store.get().error).toBeNull();
});

it('서버 기록을 저장하지 못하면 화면을 바꾸지 않고 재시도할 수 있다', async () => {
  const id = store.addBook(input);
  await store.flushPending();
  const current = store.get().lib;
  const remote = { ...current.books[id], note: '서버 기록', updatedAt: '2030-01-01T00:00:00.000Z' };
  const merged = { ...current, books: { ...current.books, [id]: remote } };
  const change = { lib: merged, writes: [{ kind: 'books' as const, item: remote }], erases: [], files: [] };
  await mockDb.execAsync("CREATE TRIGGER reject_remote BEFORE INSERT ON my_books BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  await expect(store.applyRemote(change)).rejects.toThrow('disk failure');
  expect(store.get().lib.books[id].note).toBeUndefined();
  await mockDb.execAsync('DROP TRIGGER reject_remote');
  await store.applyRemote(change);
  expect(store.get().lib.books[id].note).toBe('서버 기록');
  expect((await local.captureSyncSnapshot()).lib.books[id].note).toBe('서버 기록');
});

it('서버 기록을 저장하는 사이 사용자가 고친 같은 책을 덮어쓰지 않는다', async () => {
  const id = store.addBook(input);
  await store.flushPending();
  const current = store.get().lib;
  const remote = { ...current.books[id], note: '서버 기록', updatedAt: '2030-01-01T00:00:00.000Z' };
  const merged = { ...current, books: { ...current.books, [id]: remote } };
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const original = mockDb.runAsync.bind(mockDb);
  jest.spyOn(mockDb, 'runAsync').mockImplementation(async (sql, ...args) => {
    if (sql.startsWith('INSERT INTO my_books') && args[0] === id) { entered(); await gate; }
    return original(sql, ...args);
  });
  const applying = store.applyRemote({ lib: merged, writes: [{ kind: 'books', item: remote }], erases: [], files: [] });
  await started;
  store.updateBook(id, { note: '기기의 새 기록' });
  release();
  await applying;
  await store.flushPending();
  expect(store.get().lib.books[id].note).toBe('기기의 새 기록');
  expect((await local.captureSyncSnapshot()).lib.books[id].note).toBe('기기의 새 기록');
});

it('보드에서 한 장을 손대면 다른 자동 자리 카드는 고정되고, 손댄 카드가 맨 위이며, 폭까지 저장된다', async () => {
  const book = store.addBook(input);
  const a = store.addBookmark({ myBookId: book, text: '가' });
  const b = store.addBookmark({ myBookId: book, text: '나' });
  const c = store.addBookmark({ myBookId: book, text: '다', boardX: 5, boardY: 6, boardRot: 1 });
  const spots = [{ id: a, x: 10, y: 20, rot: 2 }, { id: b, x: 30, y: 40, rot: -1 }, { id: c, x: 5, y: 6, rot: 1 }];
  store.updateBoard(spots, a, { boardX: 100, boardY: 200, boardRot: 2, boardW: 320 });
  const marks = store.get().lib.bookmarks;
  expect(marks[a]).toMatchObject({ boardX: 100, boardY: 200, boardW: 320 });
  expect(marks[b]).toMatchObject({ boardX: 30, boardY: 40, boardRot: -1 });
  expect(marks[b].boardW).toBeUndefined();
  expect(marks[c]).toMatchObject({ boardX: 5, boardY: 6 }); // 이미 자리가 있는 카드는 그대로
  expect(marks[a].updatedAt > marks[b].updatedAt).toBe(true);
  await store.flushPending();
  const saved = (await local.captureSyncSnapshot()).lib.bookmarks;
  expect(saved[a].boardW).toBe(320);
  expect(saved[b].boardX).toBe(30);
});
